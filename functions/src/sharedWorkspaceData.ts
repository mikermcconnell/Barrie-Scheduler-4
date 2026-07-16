import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import type {
  DailySummary,
  LoadProfileMonthlyView,
  PerformanceDataLoadOptions,
  PerformanceDataSummary,
  PerformanceDetailMode,
  PerformanceMetadata,
} from './types';
import { PERFORMANCE_SCHEMA_VERSION } from './types';
import { filterPerformanceSummaryByRoute } from './performanceRouteFilter';
import {
  buildLoadProfilePeakTrips,
  hydrateLoadProfileMonthlyViews,
  isLoadProfileMonthlyView,
} from './performanceLoadProfileView';

type SharedWorkspace =
  | 'transitAppMetadata'
  | 'transitAppData'
  | 'performanceMetadata'
  | 'performanceOverview'
  | 'performanceData';

type DataSourceKind = 'transitApp' | 'performance';

interface SharedWorkspacePayload {
  workspace?: SharedWorkspace;
  requestingTeamId?: string;
  sourceTeamId?: string;
  routeId?: string | null;
  dateRange?: { start: string; end: string };
  detailMode?: PerformanceDetailMode;
}

function getDb() {
  return admin.firestore();
}

function getBucket() {
  return admin.storage().bucket();
}

function setCors(res: any) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function readPayload(body: unknown): SharedWorkspacePayload {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as SharedWorkspacePayload;
    } catch {
      return {};
    }
  }
  return (body && typeof body === 'object' ? body : {}) as SharedWorkspacePayload;
}

function isWorkspace(value: unknown): value is SharedWorkspace {
  return [
    'transitAppMetadata',
    'transitAppData',
    'performanceMetadata',
    'performanceOverview',
    'performanceData',
  ].includes(String(value));
}

function dataSourceKindForWorkspace(workspace: SharedWorkspace): DataSourceKind {
  return workspace.startsWith('transitApp') ? 'transitApp' : 'performance';
}

async function verifyBearerToken(authHeader: unknown): Promise<admin.auth.DecodedIdToken | null> {
  if (Array.isArray(authHeader) || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;
  return admin.auth().verifyIdToken(idToken);
}

async function assertCanReadSharedSource(
  uid: string,
  requestingTeamId: string,
  sourceTeamId: string,
  kind: DataSourceKind,
  decoded: admin.auth.DecodedIdToken,
): Promise<admin.firestore.DocumentData | null> {
  const isSchedulerAdmin = decoded.schedulerAdmin === true;
  const memberSnap = await getDb().doc(`teams/${requestingTeamId}/members/${uid}`).get();
  if (!memberSnap.exists && !isSchedulerAdmin) {
    throw Object.assign(new Error('User is not a member of the requesting team.'), { status: 403 });
  }

  if (requestingTeamId === sourceTeamId) return memberSnap.exists ? memberSnap.data() ?? null : null;

  const teamSnap = await getDb().doc(`teams/${requestingTeamId}`).get();
  if (!teamSnap.exists) {
    throw Object.assign(new Error('Requesting team was not found.'), { status: 404 });
  }

  const dataSourceTeamIds = teamSnap.data()?.dataSourceTeamIds;
  if (!dataSourceTeamIds || dataSourceTeamIds[kind] !== sourceTeamId) {
    throw Object.assign(new Error('This team is not configured to read that shared data source.'), { status: 403 });
  }
  return memberSnap.exists ? memberSnap.data() ?? null : null;
}

export function canReadOperatorDwell(
  member: admin.firestore.DocumentData | null,
  decoded: admin.auth.DecodedIdToken,
): boolean {
  if (decoded.schedulerAdmin === true) return true;
  if (!member) return false;
  const override = member.workspaceOverrides?.operationsOperatorDwell;
  if (typeof override === 'boolean') return override;
  const accessLevel = typeof member.accessLevel === 'string'
    ? member.accessLevel
    : (member.role === 'owner' || member.role === 'admin' ? 'internal' : 'planner');
  return accessLevel === 'admin' || accessLevel === 'internal';
}

export function canReadLoadProfiles(
  member: admin.firestore.DocumentData | null,
  decoded: admin.auth.DecodedIdToken,
): boolean {
  if (decoded.schedulerAdmin === true) return true;
  if (!member) return false;
  const accessLevel = typeof member.accessLevel === 'string'
    ? member.accessLevel
    : (member.role === 'owner' || member.role === 'admin' ? 'internal' : 'planner');
  const operationsOverride = member.workspaceOverrides?.workspaceOperations;
  const loadProfilesOverride = member.workspaceOverrides?.operationsLoadProfiles;
  const operationsAllowed = typeof operationsOverride === 'boolean'
    ? operationsOverride
    : ['production', 'planner', 'admin', 'internal'].includes(accessLevel);
  const loadProfilesAllowed = typeof loadProfilesOverride === 'boolean'
    ? loadProfilesOverride
    : accessLevel === 'admin' || accessLevel === 'internal';
  return operationsAllowed && loadProfilesAllowed;
}

async function assertCanReadLoadProfiles(
  uid: string,
  requestingTeamId: string,
  member: admin.firestore.DocumentData | null,
  decoded: admin.auth.DecodedIdToken,
): Promise<void> {
  if (decoded.schedulerAdmin !== true) {
    if (!canReadLoadProfiles(member, decoded)) {
      throw Object.assign(new Error('Load Profiles access is required.'), { status: 403 });
    }
    return;
  }

  if (member) return;
  const supportSnap = await getDb().doc(`developerSupportSessions/${uid}`).get();
  const support = supportSnap.data();
  const expiresAtMs = support?.expiresAt?.toMillis?.();
  if (!supportSnap.exists
      || support?.teamId !== requestingTeamId
      || (support?.mode !== 'inspect' && support?.mode !== 'edit')
      || typeof expiresAtMs !== 'number'
      || expiresAtMs <= Date.now()) {
    throw Object.assign(new Error('An active support session for this team is required.'), { status: 403 });
  }
}

export function redactOperatorDwellEvidence(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const summary = value as PerformanceDataSummary;
  if (!Array.isArray(summary.dailySummaries)) return value;
  return {
    ...summary,
    dailySummaries: summary.dailySummaries.map(day => {
      const { byOperatorDwell: _operatorDwell, byCascade: _cascade, ...redactedDay } = day;
      return redactedDay;
    }),
  };
}

function timestampToIso(value: any): string {
  return value?.toDate?.()?.toISOString?.() || new Date().toISOString();
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && !!entry[1]
    )),
  );
}

function readNestedStringRecord(value: unknown): Record<string, Record<string, string>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, nested]) => [key, readStringRecord(nested)] as const)
    .filter((entry): entry is readonly [string, Record<string, string>] => !!entry[1] && Object.keys(entry[1]).length > 0);
  return Object.fromEntries(entries);
}

function normalizePerformanceMetadata(data: admin.firestore.DocumentData): PerformanceMetadata {
  return {
    importedAt: timestampToIso(data.importedAt),
    importedBy: data.importedBy || '',
    dateRange: data.dateRange || { start: '', end: '' },
    dayCount: data.dayCount || 0,
    totalRecords: data.totalRecords || 0,
    runtimeLogicVersion: typeof data.runtimeLogicVersion === 'number' ? data.runtimeLogicVersion : undefined,
    cleanHistoryStartDate: typeof data.cleanHistoryStartDate === 'string' ? data.cleanHistoryStartDate : undefined,
    storageMode: data.storageMode === 'monthly' ? 'monthly' : (data.storageMode === 'monolithic' ? 'monolithic' : undefined),
    storagePath: data.storagePath || '',
    overviewStoragePath: data.overviewStoragePath || '',
    reportStoragePath: data.reportStoragePath || '',
    routeStoragePaths: readStringRecord(data.routeStoragePaths),
    monthlyStoragePaths: readStringRecord(data.monthlyStoragePaths),
    routeMonthlyStoragePaths: readNestedStringRecord(data.routeMonthlyStoragePaths),
    loadProfileMonthlyStoragePaths: readStringRecord(data.loadProfileMonthlyStoragePaths),
  };
}

function mergePerformanceMetadata(summary: PerformanceDataSummary, metadata: PerformanceMetadata): PerformanceDataSummary {
  return {
    ...summary,
    metadata: {
      ...summary.metadata,
      ...metadata,
    },
  };
}

function isPerformanceDetailMode(value: unknown): value is PerformanceDetailMode {
  return ['all', 'overview', 'otp', 'ridership', 'load-profiles', 'operator-dwell'].includes(String(value));
}

function isDateRange(value: unknown): value is { start: string; end: string } {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { start?: unknown }).start === 'string'
    && typeof (value as { end?: unknown }).end === 'string';
}

function isStrictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertValidLoadProfilesRequest(payload: SharedWorkspacePayload): void {
  if (payload.routeId !== undefined && payload.routeId !== null) {
    if (typeof payload.routeId !== 'string'
        || !/^(all|[A-Za-z0-9][A-Za-z0-9 ._/-]{0,31})$/.test(payload.routeId)) {
      throw Object.assign(new Error('Load Profiles route is invalid.'), { status: 400 });
    }
  }

  if (payload.dateRange === undefined) {
    throw Object.assign(new Error('Load Profiles requires a bounded date range.'), { status: 400 });
  }
  if (!isDateRange(payload.dateRange)
      || !isStrictDate(payload.dateRange.start)
      || !isStrictDate(payload.dateRange.end)
      || payload.dateRange.start > payload.dateRange.end) {
    throw Object.assign(new Error('Load Profiles dates must be a valid start and end date.'), { status: 400 });
  }
  const startMs = Date.parse(`${payload.dateRange.start}T00:00:00.000Z`);
  const endMs = Date.parse(`${payload.dateRange.end}T00:00:00.000Z`);
  const inclusiveDays = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (inclusiveDays > 120) {
    throw Object.assign(new Error('Load Profiles date ranges cannot exceed 120 days.'), { status: 400 });
  }
}

function dateInRange(date: string, range?: { start: string; end: string }): boolean {
  if (!range?.start || !range?.end) return true;
  return date >= range.start && date <= range.end;
}

function monthOverlapsRange(month: string, range?: { start: string; end: string }): boolean {
  if (!range?.start || !range?.end) return true;
  const startMonth = range.start.slice(0, 7);
  const endMonth = range.end.slice(0, 7);
  return month >= startMonth && month <= endMonth;
}

function trimMissedTrips(day: DailySummary, keepTripDetails: boolean): DailySummary['missedTrips'] {
  return day.missedTrips
    ? {
      ...day.missedTrips,
      trips: keepTripDetails ? (day.missedTrips.trips || []) : [],
    }
    : day.missedTrips;
}

export function trimDayForDetailMode(day: DailySummary, mode: PerformanceDetailMode = 'all'): DailySummary {
  if (mode === 'all') return day;

  const base: DailySummary = {
    ...day,
    byStop: [],
    byTrip: [],
    loadProfilePeakTrips: undefined,
    loadProfiles: [],
    ridershipHeatmaps: undefined,
    byOperatorDwell: undefined,
    byCascade: undefined,
    segmentRuntimes: undefined,
    stopSegmentRuntimes: undefined,
    tripStopSegmentRuntimes: undefined,
    routeStopDeviations: undefined,
    byRouteHour: undefined,
  };

  switch (mode) {
    case 'overview':
      return { ...base, byTrip: day.byTrip, missedTrips: trimMissedTrips(day, false) };
    case 'otp':
      return {
        ...base,
        byTrip: day.byTrip,
        routeStopDeviations: day.routeStopDeviations,
        byRouteHour: day.byRouteHour,
        missedTrips: trimMissedTrips(day, true),
      };
    case 'ridership':
      return {
        ...base,
        byStop: day.byStop,
        loadProfiles: day.loadProfiles,
        ridershipHeatmaps: day.ridershipHeatmaps,
        byRouteHour: day.byRouteHour,
        missedTrips: trimMissedTrips(day, false),
      };
    case 'load-profiles':
      return {
        ...base,
        loadProfilePeakTrips: day.loadProfilePeakTrips ?? buildLoadProfilePeakTrips(day.byTrip),
        loadProfiles: day.loadProfiles,
        runtimePatterns: undefined,
        missedTrips: trimMissedTrips(day, false),
      };
    case 'operator-dwell':
      return {
        ...base,
        byOperatorDwell: day.byOperatorDwell,
        byCascade: day.byCascade,
        missedTrips: trimMissedTrips(day, false),
      };
    default:
      return day;
  }
}

function applyPerformanceLoadOptions(
  summary: PerformanceDataSummary,
  options?: PerformanceDataLoadOptions,
): PerformanceDataSummary {
  const mode = options?.detailMode ?? 'all';
  const days = summary.dailySummaries
    .filter(day => dateInRange(day.date, options?.dateRange))
    .map(day => trimDayForDetailMode(day, mode));

  return buildSummaryFromDays(summary, days, {
    ...summary.metadata,
    dateRange: days.length > 0
      ? { start: days[0].date, end: days[days.length - 1].date }
      : (options?.dateRange ?? summary.metadata.dateRange),
    dayCount: days.length,
  });
}

async function readStorageJson<T>(path: string): Promise<T | null> {
  if (!path) return null;
  const [buf] = await getBucket().file(path).download();
  return JSON.parse(buf.toString('utf8')) as T;
}

async function getTransitAppMetadata(sourceTeamId: string) {
  const snap = await getDb().doc(`teams/${sourceTeamId}/transitAppData/default`).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    importedAt: timestampToIso(data.importedAt),
    importedBy: data.importedBy || '',
    storagePath: data.storagePath || '',
    dateRange: data.dateRange || { start: '', end: '' },
    fileStats: {
      totalFiles: data.fileStats?.totalFiles || 0,
      rowsParsed: data.fileStats?.rowsParsed || 0,
    },
  };
}

async function getPerformanceMetadata(sourceTeamId: string): Promise<PerformanceMetadata | null> {
  const snap = await getDb().doc(`teams/${sourceTeamId}/performanceData/metadata`).get();
  return snap.exists ? normalizePerformanceMetadata(snap.data() || {}) : null;
}

function buildSummaryFromDays(
  base: PerformanceDataSummary,
  dailySummaries: PerformanceDataSummary['dailySummaries'],
  metadata: PerformanceMetadata,
): PerformanceDataSummary {
  const sortedDays = [...dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
  const dates = sortedDays.map(day => day.date);
  return {
    ...base,
    dailySummaries: sortedDays,
    metadata: {
      ...base.metadata,
      ...metadata,
      dateRange: dates.length > 0
        ? { start: dates[0], end: dates[dates.length - 1] }
        : metadata.dateRange,
      dayCount: sortedDays.length,
      totalRecords: sortedDays.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0),
    },
  };
}

async function loadMonthlyPerformanceSummary(
  metadata: PerformanceMetadata,
  routeId?: string | null,
  options?: PerformanceDataLoadOptions,
): Promise<PerformanceDataSummary | null> {
  const selectedRoutePaths = routeId && routeId !== 'all'
    ? metadata.routeMonthlyStoragePaths?.[routeId]
    : undefined;
  const paths = selectedRoutePaths || metadata.monthlyStoragePaths;
  if (!paths || Object.keys(paths).length === 0) return null;

  const months = Object.keys(paths)
    .filter(month => monthOverlapsRange(month, options?.dateRange))
    .sort();
  if (months.length === 0) return null;

  const monthSummaries = await Promise.all(
    months.map(month => readStorageJson<PerformanceDataSummary>(paths[month])),
  );
  const dailySummaries = monthSummaries.flatMap(summary => summary?.dailySummaries || []);
  if (dailySummaries.length === 0) return null;

  const base = monthSummaries.find((summary): summary is PerformanceDataSummary => !!summary);
  return applyPerformanceLoadOptions(
    buildSummaryFromDays(
      base || { dailySummaries: [], metadata, schemaVersion: PERFORMANCE_SCHEMA_VERSION },
      dailySummaries,
      metadata,
    ),
    options,
  );
}

function routeMatches(routeId: string | undefined, selectedRouteId: string): boolean {
  const normalizedRouteId = (routeId || '').trim().toUpperCase();
  const normalizedSelectedRouteId = selectedRouteId.trim().toUpperCase();
  if (normalizedRouteId === normalizedSelectedRouteId) return true;
  const match = normalizedRouteId.match(/^(2|7|12)[AB]$/);
  return !!match && match[1] === normalizedSelectedRouteId;
}

async function loadLoadProfileMonthlyView(
  sourceTeamId: string,
  metadata: PerformanceMetadata,
  routeId?: string | null,
  options?: PerformanceDataLoadOptions,
): Promise<PerformanceDataSummary | null> {
  const paths = metadata.loadProfileMonthlyStoragePaths;
  if (!paths || Object.keys(paths).length === 0) return null;

  const months = Object.keys(paths)
    .filter(month => monthOverlapsRange(month, options?.dateRange))
    .sort();
  if (months.length === 0) {
    return hydrateLoadProfileMonthlyViews([], {
      ...metadata,
      dateRange: options?.dateRange ?? metadata.dateRange,
      dayCount: 0,
      totalRecords: 0,
    });
  }

  const expectedPrefix = `teams/${sourceTeamId}/performanceViews/load-profiles/`;
  for (const month of months) {
    const path = paths[month];
    if (!/^\d{4}-\d{2}$/.test(month)
        || !path.startsWith(expectedPrefix)
        || !/^\d+-\d{4}-\d{2}\.json$/.test(path.slice(expectedPrefix.length))) {
      throw new Error('Stored Load Profiles view path is invalid.');
    }
  }

  const downloaded = await Promise.all(
    months.map(async month => ({
      month,
      view: await readStorageJson<unknown>(paths[month]),
    })),
  );
  if (downloaded.some(({ month, view }) => !isLoadProfileMonthlyView(view) || view.month !== month)) {
    throw new Error('Stored Load Profiles view has an unsupported or invalid schema.');
  }

  const selectedRouteId = routeId && routeId !== 'all' ? routeId : null;
  const views = downloaded.map(({ view }) => ({
    ...(view as LoadProfileMonthlyView),
    dailySummaries: (view as LoadProfileMonthlyView).dailySummaries
      .filter(day => dateInRange(day.date, options?.dateRange))
      .map(day => ({
        ...day,
        loadProfiles: selectedRouteId
          ? day.loadProfiles.filter(profile => routeMatches(profile.routeId, selectedRouteId))
          : day.loadProfiles,
        loadProfilePeakTrips: selectedRouteId
          ? day.loadProfilePeakTrips.filter(trip => routeMatches(trip.routeId, selectedRouteId))
          : day.loadProfilePeakTrips,
      })),
  }));
  return hydrateLoadProfileMonthlyViews(views, metadata);
}

async function getPerformanceData(
  sourceTeamId: string,
  routeId?: string | null,
  options?: PerformanceDataLoadOptions,
): Promise<PerformanceDataSummary | null> {
  const metadata = await getPerformanceMetadata(sourceTeamId);
  if (!metadata) return null;

  if (options?.detailMode === 'load-profiles'
      && metadata.loadProfileMonthlyStoragePaths
      && Object.keys(metadata.loadProfileMonthlyStoragePaths).length > 0) {
    return loadLoadProfileMonthlyView(sourceTeamId, metadata, routeId, options);
  }

  const monthlySummary = metadata.monthlyStoragePaths
    ? await loadMonthlyPerformanceSummary(metadata, routeId, options)
    : null;
  if (monthlySummary) {
    return filterPerformanceSummaryByRoute(mergePerformanceMetadata(monthlySummary, metadata), routeId);
  }

  const selectedRoutePath = routeId && routeId !== 'all'
    ? metadata.routeStoragePaths?.[routeId]
    : undefined;
  const storagePath = selectedRoutePath || metadata.storagePath;
  const summary = await readStorageJson<PerformanceDataSummary>(storagePath || '');
  return summary
    ? filterPerformanceSummaryByRoute(applyPerformanceLoadOptions(mergePerformanceMetadata(summary, metadata), options), routeId)
    : null;
}

async function loadWorkspaceData(payload: Required<Pick<SharedWorkspacePayload, 'workspace' | 'sourceTeamId'>> & SharedWorkspacePayload) {
  switch (payload.workspace) {
    case 'transitAppMetadata':
      return getTransitAppMetadata(payload.sourceTeamId);
    case 'transitAppData': {
      const metadata = await getTransitAppMetadata(payload.sourceTeamId);
      return metadata?.storagePath ? readStorageJson(metadata.storagePath) : null;
    }
    case 'performanceMetadata':
      return getPerformanceMetadata(payload.sourceTeamId);
    case 'performanceOverview': {
      const metadata = await getPerformanceMetadata(payload.sourceTeamId);
      if (!metadata) return null;
      if (metadata.overviewStoragePath) {
        const summary = await readStorageJson<PerformanceDataSummary>(metadata.overviewStoragePath);
        return summary ? mergePerformanceMetadata(summary, metadata) : null;
      }
      return getPerformanceData(payload.sourceTeamId);
    }
    case 'performanceData':
      return getPerformanceData(payload.sourceTeamId, payload.routeId, {
        dateRange: isDateRange(payload.dateRange) ? payload.dateRange : undefined,
        detailMode: isPerformanceDetailMode(payload.detailMode) ? payload.detailMode : 'all',
      });
    default:
      return null;
  }
}

export const sharedWorkspaceData = onRequest(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 120, maxInstances: 10 },
  async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      const decoded = await verifyBearerToken(req.headers.authorization);
      if (!decoded) {
        res.status(401).json({ error: 'Sign in is required.' });
        return;
      }

      const payload = readPayload(req.body);
      if (!isWorkspace(payload.workspace) || !payload.requestingTeamId || !payload.sourceTeamId) {
        res.status(400).json({ error: 'Missing or invalid shared workspace request.' });
        return;
      }

      const requestingMember = await assertCanReadSharedSource(
        decoded.uid,
        payload.requestingTeamId,
        payload.sourceTeamId,
        dataSourceKindForWorkspace(payload.workspace),
        decoded,
      );
      const operatorDwellAllowed = canReadOperatorDwell(requestingMember, decoded);
      const operatorDwellRequested = payload.workspace === 'performanceData'
        && payload.detailMode === 'operator-dwell';
      if (operatorDwellRequested && !operatorDwellAllowed) {
        throw Object.assign(new Error('Dwell Incident Review access is required.'), { status: 403 });
      }
      const loadProfilesRequested = payload.workspace === 'performanceData'
        && payload.detailMode === 'load-profiles';
      if (loadProfilesRequested) {
        assertValidLoadProfilesRequest(payload);
        await assertCanReadLoadProfiles(
          decoded.uid,
          payload.requestingTeamId,
          requestingMember,
          decoded,
        );
      }

      const loadedData = await loadWorkspaceData({
        workspace: payload.workspace,
        requestingTeamId: payload.requestingTeamId,
        sourceTeamId: payload.sourceTeamId,
        routeId: typeof payload.routeId === 'string' ? payload.routeId : null,
        dateRange: payload.dateRange,
        detailMode: payload.detailMode,
      });
      const data = payload.workspace.startsWith('performance') && !operatorDwellAllowed
        ? redactOperatorDwellEvidence(loadedData)
        : loadedData;

      if (!data) {
        res.status(404).json({ data: null });
        return;
      }

      res.status(200).json({ data });
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500;
      console.error('Shared workspace data request failed:', error);
      res.status(status).json({
        error: status === 500 ? 'Failed to load shared workspace data.' : (error as Error).message,
      });
    }
  },
);
