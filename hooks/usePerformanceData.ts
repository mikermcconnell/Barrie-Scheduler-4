import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const PERFORMANCE_QUERY_STALE_MS = 1000 * 60 * 30;
const PERFORMANCE_QUERY_GC_MS = 1000 * 60 * 60;

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
    const signature = JSON.stringify(['performanceMetadata', teamId, requestingTeamId ?? teamId ?? '']);
    const { isCurrentRequest } = useLoadProgressChannel(signature);
    const query = useQuery({
        queryKey: ['performanceMetadata', teamId, requestingTeamId ?? teamId ?? ''],
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
    const queryKey = [
            'performanceData',
            teamId,
            requestingTeamId ?? teamId ?? '',
            metadata?.storagePath ?? JSON.stringify(metadata?.monthlyStoragePaths ?? null),
            JSON.stringify(metadata?.loadProfileMonthlyStoragePaths ?? null),
            routeId ?? 'all',
            options?.dateRange?.start ?? '',
            options?.dateRange?.end ?? '',
            options?.detailMode ?? 'all',
        ] as const;
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
    return { ...query, loadProgress, loadProfileKey };
}

// Fetch lightweight overview data
export function usePerformanceOverviewQuery(
    teamId: string | undefined,
    enabled = true,
    metadata?: PerformanceMetadata | null,
    requestingTeamId?: string,
) {
    const queryKey = ['performanceOverview', teamId, requestingTeamId ?? teamId ?? '', metadata?.overviewStoragePath ?? metadata?.storagePath ?? JSON.stringify(metadata?.monthlyStoragePaths ?? null)] as const;
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
