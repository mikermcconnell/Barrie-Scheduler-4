import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Bus,
    Copy,
    Download,
    FileSpreadsheet,
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
import { useTeam } from '../contexts/TeamContext';
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
}

const toneStyles: Record<MetricCardProps['tone'], string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    violet: 'bg-violet-50 border-violet-200 text-violet-900',
};

const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, tone }) => (
    <div className={`rounded-2xl border-2 p-4 ${toneStyles[tone]}`}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
            {icon}
            <span>{label}</span>
        </div>
        <div className="mt-2 text-2xl font-extrabold">{value}</div>
    </div>
);

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

export const FleetPlanWorkspace: React.FC<FleetPlanWorkspaceProps> = ({
    data,
    teamId,
    userId,
    onBack,
    onReimport,
    onSaved,
}) => {
    const toast = useToast();
    const { canManageTeam } = useTeam();
    const isReadOnly = !canManageTeam;
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
        if (isReadOnly) return;
        if (!activeSheet) return;
        const nextRowIndex = activeSheet.rows.length;
        mutateSheet(activeSheet.key, (rows) => [...rows, createEmptyFleetPlanRow(activeSheet.key)]);
        setPendingFocus({ rowIndex: nextRowIndex, columnIndex: focusColumnIndex });
    }, [activeSheet, isReadOnly, mutateSheet]);

    const handleRemoveRow = (rowId: string) => {
        if (isReadOnly || !activeSheet) return;
        mutateSheet(activeSheet.key, (rows) => rows.filter((row) => row.id !== rowId));
    };

    const handleDuplicateRow = (rowId: string) => {
        if (isReadOnly || !activeSheet) return;
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
        if (isReadOnly || !activeSheet) return;
        mutateSheet(activeSheet.key, (rows) => updateRow(rows, rowId, (row) => ({ ...row, [field]: value })));
    };

    const handleTimelineChange = (rowId: string, key: string, value: string) => {
        if (isReadOnly || !activeSheet) return;
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
        if (isReadOnly || !activeSheet || columnIndex < 0 || editableColumns.length === 0) return;

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
        if (isReadOnly) {
            toast?.warning('Permission Required', 'Only team owners and admins can update the shared Fleet Plan.');
            return;
        }
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
        <div className="space-y-6">
            <div className="overflow-hidden rounded-3xl border-2 border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 bg-[#F7F7F7] px-6 py-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                            <button
                                onClick={onBack}
                                className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700"
                            >
                                <ArrowLeft size={16} />
                                Back to Analytics
                            </button>
                            <div>
                                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Fleet Plan Workspace</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    Digitize the shared fleet workbook, edit structured rows, and export back to Excel in the same planning format.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
                            <button
                                onClick={undo}
                                disabled={!canUndo}
                                title="Undo (Ctrl+Z)"
                                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Undo2 size={16} />
                                Undo
                            </button>
                            <button
                                onClick={redo}
                                disabled={!canRedo}
                                title="Redo (Ctrl+Y)"
                                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Redo2 size={16} />
                                Redo
                            </button>
                            <button
                                onClick={onReimport}
                                disabled={isReadOnly}
                                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <RefreshCw size={16} />
                                Replace workbook
                            </button>
                            <button
                                onClick={() => void handleExport()}
                                disabled={exporting}
                                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                Export
                            </button>
                            <button
                                onClick={() => void handleSave()}
                                disabled={saving || !isDirty || isReadOnly}
                                className="inline-flex items-center gap-2 rounded-xl bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save shared plan
                            </button>
                        </div>
                    </div>

                    {isReadOnly ? (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            Read-only access. Team members can view and export the shared Fleet Plan, but only team owners and admins can change it.
                        </div>
                    ) : null}

                    <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <MetricCard
                            icon={<FileSpreadsheet size={14} />}
                            label="Workbook"
                            value={draft.metadata.sourceFileName}
                            tone="blue"
                        />
                        <MetricCard
                            icon={<Bus size={14} />}
                            label="Fleet rows"
                            value={summary.totalRows.toLocaleString()}
                            tone="green"
                        />
                        <MetricCard
                            icon={<Users size={14} />}
                            label="Workspace"
                            value="Team Shared"
                            tone="violet"
                        />
                    </div>
                </div>

                <div className="bg-white px-6 py-5">
                    <div className="flex flex-col gap-4 xl:flex-row">
                        <aside className="shrink-0 xl:w-72">
                            <div className="space-y-4 rounded-3xl border-2 border-gray-200 bg-gray-50 p-4">
                                <div>
                                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-gray-400">Sheets</div>
                                    <div className="space-y-2">
                                        {draft.sheets.map((sheet) => {
                                            const isActive = sheet.key === activeSheet.key;
                                            return (
                                                <button
                                                    key={sheet.key}
                                                    onClick={() => setActiveSheetKey(sheet.key)}
                                                    className={`w-full rounded-2xl border-2 px-4 py-3 text-left transition-all ${
                                                        isActive
                                                            ? 'border-brand-blue bg-white shadow-sm'
                                                            : 'border-gray-200 bg-white hover:border-gray-300'
                                                    }`}
                                                >
                                                    <div className="font-bold text-gray-900">{sheet.name}</div>
                                                    <div className="mt-1 text-sm text-gray-500">
                                                        {sheet.rows.length} rows
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Spreadsheet mode</div>
                                    <ul className="space-y-1 text-sm text-cyan-950">
                                        <li>• Tab moves across and wraps to the next row</li>
                                        <li>• Enter moves down the same column</li>
                                        <li>• Paste copied Excel grids directly into the table</li>
                                        <li>• Toolbar undo/redo keeps sheet edits recoverable</li>
                                    </ul>
                                </div>

                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">V1 rules</div>
                                    <ul className="space-y-1 text-sm text-amber-900">
                                        <li>• Add, duplicate, remove, and edit fleet rows</li>
                                        <li>• Summary/footer totals are regenerated on export</li>
                                        <li>• Sheet structure stays template-based</li>
                                    </ul>
                                </div>
                            </div>
                        </aside>

                        <section className="min-w-0 flex-1 space-y-4">
                            <div className="rounded-3xl border-2 border-gray-200 bg-white shadow-sm">
                                <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-gray-400">Editing sheet</div>
                                        <h3 className="text-xl font-extrabold text-gray-900">{activeSheet.name}</h3>
                                        <p className="mt-1 text-sm text-gray-500">
                                            Edit planner-owned row data. Footer totals and workbook formatting are rebuilt on export.
                                        </p>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
                                            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-violet-700">Speed tools</div>
                                            <div className="mt-1">Duplicate rows inline, paste blocks from Excel, and recover previous steps with undo/redo.</div>
                                        </div>
                                        <div className="flex items-center justify-end gap-1 rounded-2xl border border-gray-200 bg-gray-50 p-1">
                                            <button
                                                onClick={() => handleAddRow()}
                                                disabled={isReadOnly}
                                                className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                <Plus size={16} />
                                                Add row
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="overflow-auto">
                                    <table className="min-w-full border-separate border-spacing-0">
                                        <thead>
                                            <tr className="bg-gray-50">
                                                {activeConfig.baseColumns.map((column) => (
                                                    <th
                                                        key={column.key}
                                                        className="sticky top-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.16em] text-gray-500"
                                                    >
                                                        {column.label}
                                                    </th>
                                                ))}
                                                {activeConfig.timelineColumns.map((column) => (
                                                    <th
                                                        key={column.key}
                                                        className="sticky top-0 z-10 min-w-[110px] border-b border-r border-gray-200 bg-gray-50 px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.16em] text-gray-500"
                                                    >
                                                        {column.label}
                                                    </th>
                                                ))}
                                                <th className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-3 text-right text-xs font-bold uppercase tracking-[0.16em] text-gray-500">
                                                    Row
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeSheet.rows.map((row, rowIndex) => (
                                                <tr key={row.id} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
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
                                                                    readOnly={isReadOnly}
                                                                    onChange={(event) => handleFieldChange(row.id, column.key, event.target.value)}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Tab') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'horizontal');
                                                                        } else if (event.key === 'Enter') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'vertical');
                                                                        }
                                                                    }}
                                                                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                                                                    className={`w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 ${
                                                                        isReadOnly
                                                                            ? 'bg-gray-50'
                                                                            : 'bg-white focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100'
                                                                    }`}
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
                                                                    readOnly={isReadOnly}
                                                                    onChange={(event) => handleTimelineChange(row.id, column.key, event.target.value)}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Tab') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'horizontal');
                                                                        } else if (event.key === 'Enter') {
                                                                            handleKeyboardNavigation(event, rowIndex, columnIndex, 'vertical');
                                                                        }
                                                                    }}
                                                                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                                                                    className={`w-full rounded-xl border border-gray-200 px-3 py-2 text-center text-sm text-gray-800 ${
                                                                        isReadOnly
                                                                            ? 'bg-gray-50'
                                                                            : 'bg-white focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100'
                                                                    }`}
                                                                />
                                                            </td>
                                                        );
                                                    })}

                                                    <td className="border-b border-gray-200 px-2 py-2 text-right align-top">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => handleDuplicateRow(row.id)}
                                                                aria-label={`Duplicate row ${rowIndex + 1}`}
                                                                disabled={isReadOnly}
                                                                className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                                <Copy size={14} />
                                                                Duplicate
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveRow(row.id)}
                                                                aria-label={`Remove row ${rowIndex + 1}`}
                                                                disabled={isReadOnly}
                                                                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                                <Trash2 size={14} />
                                                                Remove
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}

                                            {activeSheet.rows.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={activeConfig.baseColumns.length + activeConfig.timelineColumns.length + 1}
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
            </div>
        </div>
    );
};
