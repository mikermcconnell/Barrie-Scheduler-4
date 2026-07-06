import {
  DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES,
  type ParkingRevenueLocationCategory,
  type ParkingRevenueLocationMapping,
  type ParkingSettings,
} from './parkingTypes';

export const UNCATEGORIZED_PARKING_CATEGORY_ID = 'uncategorized';

const DEFAULT_CATEGORY_BY_SOURCE_ID: Record<string, string> = {
  '5100': 'hybrid', // Spirit Catcher
  '5200': 'hybrid', // Simcoe Street Lot
  '5300': 'hybrid', // Marina North
  '5000': 'marina', // Marina Lot
  '1430': 'hospital', // H-Block
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
    if (location.categoryId !== undefined) return location;
    const categoryId = sourceIdsForLocation(location).map(sourceId => DEFAULT_CATEGORY_BY_SOURCE_ID[sourceId]).find(Boolean);
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
