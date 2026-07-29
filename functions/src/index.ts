import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { parseSTREETSCSV } from './parser';
export { sendDailyReport, testDailyReport, testStaleReportAlert } from './dailyReport';
export { optimizeSchedule } from './optimize';
export { sharedWorkspaceData } from './sharedWorkspaceData';
export { developerSupportAccess } from './developerSupportAccess';
export { cleanupNewScheduleRuntimeMigrationBackups } from './newScheduleRuntimeBackupCleanup';
import {
  decodeExcelRequestBody,
  parseIssuanceListingBuffer,
  parseOccupancyCertificateBuffer,
  processResidentialGrowthIfComplete,
} from './residentialGrowth';
import { aggregateDailySummaries } from './aggregator';
import { computeMissedTripsForDay } from './gtfsScheduleIndex';
import {
  PerformanceDataSummary,
  PerformanceMetadata,
  PERFORMANCE_RUNTIME_LOGIC_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
} from './types';
import { filterPerformanceSummaryByRoute, getAvailablePerformanceRoutes } from './performanceRouteFilter';
import { buildLoadProfileMonthlyView } from './performanceLoadProfileView';
import {
  DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
  normalizePerformanceLoadCapacityConfig,
} from './performanceLoadCapacity';
import type { PerformanceLoadCapacityConfig } from './types';

admin.initializeApp();

function getDb() { return admin.firestore(); }
function getBucket() { return admin.storage().bucket(); }

// API key stored as a Firebase secret — prevents unauthorized access
const INGEST_API_KEY = defineSecret('INGEST_API_KEY');
const MAPBOX_TOKEN = defineSecret('MAPBOX_TOKEN');

// Team ID for Barrie Transit — passed as query param or defaults to this
const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';

type HeaderCarrier = {
  headers: Record<string, string | string[] | undefined>;
};

async function resolvePerformanceIngestActor(
  req: HeaderCarrier,
  teamId: string,
): Promise<string | null> {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === INGEST_API_KEY.value()) {
    return 'auto-ingest';
  }

  const authHeader = req.headers.authorization;
  if (Array.isArray(authHeader)) {
    return null;
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const idToken = authHeader.slice('Bearer '.length).trim();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const memberSnap = await getDb()
      .doc(`teams/${teamId}/members/${decoded.uid}`)
      .get();
    const role = memberSnap.data()?.role;
    if (memberSnap.exists && (role === 'owner' || role === 'admin')) return decoded.uid;
    if (decoded.schedulerAdmin === true) {
      const supportSnap = await getDb().doc(`developerSupportSessions/${decoded.uid}`).get();
      const support = supportSnap.data();
      const expiresAtMs = support?.expiresAt?.toMillis?.();
      if (supportSnap.exists
          && support?.teamId === teamId
          && support?.mode === 'edit'
          && typeof expiresAtMs === 'number'
          && expiresAtMs > Date.now()) {
        return decoded.uid;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function loadPerformanceLoadCapacityConfig(teamId: string): Promise<PerformanceLoadCapacityConfig> {
  const snapshot = await getDb().doc(`teams/${teamId}/performanceConfig/load`).get();
  if (!snapshot.exists) return DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG;
  return normalizePerformanceLoadCapacityConfig(snapshot.data());
}
const MAX_RETENTION_DAYS = 380;
const DEFAULT_REBUILD_WINDOW_DAYS = 30;
const ROUTE_PLANNER_GEOCODE_RATE_LIMIT_PER_HOUR = 300;
const ROUTE_PLANNER_GEOCODE_MIN_QUERY_LENGTH = 3;
const ROUTE_PLANNER_GEOCODE_MAX_QUERY_LENGTH = 180;
const BARRIE_PROXIMITY = { lng: -79.69, lat: 44.38 };

interface RoutePlanner2AddressSuggestion {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
}

interface MapboxFeature {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
}

interface MapboxGeocodingResponse {
  features?: MapboxFeature[];
}

function normalizeMapboxToken(token: string | null | undefined): string {
  return token?.replace(/\\r|\\n|\r|\n/g, '').trim() ?? '';
}

type RoutePlannerGeocodeRateLimitState = {
  count: number;
  windowStartedAt: number;
};

const routePlannerGeocodeRateLimitState = new Map<string, RoutePlannerGeocodeRateLimitState>();

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

interface ExistingPerformanceSummaryLoad {
  summary: PerformanceDataSummary | null;
  storagePath: string | null;
  overviewStoragePath: string | null;
  reportStoragePath: string | null;
  routeStoragePaths?: Record<string, string>;
  monthlyStoragePaths?: Record<string, string>;
  routeMonthlyStoragePaths?: Record<string, Record<string, string>>;
  loadProfileMonthlyStoragePaths?: Record<string, string>;
  metadata: Partial<PerformanceMetadata> | null;
  readError?: Error;
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

function getRequestIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown-ip';
  }
  return req.ip || req.socket?.remoteAddress || 'unknown-ip';
}

function checkRoutePlannerGeocodeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  if (routePlannerGeocodeRateLimitState.size > 2000) {
    for (const [stateKey, state] of routePlannerGeocodeRateLimitState.entries()) {
      if (now - state.windowStartedAt >= windowMs) {
        routePlannerGeocodeRateLimitState.delete(stateKey);
      }
    }
  }

  const state = routePlannerGeocodeRateLimitState.get(key);
  if (!state || now - state.windowStartedAt >= windowMs) {
    routePlannerGeocodeRateLimitState.set(key, { count: 1, windowStartedAt: now });
    return true;
  }

  if (state.count >= limit) return false;
  state.count += 1;
  return true;
}

function readJsonBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body as Record<string, unknown> : null;
}

function parseRoutePlannerGeocodePayload(body: unknown): { query: string; limit: number } | null {
  const parsed = readJsonBody(body);
  const query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
  const rawLimit = typeof parsed?.limit === 'number' ? parsed.limit : 5;
  const limit = Math.max(1, Math.min(Math.floor(rawLimit), 10));

  if (
    query.length < ROUTE_PLANNER_GEOCODE_MIN_QUERY_LENGTH ||
    query.length > ROUTE_PLANNER_GEOCODE_MAX_QUERY_LENGTH
  ) {
    return null;
  }

  return { query, limit };
}

function buildRoutePlannerMapboxGeocodeUrl(query: string, token: string, limit: number): string {
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('country', 'ca');
  url.searchParams.set('proximity', `${BARRIE_PROXIMITY.lng},${BARRIE_PROXIMITY.lat}`);
  url.searchParams.set('types', 'address,poi,place,locality,neighborhood');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', normalizeMapboxToken(token));
  return url.toString();
}

function normalizeRoutePlannerMapboxFeature(feature: MapboxFeature, index: number): RoutePlanner2AddressSuggestion | null {
  const [lng, lat] = feature.center ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const normalizedLat = lat as number;
  const normalizedLng = lng as number;

  const label = (feature.place_name ?? feature.text ?? '').trim();
  if (!label) return null;

  return {
    id: feature.id ?? `address-${index}`,
    name: (feature.text ?? label.split(',')[0] ?? label).trim(),
    label,
    lat: normalizedLat,
    lng: normalizedLng,
  };
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

function buildPerformanceMonthlyStoragePath(teamId: string, timestamp: string, month: string) {
  return `teams/${teamId}/performanceData/months/${timestamp}-${month}.json`;
}

function buildPerformanceRouteMonthlyStoragePath(teamId: string, timestamp: string, routeId: string, month: string) {
  return `teams/${teamId}/performanceData/months/${timestamp}-route-${encodeURIComponent(routeId)}-${month}.json`;
}

function buildPerformanceLoadProfileMonthlyStoragePath(teamId: string, timestamp: string, month: string) {
  return `teams/${teamId}/performanceViews/load-profiles/${timestamp}-${month}.json`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]),
  );
}

function readNestedStringRecord(value: unknown): Record<string, Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, nested]) => [key, readStringRecord(nested)] as const)
    .filter((entry): entry is readonly [string, Record<string, string>] => !!entry[1] && Object.keys(entry[1]).length > 0);
  return Object.fromEntries(entries);
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      await task(item);
    }
  });
  await Promise.all(workers);
}

const REPORT_DAY_COUNT = 56;
const REPORT_MISSED_TRIP_DETAIL_DAY_COUNT = 7;

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

export function mergeStoredPerformanceRuntimeMetadata(
  summaryMetadata?: Partial<PerformanceMetadata> | null,
  firestoreMetadata?: Partial<PerformanceMetadata> | null,
): Pick<PerformanceMetadata, 'runtimeLogicVersion' | 'cleanHistoryStartDate'> {
  const firestoreCleanHistoryStartDate = normalizeDateString(firestoreMetadata?.cleanHistoryStartDate) ?? undefined;
  const summaryCleanHistoryStartDate = normalizeDateString(summaryMetadata?.cleanHistoryStartDate) ?? undefined;
  const firestoreRuntimeLogicVersion =
    typeof firestoreMetadata?.runtimeLogicVersion === 'number'
      ? firestoreMetadata.runtimeLogicVersion
      : undefined;
  const summaryRuntimeLogicVersion =
    typeof summaryMetadata?.runtimeLogicVersion === 'number'
      ? summaryMetadata.runtimeLogicVersion
      : undefined;

  return {
    runtimeLogicVersion: firestoreRuntimeLogicVersion ?? summaryRuntimeLogicVersion,
    cleanHistoryStartDate: firestoreCleanHistoryStartDate ?? summaryCleanHistoryStartDate,
  };
}

function looksLikeCsvText(value: string): boolean {
  const sample = value.slice(0, 4000);
  if (!sample.includes(',') || !/[\r\n]/.test(sample)) return false;
  return /(VehicleID|RouteID|TripName|StopName|ObservedArrivalTime|TerminalDepartureTime)/i.test(sample);
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 64 || compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(compact);
}

export function decodeCsvBodyText(rawBody: unknown): string {
  const rawText =
    typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf-8')
        : rawBody == null
          ? ''
          : String(rawBody);

  if (looksLikeCsvText(rawText)) return rawText;

  const trimmed = rawText.trim();
  if (!looksLikeBase64(trimmed)) return rawText;

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    return looksLikeCsvText(decoded) ? decoded : rawText;
  } catch {
    return rawText;
  }
}

export function shouldAbortPerformanceSummaryOverwrite(
  storagePath: string | null,
  summary: PerformanceDataSummary | null,
): boolean {
  return !!storagePath && !summary;
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

function buildPerformanceSummaryFromBase(
  base: PerformanceDataSummary,
  dailySummaries: PerformanceDataSummary['dailySummaries'],
  metadataPatch: Partial<PerformanceMetadata> = {},
): PerformanceDataSummary {
  const sortedSummaries = [...dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
  const allDates = sortedSummaries.map(s => s.date);
  const totalRecords = sortedSummaries.reduce((acc, s) => acc + (s.dataQuality?.totalRecords || 0), 0);

  return {
    ...base,
    dailySummaries: sortedSummaries,
    metadata: {
      ...base.metadata,
      dateRange: allDates.length > 0
        ? { start: allDates[0], end: allDates[allDates.length - 1] }
        : base.metadata.dateRange,
      dayCount: sortedSummaries.length,
      totalRecords,
      ...metadataPatch,
    },
  };
}

function buildMonthlyPerformanceSummaries(summary: PerformanceDataSummary): Map<string, PerformanceDataSummary> {
  const byMonth = new Map<string, PerformanceDataSummary['dailySummaries']>();
  for (const day of summary.dailySummaries) {
    const month = day.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) || []), day]);
  }

  const result = new Map<string, PerformanceDataSummary>();
  for (const [month, days] of byMonth) {
    result.set(month, buildPerformanceSummaryFromBase(summary, days));
  }
  return result;
}

function enrichDailySummariesWithMissedTrips(
  dailySummaries: PerformanceDataSummary['dailySummaries'],
): PerformanceDataSummary['dailySummaries'] {
  return dailySummaries.map(day => {
    const missedTrips = computeMissedTripsForDay(day.date, day.dayType, day.byTrip);
    if (!missedTrips) {
      const dayWithoutMissedTrips = { ...day };
      delete dayWithoutMissedTrips.missedTrips;
      return dayWithoutMissedTrips;
    }
    return {
      ...day,
      missedTrips,
    };
  });
}

function buildPerformanceOverviewSummary(summary: PerformanceDataSummary): PerformanceDataSummary {
  const overviewDays = [...summary.dailySummaries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map<PerformanceDataSummary['dailySummaries'][number]>(day => ({
      ...day,
      byStop: [],
      loadProfiles: [],
      missedTrips: day.missedTrips
        ? {
            ...day.missedTrips,
            trips: [],
          }
        : day.missedTrips,
      ridershipHeatmaps: undefined,
      byOperatorDwell: undefined,
      byCascade: undefined,
      segmentRuntimes: undefined,
      stopSegmentRuntimes: undefined,
      tripStopSegmentRuntimes: undefined,
      routeStopDeviations: undefined,
      byRouteHour: undefined,
    }));
  const overviewDates = overviewDays.map(day => day.date);
  const totalRecords = overviewDays.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0);

  return {
    ...summary,
    dailySummaries: overviewDays,
    metadata: {
      ...summary.metadata,
      dateRange: overviewDates.length > 0
        ? { start: overviewDates[0], end: overviewDates[overviewDates.length - 1] }
        : summary.metadata.dateRange,
      dayCount: overviewDays.length,
      totalRecords,
    },
  };
}

function buildReportDwellMetrics(
  day: PerformanceDataSummary['dailySummaries'][number],
  isLatestDay: boolean,
): PerformanceDataSummary['dailySummaries'][number]['byOperatorDwell'] {
  const dwell = day.byOperatorDwell;
  if (!dwell) return undefined;

  return {
    incidents: isLatestDay ? dwell.incidents : [],
    byOperator: isLatestDay ? dwell.byOperator : [],
    totalIncidents: dwell.totalIncidents,
    totalTrackedDwellMinutes: dwell.totalTrackedDwellMinutes,
    totalReportableDwellMinutes: dwell.totalReportableDwellMinutes,
    totalStopVisits: dwell.totalStopVisits,
    totalServiceHours: dwell.totalServiceHours,
    incidentsPer1kVisits: dwell.incidentsPer1kVisits,
    incidentsPer100ServiceHours: dwell.incidentsPer100ServiceHours,
  };
}

function buildPerformanceReportSummary(summary: PerformanceDataSummary): PerformanceDataSummary {
  const sortedDays = [...summary.dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
  const reportDaysSource = sortedDays.slice(-REPORT_DAY_COUNT);
  const latestDate = reportDaysSource.at(-1)?.date;
  const missedTripDetailDates = new Set(
    reportDaysSource
      .slice(-REPORT_MISSED_TRIP_DETAIL_DAY_COUNT)
      .map(day => day.date),
  );

  const reportDays = reportDaysSource.map<PerformanceDataSummary['dailySummaries'][number]>(day => {
    const isLatestDay = !!latestDate && day.date === latestDate;
    const keepMissedTripDetails = missedTripDetailDates.has(day.date);

    return {
      ...day,
      byRoute: isLatestDay ? day.byRoute : [],
      byHour: isLatestDay ? day.byHour : [],
      byStop: isLatestDay ? day.byStop : [],
      byTrip: [],
      loadProfiles: [],
      missedTrips: day.missedTrips
        ? {
            ...day.missedTrips,
            trips: keepMissedTripDetails ? (day.missedTrips.trips || []) : [],
          }
        : day.missedTrips,
      ridershipHeatmaps: undefined,
      byOperatorDwell: buildReportDwellMetrics(day, isLatestDay),
      byCascade: undefined,
      segmentRuntimes: undefined,
      stopSegmentRuntimes: undefined,
      tripStopSegmentRuntimes: undefined,
      routeStopDeviations: undefined,
      byRouteHour: undefined,
    };
  });

  const reportDates = reportDays.map(day => day.date);
  const totalRecords = reportDays.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0);

  return {
    ...summary,
    dailySummaries: reportDays,
    metadata: {
      ...summary.metadata,
      dateRange: reportDates.length > 0
        ? { start: reportDates[0], end: reportDates[reportDates.length - 1] }
        : summary.metadata.dateRange,
      dayCount: reportDays.length,
      totalRecords,
    },
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

async function loadExistingPerformanceSummary(teamId: string): Promise<ExistingPerformanceSummaryLoad> {
  const metadataRef = getPerformanceMetadataRef(teamId);
  const metadataSnap = await metadataRef.get();

  if (!metadataSnap.exists) {
    return { summary: null, storagePath: null, overviewStoragePath: null, reportStoragePath: null, metadata: null };
  }

  const meta = metadataSnap.data() || {};
  const storagePath = typeof meta.storagePath === 'string' ? meta.storagePath : null;
  const overviewStoragePath = typeof meta.overviewStoragePath === 'string' ? meta.overviewStoragePath : null;
  const reportStoragePath = typeof meta.reportStoragePath === 'string' ? meta.reportStoragePath : null;
  const routeStoragePaths = readStringRecord(meta.routeStoragePaths);
  const monthlyStoragePaths = readStringRecord(meta.monthlyStoragePaths);
  const routeMonthlyStoragePaths = readNestedStringRecord(meta.routeMonthlyStoragePaths);
  const loadProfileMonthlyStoragePaths = readStringRecord(meta.loadProfileMonthlyStoragePaths);
  const metadata: Partial<PerformanceMetadata> = {
    importedAt: meta.importedAt?.toDate?.()?.toISOString?.(),
    importedBy: typeof meta.importedBy === 'string' ? meta.importedBy : undefined,
    dateRange: meta.dateRange,
    dayCount: typeof meta.dayCount === 'number' ? meta.dayCount : undefined,
    totalRecords: typeof meta.totalRecords === 'number' ? meta.totalRecords : undefined,
    runtimeLogicVersion: typeof meta.runtimeLogicVersion === 'number' ? meta.runtimeLogicVersion : undefined,
    cleanHistoryStartDate: normalizeDateString(meta.cleanHistoryStartDate) ?? undefined,
    storageMode: meta.storageMode === 'monthly' ? 'monthly' : (meta.storageMode === 'monolithic' ? 'monolithic' : undefined),
    storagePath: storagePath ?? undefined,
    overviewStoragePath: overviewStoragePath ?? undefined,
    reportStoragePath: reportStoragePath ?? undefined,
    routeStoragePaths,
    monthlyStoragePaths,
    routeMonthlyStoragePaths,
    loadProfileMonthlyStoragePaths,
  };

  if (monthlyStoragePaths && Object.keys(monthlyStoragePaths).length > 0) {
    try {
      const summaries = await Promise.all(Object.keys(monthlyStoragePaths).sort().map(async month => {
        const [content] = await getBucket().file(monthlyStoragePaths[month]).download();
        return JSON.parse(content.toString('utf-8')) as PerformanceDataSummary;
      }));
      const dailySummaries = summaries.flatMap(summary => summary.dailySummaries || []);
      const base = summaries[0] ?? {
        dailySummaries: [],
        metadata: {
          importedAt: metadata.importedAt || '',
          importedBy: metadata.importedBy || '',
          dateRange: metadata.dateRange || { start: '', end: '' },
          dayCount: metadata.dayCount || 0,
          totalRecords: metadata.totalRecords || 0,
          runtimeLogicVersion: metadata.runtimeLogicVersion,
          cleanHistoryStartDate: metadata.cleanHistoryStartDate,
        },
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      };
      const summary = buildPerformanceSummaryFromBase(base, dailySummaries, metadata);
      return { summary, storagePath, overviewStoragePath, reportStoragePath, routeStoragePaths, monthlyStoragePaths, routeMonthlyStoragePaths, loadProfileMonthlyStoragePaths, metadata };
    } catch (error) {
      return {
        summary: null,
        storagePath,
        overviewStoragePath,
        reportStoragePath,
        routeStoragePaths,
        monthlyStoragePaths,
        routeMonthlyStoragePaths,
        loadProfileMonthlyStoragePaths,
        metadata,
        readError: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  if (!storagePath) {
    return { summary: null, storagePath: null, overviewStoragePath, reportStoragePath, routeStoragePaths, monthlyStoragePaths, routeMonthlyStoragePaths, loadProfileMonthlyStoragePaths, metadata };
  }

  try {
    const file = getBucket().file(storagePath);
    const [content] = await file.download();
    const summary: PerformanceDataSummary = JSON.parse(content.toString('utf-8'));
    return { summary, storagePath, overviewStoragePath, reportStoragePath, routeStoragePaths, monthlyStoragePaths, routeMonthlyStoragePaths, loadProfileMonthlyStoragePaths, metadata };
  } catch (error) {
    return {
      summary: null,
      storagePath,
      overviewStoragePath,
      reportStoragePath,
      routeStoragePaths,
      monthlyStoragePaths,
      routeMonthlyStoragePaths,
      loadProfileMonthlyStoragePaths,
      metadata,
      readError: error instanceof Error ? error : new Error(String(error)),
    };
  }
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
  oldOverviewStoragePath?: string | null;
  oldReportStoragePath?: string | null;
  oldRouteStoragePaths?: Record<string, string> | null;
  oldMonthlyStoragePaths?: Record<string, string> | null;
  oldRouteMonthlyStoragePaths?: Record<string, Record<string, string>> | null;
  oldLoadProfileMonthlyStoragePaths?: Record<string, string> | null;
  deleteOld?: boolean;
}): Promise<string> {
  const timestamp = Date.now().toString();
  const overviewStoragePath = buildPerformanceDataStoragePath(params.teamId, timestamp, `${params.suffix ?? ''}-overview`);
  const reportStoragePath = buildPerformanceDataStoragePath(params.teamId, timestamp, `${params.suffix ?? ''}-report`);
  const overviewJsonStr = JSON.stringify(buildPerformanceOverviewSummary(params.summary));
  const reportJsonStr = JSON.stringify(buildPerformanceReportSummary(params.summary));
  const monthlyStoragePaths: Record<string, string> = {};
  const routeMonthlyStoragePaths: Record<string, Record<string, string>> = {};
  const loadProfileMonthlyStoragePaths: Record<string, string> = {};

  await mapWithConcurrency([...buildMonthlyPerformanceSummaries(params.summary).entries()], 3, async ([month, monthSummary]) => {
    const monthPath = buildPerformanceMonthlyStoragePath(params.teamId, timestamp, month);
    await getBucket().file(monthPath).save(JSON.stringify(monthSummary), { contentType: 'application/json' });
    monthlyStoragePaths[month] = monthPath;
  });
  await mapWithConcurrency([...buildMonthlyPerformanceSummaries(params.summary).entries()], 3, async ([month, monthSummary]) => {
    const monthPath = buildPerformanceLoadProfileMonthlyStoragePath(params.teamId, timestamp, month);
    await getBucket().file(monthPath).save(JSON.stringify(buildLoadProfileMonthlyView(monthSummary)), {
      contentType: 'application/json',
    });
    loadProfileMonthlyStoragePaths[month] = monthPath;
  });
  await getBucket().file(overviewStoragePath).save(overviewJsonStr, { contentType: 'application/json' });
  await getBucket().file(reportStoragePath).save(reportJsonStr, { contentType: 'application/json' });

  await mapWithConcurrency(getAvailablePerformanceRoutes(params.summary), 2, async route => {
    const routeSummary = filterPerformanceSummaryByRoute(params.summary, route.routeId);
    if (!routeSummary) return;
    routeMonthlyStoragePaths[route.routeId] = {};
    await mapWithConcurrency([...buildMonthlyPerformanceSummaries(routeSummary).entries()], 2, async ([month, monthSummary]) => {
      const routeMonthPath = buildPerformanceRouteMonthlyStoragePath(params.teamId, timestamp, route.routeId, month);
      await getBucket().file(routeMonthPath).save(JSON.stringify(monthSummary), { contentType: 'application/json' });
      routeMonthlyStoragePaths[route.routeId][month] = routeMonthPath;
    });
  });

  await getPerformanceMetadataRef(params.teamId).set({
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
    importedBy: params.importedBy,
    storageMode: 'monthly',
    overviewStoragePath,
    reportStoragePath,
    monthlyStoragePaths,
    routeMonthlyStoragePaths,
    loadProfileMonthlyStoragePaths,
    dateRange: params.summary.metadata.dateRange,
    dayCount: params.summary.metadata.dayCount,
    totalRecords: params.summary.metadata.totalRecords,
    runtimeLogicVersion: params.summary.metadata.runtimeLogicVersion,
    cleanHistoryStartDate: params.summary.metadata.cleanHistoryStartDate ?? null,
  });

  if (params.deleteOld) {
    const cleanupPaths = new Set<string>();
    const migratingFromMonolithic = !!params.oldStoragePath
      && Object.keys(params.oldMonthlyStoragePaths || {}).length === 0;
    if (params.oldStoragePath && !migratingFromMonolithic) cleanupPaths.add(params.oldStoragePath);
    if (params.oldOverviewStoragePath && params.oldOverviewStoragePath !== overviewStoragePath) cleanupPaths.add(params.oldOverviewStoragePath);
    if (params.oldReportStoragePath && params.oldReportStoragePath !== reportStoragePath) cleanupPaths.add(params.oldReportStoragePath);
    Object.values(params.oldMonthlyStoragePaths || {}).forEach(path => path && cleanupPaths.add(path));
    if (!migratingFromMonolithic) {
      Object.values(params.oldRouteStoragePaths || {}).forEach(path => path && cleanupPaths.add(path));
    }
    Object.values(params.oldRouteMonthlyStoragePaths || {}).flatMap(months => Object.values(months)).forEach(path => path && cleanupPaths.add(path));
    Object.values(params.oldLoadProfileMonthlyStoragePaths || {}).forEach(path => path && cleanupPaths.add(path));

    const newPaths = new Set([
      overviewStoragePath,
      reportStoragePath,
      ...Object.values(monthlyStoragePaths),
      ...Object.values(routeMonthlyStoragePaths).flatMap(months => Object.values(months)),
      ...Object.values(loadProfileMonthlyStoragePaths),
    ]);

    await Promise.all([...cleanupPaths].map(async path => {
      if (newPaths.has(path)) return;
      try {
        await getBucket().file(path).delete();
      } catch {
        // Old file may already be gone.
      }
    }));
  }

  return Object.values(monthlyStoragePaths)[0] || overviewStoragePath;
}

/**
 * routePlannerGeocode
 *
 * Same-origin proxy for Route Planner address searches.
 * Keeps the Mapbox token server-side in production.
 */
export const routePlannerGeocode = onRequest(
  {
    secrets: [MAPBOX_TOKEN],
    timeoutSeconds: 30,
    memory: '256MiB',
    region: 'us-central1',
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const payload = parseRoutePlannerGeocodePayload(req.body);
    if (!payload) {
      res.status(400).json({ error: 'Missing or invalid address query.' });
      return;
    }

    const requestIp = getRequestIp(req);
    const allowed = checkRoutePlannerGeocodeRateLimit(
      `route-planner-geocode:${requestIp}`,
      ROUTE_PLANNER_GEOCODE_RATE_LIMIT_PER_HOUR,
      60 * 60 * 1000,
    );
    if (!allowed) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
      return;
    }

    const token = normalizeMapboxToken(MAPBOX_TOKEN.value());
    if (!token) {
      res.status(500).json({
        error: 'Server geocode is not configured.',
        diagnostic: {
          query: payload.query,
          source: 'server',
          status: null,
          tokenPresent: false,
          resultCount: 0,
          error: 'Mapbox token is not configured.',
        },
      });
      return;
    }

    try {
      const response = await fetch(buildRoutePlannerMapboxGeocodeUrl(payload.query, token, payload.limit));
      const status = response.status;
      const data = await response.json() as MapboxGeocodingResponse;
      const suggestions = (data.features ?? [])
        .map(normalizeRoutePlannerMapboxFeature)
        .filter((suggestion): suggestion is RoutePlanner2AddressSuggestion => suggestion !== null);

      if (!response.ok) {
        res.status(status).json({
          error: `Mapbox address search returned ${status}`,
          diagnostic: {
            query: payload.query,
            source: 'server',
            status,
            tokenPresent: true,
            resultCount: 0,
            error: `Mapbox address search returned ${status}`,
          },
        });
        return;
      }

      res.status(200).json({
        suggestions,
        diagnostic: {
          query: payload.query,
          source: 'server',
          status,
          tokenPresent: true,
          resultCount: suggestions.length,
          topResultLabel: suggestions[0]?.label,
        },
      });
    } catch {
      res.status(502).json({
        error: 'Mapbox address search failed.',
        diagnostic: {
          query: payload.query,
          source: 'server',
          status: null,
          tokenPresent: true,
          resultCount: 0,
          error: 'Mapbox address search failed.',
        },
      });
    }
  },
);

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
    // Daily imports now routinely load the archived summary plus overview/report payloads.
    // Keep behavior unchanged, but give the merge/save path enough headroom to avoid OOM kills.
    memory: '8GiB',
    cpu: 2,
    timeoutSeconds: 300,
    maxInstances: 1,
    region: 'us-central1',
    cors: [
      'https://transitscheduler.ca',
      'https://www.transitscheduler.ca',
      'http://localhost:3000',
      'http://localhost:3008',
      'http://localhost:5173',
    ],
  },
  async (req, res) => {
    // --- Auth check ---
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const teamId = (req.query.teamId as string) || DEFAULT_TEAM_ID;
    const importedBy = await resolvePerformanceIngestActor(req, teamId);
    if (!importedBy) {
      res.status(401).json({ error: 'Invalid or missing ingest authorization' });
      return;
    }

    // --- Extract CSV text ---
    let csvText: string;

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      // Raw CSV in the body
      csvText = decodeCsvBodyText(req.body);
    } else if (contentType.includes('application/json')) {
      // JSON wrapper: { "csv": "...csv text..." }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      csvText = body.csv;
      if (!csvText) {
        res.status(400).json({ error: 'JSON body must include a "csv" field' });
        return;
      }
      csvText = decodeCsvBodyText(csvText);
    } else {
      // Try raw body as fallback (Power Automate sometimes sends odd content types)
      csvText = decodeCsvBodyText(req.body);
    }

    if (!csvText || csvText.length < 100) {
      res.status(400).json({ error: 'No CSV data received or data too short' });
      return;
    }

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
      const loadCapacityConfig = await loadPerformanceLoadCapacityConfig(teamId);
      const newSummaries = enrichDailySummariesWithMissedTrips(
        aggregateDailySummaries(records, loadCapacityConfig),
      );
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
        importedBy,
        contentType: contentType.includes('json') ? 'application/json' : 'text/csv',
      });

      // --- Load existing data (to append) ---
      let existingSummaries: PerformanceDataSummary['dailySummaries'] = [];
      let oldStoragePath: string | null = null;
      let oldOverviewStoragePath: string | null = null;
      let oldReportStoragePath: string | null = null;
      let oldRouteStoragePaths: Record<string, string> | null = null;
      let oldMonthlyStoragePaths: Record<string, string> | null = null;
      let oldRouteMonthlyStoragePaths: Record<string, Record<string, string>> | null = null;
      let oldLoadProfileMonthlyStoragePaths: Record<string, string> | null = null;
      let existingCleanHistoryStartDate: string | undefined;

      try {
        const existing = await loadExistingPerformanceSummary(teamId);
        if (shouldAbortPerformanceSummaryOverwrite(
          existing.storagePath || (existing.monthlyStoragePaths ? 'monthly-performance-history' : null),
          existing.summary,
        )) {
          console.error('Aborting ingest because the existing performance summary could not be read:', existing.readError);
          res.status(500).json({
            error: 'Could not read the existing saved performance history, so the import was aborted to avoid overwriting it.',
          });
          return;
        }

        existingSummaries = existing.summary?.dailySummaries || [];
        oldStoragePath = existing.storagePath;
        oldOverviewStoragePath = existing.metadata?.overviewStoragePath ?? null;
        oldReportStoragePath = existing.metadata?.reportStoragePath ?? null;
        oldRouteStoragePaths = existing.routeStoragePaths ?? null;
        oldMonthlyStoragePaths = existing.monthlyStoragePaths ?? null;
        oldRouteMonthlyStoragePaths = existing.routeMonthlyStoragePaths ?? null;
        oldLoadProfileMonthlyStoragePaths = existing.loadProfileMonthlyStoragePaths ?? null;
        existingCleanHistoryStartDate = mergeStoredPerformanceRuntimeMetadata(
          existing.summary?.metadata,
          existing.metadata,
        ).cleanHistoryStartDate;
        if (existingSummaries.length > 0) {
          console.log(`Loaded ${existingSummaries.length} existing day(s)`);
        }
      } catch (err) {
        console.error('Could not load existing data, aborting ingest to avoid overwriting history:', err);
        res.status(500).json({
          error: 'Could not read the existing saved performance history, so the import was aborted to avoid overwriting it.',
        });
        return;
      }

      const mergedSummaries = enrichDailySummariesWithMissedTrips(mergeDailySummaries(existingSummaries, newSummaries));
      const preFilterCount = new Set([...existingSummaries.map(s => s.date), ...newSummaries.map(s => s.date)]).size;
      const pruned = preFilterCount - mergedSummaries.length;
      if (pruned > 0) {
        console.log(`Pruned ${pruned} days older than ${getRetentionCutoffDateString()} (${MAX_RETENTION_DAYS}-day retention)`);
      }

      const summary = buildPerformanceSummary(
        mergedSummaries,
        importedBy,
        resolveCleanHistoryStartDate(
          existingCleanHistoryStartDate,
          newSummaries,
          PERFORMANCE_RUNTIME_LOGIC_VERSION,
        ),
      );
      const storagePath = await savePerformanceSummary({
        teamId,
        summary,
        importedBy,
        oldStoragePath,
        oldOverviewStoragePath,
        oldReportStoragePath,
        oldRouteStoragePaths,
        oldMonthlyStoragePaths,
        oldRouteMonthlyStoragePaths,
        oldLoadProfileMonthlyStoragePaths,
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
 * ingestResidentialGrowthReport
 *
 * POST endpoint for monthly Residential Growth Excel reports.
 * Mirrors the STREETS ingest pattern: Power Automate sends one attachment at a time.
 *
 * Query params:
 *   teamId=...
 *   period=YYYY-MM
 *   reportType=issued|occupied
 *
 * Body:
 *   raw .xlsx bytes, or JSON { fileBase64/contentBytes, fileName }
 */
export const ingestResidentialGrowthReport = onRequest(
  {
    secrets: [INGEST_API_KEY, MAPBOX_TOKEN],
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

    const teamId = (req.query.teamId as string) || DEFAULT_TEAM_ID;
    const period = req.query.period as string | undefined;
    const reportType = req.query.reportType as string | undefined;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      res.status(400).json({ error: 'Pass period=YYYY-MM.' });
      return;
    }
    if (reportType !== 'issued' && reportType !== 'occupied') {
      res.status(400).json({ error: 'Pass reportType=issued or reportType=occupied.' });
      return;
    }

    try {
      const { buffer, fileName } = decodeExcelRequestBody(req.body);
      if (buffer.length < 1000) {
        res.status(400).json({ error: 'No Excel data received or file is too small.' });
        return;
      }

      const parsePreview = reportType === 'issued'
        ? parseIssuanceListingBuffer(buffer)
        : parseOccupancyCertificateBuffer(buffer);
      if (parsePreview.records.length === 0) {
        res.status(400).json({ error: 'No usable residential growth records found.', warnings: parsePreview.warnings });
        return;
      }

      const rawStoragePath = `teams/${teamId}/residentialGrowth/pending/${period}/${reportType}-${Date.now()}.xlsx`;
      await getBucket().file(rawStoragePath).save(buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const pendingRef = getDb().doc(`teams/${teamId}/residentialGrowth/pending-${period}`);
      await pendingRef.set({
        period,
        [`${reportType}RawStoragePath`]: rawStoragePath,
        [`${reportType}FileName`]: fileName || `${reportType}-${period}.xlsx`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const pendingSnap = await pendingRef.get();
      const pending = pendingSnap.data() as {
        period: string;
        issuedRawStoragePath?: string;
        occupiedRawStoragePath?: string;
        issuedFileName?: string;
        occupiedFileName?: string;
      };

      const result = await processResidentialGrowthIfComplete({
        db: getDb(),
        bucket: getBucket(),
        teamId,
        period,
        pending,
        mapboxToken: normalizeMapboxToken(MAPBOX_TOKEN.value()),
      });

      if (!result.completed) {
        res.status(200).json({
          success: true,
          status: 'pending',
          teamId,
          period,
          received: reportType,
          waitingFor: reportType === 'issued' ? 'occupied' : 'issued',
          parsedRecords: parsePreview.records.length,
        });
        return;
      }

      res.status(200).json({
        success: true,
        status: 'complete',
        teamId,
        period,
        importId: result.importId,
        issuedCount: result.issuedCount,
        occupiedCount: result.occupiedCount,
        storagePath: result.storagePath,
        pdfStoragePath: result.pdfStoragePath,
        pdfDownloadUrl: result.signedPdfUrl,
      });
    } catch (err) {
      console.error('Residential Growth ingest failed:', err);
      res.status(500).json({
        error: 'Residential Growth ingest failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
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
    // Rebuilds replay archived CSVs and rewrites the full summary/overview/report payloads.
    // This needs the same headroom as daily ingest once history reaches many days.
    memory: '8GiB',
    cpu: 2,
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
      // One immutable capacity snapshot keeps every replayed day consistent.
      const loadCapacityConfig = await loadPerformanceLoadCapacityConfig(teamId);
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
          const summaries = enrichDailySummariesWithMissedTrips(
            aggregateDailySummaries(parsed.records, loadCapacityConfig),
          )
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
      if (shouldAbortPerformanceSummaryOverwrite(existing.storagePath, existing.summary)) {
        res.status(500).json({
          error: `The existing performance summary for team ${teamId} could not be read, so the rebuild was aborted to avoid overwriting it.`,
        });
        return;
      }
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
          mergeStoredPerformanceRuntimeMetadata(
            existing.summary?.metadata,
            existing.metadata,
          ).cleanHistoryStartDate,
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
        oldOverviewStoragePath: existing.metadata?.overviewStoragePath ?? null,
        oldReportStoragePath: existing.metadata?.reportStoragePath ?? null,
        oldRouteStoragePaths: existing.routeStoragePaths ?? null,
        oldMonthlyStoragePaths: existing.monthlyStoragePaths ?? null,
        oldRouteMonthlyStoragePaths: existing.routeMonthlyStoragePaths ?? null,
        oldLoadProfileMonthlyStoragePaths: existing.loadProfileMonthlyStoragePaths ?? null,
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
      const oldOverviewStoragePath = metadata.overviewStoragePath as string | undefined;
      const oldReportStoragePath = metadata.reportStoragePath as string | undefined;
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
      const newOverviewStoragePath = `teams/${teamId}/performanceData/${timestamp}-load-sanitize-backfill-overview.json`;
      const newReportStoragePath = `teams/${teamId}/performanceData/${timestamp}-load-sanitize-backfill-report.json`;
      await getBucket().file(newStoragePath).save(JSON.stringify(summary), {
        contentType: 'application/json',
      });
      await getBucket().file(newOverviewStoragePath).save(JSON.stringify(buildPerformanceOverviewSummary(summary)), {
        contentType: 'application/json',
      });
      await getBucket().file(newReportStoragePath).save(JSON.stringify(buildPerformanceReportSummary(summary)), {
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
        overviewStoragePath: newOverviewStoragePath,
        reportStoragePath: newReportStoragePath,
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
      if (deleteOld && oldOverviewStoragePath && oldOverviewStoragePath !== newOverviewStoragePath) {
        try {
          await getBucket().file(oldOverviewStoragePath).delete();
        } catch {
          // Non-fatal cleanup failure
        }
      }
      if (deleteOld && oldReportStoragePath && oldReportStoragePath !== newReportStoragePath) {
        try {
          await getBucket().file(oldReportStoragePath).delete();
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
