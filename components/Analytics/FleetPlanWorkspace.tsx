import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Bus,
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
    Users,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { exportFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanExport';
import { cloneFleetPlanWorkbook, createEmptyFleetPlanRow, replaceFleetPlanSheet, summarizeFleetPlan } from '../../utils/fleet-plan/fleetPlanModel';
import { saveFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanService';
import { FLEET_PLAN_SHEET_CONFIGS, FLEET_PLAN_SHEET_CONFIG_BY_KEY } from '../../utils/fleet-plan/fleetPlanConfig';
import {
    delayFleetPlanRetirement,
    getFleetPlanLifecycle,
    getNextFleetPlanSortState,
    getNextFleetPlanCellPosition,
    moveFleetPlanLifecycleBoundary,
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

interface MetricCardProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    tone: 'blue' | 'green' | 'violet';
    children?: React.ReactNode;
}

const toneStyles: Record<MetricCardProps['tone'], { icon: string; value: string }> = {
    blue: { icon: 'bg-blue-50 text-brand-blue', value: 'text-gray-900' },
    green: { icon: 'bg-emerald-50 text-emerald-600', value: 'text-gray-900' },
    violet: { icon: 'bg-violet-50 text-violet-600', value: 'text-gray-900' },
};

const BUS_TYPE_LABELS: Record<FleetPlanSheetKey, string> = {
    'diesel-12m': '12m Diesel',
    'small-buses': '8m & 6m',
    'electric-12m': '12m Electric',
};

type CombinedFleetRow = { sheetKey: FleetPlanSheetKey; row: FleetPlanRow };
type BaseFleetField = 'busType' | 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag' | 'onOrder';
type FleetStatusFilter = 'all' | 'in-service' | 'retiring-this-year' | 'purchasing-this-year' | 'on-order' | 'future' | 'overdue' | 'missing-info';
type FleetBusTypeFilter = 'all' | FleetPlanSheetKey;

const ALL_TIMELINE_COLUMNS = Array.from(
    new Map(FLEET_PLAN_SHEET_CONFIGS.flatMap((config) => config.timelineColumns).map((column) => [column.key, column])).values(),
).sort((left, right) => Number(left.key) - Number(right.key));

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
    ...ALL_TIMELINE_COLUMNS.map((column) => ({ kind: 'timeline' as const, key: column.key, label: column.label })),
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

const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, tone, children }) => {
    const styles = toneStyles[tone];

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-500">{label}</div>
                    <div className={`mt-1 truncate text-xl font-bold ${styles.value}`}>{value}</div>
                </div>
                {children ? <div className="ml-auto shrink-0">{children}</div> : null}
            </div>
        </div>
    );
};

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

    const summary = useMemo(() => summarizeFleetPlan(draft), [draft]);
    const currentYear = new Date().getFullYear();
    const currentYearLabel = String(currentYear);
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
    const thisYearRetirements = useMemo(() => combinedRows.filter((entry) => {
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return lifecycle.retireYear === currentYearLabel;
    }), [combinedRows, currentYear, currentYearLabel]);
    const thisYearPurchases = useMemo(() => combinedRows.filter((entry) => {
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return lifecycle.purchaseYears.includes(currentYearLabel);
    }), [combinedRows, currentYear, currentYearLabel]);
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
                        <h2 className="text-4xl font-extrabold tracking-tight text-gray-950">Fleet Plan Workspace</h2>
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <MetricCard
                    icon={<FileSpreadsheet size={24} />}
                    label="Workbook"
                    value={draft.metadata.sourceFileName}
                    tone="green"
                />
                <MetricCard
                    icon={<Bus size={24} />}
                    label="Fleet rows"
                    value={summary.totalRows.toLocaleString()}
                    tone="blue"
                />
                <MetricCard
                    icon={<Users size={24} />}
                    label="Workspace"
                    value="Team Shared"
                    tone="violet"
                >
                    <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
                        <div className="flex -space-x-2">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-[11px] font-bold text-gray-600">ME</span>
                            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-emerald-100 text-[11px] font-bold text-emerald-700">TM</span>
                            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-amber-100 text-[11px] font-bold text-amber-700">+2</span>
                        </div>
                        <button className="text-xs font-bold text-brand-blue hover:text-blue-700">
                            Manage
                        </button>
                    </div>
                </MetricCard>
            </div>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                        <h3 className="text-xl font-extrabold text-gray-950">This year snapshot</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            {currentYearLabel} retirements and purchases pulled from the fleet timeline.
                        </p>
                    </div>
                    <div className="text-sm font-bold text-brand-blue">
                        {thisYearRetirements.length} retiring · {thisYearPurchases.length} purchasing
                    </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
                        <div className="text-sm font-extrabold text-red-700">Retiring in {currentYearLabel}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {thisYearRetirements.length > 0 ? thisYearRetirements.map(({ sheetKey, row }) => (
                                <span key={`${sheetKey}-${row.id}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-700 shadow-sm">
                                    {getFleetRowDisplayName(row)}
                                </span>
                            )) : <span className="text-sm text-red-700/70">No retirements marked this year.</span>}
                        </div>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                        <div className="text-sm font-extrabold text-emerald-700">Purchasing in {currentYearLabel}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {thisYearPurchases.length > 0 ? thisYearPurchases.map(({ sheetKey, row }) => (
                                <span key={`${sheetKey}-${row.id}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">
                                    {getFleetRowDisplayName(row)}
                                </span>
                            )) : <span className="text-sm text-emerald-700/70">No purchases marked this year.</span>}
                        </div>
                    </div>
                </div>
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

                <div className="divide-y divide-gray-100">
                    {filteredRows.map(({ sheetKey, row }) => {
                        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
                        const yearKeys = config.timelineColumns.map((column) => column.key);
                        const lifecycle = getFleetPlanLifecycle(row, config.timelineColumns, currentYear);
                        const startIndex = Math.max(0, getYearIndex(yearKeys, lifecycle.startYear));
                        const retireIndex = Math.max(startIndex, getYearIndex(yearKeys, lifecycle.retireYear));
                        const safeRetireIndex = retireIndex >= 0 ? retireIndex : yearKeys.length - 1;
                        const maxIndex = Math.max(1, yearKeys.length - 1);
                        const leftPct = (startIndex / maxIndex) * 100;
                        const rightPct = (safeRetireIndex / maxIndex) * 100;
                        const widthPct = Math.max(4, rightPct - leftPct);
                        const startRangeValue = lifecycle.startYear ? Math.max(0, getYearIndex(yearKeys, lifecycle.startYear)) : 0;
                        const retireRangeValue = lifecycle.retireYear ? Math.max(0, getYearIndex(yearKeys, lifecycle.retireYear)) : yearKeys.length - 1;

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
                                </div>

                                <div className="min-w-0">
                                    <div className="relative h-16 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                                        <div className="absolute left-4 right-4 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gray-200" />
                                        <div
                                            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-blue-500"
                                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                        />
                                        <div
                                            className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow"
                                            style={{ left: `${leftPct}%` }}
                                            title={`In service: ${lifecycle.startYear || 'missing'}`}
                                        />
                                        <div
                                            className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow"
                                            style={{ left: `${rightPct}%` }}
                                            title={`Retire: ${lifecycle.retireYear || 'missing'}`}
                                        />
                                        <div className="absolute inset-x-4 bottom-1 flex justify-between text-[10px] font-bold text-gray-400">
                                            {yearKeys.map((year) => (
                                                <span key={year}>{year.slice(2)}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                                        <label className="text-xs font-bold text-gray-600">
                                            Drag in-service year: <span className="text-brand-blue">{lifecycle.startYear || 'missing'}</span>
                                            <input
                                                type="range"
                                                min={0}
                                                max={yearKeys.length - 1}
                                                value={startRangeValue}
                                                onChange={(event) => {
                                                    const year = yearKeys[Number(event.target.value)];
                                                    if (year) handleLifecycleBoundaryMove(sheetKey, row.id, 'start', year);
                                                }}
                                                className="mt-2 w-full accent-blue-600"
                                            />
                                        </label>
                                        <label className="text-xs font-bold text-gray-600">
                                            Drag retire year: <span className="text-red-600">{lifecycle.retireYear || 'missing'}</span>
                                            <input
                                                type="range"
                                                min={0}
                                                max={yearKeys.length - 1}
                                                value={retireRangeValue}
                                                onChange={(event) => {
                                                    const year = yearKeys[Number(event.target.value)];
                                                    if (year) handleLifecycleBoundaryMove(sheetKey, row.id, 'retire', year);
                                                }}
                                                className="mt-2 w-full accent-red-600"
                                            />
                                        </label>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {yearKeys.map((year) => {
                                            const status = getTimelineStatusValue(row, year);
                                            if (!status) return null;
                                            return (
                                                <span
                                                    key={year}
                                                    className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${
                                                        status === 'RETIRE'
                                                            ? 'bg-red-50 text-red-700'
                                                            : status === 'PURCHASE' || status === 'GROWTH'
                                                                ? 'bg-emerald-50 text-emerald-700'
                                                                : 'bg-blue-50 text-blue-700'
                                                    }`}
                                                >
                                                    {year}: {status === row.unitNumber.trim() ? 'SERVICE' : status}
                                                </span>
                                            );
                                        })}
                                    </div>
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
                                                {ALL_TIMELINE_COLUMNS.map((column) => (
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

                                                    {ALL_TIMELINE_COLUMNS.map((column) => {
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
                                                        colSpan={COMBINED_BASE_COLUMNS.length + ALL_TIMELINE_COLUMNS.length + 1}
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
