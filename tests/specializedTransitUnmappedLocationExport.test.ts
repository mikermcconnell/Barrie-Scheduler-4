import { describe, expect, it } from 'vitest';
import type { SpecializedTransitDatasetV1, SpecializedTransitLocationV1 } from '../utils/specialized-transit/types';
import {
  buildSpecializedTransitUnmappedResearchText,
  getSpecializedTransitUnmappedResearchRows,
} from '../utils/specialized-transit/unmappedLocationExport';

function location(
  id: string,
  displayName: string,
  status: SpecializedTransitLocationV1['status'],
): SpecializedTransitLocationV1 {
  return {
    id,
    displayName,
    normalizedName: displayName.toUpperCase(),
    aliases: [displayName],
    latitude: status === 'unmapped' ? null : 44.39,
    longitude: status === 'unmapped' ? null : -79.69,
    status,
    coordinateSource: status === 'unmapped' ? null : 'manual',
    relevance: status === 'unmapped' ? null : 1,
  };
}

describe('Specialized Transit unmapped-location export', () => {
  it('includes every unmapped location and ranks total activity across saved months', () => {
    const dataset = {
      schemaVersion: 1,
      revision: 2,
      updatedAt: '2026-09-01T12:00:00.000Z',
      updatedBy: 'manager-1',
      locations: {
        high: { ...location('high', 'High Priority', 'unmapped'), aliases: ['High Priority', 'High'] },
        low: location('low', 'Low Priority', 'unmapped'),
        mapped: location('mapped', 'Already Mapped', 'reviewed'),
      },
      months: {
        '2026-07': { activityBuckets: [{ locationId: 'high', pickups: 2, dropoffs: 3 }] },
        '2026-08': { activityBuckets: [
          { locationId: 'low', pickups: 1, dropoffs: 0 },
          { locationId: 'high', pickups: 4, dropoffs: 1 },
          { locationId: 'mapped', pickups: 100, dropoffs: 100 },
        ] },
      },
    } as unknown as SpecializedTransitDatasetV1;

    expect(getSpecializedTransitUnmappedResearchRows(dataset)).toEqual([
      expect.objectContaining({ id: 'high', endpointTouches: 10 }),
      expect.objectContaining({ id: 'low', endpointTouches: 1 }),
    ]);
    const text = buildSpecializedTransitUnmappedResearchText(dataset);
    expect(text).toContain('Unmapped locations: 2');
    expect(text).toContain('1. High Priority | 10 endpoint touches | ID high | Aliases: High');
    expect(text).toContain('2. Low Priority | 1 endpoint touches | ID low');
    expect(text).not.toContain('Already Mapped');
  });
});
