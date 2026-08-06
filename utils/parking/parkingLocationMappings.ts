import type {
  ParkingRevenueLocationMapping,
  ParkingRevenueSource,
} from './parkingTypes';

export interface ParkingRevenueLocationMergeOptions {
  overwriteExisting?: boolean;
}

function normalizeText(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text.toLowerCase() === '<null>' ? '' : text;
}

function normalizeId(value: unknown): string {
  return normalizeText(value).replace(/\.0$/, '').toUpperCase();
}

function sourceRefKey(source: ParkingRevenueSource, sourceId: string): string {
  return `${source}:${normalizeId(sourceId)}`;
}

function mappingSourceRefKeys(mapping: ParkingRevenueLocationMapping): Set<string> {
  return new Set((mapping.sourceRefs || []).map(ref => sourceRefKey(ref.source, ref.sourceId)));
}

function mergeSourceRefs(
  existing: ParkingRevenueLocationMapping,
  imported: ParkingRevenueLocationMapping,
): ParkingRevenueLocationMapping['sourceRefs'] {
  const refs = new Map<string, ParkingRevenueLocationMapping['sourceRefs'][number]>();
  for (const ref of existing.sourceRefs || []) refs.set(sourceRefKey(ref.source, ref.sourceId), ref);
  for (const ref of imported.sourceRefs || []) refs.set(sourceRefKey(ref.source, ref.sourceId), ref);
  return [...refs.values()];
}

export function mergeParkingRevenueLocationMappings(
  existing: ParkingRevenueLocationMapping[] = [],
  imported: ParkingRevenueLocationMapping[] = [],
  options: ParkingRevenueLocationMergeOptions = {},
): ParkingRevenueLocationMapping[] {
  const overwriteExisting = options.overwriteExisting ?? true;
  const next = [...existing];
  for (const importedMapping of imported) {
    const importedKeys = mappingSourceRefKeys(importedMapping);
    const overlapIndex = next.findIndex(mapping => (
      mapping.id === importedMapping.id ||
      [...mappingSourceRefKeys(mapping)].some(key => importedKeys.has(key))
    ));
    if (overlapIndex >= 0) {
      const current = next[overlapIndex];
      const merged = overwriteExisting
        ? {
          ...current,
          ...importedMapping,
          sourceRefs: importedMapping.sourceRefs,
        }
        : {
          ...current,
          displayName: current.displayName || importedMapping.displayName,
          latitude: current.latitude ?? importedMapping.latitude,
          longitude: current.longitude ?? importedMapping.longitude,
          capacitySpaces: current.capacitySpaces ?? importedMapping.capacitySpaces,
          sourceRefs: mergeSourceRefs(current, importedMapping),
        };
      const locationKind = overwriteExisting
        ? importedMapping.locationKind
        : current.locationKind ?? importedMapping.locationKind;
      if (locationKind) {
        merged.locationKind = locationKind;
      } else {
        delete merged.locationKind;
      }
      next[overlapIndex] = merged;
    } else {
      next.push(importedMapping);
    }
  }
  return next.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
