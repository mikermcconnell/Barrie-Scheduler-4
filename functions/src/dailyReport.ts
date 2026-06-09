import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { buildReportHtml } from './reportHtml';
import { DwellIncident, PerformanceDataSummary } from './types';
import { hasValidApiKey } from './requestAuth';

const REPORT_RECIPIENTS = defineSecret('REPORT_RECIPIENTS');
const REPORT_TEST_API_KEY = defineSecret('REPORT_TEST_API_KEY');
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TEAM_NAME = 'Barrie Transit';
const REPORT_TIME_ZONE = 'America/Toronto';

function isReportableDwellIncident(incident: DwellIncident): boolean {
  return incident.severity === 'moderate' || incident.severity === 'high';
}

function parseServiceHour(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;

  const hour = Number.parseInt(match[1] || '', 10);
  const minute = Number.parseInt(match[2] || '', 10);
  const second = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
  if (hour < 0 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  return hour % 24;
}

function buildReportSubject(latestDay: PerformanceDataSummary['dailySummaries'][number]): string {
  return `${TEAM_NAME} Performance — ${latestDay.date} — OTP ${latestDay.system.otp.onTimePercent.toFixed(1)}%`;
}

function buildNoDataReportSubject(): string {
  return `${TEAM_NAME} Performance — No New Data Available`;
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

function buildNoDataReportHtml(params: {
  expectedServiceDate: string;
  latestServiceDate: string;
}): string {
  const { expectedServiceDate, latestServiceDate } = params;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;">
    <div style="background:#1e3a5f;padding:24px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;">${TEAM_NAME} Performance</div>
      <div style="font-size:14px;color:#dbeafe;margin-top:4px;">No New Data Available</div>
    </div>
    <div style="padding:20px;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:14px;line-height:1.6;color:#374151;margin-bottom:12px;">
          No new STREETS performance data was available this morning, so today's performance report could not be generated.
        </div>
        <div style="font-size:13px;line-height:1.6;color:#374151;">Latest available service date: <strong>${latestServiceDate}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:#374151;">Expected service date: <strong>${expectedServiceDate}</strong></div>
      </div>
      <div style="font-size:13px;line-height:1.6;color:#374151;">
        The report will resume once updated data is received.
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

function latestDayHasDwellSnapshotGap(summary: PerformanceDataSummary): boolean {
  if (summary.dailySummaries.length === 0) return false;

  const latestDay = [...summary.dailySummaries].sort((a, b) => b.date.localeCompare(a.date))[0];
  const dwell = latestDay.byOperatorDwell;
  if (!dwell) return false;

  return dwell.totalTrackedDwellMinutes > 0 && (dwell.incidents?.length ?? 0) === 0;
}

async function loadSummaryJson(
  bucket: { file(path: string): { download(): Promise<[Buffer]> } },
  path: string,
): Promise<PerformanceDataSummary> {
  const [content] = await bucket.file(path).download();
  return JSON.parse(content.toString('utf-8')) as PerformanceDataSummary;
}

async function loadSummaryForEmail(params: {
  bucket: { file(path: string): { download(): Promise<[Buffer]> } };
  meta: FirebaseFirestore.DocumentData;
  forceFullSummary?: boolean;
}): Promise<{ summary: PerformanceDataSummary; source: 'report' | 'full' }> {
  const reportStoragePath = typeof params.meta.reportStoragePath === 'string'
    ? params.meta.reportStoragePath
    : undefined;
  const fullStoragePath = typeof params.meta.storagePath === 'string'
    ? params.meta.storagePath
    : undefined;

  if (params.forceFullSummary) {
    if (!fullStoragePath && !reportStoragePath) {
      throw new Error('No report data path');
    }
    const path = fullStoragePath || reportStoragePath!;
    return {
      summary: await loadSummaryJson(params.bucket, path),
      source: 'full',
    };
  }

  if (reportStoragePath) {
    const reportSummary = await loadSummaryJson(params.bucket, reportStoragePath);
    if (!latestDayHasDwellSnapshotGap(reportSummary) || !fullStoragePath || fullStoragePath === reportStoragePath) {
      return { summary: reportSummary, source: 'report' };
    }

    console.warn('Report snapshot missing latest-day dwell incidents; falling back to full summary for email rendering');
    return {
      summary: await loadSummaryJson(params.bucket, fullStoragePath),
      source: 'full',
    };
  }

  if (!fullStoragePath) {
    throw new Error('No report data path');
  }

  return {
    summary: await loadSummaryJson(params.bucket, fullStoragePath),
    source: 'full',
  };
}

export const sendDailyReport = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: REPORT_TIME_ZONE,
    secrets: [REPORT_RECIPIENTS],
    memory: '1GiB',
    timeoutSeconds: 120,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 900,
    maxRetrySeconds: 3600,
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
    let summary: PerformanceDataSummary;
    try {
      summary = (await loadSummaryForEmail({ bucket, meta })).summary;
    } catch (error) {
      console.warn(`No reportStoragePath or storagePath in metadata — skipping report: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (summary.dailySummaries.length === 0) {
      console.warn('No daily summaries — skipping report');
      return;
    }

    const sorted = [...summary.dailySummaries].sort((a, b) => b.date.localeCompare(a.date));
    const latestDay = sorted[0];
    const trendDays = sorted.slice(0, 56).reverse();

    const expectedServiceDate = getExpectedServiceDate();
    const latestServiceDate = latestDay.date;
    const lastReportSentServiceDate = typeof meta.lastReportSentServiceDate === 'string'
      ? meta.lastReportSentServiceDate
      : null;
    const lastNoDataReportExpectedDate = typeof meta.lastNoDataReportExpectedDate === 'string'
      ? meta.lastNoDataReportExpectedDate
      : null;

    if (latestServiceDate < expectedServiceDate) {
      if (lastNoDataReportExpectedDate === expectedServiceDate) {
        console.log(`No-data report already sent for expected service date ${expectedServiceDate}; skipping duplicate send.`);
        return;
      }

      const recipients = parseRecipients(REPORT_RECIPIENTS.value());
      if (recipients.length === 0) {
        console.warn('REPORT_RECIPIENTS secret is empty — skipping no-data report');
        return;
      }

      await queueMail({
        db,
        to: recipients,
        subject: buildNoDataReportSubject(),
        html: buildNoDataReportHtml({
          expectedServiceDate,
          latestServiceDate,
        }),
      });

      await metadataRef.set({
        lastNoDataReportExpectedDate: expectedServiceDate,
        lastNoDataReportSentAt: admin.firestore.FieldValue.serverTimestamp(),
        noDataReportLatestServiceDate: latestServiceDate,
      }, { merge: true });

      console.log(`No-data report queued for ${recipients.length} recipient(s): latest ${latestServiceDate}, expected ${expectedServiceDate}`);
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
  {
    memory: '1GiB',
    timeoutSeconds: 120,
    region: 'us-central1',
    secrets: [REPORT_TEST_API_KEY],
  },
  async (req, res) => {
    if (!hasValidApiKey(req, REPORT_TEST_API_KEY.value())) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }

    const to = (req.query.to as string) || '';
    if (!to || !to.includes('@')) {
      res.status(400).json({ error: 'Pass ?to=email@example.com' });
      return;
    }
    const useFullSummary = ((req.query.useFullSummary as string) || '') === '1';
    const debug = ((req.query.debug as string) || '') === '1';

    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const metadataSnap = await db
      .doc(`teams/${DEFAULT_TEAM_ID}/performanceData/metadata`)
      .get();
    if (!metadataSnap.exists) { res.status(404).json({ error: 'No data' }); return; }

    const meta = metadataSnap.data()!;
    let summaryResult: { summary: PerformanceDataSummary; source: 'report' | 'full' };
    try {
      summaryResult = await loadSummaryForEmail({ bucket, meta, forceFullSummary: useFullSummary });
    } catch {
      res.status(404).json({ error: 'No report data path' });
      return;
    }
    const summary = summaryResult.summary;

    const sorted = [...summary.dailySummaries].sort((a, b) => b.date.localeCompare(a.date));
    const latestDay = sorted[0];
    const trendDays = sorted.slice(0, 56).reverse();

    if (debug) {
      const reportableIncidents = (latestDay.byOperatorDwell?.incidents ?? []).filter(isReportableDwellIncident);
      const routeTotals = new Map<string, number>();
      const hourTotals = new Map<number, number>();
      let blankRouteCount = 0;
      let invalidHourCount = 0;
      const reportableTrackedDwellSeconds = reportableIncidents.reduce(
        (sum, incident) => sum + incident.trackedDwellSeconds,
        0,
      );

      for (const incident of reportableIncidents) {
        const routeId = incident.routeId?.trim();
        if (!routeId) {
          blankRouteCount++;
        } else {
          routeTotals.set(routeId, (routeTotals.get(routeId) ?? 0) + incident.trackedDwellSeconds);
        }

        const hour = parseServiceHour(incident.observedDepartureTime);
        if (hour === null) {
          invalidHourCount++;
        } else {
          hourTotals.set(hour, (hourTotals.get(hour) ?? 0) + incident.trackedDwellSeconds);
        }
      }

      res.json({
        success: true,
        debug: true,
        useFullSummary,
        summarySource: summaryResult.source,
        latestDate: latestDay.date,
        byRouteCount: latestDay.byRoute.length,
        byHourCount: latestDay.byHour.length,
        totalDwellMinutes: latestDay.byOperatorDwell?.totalTrackedDwellMinutes ?? null,
        totalIncidentCount: latestDay.byOperatorDwell?.incidents?.length ?? 0,
        reportableIncidentCount: reportableIncidents.length,
        reportableTrackedDwellSeconds,
        blankRouteCount,
        invalidHourCount,
        latestRoutesSample: latestDay.byRoute.slice(0, 15).map(route => ({
          routeId: route.routeId,
          routeName: route.routeName,
        })),
        routeTotalsHours: Array.from(routeTotals.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([routeId, seconds]) => ({
            routeId,
            trackedDwellSeconds: seconds,
            dwellHours: Math.round((seconds / 3600) * 10) / 10,
          })),
        hourTotalsHours: Array.from(hourTotals.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([hour, seconds]) => ({
            hour,
            trackedDwellSeconds: seconds,
            dwellHours: Math.round((seconds / 3600) * 10) / 10,
          })),
        incidentSample: reportableIncidents.slice(0, 10).map(incident => ({
          routeId: incident.routeId,
          routeName: incident.routeName,
          observedDepartureTime: incident.observedDepartureTime,
          trackedDwellSeconds: incident.trackedDwellSeconds,
          severity: incident.severity,
        })),
      });
      return;
    }

    await queueMail({
      db,
      to: [to],
      subject: buildReportSubject(latestDay),
      html: buildReportHtml({
        latestDay,
        trendDays,
        teamName: TEAM_NAME,
      }),
    });
    res.json({
      success: true,
      sentTo: to,
      subject: buildReportSubject(latestDay),
      summarySource: summaryResult.source,
      useFullSummary,
    });
  }
);

/** Temporary test endpoint — send the no-data report to a specific email */
export const testStaleReportAlert = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 120,
    region: 'us-central1',
    secrets: [REPORT_TEST_API_KEY],
  },
  async (req, res) => {
    if (!hasValidApiKey(req, REPORT_TEST_API_KEY.value())) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }

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
    const subject = buildNoDataReportSubject();

    await queueMail({
      db,
      to: [to],
      subject,
      html: buildNoDataReportHtml({
        expectedServiceDate,
        latestServiceDate,
      }),
    });

    res.json({ success: true, sentTo: to, subject, expectedServiceDate, latestServiceDate });
  }
);
