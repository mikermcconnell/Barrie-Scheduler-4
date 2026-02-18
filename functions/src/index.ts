import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { parseSTREETSCSV } from './parser';
export { sendDailyReport, testDailyReport } from './dailyReport';
import { aggregateDailySummaries } from './aggregator';
import { PerformanceDataSummary, PERFORMANCE_SCHEMA_VERSION } from './types';

admin.initializeApp();

function getDb() { return admin.firestore(); }
function getBucket() { return admin.storage().bucket(); }

// API key stored as a Firebase secret — prevents unauthorized access
const INGEST_API_KEY = defineSecret('INGEST_API_KEY');

// Team ID for Barrie Transit — passed as query param or defaults to this
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';

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

      // --- Load existing data (to append) ---
      const metadataRef = getDb().doc(`teams/${teamId}/performanceData/metadata`);
      const metadataSnap = await metadataRef.get();

      let existingSummaries: PerformanceDataSummary['dailySummaries'] = [];
      let oldStoragePath: string | null = null;

      if (metadataSnap.exists) {
        const meta = metadataSnap.data()!;
        oldStoragePath = meta.storagePath || null;

        if (oldStoragePath) {
          try {
            const file = getBucket().file(oldStoragePath);
            const [content] = await file.download();
            const existing: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));
            existingSummaries = existing.dailySummaries || [];
            console.log(`Loaded ${existingSummaries.length} existing day(s)`);
          } catch (err) {
            console.warn('Could not load existing data, starting fresh:', err);
          }
        }
      }

      // --- Merge: replace any days that match, append new ones ---
      const mergedMap = new Map(existingSummaries.map(s => [s.date, s]));
      for (const summary of newSummaries) {
        mergedMap.set(summary.date, summary); // overwrites if same date exists
      }
      const mergedSummaries = Array.from(mergedMap.values()).sort(
        (a, b) => a.date.localeCompare(b.date)
      );

      const allDates = mergedSummaries.map(s => s.date);
      let totalRecords = 0;
      for (const s of mergedSummaries) {
        totalRecords += s.dataQuality.totalRecords;
      }

      const summary: PerformanceDataSummary = {
        dailySummaries: mergedSummaries,
        metadata: {
          importedAt: new Date().toISOString(),
          importedBy: 'auto-ingest',
          dateRange: {
            start: allDates[0],
            end: allDates[allDates.length - 1],
          },
          dayCount: mergedSummaries.length,
          totalRecords,
        },
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      };

      // --- Save to Storage ---
      const timestamp = Date.now().toString();
      const storagePath = `teams/${teamId}/performanceData/${timestamp}.json`;
      const jsonStr = JSON.stringify(summary);

      const file = getBucket().file(storagePath);
      await file.save(jsonStr, { contentType: 'application/json' });
      console.log(`Saved ${(jsonStr.length / 1024 / 1024).toFixed(2)} MB to ${storagePath}`);

      // --- Clean up old storage file ---
      if (oldStoragePath) {
        try {
          await getBucket().file(oldStoragePath).delete();
        } catch {
          // Old file may already be gone
        }
      }

      // --- Save metadata to Firestore ---
      await metadataRef.set({
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        importedBy: 'auto-ingest',
        storagePath,
        dateRange: summary.metadata.dateRange,
        dayCount: summary.metadata.dayCount,
        totalRecords: summary.metadata.totalRecords,
      });

      console.log('Ingest complete');

      res.status(200).json({
        success: true,
        daysIngested: newSummaries.length,
        dates: newDates,
        totalDaysStored: mergedSummaries.length,
        recordsParsed: records.length,
        warnings,
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
