import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import type { PerformanceDataSummary, PerformanceMetadata } from './types';
import { filterPerformanceSummaryByRoute } from './performanceRouteFilter';

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
) {
  const isSchedulerAdmin = decoded.schedulerAdmin === true;
  const memberSnap = await getDb().doc(`teams/${requestingTeamId}/members/${uid}`).get();
  if (!memberSnap.exists && !isSchedulerAdmin) {
    throw Object.assign(new Error('User is not a member of the requesting team.'), { status: 403 });
  }

  if (requestingTeamId === sourceTeamId) return;

  const teamSnap = await getDb().doc(`teams/${requestingTeamId}`).get();
  if (!teamSnap.exists) {
    throw Object.assign(new Error('Requesting team was not found.'), { status: 404 });
  }

  const dataSourceTeamIds = teamSnap.data()?.dataSourceTeamIds;
  if (!dataSourceTeamIds || dataSourceTeamIds[kind] !== sourceTeamId) {
    throw Object.assign(new Error('This team is not configured to read that shared data source.'), { status: 403 });
  }
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
): Promise<PerformanceDataSummary | null> {
  const selectedRoutePaths = routeId && routeId !== 'all'
    ? metadata.routeMonthlyStoragePaths?.[routeId]
    : undefined;
  const paths = selectedRoutePaths || metadata.monthlyStoragePaths;
  if (!paths || Object.keys(paths).length === 0) return null;

  const monthSummaries = await Promise.all(
    Object.keys(paths).sort().map(month => readStorageJson<PerformanceDataSummary>(paths[month])),
  );
  const dailySummaries = monthSummaries.flatMap(summary => summary?.dailySummaries || []);
  if (dailySummaries.length === 0) return null;

  const base = monthSummaries.find((summary): summary is PerformanceDataSummary => !!summary);
  return buildSummaryFromDays(base || { dailySummaries: [], metadata, schemaVersion: 9 }, dailySummaries, metadata);
}

async function getPerformanceData(
  sourceTeamId: string,
  routeId?: string | null,
): Promise<PerformanceDataSummary | null> {
  const metadata = await getPerformanceMetadata(sourceTeamId);
  if (!metadata) return null;

  const monthlySummary = metadata.monthlyStoragePaths
    ? await loadMonthlyPerformanceSummary(metadata, routeId)
    : null;
  if (monthlySummary) {
    return filterPerformanceSummaryByRoute(mergePerformanceMetadata(monthlySummary, metadata), routeId);
  }

  const selectedRoutePath = routeId && routeId !== 'all'
    ? metadata.routeStoragePaths?.[routeId]
    : undefined;
  const storagePath = selectedRoutePath || metadata.storagePath;
  const summary = await readStorageJson<PerformanceDataSummary>(storagePath || '');
  return summary ? filterPerformanceSummaryByRoute(mergePerformanceMetadata(summary, metadata), routeId) : null;
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
      return getPerformanceData(payload.sourceTeamId, payload.routeId);
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

      await assertCanReadSharedSource(
        decoded.uid,
        payload.requestingTeamId,
        payload.sourceTeamId,
        dataSourceKindForWorkspace(payload.workspace),
        decoded,
      );

      const data = await loadWorkspaceData({
        workspace: payload.workspace,
        requestingTeamId: payload.requestingTeamId,
        sourceTeamId: payload.sourceTeamId,
        routeId: typeof payload.routeId === 'string' ? payload.routeId : null,
      });

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
