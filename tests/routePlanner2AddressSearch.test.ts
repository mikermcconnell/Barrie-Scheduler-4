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

  it('trims accidental whitespace from Mapbox tokens before building URLs', () => {
    const url = buildRoutePlanner2AddressSearchUrl('70 Collier Street', 'token-123\r\n');

    expect(url).toContain('access_token=token-123');
    expect(url).not.toContain('%0D');
    expect(url).not.toContain('%0A');
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

  it('returns cached Barrie place suggestions when Mapbox does not find POI names', async () => {
    const fetcher = vi.fn();

    const results = await searchRoutePlanner2Addresses('Sadlon Arena', {
      fetcher,
      token: null,
    });

    expect(results[0]).toMatchObject({
      id: 'popular-place-sadlon-arena',
      name: 'Sadlon Arena',
      label: 'Sadlon Arena · 555 Bayview Dr, Barrie, ON L4N 8Y2',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('trims accidental whitespace from Mapbox tokens before direct search', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = String(input);
      expect(requestUrl).toContain('access_token=token-123');
      expect(requestUrl).not.toContain('%0D');
      expect(requestUrl).not.toContain('%0A');

      return {
        ok: true,
        status: 200,
        json: async (): Promise<{ features: unknown[] }> => ({ features: [] }),
      };
    }) as unknown as typeof fetch;

    await searchRoutePlanner2Addresses('70 Collier', {
      token: 'token-123\r\n',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('can use the server geocode endpoint and reports diagnostics', async () => {
    const diagnostics: unknown[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/route-planner-geocode');
      expect(init?.method).toBe('POST');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          suggestions: [
            {
              id: 'address.1',
              name: '37 Johnson Street',
              label: '37 Johnson Street, Barrie, Ontario, Canada',
              lat: 44.41,
              lng: -79.66,
            },
          ],
          diagnostic: {
            query: '37 Johnson St',
            source: 'server',
            status: 200,
            tokenPresent: true,
            resultCount: 1,
            topResultLabel: '37 Johnson Street, Barrie, Ontario, Canada',
          },
        }),
      };
    }) as unknown as typeof fetch;

    const results = await searchRoutePlanner2Addresses('37 Johnson St', {
      fetcher,
      preferServerProxy: true,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.label).toContain('37 Johnson Street');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        source: 'server',
        status: 200,
        tokenPresent: true,
        resultCount: 1,
      }),
    ]);
  });

  it('falls back to direct Mapbox search when the server endpoint is unavailable', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          features: [
            {
              id: 'address.2',
              text: '339 Essa Road',
              place_name: '339 Essa Road, Barrie, Ontario, Canada',
              center: [-79.71, 44.36],
            },
          ],
        }),
      }) as unknown as typeof fetch;

    const results = await searchRoutePlanner2Addresses('339 Essa Rd', {
      token: 'token-123',
      fetcher,
      preferServerProxy: true,
    });

    expect(results[0]?.label).toContain('339 Essa Road');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('falls back when production hosting rewrites the server endpoint to non-JSON HTML', async () => {
    const diagnostics: unknown[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          features: [
            {
              id: 'address.3',
              text: '37 Johnson Street',
              place_name: '37 Johnson Street, Barrie, Ontario, Canada',
              center: [-79.66, 44.41],
            },
          ],
        }),
      }) as unknown as typeof fetch;

    const results = await searchRoutePlanner2Addresses('37 Johnson St', {
      token: 'token-123',
      fetcher,
      preferServerProxy: true,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(results[0]?.label).toContain('37 Johnson Street');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      source: 'server',
      status: 200,
      error: 'Server geocode returned an invalid response.',
    }));
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
