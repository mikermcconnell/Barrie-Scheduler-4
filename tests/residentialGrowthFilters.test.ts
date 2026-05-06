// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildResidentialGrowthRange, getResidentialGrowthMonthOptions, periodFromText } from '../utils/residential-growth/filters';
import type { ResidentialGrowthMonthlyDataset, ResidentialGrowthRecord } from '../utils/residential-growth/types';

function record(id: string, layer: 'issued' | 'occupied', date: string, units: number): ResidentialGrowthRecord {
    return {
        id,
        layer,
        fileNumber: id,
        address: `${id} Test St`,
        date,
        units,
        category: 'Residential',
        warnings: [],
    };
}

function dataset(period: string, issued: ResidentialGrowthRecord[], occupied: ResidentialGrowthRecord[] = []): ResidentialGrowthMonthlyDataset {
    return {
        schemaVersion: 1,
        period,
        issued,
        occupied,
        metadata: {
            importedAt: `${period}-28T12:00:00.000Z`,
            importedBy: 'tester',
        },
    };
}

describe('residential growth range filters', () => {
    it('uses the latest uploaded dataset for latest month', () => {
        const result = buildResidentialGrowthRange([
            dataset('2026-04', [record('newer-period', 'issued', '2026-04-20', 40)]),
            {
                ...dataset('2026-03', [record('latest-upload', 'issued', '2026-03-20', 30)], [record('occ', 'occupied', '2026-03-15', 1)]),
                metadata: {
                    importedAt: '2026-05-01T12:00:00.000Z',
                    importedBy: 'tester',
                },
            },
        ], 'latest-month');

        expect(result.periods).toEqual(['2026-03']);
        expect(result.issued.map((entry) => entry.id)).toEqual(['latest-upload']);
        expect(result.occupied.reduce((sum, entry) => sum + entry.units, 0)).toBe(1);
    });

    it('allows a single selected month', () => {
        const result = buildResidentialGrowthRange([
            dataset('2026-03', [record('march', 'issued', '2026-03-20', 30)]),
            dataset('2026-04', [record('april', 'issued', '2026-04-20', 40)]),
        ], 'selected-month', '2026-03');

        expect(result.periods).toEqual(['2026-03']);
        expect(result.issued.map((entry) => entry.id)).toEqual(['march']);
    });

    it('sums uploaded records within the latest three uploaded months', () => {
        const result = buildResidentialGrowthRange([
            dataset('2026-01', [record('old', 'issued', '2026-01-10', 10)]),
            dataset('2026-02', [record('feb', 'issued', '2026-02-20', 20)]),
            dataset('2026-03', [record('march', 'issued', '2026-03-20', 30)]),
            dataset('2026-04', [record('april', 'issued', '2026-04-20', 40)], [record('occ', 'occupied', '2026-04-15', 1)]),
        ], 'past-3-months');

        expect(result.fromDate).toBe('2026-02-01');
        expect(result.toDate).toBe('2026-04-30');
        expect(result.periods).toEqual(['2026-02', '2026-03', '2026-04']);
        expect(result.issued.map((entry) => entry.id)).toEqual(['april', 'march', 'feb']);
        expect(result.issued.reduce((sum, entry) => sum + entry.units, 0)).toBe(90);
        expect(result.occupied.reduce((sum, entry) => sum + entry.units, 0)).toBe(1);
    });

    it('deduplicates repeated uploads of the same stable record', () => {
        const duplicate = record('same-file', 'issued', '2026-04-10', 12);
        const result = buildResidentialGrowthRange([
            dataset('2026-04', [duplicate]),
            dataset('2026-04', [{ ...duplicate }]),
        ], 'past-12-months');

        expect(result.issued).toHaveLength(1);
        expect(result.issued[0].units).toBe(12);
    });

    it('lists selectable months from uploaded datasets', () => {
        expect(getResidentialGrowthMonthOptions([
            dataset('2026-03', [record('march', 'issued', '2026-03-20', 30)]),
            dataset('2026-04', [record('april', 'issued', '2026-04-20', 40)]),
        ])).toEqual([
            { value: '2026-04', label: 'Apr 2026' },
            { value: '2026-03', label: 'Mar 2026' },
        ]);
    });

    it('uses record dates when multiple months are stored in one dataset', () => {
        const combined = dataset('2026-03', [
            record('jan', 'issued', '2026-01-20', 10),
            record('feb', 'issued', '2026-02-20', 20),
            record('mar', 'issued', '2026-03-20', 30),
        ]);

        expect(getResidentialGrowthMonthOptions([combined]).map((option) => option.value)).toEqual(['2026-03', '2026-02', '2026-01']);

        const result = buildResidentialGrowthRange([combined], 'selected-month', '2026-02');
        expect(result.periods).toEqual(['2026-02']);
        expect(result.issued.map((entry) => entry.id)).toEqual(['feb']);
    });

    it('uses the uploaded file month when a monthly VEDA file has record dates in another month', () => {
        const februaryVeda = {
            ...dataset('2026-03', [], [record('veda-feb', 'occupied', '2026-03-04', 1)]),
            metadata: {
                importedAt: '2026-05-01T12:00:00.000Z',
                importedBy: 'tester',
                occupiedFileName: 'VEDA February 2026.xlsx',
            },
        };

        expect(getResidentialGrowthMonthOptions([februaryVeda])).toEqual([
            { value: '2026-02', label: 'Feb 2026' },
        ]);

        const result = buildResidentialGrowthRange([februaryVeda], 'selected-month', '2026-02');
        expect(result.occupied.map((entry) => entry.id)).toEqual(['veda-feb']);
    });

    it('extracts periods from common upload filenames', () => {
        expect(periodFromText('VEDA February 2026.xlsx')).toBe('2026-02');
        expect(periodFromText('Certificate of Occupancy Apr 2026.xlsx')).toBe('2026-04');
        expect(periodFromText('issuance_2026-03.xlsx')).toBe('2026-03');
    });
});
