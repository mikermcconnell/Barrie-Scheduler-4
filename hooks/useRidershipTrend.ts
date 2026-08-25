import { useQuery } from '@tanstack/react-query';
import { getRidershipTrendProjection } from '../utils/performanceDataService';

const RIDERSHIP_TREND_STALE_MS = 1000 * 60 * 5;

export function useRidershipTrendQuery(
    teamId: string | undefined,
    requestingTeamId?: string,
    enabled = true,
) {
    return useQuery({
        queryKey: ['ridershipTrend', teamId, requestingTeamId ?? teamId ?? ''],
        queryFn: async () => {
            if (!teamId) return null;
            return getRidershipTrendProjection(teamId, requestingTeamId);
        },
        enabled: Boolean(teamId) && enabled,
        staleTime: RIDERSHIP_TREND_STALE_MS,
        refetchOnWindowFocus: true,
    });
}
