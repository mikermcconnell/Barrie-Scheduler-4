import { useQuery } from '@tanstack/react-query';
import { getSpecializedTransitDataset, getSpecializedTransitMetadata } from '../utils/specialized-transit/service';
import type { SpecializedTransitMetadata } from '../utils/specialized-transit/types';

const STALE_TIME = 30 * 60 * 1000;

export function useSpecializedTransitMetadataQuery(teamId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['specializedTransitMetadata', teamId],
    queryFn: () => teamId ? getSpecializedTransitMetadata(teamId) : null,
    enabled: !!teamId && enabled,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

export function useSpecializedTransitDatasetQuery(
  teamId: string | undefined,
  enabled: boolean,
  metadata?: SpecializedTransitMetadata | null,
) {
  return useQuery({
    queryKey: ['specializedTransitDataset', teamId, metadata?.storagePath ?? null],
    queryFn: () => teamId ? getSpecializedTransitDataset(teamId, metadata) : null,
    enabled: !!teamId && enabled && !!metadata,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}
