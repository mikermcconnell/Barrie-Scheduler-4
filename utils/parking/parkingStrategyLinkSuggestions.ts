import type { ParkingRevenueLocationMapping } from './parkingTypes';

// First-pass aliases reviewed against the existing Parking registry, not fuzzy
// geocoding. Directional/sub-lot ambiguities deliberately remain unresolved.
export const PARKING_STRATEGY_FIRST_PASS: Readonly<Record<string, string>> = {
  marina: 'Marina Parking Lot',
  northmarina: 'Marina North Parking Lot',
  southshorecentre: 'General John Hayter Southshore Community Centre Parking Lot',
  spiritcatcher: 'Spirit Catcher Parking Lot',
  simcoe: 'Simcoe Street Lot',
  parksidedrive: 'Parkside Drive On Street Parking',
  rossstreet: 'Ross Street On Street Parking',
  tiffinboatlaunch: 'Tiffin St Boat Launch',
};

/** Draft only. Resolve against this team's current registry, never guessed IDs. */
export function suggestParkingStrategyLinks(
  meters: ReadonlyArray<{ sourceKey: string; domain: string }>,
  locations: ReadonlyArray<ParkingRevenueLocationMapping>,
  existing: Readonly<Record<string, string>>,
): { mappings: Record<string, string>; suggestedKeys: string[] } {
  const mappings = { ...existing };
  const suggestedKeys: string[] = [];
  const normalize = (value: string) => value.trim().toLowerCase();
  for (const meter of meters) {
    if (mappings[meter.sourceKey]) continue;
    const expectedName = PARKING_STRATEGY_FIRST_PASS[normalize(meter.domain)];
    if (!expectedName) continue;
    const candidates = locations.filter(location => location.locationKind !== 'non_spatial'
      && normalize(location.displayName) === normalize(expectedName));
    if (candidates.length !== 1) continue;
    mappings[meter.sourceKey] = candidates[0].id;
    suggestedKeys.push(meter.sourceKey);
  }
  return { mappings, suggestedKeys };
}
