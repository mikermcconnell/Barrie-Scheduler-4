import { describe, expect, it } from 'vitest';
import { findStopCoords } from '../utils/gtfs/gtfsStopLookup';

describe('gtfsStopLookup', () => {
    it('finds known Barrie stops by stop id', () => {
        expect(findStopCoords('2', null)).toEqual({
            lat: 44.387753,
            lon: -79.690237,
        });
    });

    it('normalizes numeric stop ids with leading zeroes', () => {
        expect(findStopCoords('0002', null)).toEqual({
            lat: 44.387753,
            lon: -79.690237,
        });
    });

    it('normalizes numeric stop ids with trailing decimal zeroes', () => {
        expect(findStopCoords('2.0', null)).toEqual({
            lat: 44.387753,
            lon: -79.690237,
        });
    });

    it('falls back to stop name matching', () => {
        expect(findStopCoords(undefined, 'Downtown Hub')).toEqual({
            lat: 44.387753,
            lon: -79.690237,
        });
    });

    it('matches common stop-name connector variants', () => {
        expect(findStopCoords(undefined, 'Fox Run and Leacock Drive')).toEqual({
            lat: 44.38753486,
            lon: -79.71917122,
        });
    });
});
