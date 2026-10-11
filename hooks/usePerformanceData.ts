import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import {
    getPerformanceData,
    getPerformanceMetadata,
    getPerformanceOverviewData,
    savePerformanceData,
} from '../utils/performanceDataService';
import type {
    PerformanceDataLoadOptions,
    PerformanceDataLoadProgress,
    PerformanceDataSummary,
    PerformanceMetadata,
} from '../utils/performanceDataTypes';
import {
    buildPerformanceLoadProfileKey,
    getExpectedPerformanceLoadUnits,
    PERFORMANCE_METADATA_LOAD_PROFILE,
    PERFORMANCE_OVERVIEW_LOAD_PROFILE,
    recordPerformanceLoadDuration,
} from '../utils/performanceLoadTiming';
import { resolveDetailDateRange } from '../utils/performanceDetailDateRange';

const PERFORMANCE_QUERY_STALE_MS = 1000 * 60 * 30;
const PERFORMANCE_QUERY_GC_MS = 1000 * 60 * 60;

function buildPerformanceMetadataQueryKey(teamId: string | undefined, requestingTeamId?: string) {
    return ['performanceMetadata', teamId, requestingTeamId ?? teamId ?? ''] as const;
}

function buildPerformanceDataQueryKey(
    teamId: string | undefined,
    metadata?: PerformanceMetadata | null,
    routeId?: string | null,
    requestingTeamId?: string,
    options?: PerformanceDataLoadOptions,
) {
    return [
        'performanceData',
        teamId,
        requestingTeamId ?? teamId ?? '',
        metadata?.storagePath ?? JSON.stringify(metadata?.monthlyStoragePaths ?? null),
        JSON.stringify(metadata?.loadProfileMonthlyStoragePaths ?? null),
        JSON.stringify(metadata?.dashboardMonthlyStoragePaths ?? null),
        routeId ?? 'all',
        options?.dateRange?.start ?? '',
        options?.dateRange?.end ?? '',
        options?.detailMode ?? 'all',
    ] as const;
}

function buildPerformanceOverviewQueryKey(
    teamId: string | undefined,
    metadata?: PerformanceMetadata | null,
    requestingTeamId?: string,
) {
    return [
        'performanceOverview',
        teamId,
        requestingTeamId ?? teamId ?? '',
        metadata?.overviewStoragePath ?? metadata?.storagePath ?? JSON.stringify(metadata?.monthlyStoragePaths ?? null),
    ] as const;
}

function useLoadProgressChannel(signature: string) {
    const currentSignatureRef = useRef(signature);
    currentSignatureRef.current = signature;
    const [state, setState] = useState<{
        signature: string;
        progress: PerformanceDataLoadProgress;
    } | null>(null);
    const reportProgress = useCallback((progress: PerformanceDataLoadProgress) => {
        if (currentSignatureRef.current !== signature) return;
        setState({ signature, progress });
    }, [signature]);

    return {
        loadProgress: state?.signature === signature ? state.progress : null,
        reportProgress,
        isCurrentRequest: () => currentSignatureRef.current === signature,
    };
}

// Fetch Metadata
export function usePerformanceMetadataQuery(teamId: string | undefined, requestingTeamId?: string) {
    const queryKey = buildPerformanceMetadataQueryKey(teamId, requestingTeamId);
    const signature = JSON.stringify(queryKey);
    const { isCurrentRequest } = useLoadProgressChannel(signature);
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!teamId) return null;
            const startedAt = Date.now();
            const result = await getPerformanceMetadata(teamId, requestingTeamId);
            if (isCurrentRequest()) {
                recordPerformanceLoadDuration(PERFORMANCE_METADATA_LOAD_PROFILE, Date.now() - startedAt);
            }
            return result;
        },
        enabled: !!teamId,
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
    return {
        ...query,
        loadProgress: null as PerformanceDataLoadProgress | null,
        loadProfileKey: PERFORMANCE_METADATA_LOAD_PROFILE,
    };
}

// Fetch Full Data
export function usePerformanceDataQuery(
    teamId: string | undefined,
    enabled = true,
    metadata?: PerformanceMetadata | null,
    routeId?: string | null,
    requestingTeamId?: string,
    options?: PerformanceDataLoadOptions,
) {
    const queryKey = buildPerformanceDataQueryKey(teamId, metadata, routeId, requestingTeamId, options);
    const signature = JSON.stringify(queryKey);
    const unitCount = getExpectedPerformanceLoadUnits(teamId, metadata, routeId, requestingTeamId, options);
    const usesSharedRequest = !!requestingTeamId && (
        requestingTeamId !== teamId
        || options?.detailMode === 'load-profiles'
    );
    const loadProfileKey = buildPerformanceLoadProfileKey({
        kind: 'detail',
        unitCount,
        routeScoped: !!routeId && routeId !== 'all',
        detailMode: options?.detailMode ?? 'all',
        shared: usesSharedRequest,
    });
    const { loadProgress, reportProgress, isCurrentRequest } = useLoadProgressChannel(signature);
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!teamId) return null;
            const startedAt = Date.now();
            const result = await getPerformanceData(
                teamId,
                metadata,
                routeId,
                requestingTeamId,
                options,
                reportProgress,
            );
            if (!result && options?.detailMode) {
                throw new Error('The requested performance details are unavailable.');
            }
            if (isCurrentRequest()) {
                recordPerformanceLoadDuration(loadProfileKey, Date.now() - startedAt);
            }
            return result;
        },
        enabled: !!teamId && enabled,
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
    return { ...query, loadProgress, loadProfileKey, loadRequestKey: signature };
}

// Fetch lightweight overview data
export function usePerformanceOverviewQuery(
    teamId: string | undefined,
    enabled = true,
    metadata?: PerformanceMetadata | null,
    requestingTeamId?: string,
) {
    const queryKey = buildPerformanceOverviewQueryKey(teamId, metadata, requestingTeamId);
    const signature = JSON.stringify(queryKey);
    const { loadProgress, reportProgress, isCurrentRequest } = useLoadProgressChannel(signature);
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!teamId) return null;
            const startedAt = Date.now();
            const result = await getPerformanceOverviewData(teamId, metadata, requestingTeamId, reportProgress);
            if (result && isCurrentRequest()) {
                recordPerformanceLoadDuration(PERFORMANCE_OVERVIEW_LOAD_PROFILE, Date.now() - startedAt);
            }
            return result;
        },
        enabled: !!teamId && enabled,
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
    return {
        ...query,
        loadProgress,
        loadProfileKey: PERFORMANCE_OVERVIEW_LOAD_PROFILE,
    };
}

// Warm the cache for the dashboard's default Ridership view (all routes, Past
// Week plus its comparison week) so opening it later skips the download.
// Keys come from the same builders the hooks use, so the dashboard finds them.
export async function prefetchOperationsRidership(
    queryClient: QueryClient,
    teamId: string,
    requestingTeamId: string,
): Promise<void> {
    const metadata = await queryClient.fetchQuery({
        queryKey: buildPerformanceMetadataQueryKey(teamId, requestingTeamId),
        queryFn: () => getPerformanceMetadata(teamId, requestingTeamId),
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
    });
    if (!metadata) return;

    const routeId = 'all';
    const options: PerformanceDataLoadOptions = {
        dateRange: resolveDetailDateRange(metadata, 'past-week', null, null, true),
        detailMode: 'ridership',
    };
    await Promise.all([
        queryClient.prefetchQuery({
            queryKey: buildPerformanceOverviewQueryKey(teamId, metadata, requestingTeamId),
            queryFn: () => getPerformanceOverviewData(teamId, metadata, requestingTeamId),
            staleTime: PERFORMANCE_QUERY_STALE_MS,
            gcTime: PERFORMANCE_QUERY_GC_MS,
        }),
        queryClient.prefetchQuery({
            queryKey: buildPerformanceDataQueryKey(teamId, metadata, routeId, requestingTeamId, options),
            queryFn: async () => {
                const result = await getPerformanceData(teamId, metadata, routeId, requestingTeamId, options);
                if (!result) throw new Error('The requested performance details are unavailable.');
                return result;
            },
            staleTime: PERFORMANCE_QUERY_STALE_MS,
            gcTime: PERFORMANCE_QUERY_GC_MS,
        }),
    ]);
}

// Mutation for saving new data (to invalidate queries)
export function useSavePerformanceData(teamId: string | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ userId, summary }: { userId: string, summary: PerformanceDataSummary }) => {
            if (!teamId) throw new Error('Team ID is required');
            await savePerformanceData(teamId, userId, summary);
        },
        onSuccess: () => {
            if (teamId) {
                queryClient.invalidateQueries({ queryKey: ['performanceMetadata', teamId] });
                queryClient.invalidateQueries({ queryKey: ['performanceOverview', teamId] });
                queryClient.invalidateQueries({ queryKey: ['performanceData', teamId] });
            }
        }
    });
}
