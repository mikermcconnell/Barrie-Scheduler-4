/**
 * Performance Data Service
 *
 * Firebase CRUD for team-scoped STREETS performance data.
 * Firestore: teams/{teamId}/performanceData/metadata  (metadata)
 * Storage:   teams/{teamId}/performanceData/{timestamp}.json  (full summary)
 */

import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    serverTimestamp,
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    deleteObject,
    getBytes,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { requestSharedWorkspaceData } from './sharedWorkspaceDataClient';
import {
    PERFORMANCE_SCHEMA_VERSION,
    type DailySummary,
    type PerformanceDataLoadOptions,
    type PerformanceDataSummary,
    type PerformanceDetailMode,
    type PerformanceMetadata,
} from './performanceDataTypes';
import {
    buildLoadProfilePeakTrips,
    buildMonthlyLoadProfileViews,
} from './performanceLoadProfileView';
import { aggregateMonthlySnapshots } from './performanceDataAggregator';
import { buildPerformanceOverviewSummary, buildPerformanceReportSummary } from './performanceOverviewSummary';
import { saveMonthlySnapshots } from './performanceSnapshotService';
import { filterPerformanceSummaryByRoute, getAvailablePerformanceRoutes } from './performanceRouteFilter';

// ============ HELPERS ============

const PERFORMANCE_DOWNLOAD_CONCURRENCY = 4;

function getMetadataRef(teamId: string) {
    return doc(db, 'teams', teamId, 'performanceData', 'metadata');
}

function getStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}.json`;
}

function getOverviewStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}-overview.json`;
}

function getReportStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}-report.json`;
}

function getRouteStoragePath(teamId: string, timestamp: string, routeId: string) {
    return `teams/${teamId}/performanceData/${timestamp}-route-${encodeURIComponent(routeId)}.json`;
}

function getMonthlyStoragePath(teamId: string, timestamp: string, month: string) {
    return `teams/${teamId}/performanceData/months/${timestamp}-${month}.json`;
}

function getRouteMonthlyStoragePath(teamId: string, timestamp: string, routeId: string, month: string) {
    return `teams/${teamId}/performanceData/months/${timestamp}-route-${encodeURIComponent(routeId)}-${month}.json`;
}

function getLoadProfileMonthlyStoragePath(teamId: string, timestamp: string, month: string) {
    return `teams/${teamId}/performanceViews/load-profiles/${timestamp}-${month}.json`;
}

function getSummaryMonth(day: { date?: string }): string {
    return typeof day.date === 'string' ? day.date.slice(0, 7) : 'unknown';
}

function buildSummaryFromDays(
    base: PerformanceDataSummary,
    dailySummaries: PerformanceDataSummary['dailySummaries'],
    metadataPatch: Partial<PerformanceMetadata> = {},
): PerformanceDataSummary {
    const sortedDays = [...dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
    const dates = sortedDays.map(day => day.date);
    return {
        ...base,
        dailySummaries: sortedDays,
        metadata: {
            ...base.metadata,
            dateRange: dates.length > 0
                ? { start: dates[0], end: dates[dates.length - 1] }
                : base.metadata.dateRange,
            dayCount: sortedDays.length,
            totalRecords: sortedDays.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0),
            ...metadataPatch,
        },
    };
}

function buildMonthlySummaries(summary: PerformanceDataSummary): Map<string, PerformanceDataSummary> {
    const byMonth = new Map<string, PerformanceDataSummary['dailySummaries']>();
    for (const day of summary.dailySummaries) {
        const month = getSummaryMonth(day);
        byMonth.set(month, [...(byMonth.get(month) || []), day]);
    }

    const result = new Map<string, PerformanceDataSummary>();
    for (const [month, days] of byMonth) {
        result.set(month, buildSummaryFromDays(summary, days));
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined;
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1])
    );
}

function readNestedStringRecord(value: unknown): Record<string, Record<string, string>> | undefined {
    if (!isRecord(value)) return undefined;
    const entries = Object.entries(value)
        .map(([key, nested]) => [key, readStringRecord(nested)] as const)
        .filter((entry): entry is readonly [string, Record<string, string>] => !!entry[1] && Object.keys(entry[1]).length > 0);
    return Object.fromEntries(entries);
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
            return {
                ...base,
                byTrip: day.byTrip,
                missedTrips: trimMissedTrips(day, false),
            };
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
                loadProfilePeakTrips: day.loadProfilePeakTrips ?? buildLoadProfilePeakTrips(day),
                loadProfiles: day.loadProfiles,
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

export async function mapWithConcurrency<T>(
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

async function downloadStorageJson<T>(storagePath: string): Promise<T | null> {
    const bytes = await getBytes(ref(storage, storagePath));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
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
    const monthSummaries: Array<PerformanceDataSummary | null> = new Array(months.length).fill(null);
    await mapWithConcurrency(
        months.map((month, index) => ({ month, index })),
        PERFORMANCE_DOWNLOAD_CONCURRENCY,
        async ({ month, index }) => {
            monthSummaries[index] = await downloadStorageJson<PerformanceDataSummary>(paths[month]);
        },
    );
    const dailySummaries = monthSummaries.flatMap(summary => summary?.dailySummaries || []);
    if (dailySummaries.length === 0) return null;

    const base = monthSummaries.find((summary): summary is PerformanceDataSummary => !!summary) || {
        dailySummaries: [],
        metadata,
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    };
    return applyPerformanceLoadOptions(buildSummaryFromDays(base, dailySummaries, metadata), options);
}

function alignLoadProfilePeakTrips(summary: PerformanceDataSummary): PerformanceDataSummary {
    return {
        ...summary,
        dailySummaries: summary.dailySummaries.map(day => ({
            ...day,
            loadProfilePeakTrips: buildLoadProfilePeakTrips(day),
        })),
    };
}

export function buildStorageJsonUploadData(value: unknown): Blob | Uint8Array {
    const json = JSON.stringify(value);
    if (typeof Blob !== 'undefined') {
        return new Blob([json], { type: 'application/json' });
    }
    return new TextEncoder().encode(json);
}

export function getTotalRecordsForSummary(summary: PerformanceDataSummary): number {
    return summary.dailySummaries.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0);
}

export function resolveMergedCleanHistoryStartDate(
    incomingStartDate: string | undefined,
    existingStartDate: string | undefined,
): string | undefined {
    if (incomingStartDate && existingStartDate) {
        return incomingStartDate <= existingStartDate ? incomingStartDate : existingStartDate;
    }
    return incomingStartDate ?? existingStartDate;
}

export function mergePerformanceSummaryMetadata(
    summary: PerformanceDataSummary,
    metadata: PerformanceMetadata
): PerformanceDataSummary {
    return {
        ...summary,
        metadata: {
            ...summary.metadata,
            importedAt: metadata.importedAt || summary.metadata.importedAt,
            importedBy: metadata.importedBy || summary.metadata.importedBy,
            dateRange: metadata.dateRange || summary.metadata.dateRange,
            dayCount: metadata.dayCount || summary.metadata.dayCount,
            totalRecords: metadata.totalRecords || summary.metadata.totalRecords,
            runtimeLogicVersion: metadata.runtimeLogicVersion ?? summary.metadata.runtimeLogicVersion,
            cleanHistoryStartDate: metadata.cleanHistoryStartDate ?? summary.metadata.cleanHistoryStartDate,
            storageMode: metadata.storageMode || summary.metadata.storageMode,
            storagePath: metadata.storagePath || summary.metadata.storagePath,
            overviewStoragePath: metadata.overviewStoragePath || summary.metadata.overviewStoragePath,
            reportStoragePath: metadata.reportStoragePath || summary.metadata.reportStoragePath,
            routeStoragePaths: metadata.routeStoragePaths || summary.metadata.routeStoragePaths,
            monthlyStoragePaths: metadata.monthlyStoragePaths || summary.metadata.monthlyStoragePaths,
            routeMonthlyStoragePaths: metadata.routeMonthlyStoragePaths || summary.metadata.routeMonthlyStoragePaths,
            loadProfileMonthlyStoragePaths: metadata.loadProfileMonthlyStoragePaths
                || summary.metadata.loadProfileMonthlyStoragePaths,
        },
    };
}

export function mergePerformanceOverviewMetadata(
    summary: PerformanceDataSummary,
    metadata: PerformanceMetadata,
): PerformanceDataSummary {
    return {
        ...summary,
        metadata: {
            ...summary.metadata,
            importedAt: metadata.importedAt || summary.metadata.importedAt,
            importedBy: metadata.importedBy || summary.metadata.importedBy,
            runtimeLogicVersion: metadata.runtimeLogicVersion ?? summary.metadata.runtimeLogicVersion,
            cleanHistoryStartDate: metadata.cleanHistoryStartDate ?? summary.metadata.cleanHistoryStartDate,
            storageMode: metadata.storageMode || summary.metadata.storageMode,
            storagePath: metadata.storagePath || summary.metadata.storagePath,
            overviewStoragePath: metadata.overviewStoragePath || summary.metadata.overviewStoragePath,
            reportStoragePath: metadata.reportStoragePath || summary.metadata.reportStoragePath,
            routeStoragePaths: metadata.routeStoragePaths || summary.metadata.routeStoragePaths,
            monthlyStoragePaths: metadata.monthlyStoragePaths || summary.metadata.monthlyStoragePaths,
            routeMonthlyStoragePaths: metadata.routeMonthlyStoragePaths || summary.metadata.routeMonthlyStoragePaths,
            loadProfileMonthlyStoragePaths: metadata.loadProfileMonthlyStoragePaths
                || summary.metadata.loadProfileMonthlyStoragePaths,
        },
    };
}

// ============ SAVE ============

export async function savePerformanceData(
    teamId: string,
    userId: string,
    summary: PerformanceDataSummary
): Promise<void> {
    const timestamp = Date.now().toString();
    const overviewStoragePath = getOverviewStoragePath(teamId, timestamp);
    const reportStoragePath = getReportStoragePath(teamId, timestamp);
    const metadataRef = getMetadataRef(teamId);

    // Merge with existing data — new days replace old, existing days are kept.
    let merged = summary;
    const existing = await getDoc(metadataRef);
    const existingMetadata = existing.exists() ? await getPerformanceMetadata(teamId) : null;
    const oldPath = existingMetadata?.storagePath || null;
    const oldOverviewPath = existingMetadata?.overviewStoragePath || null;
    const oldReportPath = existingMetadata?.reportStoragePath || null;
    const oldRouteStoragePaths = existingMetadata?.routeStoragePaths || {};
    const oldMonthlyStoragePaths = existingMetadata?.monthlyStoragePaths || {};
    const oldRouteMonthlyStoragePaths = existingMetadata?.routeMonthlyStoragePaths || {};
    const oldLoadProfileMonthlyStoragePaths = existingMetadata?.loadProfileMonthlyStoragePaths || {};

    if (existingMetadata) {
        try {
            const oldSummary = await getPerformanceData(teamId, existingMetadata);
            if (oldSummary) {
                // Snapshot old data before overwriting — best-effort.
                try {
                    const snapshots = aggregateMonthlySnapshots(oldSummary.dailySummaries);
                    if (snapshots.length > 0) {
                        await saveMonthlySnapshots(teamId, snapshots);
                    }
                } catch (snapshotErr) {
                    console.error('Snapshot archive failed (non-blocking):', snapshotErr);
                }

                const newDates = new Set(summary.dailySummaries.map(d => d.date));
                const kept = oldSummary.dailySummaries.filter(d => !newDates.has(d.date));
                const allDays = [...kept, ...summary.dailySummaries]
                    .sort((a, b) => a.date.localeCompare(b.date));

                const dates = allDays.map(d => d.date);
                merged = {
                    dailySummaries: allDays,
                    metadata: {
                        importedAt: new Date().toISOString(),
                        importedBy: userId,
                        dateRange: { start: dates[0], end: dates[dates.length - 1] },
                        dayCount: allDays.length,
                        totalRecords: getTotalRecordsForSummary({ ...summary, dailySummaries: allDays }),
                        runtimeLogicVersion: summary.metadata.runtimeLogicVersion ?? oldSummary.metadata?.runtimeLogicVersion,
                        cleanHistoryStartDate: resolveMergedCleanHistoryStartDate(
                            summary.metadata.cleanHistoryStartDate,
                            oldSummary.metadata?.cleanHistoryStartDate,
                        ),
                    },
                    schemaVersion: summary.schemaVersion,
                };
            }
        } catch (fetchErr) {
            console.error('Could not fetch existing data for merge:', fetchErr);
            // Fall through — save new data only.
        }
    }

    const overviewSummary = buildPerformanceOverviewSummary(merged);
    const reportSummary = buildPerformanceReportSummary(merged);
    const monthlyStoragePaths: Record<string, string> = {};
    const routeMonthlyStoragePaths: Record<string, Record<string, string>> = {};
    const loadProfileMonthlyStoragePaths: Record<string, string> = {};
    const monthlySummaries = buildMonthlySummaries(merged);
    const monthlyLoadProfileViews = buildMonthlyLoadProfileViews(merged);

    // Upload monthly chunks instead of one giant all-history JSON.
    await mapWithConcurrency([...monthlySummaries.entries()], 3, async ([month, monthSummary]) => {
        const monthPath = getMonthlyStoragePath(teamId, timestamp, month);
        await uploadBytes(ref(storage, monthPath), buildStorageJsonUploadData(monthSummary), {
            contentType: 'application/json',
        });
        monthlyStoragePaths[month] = monthPath;
    });

    await mapWithConcurrency([...monthlyLoadProfileViews.entries()], 3, async ([month, monthView]) => {
        const monthPath = getLoadProfileMonthlyStoragePath(teamId, timestamp, month);
        await uploadBytes(ref(storage, monthPath), buildStorageJsonUploadData(monthView), {
            contentType: 'application/json',
        });
        loadProfileMonthlyStoragePaths[month] = monthPath;
    });

    await uploadBytes(ref(storage, overviewStoragePath), buildStorageJsonUploadData(overviewSummary), {
        contentType: 'application/json',
    });
    await uploadBytes(ref(storage, reportStoragePath), buildStorageJsonUploadData(reportSummary), {
        contentType: 'application/json',
    });

    await mapWithConcurrency(getAvailablePerformanceRoutes(merged), 2, async route => {
        const routeSummary = filterPerformanceSummaryByRoute(merged, route.routeId);
        if (!routeSummary) return;
        const routeMonthlySummaries = buildMonthlySummaries(routeSummary);
        routeMonthlyStoragePaths[route.routeId] = {};
        await mapWithConcurrency([...routeMonthlySummaries.entries()], 2, async ([month, monthSummary]) => {
            const routeMonthPath = getRouteMonthlyStoragePath(teamId, timestamp, route.routeId, month);
            await uploadBytes(ref(storage, routeMonthPath), buildStorageJsonUploadData(monthSummary), {
                contentType: 'application/json',
            });
            routeMonthlyStoragePaths[route.routeId][month] = routeMonthPath;
        });
    });

    await setDoc(metadataRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storageMode: 'monthly',
        overviewStoragePath,
        reportStoragePath,
        monthlyStoragePaths,
        routeMonthlyStoragePaths,
        loadProfileMonthlyStoragePaths,
        dateRange: merged.metadata.dateRange,
        dayCount: merged.metadata.dayCount,
        totalRecords: merged.metadata.totalRecords,
        runtimeLogicVersion: merged.metadata.runtimeLogicVersion ?? null,
        cleanHistoryStartDate: merged.metadata.cleanHistoryStartDate ?? null,
    });

    // Clean up old storage files only after new data + metadata are committed.
    const cleanupPaths = new Set<string>();
    const migratingFromMonolithic = !!oldPath && Object.keys(oldMonthlyStoragePaths).length === 0;
    if (oldPath && !migratingFromMonolithic) cleanupPaths.add(oldPath);
    if (oldOverviewPath && oldOverviewPath !== overviewStoragePath) cleanupPaths.add(oldOverviewPath);
    if (oldReportPath && oldReportPath !== reportStoragePath) cleanupPaths.add(oldReportPath);
    if (!migratingFromMonolithic) {
        Object.values(oldRouteStoragePaths).forEach(path => path && cleanupPaths.add(path));
    }
    Object.values(oldMonthlyStoragePaths).forEach(path => path && cleanupPaths.add(path));
    Object.values(oldRouteMonthlyStoragePaths).flatMap(months => Object.values(months)).forEach(path => path && cleanupPaths.add(path));
    Object.values(oldLoadProfileMonthlyStoragePaths).forEach(path => path && cleanupPaths.add(path));

    const newPaths = new Set<string>([
        overviewStoragePath,
        reportStoragePath,
        ...Object.values(monthlyStoragePaths),
        ...Object.values(routeMonthlyStoragePaths).flatMap(months => Object.values(months)),
        ...Object.values(loadProfileMonthlyStoragePaths),
    ]);

    await Promise.all([...cleanupPaths].map(async path => {
        if (newPaths.has(path)) return;
        try {
            await deleteObject(ref(storage, path));
        } catch {
            // Old file may already be gone — ignore.
        }
    }));
}

// ============ READ ============

export async function getPerformanceMetadata(teamId: string, requestingTeamId?: string): Promise<PerformanceMetadata | null> {
    try {
        if (requestingTeamId && requestingTeamId !== teamId) {
            return await requestSharedWorkspaceData<PerformanceMetadata>({
                workspace: 'performanceMetadata',
                requestingTeamId,
                sourceTeamId: teamId,
            });
        }

        const docSnap = await getDoc(getMetadataRef(teamId));
        if (!docSnap.exists()) return null;

        const data = docSnap.data();
        return {
            importedAt: data.importedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
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
    } catch (error) {
        console.error('Error getting performance metadata:', error);
        throw error instanceof Error
            ? error
            : new Error('Failed to load performance metadata.');
    }
}

export async function getPerformanceData(
    teamId: string,
    metadataOverride?: PerformanceMetadata | null,
    routeId?: string | null,
    requestingTeamId?: string,
    options?: PerformanceDataLoadOptions,
): Promise<PerformanceDataSummary | null> {
    try {
        if (requestingTeamId && (
            requestingTeamId !== teamId
            || options?.detailMode === 'load-profiles'
        )) {
            return await requestSharedWorkspaceData<PerformanceDataSummary>({
                workspace: 'performanceData',
                requestingTeamId,
                sourceTeamId: teamId,
                routeId,
                dateRange: options?.dateRange,
                detailMode: options?.detailMode,
            });
        }

        const metadata = metadataOverride ?? await getPerformanceMetadata(teamId);
        if (!metadata) return null;

        const monthlySummary = metadata.monthlyStoragePaths
            ? await loadMonthlyPerformanceSummary(metadata, routeId, options)
            : null;
        if (monthlySummary) {
            const filtered = filterPerformanceSummaryByRoute(
                mergePerformanceSummaryMetadata(monthlySummary, metadata),
                routeId,
            );
            return options?.detailMode === 'load-profiles'
                ? alignLoadProfilePeakTrips(filtered)
                : filtered;
        }

        if (!metadata.storagePath) return null;

        const selectedRoutePath = routeId && routeId !== 'all'
            ? metadata.routeStoragePaths?.[routeId]
            : undefined;
        const storagePathToLoad = selectedRoutePath || metadata.storagePath;

        let summary: PerformanceDataSummary | null = null;
        try {
            summary = await downloadStorageJson<PerformanceDataSummary>(storagePathToLoad);
        } catch (routeError) {
            if (!selectedRoutePath) throw routeError;
            console.warn('Route-scoped performance data unavailable; falling back to full data:', routeError);
        }

        if (!summary && selectedRoutePath) {
            summary = await downloadStorageJson<PerformanceDataSummary>(metadata.storagePath);
        }
        if (!summary) return null;

        const filtered = filterPerformanceSummaryByRoute(
            applyPerformanceLoadOptions(mergePerformanceSummaryMetadata(summary, metadata), options),
            routeId,
        );
        return options?.detailMode === 'load-profiles'
            ? alignLoadProfilePeakTrips(filtered)
            : filtered;
    } catch (error) {
        console.error('Error getting performance data:', error);
        if (options?.detailMode === 'load-profiles') {
            throw error instanceof Error
                ? error
                : new Error('Failed to load Load Profiles data.');
        }
        return null;
    }
}

export async function getPerformanceOverviewData(
    teamId: string,
    metadataOverride?: PerformanceMetadata | null,
    requestingTeamId?: string,
): Promise<PerformanceDataSummary | null> {
    try {
        if (requestingTeamId && requestingTeamId !== teamId) {
            return await requestSharedWorkspaceData<PerformanceDataSummary>({
                workspace: 'performanceOverview',
                requestingTeamId,
                sourceTeamId: teamId,
            });
        }

        const metadata = metadataOverride ?? await getPerformanceMetadata(teamId);
        if (!metadata) return null;

        if (!metadata.overviewStoragePath) {
            const fullSummary = await getPerformanceData(teamId, metadata);
            return fullSummary ? buildPerformanceOverviewSummary(fullSummary) : null;
        }

        const summary = await downloadStorageJson<PerformanceDataSummary>(metadata.overviewStoragePath);
        if (!summary) return null;
        return mergePerformanceOverviewMetadata(summary, metadata);
    } catch (error) {
        console.error('Error getting performance overview data:', error);
        return null;
    }
}

// ============ DELETE ============

export async function deletePerformanceData(teamId: string): Promise<void> {
    const metadataRef = getMetadataRef(teamId);
    const docSnap = await getDoc(metadataRef);

    if (docSnap.exists()) {
        const storagePath = docSnap.data().storagePath;
        const overviewStoragePath = docSnap.data().overviewStoragePath;
        const reportStoragePath = docSnap.data().reportStoragePath;
        const routeStoragePaths: Record<string, string> = docSnap.data().routeStoragePaths
            && typeof docSnap.data().routeStoragePaths === 'object'
            ? docSnap.data().routeStoragePaths
            : {};
        const monthlyStoragePaths = readStringRecord(docSnap.data().monthlyStoragePaths) || {};
        const routeMonthlyStoragePaths = readNestedStringRecord(docSnap.data().routeMonthlyStoragePaths) || {};
        const loadProfileMonthlyStoragePaths = readStringRecord(docSnap.data().loadProfileMonthlyStoragePaths) || {};
        if (storagePath) {
            try {
                await deleteObject(ref(storage, storagePath));
            } catch {
                // File may already be gone
            }
        }
        if (overviewStoragePath) {
            try {
                await deleteObject(ref(storage, overviewStoragePath));
            } catch {
                // File may already be gone
            }
        }
        if (reportStoragePath) {
            try {
                await deleteObject(ref(storage, reportStoragePath));
            } catch {
                // File may already be gone
            }
        }
        await Promise.all(Object.values(routeStoragePaths).map(async routeStoragePath => {
            if (!routeStoragePath) return;
            try {
                await deleteObject(ref(storage, routeStoragePath));
            } catch {
                // File may already be gone
            }
        }));
        await Promise.all(Object.values(monthlyStoragePaths).map(async monthlyStoragePath => {
            if (!monthlyStoragePath) return;
            try {
                await deleteObject(ref(storage, monthlyStoragePath));
            } catch {
                // File may already be gone
            }
        }));
        await Promise.all(Object.values(routeMonthlyStoragePaths).flatMap(months => Object.values(months)).map(async routeMonthlyStoragePath => {
            if (!routeMonthlyStoragePath) return;
            try {
                await deleteObject(ref(storage, routeMonthlyStoragePath));
            } catch {
                // File may already be gone
            }
        }));
        await Promise.all(Object.values(loadProfileMonthlyStoragePaths).map(async loadProfileMonthlyStoragePath => {
            if (!loadProfileMonthlyStoragePath) return;
            try {
                await deleteObject(ref(storage, loadProfileMonthlyStoragePath));
            } catch {
                // File may already be gone
            }
        }));
        await deleteDoc(metadataRef);
    }
}
