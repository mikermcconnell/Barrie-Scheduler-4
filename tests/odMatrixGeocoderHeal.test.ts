import { describe, expect, it } from 'vitest';
import { healCacheFromReference, purgeAutoEntries } from '../utils/od-matrix/odMatrixGeocoder';
import type { GeocodeCache } from '../utils/od-matrix/odMatrixTypes';

describe('healCacheFromReference', () => {
    it('replaces auto entries that now match reference lookup', () => {
        const cache: GeocodeCache = {
            stations: {
                'Barrie': {
                    lat: 40.0, lon: -70.0, // wrong coords from Nominatim
                    displayName: 'Barrie, NJ, USA',
                    source: 'auto',
                    confidence: 'medium',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const healed = healCacheFromReference(cache);
        expect(healed).toBe(1);
        expect(cache.stations['Barrie'].source).toBe('reference');
        expect(cache.stations['Barrie'].lat).toBeCloseTo(44.388, 2);
        expect(cache.stations['Barrie'].confidence).toBe('high');
    });

    it('skips manual entries', () => {
        const cache: GeocodeCache = {
            stations: {
                'Barrie': {
                    lat: 44.39, lon: -79.69,
                    displayName: 'Barrie (manual)',
                    source: 'manual',
                    confidence: 'high',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const healed = healCacheFromReference(cache);
        expect(healed).toBe(0);
        expect(cache.stations['Barrie'].source).toBe('manual');
    });

    it('skips reference entries', () => {
        const cache: GeocodeCache = {
            stations: {
                'Barrie': {
                    lat: 44.388, lon: -79.691,
                    displayName: 'BARRIE, ON (reference)',
                    source: 'reference',
                    confidence: 'high',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const healed = healCacheFromReference(cache);
        expect(healed).toBe(0);
    });

    it('skips auto entries with no reference match', () => {
        const cache: GeocodeCache = {
            stations: {
                'Narnia Station': {
                    lat: 50.0, lon: -80.0,
                    displayName: 'Narnia Station',
                    source: 'auto',
                    confidence: 'medium',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const healed = healCacheFromReference(cache);
        expect(healed).toBe(0);
        expect(cache.stations['Narnia Station'].source).toBe('auto');
    });

    it('heals multiple entries in one pass', () => {
        const cache: GeocodeCache = {
            stations: {
                'Sudbury': {
                    lat: 40.0, lon: -70.0,
                    displayName: 'wrong',
                    source: 'auto',
                    confidence: 'medium',
                },
                'Orillia': {
                    lat: 40.0, lon: -70.0,
                    displayName: 'wrong',
                    source: 'auto',
                    confidence: 'medium',
                },
                'Unknown Place': {
                    lat: 40.0, lon: -70.0,
                    displayName: 'unknown',
                    source: 'auto',
                    confidence: 'medium',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const healed = healCacheFromReference(cache);
        expect(healed).toBe(2);
        expect(cache.stations['Sudbury'].source).toBe('reference');
        expect(cache.stations['Orillia'].source).toBe('reference');
        expect(cache.stations['Unknown Place'].source).toBe('auto');
    });
});

describe('purgeAutoEntries', () => {
    it('removes only auto entries and returns count', () => {
        const cache: GeocodeCache = {
            stations: {
                'Barrie': {
                    lat: 44.388, lon: -79.691,
                    displayName: 'BARRIE, ON (reference)',
                    source: 'reference',
                    confidence: 'high',
                },
                'Some Auto Stop': {
                    lat: 46.0, lon: -80.0,
                    displayName: 'auto geocoded',
                    source: 'auto',
                    confidence: 'medium',
                },
                'Manual Stop': {
                    lat: 45.0, lon: -79.0,
                    displayName: 'manual',
                    source: 'manual',
                    confidence: 'high',
                },
                'Another Auto': {
                    lat: 47.0, lon: -81.0,
                    displayName: 'auto geocoded 2',
                    source: 'auto',
                    confidence: 'low',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const purged = purgeAutoEntries(cache);
        expect(purged).toBe(2);
        expect(Object.keys(cache.stations)).toHaveLength(2);
        expect(cache.stations['Barrie']).toBeDefined();
        expect(cache.stations['Manual Stop']).toBeDefined();
        expect(cache.stations['Some Auto Stop']).toBeUndefined();
        expect(cache.stations['Another Auto']).toBeUndefined();
    });

    it('returns 0 when no auto entries exist', () => {
        const cache: GeocodeCache = {
            stations: {
                'Barrie': {
                    lat: 44.388, lon: -79.691,
                    displayName: 'ref',
                    source: 'reference',
                    confidence: 'high',
                },
            },
            lastUpdated: '2025-01-01',
        };

        const purged = purgeAutoEntries(cache);
        expect(purged).toBe(0);
        expect(Object.keys(cache.stations)).toHaveLength(1);
    });
});
