import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { parseSTREETSCSV } from './parser';
export { sendDailyReport, testDailyReport } from './dailyReport';
export { optimizeSchedule } from './optimize';
import { aggregateDailySummaries } from './aggregator';
import { PerformanceDataSummary, PERFORMANCE_RUNTIME_LOGIC_VERSION, PERFORMANCE_SCHEMA_VERSION } from './types';

admin.initializeApp();

function getDb() { return admin.firestore(); }
function getBucket() { return admin.storage().bucket(); }

// API key stored as a Firebase secret — prevents unauthorized access
const INGEST_API_KEY = defineSecret('INGEST_API_KEY');

// Team ID for Barrie Transit — passed as query param or defaults to this
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const MAX_RETENTION_DAYS = 380;
const DEFAULT_REBUILD_WINDOW_DAYS = 30;

interface PerformanceImportRunRecord {
  importedAt?: admin.firestore.Timestamp | null;
  importedBy?: string;
  rawStoragePath?: string;
  dateRange?: { start?: string; end?: string };
  serviceDates?: string[];
  recordCount?: number;
  warningCount?: number;
  contentLength?: number;
  contentType?: string;
}

function parseBooleanFlag(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function resolveRebuildWindow(
  now: Date,
  startDateRaw?: unknown,
  endDateRaw?: unknown,
  daysRaw?: unknown,
): { startDate: string; endDate: string } {
  const normalizedEnd = normalizeDateString(endDateRaw) ?? formatDateOnly(now);
  const normalizedStart = normalizeDateString(startDateRaw);

  if (normalizedStart) {
    return {
      startDate: normalizedStart,
      endDate: normalizedEnd < normalizedStart ? normalizedStart : normalizedEnd,
    };
  }

  const parsedDays = Number.parseInt(String(daysRaw ?? DEFAULT_REBUILD_WINDOW_DAYS), 10);
  const trailingDays = Number.isFinite(parsedDays) && parsedDays > 0
    ? parsedDays
    : DEFAULT_REBUILD_WINDOW_DAYS;
  const endDate = new Date(`${normalizedEnd}T12:00:00`);
  const startDate = addDays(endDate, -(trailingDays - 1));
  return {
    startDate: formatDateOnly(startDate),
    endDate: normalizedEnd,
  };
}

function dateRangesOverlap(
  startA: string | null | undefined,
  endA: string | null | undefined,
  startB: string,
  endB: string,
): boolean {
  if (!startA && !endA) return false;
  const left = startA ?? endA!;
  const right = endA ?? startA!;
  return !(right < startB || left > endB);
}

function getPerformanceMetadataRef(teamId: string) {
  return getDb().doc(`teams/${teamId}/performanceData/metadata`);
}

function getPerformanceImportsCollection(teamId: string) {
  return getDb().collection(`teams/${teamId}/performanceImports`);
}

function buildPerformanceDataStoragePath(teamId: string, timestamp: string, suffix = '') {
  return `teams/${teamId}/performanceData/${timestamp}${suffix}.json`;
}

function buildRawPerformanceImportStoragePath(teamId: string, timestamp: string) {
  return `teams/${teamId}/performanceImports/raw/${timestamp}.csv`;
}

function getRetentionCutoffDateString(retentionDays = MAX_RETENTION_DAYS): string {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  return cutoffDate.toISOString().slice(0, 10);
}

function getTotalRecords(summary: PerformanceDataSummary): number {
  if (typeof summary?.metadata?.totalRecords === 'number') return summary.metadata.totalRecords;
  return (summary?.dailySummaries || []).reduce((acc, d) => acc + (d?.dataQuality?.totalRecords || 0), 0);
}

function resolveCleanHistoryStartDate(
  existingStartDate: string | null | undefined,
  importedSummaries: PerformanceDataSummary['dailySummaries'],
  runtimeLogicVersion: number | undefined,
): string | undefined {
  const normalizedExisting = normalizeDateString(existingStartDate);
  if (normalizedExisting) return normalizedExisting;
  if ((runtimeLogicVersion ?? 0) < PERFORMANCE_RUNTIME_LOGIC_VERSION) return undefined;

  const importedDates = importedSummaries
    .map(summary => normalizeDateString(summary.date))
    .filter((value): value is string => value !== null)
    .sort();

  return importedDates[0];
}

function buildPerformanceSummary(
  dailySummaries: PerformanceDataSummary['dailySummaries'],
  importedBy: string,
  cleanHistoryStartDate?: string,
): PerformanceDataSummary {
  const sortedSummaries = [...dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
  const allDates = sortedSummaries.map(s => s.date);
  const totalRecords = sortedSummaries.reduce((acc, s) => acc + (s.dataQuality?.totalRecords || 0), 0);

  return {
    dailySummaries: sortedSummaries,
    metadata: {
      importedAt: new Date().toISOString(),
      importedBy,
      dateRange: {
        start: allDates[0],
        end: allDates[allDates.length - 1],
      },
      dayCount: sortedSummaries.length,
      totalRecords,
      runtimeLogicVersion: PERFORMANCE_RUNTIME_LOGIC_VERSION,
      cleanHistoryStartDate,
    },
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  };
}

function mergeDailySummaries(
  existingSummaries: PerformanceDataSummary['dailySummaries'],
  replacementSummaries: PerformanceDataSummary['dailySummaries'],
  retentionDays = MAX_RETENTION_DAYS,
): PerformanceDataSummary['dailySummaries'] {
  const mergedMap = new Map(existingSummaries.map(s => [s.date, s]));
  for (const summary of replacementSummaries) {
    mergedMap.set(summary.date, summary);
  }

  const cutoffStr = getRetentionCutoffDateString(retentionDays);
  return Array.from(mergedMap.values())
    .filter(s => s.date >= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeRebuiltDailySummaries(
  existingSummaries: PerformanceDataSummary['dailySummaries'],
  rebuiltSummaries: PerformanceDataSummary['dailySummaries'],
  startDate: string,
  endDate: string,
): PerformanceDataSummary['dailySummaries'] {
  const rebuiltMap = new Map(rebuiltSummaries.map(summary => [summary.date, summary]));
  const merged: PerformanceDataSummary['dailySummaries'] = [];
  const seenDates = new Set<string>();

  for (const summary of existingSummaries) {
    if (summary.date >= startDate && summary.date <= endDate) {
      const rebuilt = rebuiltMap.get(summary.date);
      merged.push(rebuilt ?? summary);
      seenDates.add(summary.date);
    } else {
      merged.push(summary);
      seenDates.add(summary.date);
    }
  }

  for (const rebuilt of rebuiltSummaries) {
    if (rebuilt.date < startDate || rebuilt.date > endDate) continue;
    if (seenDates.has(rebuilt.date)) continue;
    merged.push(rebuilt);
  }

  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadExistingPerformanceSummary(teamId: string): Promise<{
  summary: PerformanceDataSummary | null;
  storagePath: string | null;
}> {
  const metadataRef = getPerformanceMetadataRef(teamId);
  const metadataSnap = await metadataRef.get();

  if (!metadataSnap.exists) {
    return { summary: null, storagePath: null };
  }

  const meta = metadataSnap.data() || {};
  const storagePath = typeof meta.storagePath === 'string' ? meta.storagePath : null;
  if (!storagePath) {
    return { summary: null, storagePath: null };
  }

  const file = getBucket().file(storagePath);
  const [content] = await file.download();
  const summary: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));
  return { summary, storagePath };
}

function sanitizeNumericField(obj: Record<string, unknown> | undefined, key: string, cap: number, stats: {
  dayChanged: boolean;
  fieldsChanged: number;
  overCapClamps: number;
  negativeClamps: number;
}): void {
  if (!obj || typeof obj[key] !== 'number' || !Number.isFinite(obj[key] as number)) return;

  const original = obj[key] as number;
  let next = original;

  if (original > cap) {
    next = cap;
    stats.overCapClamps++;
  }
  if (next < 0) {
    next = 0;
    stats.negativeClamps++;
  }

  if (next !== original) {
    obj[key] = next;
    stats.fieldsChanged++;
    stats.dayChanged = true;
  }
}

function sanitizeDailySummaryLoads(day: Record<string, unknown>, cap: number): {
  dayChanged: boolean;
  fieldsChanged: number;
  overCapClamps: number;
  negativeClamps: number;
} {
  const stats = {
    dayChanged: false,
    fieldsChanged: 0,
    overCapClamps: 0,
    negativeClamps: 0,
  };

  sanitizeNumericField(day.system as Record<string, unknown> | undefined, 'peakLoad', cap, stats);
  sanitizeNumericField(day.system as Record<string, unknown> | undefined, 'avgSystemLoad', cap, stats);

  if (Array.isArray(day.byRoute)) {
    for (const route of day.byRoute) {
      sanitizeNumericField(route as Record<string, unknown>, 'maxLoad', cap, stats);
      sanitizeNumericField(route as Record<string, unknown>, 'avgLoad', cap, stats);
    }
  }

  if (Array.isArray(day.byHour)) {
    for (const hour of day.byHour) {
      sanitizeNumericField(hour as Record<string, unknown>, 'avgLoad', cap, stats);
    }
  }

  if (Array.isArray(day.byStop)) {
    for (const stop of day.byStop) {
      sanitizeNumericField(stop as Record<string, unknown>, 'avgLoad', cap, stats);
    }
  }

  if (Array.isArray(day.byTrip)) {
    for (const trip of day.byTrip) {
      sanitizeNumericField(trip as Record<string, unknown>, 'maxLoad', cap, stats);
    }
  }

  if (Array.isArray(day.loadProfiles)) {
    for (const profile of day.loadProfiles) {
      const stops = (profile as Record<string, unknown>).stops;
      if (!Array.isArray(stops)) continue;
      for (const stop of stops) {
        sanitizeNumericField(stop as Record<string, unknown>, 'maxLoad', cap, stats);
        sanitizeNumericField(stop as Record<string, unknown>, 'avgLoad', cap, stats);
      }
    }
  }

  return stats;
}

async function savePerformanceImportArchive(params: {
  teamId: string;
  runId: string;
  csvText: string;
  newSummaries: PerformanceDataSummary['dailySummaries'];
  recordCount: number;
  warningCount: number;
  importedBy: string;
  contentType: string;
}): Promise<string> {
  const rawStoragePath = buildRawPerformanceImportStoragePath(params.teamId, params.runId);
  const serviceDates = params.newSummaries.map(summary => summary.date).sort();

  await getBucket().file(rawStoragePath).save(params.csvText, {
    contentType: params.contentType,
    metadata: {
      metadata: {
        importedBy: params.importedBy,
        serviceDates: serviceDates.join(','),
        recordCount: String(params.recordCount),
        warningCount: String(params.warningCount),
      },
    },
  });

  await getPerformanceImportsCollection(params.teamId).doc(params.runId).set({
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
    importedBy: params.importedBy,
    rawStoragePath,
    dateRange: {
      start: serviceDates[0],
      end: serviceDates[serviceDates.length - 1],
    },
    serviceDates,
    recordCount: params.recordCount,
    warningCount: params.warningCount,
    contentLength: Buffer.byteLength(params.csvText, 'utf8'),
    contentType: params.contentType,
  });

  return rawStoragePath;
}

async function savePerformanceSummary(params: {
  teamId: string;
  summary: PerformanceDataSummary;
  importedBy: string;
  suffix?: string;
  oldStoragePath?: string | null;
  deleteOld?: boolean;
}): Promise<string> {
  const timestamp = Date.now().toString();
  const storagePath = buildPerformanceDataStoragePath(params.teamId, timestamp, params.suffix ?? '');
  const jsonStr = JSON.stringify(params.summary);

  await getBucket().file(storagePath).save(jsonStr, { contentType: 'application/json' });

  await getPerformanceMetadataRef(params.teamId).set({
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
    importedBy: params.importedBy,
    storagePath,
    dateRange: params.summary.metadata.dateRange,
    dayCount: params.summary.metadata.dayCount,
    totalRecords: params.summary.metadata.totalRecords,
    runtimeLogicVersion: params.summary.metadata.runtimeLogicVersion,
    cleanHistoryStartDate: params.summary.metadata.cleanHistoryStartDate ?? null,
  });

  if (params.deleteOld && params.oldStoragePath && params.oldStoragePath !== storagePath) {
    try {
      await getBucket().file(params.oldStoragePath).delete();
    } catch {
      // Old file may already be gone.
    }
  }

  return storagePath;
}

/**
 * ingestPerformanceData
 *
 * POST endpoint that accepts STREETS CSV data and ingests it into Firebase.
 * Called by Power Automate when the daily email arrives.
 *
 * Headers:
 *   x-api-key: <secret key>
 *   content-type: text/csv  OR  application/json with { csv: "..." }
 *
 * Query params:
 *   ?teamId=xxx  (optional, defaults to barrie-transit)
 */
export const ingestPerformanceData = onRequest(
  {
    secrets: [INGEST_API_KEY],
    memory: '1GiB',
    timeoutSeconds: 300,
    maxInstances: 1,
    region: 'us-central1',
  },
  async (req, res) => {
    // --- Auth check ---
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey || apiKey !== INGEST_API_KEY.value()) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }

    // --- Extract CSV text ---
    let csvText: string;

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      // Raw CSV in the body
      csvText = typeof req.body === 'string' ? req.body : req.body.toString('utf-8');
    } else if (contentType.includes('application/json')) {
      // JSON wrapper: { "csv": "...csv text..." }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      csvText = body.csv;
      if (!csvText) {
        res.status(400).json({ error: 'JSON body must include a "csv" field' });
        return;
      }
    } else {
      // Try raw body as fallback (Power Automate sometimes sends odd content types)
      csvText = typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf-8')
          : '';
    }

    if (!csvText || csvText.length < 100) {
      res.status(400).json({ error: 'No CSV data received or data too short' });
      return;
    }

    const teamId = (req.query.teamId as string) || DEFAULT_TEAM_ID;

    try {
      // --- Parse CSV ---
      console.log(`Parsing CSV for team ${teamId} (${csvText.length} bytes)`);
      const { records, warnings } = parseSTREETSCSV(csvText);

      if (records.length === 0) {
        res.status(400).json({
          error: 'No valid records found in CSV',
          warnings,
        });
        return;
      }

      console.log(`Parsed ${records.length} records with ${warnings.length} warnings`);

      // --- Aggregate ---
      const newSummaries = aggregateDailySummaries(records);
      const newDates = newSummaries.map(s => s.date);
      console.log(`Aggregated ${newSummaries.length} day(s): ${newDates.join(', ')}`);

      const runId = Date.now().toString();
      const rawStoragePath = await savePerformanceImportArchive({
        teamId,
        runId,
        csvText,
        newSummaries,
        recordCount: records.length,
        warningCount: warnings.length,
        importedBy: 'auto-ingest',
        contentType: contentType.includes('json') ? 'application/json' : 'text/csv',
      });

      // --- Load existing data (to append) ---
      let existingSummaries: PerformanceDataSummary['dailySummaries'] = [];
      let oldStoragePath: string | null = null;
      let existingCleanHistoryStartDate: string | undefined;

      try {
        const existing = await loadExistingPerformanceSummary(teamId);
        existingSummaries = existing.summary?.dailySummaries || [];
        oldStoragePath = existing.storagePath;
        existingCleanHistoryStartDate = existing.summary?.metadata?.cleanHistoryStartDate;
        if (existingSummaries.length > 0) {
          console.log(`Loaded ${existingSummaries.length} existing day(s)`);
        }
      } catch (err) {
        console.warn('Could not load existing data, starting fresh:', err);
      }

      const mergedSummaries = mergeDailySummaries(existingSummaries, newSummaries);
      const preFilterCount = new Set([...existingSummaries.map(s => s.date), ...newSummaries.map(s => s.date)]).size;
      const pruned = preFilterCount - mergedSummaries.length;
      if (pruned > 0) {
        console.log(`Pruned ${pruned} days older than ${getRetentionCutoffDateString()} (${MAX_RETENTION_DAYS}-day retention)`);
      }

      const summary = buildPerformanceSummary(
        mergedSummaries,
        'auto-ingest',
        resolveCleanHistoryStartDate(
          existingCleanHistoryStartDate,
          newSummaries,
          PERFORMANCE_RUNTIME_LOGIC_VERSION,
        ),
      );
      const storagePath = await savePerformanceSummary({
        teamId,
        summary,
        importedBy: 'auto-ingest',
        oldStoragePath,
        deleteOld: true,
      });
      console.log(`Saved ${summary.dailySummaries.length} day(s) to ${storagePath}`);

      console.log('Ingest complete');

      res.status(200).json({
        success: true,
        daysIngested: newSummaries.length,
        dates: newDates,
        totalDaysStored: mergedSummaries.length,
        recordsParsed: records.length,
        warnings,
        rawStoragePath,
      });
    } catch (err) {
      console.error('Ingest failed:', err);
      res.status(500).json({
        error: 'Ingest failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

/**
 * rebuildPerformanceHistory
 *
 * Replays archived raw STREETS CSV imports for a selected date window and
 * rewrites the stored performance summary for those dates using the current
 * aggregation logic.
 *
 * Uses the same API key auth as ingestPerformanceData.
 *
 * Query/body options:
 *   teamId    string   (optional, default team)
 *   startDate string   (optional, YYYY-MM-DD)
 *   endDate   string   (optional, YYYY-MM-DD; defaults to today)
 *   days      number   (optional, trailing-day window when startDate not provided; default 30)
 *   apply     boolean  (optional, default false = dry run)
 *   deleteOld boolean  (optional, default false)
 */
export const rebuildPerformanceHistory = onRequest(
  {
    secrets: [INGEST_API_KEY],
    memory: '1GiB',
    timeoutSeconds: 540,
    maxInstances: 1,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey || apiKey !== INGEST_API_KEY.value()) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }

    const body = (typeof req.body === 'string')
      ? (() => {
        try { return JSON.parse(req.body); } catch { return {}; }
      })()
      : (req.body || {});

    const teamId = String(req.query.teamId || body.teamId || DEFAULT_TEAM_ID);
    const { startDate, endDate } = resolveRebuildWindow(
      new Date(),
      req.query.startDate ?? body.startDate,
      req.query.endDate ?? body.endDate,
      req.query.days ?? body.days,
    );
    const apply = parseBooleanFlag(req.query.apply ?? body.apply, false);
    const deleteOld = parseBooleanFlag(req.query.deleteOld ?? body.deleteOld, false);

    try {
      const runSnap = await getPerformanceImportsCollection(teamId).get();
      const importRuns = runSnap.docs
        .map(doc => ({ id: doc.id, ...(doc.data() as PerformanceImportRunRecord) }))
        .filter(run => {
          if (Array.isArray(run.serviceDates) && run.serviceDates.length > 0) {
            return run.serviceDates.some(date => date >= startDate && date <= endDate);
          }
          return dateRangesOverlap(run.dateRange?.start, run.dateRange?.end, startDate, endDate);
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      if (importRuns.length === 0) {
        res.status(404).json({
          error: 'No archived raw performance imports matched that date window.',
          startDate,
          endDate,
        });
        return;
      }

      const rebuiltMap = new Map<string, PerformanceDataSummary['dailySummaries'][number]>();
      const replayedRunIds: string[] = [];
      const replayErrors: { runId: string; message: string }[] = [];

      for (const run of importRuns) {
        if (!run.rawStoragePath) {
          replayErrors.push({ runId: run.id, message: 'Missing rawStoragePath on archived import run.' });
          continue;
        }

        try {
          const [content] = await getBucket().file(run.rawStoragePath).download();
          const csvText = content.toString('utf8');
          const parsed = parseSTREETSCSV(csvText);
          const summaries = aggregateDailySummaries(parsed.records)
            .filter(summary => summary.date >= startDate && summary.date <= endDate);

          for (const summary of summaries) {
            rebuiltMap.set(summary.date, summary);
          }
          replayedRunIds.push(run.id);
        } catch (err) {
          replayErrors.push({
            runId: run.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const rebuiltSummaries = Array.from(rebuiltMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));

      if (!apply) {
        res.status(200).json({
          ok: true,
          dryRun: true,
          startDate,
          endDate,
          matchingImportRuns: importRuns.length,
          replayedImportRuns: replayedRunIds.length,
          rebuiltDates: rebuiltSummaries.map(summary => summary.date),
          replayErrors,
        });
        return;
      }

      const existing = await loadExistingPerformanceSummary(teamId);
      if (!existing.summary) {
        res.status(404).json({ error: `No existing performance summary found for team ${teamId}.` });
        return;
      }

      const mergedSummaries = mergeRebuiltDailySummaries(
        existing.summary.dailySummaries || [],
        rebuiltSummaries,
        startDate,
        endDate,
      );
      const nextSummary = buildPerformanceSummary(
        mergedSummaries,
        'history-rebuild',
        resolveCleanHistoryStartDate(
          existing.summary?.metadata?.cleanHistoryStartDate,
          rebuiltSummaries,
          PERFORMANCE_RUNTIME_LOGIC_VERSION,
        ),
      );
      const storagePath = await savePerformanceSummary({
        teamId,
        summary: nextSummary,
        importedBy: 'history-rebuild',
        suffix: '-history-rebuild',
        oldStoragePath: existing.storagePath,
        deleteOld,
      });

      res.status(200).json({
        ok: true,
        dryRun: false,
        startDate,
        endDate,
        matchingImportRuns: importRuns.length,
        replayedImportRuns: replayedRunIds.length,
        rebuiltDates: rebuiltSummaries.map(summary => summary.date),
        replayErrors,
        storagePath,
      });
    } catch (err) {
      console.error('Performance history rebuild failed:', err);
      res.status(500).json({
        error: 'Performance history rebuild failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

/**
 * backfillLoadSanitization
 *
 * One-off HTTP endpoint to sanitize historical load metrics already stored in
 * teams/{teamId}/performanceData/{timestamp}.json files.
 *
 * Uses same API key auth as ingestPerformanceData.
 *
 * Query/body options:
 *   teamId   string   (optional, default team)
 *   cap      number   (optional, default 65)
 *   apply    boolean  (optional, default false = dry run)
 *   deleteOld boolean (optional, default false)
 */
export const backfillLoadSanitization = onRequest(
  {
    secrets: [INGEST_API_KEY],
    memory: '1GiB',
    timeoutSeconds: 300,
    maxInstances: 1,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey || apiKey !== INGEST_API_KEY.value()) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }

    const body = (typeof req.body === 'string')
      ? (() => {
        try { return JSON.parse(req.body); } catch { return {}; }
      })()
      : (req.body || {});

    const teamId = String(req.query.teamId || body.teamId || DEFAULT_TEAM_ID);
    const capRaw = req.query.cap ?? body.cap;
    const parsedCap = Number.parseInt(String(capRaw ?? '65'), 10);
    const cap = Number.isFinite(parsedCap) && parsedCap > 0 ? parsedCap : 65;
    const apply = parseBooleanFlag(req.query.apply ?? body.apply, false);
    const deleteOld = parseBooleanFlag(req.query.deleteOld ?? body.deleteOld, false);

    try {
      const metadataRef = getDb().doc(`teams/${teamId}/performanceData/metadata`);
      const metadataSnap = await metadataRef.get();
      if (!metadataSnap.exists) {
        res.status(404).json({ error: `No metadata found for team ${teamId}` });
        return;
      }

      const metadata = metadataSnap.data() || {};
      const oldStoragePath = metadata.storagePath as string | undefined;
      if (!oldStoragePath) {
        res.status(400).json({ error: `Metadata for team ${teamId} has no storagePath` });
        return;
      }

      const [buf] = await getBucket().file(oldStoragePath).download();
      const summary = JSON.parse(buf.toString('utf8')) as PerformanceDataSummary;
      if (!Array.isArray(summary.dailySummaries)) {
        res.status(400).json({ error: 'Stored summary has no dailySummaries array' });
        return;
      }

      let daysChanged = 0;
      let fieldsChanged = 0;
      let overCapClamps = 0;
      let negativeClamps = 0;

      for (const day of summary.dailySummaries as unknown as Array<Record<string, unknown>>) {
        const dayStats = sanitizeDailySummaryLoads(day, cap);
        if (dayStats.dayChanged) daysChanged++;
        fieldsChanged += dayStats.fieldsChanged;
        overCapClamps += dayStats.overCapClamps;
        negativeClamps += dayStats.negativeClamps;
      }

      if (!apply) {
        res.status(200).json({
          success: true,
          mode: 'dry-run',
          teamId,
          cap,
          storagePath: oldStoragePath,
          dayCount: summary.dailySummaries.length,
          daysChanged,
          fieldsChanged,
          overCapClamps,
          negativeClamps,
        });
        return;
      }

      const timestamp = Date.now().toString();
      const newStoragePath = `teams/${teamId}/performanceData/${timestamp}-load-sanitize-backfill.json`;
      await getBucket().file(newStoragePath).save(JSON.stringify(summary), {
        contentType: 'application/json',
      });

      const dates = summary.dailySummaries.map(d => d.date).filter(Boolean).sort();
      const dateRange = dates.length > 0
        ? { start: dates[0], end: dates[dates.length - 1] }
        : (summary.metadata?.dateRange || { start: '', end: '' });

      await metadataRef.set({
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        importedBy: 'load-sanitize-backfill',
        storagePath: newStoragePath,
        dateRange,
        dayCount: summary.dailySummaries.length,
        totalRecords: getTotalRecords(summary),
      }, { merge: true });

      if (deleteOld && oldStoragePath !== newStoragePath) {
        try {
          await getBucket().file(oldStoragePath).delete();
        } catch {
          // Non-fatal cleanup failure
        }
      }

      res.status(200).json({
        success: true,
        mode: 'apply',
        teamId,
        cap,
        oldStoragePath,
        newStoragePath,
        dayCount: summary.dailySummaries.length,
        daysChanged,
        fieldsChanged,
        overCapClamps,
        negativeClamps,
        deletedOld: deleteOld,
      });
    } catch (err) {
      console.error('Load sanitization backfill failed:', err);
      res.status(500).json({
        error: 'Load sanitization backfill failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
