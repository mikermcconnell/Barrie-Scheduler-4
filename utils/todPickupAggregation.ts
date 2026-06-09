import type { TodPickupMonthlyDataset, TodPickupStop, TodPickupSummary } from './todPickupTypes';

export function getTodPickupMonthOptions(summary: TodPickupSummary | null | undefined): string[] {
  return [...(summary?.months || [])].map(month => month.month).sort();
}

export function getLatestTodPickupMonth(summary: TodPickupSummary | null | undefined): string | null {
  const months = getTodPickupMonthOptions(summary);
  return months.at(-1) ?? null;
}

export function aggregateTodPickupStops(
  months: TodPickupMonthlyDataset[],
  selectedMonths: string[],
): TodPickupStop[] {
  const selected = new Set(selectedMonths);
  const stopMap = new Map<string, TodPickupStop & { latSum: number; lonSum: number }>();

  for (const month of months) {
    if (!selected.has(month.month)) continue;
    for (const stop of month.stops) {
      const existing = stopMap.get(stop.id);
      if (existing) {
        existing.pickups += stop.pickups;
        existing.latSum += stop.lat * stop.pickups;
        existing.lonSum += stop.lon * stop.pickups;
      } else {
        stopMap.set(stop.id, {
          ...stop,
          latSum: stop.lat * stop.pickups,
          lonSum: stop.lon * stop.pickups,
        });
      }
    }
  }

  return Array.from(stopMap.values())
    .map(({ latSum, lonSum, ...stop }) => ({
      ...stop,
      lat: latSum / stop.pickups,
      lon: lonSum / stop.pickups,
    }))
    .sort((a, b) => {
      const pickupCmp = b.pickups - a.pickups;
      if (pickupCmp !== 0) return pickupCmp;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
}
