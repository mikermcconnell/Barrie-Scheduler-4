import { describe, expect, it } from 'vitest';
import { buildFleetPlanResolutionSuggestions, applyFleetPlanResolution } from '../utils/fleet-plan/fleetPlanIssueResolver';
import { validateFleetPlanWorkbook } from '../utils/fleet-plan/fleetPlanValidation';
import type { FleetPlanRow, FleetPlanWorkbook } from '../utils/fleet-plan/types';

function row(overrides: Partial<FleetPlanRow>): FleetPlanRow {
    return {
        id: 'row-1',
        unitNumber: '1101',
        makeModel: 'Bus',
        year: '2020',
        timeline: { '2025': '1101', '2026': 'RETIRE' },
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
        sheets: [{ key: 'diesel-12m', name: '12m Buses', title: '12m Diesel Buses', rows }],
    };
}

describe('fleetPlanIssueResolver', () => {
    it('suggests and applies a replacement unit number for duplicates', () => {
        const data = workbook([
            row({ id: 'first', unitNumber: '3001' }),
            row({ id: 'duplicate', unitNumber: '3001' }),
        ]);
        const suggestions = buildFleetPlanResolutionSuggestions(data, validateFleetPlanWorkbook(data, 2026));

        const duplicateSuggestion = suggestions.find((suggestion) => suggestion.issueCode === 'duplicate-unit');
        expect(duplicateSuggestion).toBeDefined();

        const next = applyFleetPlanResolution(data, duplicateSuggestion!);
        expect(next.sheets[0]?.rows.find((entry) => entry.id === 'duplicate')?.unitNumber).not.toBe('3001');
    });

    it('applies a manual unit number for missing unit rows', () => {
        const data = workbook([
            row({ id: 'missing', unitNumber: '', makeModel: 'Future bus', timeline: { '2027': 'PURCHASE' } }),
        ]);
        const suggestions = buildFleetPlanResolutionSuggestions(data, validateFleetPlanWorkbook(data, 2026));
        const missingSuggestion = suggestions.find((suggestion) => suggestion.issueCode === 'missing-unit');

        const next = applyFleetPlanResolution(data, missingSuggestion!, '4501');
        expect(next.sheets[0]?.rows[0]?.unitNumber).toBe('4501');
    });

    it('keeps one retirement year and clears other RETIRE markers', () => {
        const data = workbook([
            row({ id: 'multi', unitNumber: '2020', timeline: { '2026': 'RETIRE', '2028': 'RETIRE' } }),
        ]);
        const suggestions = buildFleetPlanResolutionSuggestions(data, validateFleetPlanWorkbook(data, 2026));
        const retirementSuggestion = suggestions.find((suggestion) => suggestion.issueCode === 'multiple-retirements');

        const next = applyFleetPlanResolution(data, retirementSuggestion!);
        expect(next.sheets[0]?.rows[0]?.timeline['2026']).toBe('');
        expect(next.sheets[0]?.rows[0]?.timeline['2028']).toBe('RETIRE');
    });

    it('applies accepted fixes to the workbook data so validation updates outside the modal', () => {
        const data = workbook([
            row({ id: 'first', unitNumber: '3001' }),
            row({ id: 'duplicate', unitNumber: '3001' }),
        ]);
        const initialValidation = validateFleetPlanWorkbook(data, 2026);
        expect(initialValidation.errors.some((issue) => issue.code === 'duplicate-unit')).toBe(true);

        const duplicateSuggestion = buildFleetPlanResolutionSuggestions(data, initialValidation)
            .find((suggestion) => suggestion.issueCode === 'duplicate-unit');
        expect(duplicateSuggestion).toBeDefined();

        const next = applyFleetPlanResolution(data, duplicateSuggestion!, '3002');
        const nextValidation = validateFleetPlanWorkbook(next, 2026);

        expect(next.sheets[0]?.rows.find((entry) => entry.id === 'duplicate')?.unitNumber).toBe('3002');
        expect(nextValidation.errors.some((issue) => issue.code === 'duplicate-unit')).toBe(false);
    });


    it('suggests missing retirement warning fixes 13 years after first in-service year', () => {
        const data = workbook([
            row({
                id: 'missing-retirement',
                unitNumber: '1101',
                timeline: { '2023': '1101', '2024': '1101', '2025': '1101' },
            }),
        ]);
        const initialValidation = validateFleetPlanWorkbook(data, 2026);
        expect(initialValidation.warnings.some((issue) => issue.code === 'missing-retirement-warning')).toBe(true);

        const retirementSuggestion = buildFleetPlanResolutionSuggestions(data, initialValidation)
            .find((suggestion) => suggestion.issueCode === 'missing-retirement-warning');
        expect(retirementSuggestion).toBeDefined();
        expect(retirementSuggestion?.issueSeverity).toBe('warning');
        expect(retirementSuggestion?.action.type).toBe('keep-retirement-year');
        if (retirementSuggestion?.action.type !== 'keep-retirement-year') {
            throw new Error('Expected a retirement-year suggestion');
        }
        expect(retirementSuggestion.action.suggestedRetirementYear).toBe('2036');

        const next = applyFleetPlanResolution(data, retirementSuggestion!);
        const nextValidation = validateFleetPlanWorkbook(next, 2026);

        expect(next.sheets[0]?.rows[0]?.timeline['2036']).toBe('RETIRE');
        expect(nextValidation.warnings.some((issue) => issue.code === 'missing-retirement-warning')).toBe(false);
    });

});
