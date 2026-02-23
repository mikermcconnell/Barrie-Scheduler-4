import { describe, expect, it, vi, afterEach } from 'vitest';
import { geocodeStations } from '../utils/od-matrix/odMatrixGeocoder';
import type { GeocodeCache, ODStation } from '../utils/od-matrix/odMatrixTypes';

describe('odMatrixGeocoder cache reuse', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reuses manually entered coordinates for the same stop name on re-upload', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const stations: ODStation[] = [
            { name: 'North Bay', totalOrigin: 10, totalDestination: 12, totalVolume: 22 },
        ];
        const existingCache: GeocodeCache = {
            stations: {
                'North Bay': {
                    lat: 46.3091,
                    lon: -79.4608,
                    displayName: 'North Bay (manual)',
                    source: 'manual',
                    confidence: 'high',
                },
            },
            lastUpdated: new Date().toISOString(),
        };

        const result = await geocodeStations(stations, existingCache);

        expect(result.cached).toBe(1);
        expect(result.geocoded).toBe(0);
        expect(result.failed).toHaveLength(0);
        expect(result.cache.stations['North Bay']).toMatchObject({
            lat: 46.3091,
            lon: -79.4608,
            source: 'manual',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reuses manual coordinates when stop name matches case-insensitively', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const stations: ODStation[] = [
            { name: 'north bay', totalOrigin: 1, totalDestination: 1, totalVolume: 2 },
        ];
        const existingCache: GeocodeCache = {
            stations: {
                'North Bay': {
                    lat: 46.3091,
                    lon: -79.4608,
                    displayName: 'North Bay (manual)',
                    source: 'manual',
                    confidence: 'high',
                },
            },
            lastUpdated: new Date().toISOString(),
        };

        const result = await geocodeStations(stations, existingCache);

        expect(result.cached).toBe(1);
        expect(result.failed).toHaveLength(0);
        expect(result.cache.stations['north bay']).toMatchObject({
            lat: 46.3091,
            lon: -79.4608,
            source: 'manual',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
