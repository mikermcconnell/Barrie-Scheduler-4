import { useQuery } from '@tanstack/react-query';
import { getTodZoneDraft, getTodZoneVersions } from '../utils/todZones/todZoneService';
import { fetchBarrieTransitStops } from '../utils/todZones/todCityStops';

const STALE_TIME = 1000 * 60 * 15;

export function useTodZoneDraftQuery(teamId?: string) {
    return useQuery({
        queryKey: ['todZoneDraft', teamId],
        queryFn: () => getTodZoneDraft(teamId!),
        enabled: !!teamId,
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
    });
}

export function useTodZoneVersionsQuery(teamId?: string) {
    return useQuery({
        queryKey: ['todZoneVersions', teamId],
        queryFn: () => getTodZoneVersions(teamId!),
        enabled: !!teamId,
        staleTime: STALE_TIME,
        refetchOnWindowFocus: false,
    });
}

export function useBarrieTransitStopsQuery(enabled = true) {
    return useQuery({
        queryKey: ['barrieTransitStops'],
        queryFn: ({ signal }) => fetchBarrieTransitStops(signal),
        enabled,
        staleTime: 1000 * 60 * 60 * 12,
        retry: 1,
    });
}
