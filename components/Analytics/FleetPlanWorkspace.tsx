import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Bus,
    ChevronDown,
    Copy,
    Download,
    ExternalLink,
    FileSpreadsheet,
    Grid3X3,
    Loader2,
    Plus,
    Redo2,
    RefreshCw,
    Save,
    Trash2,
    Undo2,
    Users,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { exportFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanExport';
import { cloneFleetPlanWorkbook, createEmptyFleetPlanRow, replaceFleetPlanSheet, summarizeFleetPlan } from '../../utils/fleet-plan/fleetPlanModel';
import { saveFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanService';
import { FLEET_PLAN_SHEET_CONFIG_BY_KEY } from '../../utils/fleet-plan/fleetPlanConfig';
import {
    applyFleetPlanPaste,
    getFleetPlanGridColumns,
    getNextFleetPlanCellPosition,
    insertDuplicatedFleetPlanRow,
} from '../../utils/fleet-plan/fleetPlanEditing';
import type { FleetPlanGridColumn } from '../../utils/fleet-plan/fleetPlanEditing';
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
    const [activeSheetKey, setActiveSheetKey] = useState<FleetPlanSheetKey>('diesel-12m');
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [pendingFocus, setPendingFocus] = useState<{ rowIndex: number; columnIndex: number } | null>(null);
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
    const activeSheet = useMemo(
        () => draft.sheets.find((sheet) => sheet.key === activeSheetKey) ?? draft.sheets[0],
        [draft.sheets, activeSheetKey],
    );
    const isDirty = JSON.stringify(draft) !== JSON.stringify(data);
    const activeConfig = activeSheet ? FLEET_PLAN_SHEET_CONFIG_BY_KEY[activeSheet.key] : null;
    const editableColumns = useMemo(
        () => (activeConfig ? getFleetPlanGridColumns(activeConfig) : []),
        [activeConfig],
    );
    const visibleSheets = draft.sheets.slice(0, 4);
    const hiddenSheetCount = Math.max(0, draft.sheets.length - visibleSheets.length);
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
    const activeSheetIssueCount = useMemo(() => {
        if (!activeSheet) return 0;
        return activeSheet.rows.filter((row) => !row.unitNumber.trim()).length;
    }, [activeSheet]);
    const makeModelListId = `fleet-plan-make-model-${activeSheet?.key ?? 'sheet'}`;
    const yearListId = `fleet-plan-year-${activeSheet?.key ?? 'sheet'}`;

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
        if (!activeSheet) return;
        const nextRowIndex = activeSheet.rows.length;
        mutateSheet(activeSheet.key, (rows) => [...rows, createEmptyFleetPlanRow(activeSheet.key)]);
        setPendingFocus({ rowIndex: nextRowIndex, columnIndex: focusColumnIndex });
    }, [activeSheet, mutateSheet]);

    const handleRemoveRow = (rowId: string) => {
        if (!activeSheet) return;
        mutateSheet(activeSheet.key, (rows) => rows.filter((row) => row.id !== rowId));
    };

    const handleDuplicateRow = (rowId: string) => {
        if (!activeSheet) return;
        const rowIndex = activeSheet.rows.findIndex((row) => row.id === rowId);
        mutateSheet(activeSheet.key, (rows) => insertDuplicatedFleetPlanRow(rows, rowId));
        if (rowIndex >= 0) {
            setPendingFocus({ rowIndex: rowIndex + 1, columnIndex: 0 });
        }
        toast?.success('Row duplicated');
    };

    const handleFieldChange = (
        rowId: string,
        field: keyof Pick<FleetPlanRow, 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag' | 'onOrder'>,
        value: string,
    ) => {
        if (!activeSheet) return;
        mutateSheet(activeSheet.key, (rows) => updateRow(rows, rowId, (row) => ({ ...row, [field]: value })));
    };

    const handleTimelineChange = (rowId: string, key: string, value: string) => {
        if (!activeSheet) return;
        mutateSheet(activeSheet.key, (rows) => updateRow(rows, rowId, (row) => ({
            ...row,
            timeline: {
                ...row.timeline,
                [key]: value,
            },
        })));
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
        if (!activeSheet || columnIndex < 0 || editableColumns.length === 0) return;

        const navigation = getNextFleetPlanCellPosition({
            rowCount: activeSheet.rows.length,
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
        if (!activeSheet || columnIndex < 0 || editableColumns.length === 0) return;

        const clipboardText = event.clipboardData.getData('text/plain');
        if (!clipboardText.includes('\t') && !clipboardText.includes('\n') && !clipboardText.includes('\r')) {
            return;
        }

        event.preventDefault();
        mutateSheet(activeSheet.key, (rows) => applyFleetPlanPaste({
            rows,
            sheetKey: activeSheet.key,
            columns: editableColumns,
            startRowIndex: rowIndex,
            startColumnIndex: columnIndex,
            clipboardText,
        }));
        toast?.success('Pasted grid data');
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

    if (!activeSheet || !activeConfig) {
        return null;
    }

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

            <div className="flex flex-col gap-5 xl:flex-row">
                <aside className="shrink-0 xl:w-72">
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                                    <Grid3X3 size={18} className="text-gray-500" />
                                    Sheets
                                </div>
                                <ChevronDown size={16} className="text-gray-400" />
                            </div>
                            <div className="space-y-2">
                                {visibleSheets.map((sheet) => {
                                    const isActive = sheet.key === activeSheet.key;
                                    return (
                                        <button
                                            key={sheet.key}
                                            onClick={() => setActiveSheetKey(sheet.key)}
                                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-all ${
                                                isActive
                                                    ? 'border-brand-blue bg-blue-50 text-brand-blue'
                                                    : 'border-transparent bg-white text-gray-700 hover:bg-gray-50'
                                            }`}
                                        >
                                            <Grid3X3 size={18} />
                                            <span className="truncate">{sheet.name}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {hiddenSheetCount > 0 ? (
                                <button className="mt-3 text-sm font-medium text-gray-500 hover:text-gray-700">
                                    + {hiddenSheetCount} more sheets
                                </button>
                            ) : null}
                        </div>

                        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white">
                                    <Grid3X3 size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-cyan-800">Spreadsheet mode</div>
                                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                                        Work in a familiar grid. Tab, Enter, paste, and undo/redo all preserve the workbook structure.
                                    </p>
                                    <button className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:text-blue-700">
                                        Learn more <ExternalLink size={13} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
                                    <Users size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-violet-800">V1 rules</div>
                                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                                        {activeSheetIssueCount > 0
                                            ? `${activeSheetIssueCount} row${activeSheetIssueCount === 1 ? '' : 's'} need a unit number.`
                                            : 'Validation rules are active for this sheet. No issue cells found.'}
                                    </p>
                                    <button className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
                                        View rules <ExternalLink size={13} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                <section className="min-w-0 flex-1 space-y-4">
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h3 className="text-xl font-extrabold text-gray-950">
                                    Editing sheet <span className="ml-2 text-brand-blue">{activeSheet.name}</span>
                                </h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    Edit planner-owned rows. Footer totals and Excel formatting are rebuilt on export.
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
                                                <th className="sticky top-0 z-10 w-36 border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-left text-xs font-bold text-gray-500">
                                                    Actions
                                                </th>
                                                <th className="sticky top-0 z-10 w-16 border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-right text-xs font-bold text-gray-500">
                                                    Row
                                                </th>
                                                {activeConfig.baseColumns.map((column) => (
                                                    <th
                                                        key={column.key}
                                                        className="sticky top-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-left text-xs font-bold text-gray-700"
                                                    >
                                                        {column.label}
                                                    </th>
                                                ))}
                                                {activeConfig.timelineColumns.map((column) => (
                                                    <th
                                                        key={column.key}
                                                        className="sticky top-0 z-10 min-w-[86px] border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-center text-xs font-bold text-gray-700"
                                                    >
                                                        {column.label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeSheet.rows.map((row, rowIndex) => (
                                                <tr key={row.id} className="bg-white hover:bg-blue-50/30">
                                                    <td className="border-b border-r border-gray-200 px-2 py-2 align-middle">
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => handleDuplicateRow(row.id)}
                                                                aria-label={`Duplicate row ${rowIndex + 1}`}
                                                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] font-semibold text-brand-blue hover:bg-blue-100"
                                                            >
                                                                <Copy size={13} />
                                                                Duplicate
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveRow(row.id)}
                                                                aria-label={`Remove row ${rowIndex + 1}`}
                                                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                                                            >
                                                                <Trash2 size={13} />
                                                                Remove
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="border-b border-r border-gray-200 px-3 py-2 text-right text-sm font-semibold text-gray-700 align-middle">
                                                        {rowIndex + 1}
                                                    </td>
                                                    {activeConfig.baseColumns.map((column) => {
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
                                                                    value={getBaseFieldValue(row, column.key)}
                                                                    onChange={(event) => handleFieldChange(row.id, column.key, event.target.value)}
                                                                    list={column.key === 'makeModel' ? makeModelListId : column.key === 'year' ? yearListId : undefined}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Tab') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'horizontal');
                                                                        } else if (event.key === 'Enter') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'vertical');
                                                                        }
                                                                    }}
                                                                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                                                                    className="h-8 w-full min-w-[74px] rounded border border-gray-200 bg-white px-2 text-sm text-gray-800 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                                />
                                                            </td>
                                                        );
                                                    })}

                                                    {activeConfig.timelineColumns.map((column) => {
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
                                                                    onChange={(event) => handleTimelineChange(row.id, column.key, event.target.value)}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Tab') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'horizontal');
                                                                        } else if (event.key === 'Enter') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'vertical');
                                                                        }
                                                                    }}
                                                                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                                                                    className={`h-8 w-full rounded px-2 text-center text-xs shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100 ${getTimelineInputClass(row.timeline[column.key] || '')}`}
                                                                />
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}

                                            {activeSheet.rows.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={activeConfig.baseColumns.length + activeConfig.timelineColumns.length + 2}
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
                </div>
    );
};
