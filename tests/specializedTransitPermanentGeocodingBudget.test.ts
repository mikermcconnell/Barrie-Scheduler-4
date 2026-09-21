import { describe, expect, it } from 'vitest';
import {
  claimSpecializedTransitPermanentGeocodingRequest,
  getSpecializedTransitPermanentGeocodingUsage,
  SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT,
  SpecializedTransitGeocodingBudgetError,
} from '../utils/specialized-transit/permanentGeocodingBudget';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('Specialized Transit Permanent Geocoding budget', () => {
  it('stops before a browser can send 1,000 requests in one month', () => {
    const storage = memoryStorage();
    const now = new Date('2026-09-15T12:00:00Z');
    for (let count = 0; count < SPECIALIZED_TRANSIT_PERMANENT_GEOCODING_LIMIT; count += 1) {
      claimSpecializedTransitPermanentGeocodingRequest({ storage, now });
    }

    expect(getSpecializedTransitPermanentGeocodingUsage({ storage, now })).toEqual({
      month: '2026-09',
      used: 999,
      limit: 999,
      remaining: 0,
      trackingAvailable: true,
    });
    expect(() => claimSpecializedTransitPermanentGeocodingRequest({ storage, now }))
      .toThrow(SpecializedTransitGeocodingBudgetError);
  });

  it('starts a new counter in the next calendar month', () => {
    const storage = memoryStorage();
    claimSpecializedTransitPermanentGeocodingRequest({
      storage,
      now: new Date('2026-09-30T23:59:59Z'),
    });

    expect(getSpecializedTransitPermanentGeocodingUsage({
      storage,
      now: new Date('2026-10-01T00:00:00Z'),
    }).used).toBe(0);
  });
});
