import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTodPickupData,
  getTodPickupMetadata,
  saveTodDailyKpiData,
  saveTodPickupMonthData,
} from '../utils/todPickupService';
import type { TodDailyKpiDataset, TodPickupMetadata, TodPickupMonthlyDataset } from '../utils/todPickupTypes';

const TOD_PICKUP_QUERY_STALE_MS = 1000 * 60 * 30;
const TOD_PICKUP_QUERY_GC_MS = 1000 * 60 * 60;

export function useTodPickupMetadataQuery(teamId: string | undefined) {
  return useQuery({
    queryKey: ['todPickupMetadata', teamId],
    queryFn: async () => {
      if (!teamId) return null;
      return getTodPickupMetadata(teamId);
    },
    enabled: !!teamId,
    staleTime: TOD_PICKUP_QUERY_STALE_MS,
    gcTime: TOD_PICKUP_QUERY_GC_MS,
    refetchOnWindowFocus: false,
  });
}

export function useTodPickupDataQuery(
  teamId: string | undefined,
  enabled = true,
  metadata?: TodPickupMetadata | null,
) {
  return useQuery({
    queryKey: ['todPickupData', teamId, metadata?.storagePath ?? null],
    queryFn: async () => {
      if (!teamId) return null;
      return getTodPickupData(teamId, metadata);
    },
    enabled: !!teamId && enabled,
    staleTime: TOD_PICKUP_QUERY_STALE_MS,
    gcTime: TOD_PICKUP_QUERY_GC_MS,
    refetchOnWindowFocus: false,
  });
}

export function useSaveTodPickupMonth(teamId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, dataset }: { userId: string; dataset: TodPickupMonthlyDataset }) => {
      if (!teamId) throw new Error('Team ID is required');
      await saveTodPickupMonthData(teamId, userId, dataset);
    },
    onSuccess: () => {
      if (!teamId) return;
      queryClient.invalidateQueries({ queryKey: ['todPickupMetadata', teamId] });
      queryClient.invalidateQueries({ queryKey: ['todPickupData', teamId] });
    },
  });
}

export function useSaveTodDailyKpi(teamId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, dataset }: { userId: string; dataset: TodDailyKpiDataset }) => {
      if (!teamId) throw new Error('Team ID is required');
      await saveTodDailyKpiData(teamId, userId, dataset);
    },
    onSuccess: () => {
      if (!teamId) return;
      queryClient.invalidateQueries({ queryKey: ['todPickupMetadata', teamId] });
      queryClient.invalidateQueries({ queryKey: ['todPickupData', teamId] });
    },
  });
}
