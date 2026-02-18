import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { buildReportHtml } from './reportHtml';
import { PerformanceDataSummary } from './types';

const REPORT_RECIPIENTS = defineSecret('REPORT_RECIPIENTS');
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TEAM_NAME = 'Barrie Transit';

export const sendDailyReport = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: 'America/Toronto',
    secrets: [REPORT_RECIPIENTS],
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async () => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    // Read metadata to find the storage path
    const metadataSnap = await db
      .doc(`teams/${DEFAULT_TEAM_ID}/performanceData/metadata`)
      .get();

    if (!metadataSnap.exists) {
      console.warn('No performance metadata found — skipping report');
      return;
    }

    const meta = metadataSnap.data()!;
    const storagePath = meta.storagePath as string | undefined;
    if (!storagePath) {
      console.warn('No storagePath in metadata — skipping report');
      return;
    }

    // Download performance JSON
    const [content] = await bucket.file(storagePath).download();
    const summary: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));

    if (summary.dailySummaries.length === 0) {
      console.warn('No daily summaries — skipping report');
      return;
    }

    // Get most recent day and last 7 days for trend
    const sorted = [...summary.dailySummaries].sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    const latestDay = sorted[0];
    const trendDays = sorted.slice(0, 7).reverse(); // oldest→newest for table

    // Build HTML email
    const html = buildReportHtml({ latestDay, trendDays, teamName: TEAM_NAME });

    // Parse recipients
    const recipientsCsv = REPORT_RECIPIENTS.value();
    if (!recipientsCsv) {
      console.warn('REPORT_RECIPIENTS secret is empty — skipping send');
      return;
    }
    const to = recipientsCsv.split(',').map((e: string) => e.trim()).filter(Boolean);

    // Write to Firestore mail collection → triggers Firebase Trigger Email extension
    const subject = `${TEAM_NAME} Performance — ${latestDay.date} — OTP ${latestDay.system.otp.onTimePercent.toFixed(1)}%`;

    await db.collection('mail').add({
      to,
      message: {
        subject,
        html,
      },
    });

    console.log(`Daily report queued for ${to.length} recipient(s): ${latestDay.date}`);
  }
);

/** Temporary test endpoint — send report to a specific email */
export const testDailyReport = onRequest(
  { memory: '512MiB', timeoutSeconds: 120, region: 'us-central1' },
  async (req, res) => {
    const to = (req.query.to as string) || '';
    if (!to || !to.includes('@')) {
      res.status(400).json({ error: 'Pass ?to=email@example.com' });
      return;
    }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const metadataSnap = await db
      .doc(`teams/${DEFAULT_TEAM_ID}/performanceData/metadata`)
      .get();
    if (!metadataSnap.exists) { res.status(404).json({ error: 'No data' }); return; }

    const storagePath = metadataSnap.data()!.storagePath as string;
    const [content] = await bucket.file(storagePath).download();
    const summary: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));

    const sorted = [...summary.dailySummaries].sort((a, b) => b.date.localeCompare(a.date));
    const latestDay = sorted[0];
    const trendDays = sorted.slice(0, 7).reverse();

    const html = buildReportHtml({ latestDay, trendDays, teamName: TEAM_NAME });
    const subject = `[TEST] ${TEAM_NAME} Performance — ${latestDay.date} — OTP ${latestDay.system.otp.onTimePercent.toFixed(1)}%`;

    await db.collection('mail').add({ to: [to], message: { subject, html } });
    res.json({ success: true, sentTo: to, subject });
  }
);
