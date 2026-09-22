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
  type MonthlyRidershipReportModel,
} from '../../utils/ridership-trends/monthlyReport';
import { parseRidershipTrendProjection } from '../../utils/ridership-trends/model';
import {
  createTodRidershipProjection,
  parseTodRidershipProjection,
  type TodRidershipProjectionV1,
} from '../../utils/ridership-trends/tod';
import type { RidershipTrendProjectionV1 } from '../../utils/ridership-trends/types';
import type { TodPickupSummary } from '../../utils/todPickupTypes';
import type { PerformanceDataSummary } from './types';
import {
  buildMonthlyRidershipReportHtml,
  buildMonthlyRidershipReportText,
  MONTHLY_RIDERSHIP_CHART_CID,
  MONTHLY_RIDERSHIP_LOGO_CID,
  renderMonthlyRidershipChartPng,
} from './monthlyRidershipReportHtml';
import { hasValidApiKey } from './requestAuth';

const REPORT_RECIPIENTS = defineSecret('REPORT_RECIPIENTS');
const REPORT_TEST_API_KEY = defineSecret('REPORT_TEST_API_KEY');
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TEAM_NAME = 'Barrie Transit';
const REPORT_TIME_ZONE = 'America/Toronto';
const MONTHLY_REPORT_TEMPLATE_VERSION = 1;
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

interface QueueMonthlyRidershipMailInput {
  db: admin.firestore.Firestore;
  teamId: string;
  reportMonth: string;
  recipients: string[];
  model: MonthlyRidershipReportModel;
  mailDocument: MonthlyRidershipMailDocument;
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
  const prefix = `teams/${params.teamId}/performanceViews/ridership-trends/`;
  assertTeamStoragePath(path, prefix, /^\d+[.]json$/);
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
  assertTeamStoragePath(path, prefix, /^\d+-\d{4}-(0[1-9]|1[0-2])[.]json$/);

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

export function buildMonthlyRidershipMailDocument(input: {
  recipients: string[];
  reportMonth: string;
  model: MonthlyRidershipReportModel;
  chartPng: Buffer;
  logoPng?: Buffer;
  test?: boolean;
}): MonthlyRidershipMailDocument {
  const logoPng = input.logoPng ?? loadBarrieTransitLogo();
  return {
    to: input.recipients,
    message: {
      subject: reportSubject(input.reportMonth, input.test),
      text: buildMonthlyRidershipReportText(input.model),
      html: buildMonthlyRidershipReportHtml({
        model: input.model,
        chartCid: MONTHLY_RIDERSHIP_CHART_CID,
        brandLogoCid: MONTHLY_RIDERSHIP_LOGO_CID,
      }),
      attachments: [
        {
          filename: `barrie-transit-monthly-ridership-${input.reportMonth}.png`,
          content: input.chartPng.toString('base64'),
          encoding: 'base64',
          cid: MONTHLY_RIDERSHIP_CHART_CID,
          contentDisposition: 'inline',
        },
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
      templateVersion: MONTHLY_REPORT_TEMPLATE_VERSION,
      reportMonth: input.reportMonth,
      status: 'queued',
      queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      mailDocumentId: mailRef.id,
      recipientCount: input.recipients.length,
      sourceCoverage: {
        scheduledRoutes: input.model.scheduledRoutes.coverage,
        onDemand: input.model.onDemand.coverage,
      },
      metrics: {
        allTransitTotal: input.model.allTransit.total,
        scheduledRoutesTotal: input.model.scheduledRoutes.total,
        onDemandTotal: input.model.onDemand.total,
        priorYearScheduledTotal: input.model.priorYearScheduledTotal,
        priorYearShare: input.model.priorYearShare,
        dayTypes: input.model.dayTypes,
        priorYearDayTypeCoverage: input.model.priorYearDayTypeCoverage,
        yearToDateScheduledRoutes: input.model.yearToDateScheduledRoutes,
        projectedAnnualScheduledRoutes: input.model.projectedAnnualScheduledRoutes,
      },
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
}): Promise<{ model: MonthlyRidershipReportModel; chartPng: Buffer }> {
  const [fixedProjection, todProjection, priorYearFixedDailyTotals] = await Promise.all([
    loadFixedProjection(params),
    loadTodProjection(params),
    loadPriorYearFixedDailyTotals(params),
  ]);
  const model = buildMonthlyRidershipReportModel({
    baseline: RIDERSHIP_TREND_BASELINE,
    fixedProjection,
    todProjection,
    priorYearFixedDailyTotals,
    reportMonth: params.reportMonth,
    generatedAt: new Date().toISOString(),
  });
  return {
    model,
    chartPng: await renderMonthlyRidershipChartPng(model),
  };
}

async function runScheduledMonthlyReport(reportMonth: string): Promise<void> {
  const recipients = parseRecipients(REPORT_RECIPIENTS.value());
  if (recipients.length === 0) {
    console.warn('REPORT_RECIPIENTS secret is empty - skipping monthly ridership report');
    return;
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const { model, chartPng } = await buildReport({
    db,
    bucket,
    teamId: DEFAULT_TEAM_ID,
    reportMonth,
  });
  const mailDocument = buildMonthlyRidershipMailDocument({
    recipients,
    reportMonth,
    model,
    chartPng,
  });
  const queued = await queueMonthlyRidershipMail({
    db,
    teamId: DEFAULT_TEAM_ID,
    reportMonth,
    recipients,
    model,
    mailDocument,
  });
  if (!queued) {
    console.log(`Monthly ridership report already queued for ${reportMonth}; skipping duplicate send.`);
    return;
  }
  console.log(`Monthly ridership report queued for ${recipients.length} recipient(s): ${reportMonth}`);
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

    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const { model, chartPng } = await buildReport({
      db,
      bucket,
      teamId: DEFAULT_TEAM_ID,
      reportMonth,
    });
    if (req.query.debug === '1') {
      res.json({
        success: true,
        debug: true,
        reportMonth,
        model,
        chartBytes: chartPng.length,
      });
      return;
    }

    const mailDocument = buildMonthlyRidershipMailDocument({
      recipients: [to],
      reportMonth,
      model,
      chartPng,
      test: true,
    });
    const mailRef = await db.collection('mail').add(mailDocument);
    res.json({
      success: true,
      sentTo: to,
      reportMonth,
      subject: mailDocument.message.subject,
      mailDocumentId: mailRef.id,
      coverageComplete: model.allTransit.complete,
    });
  },
);
