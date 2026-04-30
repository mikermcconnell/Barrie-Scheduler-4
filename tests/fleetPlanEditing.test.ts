import { describe, expect, it } from 'vitest';
import {
    applyFleetPlanPaste,
    compareFleetPlanSortValues,
    duplicateFleetPlanRow,
    delayFleetPlanRetirement,
    getFleetPlanLifecycle,
    getFleetPlanGridColumns,
    getFleetPlanServiceLifeLabel,
    getNextFleetPlanCellPosition,
    getNextFleetPlanSortState,
    insertDuplicatedFleetPlanRow,
    isFleetPlanRowCountedInFleetTotal,
    moveFleetPlanLifecycleBoundary,
    moveFleetPlanLifecycleWindow,
    removeFleetPlanRow,
    sortFleetPlanEntries,
} from '../utils/fleet-plan/fleetPlanEditing';
import { FLEET_PLAN_SHEET_CONFIG_BY_KEY } from '../utils/fleet-plan/fleetPlanConfig';
import { createEmptyFleetPlanRow } from '../utils/fleet-plan/fleetPlanModel';

describe('fleetPlan editing helpers', () => {
    it('duplicates a row with a fresh id and cloned timeline data', () => {
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            id: 'original-row',
            unitNumber: '1101',
            timeline: {
                '2023': '1101',
                '2024': 'RETIRE',
            },
        };

        const duplicate = duplicateFleetPlanRow(row);

        expect(duplicate.id).not.toBe(row.id);
        expect(duplicate.unitNumber).toBe('1101');
        expect(duplicate.timeline).toEqual(row.timeline);
        expect(duplicate.timeline).not.toBe(row.timeline);
    });

    it('inserts a duplicated row directly below the source row', () => {
        const first = { ...createEmptyFleetPlanRow('diesel-12m'), id: 'first', unitNumber: '1101' };
        const second = { ...createEmptyFleetPlanRow('diesel-12m'), id: 'second', unitNumber: '1102' };

        const rows = insertDuplicatedFleetPlanRow([first, second], 'first');

        expect(rows).toHaveLength(3);
        expect(rows[1]?.unitNumber).toBe('1101');
        expect(rows[1]?.id).not.toBe('first');
        expect(rows[2]?.id).toBe('second');
    });

    it('removes a row by id without changing the remaining rows', () => {
        const first = { ...createEmptyFleetPlanRow('diesel-12m'), id: 'first', unitNumber: '1101' };
        const second = { ...createEmptyFleetPlanRow('diesel-12m'), id: 'second', unitNumber: '1102' };

        const rows = removeFleetPlanRow([first, second], 'first');

        expect(rows).toEqual([second]);
    });

    it('applies a pasted grid and appends rows when the clipboard is taller than the current sheet', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const columns = getFleetPlanGridColumns(config);
        const rows = [
            {
                ...createEmptyFleetPlanRow('diesel-12m'),
                id: 'row-1',
                unitNumber: '1101',
            },
        ];

        const nextRows = applyFleetPlanPaste({
            rows,
            sheetKey: 'diesel-12m',
            columns,
            startRowIndex: 0,
            startColumnIndex: 0,
            clipboardText: '2101\tNF - Xcelsior\t2018\n2102\tNova Bus\t2019',
        });

        expect(nextRows).toHaveLength(2);
        expect(nextRows[0]?.unitNumber).toBe('2101');
        expect(nextRows[0]?.makeModel).toBe('NF - Xcelsior');
        expect(nextRows[0]?.year).toBe('2018');
        expect(nextRows[1]?.unitNumber).toBe('2102');
        expect(nextRows[1]?.makeModel).toBe('Nova Bus');
        expect(nextRows[1]?.year).toBe('2019');
    });



    it('delays a retirement by filling skipped years with the unit number', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            timeline: {
                '2025': '1101',
                '2026': 'RETIRE',
                '2027': '',
                '2028': '',
            },
        };

        const nextRow = delayFleetPlanRetirement({
            row,
            timelineColumns: config.timelineColumns,
            fromYear: '2026',
            toYear: '2028',
        });

        expect(nextRow.timeline['2026']).toBe('1101');
        expect(nextRow.timeline['2027']).toBe('1101');
        expect(nextRow.timeline['2028']).toBe('RETIRE');
    });

    it('moves lifecycle start and retire boundaries while preserving export timeline values', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            year: '2025',
            timeline: {
                '2025': '1101',
                '2026': '1101',
                '2027': 'RETIRE',
                '2028': '',
            },
        };

        const laterRetire = moveFleetPlanLifecycleBoundary({
            row,
            timelineColumns: config.timelineColumns,
            boundary: 'retire',
            toYear: '2028',
        });
        expect(laterRetire.timeline['2027']).toBe('1101');
        expect(laterRetire.timeline['2028']).toBe('RETIRE');

        const laterStart = moveFleetPlanLifecycleBoundary({
            row: laterRetire,
            timelineColumns: config.timelineColumns,
            boundary: 'start',
            toYear: '2026',
        });
        expect(laterStart.year).toBe('2026');
        expect(laterStart.timeline['2025']).toBe('');
        expect(laterStart.timeline['2026']).toBe('1101');
        expect(laterStart.timeline['2028']).toBe('RETIRE');
    });

    it('allows editing the in-service year before the visible timeline', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            year: '2025',
            timeline: {
                '2025': '1101',
                '2026': 'RETIRE',
            },
        };

        const next = moveFleetPlanLifecycleBoundary({
            row,
            timelineColumns: config.timelineColumns,
            boundary: 'start',
            toYear: '2012',
        });

        expect(next.year).toBe('2012');
        expect(next.timeline['2025']).toBe('1101');
        expect(next.timeline['2026']).toBe('RETIRE');
    });

    it('allows editing the in-service year when retirement is not set', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            year: '2025',
            timeline: {
                '2025': '1101',
                '2026': '1101',
                '2027': '',
            },
        };

        const next = moveFleetPlanLifecycleBoundary({
            row,
            timelineColumns: config.timelineColumns,
            boundary: 'start',
            toYear: '2026',
        });

        expect(next.year).toBe('2026');
        expect(next.timeline['2025']).toBe('');
        expect(next.timeline['2026']).toBe('1101');
        expect(next.timeline['2027']).toBe('1101');
    });

    it('blocks lifecycle drags that would put start after retirement', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            year: '2027',
            timeline: {
                '2027': '1101',
                '2028': 'RETIRE',
            },
        };

        const next = moveFleetPlanLifecycleBoundary({
            row,
            timelineColumns: config.timelineColumns,
            boundary: 'start',
            toYear: '2029',
        });
        expect(next).toBe(row);
    });

    it('moves the full lifecycle window while preserving lifespan and export values', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            year: '2025',
            timeline: {
                '2025': '1101',
                '2026': '1101',
                '2027': 'RETIRE',
                '2028': '',
            },
        };

        const next = moveFleetPlanLifecycleWindow({
            row,
            timelineColumns: config.timelineColumns,
            toStartYear: '2026',
        });

        expect(next.year).toBe('2026');
        expect(next.timeline['2025']).toBe('');
        expect(next.timeline['2026']).toBe('1101');
        expect(next.timeline['2027']).toBe('1101');
        expect(next.timeline['2028']).toBe('RETIRE');
    });

    it('summarizes fleet lifecycle filters from timeline data', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            year: '2025',
            timeline: {
                '2025': 'PURCHASE',
                '2026': '1101',
                '2027': 'RETIRE',
            },
        };

        const lifecycle = getFleetPlanLifecycle(row, config.timelineColumns, 2026);
        expect(lifecycle.startYear).toBe('2025');
        expect(lifecycle.retireYear).toBe('2027');
        expect(lifecycle.purchaseYears).toEqual(['2025']);
        expect(lifecycle.isInService).toBe(true);
        expect(lifecycle.hasMissingInfo).toBe(false);
    });

    it('calculates service life from the actual in-service year, not the visible lifecycle bar start', () => {
        expect(getFleetPlanServiceLifeLabel('2012', 2026)).toBe('14 years');
        expect(getFleetPlanServiceLifeLabel('2025', 2026)).toBe('1 year');
        expect(getFleetPlanServiceLifeLabel('', 2026)).toBe('Unknown');
    });

    it('uses the actual bus year as lifecycle start even when it is before the visible timeline', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['diesel-12m'];
        const row = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1201',
            year: '2012',
            timeline: {
                '2025': '1201',
                '2026': 'RETIRE',
            },
        };

        const lifecycle = getFleetPlanLifecycle(row, config.timelineColumns, 2026);
        expect(lifecycle.startYear).toBe('2012');
        expect(lifecycle.retireYear).toBe('2026');
        expect(lifecycle.hasMissingInfo).toBe(false);
    });

    it('counts fleet totals from real active units without treating planning markers as added buses', () => {
        const activeDiesel = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1101',
            timeline: { '2026': '1101' },
        };
        const replacementPurchase = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '2601',
            timeline: { '2026': 'PURCHASE' },
        };
        const retiringBus = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '1201',
            timeline: { '2026': 'RETIRE' },
        };
        const growthBus = {
            ...createEmptyFleetPlanRow('diesel-12m'),
            unitNumber: '2701',
            timeline: { '2026': 'GROWTH' },
        };

        expect(isFleetPlanRowCountedInFleetTotal(activeDiesel, 'diesel-12m', '2026')).toBe(true);
        expect(isFleetPlanRowCountedInFleetTotal(replacementPurchase, 'diesel-12m', '2026')).toBe(false);
        expect(isFleetPlanRowCountedInFleetTotal(retiringBus, 'diesel-12m', '2026')).toBe(false);
        expect(isFleetPlanRowCountedInFleetTotal(growthBus, 'diesel-12m', '2026')).toBe(false);
    });

    it('cycles column sorting from ascending to descending to original order', () => {
        const column = { kind: 'base' as const, key: 'unitNumber' };

        const ascending = getNextFleetPlanSortState(null, column);
        expect(ascending).toEqual({ ...column, direction: 'asc' });

        const descending = getNextFleetPlanSortState(ascending, column);
        expect(descending).toEqual({ ...column, direction: 'desc' });

        const original = getNextFleetPlanSortState(descending, column);
        expect(original).toBeNull();
    });

    it('sorts fleet entries numerically and preserves original order when sorting is cleared', () => {
        const entries = [
            { label: 'row-a', value: '1102' },
            { label: 'row-b', value: '900' },
            { label: 'row-c', value: '1101' },
        ];

        const ascending = sortFleetPlanEntries(
            entries,
            { kind: 'base', key: 'unitNumber', direction: 'asc' },
            (entry) => entry.value,
        );
        expect(ascending.map((entry) => entry.label)).toEqual(['row-b', 'row-c', 'row-a']);

        const descending = sortFleetPlanEntries(
            entries,
            { kind: 'base', key: 'unitNumber', direction: 'desc' },
            (entry) => entry.value,
        );
        expect(descending.map((entry) => entry.label)).toEqual(['row-a', 'row-c', 'row-b']);

        expect(sortFleetPlanEntries(entries, null, (entry) => entry.value)).toBe(entries);
        expect(compareFleetPlanSortValues('', '1101')).toBeGreaterThan(0);
    });

    it('wraps tab navigation and appends a row when leaving the last cell', () => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY['electric-12m'];
        const columnCount = getFleetPlanGridColumns(config).length;

        const horizontal = getNextFleetPlanCellPosition({
            rowCount: 1,
            columnCount,
            current: { rowIndex: 0, columnIndex: columnCount - 1 },
            mode: 'horizontal',
        });
        expect(horizontal.shouldAppendRow).toBe(true);
        expect(horizontal.nextPosition).toEqual({ rowIndex: 1, columnIndex: 0 });

        const vertical = getNextFleetPlanCellPosition({
            rowCount: 1,
            columnCount,
            current: { rowIndex: 0, columnIndex: 2 },
            mode: 'vertical',
        });
        expect(vertical.shouldAppendRow).toBe(true);
        expect(vertical.nextPosition).toEqual({ rowIndex: 1, columnIndex: 2 });
    });
});
