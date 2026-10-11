import { beforeEach, describe, expect, it, vi } from 'vitest';
import reviewFixture from './fixtures/specializedTransitAddressReview.json';
import {
  findSpecializedTransitLocationCandidates,
  getSpecializedTransitRecommendedAddress,
  resolveSpecializedTransitLocations,
} from '../utils/specialized-transit/locationResolver';

// Frozen from the 2026-09-21 research proposal approved by the manager.
// Keep expected civic addresses independent of the runtime directory.
const approved = reviewFixture.filter(row => row.expectedAddress !== null);
const held = reviewFixture.filter(row => row.expectedAddress === null);

function addressResponse(address: string): Response {
  const [number, ...street] = address.split(' ');
  return new Response(JSON.stringify({
    features: [{
      id: `address.${address}`,
      address: number,
      text: street.join(' '),
      place_name: `${address}, Barrie, Ontario, Canada`,
      place_type: ['address'],
      center: [-79.69, 44.39],
      relevance: 1,
    }],
  }), { status: 200 });
}

function requestedQuery(request: unknown): string {
  return decodeURIComponent(new URL(String(request)).pathname)
    .replace('/geocoding/v5/mapbox.places/', '')
    .replace(/\.json$/, '');
}

describe('Specialized Transit approved September address review', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('covers the exact 70 approved and 51 held records from the 121-location review', () => {
    expect(reviewFixture).toHaveLength(121);
    expect(new Set(reviewFixture.map(row => row.id)).size).toBe(121);
    expect(approved).toHaveLength(70);
    expect(held).toHaveLength(51);
  });

  it.each(approved)('recommends and permanently geocodes the approved building for $label', async row => {
    const address = row.expectedAddress!;
    expect(getSpecializedTransitRecommendedAddress(row.label)).toBe(`${address}, Barrie, Ontario`);
    const fetcher = vi.fn().mockImplementation(async (_request: unknown) => addressResponse(address));

    const candidates = await findSpecializedTransitLocationCandidates(row, { token: 'token', fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0][0];
    expect(requestedQuery(request)).toMatch(new RegExp(`^${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`));
    expect(new URL(String(request)).searchParams.get('permanent')).toBe('true');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      originId: row.id,
      trusted: true,
      source: 'known-place',
      displayName: `${address}, Barrie, Ontario, Canada`,
    }));
  });

  it.each(held)('leaves the unapproved label without an address: $label', row => {
    expect(getSpecializedTransitRecommendedAddress(row.label)).toBeNull();
  });

  it('holds all 51 manual-review records without spending permanent geocoding requests', async () => {
    const fetcher = vi.fn();
    const onProgress = vi.fn();

    const result = await resolveSpecializedTransitLocations(held, { token: 'token', fetcher, onProgress });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.geocodes).toEqual([]);
    expect(result.unresolved).toHaveLength(51);
    expect(result.unresolved).toEqual(expect.arrayContaining(held.map(row => ({
      originId: row.id, reason: 'low-confidence',
    }))));
    expect(onProgress).toHaveBeenCalledTimes(51);
    expect(onProgress).toHaveBeenLastCalledWith(51, 51, expect.any(String));
  });

  it.each(approved)('rejects the wrong civic number for the approved address: $label', async row => {
    const wrongAddress = row.expectedAddress!.replace(/^\d+/, number => String(Number(number) + 10000));
    const fetcher = vi.fn().mockImplementation(async () => addressResponse(wrongAddress));

    const result = await resolveSpecializedTransitLocations([row], { token: 'token', fetcher });

    expect(result.geocodes).toEqual([]);
    expect(result.unresolved).toEqual([{ originId: row.id, reason: 'low-confidence' }]);
  });

  it('rejects a high-relevance named POI at the wrong approved civic number', async () => {
    const cityHall = approved.find(row => row.label === 'City Hall')!;
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      features: [{
        id: 'poi.wrong-city-hall',
        text: 'City Hall',
        address: '99',
        place_name: '99 Collier Street, Barrie Ontario Canada',
        place_type: ['poi'],
        center: [-79.69, 44.39],
        relevance: 1,
      }],
    }), { status: 200 }));

    const result = await resolveSpecializedTransitLocations([cityHall], { token: 'token', fetcher });

    expect(result.geocodes).toEqual([]);
    expect(result.unresolved).toEqual([{ originId: cityHall.id, reason: 'low-confidence' }]);
  });

  it('accepts distinct approved destinations sharing the same building coordinate', async () => {
    const sameBuilding = approved.filter(row => row.expectedAddress === '320 Bayfield Street');
    expect(sameBuilding).toHaveLength(3);
    const fetcher = vi.fn().mockImplementation(async () => addressResponse('320 Bayfield Street'));

    const result = await resolveSpecializedTransitLocations(sameBuilding, { token: 'token', fetcher });

    expect(result.unresolved).toEqual([]);
    expect(result.geocodes).toHaveLength(3);
    expect(new Set(result.geocodes.map(row => row.originId)).size).toBe(3);
    expect(result.geocodes.every(row => row.source === 'known-place')).toBe(true);
  });

  it('resolves exactly 70 of the original 121 records and retains the exact 51 held IDs', async () => {
    const fetcher = vi.fn().mockImplementation(async (request: unknown) => {
      const query = requestedQuery(request);
      const row = approved.find(candidate => query.startsWith(`${candidate.expectedAddress},`));
      if (!row?.expectedAddress) throw new Error(`Unexpected geocoding query: ${query}`);
      return addressResponse(row.expectedAddress);
    });

    const result = await resolveSpecializedTransitLocations(reviewFixture, { token: 'token', fetcher });

    expect(fetcher).toHaveBeenCalledTimes(70);
    expect(result.geocodes.map(row => row.originId).sort()).toEqual(approved.map(row => row.id).sort());
    expect(result.geocodes.every(row => row.source === 'known-place')).toBe(true);
    expect(result.unresolved).toHaveLength(51);
    expect(result.unresolved).toEqual(expect.arrayContaining(held.map(row => ({
      originId: row.id, reason: 'low-confidence',
    }))));
  });
});
