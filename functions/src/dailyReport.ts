import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { buildReportHtml } from './reportHtml';
import { PerformanceDataSummary } from './types';

const REPORT_RECIPIENTS = defineSecret('REPORT_RECIPIENTS');
const REPORT_ALERT_RECIPIENTS = defineSecret('REPORT_ALERT_RECIPIENTS');
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TEAM_NAME = 'Barrie Transit';
const REPORT_TIME_ZONE = 'America/Toronto';

function buildReportSubject(latestDay: PerformanceDataSummary['dailySummaries'][number]): string {
  return `${TEAM_NAME} Performance — ${latestDay.date} — OTP ${latestDay.system.otp.onTimePercent.toFixed(1)}%`;
}

function buildStaleAlertSubject(expectedServiceDate: string, latestServiceDate: string): string {
  return `Scheduler 4 data alert — stale daily report data (latest ${latestServiceDate}, expected ${expectedServiceDate})`;
}

function parseRecipients(csv: string | undefined): string[] {
  return (csv || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function shiftDateString(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getExpectedServiceDate(now = new Date()): string {
  const todayInToronto = formatDateInTimeZone(now, REPORT_TIME_ZONE);
  return shiftDateString(todayInToronto, -1);
}

function formatTimestampForEmail(value: unknown): string {
  const timestamp = typeof (value as { toDate?: unknown })?.toDate === 'function'
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null;

  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function buildStaleAlertHtml(params: {
  expectedServiceDate: string;
  latestServiceDate: string;
  importedAtLabel: string;
}): string {
  const { expectedServiceDate, latestServiceDate, importedAtLabel } = params;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;">
    <div style="background:#7f1d1d;padding:24px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;">Scheduler 4 Data Alert</div>
      <div style="font-size:14px;color:#fecaca;margin-top:4px;">Normal management report was not sent because the performance data is stale.</div>
    </div>
    <div style="padding:20px;">
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:15px;font-weight:700;color:#991b1b;margin-bottom:8px;">No new external performance data was available this morning.</div>
        <div style="font-size:13px;line-height:1.6;color:#7f1d1d;">Expected latest service date: <strong>${expectedServiceDate}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:#7f1d1d;">Latest available service date: <strong>${latestServiceDate}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:#7f1d1d;">Latest recorded import time: <strong>${importedAtLabel}</strong></div>
      </div>

      <div style="margin:20px 0 10px;">
        <div style="font-size:15px;font-weight:700;color:#1e3a5f;padding-bottom:4px;border-bottom:2px solid #e5e7eb;">Recommended checks</div>
      </div>
      <ul style="margin:0;padding-left:20px;color:#374151;font-size:13px;line-height:1.6;">
        <li>Check the Power Automate flow run history for the missed ingest.</li>
        <li>Confirm the external STREETS email/attachment was received.</li>
        <li>Review <code>ingestPerformanceData</code> Cloud Function logs for the expected date.</li>
      </ul>

      <div style="font-size:12px;color:#6b7280;margin-top:18px;">
        This alert goes to IT/Admin recipients only and intentionally does not use the management report subject line.
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function queueMail(params: {
  db: admin.firestore.Firestore;
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  await params.db.collection('mail').add({
    to: params.to,
    message: {
      subject: params.subject,
      html: params.html,
    },
  });
}

export const sendDailyReport = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: REPORT_TIME_ZONE,
    secrets: [REPORT_RECIPIENTS, REPORT_ALERT_RECIPIENTS],
    memory: '1GiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async () => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const metadataRef = db.doc(`teams/${DEFAULT_TEAM_ID}/performanceData/metadata`);

    const metadataSnap = await metadataRef.get();

    if (!metadataSnap.exists) {
      console.warn('No performance metadata found — skipping report');
      return;
    }

    const meta = metadataSnap.data()!;
    const storagePath = (meta.reportStoragePath as string | undefined)
      || (meta.storagePath as string | undefined);
    if (!storagePath) {
      console.warn('No reportStoragePath or storagePath in metadata — skipping report');
      return;
    }

    const [content] = await bucket.file(storagePath).download();
    const summary: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));

    if (summary.dailySummaries.length === 0) {
      console.warn('No daily summaries — skipping report');
      return;
    }

    const sorted = [...summary.dailySummaries].sort((a, b) => b.date.localeCompare(a.date));
    const latestDay = sorted[0];
    const trendDays = sorted.slice(0, 56).reverse();

    const expectedServiceDate = getExpectedServiceDate();
    const latestServiceDate = latestDay.date;
    const importedAtLabel = formatTimestampForEmail(meta.importedAt);
    const lastReportSentServiceDate = typeof meta.lastReportSentServiceDate === 'string'
      ? meta.lastReportSentServiceDate
      : null;
    const lastStaleAlertExpectedDate = typeof meta.lastStaleAlertExpectedDate === 'string'
      ? meta.lastStaleAlertExpectedDate
      : null;

    if (latestServiceDate < expectedServiceDate) {
      if (lastStaleAlertExpectedDate === expectedServiceDate) {
        console.log(`Stale data alert already sent for expected service date ${expectedServiceDate}; skipping duplicate alert.`);
        return;
      }

      const alertRecipients = parseRecipients(REPORT_ALERT_RECIPIENTS.value());
      if (alertRecipients.length === 0) {
        console.warn('REPORT_ALERT_RECIPIENTS secret is empty — skipping stale-data alert');
        return;
      }

      await queueMail({
        db,
        to: alertRecipients,
        subject: buildStaleAlertSubject(expectedServiceDate, latestServiceDate),
        html: buildStaleAlertHtml({
          expectedServiceDate,
          latestServiceDate,
          importedAtLabel,
        }),
      });

      await metadataRef.set({
        lastStaleAlertExpectedDate: expectedServiceDate,
        lastStaleAlertSentAt: admin.firestore.FieldValue.serverTimestamp(),
        staleAlertLatestServiceDate: latestServiceDate,
      }, { merge: true });

      console.log(`Stale data alert queued for ${alertRecipients.length} recipient(s): latest ${latestServiceDate}, expected ${expectedServiceDate}`);
      return;
    }

    if (lastReportSentServiceDate === latestServiceDate) {
      console.log(`Daily report already sent for service date ${latestServiceDate}; skipping duplicate send.`);
      return;
    }

    const recipients = parseRecipients(REPORT_RECIPIENTS.value());
    if (recipients.length === 0) {
      console.warn('REPORT_RECIPIENTS secret is empty — skipping send');
      return;
    }

    await queueMail({
      db,
      to: recipients,
      subject: buildReportSubject(latestDay),
      html: buildReportHtml({ latestDay, trendDays, teamName: TEAM_NAME }),
    });

    await metadataRef.set({
      lastReportSentServiceDate: latestServiceDate,
      lastReportSentAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`Daily report queued for ${recipients.length} recipient(s): ${latestServiceDate}`);
  }
);

/** Temporary test endpoint — send report to a specific email */
export const testDailyReport = onRequest(
  { memory: '1GiB', timeoutSeconds: 120, region: 'us-central1' },
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

    const meta = metadataSnap.data()!;
    const storagePath = (meta.reportStoragePath as string | undefined)
      || (meta.storagePath as string | undefined);
    if (!storagePath) { res.status(404).json({ error: 'No report data path' }); return; }
    const [content] = await bucket.file(storagePath).download();
    const summary: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));

    const sorted = [...summary.dailySummaries].sort((a, b) => b.date.localeCompare(a.date));
    const latestDay = sorted[0];
    const trendDays = sorted.slice(0, 56).reverse();

    await queueMail({
      db,
      to: [to],
      subject: buildReportSubject(latestDay),
      html: buildReportHtml({ latestDay, trendDays, teamName: TEAM_NAME }),
    });
    res.json({ success: true, sentTo: to, subject: buildReportSubject(latestDay) });
  }
);

/** Temporary test endpoint — send the stale-data alert to a specific email */
export const testStaleReportAlert = onRequest(
  { memory: '1GiB', timeoutSeconds: 120, region: 'us-central1' },
  async (req, res) => {
    const to = (req.query.to as string) || '';
    if (!to || !to.includes('@')) {
      res.status(400).json({ error: 'Pass ?to=email@example.com' });
      return;
    }

    const db = admin.firestore();
    const metadataSnap = await db
      .doc(`teams/${DEFAULT_TEAM_ID}/performanceData/metadata`)
      .get();
    if (!metadataSnap.exists) { res.status(404).json({ error: 'No data' }); return; }

    const meta = metadataSnap.data()!;
    const latestServiceDate = typeof meta.dateRange?.end === 'string'
      ? meta.dateRange.end
      : 'unknown';
    const expectedServiceDate = getExpectedServiceDate();
    const importedAtLabel = formatTimestampForEmail(meta.importedAt);
    const subject = buildStaleAlertSubject(expectedServiceDate, latestServiceDate);

    await queueMail({
      db,
      to: [to],
      subject,
      html: buildStaleAlertHtml({
        expectedServiceDate,
        latestServiceDate,
        importedAtLabel,
      }),
    });

    res.json({ success: true, sentTo: to, subject, expectedServiceDate, latestServiceDate });
  }
);
