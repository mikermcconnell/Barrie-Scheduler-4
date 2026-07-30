import { describe, expect, it, vi } from 'vitest';
import {
    buildFareProgramOriginGeocodeUrl,
    geocodeFareProgramOrigins,
} from '../utils/fare-programs/fareProgramsOriginGeocoder';
import type { FareProgramOriginArea } from '../utils/fare-programs/fareProgramsSnapshot';

const origin: FareProgramOriginArea = {
    id: 'origin-1',
    label: 'Grove St E area',
    geocodeQuery: 'Grove St E',
    uses: 3,
    buckets: {
        weekday: { 'before-6': 0, morning: 1, 'school-day': 1, afternoon: 1, evening: 0 },
        weekend: { 'before-6': 0, morning: 0, 'school-day': 0, afternoon: 0, evening: 0 },
    },
};

describe('Fare Programs origin geocoder', () => {
    it('builds a temporary Barrie-bounded geocoding request from the sanitized query', () => {
        const url = new URL(buildFareProgramOriginGeocodeUrl(origin.geocodeQuery, 'token'));
        expect(decodeURIComponent(url.pathname)).toContain('Grove St E, Barrie, Ontario, Canada');
        expect(url.searchParams.get('bbox')).toBe('-79.85,44.25,-79.55,44.5');
        expect(url.searchParams.get('permanent')).toBeNull();
        expect(url.searchParams.get('autocomplete')).toBe('false');
    });

    it('returns only valid results inside Barrie and reports failures', async () => {
        const secondOrigin = { ...origin, id: 'origin-2', label: 'Unknown area' };
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                features: [{ center: [-79.69, 44.40], relevance: 0.95 }],
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                features: [{ center: [-80.50, 44.40], relevance: 0.8 }],
            }), { status: 200 }));

        const result = await geocodeFareProgramOrigins([origin, secondOrigin], {
            token: 'token',
            fetcher,
        });

        expect(result.geocodes).toEqual([
            { originId: 'origin-1', latitude: 44.40, longitude: -79.69, relevance: 0.95, source: 'mapbox' },
        ]);
        expect(result.failedOriginIds).toEqual(['origin-2']);
    });

    it('uses an exact bundled GTFS stop before calling Mapbox', async () => {
        const fetcher = vi.fn();
        const stopOrigin = { ...origin, id: 'downtown-hub', label: 'Downtown Hub', geocodeQuery: 'Downtown Hub' };

        const result = await geocodeFareProgramOrigins([stopOrigin], {
            token: 'token',
            fetcher,
        });

        expect(fetcher).not.toHaveBeenCalled();
        expect(result.geocodes[0]).toEqual(expect.objectContaining({
            originId: 'downtown-hub',
            source: 'gtfs-stop',
            latitude: expect.any(Number),
            longitude: expect.any(Number),
        }));
    });
});
