import { describe, expect, it } from 'vitest';
import { validateFleetPlanWorkbook } from '../utils/fleet-plan/fleetPlanValidation';
import type { FleetPlanRow, FleetPlanWorkbook } from '../utils/fleet-plan/types';

function row(overrides: Partial<FleetPlanRow>): FleetPlanRow {
    return {
        id: 'row-1',
        unitNumber: '1101',
        makeModel: 'NF - Xcelsior',
        year: '2012',
        busSize: '',
        comment: '',
        electricFlag: '',
        onOrder: '',
        timeline: {
            '2025': '1101',
            '2026': '1101',
            '2027': 'RETIRE',
        },
        ...overrides,
    };
}

function workbook(rows: FleetPlanRow[]): FleetPlanWorkbook {
    return {
        schemaVersion: 1,
        metadata: {
            templateVersion: '2026-04-08-fleet-plan-v1',
            sourceFileName: 'Fleet_Plan.xlsx',
            importedAt: '2026-04-21T10:00:00.000Z',
            importedBy: 'user-1',
            updatedAt: '2026-04-21T10:00:00.000Z',
            updatedBy: 'user-1',
        },
        sheets: [
            {
                key: 'diesel-12m',
                name: '12m Buses',
                title: '12m Diesel Buses',
                rows,
            },
        ],
    };
}

describe('fleetPlanValidation', () => {
    it('allows a complete fleet row', () => {
        const result = validateFleetPlanWorkbook(workbook([row({})]), 2026);

        expect(result.canSave).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('blocks missing unit numbers and duplicate unit numbers', () => {
        const result = validateFleetPlanWorkbook(workbook([
            row({ id: 'missing', unitNumber: '', timeline: { '2025': '1101', '2027': 'RETIRE' } }),
            row({ id: 'first', unitNumber: '1101' }),
            row({ id: 'duplicate', unitNumber: '1101' }),
        ]), 2026);

        expect(result.canSave).toBe(false);
        expect(result.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
            'missing-unit',
            'duplicate-unit',
        ]));
    });

    it('blocks invalid model years and impossible lifecycle timelines', () => {
        const result = validateFleetPlanWorkbook(workbook([
            row({
                year: 'FY26',
                timeline: {
                    '2025': 'RETIRE',
                    '2026': '1101',
                },
            }),
        ]), 2026);

        expect(result.canSave).toBe(false);
        expect(result.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
            'invalid-year',
            'retirement-before-start',
            'activity-after-retirement',
        ]));
    });

    it('blocks rows missing lifecycle start and only warns for in-service rows missing retirement markers', () => {
        const result = validateFleetPlanWorkbook(workbook([
            row({ id: 'no-start', timeline: { '2027': 'RETIRE' } }),
            row({ id: 'no-retire', unitNumber: '1102', timeline: { '2025': '1102' } }),
        ]), 2026);

        expect(result.canSave).toBe(false);
        expect(result.errors.map((issue) => issue.code)).toContain('missing-lifecycle-start');
        expect(result.warnings.map((issue) => issue.code)).toContain('missing-retirement-warning');
    });

    it('does not warn for future purchase or growth rows without retirement markers', () => {
        const result = validateFleetPlanWorkbook(workbook([
            row({ id: 'future-purchase', unitNumber: '2601', timeline: { '2027': 'PURCHASE' } }),
            row({ id: 'future-growth', unitNumber: '2701', timeline: { '2028': 'GROWTH' } }),
        ]), 2026);

        expect(result.canSave).toBe(true);
        expect(result.issues.map((issue) => issue.code)).not.toContain('missing-retirement-warning');
    });

    it('warns on unusual years and non-standard timeline values', () => {
        const result = validateFleetPlanWorkbook(workbook([
            row({
                year: '2088',
                timeline: {
                    '2025': '1101',
                    '2026': 'custom note',
                    '2027': 'RETIRE',
                },
            }),
        ]), 2026);

        expect(result.canSave).toBe(true);
        expect(result.warnings.map((issue) => issue.code)).toEqual(expect.arrayContaining([
            'year-range',
            'unknown-timeline-status',
        ]));
    });
});
