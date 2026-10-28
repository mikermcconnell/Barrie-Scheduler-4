import * as admin from 'firebase-admin';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { RIDERSHIP_TREND_BASELINE } from '../../utils/ridership-trends/baseline';
import {
  buildMonthlyRidershipReportModel,
  getPreviousReportMonth,
  MONTHLY_RIDERSHIP_SERVICE_KEYS,
  type MonthlyRidershipReportModel,
  type MonthlyServiceHours,
  type SpecializedMonthlyRidership,
} from '../../utils/ridership-trends/monthlyReport';
import {
  buildMonthlyRidershipReportModel as buildMonthlyRidershipReportModelV1,
  type MonthlyRidershipReportModel as MonthlyRidershipReportModelV1,
} from '../../utils/ridership-trends/monthlyReportV1';
import { isRidershipTrendStoragePath, parseRidershipTrendProjection } from '../../utils/ridership-trends/model';
import {
  createTodRidershipProjection,
  parseTodRidershipProjection,
  type TodRidershipProjectionV1,
} from '../../utils/ridership-trends/tod';
import type { RidershipTrendProjectionV1 } from '../../utils/ridership-trends/types';
import { performanceGenerationFilePattern } from '../../utils/performanceGeneration';
import type { TodPickupSummary } from '../../utils/todPickupTypes';
import {
  isSpecializedTransitStoragePath,
  parseSpecializedTransitDataset,
} from '../../utils/specialized-transit/validation';
import type { PerformanceDataSummary } from './types';
import {
  buildMonthlyRidershipReportHtml,
  buildMonthlyRidershipReportText,
  MONTHLY_RIDERSHIP_LOGO_CID,
  monthlyRidershipSparklineCid,
  renderMonthlyRidershipCharts,
  type MonthlyRidershipChartImage,
} from './monthlyRidershipReportHtml';
import {
  buildMonthlyRidershipReportHtml as buildMonthlyRidershipReportHtmlV1,
  buildMonthlyRidershipReportText as buildMonthlyRidershipReportTextV1,
  MONTHLY_RIDERSHIP_CHART_CID as MONTHLY_RIDERSHIP_CHART_CID_V1,
  renderMonthlyRidershipChartPng as renderMonthlyRidershipChartPngV1,
} from './monthlyRidershipReportHtmlV1';
import { hasValidApiKey } from './requestAuth';

const REPORT_RECIPIENTS = defineSecret('REPORT_RECIPIENTS');
const REPORT_TEST_API_KEY = defineSecret('REPORT_TEST_API_KEY');
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TEAM_NAME = 'Barrie Transit';
const REPORT_TIME_ZONE = 'America/Toronto';
type StorageBucket = ReturnType<ReturnType<typeof admin.storage>['bucket']>;

interface MonthlyRidershipMailAttachment {
  filename: string;
  content: string;
  encoding: 'base64';
  cid: string;
  contentDisposition: 'inline';
}

interface MonthlyRidershipMailDocument {
  to: string[];
  message: {
    subject: string;
    text: string;
    html: string;
    attachments: MonthlyRidershipMailAttachment[];
  };
}

/**
 * Template 1 is the original scheduled-bus and On Demand email. Template 2 is the
 * three-service executive email. The scheduled send uses the template stored in
 * `teams/{teamId}/monthlyRidershipReportConfig/active` and falls back to template 1.
 */
export type MonthlyRidershipTemplateVersion = 1 | 2;
export const DEFAULT_MONTHLY_RIDERSHIP_TEMPLATE_VERSION: MonthlyRidershipTemplateVersion = 1;

export type MonthlyRidershipReport =
  | { templateVersion: 1; model: MonthlyRidershipReportModelV1; charts: MonthlyRidershipChartImage[] }
  | { templateVersion: 2; model: MonthlyRidershipReportModel; charts: MonthlyRidershipChartImage[] };

interface QueueMonthlyRidershipMailInput {
  db: admin.firestore.Firestore;
  teamId: string;
  reportMonth: string;
  recipients: string[];
  report: MonthlyRidershipReport;
  mailDocument: MonthlyRidershipMailDocument;
}

export function monthlyRidershipTemplateConfigPath(teamId: string): string {
  return `teams/${teamId}/monthlyRidershipReportConfig/active`;
}

export function parseMonthlyRidershipTemplateVersion(value: unknown): MonthlyRidershipTemplateVersion | null {
  if (value === 1 || value === '1') return 1;
  if (value === 2 || value === '2') return 2;
  return null;
}

async function loadConfiguredTemplateVersion(db: admin.firestore.Firestore, teamId: string): Promise<MonthlyRidershipTemplateVersion> {
  const snapshot = await db.doc(monthlyRidershipTemplateConfigPath(teamId)).get();
  return parseMonthlyRidershipTemplateVersion(snapshot.data()?.templateVersion) ?? DEFAULT_MONTHLY_RIDERSHIP_TEMPLATE_VERSION;
}

function parseRecipients(csv: string | undefined): string[] {
  return [...new Set((csv || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean))];
}

function reportMonthLabel(reportMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(reportMonth);
  if (!match) throw new Error('Report month must use YYYY-MM format.');
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new Error('Report month must use YYYY-MM format.');
  }
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function reportSubject(reportMonth: string, test = false): string {
  return `${test ? '[TEST] ' : ''}${TEAM_NAME} Monthly Ridership - ${reportMonthLabel(reportMonth)}`;
}

function loadBarrieTransitLogo(): Buffer {
  const candidates = [
    path.resolve(__dirname, '../../../assets/barrie-transit-logo.png'),
    path.resolve(__dirname, '../assets/barrie-transit-logo.png'),
  ];
  const logoPath = candidates.find(candidate => existsSync(candidate));
  if (!logoPath) throw new Error('Barrie Transit logo asset is missing from the Functions package.');
  return readFileSync(logoPath);
}

function assertTeamStoragePath(path: string, prefix: string, filenamePattern: RegExp): void {
  if (!path.startsWith(prefix) || path.includes('..') || !filenamePattern.test(path.slice(prefix.length))) {
    throw new Error('Stored ridership source path is invalid.');
  }
}

async function readStorageJson(bucket: StorageBucket, path: string): Promise<unknown> {
  const [content] = await bucket.file(path).download();
  return JSON.parse(content.toString('utf8')) as unknown;
}

async function loadFixedProjection(params: {
  db: admin.firestore.Firestore;
  bucket: StorageBucket;
  teamId: string;
}): Promise<RidershipTrendProjectionV1 | null> {
  const metadataSnap = await params.db.doc(`teams/${params.teamId}/performanceData/metadata`).get();
  if (!metadataSnap.exists) return null;
  const path = metadataSnap.data()?.ridershipTrendStoragePath;
  if (typeof path !== 'string' || !path.trim()) return null;
  if (!isRidershipTrendStoragePath(path, params.teamId)) {
    throw new Error('Stored ridership source path is invalid.');
  }
  return parseRidershipTrendProjection(await readStorageJson(params.bucket, path));
}

function priorYearMonth(reportMonth: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(reportMonth);
  if (!match) throw new Error('Report month must use YYYY-MM format.');
  return `${Number.parseInt(match[1], 10) - 1}-${match[2]}`;
}

async function loadPriorYearFixedDailyTotals(params: {
  db: admin.firestore.Firestore;
  bucket: StorageBucket;
  teamId: string;
  reportMonth: string;
}): Promise<Record<string, number> | null> {
  const metadataSnap = await params.db.doc(`teams/${params.teamId}/performanceData/metadata`).get();
  if (!metadataSnap.exists) return null;
  const comparisonMonth = priorYearMonth(params.reportMonth);
  const monthlyStoragePaths = metadataSnap.data()?.monthlyStoragePaths;
  if (!monthlyStoragePaths || typeof monthlyStoragePaths !== 'object') return null;
  const path = (monthlyStoragePaths as Record<string, unknown>)[comparisonMonth];
  if (typeof path !== 'string' || !path.trim()) return null;
  const prefix = `teams/${params.teamId}/performanceData/months/`;
  assertTeamStoragePath(path, prefix, performanceGenerationFilePattern('-\\d{4}-(0[1-9]|1[0-2])'));

  return extractPriorYearFixedDailyTotals(await readStorageJson(params.bucket, path), comparisonMonth);
}

export function extractPriorYearFixedDailyTotals(
  value: unknown,
  comparisonMonth: string,
): Record<string, number> | null {
  const stored = value as Partial<PerformanceDataSummary> | null;
  if (!stored || !Array.isArray(stored.dailySummaries)) {
    throw new Error('Stored prior-year STREETS month is invalid.');
  }
  const totals: Record<string, number> = {};
  for (const day of stored.dailySummaries) {
    if (typeof day?.date !== 'string' || !day.date.startsWith(`${comparisonMonth}-`)) continue;
    const boardings = day.system?.totalRidership;
    if (typeof boardings !== 'number' || !Number.isFinite(boardings) || boardings < 0) {
      throw new Error('Stored prior-year STREETS boardings are invalid.');
    }
    totals[day.date] = boardings;
  }
  return Object.keys(totals).length === 0 ? null : totals;
}

function validateTodSummary(value: unknown): TodPickupSummary {
  if (!value || typeof value !== 'object') throw new Error('Stored On Demand ridership data is invalid.');
  const candidate = value as Partial<TodPickupSummary>;
  if (!Array.isArray(candidate.months)
    || !Array.isArray(candidate.dailyReports)
    || !candidate.metadata
    || typeof candidate.metadata.importedAt !== 'string') {
    throw new Error('Stored On Demand ridership data is invalid.');
  }
  return candidate as TodPickupSummary;
}

async function loadTodProjection(params: {
  db: admin.firestore.Firestore;
  bucket: StorageBucket;
  teamId: string;
}): Promise<TodRidershipProjectionV1 | null> {
  const metadataSnap = await params.db.doc(`teams/${params.teamId}/todPickupData/metadata`).get();
  if (!metadataSnap.exists) return null;
  const path = metadataSnap.data()?.storagePath;
  if (typeof path !== 'string' || !path.trim()) return null;
  const prefix = `teams/${params.teamId}/todPickupData/`;
  assertTeamStoragePath(path, prefix, /^[A-Za-z0-9._-]+[.]json$/);
  const summary = validateTodSummary(await readStorageJson(params.bucket, path));
  return parseTodRidershipProjection(createTodRidershipProjection(summary));
}

async function loadSpecializedMonths(params: {
  db: admin.firestore.Firestore;
  bucket: StorageBucket;
  teamId: string;
}): Promise<Record<string, SpecializedMonthlyRidership> | null> {
  const metadataSnap = await params.db.doc(`teams/${params.teamId}/specializedTransitData/metadata`).get();
  if (!metadataSnap.exists) return null;
  const path = metadataSnap.data()?.storagePath;
  if (typeof path !== 'string' || !path.trim()) return null;
  if (!isSpecializedTransitStoragePath(params.teamId, path)) {
    throw new Error('Stored ridership source path is invalid.');
  }
  const dataset = parseSpecializedTransitDataset(await readStorageJson(params.bucket, path));
  return Object.fromEntries(Object.entries(dataset.months).map(([month, value]) => [month, {
    reportedTrips: value.reportedTrips,
    priorYearPercent: value.priorYearPercent,
  }]));
}

export function monthlyServiceHoursPath(teamId: string, month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Report month must use YYYY-MM format.');
  return `teams/${teamId}/monthlyServiceHours/${month}`;
}

export function parseMonthlyServiceHours(value: unknown): MonthlyServiceHours {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const hours: MonthlyServiceHours = {};
  for (const key of MONTHLY_RIDERSHIP_SERVICE_KEYS) {
    const hoursValue = record[key];
    if (typeof hoursValue === 'number' && Number.isFinite(hoursValue) && hoursValue > 0) hours[key] = hoursValue;
  }
  return hours;
}

async function loadServiceHours(params: {
  db: admin.firestore.Firestore;
  teamId: string;
  reportMonth: string;
}): Promise<Record<string, MonthlyServiceHours>> {
  const months = [params.reportMonth, priorYearMonth(params.reportMonth)];
  const snapshots = await Promise.all(months.map(month => params.db.doc(monthlyServiceHoursPath(params.teamId, month)).get()));
  return Object.fromEntries(snapshots.flatMap((snapshot, index) => (
    snapshot.exists ? [[months[index], parseMonthlyServiceHours(snapshot.data())]] : []
  )));
}

export function monthlyRidershipDocumentPaths(teamId: string, reportMonth: string): {
  auditPath: string;
  mailPath: string;
} {
  if (!/^\d{4}-\d{2}$/.test(reportMonth)) throw new Error('Report month must use YYYY-MM format.');
  return {
    auditPath: `teams/${teamId}/monthlyRidershipReports/${reportMonth}`,
    mailPath: `mail/monthly-ridership-${teamId}-${reportMonth}`,
  };
}

function buildMailBody(report: MonthlyRidershipReport): { text: string; html: string } {
  if (report.templateVersion === 1) {
    return {
      text: buildMonthlyRidershipReportTextV1(report.model),
      html: buildMonthlyRidershipReportHtmlV1({
        model: report.model,
        chartCid: MONTHLY_RIDERSHIP_CHART_CID_V1,
        brandLogoCid: MONTHLY_RIDERSHIP_LOGO_CID,
      }),
    };
  }
  const chartCids = new Set(report.charts.map(chart => chart.cid));
  return {
    text: buildMonthlyRidershipReportText(report.model),
    html: buildMonthlyRidershipReportHtml({
      model: report.model,
      brandLogoCid: MONTHLY_RIDERSHIP_LOGO_CID,
      sparklineServices: report.model.services
        .filter(service => chartCids.has(monthlyRidershipSparklineCid(service.key)))
        .map(service => service.key),
    }),
  };
}

export function buildMonthlyRidershipMailDocument(input: {
  recipients: string[];
  reportMonth: string;
  report: MonthlyRidershipReport;
  logoPng?: Buffer;
  test?: boolean;
}): MonthlyRidershipMailDocument {
  const logoPng = input.logoPng ?? loadBarrieTransitLogo();
  return {
    to: input.recipients,
    message: {
      subject: reportSubject(input.reportMonth, input.test),
      ...buildMailBody(input.report),
      attachments: [
        ...input.report.charts.map(chart => ({
          filename: chart.filename,
          content: chart.png.toString('base64'),
          encoding: 'base64' as const,
          cid: chart.cid,
          contentDisposition: 'inline' as const,
        })),
        {
          filename: 'barrie-transit-logo.png',
          content: logoPng.toString('base64'),
          encoding: 'base64',
          cid: MONTHLY_RIDERSHIP_LOGO_CID,
          contentDisposition: 'inline',
        },
      ],
    },
  };
}

function auditContent(report: MonthlyRidershipReport): Record<string, unknown> {
  if (report.templateVersion === 1) {
    const { model } = report;
    return {
      sourceCoverage: {
        scheduledRoutes: model.scheduledRoutes.coverage,
        onDemand: model.onDemand.coverage,
      },
      metrics: {
        allTransitTotal: model.allTransit.total,
        scheduledRoutesTotal: model.scheduledRoutes.total,
        onDemandTotal: model.onDemand.total,
        priorYearScheduledTotal: model.priorYearScheduledTotal,
        priorYearShare: model.priorYearShare,
        dayTypes: model.dayTypes,
        priorYearDayTypeCoverage: model.priorYearDayTypeCoverage,
        yearToDateScheduledRoutes: model.yearToDateScheduledRoutes,
        projectedAnnualScheduledRoutes: model.projectedAnnualScheduledRoutes,
      },
    };
  }
  const { model } = report;
  return {
    sourceCoverage: {
      scheduledRoutes: model.coverage.scheduledRoutes,
      onDemand: model.coverage.onDemand,
    },
    metrics: {
      total: model.total,
      totalYearToDate: model.totalYearToDate,
      totalRidersPerServiceHour: model.totalRidersPerServiceHour,
      services: Object.fromEntries(model.services.map(service => [service.key, {
        month: {
          current: service.month.current,
          priorYear: service.month.priorYear,
          change: service.month.change,
          changeFromSourceReport: service.month.changeFromSourceReport,
        },
        yearToDate: service.yearToDate,
        weekdayAverage: service.weekdayAverage,
        serviceHours: service.serviceHours,
        ridersPerServiceHour: service.ridersPerServiceHour,
      }])),
    },
  };
}

export async function queueMonthlyRidershipMail(input: QueueMonthlyRidershipMailInput): Promise<boolean> {
  const paths = monthlyRidershipDocumentPaths(input.teamId, input.reportMonth);
  const auditRef = input.db.doc(paths.auditPath);
  const mailRef = input.db.doc(paths.mailPath);
  return input.db.runTransaction(async transaction => {
    const auditSnap = await transaction.get(auditRef);
    const mailSnap = await transaction.get(mailRef);
    if (auditSnap.exists || mailSnap.exists) return false;

    transaction.create(auditRef, {
      schemaVersion: 1,
      templateVersion: input.report.templateVersion,
      reportMonth: input.reportMonth,
      status: 'queued',
      queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      mailDocumentId: mailRef.id,
      recipientCount: input.recipients.length,
      ...auditContent(input.report),
    });
    transaction.create(mailRef, input.mailDocument);
    return true;
  });
}

async function buildReport(params: {
  db: admin.firestore.Firestore;
  bucket: StorageBucket;
  teamId: string;
  reportMonth: string;
  templateVersion: MonthlyRidershipTemplateVersion;
}): Promise<MonthlyRidershipReport> {
  if (params.templateVersion === 1) {
    const [fixedProjection, todProjection, priorYearFixedDailyTotals] = await Promise.all([
      loadFixedProjection(params),
      loadTodProjection(params),
      loadPriorYearFixedDailyTotals(params),
    ]);
    const model = buildMonthlyRidershipReportModelV1({
      baseline: RIDERSHIP_TREND_BASELINE,
      fixedProjection,
      todProjection,
      priorYearFixedDailyTotals,
      reportMonth: params.reportMonth,
      generatedAt: new Date().toISOString(),
    });
    return {
      templateVersion: 1,
      model,
      charts: [{
        cid: MONTHLY_RIDERSHIP_CHART_CID_V1,
        filename: `barrie-transit-monthly-ridership-${params.reportMonth}.png`,
        png: await renderMonthlyRidershipChartPngV1(model),
      }],
    };
  }

  const [fixedProjection, todProjection, priorYearFixedDailyTotals, specializedMonths, serviceHours] = await Promise.all([
    loadFixedProjection(params),
    loadTodProjection(params),
    loadPriorYearFixedDailyTotals(params),
    loadSpecializedMonths(params),
    loadServiceHours(params),
  ]);
  const model = buildMonthlyRidershipReportModel({
    baseline: RIDERSHIP_TREND_BASELINE,
    fixedProjection,
    todProjection,
    priorYearFixedDailyTotals,
    specializedMonths,
    serviceHours,
    reportMonth: params.reportMonth,
    generatedAt: new Date().toISOString(),
  });
  return {
    templateVersion: 2,
    model,
    charts: await renderMonthlyRidershipCharts(model),
  };
}

function reportCoverageComplete(report: MonthlyRidershipReport): boolean {
  return report.templateVersion === 1 ? report.model.allTransit.complete : report.model.coverage.complete;
}

async function runScheduledMonthlyReport(reportMonth: string): Promise<void> {
  const recipients = parseRecipients(REPORT_RECIPIENTS.value());
  if (recipients.length === 0) {
    console.warn('REPORT_RECIPIENTS secret is empty - skipping monthly ridership report');
    return;
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const templateVersion = await loadConfiguredTemplateVersion(db, DEFAULT_TEAM_ID);
  const report = await buildReport({
    db,
    bucket,
    teamId: DEFAULT_TEAM_ID,
    reportMonth,
    templateVersion,
  });
  const mailDocument = buildMonthlyRidershipMailDocument({
    recipients,
    reportMonth,
    report,
  });
  const queued = await queueMonthlyRidershipMail({
    db,
    teamId: DEFAULT_TEAM_ID,
    reportMonth,
    recipients,
    report,
    mailDocument,
  });
  if (!queued) {
    console.log(`Monthly ridership report already queued for ${reportMonth}; skipping duplicate send.`);
    return;
  }
  console.log(`Monthly ridership report (template ${templateVersion}) queued for ${recipients.length} recipient(s): ${reportMonth}`);
}

export const sendMonthlyRidershipReport = onSchedule(
  {
    schedule: '0 10 1 * *',
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
  async () => runScheduledMonthlyReport(getPreviousReportMonth(new Date(), REPORT_TIME_ZONE)),
);

export const testMonthlyRidershipReport = onRequest(
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
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    if (!to || !/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(to)) {
      res.status(400).json({ error: 'Pass ?to=email@example.com' });
      return;
    }
    const reportMonth = typeof req.query.month === 'string' && req.query.month.trim()
      ? req.query.month.trim()
      : getPreviousReportMonth(new Date(), REPORT_TIME_ZONE);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportMonth)) {
      res.status(400).json({ error: 'Pass month as YYYY-MM' });
      return;
    }

    const requestedTemplate = req.query.template === undefined ? null : parseMonthlyRidershipTemplateVersion(req.query.template);
    if (req.query.template !== undefined && requestedTemplate === null) {
      res.status(400).json({ error: 'Pass template as 1 or 2' });
      return;
    }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const templateVersion = requestedTemplate ?? await loadConfiguredTemplateVersion(db, DEFAULT_TEAM_ID);
    const report = await buildReport({
      db,
      bucket,
      teamId: DEFAULT_TEAM_ID,
      reportMonth,
      templateVersion,
    });
    if (req.query.debug === '1') {
      res.json({
        success: true,
        debug: true,
        reportMonth,
        templateVersion,
        model: report.model,
        chartBytes: report.charts.reduce((sum, chart) => sum + chart.png.length, 0),
      });
      return;
    }

    const mailDocument = buildMonthlyRidershipMailDocument({
      recipients: [to],
      reportMonth,
      report,
      test: true,
    });
    const mailRef = await db.collection('mail').add(mailDocument);
    res.json({
      success: true,
      sentTo: to,
      reportMonth,
      subject: mailDocument.message.subject,
      mailDocumentId: mailRef.id,
      templateVersion,
      coverageComplete: reportCoverageComplete(report),
    });
  },
);
