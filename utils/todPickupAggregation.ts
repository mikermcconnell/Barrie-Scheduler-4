import type { TodDailyKpiDataset, TodDailyKpiLocation } from './todPickupTypes';

export type TodActivityMetric = 'pickups' | 'dropoffs';

type MutableLocation = TodDailyKpiLocation & {
  coordinateWeight: number;
  latWeightedSum: number;
  lonWeightedSum: number;
};

export function getTodActivityValue(
  location: TodDailyKpiLocation,
  metric: TodActivityMetric,
): number {
  return metric === 'pickups' ? location.pickups : location.dropoffs;
}

export function aggregateTodDailyLocations(
  reports: TodDailyKpiDataset[],
  includedDates: string[],
): TodDailyKpiLocation[] {
  const selectedDates = new Set(includedDates);
  const locations = new Map<string, MutableLocation>();

  for (const report of reports) {
    if (!selectedDates.has(report.date)) continue;

    for (const location of report.locations) {
      const coordinateWeight = Math.max(location.pickups + location.dropoffs, 1);
      const current = locations.get(location.id);
      if (current) {
        current.name = location.name;
        current.pickups += location.pickups;
        current.dropoffs += location.dropoffs;
        current.coordinateWeight += coordinateWeight;
        current.latWeightedSum += location.lat * coordinateWeight;
        current.lonWeightedSum += location.lon * coordinateWeight;
      } else {
        locations.set(location.id, {
          ...location,
          coordinateWeight,
          latWeightedSum: location.lat * coordinateWeight,
          lonWeightedSum: location.lon * coordinateWeight,
        });
      }
    }
  }

  return [...locations.values()]
    .map(({ coordinateWeight, latWeightedSum, lonWeightedSum, ...location }) => ({
      ...location,
      lat: latWeightedSum / coordinateWeight,
      lon: lonWeightedSum / coordinateWeight,
    }))
    .sort((a, b) => (
      (b.pickups + b.dropoffs) - (a.pickups + a.dropoffs)
      || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    ));
}
