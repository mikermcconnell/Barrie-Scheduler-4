import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findSpecializedTransitLocationCandidates,
  getSpecializedTransitRecommendedAddress,
  getSpecializedTransitCoordinateCollisionIds,
  resolveSpecializedTransitLocations,
} from '../utils/specialized-transit/locationResolver';

function mapboxResponse(features: unknown[]): Response {
  return new Response(JSON.stringify({ features }), { status: 200 });
}

describe('Specialized Transit location resolver', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the canonical Barrie directory for abbreviated recurring destinations', async () => {
    const fetcher = vi.fn();
    const candidates = await findSpecializedTransitLocationCandidates({
      id: 'parkview',
      label: 'Parkview Senior Ctr. (LOC)',
    }, { token: null, fetcher });

    expect(fetcher).not.toHaveBeenCalled();
    expect(candidates[0]).toEqual(expect.objectContaining({
      displayName: expect.stringContaining('189 Blake Street'),
      latitude: 44.394843,
      longitude: -79.665582,
      source: 'known-place',
      trusted: true,
    }));
  });

  it('resolves the canonical RVH campus name without geocoding and keeps off-site names separate', async () => {
    const fetcher = vi.fn().mockResolvedValue(mapboxResponse([]));
    const candidates = await findSpecializedTransitLocationCandidates({
      id: 'st-rvh-campus', label: 'Royal Victoria Regional Health Centre (RVH)',
    }, { token: 'token', fetcher });

    expect(fetcher).not.toHaveBeenCalled();
    expect(candidates[0]).toEqual(expect.objectContaining({
      latitude: 44.414145, longitude: -79.661147, source: 'known-place', trusted: true,
    }));

    const offsite = await findSpecializedTransitLocationCandidates({
      id: 'offsite', label: 'Royal Victoria Regional Health Centre Dialysis Clinic',
    }, { token: 'token', fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(offsite).toEqual([]);
  });

  it('recognizes the approved common-location address directory', () => {
    expect(getSpecializedTransitRecommendedAddress('Barrie Primary Care PICK & DROP')).toBe('370 Bayview Drive, Barrie, Ontario');
    expect(getSpecializedTransitRecommendedAddress('Bayfield Mall ( Planet Fitness)')).toBe('320 Bayfield Street, Barrie, Ontario');
    expect(getSpecializedTransitRecommendedAddress('Bayfield Mall - North Door')).toBe('320 Bayfield Street, Barrie, Ontario');
    expect(getSpecializedTransitRecommendedAddress('Little Lake Health Centre ( LOC)')).toBe('11 Lakeside Terrace, Barrie, Ontario');
    expect(getSpecializedTransitRecommendedAddress('Tim Hortons - Cundles at St. V')).toBe('201 Cundles Road East, Barrie, Ontario');
    expect(getSpecializedTransitRecommendedAddress('Allandale Waterfront GO Statio')).toBe('24 Essa Road, Barrie, Ontario');
    expect(getSpecializedTransitRecommendedAddress('Staples')).toBeNull();
  });

  it('covers every approved address label from the manager review', () => {
    const approvedLabels = [
      'Barrie Primary Care PICK & DRO', 'Coleman\'s Health Care -1 st door',
      'St. Paul\'s Anglican Church', 'South Barrie Walk - In Clinic ( G',
      'Bayfield Mall ( Planet Fitness)', 'Shoppers Drug Mart ( Wellingto',
      'Centennial Beach - Flags', 'Barrie Manor', 'Gilda\'s Club',
      'First Baptist Church', 'Georgian Professional Bldg. (L',
      'Little Lake Health Centre', 'Atrium B / D', 'Victoria Village Manor',
      'BATT - Barrie Allandale Transi', 'TD Canada Trust - Collier',
      'Hope Church', 'Harvest Bible Chapel', 'Holy Spirit', 'St Mary\'s Church',
      'Shoppers Drug Mart ( Yonge st)', 'Bowlerama Barrie',
      'BobRumball Center for the Deaf', 'Bayfield Mall - Bowling',
      'CNIB - Collier Street ( LOC)', 'Waterford Retirement Community',
      'Giant Tiger North', 'Freshco Bayfield', 'Whispering Pines',
      'Barrie Food Bank', 'Mapleview Community Church', 'Deb\'s restuarant',
      'Collier United Church', 'Mill Creek Care Center', 'XPlay Amusements',
      'TD Canada Trust - Yonge', 'Heritage Park', 'Ferris Lane Community Church',
      'Food Basics', 'Fox\'s Bakery', 'Barrie Public Library - Painswic',
      'Michael\'s Arts & Crafts', 'Scotiabank - Collier',
      'CIBC - Bayfield / Cundles', 'Barrie Anne Gardens', 'No Frills - Blake St.',
      'Danny\'s Fish and Chips', 'Bloom Bistro & Bar',
      'Collier Place Seniors Residenc', 'Rinaldi Salon', 'Italian Bakery',
      'CIBC - Yonge', 'William\'s Fresh Cafe', 'Barrington Retirement Home ( LO',
      'westside church', 'Celebration Church', 'Grace United Church',
      'Hi - Way Church', 'Great Clips North Crossing', 'Sunnidale Park Ctr.',
      'Costco', 'Service Ontario - Simcoe', 'Little Lake Health Centre ( LOC',
      'Bayfield Mall - North Door', 'Talize Thrift Store', 'Zehrs - Bayfield',
      'Freshco', 'Bayfield Mall - Centra', 'Giant Tiger - South',
      'Royal Bank - Bayfield / Collier', 'Bingo',
      'Tim Hortons - Cundles at St. V', 'Royal Bank - Bayfield',
      'Allandale Waterfront GO Statio', 'Donaleigh\'s Irish Public House',
    ];

    expect(approvedLabels).toHaveLength(75);
    for (const label of approvedLabels) {
      expect(getSpecializedTransitRecommendedAddress(label), label).not.toBeNull();
    }
  });

  it('uses an approved civic address as the permanent query and accepts shared building coordinates', async () => {
    const fetcher = vi.fn().mockImplementation(async () => mapboxResponse([{
      id: 'address.320-bayfield',
      text: 'Bayfield Street',
      address: '320',
      place_name: '320 Bayfield Street, Barrie, Ontario, Canada',
      place_type: ['address'],
      center: [-79.704, 44.402],
      relevance: 1,
    }]));

    const resolved = await resolveSpecializedTransitLocations([
      { id: 'planet-fitness', label: 'Bayfield Mall ( Planet Fitness)' },
      { id: 'bowling', label: 'Bayfield Mall - Bowling' },
      { id: 'north-door', label: 'Bayfield Mall - North Door' },
    ], { token: 'token', fetcher });

    expect(resolved.geocodes).toHaveLength(3);
    expect(resolved.geocodes.every(result => result.source === 'known-place')).toBe(true);
    expect(resolved.unresolved).toEqual([]);
    for (const call of fetcher.mock.calls) {
      const requestedUrl = new URL(String(call[0]));
      expect(decodeURIComponent(requestedUrl.pathname)).toContain('320 Bayfield Street');
      expect(requestedUrl.searchParams.get('permanent')).toBe('true');
    }
  });

  it.each([
    'Eagle Ridge Medical - Front Door',
    'Von Canada',
    'Great Clips Hair Salon',
    'Scotiabank - Bayfield',
    'Royal Court Medical Ctr ( LOC)',
    'Budhist Temple',
    'Cineplex Odeon',
    'Bibles for Missions',
    'Will Dwyer Park',
    'Simcoe Cnty Dist. Health Unit',
    'Tim Hortons - Cundles - North',
    'Shoppers Drug Mart ( Bayfield)',
    'Tim Hortons - Yonge at Mapleview',
    'Camphill',
    'Brain Injury Services',
    'EUROPEAN FINE FOOD & DELI',
    'Staples',
    'CMHA - Mental Health CNTR',
    'Christian Horizons Group Home',
    'The UPS Store',
    'Old Navy',
    'Life Labs',
    'Kingdom Hall',
  ])('does not trust a name-only POI for a held label or an approved civic query: %s', async (label) => {
    const fetcher = vi.fn().mockResolvedValue(mapboxResponse([{
      id: `poi.${label}`,
      text: label,
      place_name: `${label}, Barrie, Ontario, Canada`,
      place_type: ['poi'],
      center: [-79.69, 44.39],
      relevance: 1,
    }]));

    const candidates = await findSpecializedTransitLocationCandidates({ id: label, label }, { token: 'token', fetcher });
    expect(candidates[0]).toEqual(expect.objectContaining({
      trusted: false,
      reason: expect.stringContaining('requires manager review'),
    }));
  });

  it('keeps a high-relevance but semantically unrelated address in manual review', async () => {
    const fetcher = vi.fn().mockImplementation(async () => mapboxResponse([{
      id: 'address.centre-road',
      text: 'Centre Road',
      place_name: 'Centre Road, Barrie, Ontario, Canada',
      place_type: ['address'],
      center: [-79.65, 44.35],
      relevance: 0.93,
    }]));

    const candidates = await findSpecializedTransitLocationCandidates({
      id: 'native-centre',
      label: 'Native Centre',
    }, { token: 'token', fetcher });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({ trusted: false, semanticScore: 0 }));
    const resolved = await resolveSpecializedTransitLocations(
      [{ id: 'native-centre', label: 'Native Centre' }],
      { token: 'token', fetcher },
    );
    expect(resolved.geocodes).toEqual([]);
    expect(resolved.unresolved).toEqual([{ originId: 'native-centre', reason: 'low-confidence' }]);
  });

  it('trusts a matching address number and street inside the Barrie analysis area', async () => {
    const fetcher = vi.fn().mockResolvedValue(mapboxResponse([{
      id: 'address.477-grove',
      text: 'Grove Street East',
      address: '477',
      place_name: '477 Grove Street East, Barrie, Ontario, Canada',
      place_type: ['address'],
      center: [-79.66, 44.40],
      relevance: 1,
    }]));
    const resolved = await resolveSpecializedTransitLocations(
      [{ id: 'grove', label: '477 Grove St E' }],
      { token: 'token', fetcher },
    );

    expect(resolved.geocodes).toEqual([expect.objectContaining({
      originId: 'grove',
      latitude: 44.40,
      longitude: -79.66,
      source: 'mapbox-permanent',
    })]);
    expect(resolved.unresolved).toEqual([]);
    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(requestedUrl.searchParams.get('permanent')).toBe('true');
  });

  it.each([
    { label: "Gilda's Club", address: '99', placeName: '99 Quarry Ridge Road, Barrie, Ontario, Canada' },
    { label: '90 Collier Street Unit 5', address: '5', placeName: '5 Collier Street, Barrie, Ontario, Canada' },
    { label: '90 Collier Street Unit 5', address: '99', placeName: '99 Collier Street Unit 5, Barrie, Ontario, Canada' },
    { label: '10 Quarry Ridge Road', address: undefined, placeName: 'Quarry Ridge Road, Barrie, Ontario, Canada' },
  ])('does not trust a conflicting or absent civic number for $label', async ({ label, address, placeName }) => {
    const fetcher = vi.fn().mockResolvedValue(mapboxResponse([{
      address,
      place_name: placeName,
      place_type: ['address'],
      center: [-79.66, 44.40],
      relevance: 1,
    }]));
    const candidates = await findSpecializedTransitLocationCandidates({ id: 'address', label }, { token: 'token', fetcher });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({ trusted: false, source: 'mapbox-permanent' }));
  });

  it.each(['90 Collier Street Unit 5', 'Unit 5, 90 Collier Street', '5-90 Collier Street'])(
    'matches the civic number rather than the unit in %s', async (label) => {
      const fetcher = vi.fn().mockResolvedValue(mapboxResponse([{
        address: '90',
        place_name: '90 Collier Street, Barrie, Ontario, Canada',
        place_type: ['address'],
        center: [-79.66, 44.40],
        relevance: 1,
      }]));
      const candidates = await findSpecializedTransitLocationCandidates({ id: 'address', label }, { token: 'token', fetcher });
      expect(candidates[0]?.trusted).toBe(true);
    },
  );

  it('keeps a generic multi-location business label in review even when the POI name matches', async () => {
    const fetcher = vi.fn().mockResolvedValue(mapboxResponse([{
      id: 'poi.starbucks',
      text: 'Starbucks',
      place_name: 'Starbucks, Barrie, Ontario, Canada',
      place_type: ['poi'],
      center: [-79.69, 44.39],
      relevance: 1,
    }]));
    const candidates = await findSpecializedTransitLocationCandidates(
      { id: 'starbucks', label: 'Starbucks' },
      { token: 'token', fetcher },
    );

    expect(candidates[0]).toEqual(expect.objectContaining({
      trusted: false,
      reason: expect.stringContaining('requires manager review'),
    }));
  });

  it('rejects three unrelated labels that collapse onto one automatic coordinate', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mapboxResponse([{ text: 'Alpha Clinic', place_name: 'Alpha Clinic, Barrie', place_type: ['poi'], center: [-79.67, 44.39], relevance: 0.9 }]))
      .mockResolvedValueOnce(mapboxResponse([{ text: 'Bravo Pharmacy', place_name: 'Bravo Pharmacy, Barrie', place_type: ['poi'], center: [-79.67, 44.39], relevance: 0.9 }]))
      .mockResolvedValueOnce(mapboxResponse([{ text: 'Charlie Church', place_name: 'Charlie Church, Barrie', place_type: ['poi'], center: [-79.67, 44.39], relevance: 0.9 }]));

    const resolved = await resolveSpecializedTransitLocations([
      { id: 'alpha', label: 'Alpha Clinic' },
      { id: 'bravo', label: 'Bravo Pharmacy' },
      { id: 'charlie', label: 'Charlie Church' },
    ], { token: 'token', fetcher });

    expect(resolved.geocodes).toEqual([]);
    expect(resolved.unresolved).toEqual(expect.arrayContaining([
      { originId: 'alpha', reason: 'coordinate-collision' },
      { originId: 'bravo', reason: 'coordinate-collision' },
      { originId: 'charlie', reason: 'coordinate-collision' },
    ]));
  });

  it('identifies mapped locations that need duplicate-coordinate review', () => {
    expect([...getSpecializedTransitCoordinateCollisionIds([
      { id: 'a', latitude: 44.4, longitude: -79.7 },
      { id: 'b', latitude: 44.4, longitude: -79.7 },
      { id: 'c', latitude: null, longitude: null },
    ])].sort()).toEqual(['a', 'b']);
  });
});
