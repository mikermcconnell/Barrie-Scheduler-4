import { describe, expect, it, vi, afterEach } from 'vitest';
import { passesCityGate, buildCityConstrainedQueries } from '../utils/od-matrix/odMatrixGeocoder';
import { geocodeStations } from '../utils/od-matrix/odMatrixGeocoder';
import type { ODStation } from '../utils/od-matrix/odMatrixTypes';

describe('passesCityGate', () => {
    it('passes when display_name contains the city token', () => {
        expect(passesCityGate(
            'Orillia Recreation Centre, Orillia, Simcoe County, Ontario, Canada',
            'Orillia',
        )).toBe(true);
    });

    it('fails when display_name does not contain the city token', () => {
        expect(passesCityGate(
            'Recreation Centre, Kitchener, Waterloo Region, Ontario, Canada',
            'Orillia',
        )).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(passesCityGate(
            'orillia recreation centre, orillia, ontario, canada',
            'Orillia',
        )).toBe(true);
    });

    it('matches multi-word city names', () => {
        expect(passesCityGate(
            'Hospital, Sault Ste. Marie, Ontario, Canada',
            'Sault Ste Marie',
        )).toBe(true);
    });

    it('returns true when city is null (no city prefix in station name)', () => {
        expect(passesCityGate(
            'Barrie, Ontario, Canada',
            null,
        )).toBe(true);
    });
});

describe('buildCityConstrainedQueries', () => {
    it('builds city-constrained queries for a city + place station', () => {
        const queries = buildCityConstrainedQueries('Orillia', 'Rec Centre');
        expect(queries).toContain('Rec Centre, Orillia, Ontario, Canada');
        expect(queries).toContain('Rec Centre Orillia, Ontario, Canada');
        expect(queries).toContain('Orillia Rec Centre, Ontario, Canada');
    });

    it('returns empty array when city is null', () => {
        expect(buildCityConstrainedQueries(null, 'Union Station')).toEqual([]);
    });

    it('dedupes queries', () => {
        const queries = buildCityConstrainedQueries('Barrie', 'Barrie');
        const unique = new Set(queries.map(q => q.toLowerCase()));
        expect(unique.size).toBe(queries.length);
    });
});

describe('geocodeStation city gate integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects a result in the wrong city and retries with city constraint', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            const urlStr = typeof url === 'string' ? url : url.toString();

            // City-constrained retry queries contain "Ontario" explicitly
            if (urlStr.includes('Ontario')) {
                return new Response(JSON.stringify([{
                    lat: '44.6083',
                    lon: '-79.4197',
                    display_name: 'Recreation Centre, Orillia, Simcoe County, Ontario, Canada',
                    importance: 0.4,
                }]));
            }

            // Normal queries — return a Kitchener result (wrong city)
            return new Response(JSON.stringify([{
                lat: '43.4516',
                lon: '-80.4925',
                display_name: 'Recreation Centre, Kitchener, Waterloo Region, Ontario, Canada',
                importance: 0.5,
            }]));
        });

        const stations: ODStation[] = [
            { name: 'Orillia - Rec Centre', totalOrigin: 5, totalDestination: 3, totalVolume: 8 },
        ];

        const result = await geocodeStations(stations, null);

        expect(result.failed).not.toContain('Orillia - Rec Centre');
        expect(result.geocoded).toBe(1);

        const loc = result.cache.stations['Orillia - Rec Centre'];
        expect(loc).toBeDefined();
        expect(loc.lat).toBeGreaterThan(44);
    });

    it('flags as failed when both normal and retry queries return wrong city', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify([{
                lat: '43.4516',
                lon: '-80.4925',
                display_name: 'Recreation Centre, Kitchener, Waterloo Region, Ontario, Canada',
                importance: 0.5,
            }]));
        });

        const stations: ODStation[] = [
            { name: 'Orillia - Rec Centre', totalOrigin: 5, totalDestination: 3, totalVolume: 8 },
        ];

        const result = await geocodeStations(stations, null);

        expect(result.failed).toContain('Orillia - Rec Centre');
        expect(result.geocoded).toBe(0);
    });

    it('skips city gate for stations without city prefix', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify([{
                lat: '44.3891',
                lon: '-79.6903',
                display_name: 'Barrie, Simcoe County, Ontario, Canada',
                importance: 0.7,
            }]));
        });

        const stations: ODStation[] = [
            { name: 'Barrie', totalOrigin: 10, totalDestination: 10, totalVolume: 20 },
        ];

        const result = await geocodeStations(stations, null);

        expect(result.geocoded).toBe(1);
        expect(result.failed).toHaveLength(0);
    });
});
