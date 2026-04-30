import { createEmptyFleetPlanRow, createFleetPlanRowId } from './fleetPlanModel';
import type { FleetPlanRow, FleetPlanSheetConfig, FleetPlanSheetKey, FleetPlanTimelineColumn } from './types';

export interface FleetPlanGridColumn {
    kind: 'base' | 'timeline';
    key: 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag' | 'onOrder' | string;
    label: string;
}

export interface FleetPlanGridPosition {
    rowIndex: number;
    columnIndex: number;
}

export interface FleetPlanNavigationResult {
    nextPosition: FleetPlanGridPosition | null;
    shouldAppendRow: boolean;
}

export type FleetPlanSortDirection = 'asc' | 'desc';

export interface FleetPlanSortState {
    kind: FleetPlanGridColumn['kind'];
    key: FleetPlanGridColumn['key'];
    direction: FleetPlanSortDirection;
}

export interface FleetPlanLifecycle {
    startYear: string | null;
    retireYear: string | null;
    purchaseYears: string[];
    hasMissingInfo: boolean;
    isFuture: boolean;
    isInService: boolean;
    isOverdueRetirement: boolean;
}

export function getFleetPlanGridColumns(config: FleetPlanSheetConfig): FleetPlanGridColumn[] {
    return [
        ...config.baseColumns.map((column) => ({
            kind: 'base' as const,
            key: column.key,
            label: column.label,
        })),
        ...config.timelineColumns.map((column) => ({
            kind: 'timeline' as const,
            key: column.key,
            label: column.label,
        })),
    ];
}

export function getNextFleetPlanSortState(
    current: FleetPlanSortState | null,
    column: Pick<FleetPlanSortState, 'kind' | 'key'>,
): FleetPlanSortState | null {
    const isSameColumn = current?.kind === column.kind && current.key === column.key;
    if (!isSameColumn) {
        return { ...column, direction: 'asc' };
    }
    if (current.direction === 'asc') {
        return { ...column, direction: 'desc' };
    }
    return null;
}

function normalizeSortValue(value: string): string | number {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
    }
    return trimmed.toLocaleLowerCase();
}

export function compareFleetPlanSortValues(leftValue: string, rightValue: string): number {
    const left = normalizeSortValue(leftValue);
    const right = normalizeSortValue(rightValue);

    if (left === '' && right !== '') return 1;
    if (right === '' && left !== '') return -1;
    if (left === right) return 0;

    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }

    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortFleetPlanEntries<T>(
    entries: T[],
    sortState: FleetPlanSortState | null,
    getValue: (entry: T, sortState: FleetPlanSortState) => string,
): T[] {
    if (!sortState) return entries;

    return entries
        .map((entry, originalIndex) => ({ entry, originalIndex }))
        .sort((left, right) => {
            const comparison = compareFleetPlanSortValues(getValue(left.entry, sortState), getValue(right.entry, sortState));
            if (comparison !== 0) {
                return sortState.direction === 'asc' ? comparison : -comparison;
            }
            return left.originalIndex - right.originalIndex;
        })
        .map(({ entry }) => entry);
}

export function duplicateFleetPlanRow(row: FleetPlanRow): FleetPlanRow {
    return {
        ...row,
        id: createFleetPlanRowId(),
        timeline: { ...row.timeline },
    };
}

export function insertDuplicatedFleetPlanRow(rows: FleetPlanRow[], rowId: string): FleetPlanRow[] {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0) return rows;

    return [
        ...rows.slice(0, index + 1),
        duplicateFleetPlanRow(rows[index]!),
        ...rows.slice(index + 1),
    ];
}

export function removeFleetPlanRow(rows: FleetPlanRow[], rowId: string): FleetPlanRow[] {
    return rows.filter((row) => row.id !== rowId);
}

function setFleetPlanCellValue(row: FleetPlanRow, column: FleetPlanGridColumn, value: string): FleetPlanRow {
    if (column.kind === 'timeline') {
        return {
            ...row,
            timeline: {
                ...row.timeline,
                [column.key]: value,
            },
        };
    }

    return {
        ...row,
        [column.key]: value,
    };
}

export function parseFleetPlanClipboard(text: string): string[][] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = normalized.split('\n').map((row) => row.split('\t'));

    while (
        rows.length > 0
        && rows[rows.length - 1] !== undefined
        && rows[rows.length - 1]!.every((cell) => cell === '')
    ) {
        rows.pop();
    }

    return rows;
}

export function applyFleetPlanPaste(options: {
    rows: FleetPlanRow[];
    sheetKey: FleetPlanSheetKey;
    columns: FleetPlanGridColumn[];
    startRowIndex: number;
    startColumnIndex: number;
    clipboardText: string;
}): FleetPlanRow[] {
    const clipboardRows = parseFleetPlanClipboard(options.clipboardText);
    if (clipboardRows.length === 0) return options.rows;

    const nextRows = options.rows.map((row) => ({
        ...row,
        timeline: { ...row.timeline },
    }));

    const requiredRowCount = options.startRowIndex + clipboardRows.length;
    while (nextRows.length < requiredRowCount) {
        nextRows.push(createEmptyFleetPlanRow(options.sheetKey));
    }

    clipboardRows.forEach((clipboardRow, rowOffset) => {
        const targetRowIndex = options.startRowIndex + rowOffset;
        const sourceRow = nextRows[targetRowIndex];
        if (!sourceRow) return;

        let nextRow = sourceRow;
        clipboardRow.forEach((value, columnOffset) => {
            const targetColumn = options.columns[options.startColumnIndex + columnOffset];
            if (!targetColumn) return;
            nextRow = setFleetPlanCellValue(nextRow, targetColumn, value);
        });

        nextRows[targetRowIndex] = nextRow;
    });

    return nextRows;
}

export function getNextFleetPlanCellPosition(options: {
    rowCount: number;
    columnCount: number;
    current: FleetPlanGridPosition;
    mode: 'horizontal' | 'vertical';
    reverse?: boolean;
}): FleetPlanNavigationResult {
    const { rowCount, columnCount, current, mode, reverse = false } = options;
    if (rowCount <= 0 || columnCount <= 0) {
        return { nextPosition: null, shouldAppendRow: false };
    }

    if (mode === 'horizontal') {
        if (!reverse) {
            if (current.columnIndex < columnCount - 1) {
                return {
                    nextPosition: { rowIndex: current.rowIndex, columnIndex: current.columnIndex + 1 },
                    shouldAppendRow: false,
                };
            }
            if (current.rowIndex < rowCount - 1) {
                return {
                    nextPosition: { rowIndex: current.rowIndex + 1, columnIndex: 0 },
                    shouldAppendRow: false,
                };
            }
            return {
                nextPosition: { rowIndex: rowCount, columnIndex: 0 },
                shouldAppendRow: true,
            };
        }

        if (current.columnIndex > 0) {
            return {
                nextPosition: { rowIndex: current.rowIndex, columnIndex: current.columnIndex - 1 },
                shouldAppendRow: false,
            };
        }
        if (current.rowIndex > 0) {
            return {
                nextPosition: { rowIndex: current.rowIndex - 1, columnIndex: columnCount - 1 },
                shouldAppendRow: false,
            };
        }
        return { nextPosition: { rowIndex: 0, columnIndex: 0 }, shouldAppendRow: false };
    }

    if (!reverse) {
        if (current.rowIndex < rowCount - 1) {
            return {
                nextPosition: { rowIndex: current.rowIndex + 1, columnIndex: current.columnIndex },
                shouldAppendRow: false,
            };
        }
        return {
            nextPosition: { rowIndex: rowCount, columnIndex: current.columnIndex },
            shouldAppendRow: true,
        };
    }

    if (current.rowIndex > 0) {
        return {
            nextPosition: { rowIndex: current.rowIndex - 1, columnIndex: current.columnIndex },
            shouldAppendRow: false,
        };
    }

    return { nextPosition: { rowIndex: 0, columnIndex: current.columnIndex }, shouldAppendRow: false };
}


export function delayFleetPlanRetirement(options: {
    row: FleetPlanRow;
    timelineColumns: FleetPlanTimelineColumn[];
    fromYear: string;
    toYear: string;
}): FleetPlanRow {
    const fromIndex = options.timelineColumns.findIndex((column) => column.key === options.fromYear);
    const toIndex = options.timelineColumns.findIndex((column) => column.key === options.toYear);

    if (fromIndex < 0 || toIndex < 0 || toIndex <= fromIndex) {
        return options.row;
    }

    const serviceValue = options.row.unitNumber.trim();
    const timeline = { ...options.row.timeline };
    timeline[options.fromYear] = serviceValue;

    for (let index = fromIndex + 1; index < toIndex; index += 1) {
        const key = options.timelineColumns[index]?.key;
        if (key) timeline[key] = serviceValue;
    }

    timeline[options.toYear] = 'RETIRE';

    return {
        ...options.row,
        timeline,
    };
}

function isKnownTimelineYear(timelineColumns: FleetPlanTimelineColumn[], year: string): boolean {
    return timelineColumns.some((column) => column.key === year);
}

function normalizeYear(value: string | undefined): string | null {
    const trimmed = (value || '').trim();
    return /^\d{4}$/.test(trimmed) ? trimmed : null;
}

export function getFleetPlanServiceStartYear(rowYear: string | undefined): number | null {
    const normalizedYear = normalizeYear(rowYear);
    return normalizedYear ? Number(normalizedYear) : null;
}

export function getFleetPlanServiceLifeLabel(
    rowYear: string | undefined,
    currentYear = new Date().getFullYear(),
): string {
    const startYear = getFleetPlanServiceStartYear(rowYear);
    if (!startYear) return 'Unknown';

    const years = Math.max(0, currentYear - startYear);
    return `${years} year${years === 1 ? '' : 's'}`;
}

function normalizeTimelineStatus(value: string | undefined): string {
    return (value || '').trim().toUpperCase();
}

export function getFleetPlanLifecycle(
    row: FleetPlanRow,
    timelineColumns: FleetPlanTimelineColumn[],
    currentYear = new Date().getFullYear(),
): FleetPlanLifecycle {
    const unitNumber = row.unitNumber.trim();
    const yearKeys = timelineColumns.map((column) => column.key);
    const rowYear = normalizeYear(row.year);
    const startYear = rowYear
        ?? yearKeys.find((year) => {
            const value = (row.timeline[year] || '').trim();
            return Boolean(value && (value === unitNumber || normalizeTimelineStatus(value) === 'PURCHASE' || normalizeTimelineStatus(value) === 'GROWTH'));
        })
        ?? null;

    const retireYear = yearKeys.find((year) => normalizeTimelineStatus(row.timeline[year]) === 'RETIRE') ?? null;
    const purchaseYears = yearKeys.filter((year) => {
        const status = normalizeTimelineStatus(row.timeline[year]);
        return status === 'PURCHASE' || status === 'GROWTH';
    });
    const currentYearKey = String(currentYear);

    return {
        startYear,
        retireYear,
        purchaseYears,
        hasMissingInfo: !startYear || !retireYear,
        isFuture: Boolean(startYear && Number(startYear) > currentYear),
        isInService: Boolean(startYear && Number(startYear) <= currentYear && (!retireYear || Number(retireYear) >= currentYear)),
        isOverdueRetirement: Boolean(retireYear && Number(retireYear) < currentYear && normalizeTimelineStatus(row.timeline[currentYearKey]) !== 'RETIRE'),
    };
}

export function isFleetPlanRowCountedInFleetTotal(
    row: FleetPlanRow,
    sheetKey: FleetPlanSheetKey,
    year: string,
): boolean {
    const rawValue = (row.timeline[year] || '').trim();
    if (!rawValue) return false;

    const status = normalizeTimelineStatus(rawValue);
    if (
        status === 'RETIRE'
        || status === 'PURCHASE'
        || status.startsWith('PURCHASE')
        || status === 'GROWTH'
        || status === 'TRADED'
        || status === 'TRADE'
        || status === 'TRAINING'
        || status.includes('RETIRED')
        || status.includes('GOVDEALS')
    ) {
        return false;
    }

    if (sheetKey === 'electric-12m') return /-E$/i.test(rawValue) || rawValue === row.unitNumber.trim();

    return /^\d+(\.\d+)?$/.test(rawValue);
}

export function moveFleetPlanLifecycleBoundary(options: {
    row: FleetPlanRow;
    timelineColumns: FleetPlanTimelineColumn[];
    boundary: 'start' | 'retire';
    toYear: string;
}): FleetPlanRow {
    const targetYear = normalizeYear(options.toYear);
    if (!targetYear) return options.row;
    if (options.boundary === 'retire' && !isKnownTimelineYear(options.timelineColumns, targetYear)) return options.row;

    const lifecycle = getFleetPlanLifecycle(options.row, options.timelineColumns);
    const nextStartYear = options.boundary === 'start' ? targetYear : lifecycle.startYear;
    const nextRetireYear = options.boundary === 'retire' ? targetYear : lifecycle.retireYear;

    if (!nextStartYear) return options.row;
    if (nextRetireYear && Number(nextStartYear) > Number(nextRetireYear)) return options.row;

    const unitNumber = options.row.unitNumber.trim();
    const timeline = { ...options.row.timeline };

    options.timelineColumns.forEach((column) => {
        const status = normalizeTimelineStatus(timeline[column.key]);
        if (status === 'PURCHASE' || status === 'GROWTH' || status === 'TRADED' || status === 'TRADE') {
            return;
        }

        const year = Number(column.key);
        if (year >= Number(nextStartYear) && (!nextRetireYear || year < Number(nextRetireYear))) {
            timeline[column.key] = unitNumber;
            return;
        }
        if (nextRetireYear && column.key === nextRetireYear) {
            timeline[column.key] = 'RETIRE';
            return;
        }
        timeline[column.key] = '';
    });

    return {
        ...options.row,
        year: nextStartYear,
        timeline,
    };
}

export function moveFleetPlanLifecycleWindow(options: {
    row: FleetPlanRow;
    timelineColumns: FleetPlanTimelineColumn[];
    toStartYear: string;
}): FleetPlanRow {
    const targetStartYear = normalizeYear(options.toStartYear);
    if (!targetStartYear || !isKnownTimelineYear(options.timelineColumns, targetStartYear)) return options.row;

    const lifecycle = getFleetPlanLifecycle(options.row, options.timelineColumns);
    if (!lifecycle.startYear || !lifecycle.retireYear) return options.row;

    const currentStartIndex = options.timelineColumns.findIndex((column) => column.key === lifecycle.startYear);
    const currentRetireIndex = options.timelineColumns.findIndex((column) => column.key === lifecycle.retireYear);
    const targetStartIndex = options.timelineColumns.findIndex((column) => column.key === targetStartYear);
    if (currentStartIndex < 0 || currentRetireIndex < 0 || targetStartIndex < 0) return options.row;

    const lifecycleWidth = currentRetireIndex - currentStartIndex;
    const targetRetireIndex = targetStartIndex + lifecycleWidth;
    const targetRetireYear = options.timelineColumns[targetRetireIndex]?.key;
    if (!targetRetireYear) return options.row;

    return moveFleetPlanLifecycleBoundary({
        row: {
            ...options.row,
            year: targetStartYear,
        },
        timelineColumns: options.timelineColumns,
        boundary: 'retire',
        toYear: targetRetireYear,
    });
}
