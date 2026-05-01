import { describe, expect, it } from 'vitest';

import { matchRoutePlanner2StopToGtfsStop } from '../utils/route-planner-2/routePlanner2StopMatching';
import type { RoutePlanner2Stop } from '../utils/route-planner-2/routePlanner2Types';
import type { GtfsStopWithCoords } from '../utils/gtfs/gtfsStopLookup';

const stop = (patch: Partial<RoutePlanner2Stop>): RoutePlanner2Stop => ({
  id: 'rp-stop-1',
  name: 'Downtown Terminal',
  lat: 44.389,
  lng: -79.69,
  sequence: 1,
  role: 'regular',
  source: 'custom',
  ...patch,
});

const gtfsStops: GtfsStopWithCoords[] = [
  { stop_id: '1000', stop_code: '1000', stop_name: 'Downtown Terminal', lat: 44.389, lon: -79.69 },
  { stop_id: '2000', stop_code: '2000', stop_name: 'Georgian College', lat: 44.412, lon: -79.668 },
];

describe('matchRoutePlanner2StopToGtfsStop', () => {
  it('matches exact stop code before name', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ stopCode: '2000', name: 'Downtown Terminal' }), gtfsStops);

    expect(match).toMatchObject({
      routePlannerStopId: 'rp-stop-1',
      gtfsStopId: '2000',
      gtfsStopName: 'Georgian College',
      quality: 'exact-code',
    });
  });

  it('matches by normalized stop name when code is absent', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ name: 'Downtown & Terminal!!!' }), [
      { stop_id: '1000', stop_code: '1000', stop_name: 'Downtown and Terminal', lat: 44.389, lon: -79.69 },
    ]);

    expect(match).toMatchObject({
      gtfsStopId: '1000',
      quality: 'name',
    });
  });

  it('matches by nearby coordinate within 100 metres', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ name: 'Planner Stop', lat: 44.3892, lng: -79.6902 }), gtfsStops);

    expect(match?.gtfsStopId).toBe('1000');
    expect(match?.quality).toBe('nearby');
    expect(match?.distanceMeters).toBeGreaterThan(0);
    expect(match?.distanceMeters).toBeLessThanOrEqual(100);
  });

  it('returns null when no stop is close enough', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ name: 'Far Stop', lat: 44.6, lng: -79.9 }), gtfsStops);

    expect(match).toBeNull();
  });
});
