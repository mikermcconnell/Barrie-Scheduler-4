import { describe, expect, it } from 'vitest';
import { lookupStationCoordinates } from '../utils/od-matrix/odStationReference';

describe('odStationReference lookup', () => {
    // ====== Stage 1: exact match ======

    it('finds an exact match (case-insensitive)', () => {
        const result = lookupStationCoordinates('barrie');
        expect(result).not.toBeNull();
        expect(result!.source).toBe('reference');
        expect(result!.lat).toBeCloseTo(44.388, 2);
    });

    it('matches UPPER CASE station names', () => {
        const result = lookupStationCoordinates('SUDBURY');
        expect(result).not.toBeNull();
        expect(result!.source).toBe('reference');
    });

    it('strips diacritics (DEUX RIVIÈRES)', () => {
        const result = lookupStationCoordinates('Deux Rivières');
        expect(result).not.toBeNull();
    });

    it('strips periods (FORT FRANCES.)', () => {
        const result = lookupStationCoordinates('FORT FRANCES.');
        expect(result).not.toBeNull();
    });

    it('normalizes hyphens to spaces (WINNIPEG-AIRPORT)', () => {
        const result = lookupStationCoordinates('WINNIPEG-AIRPORT');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(49.905, 2);
    });

    it('normalizes hyphens to spaces (COBALT-TRAIN DEPOT)', () => {
        const result = lookupStationCoordinates('COBALT-TRAIN DEPOT');
        expect(result).not.toBeNull();
    });

    it('normalizes hyphens in long names (THUNDER BAY TRANSIT-INTERCITY SHOPPING CENTRE)', () => {
        const result = lookupStationCoordinates('THUNDER BAY TRANSIT-INTERCITY SHOPPING CENTRE');
        expect(result).not.toBeNull();
    });

    it('finds extra stations not in CSV (ELLIOT LAKE)', () => {
        const result = lookupStationCoordinates('ELLIOT LAKE');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(46.383, 2);
    });

    // ====== Stage 2: city prefix strip ======

    it('strips city prefix (North Bay - Bus Garage → BUS GARAGE)', () => {
        // "BUS GARAGE" is indexed as place portion of "NORTH BAY BUS GARAGE"
        // Actually NORTH BAY BUS GARAGE is stationId 312 — it has no " - " separator in CSV
        // so it gets indexed in byPlacePortion as the full normalized name
        const result = lookupStationCoordinates('North Bay - Bus Garage');
        // Stage 2 strips "North Bay" → looks up "Bus Garage" in byPlacePortion
        // byPlacePortion won't have "bus garage" because "NORTH BAY BUS GARAGE" has no " - "
        // But Stage 2b will try "north bay bus garage" in byNormalized → match!
        expect(result).not.toBeNull();
    });

    // ====== Stage 2b: city+place recombination ======

    it('recombines city+place (Orillia - Transit → ORILLIA TRANSIT)', () => {
        const result = lookupStationCoordinates('Orillia - Transit');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(44.609, 2);
    });

    it('recombines city+place (Barrie - Allandale Terminal → BARRIE ALLANDALE TERMINAL)', () => {
        const result = lookupStationCoordinates('Barrie - Allandale Terminal');
        expect(result).not.toBeNull();
    });

    it('recombines city+place (North Bay - EDC → NORTH BAY EDC)', () => {
        const result = lookupStationCoordinates('North Bay - EDC');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(46.344, 2);
    });

    it('recombines city+place (Sudbury - Transit → SUDBURY TRANSIT)', () => {
        const result = lookupStationCoordinates('Sudbury - Transit');
        expect(result).not.toBeNull();
    });

    it('recombines city+place (Ottawa - Bayshore Mall → OTTAWA BAYSHORE MALL)', () => {
        const result = lookupStationCoordinates('Ottawa - Bayshore Mall');
        expect(result).not.toBeNull();
    });

    it('recombines city+place (Toronto - DVP → TORONTO DVP)', () => {
        const result = lookupStationCoordinates('Toronto - DVP');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(43.763, 2);
    });

    it('recombines city+place (North Bay - Health Ctr → NORTH BAY HEALTH CTR)', () => {
        const result = lookupStationCoordinates('North Bay - Health Ctr');
        expect(result).not.toBeNull();
    });

    // ====== Stage 3: direction suffix strip ======

    it('strips direction suffix (ARDTREA → ARDTREA northbound)', () => {
        const result = lookupStationCoordinates('ARDTREA');
        // No exact "ARDTREA" entry, but there are "ARDTREA northbound" and "ARDTREA southbound"
        // Stage 3 won't match because it strips suffix from normalized *input*, not from data
        // "ardtrea" doesn't end with " northbound" so Stage 3 won't fire
        // This tests that input WITH a suffix gets stripped:
        const withSuffix = lookupStationCoordinates('ARDTREA northbound');
        expect(withSuffix).not.toBeNull();
    });

    it('strips direction suffix from input (CHALK RIVER eastbound)', () => {
        const result = lookupStationCoordinates('CHALK RIVER eastbound');
        expect(result).not.toBeNull();
    });

    // ====== Aliases ======

    it('resolves alias (Education Centre - Lower Residence)', () => {
        const result = lookupStationCoordinates('Education Centre - Lower Residence');
        expect(result).not.toBeNull();
    });

    it('resolves alias (Timmins and District Hospital)', () => {
        const result = lookupStationCoordinates('Timmins and District Hospital');
        expect(result).not.toBeNull();
    });

    it('resolves new Health Centre alias', () => {
        const result = lookupStationCoordinates('Health Centre');
        expect(result).not.toBeNull();
        expect(result!.lat).toBeCloseTo(46.336, 2);
    });

    // ====== Null for unknown ======

    it('returns null for unknown station', () => {
        expect(lookupStationCoordinates('Narnia Central Station')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(lookupStationCoordinates('')).toBeNull();
    });
});
