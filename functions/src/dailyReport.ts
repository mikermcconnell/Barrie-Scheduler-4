import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { buildReportHtml } from './reportHtml';
import {
  appendFeaturedTripHistory,
  FeaturedTrip,
  FeaturedTripHistoryEntry,
  parseFeaturedTripHistory,
  recentFeaturedRouteIds,
  selectFeaturedTrip,
} from './featuredTrip';
import { DwellIncident, PerformanceDataSummary } from './types';
import { inferDayTripLoads } from '../../utils/performanceRouteLoad';
import { buildDwellHistory, summarizeWeeklyDwell, WeeklyDwellSummary } from '../../utils/performanceDwellHistory';
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

type DaySummary = PerformanceDataSummary['dailySummaries'][number];

/**
 * Weekly dwell ranking for the email. The full section shows when the latest day
 * closes a Monday–Sunday week (the Monday send); `forceSection` previews it any day.
 */
function weeklyDwellForReport(
  summary: PerformanceDataSummary,
  latestDate: string,
  forceSection = false,
): { weeklyDwell: WeeklyDwellSummary | null; showWeeklyDwellSection: boolean } {
  const weeklyDwell = summarizeWeeklyDwell(summary.dwellHistory ?? buildDwellHistory(summary.dailySummaries), latestDate);
  return {
    weeklyDwell,
    showWeeklyDwellSection: !!weeklyDwell && (forceSection || weeklyDwell.lastWeek.weekEnd === latestDate),
  };
}

function featuredTripHistoryRef(db: admin.firestore.Firestore): admin.firestore.DocumentReference {
  // Kept apart from the metadata doc, which each import overwrites.
  return db.doc(`teams/${DEFAULT_TEAM_ID}/performanceData/featuredTripHistory`);
}

/**
 * The report snapshot strips trip-level detail, so the latest day's ridership
 * heatmaps and trip OTP are read from that month's dashboard views, or the
 * full month file when those views are missing.
 */
async function loadLatestDayTripDetail(params: {
  bucket: { file(path: string): { download(): Promise<[Buffer]> } };
  meta: FirebaseFirestore.DocumentData;
  latestDay: DaySummary;
}): Promise<DaySummary> {
  const { bucket, meta, latestDay } = params;
  if (latestDay.ridershipHeatmaps?.length && latestDay.byTrip?.length) return latestDay;

  const month = latestDay.date.slice(0, 7);
  const asPath = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const dayFromFile = async (path: string | undefined): Promise<DaySummary | undefined> => {
    if (!path) return undefined;
    const file = await loadSummaryJson(bucket, path);
    return file.dailySummaries.find(day => day.date === latestDay.date);
  };

  const ridershipViewPath = asPath(meta.dashboardMonthlyStoragePaths?.ridership?.[month]);
  const overviewViewPath = asPath(meta.dashboardMonthlyStoragePaths?.overview?.[month]);
  if (ridershipViewPath && overviewViewPath) {
    const [ridershipDay, overviewDay] = await Promise.all([dayFromFile(ridershipViewPath), dayFromFile(overviewViewPath)]);
    return { ...latestDay, ridershipHeatmaps: ridershipDay?.ridershipHeatmaps, byTrip: overviewDay?.byTrip ?? [] };
  }

  const fullDay = await dayFromFile(asPath(meta.monthlyStoragePaths?.[month]));
  return { ...latestDay, ridershipHeatmaps: fullDay?.ridershipHeatmaps, byTrip: fullDay?.byTrip ?? [] };
}

async function pickFeaturedTrip(params: {
  db: admin.firestore.Firestore;
  bucket: { file(path: string): { download(): Promise<[Buffer]> } };
  meta: FirebaseFirestore.DocumentData;
  latestDay: DaySummary;
}): Promise<{ featuredTrip: FeaturedTrip | null; history: FeaturedTripHistoryEntry[]; tripDay: DaySummary }> {
  let tripDay = params.latestDay;
  let history: FeaturedTripHistoryEntry[] = [];
  try {
    tripDay = await loadLatestDayTripDetail(params);
    const historySnap = await featuredTripHistoryRef(params.db).get();
    history = parseFeaturedTripHistory(historySnap.data()?.entries);
    const priorHistory = history.filter(entry => entry.serviceDate !== tripDay.date);
    return { featuredTrip: selectFeaturedTrip(tripDay, recentFeaturedRouteIds(priorHistory)), history, tripDay };
  } catch (error) {
    console.warn(`Trip of the Day skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { featuredTrip: null, history, tripDay };
  }
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

    const { featuredTrip, history } = await pickFeaturedTrip({ db, bucket, meta, latestDay });

    await queueMail({
      db,
      to: recipients,
      subject: buildReportSubject(latestDay),
      html: buildReportHtml({
        latestDay,
        trendDays,
        teamName: TEAM_NAME,
        featuredTrip,
        ...weeklyDwellForReport(summary, latestDay.date),
      }),
    });

    await metadataRef.set({
      lastReportSentServiceDate: latestServiceDate,
      lastReportSentAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (featuredTrip) {
      await featuredTripHistoryRef(db).set({
        entries: appendFeaturedTripHistory(history, latestServiceDate, featuredTrip),
      });
    }

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
    const forceWeeklyDwell = ((req.query.weeklyDwell as string) || '') === '1';

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
    // Test sends preview the pick but never record it, so they don't affect rotation.
    const { featuredTrip, tripDay } = await pickFeaturedTrip({ db, bucket, meta, latestDay });
    const weekly = weeklyDwellForReport(summary, latestDay.date, forceWeeklyDwell);

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
        tripDetailPaths: {
          ridershipViews: Object.keys(meta.dashboardMonthlyStoragePaths?.ridership ?? {}),
          overviewViews: Object.keys(meta.dashboardMonthlyStoragePaths?.overview ?? {}),
          monthly: Object.keys(meta.monthlyStoragePaths ?? {}),
        },
        featuredTripInputs: (() => {
          const inferred = inferDayTripLoads(tripDay);
          return {
            heatmaps: tripDay.ridershipHeatmaps?.length ?? 0,
            heatmapTrips: (tripDay.ridershipHeatmaps ?? []).reduce((sum, heatmap) => sum + heatmap.trips.length, 0),
            byTrip: tripDay.byTrip?.length ?? 0,
            usableTrips: inferred.length,
            peakLoadAtLeast15: inferred.filter(trip => trip.peakLoad >= 15).length,
            fiveOrMoreStops: inferred.filter(trip => trip.stops.length >= 5).length,
            clampedStopsAtMost2: inferred.filter(trip => trip.clampedStops <= 2).length,
            maxPeakLoad: inferred.reduce((max, trip) => Math.max(max, trip.peakLoad), 0),
          };
        })(),
        featuredTrip: featuredTrip
          ? {
              routeId: featuredTrip.routeId,
              direction: featuredTrip.direction,
              departure: featuredTrip.departure,
              block: featuredTrip.block,
              peakLoad: Math.round(featuredTrip.peakLoad),
              peakStopName: featuredTrip.peakStopName,
              fullStops: featuredTrip.fullStops,
              lateMinutes: featuredTrip.lateMinutes,
              reason: featuredTrip.reason,
              score: featuredTrip.score,
              scoreParts: featuredTrip.scoreParts,
              stops: featuredTrip.stops,
            }
          : null,
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
        featuredTrip,
        ...weekly,
      }),
    });
    res.json({
      success: true,
      sentTo: to,
      weeklyDwell: weekly.weeklyDwell
        ? {
            lastWeek: weekly.weeklyDwell.lastWeek,
            weeksCompared: weekly.weeklyDwell.weeks.length,
            percentile: weekly.weeklyDwell.percentile,
            medianPer100Trips: weekly.weeklyDwell.medianPer100Trips,
            trendPercent: weekly.weeklyDwell.trendPercent,
            sectionShown: weekly.showWeeklyDwellSection,
          }
        : null,
      featuredTrip: featuredTrip
        ? `Route ${featuredTrip.routeId} ${featuredTrip.direction} ${featuredTrip.departure} (${featuredTrip.reason})`
        : null,
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
