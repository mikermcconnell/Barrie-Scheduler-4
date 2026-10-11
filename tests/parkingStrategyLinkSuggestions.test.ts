import { describe, expect, it } from 'vitest';
import type { ParkingRevenueLocationMapping } from '../utils/parking/parkingTypes';
import { DEFAULT_PARKING_REVENUE_LOCATIONS } from '../utils/parking/parkingDefaultLocations';
import { PARKING_STRATEGY_FIRST_PASS, suggestParkingStrategyLinks } from '../utils/parking/parkingStrategyLinkSuggestions';

describe('Parking strategy first-pass links', () => {
  const meters = Object.keys(PARKING_STRATEGY_FIRST_PASS).map(domain => ({ domain, sourceKey: domain }));
  it('resolves all eight named areas uniquely in the existing physical registry', () => {
    const result = suggestParkingStrategyLinks(meters, DEFAULT_PARKING_REVENUE_LOCATIONS, {});
    expect(result.suggestedKeys).toHaveLength(8);
    expect(result.mappings.marina).not.toBe(result.mappings.northmarina);
  });
  it('preserves saved links and unrelated sources without mutating inputs', () => {
    const existing = { marina: 'user-choice', other: 'keep' };
    const result = suggestParkingStrategyLinks(meters, DEFAULT_PARKING_REVENUE_LOCATIONS, existing);
    expect(result.mappings).toMatchObject(existing);
    expect(result.suggestedKeys).not.toContain('marina');
    expect(existing).toEqual({ marina: 'user-choice', other: 'keep' });
  });
  it('does not collapse directional or ambiguous source areas', () => {
    const ambiguous = ['heritageparkeast', 'heritageparknorth', 'northvictoria', 'northcentennialbeach', 'lakeshoredrive'];
    expect(suggestParkingStrategyLinks(ambiguous.map(domain => ({ domain, sourceKey: domain })), DEFAULT_PARKING_REVENUE_LOCATIONS, {}).suggestedKeys).toEqual([]);
  });
  it('rejects missing, non-spatial and duplicate target names', () => {
    const location: ParkingRevenueLocationMapping = { id: 'one', displayName: 'Marina Parking Lot', latitude: 44, longitude: -79, sourceRefs: [] };
    expect(suggestParkingStrategyLinks(meters, [], {}).suggestedKeys).toEqual([]);
    expect(suggestParkingStrategyLinks(meters, [{ ...location, locationKind: 'non_spatial' }], {}).suggestedKeys).toEqual([]);
    expect(suggestParkingStrategyLinks(meters, [location, { ...location, id: 'two' }], {}).suggestedKeys).toEqual([]);
  });
});
