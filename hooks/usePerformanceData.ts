import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getPerformanceData,
    getPerformanceMetadata,
    getPerformanceOverviewData,
    savePerformanceData,
} from '../utils/performanceDataService';
import type { PerformanceDataSummary, PerformanceMetadata } from '../utils/performanceDataTypes';

const PERFORMANCE_QUERY_STALE_MS = 1000 * 60 * 30;
const PERFORMANCE_QUERY_GC_MS = 1000 * 60 * 60;

// Fetch Metadata
export function usePerformanceMetadataQuery(teamId: string | undefined) {
    return useQuery({
        queryKey: ['performanceMetadata', teamId],
        queryFn: async () => {
            if (!teamId) return null;
            return await getPerformanceMetadata(teamId);
        },
        enabled: !!teamId,
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
}

// Fetch Full Data
export function usePerformanceDataQuery(
    teamId: string | undefined,
    enabled = true,
    metadata?: PerformanceMetadata | null,
) {
    return useQuery({
        queryKey: ['performanceData', teamId, metadata?.storagePath ?? null],
        queryFn: async () => {
            if (!teamId) return null;
            return await getPerformanceData(teamId, metadata);
        },
        enabled: !!teamId && enabled,
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
}

// Fetch lightweight overview data
export function usePerformanceOverviewQuery(
    teamId: string | undefined,
    enabled = true,
    metadata?: PerformanceMetadata | null,
) {
    return useQuery({
        queryKey: ['performanceOverview', teamId, metadata?.overviewStoragePath ?? metadata?.storagePath ?? null],
        queryFn: async () => {
            if (!teamId) return null;
            return await getPerformanceOverviewData(teamId, metadata);
        },
        enabled: !!teamId && enabled,
        staleTime: PERFORMANCE_QUERY_STALE_MS,
        gcTime: PERFORMANCE_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
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
