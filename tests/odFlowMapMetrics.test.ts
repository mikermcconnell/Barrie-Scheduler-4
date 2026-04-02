import { describe, expect, it } from 'vitest';
import {
    buildScopedGeoLookup,
    buildVisibleStopMetrics,
    filterODPairs,
    getGeocodedPairs,
} from '../utils/od-matrix/odFlowMapMetrics';
import type { GeocodeCache, ODPairRecord, ODStation } from '../utils/od-matrix/odMatrixTypes';

const stations: ODStation[] = [
    { name: 'Barrie', totalOrigin: 10, totalDestination: 4, totalVolume: 14 },
    { name: 'Sudbury', totalOrigin: 7, totalDestination: 12, totalVolume: 19 },
];

const geocodeCache: GeocodeCache = {
    lastUpdated: '2026-04-02T00:00:00.000Z',
    stations: {
        Barrie: { lat: 44.3894, lon: -79.6903, displayName: 'Barrie', source: 'manual', confidence: 'high' },
        Sudbury: { lat: 46.4917, lon: -80.9930, displayName: 'Sudbury', source: 'manual', confidence: 'high' },
        Toronto: { lat: 43.6532, lon: -79.3832, displayName: 'Toronto', source: 'manual', confidence: 'high' },
        Buffalo: { lat: 25.7617, lon: -80.1918, displayName: 'Buffalo', source: 'manual', confidence: 'high' },
    },
};

describe('odFlowMapMetrics', () => {
    it('scopes cached geocodes to the active dataset and tracks out-of-country stations only from that dataset', () => {
        const withOutsideStation: ODStation[] = [
            ...stations,
            { name: 'Buffalo', totalOrigin: 1, totalDestination: 1, totalVolume: 2 },
        ];

        const result = buildScopedGeoLookup(withOutsideStation, geocodeCache);

        expect(Object.keys(result.geoLookup).sort()).toEqual(['Barrie', 'Sudbury']);
        expect(result.outsideCanadaStations).toEqual(['Buffalo']);
        expect(result.geoLookup.Toronto).toBeUndefined();
    });

    it('filters pairs by min journeys, isolated station, and direction', () => {
        const pairs: ODPairRecord[] = [
            { origin: 'Barrie', destination: 'Sudbury', journeys: 12 },
            { origin: 'Sudbury', destination: 'Barrie', journeys: 8 },
            { origin: 'Barrie', destination: 'Toronto', journeys: 2 },
        ];

        expect(filterODPairs({
            pairs,
            isolatedStation: 'Barrie',
            directionFilter: 'outbound',
            minJourneys: 5,
        })).toEqual([
            { origin: 'Barrie', destination: 'Sudbury', journeys: 12 },
        ]);

        expect(filterODPairs({
            pairs,
            isolatedStation: 'Barrie',
            directionFilter: 'inbound',
            minJourneys: 5,
        })).toEqual([
            { origin: 'Sudbury', destination: 'Barrie', journeys: 8 },
        ]);
    });

    it('builds stop metrics from the already filtered visible pair set', () => {
        const metrics = buildVisibleStopMetrics([
            { origin: 'Barrie', destination: 'Sudbury', journeys: 12 },
            { origin: 'Barrie', destination: 'North Bay', journeys: 9 },
        ], 'Barrie');

        expect(metrics).toMatchObject({
            totalJourneys: 21,
            connections: 2,
            topOrig: { destination: 'Sudbury', journeys: 12 },
        });
        expect(metrics?.topDest).toBeUndefined();
    });

    it('keeps only fully geocoded pairs', () => {
        const geoLookup = buildScopedGeoLookup(stations, geocodeCache).geoLookup;
        const pairs: ODPairRecord[] = [
            { origin: 'Barrie', destination: 'Sudbury', journeys: 12 },
            { origin: 'Barrie', destination: 'North Bay', journeys: 7 },
        ];

        expect(getGeocodedPairs(pairs, geoLookup)).toEqual([
            { origin: 'Barrie', destination: 'Sudbury', journeys: 12 },
        ]);
    });
});
