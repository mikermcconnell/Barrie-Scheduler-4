import { describe, expect, it } from 'vitest';
import { passesCityGate } from '../utils/od-matrix/odMatrixGeocoder';

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
