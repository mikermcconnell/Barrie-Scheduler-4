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
    getNextFleetPlanSortState,
    getNextFleetPlanCellPosition,
    sortFleetPlanEntries,
} from '../../utils/fleet-plan/fleetPlanEditing';
import type { FleetPlanGridColumn, FleetPlanSortState } from '../../utils/fleet-plan/fleetPlanEditing';
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
            rowCount: sortedRows.length,
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
                const target = sortedRows[rowIndex + rowOffset];
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

            <div>
                <section className="min-w-0 flex-1 space-y-4">
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h3 className="text-xl font-extrabold text-gray-950">
                                    Editing sheet <span className="ml-2 text-brand-blue">Fleet Plan</span>
                                </h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    All bus types are in one grid. Click a RETIRE cell to delay retirement.
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
                                            {sortedRows.map(({ sheetKey, row }, rowIndex) => (
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

                                            {sortedRows.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={COMBINED_BASE_COLUMNS.length + ALL_TIMELINE_COLUMNS.length + 1}
                                                        className="px-4 py-12 text-center text-sm text-gray-500"
                                                    >
                                                        No fleet rows on this sheet yet. Add a row to start building the plan.
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
