import { describe, expect, it } from 'vitest';
import { mergeSpecializedTransitLocations, remapSpecializedTransitBuckets } from '../utils/specialized-transit/locationMerges';
import type { SpecializedTransitLocationV1 } from '../utils/specialized-transit/types';

const location = (id: string, displayName: string): SpecializedTransitLocationV1 => ({
  id, displayName, normalizedName: displayName.toLowerCase(), aliases: [displayName],
  latitude: 44.414145, longitude: -79.661147, status: 'automatic', coordinateSource: 'known-place', relevance: 1,
});

describe('Specialized Transit canonical locations', () => {
  it('consolidates three RVH campus stops and preserves every endpoint touch', () => {
    const result = mergeSpecializedTransitLocations({
      main: location('main', 'RVH - Main Entrance'),
      rotary: location('rotary', 'RVH - Rotary Place'),
      cancer: location('cancer', 'RVH - Cancer Centre'),
      dialysis: location('dialysis', 'RVH Community Dialysis Clinic'),
    });
    expect(Object.keys(result.locations).sort()).toEqual(['dialysis', 'st-rvh-campus']);
    expect(result.locations['st-rvh-campus'].aliases).toContain('RVH - Rotary Place');
    const buckets = remapSpecializedTransitBuckets(['main', 'rotary', 'cancer'].map(locationId => ({
      date: '2026-08-01', hour: 8, locationId, pickups: 4, dropoffs: 7,
    })), result.redirects);
    expect(buckets).toEqual([{ date: '2026-08-01', hour: 8, locationId: 'st-rvh-campus', pickups: 12, dropoffs: 21 }]);
    expect(mergeSpecializedTransitLocations(result.locations).locations).toEqual(result.locations);
  });

  it('preserves a manager merge when the old alias appears in a later month', () => {
    const target = { ...location('target', 'City Hall'), aliases: ['City Hall', 'City Hall - Front'], status: 'reviewed' as const, coordinateSource: 'manual' as const };
    const result = mergeSpecializedTransitLocations({ old: location('old', 'City Hall - Front') }, { target });
    expect(result.redirects.old).toBe('target');
    expect(Object.keys(result.locations)).toEqual(['target']);
    expect(result.locations.target.status).toBe('reviewed');
  });

  it('keeps ambiguous aliases and off-campus RVH locations separate', () => {
    const result = mergeSpecializedTransitLocations({
      fresh: location('fresh', 'Shared name'),
      offsite: { ...location('offsite', 'RVH Clinic'), latitude: 44.38, longitude: -79.70 },
    }, {
      a: { ...location('a', 'A'), aliases: ['Shared name'] },
      b: { ...location('b', 'B'), aliases: ['Shared name'] },
    });
    expect(result.redirects.fresh).toBe('fresh');
    expect(result.locations.offsite).toBeDefined();
    expect(result.locations['st-rvh-campus']).toBeUndefined();
  });
});
