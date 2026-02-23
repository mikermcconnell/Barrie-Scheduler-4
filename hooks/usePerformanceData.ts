import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPerformanceData, getPerformanceMetadata, savePerformanceData } from '../utils/performanceDataService';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

// Fetch Metadata
export function usePerformanceMetadataQuery(teamId: string | undefined) {
    return useQuery({
        queryKey: ['performanceMetadata', teamId],
        queryFn: async () => {
            if (!teamId) return null;
            return await getPerformanceMetadata(teamId);
        },
        enabled: !!teamId,
        staleTime: 1000 * 60 * 5, // Cache for 5 mins
    });
}

// Fetch Full Data
export function usePerformanceDataQuery(teamId: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ['performanceData', teamId],
        queryFn: async () => {
            if (!teamId) return null;
            return await getPerformanceData(teamId);
        },
        enabled: !!teamId && enabled,
        staleTime: 1000 * 60 * 5, // Cache for 5 mins
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
                queryClient.invalidateQueries({ queryKey: ['performanceData', teamId] });
            }
        }
    });
}
