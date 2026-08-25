import { useQuery } from '@tanstack/react-query';
import {
    getTransitAppData,
    getTransitAppMetadata,
    type TransitAppMetadata,
} from '../utils/transit-app/transitAppService';

const TRANSIT_APP_QUERY_STALE_MS = 1000 * 60 * 30;
const TRANSIT_APP_QUERY_GC_MS = 1000 * 60 * 60;

export function transitAppMetadataQueryKey(teamId: string | undefined, requestingTeamId?: string) {
    return ['transitAppMetadata', teamId ?? '', requestingTeamId ?? teamId ?? ''] as const;
}

export function transitAppDataQueryKey(
    teamId: string | undefined,
    requestingTeamId?: string,
    metadata?: TransitAppMetadata | null,
) {
    return [
        'transitAppData',
        teamId ?? '',
        requestingTeamId ?? teamId ?? '',
        metadata?.storagePath ?? '',
    ] as const;
}

export function useTransitAppMetadataQuery(
    teamId: string | undefined,
    requestingTeamId?: string,
    enabled = true,
) {
    return useQuery({
        queryKey: transitAppMetadataQueryKey(teamId, requestingTeamId),
        queryFn: async () => {
            if (!teamId) return null;
            return getTransitAppMetadata(teamId, requestingTeamId);
        },
        enabled: !!teamId && enabled,
        staleTime: TRANSIT_APP_QUERY_STALE_MS,
        gcTime: TRANSIT_APP_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
}

export function useTransitAppDataQuery(
    teamId: string | undefined,
    requestingTeamId?: string,
    enabled = true,
    metadata?: TransitAppMetadata | null,
) {
    return useQuery({
        queryKey: transitAppDataQueryKey(teamId, requestingTeamId, metadata),
        queryFn: async () => {
            if (!teamId) return null;
            return getTransitAppData(teamId, requestingTeamId);
        },
        enabled: !!teamId && enabled && !!metadata?.storagePath,
        staleTime: TRANSIT_APP_QUERY_STALE_MS,
        gcTime: TRANSIT_APP_QUERY_GC_MS,
        refetchOnWindowFocus: false,
    });
}
