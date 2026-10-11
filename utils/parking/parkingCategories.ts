import {
  DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES,
  type ParkingRevenueLocationCategory,
  type ParkingRevenueLocationMapping,
  type ParkingSettings,
} from './parkingTypes';

export const UNCATEGORIZED_PARKING_CATEGORY_ID = 'uncategorized';

const DEFAULT_CATEGORY_BY_SOURCE_ID: Record<string, string> = {
  '1100': 'downtown', // Five Points Lot
  '1110': 'downtown', // Chase McEachern Way Parking Lot
  '1120': 'downtown', // Lakeshore Mews Parking Lot
  '1130': 'downtown', // Heritage Park Lot
  '1200': 'downtown', // Dunlop Street E On Street Parking
  '1210': 'downtown', // Dunlop Street E On Street Parking
  '1220': 'downtown', // Dunlop Street E On Street Parking
  '1230': 'downtown', // Dunlop Street E On Street Parking
  '1240': 'downtown', // Dunlop Street E On Street Parking
  '1250': 'downtown', // Dunlop Street E On Street Parking
  '1265': 'downtown', // Dunlop Street E On Street Parking
  '1275': 'downtown', // Dunlop Street E On Street Parking
  '1305': 'downtown', // Collier Street On Street Parking
  '1315': 'downtown', // Collier Street On Street Parking
  '1320': 'downtown', // Collier Street On Street Parking
  '1322': 'downtown', // Collier Street Parkade
  '1330': 'downtown', // Collier Street On Street Parking
  '1345': 'downtown', // Collier Street On Street Parking
  '1355': 'downtown', // Collier Street On Street Parking
  '1365': 'downtown', // Collier Street On Street Parking
  '1375': 'downtown', // Collier Street On Street Parking
  '1385': 'downtown', // Collier On Street Parking
  '1395': 'downtown', // Collier On Street Parking
  '1405': 'downtown', // Worsley Street On Street Parking
  '1415': 'downtown', // Worsley Street On Street Parking
  '1425': 'downtown', // Worsley Street On Street Parking
  '1430': 'downtown', // H-Block Parking Lot
  '1435': 'downtown', // Worsley Street On Street Parking
  '1440': 'downtown', // City Hall Parking Lot
  '1445': 'downtown', // Worsley Street On Street Parking
  '1455': 'downtown', // Worsley Street On Street Parking
  '1460': 'downtown', // Worsley Street On Street Parking
  '1520': 'downtown', // Library Parking Lot
  '1525': 'downtown', // McDonald Street On Street Parking
  '1555': 'downtown', // McDonald Street On Street Parking
  '1560': 'downtown', // Courthouse Parking Lot
  '1605': 'downtown', // Bayfield Street On Street Parking
  '1615': 'downtown', // Bayfield Street On Street Parking
  '1625': 'downtown', // Bayfield Street On Street Parking
  '1705': 'downtown', // Clapperton Street On Street Parking
  '1715': 'downtown', // Clapperton Street On Street Parking
  '1725': 'downtown', // Clapperton Street On Street Parking
  '1730': 'downtown', // Clapperton St Parking Lot
  '1745': 'downtown', // Clapperton Street On Street Parking
  '1755': 'downtown', // Clapperton Street On Street Parking
  '1805': 'downtown', // Owen Street On Street Parking
  '1815': 'downtown', // Owen Street On Street Parking
  '1825': 'downtown', // Owen Street On Street Parking
  '1835': 'downtown', // Owen Street On Street Parking
  '1845': 'downtown', // Owen Street On Street Parking
  '1900': 'downtown', // Mulcaster Street On Street Parking
  '1910': 'downtown', // Mulcaster Street On Street Parking
  '1925': 'downtown', // Mulcaster Street On Street Parking
  '1930': 'downtown', // Mulcaster Street On Street Parking
  '1945': 'downtown', // Mulcaster Street On Street Parking
  '1950': 'downtown', // Mulcaster Street On Street Parking
  '1965': 'downtown', // Mulcaster Street On Street Parking
  '2015': 'downtown', // Poyntz Street On Street Parking
  '3100': 'downtown', // Bayfield & Simcoe Street Lot
  '3200': 'downtown', // Dunlop Street W On Street Parking
  '3210': 'downtown', // Dunlop Street W On Street Parking
  '3220': 'downtown', // Dunlop Street W On Street Parking
  '3230': 'downtown', // Dunlop Street W On Street Parking
  '3240': 'downtown', // Dunlop Street W On Street Parking
  '3250': 'downtown', // Dunlop Street W On Street Parking
  '3305': 'downtown', // Park Street On Street Parking
  '3315': 'downtown', // Park Street On Street Parking
  '3400': 'downtown', // Ross Street On Street Parking
  '3505': 'downtown', // Bayfield Street On Street Parking
  '3515': 'downtown', // Bayfield Street On Street Parking
  '3605': 'downtown', // Maple Avenue On Street Parking
  '3625': 'downtown', // Maple Avenue On Street Parking
  '3700': 'downtown', // Mary Street Parking Lot
  '3715': 'downtown', // Mary Street On Street Parking
  '3725': 'downtown', // Mary Street On Street Parking
  '3730': 'downtown', // Maple Avenue South Lot
  '3740': 'downtown', // Maple Avenue Central Lot
  '3750': 'downtown', // Maple Avenue North Lot
  '3850': 'downtown', // Toronto Street On Street Parking
  '3905': 'downtown', // High Street On Street Parking
  '3915': 'downtown', // High Street On Street Parking
  '4040': 'downtown', // Parkside Drive On Street Parking
  '4100': 'downtown', // Bradford St Parking Lot
  '7100': 'waterfront', // Johnson's Beach Parking Lot
  '7200': 'waterfront', // Centennial Boat Launch
  '7300': 'waterfront', // Centennial Beach Lot
  '7325': 'waterfront', // Ellen St Parking - West Side of St
  '7355': 'waterfront', // John St Parking
  '7405': 'waterfront', // Lakeshore Dr East - Centennial Beach
  '7415': 'waterfront', // Lakeshore Dr West - Centennial Beach
  '7425': 'waterfront', // Lakeshore Dr North - Southshore Park
  '7500': 'waterfront', // Will Dwyer Park Lot
  '7600': 'waterfront', // Tiffin St Boat Launch
  '7700': 'waterfront', // General John Hayter Southshore Community Centre Parking Lot
  '7800': 'waterfront', // Minet's Point Parking Lot
  '7900': 'waterfront', // Tyndale Park Parking Lot
  '5100': 'hybrid', // Spirit Catcher
  '5200': 'hybrid', // Simcoe Street Lot
  '5300': 'hybrid', // Marina North
  '5000': 'marina', // Marina Lot
  '8105': 'hospital', // Gallie Court
  '8115': 'hospital', // Gallie Court
  '8205': 'hospital', // Quarry Ridge
  '9105': 'allandale-go', // Cumberland St Parking
  '9000': 'special-events', // Special Events (not tied to a physical location)
};

const LEGACY_DEFAULT_CATEGORY_BY_SOURCE_ID: Record<string, string> = {
  '1430': 'hospital', // H-Block was previously seeded as Hospital.
};

export function normalizeParkingCategoryId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceIdsForLocation(location: ParkingRevenueLocationMapping): string[] {
  return (location.sourceRefs || []).map(ref => String(ref.sourceId ?? '').trim().replace(/\.0$/, '').toUpperCase()).filter(Boolean);
}

export function applyDefaultParkingLocationCategories(
  locations: ParkingRevenueLocationMapping[] = [],
): ParkingRevenueLocationMapping[] {
  return locations.map(location => {
    const categoryId = sourceIdsForLocation(location).map(sourceId => DEFAULT_CATEGORY_BY_SOURCE_ID[sourceId]).find(Boolean);
    if (!categoryId) return location;
    if (location.categoryId !== undefined) {
      const shouldMigrateLegacyDefault = sourceIdsForLocation(location).some(sourceId => (
        LEGACY_DEFAULT_CATEGORY_BY_SOURCE_ID[sourceId] === location.categoryId
      ));
      return shouldMigrateLegacyDefault ? { ...location, categoryId } : location;
    }
    return categoryId ? { ...location, categoryId } : location;
  });
}

export function mergeParkingRevenueCategories(
  categories: ParkingRevenueLocationCategory[] = [],
): ParkingRevenueLocationCategory[] {
  const byId = new Map<string, ParkingRevenueLocationCategory>();
  for (const category of DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES) {
    byId.set(category.id, category);
  }
  for (const category of categories) {
    const id = normalizeParkingCategoryId(category.id || category.label);
    if (!id) continue;
    byId.set(id, {
      ...byId.get(id),
      ...category,
      id,
      label: String(category.label || id).trim(),
    });
  }
  return [...byId.values()].sort((a, b) => {
    const defaultA = DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES.findIndex(category => category.id === a.id);
    const defaultB = DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES.findIndex(category => category.id === b.id);
    if (defaultA >= 0 || defaultB >= 0) return (defaultA < 0 ? 999 : defaultA) - (defaultB < 0 ? 999 : defaultB);
    return a.label.localeCompare(b.label);
  });
}

export function getParkingCategoryDisplay(
  settings: ParkingSettings,
  categoryId: string | null | undefined,
): { id: string | null; label: string; colorHex: string } {
  if (!categoryId) {
    return { id: null, label: 'Uncategorized', colorHex: '#64748B' };
  }
  const category = mergeParkingRevenueCategories(settings.revenueLocationCategories).find(entry => entry.id === categoryId);
  return {
    id: category?.id || categoryId,
    label: category?.label || categoryId,
    colorHex: category?.colorHex || '#64748B',
  };
}
