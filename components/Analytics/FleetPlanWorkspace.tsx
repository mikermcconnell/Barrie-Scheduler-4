import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    ChevronDown,
    CheckCircle2,
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
    Wand2,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { exportFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanExport';
import { cloneFleetPlanWorkbook, createEmptyFleetPlanRow, fleetRowHasContent, replaceFleetPlanSheet } from '../../utils/fleet-plan/fleetPlanModel';
import { saveFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanService';
import { validateFleetPlanWorkbook } from '../../utils/fleet-plan/fleetPlanValidation';
import { FleetPlanIssueResolverModal } from './FleetPlanIssueResolverModal';
import { FLEET_PLAN_SHEET_CONFIGS, FLEET_PLAN_SHEET_CONFIG_BY_KEY } from '../../utils/fleet-plan/fleetPlanConfig';
import {
    delayFleetPlanRetirement,
    compareFleetPlanSortValues,
    getFleetPlanLifecycle,
    getFleetPlanServiceLifeLabel,
    getNextFleetPlanSortState,
    getNextFleetPlanCellPosition,
    isFleetPlanRowCountedInFleetTotal,
    moveFleetPlanLifecycleBoundary,
    moveFleetPlanLifecycleWindow,
    removeFleetPlanRow,
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

const BUS_TYPE_STYLES: Record<FleetPlanSheetKey, {
    row: string;
    badge: string;
    detail: string;
    timeline: string;
}> = {
    'diesel-12m': {
        row: 'bg-red-50/30',
        badge: 'bg-red-100 text-red-700',
        detail: 'bg-red-50 text-red-700',
        timeline: 'border-red-100 bg-red-50/30',
    },
    'small-buses': {
        row: 'bg-blue-50/30',
        badge: 'bg-blue-100 text-blue-700',
        detail: 'bg-blue-50 text-blue-700',
        timeline: 'border-blue-100 bg-blue-50/30',
    },
    'electric-12m': {
        row: 'bg-emerald-50/35',
        badge: 'bg-emerald-100 text-emerald-700',
        detail: 'bg-emerald-50 text-emerald-700',
        timeline: 'border-emerald-100 bg-emerald-50/30',
    },
};

type CombinedFleetRow = { sheetKey: FleetPlanSheetKey; row: FleetPlanRow };
type BaseFleetField = 'busType' | 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag' | 'onOrder';
type FleetStatusFilter = 'all' | 'in-service' | 'retiring-this-year' | 'purchasing-this-year' | 'growth' | 'on-order' | 'future' | 'overdue' | 'missing-info';
type FleetBusTypeFilter = 'all' | FleetPlanSheetKey;
type FleetYearActionCounts = { retiring: number; purchasing: number; growth: number; replacement: number };
type LifecycleDragMode = 'start' | 'retire' | 'window';
type FleetTimelineViewMode = 'rows' | 'table';

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

const FLEET_TIMELINE_START_YEAR = 2026;
const COMMON_TIMELINE_YEAR_KEYS = new Set(
    FLEET_PLAN_SHEET_CONFIGS
        .map((config) => new Set(config.timelineColumns.map((column) => column.key)))
        .reduce<string[]>((commonYears, sheetYears, index) => (
            index === 0 ? Array.from(sheetYears) : commonYears.filter((year) => sheetYears.has(year))
        ), []),
);
const DEFAULT_TIMELINE_COLUMNS = ALL_TIMELINE_COLUMNS.filter((column) => (
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

const STATUS_FILTERS: Array<{ key: FleetStatusFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'in-service', label: 'In Service' },
    { key: 'retiring-this-year', label: 'Retiring This Year' },
    { key: 'purchasing-this-year', label: 'Purchasing This Year' },
    { key: 'growth', label: 'Growth' },
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

const DEFAULT_FLEET_PLAN_SORT_STATE: FleetPlanSortState = { kind: 'base', key: 'busType', direction: 'asc' };
const FLEET_TYPE_SORT_ORDER: FleetPlanSheetKey[] = ['diesel-12m', 'electric-12m', 'small-buses'];

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

function isFleetPlanGrowthRow(row: FleetPlanRow): boolean {
    return Object.values(row.timeline).some((value) => value.trim().toUpperCase() === 'GROWTH');
}

function matchesFleetStatusFilter(
    entry: CombinedFleetRow,
    lifecycle: FleetPlanLifecycle,
    filter: FleetStatusFilter,
    currentYear: number,
    focusedYear: string | null = null,
): boolean {
    if (filter === 'all') return true;
    if (filter === 'in-service') return lifecycle.isInService;
    if (filter === 'retiring-this-year') return focusedYear ? lifecycle.retireYear === focusedYear : Boolean(lifecycle.retireYear);
    if (filter === 'purchasing-this-year') return focusedYear ? lifecycle.purchaseYears.includes(focusedYear) : lifecycle.purchaseYears.length > 0;
    if (filter === 'growth') return isFleetPlanGrowthRow(entry.row);
    if (filter === 'on-order') return Boolean(entry.row.onOrder?.trim());
    if (filter === 'future') return lifecycle.isFuture || lifecycle.purchaseYears.some((year) => Number(year) > currentYear);
    if (filter === 'overdue') return lifecycle.isOverdueRetirement;
    return lifecycle.hasMissingInfo;
}

function matchesFleetYearFocus(
    entry: CombinedFleetRow,
    lifecycle: FleetPlanLifecycle,
    focusedYear: string | null,
): boolean {
    if (!focusedYear) return true;
    if (isFleetPlanRowCountedInFleetTotal(entry.row, entry.sheetKey, focusedYear)) return true;
    if (lifecycle.retireYear === focusedYear) return true;
    if (lifecycle.purchaseYears.includes(focusedYear)) return true;
    return getTimelineStatusValue(entry.row, focusedYear) === 'GROWTH';
}

function getStatusFilterLabel(filter: FleetStatusFilter, focusedYear: string | null): string {
    if (filter === 'retiring-this-year') return focusedYear ? `Retiring ${focusedYear}` : 'Retiring';
    if (filter === 'purchasing-this-year') return focusedYear ? `Purchasing ${focusedYear}` : 'Purchasing';
    return STATUS_FILTERS.find((entry) => entry.key === filter)?.label || filter;
}

function getPurchaseBadgeLabel(row: FleetPlanRow, lifecycle: FleetPlanLifecycle, focusedYear: string | null): string | null {
    if (focusedYear) {
        const focusedStatus = getTimelineStatusValue(row, focusedYear);
        if (focusedStatus === 'GROWTH') return `Growth purchase ${focusedYear}`;
        if (lifecycle.purchaseYears.includes(focusedYear)) return `Bus purchase ${focusedYear}`;
        return null;
    }
    if (lifecycle.purchaseYears.length > 0) {
        return `Purchase ${lifecycle.purchaseYears.join(', ')}`;
    }
    return null;
}

function getPurchaseYearSummary(lifecycle: FleetPlanLifecycle): string {
    return lifecycle.purchaseYears.length > 0 ? lifecycle.purchaseYears.join(', ') : '—';
}

function getRetirementYearSummary(lifecycle: FleetPlanLifecycle): string {
    return lifecycle.retireYear || '—';
}

function getFleetPlanServiceLifeCompactLabel(rowYear: string | undefined, currentYear: number): string {
    const label = getFleetPlanServiceLifeLabel(rowYear, currentYear);
    return label.replace(' years', 'y').replace(' year', 'y');
}

function createEmptyYearActionCounts(): FleetYearActionCounts {
    return { retiring: 0, purchasing: 0, growth: 0, replacement: 0 };
}

function summarizeFleetYearActions(
    rows: CombinedFleetRow[],
    year: string,
    currentYear: number,
): { total: FleetYearActionCounts; byType: Record<FleetPlanSheetKey, FleetYearActionCounts> } {
    const byType = FLEET_PLAN_SHEET_CONFIGS.reduce((summary, config) => ({
        ...summary,
        [config.key]: createEmptyYearActionCounts(),
    }), {} as Record<FleetPlanSheetKey, FleetYearActionCounts>);
    const total = createEmptyYearActionCounts();

    rows.forEach((entry) => {
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        const status = getTimelineStatusValue(entry.row, year);
        const isGrowth = status === 'GROWTH';
        const isReplacement = status.startsWith('PURCHASE');
        const isPurchasing = isGrowth || isReplacement || lifecycle.purchaseYears.includes(year);
        const isRetiring = lifecycle.retireYear === year;
        const bucket = byType[entry.sheetKey];

        if (isRetiring) {
            bucket.retiring += 1;
            total.retiring += 1;
        }
        if (isPurchasing) {
            bucket.purchasing += 1;
            total.purchasing += 1;
        }
        if (isGrowth) {
            bucket.growth += 1;
            total.growth += 1;
        }
        if (isReplacement) {
            bucket.replacement += 1;
            total.replacement += 1;
        }
    });

    return { total, byType };
}

function countMatchingRows(
    rows: CombinedFleetRow[],
    statusFilter: FleetStatusFilter,
    busTypeFilter: FleetBusTypeFilter,
    currentYear: number,
    focusedYear: string | null = null,
): number {
    return rows.filter((entry) => {
        if (busTypeFilter !== 'all' && entry.sheetKey !== busTypeFilter) return false;
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return matchesFleetStatusFilter(entry, lifecycle, statusFilter, currentYear, focusedYear)
            && matchesFleetYearFocus(entry, lifecycle, focusedYear);
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

function getFleetPlanEntrySortValue(entry: CombinedFleetRow, sort: FleetPlanSortState): string {
    if (sort.kind === 'timeline') {
        return entry.row.timeline[sort.key] || '';
    }
    if (sort.key === 'busType') {
        const typeIndex = FLEET_TYPE_SORT_ORDER.indexOf(entry.sheetKey);
        return typeIndex >= 0 ? String(typeIndex) : BUS_TYPE_LABELS[entry.sheetKey];
    }
    return getBaseFieldValue(entry.row, sort.key as Exclude<BaseFleetField, 'busType'>);
}

function getFleetRowOrderKey(entry: CombinedFleetRow): string {
    return entry.row.id;
}

function getFleetYearActionState(row: FleetPlanRow, lifecycle: FleetPlanLifecycle, year: string): { retiring: boolean; purchasing: boolean } {
    const status = getTimelineStatusValue(row, year);
    return {
        retiring: lifecycle.retireYear === year,
        purchasing: lifecycle.purchaseYears.includes(year) || status === 'GROWTH' || status.startsWith('PURCHASE'),
    };
}

function prioritizeCurrentYearActionRows(entries: CombinedFleetRow[], currentYear: number): CombinedFleetRow[] {
    const year = String(currentYear);
    return entries
        .map((entry, originalIndex) => {
            const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
            const action = getFleetYearActionState(entry.row, lifecycle, year);
            return {
                entry,
                originalIndex,
                priority: action.retiring || action.purchasing ? 0 : 1,
            };
        })
        .sort((left, right) => {
            if (left.priority !== right.priority) return left.priority - right.priority;
            return left.originalIndex - right.originalIndex;
        })
        .map(({ entry }) => entry);
}

function getCurrentYearHighlightClass(action: { retiring: boolean; purchasing: boolean }, isGrowthRow: boolean, sheetKey: FleetPlanSheetKey): string {
    if (action.retiring && action.purchasing) return 'border-l-amber-500 bg-amber-50/45 ring-1 ring-amber-200/80';
    if (action.retiring) return 'border-l-red-500 bg-red-50/50 ring-1 ring-red-200/80';
    if (action.purchasing) return 'border-l-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-200/80';
    return `${BUS_TYPE_STYLES[sheetKey].row} ${isGrowthRow ? 'border-l-amber-300' : 'border-l-transparent'}`;
}

function getCurrentYearStatusChip(action: { retiring: boolean; purchasing: boolean }, year: string): { label: string; className: string } | null {
    if (action.retiring && action.purchasing) {
        return {
            label: `Retire + buy ${year}`,
            className: 'bg-amber-100 text-amber-800',
        };
    }
    if (action.retiring) {
        return {
            label: `Retiring ${year}`,
            className: 'bg-red-100 text-red-700',
        };
    }
    if (action.purchasing) {
        return {
            label: `Purchasing ${year}`,
            className: 'bg-emerald-100 text-emerald-700',
        };
    }
    return null;
}

function orderCombinedFleetRows(entries: CombinedFleetRow[], rowOrder: string[]): CombinedFleetRow[] {
    const orderIndex = new Map(rowOrder.map((key, index) => [key, index]));
    return entries
        .map((entry, originalIndex) => ({ entry, originalIndex }))
        .sort((left, right) => {
            const leftOrder = orderIndex.get(getFleetRowOrderKey(left.entry));
            const rightOrder = orderIndex.get(getFleetRowOrderKey(right.entry));
            if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
            if (leftOrder !== undefined) return -1;
            if (rightOrder !== undefined) return 1;
            return left.originalIndex - right.originalIndex;
        })
        .map(({ entry }) => entry);
}

function sortCombinedFleetRows(entries: CombinedFleetRow[], sortState: FleetPlanSortState | null, currentYear: number): CombinedFleetRow[] {
    if (!sortState) return entries;

    return entries
        .map((entry, originalIndex) => ({ entry, originalIndex }))
        .sort((left, right) => {
            const primaryComparison = compareFleetPlanSortValues(
                getFleetPlanEntrySortValue(left.entry, sortState),
                getFleetPlanEntrySortValue(right.entry, sortState),
            );
            if (primaryComparison !== 0) {
                return sortState.direction === 'asc' ? primaryComparison : -primaryComparison;
            }

            if (sortState.kind === 'base' && sortState.key === 'year') {
                const typeComparison = FLEET_TYPE_SORT_ORDER.indexOf(left.entry.sheetKey) - FLEET_TYPE_SORT_ORDER.indexOf(right.entry.sheetKey);
                if (typeComparison !== 0) return typeComparison;

                const leftRetirementYear = getFleetPlanLifecycle(
                    left.entry.row,
                    FLEET_PLAN_SHEET_CONFIG_BY_KEY[left.entry.sheetKey].timelineColumns,
                    currentYear,
                ).retireYear || '';
                const rightRetirementYear = getFleetPlanLifecycle(
                    right.entry.row,
                    FLEET_PLAN_SHEET_CONFIG_BY_KEY[right.entry.sheetKey].timelineColumns,
                    currentYear,
                ).retireYear || '';
                const retirementYearComparison = compareFleetPlanSortValues(leftRetirementYear, rightRetirementYear);
                if (retirementYearComparison !== 0) return retirementYearComparison;
            }

            const nameComparison = getFleetRowDisplayName(left.entry.row).localeCompare(
                getFleetRowDisplayName(right.entry.row),
                undefined,
                { numeric: true, sensitivity: 'base' },
            );
            if (nameComparison !== 0) return nameComparison;

            return left.originalIndex - right.originalIndex;
        })
        .map(({ entry }) => entry);
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
    const [showIssueResolver, setShowIssueResolver] = useState(false);
    const [sortState, setSortState] = useState<FleetPlanSortState | null>(DEFAULT_FLEET_PLAN_SORT_STATE);
    const [pausedRowOrder, setPausedRowOrder] = useState<string[] | null>(null);
    const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');
    const [busTypeFilter, setBusTypeFilter] = useState<FleetBusTypeFilter>('all');
    const [newRowSheetKey, setNewRowSheetKey] = useState<FleetPlanSheetKey>('diesel-12m');
    const [focusedYear, setFocusedYear] = useState<string | null>(null);
    const [showHistoricalYears, setShowHistoricalYears] = useState(false);
    const [timelineViewMode, setTimelineViewMode] = useState<FleetTimelineViewMode>('rows');
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
    const visibleTimelineColumns = useMemo(() => (
        showHistoricalYears
            ? ALL_TIMELINE_COLUMNS.filter((column) => COMMON_TIMELINE_YEAR_KEYS.has(column.key))
            : DEFAULT_TIMELINE_COLUMNS
    ), [showHistoricalYears]);
    const historicalTimelineColumnCount = ALL_TIMELINE_COLUMNS.filter((column) => (
        Number(column.key) < FLEET_TIMELINE_START_YEAR && COMMON_TIMELINE_YEAR_KEYS.has(column.key)
    )).length;
    const editableColumns = useMemo<FleetPlanGridColumn[]>(() => [
        ...COMBINED_BASE_COLUMNS.map((column) => ({ kind: 'base' as const, key: column.key, label: column.label })),
        ...visibleTimelineColumns.map((column) => ({ kind: 'timeline' as const, key: column.key, label: column.label })),
    ], [visibleTimelineColumns]);
    const combinedRows = useMemo<CombinedFleetRow[]>(() => draft.sheets.flatMap((sheet) => sheet.rows.map((row) => ({ sheetKey: sheet.key, row }))), [draft.sheets]);
    const sortedRows = useMemo(() => {
        const orderedRows = pausedRowOrder
            ? orderCombinedFleetRows(combinedRows, pausedRowOrder)
            : sortCombinedFleetRows(combinedRows, sortState, currentYear);
        return prioritizeCurrentYearActionRows(orderedRows, currentYear);
    }, [combinedRows, currentYear, pausedRowOrder, sortState]);
    const isSortPaused = pausedRowOrder !== null;
    const baseFilteredRows = useMemo(() => sortedRows.filter((entry) => {
        if (busTypeFilter !== 'all' && entry.sheetKey !== busTypeFilter) return false;
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return matchesFleetStatusFilter(entry, lifecycle, statusFilter, currentYear, focusedYear);
    }), [busTypeFilter, currentYear, focusedYear, sortedRows, statusFilter]);
    const filteredRows = useMemo(() => baseFilteredRows.filter((entry) => {
        const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
        return matchesFleetYearFocus(entry, lifecycle, focusedYear);
    }), [baseFilteredRows, currentYear, focusedYear]);
    const handleYearFocusClick = useCallback((year: string) => {
        setFocusedYear((current) => (current === year ? null : year));
    }, []);
    const fleetTotalsByYear = useMemo(() => Object.fromEntries(
        visibleTimelineColumns.map((column) => [
            column.key,
            baseFilteredRows.filter(({ sheetKey, row }) => isFleetPlanRowCountedInFleetTotal(row, sheetKey, column.key)).length,
        ]),
    ) as Record<string, number>, [baseFilteredRows, visibleTimelineColumns]);
    const focusedYearSummary = useMemo(() => (
        focusedYear ? summarizeFleetYearActions(combinedRows, focusedYear, currentYear) : null
    ), [combinedRows, currentYear, focusedYear]);
    const snapshotYears = useMemo(() => [currentYearLabel, nextYearLabel].map((yearLabel) => {
        const retirements = combinedRows.filter((entry) => {
            const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
            return lifecycle.retireYear === yearLabel;
        });
        const purchases = combinedRows.filter((entry) => {
            const lifecycle = getFleetPlanLifecycle(entry.row, FLEET_PLAN_SHEET_CONFIG_BY_KEY[entry.sheetKey].timelineColumns, currentYear);
            return lifecycle.purchaseYears.includes(yearLabel);
        });
        const growth = combinedRows.filter((entry) => getTimelineStatusValue(entry.row, yearLabel) === 'GROWTH');
        return {
            yearLabel,
            retirements,
            purchases,
            growth,
            retirementsByType: groupFleetRowsByType(retirements),
            purchasesByType: groupFleetRowsByType(purchases),
        };
    }), [combinedRows, currentYear, currentYearLabel, nextYearLabel]);
    const currentYearSnapshot = snapshotYears.find((snapshot) => snapshot.yearLabel === currentYearLabel) ?? snapshotYears[0];
    const growthRows = useMemo(() => combinedRows.filter((entry) => isFleetPlanGrowthRow(entry.row)), [combinedRows]);
    const isDirty = JSON.stringify(draft) !== JSON.stringify(data);
    useUnsavedChangesWarning(isDirty, 'You have unsaved Fleet Plan changes. Leave anyway?');
    const fleetValidation = useMemo(() => validateFleetPlanWorkbook(draft, currentYear), [currentYear, draft]);
    const validationPreviewIssues = useMemo(() => [
        ...fleetValidation.errors.slice(0, 5),
        ...fleetValidation.warnings.slice(0, Math.max(0, 5 - fleetValidation.errors.slice(0, 5).length)),
    ], [fleetValidation.errors, fleetValidation.warnings]);
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
        if (!showHistoricalYears && focusedYear && Number(focusedYear) < FLEET_TIMELINE_START_YEAR) {
            setFocusedYear(null);
        }
    }, [focusedYear, showHistoricalYears]);

    useEffect(() => {
        const nextDraft = cloneFleetPlanWorkbook(data);
        if (JSON.stringify(draftRef.current) === JSON.stringify(nextDraft)) {
            return;
        }
        draftRef.current = nextDraft;
        resetDraftHistory(nextDraft);
        setPendingFocus(null);
        setPausedRowOrder(null);
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

    const pauseSortForEdit = useCallback(() => {
        setPausedRowOrder((current) => current ?? sortedRows.map(getFleetRowOrderKey));
    }, [sortedRows]);

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
        const nextRowIndex = combinedRows.length;
        pauseSortForEdit();
        setStatusFilter('all');
        setFocusedYear(null);
        setBusTypeFilter(newRowSheetKey);
        mutateSheet(newRowSheetKey, (rows) => [...rows, createEmptyFleetPlanRow(newRowSheetKey)]);
        setPendingFocus({ rowIndex: nextRowIndex, columnIndex: focusColumnIndex });
    }, [combinedRows.length, mutateSheet, newRowSheetKey, pauseSortForEdit]);

    const handleDeleteRow = useCallback((sheetKey: FleetPlanSheetKey, row: FleetPlanRow) => {
        const rowLabel = getFleetRowDisplayName(row);
        if (fleetRowHasContent(row) && !confirm(`Delete ${rowLabel} from the Fleet Plan? This can be undone before saving.`)) {
            return;
        }

        pauseSortForEdit();
        setRetirementEditor(null);
        mutateSheet(sheetKey, (rows) => removeFleetPlanRow(rows, row.id));
        setPausedRowOrder((current) => current?.filter((rowId) => rowId !== row.id) ?? current);
        toast?.success('Fleet row deleted');
    }, [mutateSheet, pauseSortForEdit, toast]);

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
        pauseSortForEdit();
        if (field === 'busType') {
            moveRowToSheet(sheetKey, rowId, value as FleetPlanSheetKey);
            return;
        }
        mutateSheet(sheetKey, (rows) => updateRow(rows, rowId, (row) => ({ ...row, [field]: value })));
    };

    const handleTimelineChange = (sheetKey: FleetPlanSheetKey, rowId: string, key: string, value: string) => {
        pauseSortForEdit();
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
        pauseSortForEdit();
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
        pauseSortForEdit();
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

    const handleInServiceYearInput = (
        sheetKey: FleetPlanSheetKey,
        rowId: string,
        toYear: string,
    ) => {
        const year = toYear.trim();
        if (!/^\d{4}$/.test(year)) {
            toast?.error('Enter a valid 4-digit in-service year');
            return;
        }
        handleLifecycleBoundaryMove(sheetKey, rowId, 'start', year);
    };

    const handleLifecycleWindowMove = (
        sheetKey: FleetPlanSheetKey,
        rowId: string,
        toStartYear: string,
    ) => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
        let changed = false;
        pauseSortForEdit();
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

        const firstVisibleYear = Number(yearKeys[0] || FLEET_TIMELINE_START_YEAR);
        const lastVisibleYear = Number(yearKeys[yearKeys.length - 1] || FLEET_TIMELINE_START_YEAR);
        const rawStartIndex = getYearIndex(yearKeys, lifecycle.startYear);
        const startIndex = rawStartIndex >= 0
            ? rawStartIndex
            : lifecycle.startYear && Number(lifecycle.startYear) > lastVisibleYear
                ? yearKeys.length - 1
                : 0;
        const rawRetireIndex = getYearIndex(yearKeys, lifecycle.retireYear);
        const retireIndex = lifecycle.retireYear && rawRetireIndex >= 0
            ? Math.max(startIndex, rawRetireIndex)
            : lifecycle.retireYear && Number(lifecycle.retireYear) < firstVisibleYear
                ? startIndex
                : yearKeys.length - 1;
        if (startIndex < 0 || retireIndex < 0) return;

        const track = event.currentTarget.closest<HTMLElement>('[data-lifecycle-track]');
        const trackRect = track?.getBoundingClientRect();
        if (!trackRect) return;

        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
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

    const applyLifecycleDrag = (clientX: number, dragState: LifecycleDragState) => {
        const targetIndex = getLifecyclePointerIndex(
            clientX,
            dragState.yearKeys,
            dragState.trackLeft,
            dragState.trackWidth,
        );
        if (dragState.mode === 'start') {
            const nextIndex = clampNumber(targetIndex, 0, dragState.retireIndex);
            const year = dragState.yearKeys[nextIndex];
            if (year) handleLifecycleBoundaryMove(dragState.sheetKey, dragState.rowId, 'start', year);
            return;
        }

        if (dragState.mode === 'retire') {
            const nextIndex = clampNumber(targetIndex, dragState.startIndex, dragState.yearKeys.length - 1);
            const year = dragState.yearKeys[nextIndex];
            if (year) handleLifecycleBoundaryMove(dragState.sheetKey, dragState.rowId, 'retire', year);
            return;
        }

        const lifecycleWidth = dragState.retireIndex - dragState.startIndex;
        const delta = targetIndex - dragState.pointerStartIndex;
        const nextStartIndex = clampNumber(
            dragState.startIndex + delta,
            0,
            Math.max(0, dragState.yearKeys.length - 1 - lifecycleWidth),
        );
        const year = dragState.yearKeys[nextStartIndex];
        if (year) handleLifecycleWindowMove(dragState.sheetKey, dragState.rowId, year);
    };

    const handleLifecyclePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!lifecycleDrag) return;
        event.preventDefault();
        applyLifecycleDrag(event.clientX, lifecycleDrag);
    };

    const handleLifecyclePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setLifecycleDrag(null);
    };

    useEffect(() => {
        if (!lifecycleDrag) return undefined;

        const handleWindowPointerMove = (event: PointerEvent) => {
            event.preventDefault();
            applyLifecycleDrag(event.clientX, lifecycleDrag);
        };
        const handleWindowPointerEnd = () => {
            setLifecycleDrag(null);
        };

        window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
        window.addEventListener('pointerup', handleWindowPointerEnd);
        window.addEventListener('pointercancel', handleWindowPointerEnd);

        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerEnd);
            window.removeEventListener('pointercancel', handleWindowPointerEnd);
        };
    }, [lifecycleDrag]);

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
        pauseSortForEdit();
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
        setPausedRowOrder(null);
        setSortState((current) => getNextFleetPlanSortState(current, column));
        setRetirementEditor(null);
    };

    const handleApplyIssueResolution = (nextWorkbook: FleetPlanWorkbook) => {
        pauseSortForEdit();
        draftRef.current = nextWorkbook;
        setDraft(nextWorkbook);
        toast?.success('Fleet Plan issue updated');
    };

    const handleSave = async () => {
        const validation = validateFleetPlanWorkbook(draftRef.current, currentYear);
        if (!validation.canSave) {
            toast?.error(
                'Fix Fleet Plan validation errors before saving',
                `${validation.errors.length} blocking issue${validation.errors.length === 1 ? '' : 's'} found.`,
            );
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
            const savedWorkbook = await saveFleetPlanWorkbook(teamId, nextWorkbook);
            draftRef.current = savedWorkbook;
            setDraft(savedWorkbook);
            setPausedRowOrder(null);
            onSaved(savedWorkbook);
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

    const renderLifecycleTrack = (
        sheetKey: FleetPlanSheetKey,
        row: FleetPlanRow,
        lifecycle: FleetPlanLifecycle,
        options: { compact?: boolean } = {},
    ) => {
        const yearKeys = visibleTimelineColumns.map((column) => column.key);
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
            <div className={options.compact ? 'min-w-[460px]' : 'min-w-0'}>
                <div className={`rounded-xl border px-3 py-2 ${BUS_TYPE_STYLES[sheetKey].timeline}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold text-gray-600">
                        <label className="flex items-center gap-1">
                            <span>In service:</span>
                            <input
                                key={`${row.id}-${lifecycle.startYear || 'missing'}-table-in-service`}
                                defaultValue={lifecycle.startYear || ''}
                                inputMode="numeric"
                                pattern="\d{4}"
                                maxLength={4}
                                placeholder="Year"
                                aria-label={`In-service year for bus ${row.unitNumber || 'row'}`}
                                onBlur={(event) => {
                                    if (event.currentTarget.value.trim() !== (lifecycle.startYear || '')) {
                                        handleInServiceYearInput(sheetKey, row.id, event.currentTarget.value);
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter') return;
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                }}
                                className="h-7 w-16 rounded-md border border-blue-200 bg-white px-2 text-xs font-extrabold text-brand-blue shadow-inner shadow-blue-50 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </label>
                        <span className="shrink-0">
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
                        <div className="absolute inset-x-0 top-4 h-1.5 -translate-y-1/2 rounded-full bg-gray-200" />
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
                            className={`absolute top-4 z-10 h-2.5 -translate-y-1/2 cursor-grab rounded-full shadow-sm outline-none ring-blue-200 transition hover:bg-blue-600 focus:ring-4 active:cursor-grabbing ${
                                hasRetirementYear ? 'bg-blue-500/90' : 'border border-dashed border-blue-500 bg-blue-300/60'
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
                            className="absolute top-4 z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white bg-blue-600 shadow outline-none ring-blue-200 transition hover:scale-105 focus:ring-4"
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
                            className={`absolute top-4 z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white shadow outline-none ring-red-200 transition hover:scale-105 focus:ring-4 ${
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
                {!hasRetirementYear ? (
                    <button
                        type="button"
                        onClick={() => {
                            const fallbackYear = yearKeys[Math.max(startIndex, yearKeys.length - 1)];
                            if (fallbackYear) handleLifecycleBoundaryMove(sheetKey, row.id, 'retire', fallbackYear);
                        }}
                        className="mt-1.5 inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-extrabold text-amber-700 transition hover:bg-amber-50"
                    >
                        Set retirement year
                    </button>
                ) : null}
            </div>
        );
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
                                disabled={saving || !isDirty || !fleetValidation.canSave}
                                title={!fleetValidation.canSave ? 'Fix validation errors before saving' : undefined}
                                className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-600 disabled:opacity-50"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save shared plan
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <section className={`rounded-2xl border p-4 shadow-sm ${
                fleetValidation.errors.length > 0
                    ? 'border-red-200 bg-red-50'
                    : fleetValidation.warnings.length > 0
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-emerald-200 bg-emerald-50'
            }`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-full p-2 ${
                            fleetValidation.errors.length > 0
                                ? 'bg-red-100 text-red-700'
                                : fleetValidation.warnings.length > 0
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                        }`}>
                            {fleetValidation.errors.length > 0 || fleetValidation.warnings.length > 0
                                ? <AlertTriangle size={18} />
                                : <CheckCircle2 size={18} />}
                        </div>
                        <div>
                            <h3 className={`text-sm font-extrabold ${
                                fleetValidation.errors.length > 0
                                    ? 'text-red-900'
                                    : fleetValidation.warnings.length > 0
                                        ? 'text-amber-900'
                                        : 'text-emerald-900'
                            }`}>
                                {fleetValidation.errors.length > 0
                                    ? 'Fleet Plan validation needs attention'
                                    : fleetValidation.warnings.length > 0
                                        ? 'Fleet Plan validation has warnings'
                                        : 'Fleet Plan validation passed'}
                            </h3>
                            <p className={`mt-1 text-sm ${
                                fleetValidation.errors.length > 0
                                    ? 'text-red-800'
                                    : fleetValidation.warnings.length > 0
                                        ? 'text-amber-800'
                                        : 'text-emerald-800'
                            }`}>
                                {fleetValidation.errors.length} blocking issue{fleetValidation.errors.length === 1 ? '' : 's'} · {fleetValidation.warnings.length} warning{fleetValidation.warnings.length === 1 ? '' : 's'}.
                                {fleetValidation.errors.length > 0 ? ' Saving is disabled until blocking issues are fixed.' : ''}
                            </p>
                            {validationPreviewIssues.length > 0 ? (
                                <ul className="mt-3 space-y-1 text-sm">
                                    {validationPreviewIssues.map((issue, index) => (
                                        <li
                                            key={`${issue.code}-${issue.rowId || issue.unitNumber || index}`}
                                            className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}
                                        >
                                            <span className="font-bold">{issue.severity === 'error' ? 'Error' : 'Warning'}:</span> {issue.message}
                                        </li>
                                    ))}
                                    {fleetValidation.issues.length > validationPreviewIssues.length ? (
                                        <li className="text-sm font-semibold text-gray-600">
                                            +{fleetValidation.issues.length - validationPreviewIssues.length} more issue{fleetValidation.issues.length - validationPreviewIssues.length === 1 ? '' : 's'}
                                        </li>
                                    ) : null}
                                </ul>
                            ) : null}
                        </div>
                    </div>
                    {fleetValidation.errors.length > 0 || fleetValidation.warnings.length > 0 ? (
                        <button
                            type="button"
                            onClick={() => setShowIssueResolver(true)}
                            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-extrabold text-white shadow-sm ${
                                fleetValidation.errors.length > 0
                                    ? 'bg-red-600 hover:bg-red-700'
                                    : 'bg-amber-600 hover:bg-amber-700'
                            }`}
                        >
                            <Wand2 size={16} />
                            Resolve issues and warnings
                        </button>
                    ) : null}
                </div>
            </section>

            {currentYearSnapshot ? (
                <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <h3 className="text-lg font-extrabold text-gray-950">{currentYearLabel} action queue</h3>
                            <p className="mt-1 text-sm text-gray-500">
                                Rows retiring or purchasing this year are highlighted and pinned to the top of the timeline.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-sm font-extrabold">
                            <span className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">
                                {currentYearSnapshot.retirements.length} retiring
                            </span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">
                                {currentYearSnapshot.purchases.length} purchasing
                            </span>
                            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">
                                {currentYearSnapshot.growth.length} growth
                            </span>
                        </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                            <div className="text-xs font-extrabold uppercase tracking-wide text-red-700">Retiring this year</div>
                            {currentYearSnapshot.retirements.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {currentYearSnapshot.retirements.slice(0, 12).map(({ sheetKey, row }) => (
                                        <span key={`${sheetKey}-${row.id}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-700 shadow-sm">
                                            {getFleetRowDisplayName(row)}
                                        </span>
                                    ))}
                                    {currentYearSnapshot.retirements.length > 12 ? (
                                        <span className="rounded-full px-3 py-1 text-xs font-bold text-red-700">
                                            +{currentYearSnapshot.retirements.length - 12} more
                                        </span>
                                    ) : null}
                                </div>
                            ) : (
                                <p className="mt-2 text-sm font-semibold text-red-700/70">No retirements marked for {currentYearLabel}.</p>
                            )}
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                            <div className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">Purchasing this year</div>
                            {currentYearSnapshot.purchases.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {currentYearSnapshot.purchases.slice(0, 12).map(({ sheetKey, row }) => (
                                        <span key={`${sheetKey}-${row.id}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">
                                            {getFleetRowDisplayName(row)}
                                        </span>
                                    ))}
                                    {currentYearSnapshot.purchases.length > 12 ? (
                                        <span className="rounded-full px-3 py-1 text-xs font-bold text-emerald-700">
                                            +{currentYearSnapshot.purchases.length - 12} more
                                        </span>
                                    ) : null}
                                </div>
                            ) : (
                                <p className="mt-2 text-sm font-semibold text-emerald-700/70">No purchases marked for {currentYearLabel}.</p>
                            )}
                        </div>
                    </div>
                </section>
            ) : null}

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
                    <div className="text-right">
                        <div className="text-sm font-bold text-brand-blue">
                            {snapshotYears.reduce((total, snapshot) => total + snapshot.retirements.length, 0)} retiring · {snapshotYears.reduce((total, snapshot) => total + snapshot.purchases.length, 0)} purchasing · {growthRows.length} growth
                        </div>
                        <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs font-extrabold text-gray-500">
                            {snapshotYears.map((snapshot) => (
                                <span key={snapshot.yearLabel}>
                                    {snapshot.yearLabel}: {snapshot.retirements.length} retiring · {snapshot.purchases.length} purchasing · {snapshot.growth.length} growth
                                </span>
                            ))}
                        </div>
                    </div>
                </button>
                {isSnapshotExpanded && (
                    <div className="mt-4 space-y-4">
                        {snapshotYears.map((snapshot) => (
                            <div key={snapshot.yearLabel}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="text-sm font-extrabold text-gray-800">{snapshot.yearLabel}</h4>
                                    <div className="text-xs font-extrabold text-gray-500">
                                        {snapshot.retirements.length} retiring · {snapshot.purchases.length} purchasing · {snapshot.growth.length} growth
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
                <div className="border-b border-gray-200 px-6 py-3">
                    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <h3 className="text-xl font-extrabold text-gray-950">Fleet timeline</h3>
                            <p className="mt-0.5 text-sm text-gray-500">
                                Drag the in-service and retire controls to update the plan immediately. Retirements are exported as red RETIRE cells.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                                <button
                                    type="button"
                                    onClick={() => setTimelineViewMode('rows')}
                                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-extrabold transition ${
                                        timelineViewMode === 'rows'
                                            ? 'bg-white text-gray-950 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    <Grid3X3 size={14} />
                                    Rows
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimelineViewMode('table')}
                                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-extrabold transition ${
                                        timelineViewMode === 'table'
                                            ? 'bg-white text-gray-950 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    <FileSpreadsheet size={14} />
                                    Full table
                                </button>
                            </div>
                            <label className="text-xs font-extrabold uppercase tracking-wide text-gray-500">
                                New row type
                                <select
                                    value={newRowSheetKey}
                                    onChange={(event) => setNewRowSheetKey(event.target.value as FleetPlanSheetKey)}
                                    className="ml-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-gray-700 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    {FLEET_PLAN_SHEET_CONFIGS.map((config) => (
                                        <option key={config.key} value={config.key}>
                                            {BUS_TYPE_LABELS[config.key]}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                onClick={() => setShowHistoricalYears((current) => !current)}
                                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold shadow-sm ${
                                    showHistoricalYears
                                        ? 'border-gray-300 bg-gray-900 text-white hover:bg-gray-800'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                                title={showHistoricalYears ? 'Hide past years' : `Show ${historicalTimelineColumnCount} past year${historicalTimelineColumnCount === 1 ? '' : 's'}`}
                            >
                                {showHistoricalYears ? 'Hide history' : 'View history'}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleAddRow()}
                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-brand-blue shadow-sm hover:bg-blue-50"
                            >
                                Add row
                                <Plus size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="sticky -top-px z-50 border-b border-gray-200 bg-white px-6 py-3 shadow-md">
                    <div className="pointer-events-none absolute inset-x-0 -top-24 h-24 bg-white" />
                    <div className="relative space-y-2">
                        <div className="grid gap-3 xl:grid-cols-[400px_112px_minmax(520px,1fr)] 2xl:grid-cols-[430px_124px_minmax(560px,1fr)]">
                            <div>
                                <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500">
                                Fleet total by year
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={undo}
                                        disabled={!canUndo}
                                        title="Undo last fleet edit"
                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <Undo2 size={14} />
                                        Undo
                                    </button>
                                    <button
                                        type="button"
                                        onClick={redo}
                                        disabled={!canRedo}
                                        title="Redo last fleet edit"
                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <Redo2 size={14} />
                                        Redo
                                    </button>
                                    {isSortPaused ? (
                                        <button
                                            type="button"
                                            onClick={() => setPausedRowOrder(null)}
                                            title="Re-apply the current row sort"
                                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-extrabold text-amber-800 shadow-sm hover:bg-amber-100"
                                        >
                                            Apply sort order
                                        </button>
                                    ) : null}
                                </div>
                                {isSortPaused ? (
                                    <p className="mt-1 text-xs font-semibold text-amber-700">
                                        Row order is paused while editing so buses do not jump.
                                    </p>
                                ) : null}
                            </div>
                            <div className="hidden rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 xl:block">
                                <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">
                                    Year summary
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-extrabold">
                                    <span className="text-green-700">Purchase</span>
                                    <span className="text-gray-300">/</span>
                                    <span className="text-red-600">Retire</span>
                                </div>
                            </div>
                            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${visibleTimelineColumns.length}, minmax(42px, 1fr))` }}>
                                {visibleTimelineColumns.map((column) => {
                                    const isFocused = focusedYear === column.key;
                                    return (
                                        <button
                                            key={column.key}
                                            type="button"
                                            onClick={() => handleYearFocusClick(column.key)}
                                            className={`rounded-lg px-1.5 py-2 text-center transition ${
                                                isFocused
                                                    ? 'bg-gray-950 text-white shadow-sm ring-2 ring-gray-300'
                                                    : 'bg-gray-50 text-gray-950 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200'
                                            }`}
                                            title={isFocused ? `Clear ${column.key} focus` : `Focus table on ${column.key}`}
                                        >
                                            <div className={`text-[10px] font-extrabold ${isFocused ? 'text-white/70' : 'text-gray-500'}`}>{column.key}</div>
                                            <div className={`mt-1 text-sm font-black ${isFocused ? 'text-white' : 'text-gray-950'}`}>{fleetTotalsByYear[column.key] ?? 0}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {focusedYear ? (
                            <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                                <div className="flex items-center justify-between gap-3">
                                    <span>
                                        Focused on {focusedYear}: {focusedYearSummary?.total.retiring ?? 0} retiring · {focusedYearSummary?.total.purchasing ?? 0} purchasing
                                        {' '}({focusedYearSummary?.total.replacement ?? 0} replacement · {focusedYearSummary?.total.growth ?? 0} growth).
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setFocusedYear(null)}
                                        className="shrink-0 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-extrabold text-blue-700 hover:bg-blue-100"
                                    >
                                        Clear
                                    </button>
                                </div>
                                {focusedYearSummary ? (
                                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                                        {FLEET_PLAN_SHEET_CONFIGS.map((config) => {
                                            const counts = focusedYearSummary.byType[config.key];
                                            return (
                                                <div key={config.key} className="rounded-md border border-blue-100 bg-white/75 px-2.5 py-2 text-gray-700">
                                                    <div className="font-extrabold text-gray-950">{BUS_TYPE_LABELS[config.key]}</div>
                                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                                                        <span><strong>{counts.retiring}</strong> retiring</span>
                                                        <span><strong>{counts.purchasing}</strong> purchasing</span>
                                                        <span><strong>{counts.replacement}</strong> replacement</span>
                                                        <span><strong>{counts.growth}</strong> growth</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto border-t border-gray-100 pt-2">
                            {STATUS_FILTERS.map((filter) => {
                                const label = getStatusFilterLabel(filter.key, focusedYear);
                                const count = countMatchingRows(combinedRows, filter.key, busTypeFilter, currentYear, focusedYear);
                                return (
                                    <button
                                        key={filter.key}
                                        type="button"
                                        onClick={() => setStatusFilter(filter.key)}
                                        className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-extrabold leading-4 transition ${
                                            statusFilter === filter.key
                                                ? 'border-brand-blue bg-blue-50 text-brand-blue'
                                                : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50'
                                        }`}
                                    >
                                        {label} <span className="ml-0.5 text-gray-400">{count}</span>
                                    </button>
                                );
                            })}
                            <span className="mx-0.5 h-5 w-px shrink-0 bg-gray-200" />
                            {BUS_TYPE_FILTERS.map((filter) => (
                                <button
                                    key={filter.key}
                                    type="button"
                                    onClick={() => setBusTypeFilter(filter.key)}
                                    className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-extrabold leading-4 transition ${
                                        busTypeFilter === filter.key
                                            ? 'border-gray-900 bg-gray-900 text-white'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                            <span className="mx-0.5 h-5 w-px shrink-0 bg-gray-200" />
                            <button
                                type="button"
                                onClick={() => handleAddRow()}
                                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-extrabold leading-4 text-brand-blue shadow-sm transition hover:bg-blue-50"
                                title={`Add ${BUS_TYPE_LABELS[newRowSheetKey]} row`}
                            >
                                <Plus size={14} />
                                Add row
                            </button>
                        </div>
                    </div>
                </div>

                {timelineViewMode === 'table' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1360px] border-collapse text-left">
                            <thead className="sticky top-[132px] z-30 border-b border-gray-200 bg-gray-50 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-4 py-3">Unit</th>
                                    <th className="px-4 py-3">Type</th>
                                    <th className="px-4 py-3">Make/model</th>
                                    <th className="px-4 py-3">On order</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Purchase</th>
                                    <th className="px-4 py-3">Retirement</th>
                                    <th className="px-4 py-3">Lifecycle</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredRows.map(({ sheetKey, row }) => {
                                    const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
                                    const lifecycle = getFleetPlanLifecycle(row, config.timelineColumns, currentYear);
                                    const isGrowthRow = isFleetPlanGrowthRow(row);
                                    const currentYearAction = getFleetYearActionState(row, lifecycle, currentYearLabel);
                                    const currentYearHighlightClass = getCurrentYearHighlightClass(currentYearAction, isGrowthRow, sheetKey);
                                    const currentYearStatusChip = getCurrentYearStatusChip(currentYearAction, currentYearLabel);

                                    return (
                                        <tr key={`${sheetKey}-${row.id}-table`} className={`border-l-4 align-top ${currentYearHighlightClass}`}>
                                            <td className="px-4 py-3">
                                                <input
                                                    value={row.unitNumber}
                                                    onChange={(event) => handleFieldChange(sheetKey, row.id, 'unitNumber', event.target.value)}
                                                    className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-extrabold text-gray-950 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                    aria-label="Unit number"
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <select
                                                    value={sheetKey}
                                                    onChange={(event) => handleFieldChange(sheetKey, row.id, 'busType', event.target.value)}
                                                    className="w-36 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-bold text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                    aria-label={`Bus type for ${getFleetRowDisplayName(row)}`}
                                                >
                                                    {FLEET_PLAN_SHEET_CONFIGS.map((entry) => (
                                                        <option key={entry.key} value={entry.key}>{BUS_TYPE_LABELS[entry.key]}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-3">
                                                <input
                                                    value={row.makeModel}
                                                    onChange={(event) => handleFieldChange(sheetKey, row.id, 'makeModel', event.target.value)}
                                                    className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                    placeholder="Make/model"
                                                    aria-label="Make model"
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <select
                                                    value={(row.onOrder || '').trim() ? 'Yes' : ''}
                                                    onChange={(event) => handleFieldChange(sheetKey, row.id, 'onOrder', event.target.value)}
                                                    className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                    aria-label="On order"
                                                >
                                                    <option value=""></option>
                                                    <option value="Yes">Yes</option>
                                                </select>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex max-w-[220px] flex-wrap gap-1.5">
                                                    <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase ${BUS_TYPE_STYLES[sheetKey].badge}`}>
                                                        {BUS_TYPE_LABELS[sheetKey]}
                                                    </span>
                                                    {currentYearStatusChip ? (
                                                        <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase ${currentYearStatusChip.className}`}>
                                                            {currentYearStatusChip.label}
                                                        </span>
                                                    ) : null}
                                                    {isGrowthRow && !currentYearAction.purchasing ? (
                                                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-extrabold uppercase text-amber-700">
                                                            + Growth
                                                        </span>
                                                    ) : null}
                                                    <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${BUS_TYPE_STYLES[sheetKey].detail}`}>
                                                        Life: <span className="text-gray-950">{getFleetPlanServiceLifeCompactLabel(row.year, currentYear)}</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-sm font-black text-green-700" title={`Purchase year: ${getPurchaseYearSummary(lifecycle)}`}>
                                                    {getPurchaseYearSummary(lifecycle)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className={`text-sm font-black ${lifecycle.retireYear ? 'text-red-600' : 'text-gray-400'}`} title={`Retirement year: ${getRetirementYearSummary(lifecycle)}`}>
                                                    {getRetirementYearSummary(lifecycle)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {renderLifecycleTrack(sheetKey, row, lifecycle, { compact: true })}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteRow(sheetKey, row)}
                                                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-100 bg-white text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-100"
                                                    title={`Delete ${getFleetRowDisplayName(row)}`}
                                                    aria-label={`Delete ${getFleetRowDisplayName(row)}`}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {filteredRows.length === 0 ? (
                            <div className="px-6 py-12 text-center text-sm text-gray-500">
                                No fleet rows match the selected filters.
                            </div>
                        ) : null}
                    </div>
                ) : (
                <div className="divide-y divide-gray-100">
                    {filteredRows.map(({ sheetKey, row }) => {
                        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
                        const yearKeys = visibleTimelineColumns.map((column) => column.key);
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
                        const isGrowthRow = isFleetPlanGrowthRow(row);
                        const purchaseBadgeLabel = getPurchaseBadgeLabel(row, lifecycle, focusedYear);
                        const currentYearAction = getFleetYearActionState(row, lifecycle, currentYearLabel);
                        const currentYearHighlightClass = getCurrentYearHighlightClass(currentYearAction, isGrowthRow, sheetKey);
                        const currentYearStatusChip = getCurrentYearStatusChip(currentYearAction, currentYearLabel);

                        return (
                            <div key={`${sheetKey}-${row.id}`} className={`grid gap-3 border-l-4 px-6 py-2.5 xl:grid-cols-[400px_112px_minmax(520px,1fr)] 2xl:grid-cols-[430px_124px_minmax(560px,1fr)] ${currentYearHighlightClass}`}>
                                <div className="min-w-0">
                                    <div className="flex min-w-0 items-start gap-2">
                                        <input
                                            value={row.unitNumber}
                                            onChange={(event) => handleFieldChange(sheetKey, row.id, 'unitNumber', event.target.value)}
                                            className="w-24 shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-extrabold text-gray-950 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            aria-label="Unit number"
                                        />
                                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase ${BUS_TYPE_STYLES[sheetKey].badge}`}>
                                                {BUS_TYPE_LABELS[sheetKey]}
                                            </span>
                                            {currentYearStatusChip ? (
                                                <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase ${currentYearStatusChip.className}`}>
                                                    {currentYearStatusChip.label}
                                                </span>
                                            ) : null}
                                            {isGrowthRow && !currentYearAction.purchasing ? (
                                                <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-extrabold uppercase text-amber-700">
                                                    + Growth
                                                </span>
                                            ) : null}
                                            {purchaseBadgeLabel && !currentYearAction.purchasing ? (
                                                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-extrabold uppercase text-emerald-700">
                                                    {purchaseBadgeLabel}
                                                </span>
                                            ) : null}
                                            <span className={`min-w-0 truncate rounded-full px-2 py-1 text-[10px] font-extrabold ${BUS_TYPE_STYLES[sheetKey].detail}`}>
                                                Life: <span className="text-gray-950">{getFleetPlanServiceLifeCompactLabel(row.year, currentYear)}</span>
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteRow(sheetKey, row)}
                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-100 bg-white text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-100"
                                            title={`Delete ${getFleetRowDisplayName(row)}`}
                                            aria-label={`Delete ${getFleetRowDisplayName(row)}`}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <input
                                            value={row.makeModel}
                                            onChange={(event) => handleFieldChange(sheetKey, row.id, 'makeModel', event.target.value)}
                                            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            placeholder="Make/model"
                                            aria-label="Make model"
                                        />
                                        <label className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase leading-none text-gray-500">
                                            <span className="text-right">
                                                On<br />order
                                            </span>
                                            <select
                                                value={(row.onOrder || '').trim() ? 'Yes' : ''}
                                                onChange={(event) => handleFieldChange(sheetKey, row.id, 'onOrder', event.target.value)}
                                                className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value=""></option>
                                                <option value="Yes">Yes</option>
                                            </select>
                                        </label>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 xl:grid-cols-1">
                                    <div>
                                        <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">
                                            Purchase
                                        </div>
                                        <div className="mt-0.5 truncate text-sm font-black text-green-700" title={`Purchase year: ${getPurchaseYearSummary(lifecycle)}`}>
                                            {getPurchaseYearSummary(lifecycle)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">
                                            Retirement
                                        </div>
                                        <div className={`mt-0.5 truncate text-sm font-black ${lifecycle.retireYear ? 'text-red-600' : 'text-gray-400'}`} title={`Retirement year: ${getRetirementYearSummary(lifecycle)}`}>
                                            {getRetirementYearSummary(lifecycle)}
                                        </div>
                                    </div>
                                </div>

                                <div className="min-w-0">
                                    <div className={`rounded-xl border px-3 py-2 ${BUS_TYPE_STYLES[sheetKey].timeline}`}>
                                        <div className="mb-1 flex items-center justify-between text-xs font-bold text-gray-600">
                                            <label className="flex items-center gap-1">
                                                <span>In service:</span>
                                                <input
                                                    key={`${row.id}-${lifecycle.startYear || 'missing'}-in-service`}
                                                    defaultValue={lifecycle.startYear || ''}
                                                    inputMode="numeric"
                                                    pattern="\d{4}"
                                                    maxLength={4}
                                                    placeholder="Year"
                                                    aria-label={`In-service year for bus ${row.unitNumber || 'row'}`}
                                                    onBlur={(event) => {
                                                        if (event.currentTarget.value.trim() !== (lifecycle.startYear || '')) {
                                                            handleInServiceYearInput(sheetKey, row.id, event.currentTarget.value);
                                                        }
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key !== 'Enter') return;
                                                        event.preventDefault();
                                                        event.currentTarget.blur();
                                                    }}
                                                    className="h-7 w-16 rounded-md border border-blue-200 bg-white px-2 text-xs font-extrabold text-brand-blue shadow-inner shadow-blue-50 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                />
                                            </label>
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
                                            <div className="absolute inset-x-0 top-4 h-1.5 -translate-y-1/2 rounded-full bg-gray-200" />
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
                                                className={`absolute top-4 z-10 h-2.5 -translate-y-1/2 cursor-grab rounded-full shadow-sm outline-none ring-blue-200 transition hover:bg-blue-600 focus:ring-4 active:cursor-grabbing ${
                                                    hasRetirementYear ? 'bg-blue-500/90' : 'border border-dashed border-blue-500 bg-blue-300/60'
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
                                                className="absolute top-4 z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white bg-blue-600 shadow outline-none ring-blue-200 transition hover:scale-105 focus:ring-4"
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
                                                className={`absolute top-4 z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white shadow outline-none ring-red-200 transition hover:scale-105 focus:ring-4 ${
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
                                    {!hasRetirementYear ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const fallbackYear = yearKeys[Math.max(startIndex, yearKeys.length - 1)];
                                                if (fallbackYear) handleLifecycleBoundaryMove(sheetKey, row.id, 'retire', fallbackYear);
                                            }}
                                            className="mt-1.5 inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-extrabold text-amber-700 transition hover:bg-amber-50"
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
                )}
            </section>

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
            <FleetPlanIssueResolverModal
                isOpen={showIssueResolver}
                workbook={draft}
                validation={fleetValidation}
                currentYear={currentYear}
                onApply={handleApplyIssueResolution}
                onClose={() => setShowIssueResolver(false)}
            />
        </div>
    );
};
