import { useQuery } from '@tanstack/react-query';
import { getRidershipTrendProjection } from '../utils/performanceDataService';
import { getTodRidershipProjection } from '../utils/todPickupService';

const RIDERSHIP_TREND_STALE_MS = 1000 * 60 * 5;

export function useRidershipTrendQuery(
    teamId: string | undefined,
    requestingTeamId?: string,
    enabled = true,
    accessContext: 'ridershipTrend' | 'strategicPlan' = 'ridershipTrend',
) {
    return useQuery({
        queryKey: ['ridershipTrend', teamId, requestingTeamId ?? teamId ?? '', accessContext],
        queryFn: async () => {
            if (!teamId) return null;
            return getRidershipTrendProjection(teamId, requestingTeamId, accessContext);
        },
        enabled: Boolean(teamId) && enabled,
        staleTime: RIDERSHIP_TREND_STALE_MS,
        refetchOnWindowFocus: true,
    });
}

export function useTodRidershipProjectionQuery(
    teamId: string | undefined,
    requestingTeamId?: string,
    enabled = true,
    accessContext: 'ridershipTrend' | 'strategicPlan' = 'ridershipTrend',
) {
    return useQuery({
        queryKey: ['ridershipTrendTod', teamId, requestingTeamId ?? teamId ?? '', accessContext],
        queryFn: async () => {
            if (!teamId) return null;
            return getTodRidershipProjection(teamId, requestingTeamId, accessContext);
        },
        enabled: Boolean(teamId) && enabled,
        staleTime: RIDERSHIP_TREND_STALE_MS,
        refetchOnWindowFocus: true,
    });
}
