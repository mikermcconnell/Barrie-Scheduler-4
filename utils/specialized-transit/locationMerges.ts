import type { SpecializedTransitActivityBucket, SpecializedTransitDatasetV1, SpecializedTransitLocationV1 } from './types';

const RVH_ID = 'st-rvh-campus';
const normalize = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const names = (location: SpecializedTransitLocationV1) => [...new Set([location.displayName, ...location.aliases].map(normalize))];

function isRvhCampus(location: SpecializedTransitLocationV1): boolean {
  const label = normalize(location.displayName);
  if (!/^(rvh\b|royal victoria\b)/.test(label) || /\b(community|dialysis|wellington|offsite|off site)\b/.test(label)) return false;
  // Do not combine off-campus clinics merely because they share the RVH name.
  return location.latitude === null || location.longitude === null
    || (Math.abs(location.latitude - 44.414145) < 0.004 && Math.abs(location.longitude + 79.661147) < 0.004);
}

export function remapSpecializedTransitBuckets(
  buckets: SpecializedTransitActivityBucket[], redirects: Record<string, string>,
): SpecializedTransitActivityBucket[] {
  const merged = new Map<string, SpecializedTransitActivityBucket>();
  for (const bucket of buckets) {
    const locationId = redirects[bucket.locationId] ?? bucket.locationId;
    const key = `${bucket.date}|${bucket.hour}|${locationId}`;
    const target = merged.get(key) ?? { ...bucket, locationId, pickups: 0, dropoffs: 0 };
    target.pickups += bucket.pickups;
    target.dropoffs += bucket.dropoffs;
    merged.set(key, target);
  }
  return [...merged.values()];
}

export function mergeSpecializedTransitLocations(
  incoming: Record<string, SpecializedTransitLocationV1>,
  existing: Record<string, SpecializedTransitLocationV1> = {},
): { locations: Record<string, SpecializedTransitLocationV1>; redirects: Record<string, string> } {
  const aliases = new Map<string, Set<string>>();
  for (const location of Object.values(existing)) {
    for (const name of names(location)) {
      const ids = aliases.get(name) ?? new Set<string>();
      ids.add(location.id);
      aliases.set(name, ids);
    }
  }
  const locations = { ...existing };
  const redirects: Record<string, string> = {};
  for (const location of Object.values(incoming)) {
    const matches = new Set(names(location).flatMap(name => [...(aliases.get(name) ?? [])]));
    const targetId = existing[location.id] ? location.id : matches.size === 1 ? [...matches][0] : location.id;
    const previous = locations[targetId];
    redirects[location.id] = targetId;
    locations[targetId] = previous ? {
      ...previous, aliases: [...new Set([...previous.aliases, location.displayName, ...location.aliases])],
    } : location;
  }
  const campus = Object.values(locations).filter(location => location.id === RVH_ID || isRvhCampus(location));
  if (campus.length) {
    const preferred = campus.find(location => location.status === 'reviewed')
      ?? campus.find(location => location.id === RVH_ID)
      ?? campus.find(location => location.latitude !== null) ?? campus[0];
    locations[RVH_ID] = {
      ...preferred, id: RVH_ID, displayName: 'Royal Victoria Regional Health Centre (RVH)',
      normalizedName: 'royal victoria regional health centre rvh',
      aliases: [...new Set(['Royal Victoria Regional Health Centre (RVH)', ...campus.flatMap(location => [location.displayName, ...location.aliases])])],
    };
    const campusIds = new Set(campus.map(location => location.id));
    for (const [id, target] of Object.entries(redirects)) if (campusIds.has(target)) redirects[id] = RVH_ID;
    for (const id of campusIds) {
      redirects[id] = RVH_ID;
      if (id !== RVH_ID) delete locations[id];
    }
  }
  return { locations, redirects };
}

/** Apply deterministic campus grouping on read; the next normal save persists it. */
export function consolidateSpecializedTransitDataset(dataset: SpecializedTransitDatasetV1): SpecializedTransitDatasetV1 {
  const { locations, redirects } = mergeSpecializedTransitLocations(dataset.locations);
  return {
    ...dataset, locations,
    months: Object.fromEntries(Object.entries(dataset.months).map(([key, month]) => [key, {
      ...month, activityBuckets: remapSpecializedTransitBuckets(month.activityBuckets, redirects),
    }])),
  };
}
