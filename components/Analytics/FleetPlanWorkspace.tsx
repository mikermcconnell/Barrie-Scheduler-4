import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    ChevronDown,
    Download,
    ExternalLink,
    FileSpreadsheet,
    Grid3X3,
    Loader2,
    Plus,
    Redo2,
    RefreshCw,
    Save,
    Undo2,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { exportFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanExport';
import { cloneFleetPlanWorkbook, createEmptyFleetPlanRow, replaceFleetPlanSheet } from '../../utils/fleet-plan/fleetPlanModel';
import { saveFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanService';
import { FLEET_PLAN_SHEET_CONFIGS, FLEET_PLAN_SHEET_CONFIG_BY_KEY } from '../../utils/fleet-plan/fleetPlanConfig';
import {
    delayFleetPlanRetirement,
    getFleetPlanLifecycle,
    getFleetPlanServiceLifeLabel,
    getNextFleetPlanSortState,
    getNextFleetPlanCellPosition,
    isFleetPlanRowCountedInFleetTotal,
    moveFleetPlanLifecycleBoundary,
    moveFleetPlanLifecycleWindow,
    sortFleetPlanEntries,
} from '../../utils/fleet-plan/fleetPlanEditing';
import type { FleetPlanGridColumn, FleetPlanLifecycle, FleetPlanSortState } from '../../utils/fleet-plan/fleetPlanEditing';
import type { FleetPlanRow, FleetPlanSheetKey, FleetPlanWorkbook } from '../../utils/fleet-plan/types';
import { isEditableEventTarget } from '../../utils/domUtils';

interface FleetPlanWorkspaceProps {
    data: FleetPlanWorkbook;
    teamId: string;
    userId: string;
    onBack: () => void;
    onReimport: () => void;
    onSaved: (workbook: FleetPlanWorkbook) => void;
}

const BUS_TYPE_LABELS: Record<FleetPlanSheetKey, string> = {
    'diesel-12m': '12m Diesel',
    'small-buses': '8m & 6m',
    'electric-12m': '12m Electric',
};

type CombinedFleetRow = { sheetKey: FleetPlanSheetKey; row: FleetPlanRow };
type BaseFleetField = 'busType' | 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag' | 'onOrder';
type FleetStatusFilter = 'all' | 'in-service' | 'retiring-this-year' | 'purchasing-this-year' | 'on-order' | 'future' | 'overdue' | 'missing-info';
type FleetBusTypeFilter = 'all' | FleetPlanSheetKey;
type LifecycleDragMode = 'start' | 'retire' | 'window';

interface LifecycleDragState {
    sheetKey: FleetPlanSheetKey;
    rowId: string;
    mode: LifecycleDragMode;
    yearKeys: string[];
    startIndex: number;
    retireIndex: number;
    pointerStartIndex: number;
    trackLeft: number;
    trackWidth: number;
}

const ALL_TIMELINE_COLUMNS = Array.from(
    new Map(FLEET_PLAN_SHEET_CONFIGS.flatMap((config) => config.timelineColumns).map((column) => [column.key, column])).values(),
).sort((left, right) => Number(left.key) - Number(right.key));

const FLEET_TIMELINE_START_YEAR = 2025;
const COMMON_TIMELINE_YEAR_KEYS = new Set(
    FLEET_PLAN_SHEET_CONFIGS
        .map((config) => new Set(config.timelineColumns.map((column) => column.key)))
        .reduce<string[]>((commonYears, sheetYears, index) => (
            index === 0 ? Array.from(sheetYears) : commonYears.filter((year) => sheetYears.has(year))
        ), []),
);
const DISPLAY_TIMELINE_COLUMNS = ALL_TIMELINE_COLUMNS.filter((column) => (
    Number(column.key) >= FLEET_TIMELINE_START_YEAR && COMMON_TIMELINE_YEAR_KEYS.has(column.key)
));

const COMBINED_BASE_COLUMNS: Array<{ key: BaseFleetField; label: string }> = [
    { key: 'busType', label: 'Bus Type' },
    { key: 'unitNumber', label: 'Unit Number' },
    { key: 'makeModel', label: 'Make/Model' },
    { key: 'year', label: 'Year' },
    { key: 'comment', label: 'Comment' },
    { key: 'electricFlag', label: 'Electric' },
    { key: 'onOrder', label: 'On Order' },
];

const COMBINED_GRID_COLUMNS: FleetPlanGridColumn[] = [
    ...COMBINED_BASE_COLUMNS.map((column) => ({ kind: 'base' as const, key: column.key, label: column.label })),
    ...DISPLAY_TIMELINE_COLUMNS.map((column) => ({ kind: 'timeline' as const, key: column.key, label: column.label })),
];

const STATUS_FILTERS: Array<{ key: FleetStatusFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'in-service', label: 'In Service' },
    { key: 'retiring-this-year', label: 'Retiring This Year' },
    { key: 'purchasing-this-year', label: 'Purchasing This Year' },
    { key: 'on-order', label: 'On Order' },
    { key: 'future', label: 'Future' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'missing-info', label: 'Missing Info' },
];

const BUS_TYPE_FILTERS: Array<{ key: FleetBusTypeFilter; label: string }> = [
    { key: 'all', label: 'All Types' },
    { key: 'diesel-12m', label: 'Diesel 12m' },
    { key: 'electric-12m', label: 'Electric 12m' },
    { key: 'small-buses', label: 'Small Buses' },
];

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function updateRow(rows: FleetPlanRow[], rowId: string, updater: (row: FleetPlanRow) => FleetPlanRow): FleetPlanRow[] {
    return rows.map((row) => (row.id === rowId ? updater(row) : row));
}

function getBaseFieldValue(
    row: FleetPlanRow,
    field: keyof Pick<FleetPlanRow, 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag' | 'onOrder'>,
): string {
    if (field === 'unitNumber') return row.unitNumber;
    if (field === 'busSize') return row.busSize || '';
    if (field === 'makeModel') return row.makeModel;
    if (field === 'year') return row.year;
    if (field === 'comment') return row.comment || '';
    if (field === 'onOrder') return row.onOrder || '';
    return row.electricFlag || '';
}

function getTimelineInputClass(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'RETIRE') {
        return 'border-red-200 bg-red-50 text-red-700 font-bold';
    }
    if (normalized === 'PURCHASE') {
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 font-bold';
    }
    if (normalized === 'GROWTH') {
        return 'border-amber-200 bg-amber-50 text-amber-700 font-bold';
    }
    if (normalized === 'TRADED' || normalized === 'TRADE') {
        return 'border-violet-200 bg-violet-50 text-violet-700 font-bold';
    }
    return 'border-gray-200 bg-white text-gray-800';
}

function getFleetRowDisplayName(row: FleetPlanRow): string {
    return row.unitNumber.trim() || row.makeModel.trim() || 'Unnamed bus';
}

function getYearIndex(years: string[], year: string | null): number {
    if (!year) return -1;
    return years.findIndex((entry) => entry === year);
}

function getTimelineStatusValue(row: FleetPlanRow, year: string): string {
    return (row.timeline[year] || '').trim().toUpperCase();
}

function matchesFleetStatusFilter(
    entry: CombinedFleetRow,
    lifecycle: FleetPlanLifecycle,
    filter: FleetStatusFilter,
    currentYear: number,
): boolean {
    if (filter === 'all') return true;
    if (filter === 'in-service') return lifecycle.isInService;
    if (filter === 'retiring-this-year') return lifecycle.retireYear === String(currentYear);
    if (filter === 'purchasing-this-year') return lifecycle.purchaseYears.includes(String(currentYear));
    if (filter === 'on-order') return Boolean(entry.row.onOrder?.trim());
    if (filter === 'future') return lifecycle.isFuture || lifecycle.purchaseYears.some((year) => Number(year) > currentYear);
    if (filter === 'overdue') return lifecycle.isOverdueRetirement;
    return lifecycle.hasMissingInfo;
}

function countMatchingRows(
    rows: CombinedFleetRow[],
    statusFilter: FleetStatusFilter,
    busTypeFilter: FleetBusTypeFilter,
    currentYear: number,
): number {
    return rows.filter((entry) => {
        if (busTypeFilter !== 'all' && entry.sheetKey !== busTypeFilter) return false;
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return matchesFleetStatusFilter(entry, lifecycle, statusFilter, currentYear);
    }).length;
}

function groupFleetRowsByType(rows: CombinedFleetRow[]): Record<FleetPlanSheetKey, CombinedFleetRow[]> {
    return FLEET_PLAN_SHEET_CONFIGS.reduce((groups, config) => ({
        ...groups,
        [config.key]: rows
            .filter((entry) => entry.sheetKey === config.key)
            .sort((left, right) => getFleetRowDisplayName(left.row).localeCompare(
                getFleetRowDisplayName(right.row),
                undefined,
                { numeric: true, sensitivity: 'base' },
            )),
    }), {} as Record<FleetPlanSheetKey, CombinedFleetRow[]>);
}

export const FleetPlanWorkspace: React.FC<FleetPlanWorkspaceProps> = ({
    data,
    teamId,
    userId,
    onBack,
    onReimport,
    onSaved,
}) => {
    const toast = useToast();
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [pendingFocus, setPendingFocus] = useState<{ rowIndex: number; columnIndex: number } | null>(null);
    const [retirementEditor, setRetirementEditor] = useState<{ sheetKey: FleetPlanSheetKey; rowId: string; fromYear: string } | null>(null);
    const [lifecycleDrag, setLifecycleDrag] = useState<LifecycleDragState | null>(null);
    const [isSnapshotExpanded, setIsSnapshotExpanded] = useState(false);
    const [sortState, setSortState] = useState<FleetPlanSortState | null>(null);
    const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');
    const [busTypeFilter, setBusTypeFilter] = useState<FleetBusTypeFilter>('all');
    const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const {
        state: draft,
        set: setDraft,
        reset: resetDraftHistory,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useUndoRedo<FleetPlanWorkbook>(cloneFleetPlanWorkbook(data), { maxHistory: 100 });
    const draftRef = useRef(draft);

    const currentYear = new Date().getFullYear();
    const currentYearLabel = String(currentYear);
    const nextYearLabel = String(currentYear + 1);
    const combinedRows = useMemo<CombinedFleetRow[]>(() => draft.sheets.flatMap((sheet) => sheet.rows.map((row) => ({ sheetKey: sheet.key, row }))), [draft.sheets]);
    const sortedRows = useMemo(() => sortFleetPlanEntries(combinedRows, sortState, (entry, sort) => {
        if (sort.kind === 'timeline') {
            return entry.row.timeline[sort.key] || '';
        }
        if (sort.key === 'busType') {
            return BUS_TYPE_LABELS[entry.sheetKey];
        }
        return getBaseFieldValue(entry.row, sort.key as Exclude<BaseFleetField, 'busType'>);
    }), [combinedRows, sortState]);
    const filteredRows = useMemo(() => sortedRows.filter((entry) => {
        if (busTypeFilter !== 'all' && entry.sheetKey !== busTypeFilter) return false;
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return matchesFleetStatusFilter(entry, lifecycle, statusFilter, currentYear);
    }), [busTypeFilter, currentYear, sortedRows, statusFilter]);
    const fleetTotalsByYear = useMemo(() => Object.fromEntries(
        DISPLAY_TIMELINE_COLUMNS.map((column) => [
            column.key,
            filteredRows.filter(({ sheetKey, row }) => isFleetPlanRowCountedInFleetTotal(row, sheetKey, column.key)).length,
        ]),
    ) as Record<string, number>, [filteredRows]);
    const snapshotYears = useMemo(() => [currentYearLabel, nextYearLabel].map((yearLabel) => {
        const retirements = combinedRows.filter((entry) => {
            const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
            return lifecycle.retireYear === yearLabel;
        });
        const purchases = combinedRows.filter((entry) => {
            const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
            return lifecycle.purchaseYears.includes(yearLabel);
        });
        return {
            yearLabel,
            retirements,
            purchases,
            retirementsByType: groupFleetRowsByType(retirements),
            purchasesByType: groupFleetRowsByType(purchases),
        };
    }), [combinedRows, currentYear, currentYearLabel, nextYearLabel]);
    const isDirty = JSON.stringify(draft) !== JSON.stringify(data);
    const editableColumns = COMBINED_GRID_COLUMNS;
    const makeModelOptions = useMemo(() => Array.from(new Set(
        draft.sheets
            .flatMap((sheet) => sheet.rows.map((row) => row.makeModel.trim()))
            .filter(Boolean),
    )).sort(), [draft.sheets]);
    const yearOptions = useMemo(() => Array.from(new Set(
        draft.sheets
            .flatMap((sheet) => sheet.rows.map((row) => row.year.trim()))
            .filter(Boolean),
    )).sort(), [draft.sheets]);
    const activeSheetIssueCount = useMemo(() => combinedRows.filter(({ row }) => !row.unitNumber.trim()).length, [combinedRows]);
    const makeModelListId = 'fleet-plan-make-model-combined';
    const yearListId = 'fleet-plan-year-combined';
    const activeRetirementRow = useMemo(() => {
        if (!retirementEditor) return null;
        return combinedRows.find(({ sheetKey, row }) => sheetKey === retirementEditor.sheetKey && row.id === retirementEditor.rowId) ?? null;
    }, [combinedRows, retirementEditor]);
    const getSortIndicator = useCallback((column: Pick<FleetPlanSortState, 'kind' | 'key'>) => {
        if (sortState?.kind !== column.kind || sortState.key !== column.key) return '↕';
        return sortState.direction === 'asc' ? '↑' : '↓';
    }, [sortState]);

    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    useEffect(() => {
        const nextDraft = cloneFleetPlanWorkbook(data);
        if (JSON.stringify(draftRef.current) === JSON.stringify(nextDraft)) {
            return;
        }
        draftRef.current = nextDraft;
        resetDraftHistory(nextDraft);
        setPendingFocus(null);
    }, [data, resetDraftHistory]);

    useEffect(() => {
        if (!pendingFocus) return;
        const input = cellRefs.current[`${pendingFocus.rowIndex}:${pendingFocus.columnIndex}`];
        if (!input) return;
        input.focus();
        input.select();
        setPendingFocus(null);
    }, [draft, pendingFocus]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const hasShortcutModifier = event.ctrlKey || event.metaKey;
            if (!hasShortcutModifier) return;
            if (isEditableEventTarget(event.target)) return;

            if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                if (canUndo) undo();
                return;
            }

            if (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z')) {
                event.preventDefault();
                if (canRedo) redo();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canRedo, canUndo, redo, undo]);

    const updateDraft = useCallback((updater: (current: FleetPlanWorkbook) => FleetPlanWorkbook) => {
        const nextDraft = updater(draftRef.current);
        draftRef.current = nextDraft;
        setDraft(nextDraft);
    }, [setDraft]);

    const mutateSheet = useCallback((sheetKey: FleetPlanSheetKey, updater: (rows: FleetPlanRow[]) => FleetPlanRow[]) => {
        updateDraft((current) => {
            const targetSheet = current.sheets.find((sheet) => sheet.key === sheetKey);
            if (!targetSheet) return current;
            return replaceFleetPlanSheet(current, {
                ...targetSheet,
                rows: updater(targetSheet.rows),
            });
        });
    }, [updateDraft]);

    const focusCell = useCallback((rowIndex: number, columnIndex: number) => {
        const input = cellRefs.current[`${rowIndex}:${columnIndex}`];
        if (input) {
            input.focus();
            input.select();
            return;
        }
        setPendingFocus({ rowIndex, columnIndex });
    }, []);

    const handleAddRow = useCallback((focusColumnIndex = 0) => {
        const defaultSheetKey: FleetPlanSheetKey = 'diesel-12m';
        const nextRowIndex = combinedRows.length;
        setSortState(null);
        mutateSheet(defaultSheetKey, (rows) => [...rows, createEmptyFleetPlanRow(defaultSheetKey)]);
        setPendingFocus({ rowIndex: nextRowIndex, columnIndex: focusColumnIndex });
    }, [combinedRows.length, mutateSheet]);

    const moveRowToSheet = useCallback((fromSheetKey: FleetPlanSheetKey, rowId: string, toSheetKey: FleetPlanSheetKey) => {
        if (fromSheetKey === toSheetKey) return;
        updateDraft((current) => {
            const sourceSheet = current.sheets.find((sheet) => sheet.key === fromSheetKey);
            const targetSheet = current.sheets.find((sheet) => sheet.key === toSheetKey);
            const row = sourceSheet?.rows.find((entry) => entry.id === rowId);
            if (!sourceSheet || !targetSheet || !row) return current;

            const targetConfig = FLEET_PLAN_SHEET_CONFIG_BY_KEY[toSheetKey];
            const normalizedRow: FleetPlanRow = {
                ...row,
                electricFlag: toSheetKey === 'electric-12m' ? (row.electricFlag || 'E') : row.electricFlag || '',
                timeline: Object.fromEntries(targetConfig.timelineColumns.map((column) => [column.key, row.timeline[column.key] || ''])),
            };

            return {
                ...current,
                sheets: current.sheets.map((sheet) => {
                    if (sheet.key === fromSheetKey) return { ...sheet, rows: sheet.rows.filter((entry) => entry.id !== rowId) };
                    if (sheet.key === toSheetKey) return { ...sheet, rows: [...sheet.rows, normalizedRow] };
                    return sheet;
                }),
            };
        });
    }, [updateDraft]);

    const handleFieldChange = (sheetKey: FleetPlanSheetKey, rowId: string, field: BaseFleetField, value: string) => {
        if (field === 'busType') {
            moveRowToSheet(sheetKey, rowId, value as FleetPlanSheetKey);
            return;
        }
        mutateSheet(sheetKey, (rows) => updateRow(rows, rowId, (row) => ({ ...row, [field]: value })));
    };

    const handleTimelineChange = (sheetKey: FleetPlanSheetKey, rowId: string, key: string, value: string) => {
        mutateSheet(sheetKey, (rows) => updateRow(rows, rowId, (row) => ({
            ...row,
            timeline: {
                ...row.timeline,
                [key]: value,
            },
        })));
    };

    const handleRetirementDelay = (sheetKey: FleetPlanSheetKey, rowId: string, fromYear: string, toYear: string) => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
        mutateSheet(sheetKey, (rows) => updateRow(rows, rowId, (row) => delayFleetPlanRetirement({
            row,
            timelineColumns: config.timelineColumns,
            fromYear,
            toYear,
        })));
        setRetirementEditor(null);
        toast?.success(`Retirement moved to ${toYear}`);
    };

    const handleLifecycleBoundaryMove = (
        sheetKey: FleetPlanSheetKey,
        rowId: string,
        boundary: 'start' | 'retire',
        toYear: string,
    ) => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
        let changed = false;
        mutateSheet(sheetKey, (rows) => updateRow(rows, rowId, (row) => {
            const nextRow = moveFleetPlanLifecycleBoundary({
                row,
                timelineColumns: config.timelineColumns,
                boundary,
                toYear,
            });
            changed = nextRow !== row;
            return nextRow;
        }));
        if (!changed) {
            toast?.info('Timeline unchanged', boundary === 'start' ? 'In-service year cannot be after retirement.' : 'Retirement cannot be before in-service year.');
        }
    };

    const handleLifecycleWindowMove = (
        sheetKey: FleetPlanSheetKey,
        rowId: string,
        toStartYear: string,
    ) => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
        let changed = false;
        mutateSheet(sheetKey, (rows) => updateRow(rows, rowId, (row) => {
            const nextRow = moveFleetPlanLifecycleWindow({
                row,
                timelineColumns: config.timelineColumns,
                toStartYear,
            });
            changed = nextRow !== row;
            return nextRow;
        }));
        if (!changed) {
            toast?.info('Timeline unchanged', 'The service window cannot move outside the timeline.');
        }
    };

    const getLifecyclePointerIndex = (
        clientX: number,
        yearKeys: string[],
        trackLeft: number,
        trackWidth: number,
    ): number => {
        const x = clampNumber(clientX - trackLeft, 0, trackWidth);
        const ratio = trackWidth > 0 ? x / trackWidth : 0;
        return clampNumber(Math.round(ratio * (yearKeys.length - 1)), 0, yearKeys.length - 1);
    };

    const handleLifecyclePointerDown = (
        event: React.PointerEvent<HTMLDivElement>,
        sheetKey: FleetPlanSheetKey,
        rowId: string,
        mode: LifecycleDragMode,
        yearKeys: string[],
        lifecycle: FleetPlanLifecycle,
    ) => {
        if (!lifecycle.startYear) return;
        if (mode === 'window' && !lifecycle.retireYear) return;

        const startIndex = getYearIndex(yearKeys, lifecycle.startYear);
        const retireIndex = lifecycle.retireYear ? getYearIndex(yearKeys, lifecycle.retireYear) : yearKeys.length - 1;
        if (startIndex < 0 || retireIndex < 0) return;

        const track = event.currentTarget.closest<HTMLElement>('[data-lifecycle-track]');
        const trackRect = track?.getBoundingClientRect();
        if (!trackRect) return;

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setLifecycleDrag({
            sheetKey,
            rowId,
            mode,
            yearKeys,
            startIndex,
            retireIndex,
            pointerStartIndex: getLifecyclePointerIndex(event.clientX, yearKeys, trackRect.left, trackRect.width),
            trackLeft: trackRect.left,
            trackWidth: trackRect.width,
        });
    };

    const handleLifecyclePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!lifecycleDrag) return;

        const targetIndex = getLifecyclePointerIndex(
            event.clientX,
            lifecycleDrag.yearKeys,
            lifecycleDrag.trackLeft,
            lifecycleDrag.trackWidth,
        );
        if (lifecycleDrag.mode === 'start') {
            const nextIndex = clampNumber(targetIndex, 0, lifecycleDrag.retireIndex);
            const year = lifecycleDrag.yearKeys[nextIndex];
            if (year) handleLifecycleBoundaryMove(lifecycleDrag.sheetKey, lifecycleDrag.rowId, 'start', year);
            return;
        }

        if (lifecycleDrag.mode === 'retire') {
            const nextIndex = clampNumber(targetIndex, lifecycleDrag.startIndex, lifecycleDrag.yearKeys.length - 1);
            const year = lifecycleDrag.yearKeys[nextIndex];
            if (year) handleLifecycleBoundaryMove(lifecycleDrag.sheetKey, lifecycleDrag.rowId, 'retire', year);
            return;
        }

        const lifecycleWidth = lifecycleDrag.retireIndex - lifecycleDrag.startIndex;
        const delta = targetIndex - lifecycleDrag.pointerStartIndex;
        const nextStartIndex = clampNumber(
            lifecycleDrag.startIndex + delta,
            0,
            Math.max(0, lifecycleDrag.yearKeys.length - 1 - lifecycleWidth),
        );
        const year = lifecycleDrag.yearKeys[nextStartIndex];
        if (year) handleLifecycleWindowMove(lifecycleDrag.sheetKey, lifecycleDrag.rowId, year);
    };

    const handleLifecyclePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setLifecycleDrag(null);
    };

    const resolveGridColumnIndex = useCallback((column: FleetPlanGridColumn): number => (
        editableColumns.findIndex((gridColumn) => gridColumn.kind === column.kind && gridColumn.key === column.key)
    ), [editableColumns]);

    const handleKeyboardNavigation = (
        event: React.KeyboardEvent<HTMLInputElement>,
        rowIndex: number,
        columnIndex: number,
        mode: 'horizontal' | 'vertical',
    ) => {
        if (columnIndex < 0 || editableColumns.length === 0) return;

        const navigation = getNextFleetPlanCellPosition({
            rowCount: filteredRows.length,
            columnCount: editableColumns.length,
            current: { rowIndex, columnIndex },
            mode,
            reverse: event.shiftKey,
        });

        if (!navigation.nextPosition) return;
        event.preventDefault();

        if (navigation.shouldAppendRow) {
            handleAddRow(navigation.nextPosition.columnIndex);
            return;
        }

        focusCell(navigation.nextPosition.rowIndex, navigation.nextPosition.columnIndex);
    };

    const handleCellPaste = (
        event: React.ClipboardEvent<HTMLInputElement>,
        rowIndex: number,
        columnIndex: number,
    ) => {
        if (columnIndex < 0 || editableColumns.length === 0) return;

        const clipboardText = event.clipboardData.getData('text/plain');
        if (!clipboardText.includes('\t') && !clipboardText.includes('\n') && !clipboardText.includes('\r')) {
            return;
        }

        event.preventDefault();
        const parsedRows = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'));
        updateDraft((current) => {
            let next = current;
            parsedRows.forEach((values, rowOffset) => {
                const target = filteredRows[rowIndex + rowOffset];
                if (!target) return;
                values.forEach((value, colOffset) => {
                    const column = editableColumns[columnIndex + colOffset];
                    if (!column || column.key === 'busType') return;
                    next = replaceFleetPlanSheet(next, {
                        ...next.sheets.find((sheet) => sheet.key === target.sheetKey)!,
                        rows: next.sheets.find((sheet) => sheet.key === target.sheetKey)!.rows.map((row) => {
                            if (row.id !== target.row.id) return row;
                            if (column.kind === 'timeline') return { ...row, timeline: { ...row.timeline, [column.key]: value } };
                            return { ...row, [column.key]: value };
                        }),
                    });
                });
            });
            return next;
        });
        toast?.success('Pasted grid data');
    };

    const handleSortColumn = (column: Pick<FleetPlanSortState, 'kind' | 'key'>) => {
        setSortState((current) => getNextFleetPlanSortState(current, column));
        setRetirementEditor(null);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const nextWorkbook: FleetPlanWorkbook = {
                ...draft,
                metadata: {
                    ...draft.metadata,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                },
            };
            await saveFleetPlanWorkbook(teamId, nextWorkbook);
            draftRef.current = nextWorkbook;
            setDraft(nextWorkbook);
            onSaved(nextWorkbook);
            toast?.success('Fleet Plan saved');
        } catch (error) {
            console.error('Failed to save Fleet Plan:', error);
            toast?.error(error instanceof Error ? error.message : 'Failed to save Fleet Plan');
        } finally {
            setSaving(false);
        }
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            await exportFleetPlanWorkbook(draft, draft.metadata.sourceFileName || 'Fleet_Plan.xlsx');
            toast?.success('Fleet Plan exported');
        } catch (error) {
            console.error('Failed to export Fleet Plan:', error);
            toast?.error(error instanceof Error ? error.message : 'Failed to export Fleet Plan');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                        <button
                            onClick={onBack}
                            className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700"
                        >
                            <ArrowLeft size={16} />
                            Back to Analytics
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-4xl font-extrabold tracking-tight text-gray-950">Fleet Plan Workspace</h2>
                            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700">
                                <FileSpreadsheet size={14} />
                                <span className="truncate">{draft.metadata.sourceFileName}</span>
                            </span>
                        </div>
                        <p className="mt-2 text-sm text-gray-500">
                            Digitize the shared fleet workbook, edit structured rows, and export back to Excel.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={undo}
                                disabled={!canUndo}
                                title="Undo (Ctrl+Z)"
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Undo2 size={16} />
                                Undo
                            </button>
                            <button
                                onClick={redo}
                                disabled={!canRedo}
                                title="Redo (Ctrl+Y)"
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Redo2 size={16} />
                                Redo
                            </button>
                            <button
                                onClick={onReimport}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                            >
                                <RefreshCw size={16} />
                                Replace workbook
                            </button>
                            <button
                                onClick={() => void handleExport()}
                                disabled={exporting}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                Export
                            </button>
                            <button
                                onClick={() => void handleSave()}
                                disabled={saving || !isDirty}
                                className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-600 disabled:opacity-50"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save shared plan
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <button
                    type="button"
                    onClick={() => setIsSnapshotExpanded((expanded) => !expanded)}
                    aria-expanded={isSnapshotExpanded}
                    className="flex w-full flex-col gap-4 text-left xl:flex-row xl:items-start xl:justify-between"
                >
                    <div>
                        <h3 className="flex items-center gap-2 text-xl font-extrabold text-gray-950">
                            <ChevronDown
                                size={20}
                                className={`text-gray-400 transition-transform ${isSnapshotExpanded ? '' : '-rotate-90'}`}
                            />
                            Fleet snapshot
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">
                            {currentYearLabel} and {nextYearLabel} retirements and purchases pulled from the fleet timeline.
                        </p>
                    </div>
                    <div className="text-sm font-bold text-brand-blue">
                        {snapshotYears.reduce((total, snapshot) => total + snapshot.retirements.length, 0)} retiring · {snapshotYears.reduce((total, snapshot) => total + snapshot.purchases.length, 0)} purchasing
                    </div>
                </button>
                {isSnapshotExpanded && (
                    <div className="mt-4 space-y-4">
                        {snapshotYears.map((snapshot) => (
                            <div key={snapshot.yearLabel}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="text-sm font-extrabold text-gray-800">{snapshot.yearLabel}</h4>
                                    <div className="text-xs font-extrabold text-gray-500">
                                        {snapshot.retirements.length} retiring · {snapshot.purchases.length} purchasing
                                    </div>
                                </div>
                                <div className="mt-2 grid gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
                                        <div className="text-sm font-extrabold text-red-700">Retiring in {snapshot.yearLabel}</div>
                                        {snapshot.retirements.length > 0 ? (
                                            <div className="mt-3 space-y-3">
                                                {FLEET_PLAN_SHEET_CONFIGS.map((config) => {
                                                    const entries = snapshot.retirementsByType[config.key];
                                                    if (!entries?.length) return null;
                                                    return (
                                                        <div key={config.key}>
                                                            <div className="text-[11px] font-extrabold uppercase tracking-wide text-red-700/70">
                                                                {BUS_TYPE_LABELS[config.key]}
                                                            </div>
                                                            <div className="mt-1.5 flex flex-wrap gap-2">
                                                                {entries.map(({ sheetKey, row }) => (
                                                                    <span key={`${sheetKey}-${row.id}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-700 shadow-sm">
                                                                        {getFleetRowDisplayName(row)}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : <div className="mt-3 text-sm text-red-700/70">No retirements marked in {snapshot.yearLabel}.</div>}
                                    </div>
                                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                                        <div className="text-sm font-extrabold text-emerald-700">Purchasing in {snapshot.yearLabel}</div>
                                        {snapshot.purchases.length > 0 ? (
                                            <div className="mt-3 space-y-3">
                                                {FLEET_PLAN_SHEET_CONFIGS.map((config) => {
                                                    const entries = snapshot.purchasesByType[config.key];
                                                    if (!entries?.length) return null;
                                                    return (
                                                        <div key={config.key}>
                                                            <div className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-700/70">
                                                                {BUS_TYPE_LABELS[config.key]}
                                                            </div>
                                                            <div className="mt-1.5 flex flex-wrap gap-2">
                                                                {entries.map(({ sheetKey, row }) => (
                                                                    <span key={`${sheetKey}-${row.id}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">
                                                                        {getFleetRowDisplayName(row)}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : <div className="mt-3 text-sm text-emerald-700/70">No purchases marked in {snapshot.yearLabel}.</div>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-5">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <h3 className="text-xl font-extrabold text-gray-950">Fleet timeline</h3>
                            <p className="mt-1 text-sm text-gray-500">
                                Drag the in-service and retire controls to update the plan immediately. Retirements are exported as red RETIRE cells.
                            </p>
                        </div>
                        <button
                            onClick={() => handleAddRow()}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-brand-blue shadow-sm hover:bg-blue-50"
                        >
                            Add row
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="mt-4 space-y-3">
                        <div className="flex flex-wrap gap-2">
                            {STATUS_FILTERS.map((filter) => {
                                const label = filter.key === 'retiring-this-year'
                                    ? `Retiring ${currentYearLabel}`
                                    : filter.key === 'purchasing-this-year'
                                        ? `Purchasing ${currentYearLabel}`
                                        : filter.label;
                                const count = countMatchingRows(combinedRows, filter.key, busTypeFilter, currentYear);
                                return (
                                    <button
                                        key={filter.key}
                                        type="button"
                                        onClick={() => setStatusFilter(filter.key)}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-extrabold transition ${
                                            statusFilter === filter.key
                                                ? 'border-brand-blue bg-blue-50 text-brand-blue'
                                                : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50'
                                        }`}
                                    >
                                        {label} <span className="ml-1 text-gray-400">{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {BUS_TYPE_FILTERS.map((filter) => (
                                <button
                                    key={filter.key}
                                    type="button"
                                    onClick={() => setBusTypeFilter(filter.key)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-extrabold transition ${
                                        busTypeFilter === filter.key
                                            ? 'border-gray-900 bg-gray-900 text-white'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="sticky top-0 z-50 border-b border-gray-200 bg-white px-6 py-4 shadow-md">
                    <div className="grid gap-4 xl:grid-cols-[280px_minmax(520px,1fr)]">
                        <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500">
                            Fleet total by year
                        </div>
                        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${DISPLAY_TIMELINE_COLUMNS.length}, minmax(42px, 1fr))` }}>
                            {DISPLAY_TIMELINE_COLUMNS.map((column) => (
                                <div key={column.key} className="rounded-lg bg-gray-50 px-1.5 py-2 text-center">
                                    <div className="text-[10px] font-extrabold text-gray-500">{column.key}</div>
                                    <div className="mt-1 text-sm font-black text-gray-950">{fleetTotalsByYear[column.key] ?? 0}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="divide-y divide-gray-100">
                    {filteredRows.map(({ sheetKey, row }) => {
                        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
                        const yearKeys = DISPLAY_TIMELINE_COLUMNS.map((column) => column.key);
                        const lifecycle = getFleetPlanLifecycle(row, config.timelineColumns, currentYear);
                        const firstVisibleYear = Number(yearKeys[0] || FLEET_TIMELINE_START_YEAR);
                        const lastVisibleYear = Number(yearKeys[yearKeys.length - 1] || FLEET_TIMELINE_START_YEAR);
                        const rawStartIndex = getYearIndex(yearKeys, lifecycle.startYear);
                        const startIndex = rawStartIndex >= 0
                            ? rawStartIndex
                            : lifecycle.startYear && Number(lifecycle.startYear) > lastVisibleYear
                                ? yearKeys.length - 1
                                : 0;
                        const rawRetireIndex = getYearIndex(yearKeys, lifecycle.retireYear);
                        const hasRetirementYear = Boolean(lifecycle.retireYear);
                        const safeRetireIndex = hasRetirementYear && rawRetireIndex >= 0
                            ? Math.max(startIndex, rawRetireIndex)
                            : hasRetirementYear && lifecycle.retireYear && Number(lifecycle.retireYear) < firstVisibleYear
                                ? startIndex
                                : yearKeys.length - 1;
                        const maxIndex = Math.max(1, yearKeys.length - 1);
                        const leftPct = (startIndex / maxIndex) * 100;
                        const rightPct = (safeRetireIndex / maxIndex) * 100;
                        const widthPct = Math.max(4, rightPct - leftPct);

                        return (
                            <div key={`${sheetKey}-${row.id}`} className="grid gap-4 px-6 py-5 xl:grid-cols-[280px_minmax(520px,1fr)]">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <input
                                            value={row.unitNumber}
                                            onChange={(event) => handleFieldChange(sheetKey, row.id, 'unitNumber', event.target.value)}
                                            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-extrabold text-gray-950 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            aria-label="Unit number"
                                        />
                                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-extrabold uppercase text-gray-600">
                                            {BUS_TYPE_LABELS[sheetKey]}
                                        </span>
                                    </div>
                                    <input
                                        value={row.makeModel}
                                        onChange={(event) => handleFieldChange(sheetKey, row.id, 'makeModel', event.target.value)}
                                        className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        placeholder="Make/model"
                                        aria-label="Make model"
                                    />
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                        <label className="text-xs font-bold text-gray-500">
                                            In service
                                            <input
                                                value={row.year}
                                                onChange={(event) => handleFieldChange(sheetKey, row.id, 'year', event.target.value)}
                                                list={yearListId}
                                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </label>
                                        <label className="text-xs font-bold text-gray-500">
                                            On order
                                            <input
                                                value={row.onOrder || ''}
                                                onChange={(event) => handleFieldChange(sheetKey, row.id, 'onOrder', event.target.value)}
                                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </label>
                                    </div>
                                    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
                                        Service life: <span className="text-gray-950">{getFleetPlanServiceLifeLabel(row.year, currentYear)}</span>
                                    </div>
                                </div>

                                <div className="min-w-0">
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-600">
                                            <span>
                                                In service: <span className="text-brand-blue">{lifecycle.startYear || 'missing'}</span>
                                            </span>
                                            <span>
                                                Retirement: <span className={hasRetirementYear ? 'text-red-600' : 'text-amber-600'}>{lifecycle.retireYear || 'Not set'}</span>
                                            </span>
                                        </div>
                                        <div
                                            data-lifecycle-track
                                            className="relative h-12 touch-none select-none"
                                            onPointerMove={handleLifecyclePointerMove}
                                            onPointerUp={handleLifecyclePointerEnd}
                                            onPointerCancel={handleLifecyclePointerEnd}
                                            aria-label={`Fleet lifecycle for bus ${row.unitNumber || 'row'}`}
                                        >
                                            <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gray-200" />
                                            <div
                                                data-drag-mode="window"
                                                role="slider"
                                                tabIndex={0}
                                                aria-label={`Move service window for bus ${row.unitNumber || 'row'}`}
                                                aria-valuetext={`${lifecycle.startYear || 'missing'} to ${lifecycle.retireYear || 'retirement not set'}`}
                                                title="Drag the bar to move the full service window"
                                                onPointerDown={(event) => handleLifecyclePointerDown(event, sheetKey, row.id, 'window', yearKeys, lifecycle)}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                                    event.preventDefault();
                                                    const nextIndex = clampNumber(startIndex + (event.key === 'ArrowRight' ? 1 : -1), 0, yearKeys.length - 1 - Math.max(0, safeRetireIndex - startIndex));
                                                    const year = yearKeys[nextIndex];
                                                    if (year) handleLifecycleWindowMove(sheetKey, row.id, year);
                                                }}
                                                className={`absolute top-1/2 z-10 h-5 -translate-y-1/2 cursor-grab rounded-full shadow-sm outline-none ring-blue-200 transition hover:bg-blue-600 focus:ring-4 active:cursor-grabbing ${
                                                    hasRetirementYear ? 'bg-blue-500' : 'border border-dashed border-blue-500 bg-blue-300/70'
                                                }`}
                                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                            />
                                            <div
                                                data-drag-mode="start"
                                                role="slider"
                                                tabIndex={0}
                                                aria-label={`Set in-service year for bus ${row.unitNumber || 'row'}`}
                                                aria-valuemin={0}
                                                aria-valuemax={safeRetireIndex}
                                                aria-valuenow={startIndex}
                                                aria-valuetext={lifecycle.startYear || 'missing'}
                                                title={`Drag start: ${lifecycle.startYear || 'missing'}`}
                                                onPointerDown={(event) => handleLifecyclePointerDown(event, sheetKey, row.id, 'start', yearKeys, lifecycle)}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                                    event.preventDefault();
                                                    const nextIndex = clampNumber(startIndex + (event.key === 'ArrowRight' ? 1 : -1), 0, safeRetireIndex);
                                                    const year = yearKeys[nextIndex];
                                                    if (year) handleLifecycleBoundaryMove(sheetKey, row.id, 'start', year);
                                                }}
                                                className="absolute top-1/2 z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white bg-blue-600 shadow outline-none ring-blue-200 transition hover:scale-105 focus:ring-4"
                                                style={{ left: `${leftPct}%` }}
                                            />
                                            <div
                                                data-drag-mode="retire"
                                                role="slider"
                                                tabIndex={0}
                                                aria-label={`Set retirement year for bus ${row.unitNumber || 'row'}`}
                                                aria-valuemin={startIndex}
                                                aria-valuemax={yearKeys.length - 1}
                                                aria-valuenow={safeRetireIndex}
                                                aria-valuetext={lifecycle.retireYear || 'retirement not set'}
                                                title={hasRetirementYear ? `Drag retire: ${lifecycle.retireYear}` : 'Retirement not set'}
                                                onPointerDown={(event) => handleLifecyclePointerDown(event, sheetKey, row.id, 'retire', yearKeys, lifecycle)}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                                    event.preventDefault();
                                                    const nextIndex = clampNumber(safeRetireIndex + (event.key === 'ArrowRight' ? 1 : -1), startIndex, yearKeys.length - 1);
                                                    const year = yearKeys[nextIndex];
                                                    if (year) handleLifecycleBoundaryMove(sheetKey, row.id, 'retire', year);
                                                }}
                                                className={`absolute top-1/2 z-20 h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white shadow outline-none ring-red-200 transition hover:scale-105 focus:ring-4 ${
                                                    hasRetirementYear ? 'bg-red-600' : 'border-dashed bg-amber-400'
                                                }`}
                                                style={{ left: `${rightPct}%` }}
                                            />
                                            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-[10px] font-bold text-gray-400">
                                                {yearKeys.map((year) => (
                                                    <span key={year}>{year.slice(2)}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <p className="mt-2 text-xs font-medium text-gray-500">
                                        Drag the blue bar to move the bus window, or drag either end to adjust in-service and retirement years.
                                    </p>
                                    {!hasRetirementYear ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const fallbackYear = yearKeys[Math.max(startIndex, yearKeys.length - 1)];
                                                if (fallbackYear) handleLifecycleBoundaryMove(sheetKey, row.id, 'retire', fallbackYear);
                                            }}
                                            className="mt-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700 transition hover:bg-amber-100"
                                        >
                                            Set retirement year
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}

                    {filteredRows.length === 0 ? (
                        <div className="px-6 py-12 text-center text-sm text-gray-500">
                            No fleet rows match the selected filters.
                        </div>
                    ) : null}
                </div>
            </section>

            <div>
                <section className="min-w-0 flex-1 space-y-4">
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h3 className="text-xl font-extrabold text-gray-950">
                                    Detailed Excel grid <span className="ml-2 text-brand-blue">Fleet Plan</span>
                                </h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    Filtered rows use the same saved/exported data as the timeline above.
                                </p>
                            </div>
                            <button
                                onClick={() => handleAddRow()}
                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-brand-blue shadow-sm hover:bg-blue-50"
                            >
                                Add row
                                <Plus size={16} />
                            </button>
                        </div>

                        <datalist id="fleet-plan-bus-types">
                            {Object.values(BUS_TYPE_LABELS).map((option) => (
                                <option key={option} value={option} />
                            ))}
                        </datalist>
                        <datalist id={makeModelListId}>
                            {makeModelOptions.map((option) => (
                                <option key={option} value={option} />
                            ))}
                        </datalist>
                        <datalist id={yearListId}>
                            {yearOptions.map((option) => (
                                <option key={option} value={option} />
                            ))}
                        </datalist>

                        <div className="overflow-auto">
                                    <table className="min-w-full border-separate border-spacing-0">
                                        <thead>
                                            <tr className="bg-gray-50">
                                                <th className="sticky top-0 z-10 w-16 border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-right text-xs font-bold text-gray-500">
                                                    Row
                                                </th>
                                                {COMBINED_BASE_COLUMNS.map((column) => (
                                                    <th
                                                        key={column.key}
                                                        className="sticky top-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-left text-xs font-bold text-gray-700"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSortColumn({ kind: 'base', key: column.key })}
                                                            className="flex w-full items-center justify-between gap-2 text-left font-bold hover:text-brand-blue"
                                                            title="Click to sort ascending, descending, then original order"
                                                        >
                                                            <span>{column.label}</span>
                                                            <span className="text-gray-400">{getSortIndicator({ kind: 'base', key: column.key })}</span>
                                                        </button>
                                                    </th>
                                                ))}
                                                {DISPLAY_TIMELINE_COLUMNS.map((column) => (
                                                    <th
                                                        key={column.key}
                                                        className="sticky top-0 z-10 min-w-[86px] border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-center text-xs font-bold text-gray-700"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSortColumn({ kind: 'timeline', key: column.key })}
                                                            className="flex w-full items-center justify-center gap-2 font-bold hover:text-brand-blue"
                                                            title="Click to sort ascending, descending, then original order"
                                                        >
                                                            <span>{column.label}</span>
                                                            <span className="text-gray-400">{getSortIndicator({ kind: 'timeline', key: column.key })}</span>
                                                        </button>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredRows.map(({ sheetKey, row }, rowIndex) => (
                                                <tr key={row.id} className="bg-white hover:bg-blue-50/30">
                                                    <td className="border-b border-r border-gray-200 px-3 py-2 text-right text-sm font-semibold text-gray-700 align-middle">
                                                        {rowIndex + 1}
                                                    </td>
                                                    {COMBINED_BASE_COLUMNS.map((column) => {
                                                        const columnIndex = resolveGridColumnIndex({
                                                            kind: 'base',
                                                            key: column.key,
                                                            label: column.label,
                                                        });
                                                        return (
                                                            <td key={`${row.id}-${column.key}`} className="border-b border-r border-gray-200 px-2 py-2 align-top">
                                                                <input
                                                                    ref={(input) => {
                                                                        if (columnIndex >= 0) {
                                                                            cellRefs.current[`${rowIndex}:${columnIndex}`] = input;
                                                                        }
                                                                    }}
                                                                    value={column.key === 'busType' ? BUS_TYPE_LABELS[sheetKey] : getBaseFieldValue(row, column.key as Exclude<BaseFleetField, 'busType'>)}
                                                                    onChange={(event) => {
                                                                        const nextValue = column.key === 'busType'
                                                                            ? (Object.entries(BUS_TYPE_LABELS).find(([, label]) => label === event.target.value)?.[0] ?? event.target.value)
                                                                            : event.target.value;
                                                                        handleFieldChange(sheetKey, row.id, column.key, nextValue);
                                                                    }}
                                                                    list={column.key === 'busType' ? 'fleet-plan-bus-types' : column.key === 'makeModel' ? makeModelListId : column.key === 'year' ? yearListId : undefined}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Tab') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'horizontal');
                                                                        } else if (event.key === 'Enter') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'vertical');
                                                                        }
                                                                    }}
                                                                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                                                                    className={`h-8 w-full rounded border border-gray-200 bg-white px-2 text-sm text-gray-800 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100 ${
                                                                        column.key === 'busType' ? 'min-w-[150px]' : 'min-w-[74px]'
                                                                    }`}
                                                                />
                                                            </td>
                                                        );
                                                    })}

                                                    {DISPLAY_TIMELINE_COLUMNS.map((column) => {
                                                        const columnIndex = resolveGridColumnIndex({
                                                            kind: 'timeline',
                                                            key: column.key,
                                                            label: column.label,
                                                        });
                                                        return (
                                                            <td key={`${row.id}-${column.key}`} className="border-b border-r border-gray-200 px-2 py-2 align-top">
                                                                <input
                                                                    ref={(input) => {
                                                                        if (columnIndex >= 0) {
                                                                            cellRefs.current[`${rowIndex}:${columnIndex}`] = input;
                                                                        }
                                                                    }}
                                                                    value={row.timeline[column.key] || ''}
                                                                    onChange={(event) => handleTimelineChange(sheetKey, row.id, column.key, event.target.value)}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Tab') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'horizontal');
                                                                        } else if (event.key === 'Enter') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'vertical');
                                                                        }
                                                                    }}
                                                                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                                                                    onFocus={() => {
                                                                        if ((row.timeline[column.key] || '').trim().toUpperCase() === 'RETIRE') {
                                                                            setRetirementEditor({ sheetKey, rowId: row.id, fromYear: column.key });
                                                                        }
                                                                    }}
                                                                    className={`h-8 w-full rounded px-2 text-center text-xs shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100 ${getTimelineInputClass(row.timeline[column.key] || '')}`}
                                                                />
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}

                                            {filteredRows.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={COMBINED_BASE_COLUMNS.length + DISPLAY_TIMELINE_COLUMNS.length + 1}
                                                        className="px-4 py-12 text-center text-sm text-gray-500"
                                                    >
                                                        No fleet rows match the selected filters.
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>
                    </div>
            {retirementEditor && activeRetirementRow ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/30 p-4">
                    <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h4 className="text-base font-extrabold text-gray-950">Move retirement</h4>
                                <p className="mt-1 text-sm text-gray-500">
                                    Bus {activeRetirementRow.row.unitNumber || 'this bus'} currently retires in {retirementEditor.fromYear}.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRetirementEditor(null)}
                                className="rounded-full px-2 py-1 text-lg font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Close retirement editor"
                            >
                                ×
                            </button>
                        </div>
                        <label className="mt-4 block text-sm font-bold text-gray-700">New retirement year</label>
                        <select
                            className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                            defaultValue=""
                            onChange={(event) => {
                                if (event.target.value) {
                                    handleRetirementDelay(retirementEditor.sheetKey, retirementEditor.rowId, retirementEditor.fromYear, event.target.value);
                                }
                            }}
                        >
                            <option value="" disabled>Choose year</option>
                            {FLEET_PLAN_SHEET_CONFIG_BY_KEY[retirementEditor.sheetKey].timelineColumns
                                .filter((option) => Number(option.key) > Number(retirementEditor.fromYear))
                                .map((option) => (
                                    <option key={option.key} value={option.key}>{option.label}</option>
                                ))}
                        </select>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
