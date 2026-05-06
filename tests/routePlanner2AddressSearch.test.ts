import { describe, expect, it, vi } from 'vitest';

import {
  buildRoutePlanner2AddressSearchUrl,
  searchRoutePlanner2Addresses,
} from '../utils/route-planner-2/routePlanner2AddressSearch';

describe('routePlanner2AddressSearch', () => {
  it('builds an autocomplete URL scoped near Barrie', () => {
    const url = buildRoutePlanner2AddressSearchUrl('70 Collier Street', 'token-123');

    expect(url).toContain('https://api.mapbox.com/geocoding/v5/mapbox.places/70%20Collier%20Street.json');
    expect(url).toContain('autocomplete=true');
    expect(url).toContain('country=ca');
    expect(url).toContain('proximity=-79.69%2C44.38');
    expect(url).toContain('access_token=token-123');
  });

  it('returns address suggestions with coordinates and labels', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [
          {
            id: 'address.1',
            text: '70 Collier Street',
            place_name: '70 Collier Street, Barrie, Ontario, Canada',
            center: [-79.689, 44.389],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const results = await searchRoutePlanner2Addresses('70 Collier', {
      token: 'token-123',
      fetcher,
    });

    expect(results).toEqual([
      {
        id: 'address.1',
        name: '70 Collier Street',
        label: '70 Collier Street, Barrie, Ontario, Canada',
        lat: 44.389,
        lng: -79.689,
      },
    ]);
  });

  it('does not search until the query is specific enough', async () => {
    const fetcher = vi.fn();

    const results = await searchRoutePlanner2Addresses('70', {
      token: 'token-123',
      fetcher,
    });

    expect(results).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
