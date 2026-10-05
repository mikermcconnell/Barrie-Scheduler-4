import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { parseTodDailyKpiWorkbookBytes } from '../../utils/todDailyKpiParser';
import type {
  TodDailyKpiDataset,
  TodPickupMetadata,
  TodPickupMonthlyDataset,
  TodPickupSummary,
} from '../../utils/todPickupTypes';
import { TOD_PICKUP_SCHEMA_VERSION } from '../../utils/todPickupTypes';
import { decodeExcelRequestBody } from './residentialGrowth';
import { hasValidApiKey } from './requestAuth';

const INGEST_API_KEY = defineSecret('INGEST_API_KEY');
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const STORAGE_PREFIX = 'todPickupData';

class ConcurrentTodImportError extends Error {}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeStoragePath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assertTeamStoragePath(teamId: string, storagePath: string): void {
  const expectedPrefix = `teams/${teamId}/${STORAGE_PREFIX}/`;
  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
    throw new Error('Stored TOD data pointer is outside the expected team path.');
  }
}

function safeSourceFileName(value: unknown): string {
  const leaf = String(value || 'custom_api3_Licensee KPI.xlsx')
    .split(/[\\/]/)
    .pop()
    ?.split('')
    .filter(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 160) || 'custom_api3_Licensee KPI.xlsx';
  if (!/\.xlsx?$/i.test(leaf)) {
    throw new Error('Attachment filename must end in .xlsx or .xls.');
  }
  return leaf;
}

function looksLikeExcelFile(bytes: Buffer): boolean {
  const isZipWorkbook = bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isLegacyWorkbook = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return isZipWorkbook || isLegacyWorkbook;
}

export function normalizeTodExcelRequestBytes(bytes: Buffer): Buffer {
  if (looksLikeExcelFile(bytes)) return bytes;
  const text = bytes.toString('utf8').trim();
  if (text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    const decoded = Buffer.from(text, 'base64');
    if (looksLikeExcelFile(decoded)) return decoded;
  }
  return bytes;
}

function validateStoredSummary(value: unknown): TodPickupSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('Existing TOD data is not a valid JSON object.');
  }
  const candidate = value as Partial<TodPickupSummary>;
  if (!Array.isArray(candidate.months)) {
    throw new Error('Existing TOD data is missing its monthly dataset array.');
  }
  if (candidate.dailyReports != null && !Array.isArray(candidate.dailyReports)) {
    throw new Error('Existing TOD daily report history is invalid.');
  }
  return candidate as TodPickupSummary;
}

function buildMetadata(
  months: TodPickupMonthlyDataset[],
  dailyReports: TodDailyKpiDataset[],
  importedBy: string,
): TodPickupMetadata {
  const dailyDates = dailyReports.map(report => report.date).sort();
  return {
    importedAt: new Date().toISOString(),
    importedBy,
    monthCount: months.length,
    totalRows: months.reduce((sum, month) => sum + month.rowCount, 0),
    totalPickups: months.reduce((sum, month) => sum + month.totalPickups, 0),
    dailyReportCount: dailyReports.length,
    dailyDateRange: dailyDates.length > 0
      ? { start: dailyDates[0], end: dailyDates[dailyDates.length - 1] }
      : undefined,
    totalCompletedTrips: dailyReports.reduce((sum, report) => sum + report.totalCompletedTrips, 0),
  };
}

export function buildTodDailyKpiAutoIngestSummary(
  existingSummary: TodPickupSummary | null,
  dataset: TodDailyKpiDataset,
  storagePath: string,
): TodPickupSummary {
  const months = existingSummary?.months || [];
  const dailyReports = [
    ...(existingSummary?.dailyReports || []).filter(report => report.date !== dataset.date),
    dataset,
  ].sort((a, b) => a.date.localeCompare(b.date));
  return {
    months,
    dailyReports,
    metadata: {
      ...buildMetadata(months, dailyReports, 'auto-ingest'),
      storagePath,
    },
    schemaVersion: TOD_PICKUP_SCHEMA_VERSION,
  };
}

async function loadExistingSummary(
  bucket: ReturnType<typeof admin.storage> extends { bucket: (...args: never[]) => infer R } ? R : never,
  storagePath: string | null,
): Promise<TodPickupSummary | null> {
  if (!storagePath) return null;
  const [bytes] = await bucket.file(storagePath).download();
  return validateStoredSummary(JSON.parse(bytes.toString('utf8')));
}

export const ingestTodDailyKpi = onRequest(
  {
    secrets: [INGEST_API_KEY],
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }
    if (!hasValidApiKey(req, INGEST_API_KEY.value())) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }

    const teamId = String(req.query.teamId || DEFAULT_TEAM_ID);
    const serviceDate = String(req.query.serviceDate || '');
    const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';
    if (!TEAM_ID_PATTERN.test(teamId)) {
      res.status(400).json({ error: 'Pass a valid teamId.' });
      return;
    }
    if (!isValidIsoDate(serviceDate)) {
      res.status(400).json({ error: 'Pass serviceDate=YYYY-MM-DD.' });
      return;
    }

    let newSummaryPath: string | null = null;
    let rawStoragePath: string | null = null;
    try {
      const requestBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0
          ? req.rawBody
          : req.body;
      const decoded = decodeExcelRequestBody(requestBody);
      const workbookBytes = normalizeTodExcelRequestBytes(decoded.buffer);
      const headerFileName = req.headers['x-file-name'];
      const sourceFileName = safeSourceFileName(
        Array.isArray(headerFileName) ? headerFileName[0] : headerFileName || decoded.fileName,
      );
      const parsed = parseTodDailyKpiWorkbookBytes(
        workbookBytes,
        sourceFileName,
        serviceDate,
        'auto-ingest',
      );

      if (dryRun) {
        res.status(200).json({
          success: true,
          dryRun: true,
          teamId,
          serviceDate,
          completedTrips: parsed.dataset.totalCompletedTrips,
          completedDropoffs: parsed.dataset.totalDropoffs,
          locationCount: parsed.dataset.locations.length,
          warnings: parsed.warnings,
        });
        return;
      }

      const db = admin.firestore();
      const bucket = admin.storage().bucket();
      const metadataRef = db.doc(`teams/${teamId}/todPickupData/metadata`);
      const existingMetadata = await metadataRef.get();
      const oldStoragePath = normalizeStoragePath(existingMetadata.data()?.storagePath);
      if (oldStoragePath) assertTeamStoragePath(teamId, oldStoragePath);

      let existingSummary: TodPickupSummary | null;
      try {
        existingSummary = await loadExistingSummary(bucket, oldStoragePath);
      } catch (error) {
        console.error('TOD auto-ingest aborted because existing history could not be read:', error);
        res.status(500).json({
          error: 'Could not read the existing saved TOD history, so the import was aborted to avoid overwriting it.',
        });
        return;
      }

      const runId = `${Date.now()}-${randomUUID()}`;
      rawStoragePath = `teams/${teamId}/${STORAGE_PREFIX}/raw/${serviceDate}/${runId}.xlsx`;
      newSummaryPath = `teams/${teamId}/${STORAGE_PREFIX}/${runId}.json`;
      await bucket.file(rawStoragePath).save(workbookBytes, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: { cacheControl: 'private, max-age=0, no-transform' },
      });

      const dataset: TodDailyKpiDataset = { ...parsed.dataset, rawStoragePath };
      const summary = buildTodDailyKpiAutoIngestSummary(existingSummary, dataset, newSummaryPath);
      await bucket.file(newSummaryPath).save(JSON.stringify(summary), {
        contentType: 'application/json',
        metadata: { cacheControl: 'private, max-age=0, no-transform' },
      });

      await db.runTransaction(async transaction => {
        const freshMetadata = await transaction.get(metadataRef);
        const freshStoragePath = normalizeStoragePath(freshMetadata.data()?.storagePath);
        if (freshStoragePath !== oldStoragePath) {
          throw new ConcurrentTodImportError('TOD data changed while this workbook was importing.');
        }
        transaction.set(metadataRef, {
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
          importedBy: 'auto-ingest',
          monthCount: summary.metadata.monthCount,
          totalRows: summary.metadata.totalRows,
          totalPickups: summary.metadata.totalPickups,
          dailyReportCount: summary.metadata.dailyReportCount || 0,
          dailyDateRange: summary.metadata.dailyDateRange || null,
          totalCompletedTrips: summary.metadata.totalCompletedTrips || 0,
          storagePath: newSummaryPath,
          lastDailyReportDate: serviceDate,
          lastDailyRawStoragePath: rawStoragePath,
        });
      });

      if (oldStoragePath && oldStoragePath !== newSummaryPath) {
        await bucket.file(oldStoragePath).delete({ ignoreNotFound: true }).catch(error => {
          console.warn('Could not remove superseded TOD summary:', error);
        });
      }

      res.status(200).json({
        success: true,
        dryRun: false,
        teamId,
        serviceDate,
        completedTrips: dataset.totalCompletedTrips,
        completedDropoffs: dataset.totalDropoffs,
        locationCount: dataset.locations.length,
        dailyReportCount: summary.dailyReports?.length || 0,
        warnings: parsed.warnings,
        rawStoragePath,
      });
    } catch (error) {
      if (newSummaryPath || rawStoragePath) {
        const bucket = admin.storage().bucket();
        await Promise.all([
          newSummaryPath ? bucket.file(newSummaryPath).delete({ ignoreNotFound: true }) : Promise.resolve(),
          rawStoragePath ? bucket.file(rawStoragePath).delete({ ignoreNotFound: true }) : Promise.resolve(),
        ]).catch(cleanupError => console.warn('TOD auto-ingest cleanup failed:', cleanupError));
      }
      if (error instanceof ConcurrentTodImportError) {
        res.status(409).json({ error: error.message });
        return;
      }
      console.error('TOD daily KPI ingest failed:', error);
      res.status(400).json({
        error: 'TOD daily KPI ingest failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
