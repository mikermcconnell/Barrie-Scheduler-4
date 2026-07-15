import React, { useState, useMemo, useEffect } from 'react';
import {
    ChevronDown,
    ChevronRight,
    ArrowLeft,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import {
    MasterRouteTable,
    MasterTrip,
    validateRouteTable,
    RoundTripTable,
    buildRoundTripView
} from '../utils/parsers/masterScheduleParser';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import { AIReviewPanel } from './ai/AIReviewPanel';
import type { ConnectionLibrary, RouteConnectionConfig } from '../utils/connections/connectionTypes';
import { getConnectionLibrary, getRouteConnectionConfig } from '../utils/connections/connectionLibraryService';
import { WorkspaceHeader } from './layout/WorkspaceHeader';
import { AutoSaveStatus } from '../hooks/useAutoSave';
import { TimeUtils } from '../utils/timeUtils';
import { getRouteColor, getRouteTextColor } from '../utils/config/routeColors';
import { AddTripModal } from './modals/AddTripModal';
import { ExtendTripModal } from './modals/ExtendTripModal';
import { useAddTrip } from '../hooks/useAddTrip';
import { TravelTimeGrid } from './TravelTimeGrid';
import { AuditLogPanel, useAuditLog } from './AuditLogPanel';
import { TripContextMenu, TripContextMenuAction } from './NewSchedule/TripContextMenu';
import { FilterState } from './NewSchedule/QuickActionsBar';
import { TimelineView } from './NewSchedule/TimelineView';
import {
    endBlockAtTrip,
    setTripStartStop,
    setTripEndStop
} from './NewSchedule/utils/timeCascade';
import { type DayType } from '../utils/masterScheduleTypes';
import {
    deepCloneSchedules,
    findTableAndTrip,
} from '../utils/schedule/scheduleEditorUtils';
import { RoundTripTableView } from './schedule/RoundTripTableView';
import { getRouteConfig, extractDirectionFromName, parseRouteInfo } from '../utils/config/routeDirectionConfig';
import { reassignBlocksForTables, MatchConfigPresets } from '../utils/blocks/blockAssignmentCore';
import { useScheduleEditing, type CascadeMode } from '../hooks/useScheduleEditing';
import { useTravelTimeGrid } from '../hooks/useTravelTimeGrid';
import { CascadeModeSelector } from './ui/CascadeModeSelector';
import { isEditableEventTarget } from '../utils/domUtils';
import { isFeatureEnabled } from '../utils/features';
import { buildScheduleReviewSnapshot } from '../utils/ai/scheduleReviewContext';
import { Modal } from './ui/Modal';
import {
    applyExtendTripResultToSchedules,
    buildExtendTripModalContext,
    type ExtendTripModalContext,
    type ExtendTripResult
} from '../utils/schedule/extendTripPlanner';
import {
    buildDetailedMasterComparison,
    buildMasterComparisonChangeSummary,
    type MasterComparisonChangeCounts,
} from '../utils/schedule/masterComparison';
import { openTimetablePublisher } from '../utils/reports/timetableNavigation';
import {
    formatScheduleEditImpact,
    summarizeScheduleEditImpact,
    type ScheduleEditImpact,
} from '../utils/schedule/scheduleEditImpact';
import { isMergedRouteBase } from '../utils/schedule/mergedRouteContinuity';
// --- Main Editor Component ---

export const tableMatchesActiveCompareScope = (
    baselineTable: MasterRouteTable,
    routeTables: MasterRouteTable[]
): boolean => {
    if (routeTables.length === 0) return false;
    if (routeTables.some(routeTable => routeTable.routeName === baselineTable.routeName)) {
        return true;
    }

    const baselineRouteKey = parseRouteInfo(baselineTable.routeName).baseRoute.trim().toUpperCase();
    const activeRouteKeys = new Set(routeTables.map(routeTable => (
        parseRouteInfo(routeTable.routeName).baseRoute.trim().toUpperCase()
    )));
    if (!activeRouteKeys.has(baselineRouteKey)) {
        return false;
    }

    const baselineDirection = extractDirectionFromName(baselineTable.routeName);
    const activeDirections = routeTables.map(routeTable => extractDirectionFromName(routeTable.routeName));

    // Master and generated tables can use different display names for the
    // same route/day, so compare by direction when exact names differ.
    // If either side has no explicit direction, treat it as a loop/single
    // table and keep it in scope for this route identity.
    if (!baselineDirection || activeDirections.some(direction => !direction)) {
        return true;
    }

    return activeDirections.includes(baselineDirection);
};

// Time Band type for display
interface TimeBandDisplay {
    id: string;
    color: string;
    avg: number;
}

// Analysis bucket type
interface TripBucketAnalysisDisplay {
    timeBucket: string;
    totalP50: number;
    totalP80: number;
    assignedBand?: string;
    ignored?: boolean;
    details?: Array<{
        segmentName: string;
        p50: number;
        p80: number;
    }>;
}

const formatChangeSummary = (counts: MasterComparisonChangeCounts): string => {
    const parts: string[] = [];

    if (counts.new > 0) parts.push(`New ${counts.new}`);
    if (counts.extended > 0) parts.push(`Extended ${counts.extended}`);
    if (counts.shortened > 0) parts.push(`Shortened ${counts.shortened}`);
    if (counts.retimed > 0) parts.push(`Retimed ${counts.retimed}`);
    if (counts.review > 0) parts.push(`Review ${counts.review}`);
    if (counts.removed > 0) parts.push(`Removed ${counts.removed}`);

    return parts.join(' • ');
};

type ExportScope = 'current-route' | 'all-routes';

export interface ScheduleEditorProps {
    schedules: MasterRouteTable[];
    useAuthoritativeTimepoints?: boolean;
    initialTimepointOnly?: boolean;
    condensedTimepointView?: boolean;
    // Optional schedule scope used by Connections library validation/resolution.
    // If omitted, defaults to the currently edited schedules.
    connectionScopeSchedules?: MasterRouteTable[];
    // Optional schedule scope used for full-system export from editors that only load one route at a time.
    // If omitted, defaults to the currently edited schedules.
    exportScopeSchedules?: MasterRouteTable[];
    onSchedulesChange?: (schedules: MasterRouteTable[]) => void;
    originalSchedules?: MasterRouteTable[];
    initialShowDeltas?: boolean;
    onResetOriginals?: () => void;
    draftName?: string;
    onRenameDraft?: (name: string) => void;
    autoSaveStatus?: AutoSaveStatus;
    lastSaved?: Date | null;
    hasUnsavedChanges?: boolean;
    onSaveVersion?: (label?: string) => Promise<void>;
    onClose?: () => void;
    onNewDraft?: () => void;
    onOpenDrafts?: () => void;
    onDuplicateDraft?: () => void;

    // Undo/Redo
    canUndo?: boolean;
    canRedo?: boolean;
    undo?: () => void;
    redo?: () => void;

    showSuccessToast?: (msg: string) => void;

    // Read-only mode for Master Schedule Browser
    readOnly?: boolean;

    // Embedded mode - hides sidebar and header for use in MasterScheduleBrowser
    embedded?: boolean;

    // Hide sidebar (for multi-route mode where top bar handles route switching)
    hideSidebar?: boolean;

    // Optional time bands for display
    bands?: TimeBandDisplay[];

    // Optional analysis data for Travel Times view
    analysis?: TripBucketAnalysisDisplay[];
    segmentNames?: string[];

    // Target values for strict mode highlighting (in minutes)
    targetCycleTime?: number;
    targetHeadway?: number;
    // Hide autosave when parent handles it
    hideAutoSave?: boolean;

    // Team-scoped actions
    teamId?: string;
    userId?: string;
    uploaderName?: string;

    // Publish action (Draft -> Publish)
    onPublish?: () => void;
    publishLabel?: string;
    isPublishing?: boolean;
    publishDisabled?: boolean;
    sourceLabel?: string;
    changeCount?: number;
    warningCount?: number;
    onReviewChanges?: () => void;
    reviewChangesDisabled?: boolean;

    // Master comparison baseline (inline delta badges)
    masterBaseline?: MasterRouteTable[] | null;
    compareBaselineLabel?: string;
    highlightedTripId?: string | null;
    visibleTripIds?: string[] | null;
    // Step 4 simplified workspace: keep editor chrome light and move secondary tools into a sidebar.
    compactStep4?: boolean;
    reviewToolsSlot?: React.ReactNode;
}

export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({
    schedules,
    useAuthoritativeTimepoints = false,
    initialTimepointOnly = false,
    condensedTimepointView = false,
    connectionScopeSchedules,
    exportScopeSchedules,
    onSchedulesChange,
    originalSchedules,
    initialShowDeltas,
    onResetOriginals,
    draftName = 'Schedule',
    onRenameDraft,
    autoSaveStatus,
    lastSaved,
    hasUnsavedChanges,
    onSaveVersion,
    onClose,
    onNewDraft,
    onOpenDrafts,
    onDuplicateDraft,
    canUndo = false, canRedo = false, undo, redo,
    showSuccessToast,
    bands,
    analysis,
    segmentNames,
    targetCycleTime,
    targetHeadway,
    hideAutoSave,
    teamId,
    userId,
    uploaderName,
    readOnly = false,
    embedded = false,
    hideSidebar = false,
    onPublish,
    publishLabel,
    isPublishing,
    publishDisabled,
    sourceLabel,
    changeCount,
    warningCount,
    onReviewChanges,
    reviewChangesDisabled,
    masterBaseline,
    compareBaselineLabel,
    highlightedTripId,
    visibleTripIds,
    compactStep4 = false,
    reviewToolsSlot
}) => {
    const MIDNIGHT_ROLLOVER_THRESHOLD = 210; // 3:30 AM
    const effectiveHasUnsavedChanges = readOnly
        ? false
        : (hasUnsavedChanges ?? schedules.length > 0);
    const stripNumberedStopSuffix = (stopName: string): string => stopName.replace(/\s*\(\d+\)\s*$/, '');
    const hasNumberedStopSuffix = (stopName: string): boolean => /\s*\(\d+\)\s*$/.test(stopName);
    const resolveTripStopKey = <T,>(record: Record<string, T> | undefined, stopName: string): string | null => {
        if (!record) return null;
        if (record[stopName] !== undefined) return stopName;

        const baseName = stripNumberedStopSuffix(stopName);
        if (baseName !== stopName && record[baseName] !== undefined) return baseName;

        const normalizedStop = stopName.trim().toLowerCase();
        const normalizedBase = baseName.trim().toLowerCase();
        const allowSuffixedFallback = hasNumberedStopSuffix(stopName);

        for (const key of Object.keys(record)) {
            const normalizedKey = key.trim().toLowerCase();
            const normalizedKeyBase = stripNumberedStopSuffix(key).trim().toLowerCase();
            if (!allowSuffixedFallback && hasNumberedStopSuffix(key)) continue;
            if (
                normalizedKey === normalizedStop ||
                normalizedKey === normalizedBase ||
                normalizedKeyBase === normalizedBase
            ) {
                return key;
            }
        }

        return null;
    };
    const getTripStopValue = <T,>(record: Record<string, T> | undefined, stopName: string): T | undefined => {
        const resolvedKey = resolveTripStopKey(record, stopName);
        return resolvedKey ? record?.[resolvedKey] : undefined;
    };
    const [activeRouteIdx, setActiveRouteIdx] = useState(0);
    const [activeDay, setActiveDay] = useState<string>('Weekday');
    const [subView, setSubView] = useState<'editor' | 'matrix' | 'timeline'>('editor');
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
    const [recentlyAddedTripId, setRecentlyAddedTripId] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showAuditLog, setShowAuditLog] = useState(false);
    const [showExportScopeModal, setShowExportScopeModal] = useState(false);
    const [extendTripModalContext, setExtendTripModalContext] = useState<ExtendTripModalContext | null>(null);

    // Connections Panel State
    const [showConnectionsPanel, setShowConnectionsPanel] = useState(false);
    const [showAiReviewPanel, setShowAiReviewPanel] = useState(false);
    const [connectionLibrary, setConnectionLibrary] = useState<ConnectionLibrary | null>(null);
    const [activeRouteConnectionConfig, setActiveRouteConnectionConfig] = useState<RouteConnectionConfig | null>(null);
    void uploaderName;
    const aiReviewEnabled = isFeatureEnabled('fixedLocalAiReview');

    // Load connection data after the first paint so the editor becomes usable first.
    useEffect(() => {
        if (!teamId) {
            setConnectionLibrary(null);
            return;
        }

        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const loadConnectionLibrary = () => {
            getConnectionLibrary(teamId)
                .then(lib => {
                    if (!cancelled) setConnectionLibrary(lib);
                })
                .catch(err => {
                    console.error('Failed to load connection library:', err);
                    if (!cancelled) setConnectionLibrary(null);
                });
        };

        const scheduleIdleLoad = typeof window !== 'undefined' && 'requestIdleCallback' in window
            ? (window as Window & {
                requestIdleCallback: (callback: () => void, options?: { timeout?: number }) => number;
                cancelIdleCallback: (id: number) => void;
            }).requestIdleCallback
            : null;

        if (scheduleIdleLoad) {
            const idleId = scheduleIdleLoad(loadConnectionLibrary, { timeout: 1200 });
            return () => {
                cancelled = true;
                (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
            };
        }

        timeoutId = setTimeout(loadConnectionLibrary, 400);

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [teamId]);

    // Quick Actions Bar Filter State
    const [filter] = useState<FilterState>({
        timeRange: { start: null, end: null },
        highlight: null,
        search: ''
    });

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        tripId: string;
        tripDirection: 'North' | 'South';
        blockId: string;
        stopName?: string;
        stopIndex?: number;
        stops: string[];
        beforeTripId?: string;
        afterTripId?: string;
        rowTripIds?: string[];
        tripOptions?: Array<{ id: string; direction: 'North' | 'South' }>;
        menuLabel?: string;
        addLabel?: string;
        deleteLabel?: string;
        hideTripSpecificActions?: boolean;
        quickAddActionsOnly?: boolean;
    } | null>(null);

    // Audit Log
    const { entries: auditEntries, logAction } = useAuditLog();

    // Cascade Mode for time editing
    const [cascadeMode, setCascadeMode] = useState<CascadeMode>('always');
    const [editImpact, setEditImpact] = useState<ScheduleEditImpact | null>(null);
    const [editNotice, setEditNotice] = useState<string | null>(null);

    useEffect(() => {
        if (highlightedTripId) setSubView('editor');
    }, [highlightedTripId]);

    // Add Trip
    const {
        modalContext: addTripModalContext,
        openModal: openAddTripModal,
        openEditModal,
        closeModal: closeAddTripModal,
        handleConfirm: handleAddTripFromModal
    } = useAddTrip({
        schedules,
        setSchedules: onSchedulesChange,
        onSuccess: showSuccessToast,
        connectionLibrary,
        onTripsAdded: (tripIds) => {
            const firstTripId = tripIds[0];
            if (!firstTripId) return;
            setRecentlyAddedTripId(firstTripId);
            setSelectedTripId(firstTripId);
            setSubView('editor');
        }
    });

    useEffect(() => {
        if (!recentlyAddedTripId) return;
        const timeout = window.setTimeout(() => {
            setRecentlyAddedTripId(null);
        }, 4000);
        return () => window.clearTimeout(timeout);
    }, [recentlyAddedTripId]);

    useEffect(() => {
        if (!editImpact) return;
        const timeout = window.setTimeout(() => setEditImpact(null), 8000);
        return () => window.clearTimeout(timeout);
    }, [editImpact]);

    useEffect(() => {
        if (!editNotice) return;
        const timeout = window.setTimeout(() => setEditNotice(null), 6000);
        return () => window.clearTimeout(timeout);
    }, [editNotice]);

    // Helper to extract the true base route name (handles 2A/2B direction variants)
    const getTrueBaseRoute = (routeName: string): string => {
        // First strip (North), (South), and day type suffixes
        const stripped = routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
            .trim();
        // Then check if the result (e.g., "2A", "2B") is a direction variant
        const parsed = parseRouteInfo(stripped);
        return parsed.suffixIsDirection ? parsed.baseRoute : stripped;
    };

    // Consolidate Routes
    const consolidateRoutes = (tables: MasterRouteTable[]) => {
        const routeGroups: Record<string, {
            name: string;
            days: Record<string, {
                north?: MasterRouteTable;
                south?: MasterRouteTable;
                combined?: RoundTripTable;
            }>;
        }> = {};

        tables.forEach(table => {
            let dayType = 'Weekday';
            if (table.routeName.includes('(Saturday)')) dayType = 'Saturday';
            else if (table.routeName.includes('(Sunday)')) dayType = 'Sunday';

            // Get base route name (handles 2A/2B direction variants -> "2")
            const baseName = getTrueBaseRoute(table.routeName);

            // Parse route info for direction variant detection
            const stripped = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();
            const parsed = parseRouteInfo(stripped);

            if (!routeGroups[baseName]) routeGroups[baseName] = { name: baseName, days: {} };
            if (!routeGroups[baseName].days[dayType]) routeGroups[baseName].days[dayType] = {};

            const dayGroup = routeGroups[baseName].days[dayType];

            // Determine direction: either from explicit (North)/(South) suffix or from A/B variant
            let tableDirection = extractDirectionFromName(table.routeName);
            if (!tableDirection && parsed.suffixIsDirection) {
                // A/B suffix IS the direction (e.g., 2A=North, 2B=South)
                tableDirection = parsed.direction;
            }

            if (tableDirection === 'North') dayGroup.north = table;
            else if (tableDirection === 'South') dayGroup.south = table;
            else dayGroup.north = table;
        });

        return Object.values(routeGroups).map(group => {
            Object.keys(group.days).forEach(d => {
                const day = group.days[d];
                if (day.north && day.south) day.combined = buildRoundTripView(day.north, day.south);
            });
            return group;
        }).sort((a, b) => {
            // Sort numerically, largest to smallest
            const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
            return numB - numA; // Descending order
        });
    };

    const consolidatedRoutes = useMemo(() => consolidateRoutes(schedules), [schedules]); // eslint-disable-line react-hooks/exhaustive-deps
    const exportableTables = exportScopeSchedules ?? schedules;
    const exportableRouteCount = useMemo(() => consolidateRoutes(exportableTables).length, [exportableTables]); // eslint-disable-line react-hooks/exhaustive-deps

    // Travel Time Grid Hook
    const gridHandlers = useTravelTimeGrid(schedules, onSchedulesChange, logAction, impact => {
        if (impact.changedTripCount > 0) setEditImpact(impact);
    });

    // Keep active route/day selection valid as schedules change.
    useEffect(() => {
        if (!consolidatedRoutes.length) {
            if (activeRouteIdx !== 0) setActiveRouteIdx(0);
            return;
        }

        if (activeRouteIdx >= consolidatedRoutes.length) {
            setActiveRouteIdx(consolidatedRoutes.length - 1);
            return;
        }

        const group = consolidatedRoutes[activeRouteIdx];
        if (!group) return;

        if (!group.days[activeDay]) {
            // Pick first available day
            const firstAvailable = Object.keys(group.days)[0];
            if (firstAvailable) setActiveDay(firstAvailable);
        }
    }, [consolidatedRoutes, activeRouteIdx, activeDay]);

    // Keyboard shortcuts: Ctrl+S (save), Ctrl+Z (undo), Ctrl+Y (redo), Escape (exit fullscreen)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isTypingIntoField = isEditableEventTarget(e.target);
            const hasShortcutModifier = e.ctrlKey || e.metaKey;

            // Ctrl+S: Save version
            if (hasShortcutModifier && e.key === 's') {
                e.preventDefault();
                if (!readOnly && onSaveVersion) {
                    void onSaveVersion()
                        .then(() => {
                            showSuccessToast?.('Version saved');
                        })
                        .catch((error) => {
                            console.error('Save version failed:', error);
                        });
                }
            }
            // Don't hijack field-level undo/redo or escape while a user is typing.
            if (isTypingIntoField) {
                return;
            }
            // Ctrl+Z / Cmd+Z: Undo
            if (hasShortcutModifier && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
            }
            // Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z: Redo
            if ((hasShortcutModifier && e.key === 'y') || (hasShortcutModifier && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                if (canRedo) redo();
            }
            // Escape: Exit fullscreen
            if (e.key === 'Escape' && isFullScreen) {
                setIsFullScreen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo, onSaveVersion, showSuccessToast, isFullScreen, readOnly]);

    // Handlers
    const recalculateTrip = (trip: MasterTrip, cols: string[]) => {
        let start: number | null = null;
        let end: number | null = null;
        let offset = 0;
        let lastAdjusted: number | null = null;
        const stopMinutes: Record<string, number> = {};

        cols.forEach(col => {
            const stopKey = resolveTripStopKey(trip.stops, col);
            const raw = stopKey ? TimeUtils.toMinutes(trip.stops[stopKey]) : null;
            if (raw !== null) {
                let adjusted = raw;

                if (raw >= 1440) {
                    adjusted = raw;
                    offset = Math.floor(raw / 1440) * 1440;
                } else {
                    if (lastAdjusted !== null && raw + offset < lastAdjusted - 60) {
                        offset += 1440;
                    }
                    adjusted = raw + offset;
                }

                if (start === null) start = adjusted;
                end = adjusted;
                lastAdjusted = adjusted;
                stopMinutes[resolveTripStopKey(trip.stopMinutes, col) ?? stopKey ?? col] = adjusted;
            }
        });

        if (start !== null && end !== null) {
            if (start < MIDNIGHT_ROLLOVER_THRESHOLD && !Object.values(stopMinutes).some(v => v >= 1440)) {
                start += 1440;
                end += 1440;
                for (const key of Object.keys(stopMinutes)) {
                    stopMinutes[key] += 1440;
                }
            }

            trip.startTime = start;
            trip.endTime = end;
            trip.stopMinutes = stopMinutes;
            trip.cycleTime = end - start;  // Full span: last departure - first departure
            trip.travelTime = Math.max(0, trip.cycleTime - trip.recoveryTime);  // Travel = cycle - recovery
        }
    };

    // Re-assign blocks for related tables based on time matching
    // Uses unified block assignment from blockAssignmentCore.ts
    const reassignBlocksForRelatedTables = (
        tables: MasterRouteTable[],
        baseName: string
    ) => {
        // Find all related tables (same route, different directions)
        const relatedTables = tables.filter(t => {
            const tBase = getTrueBaseRoute(t.routeName);
            return tBase === baseName;
        });

        if (relatedTables.length === 0) return;

        const routeConfig = getRouteConfig(baseName);
        const directions = new Set(
            relatedTables.flatMap(table => table.trips.map(trip => trip.direction))
        );
        const hasBidirectionalService = directions.has('North') && directions.has('South');
        const reassignmentConfig =
            routeConfig?.segments.length === 2 && hasBidirectionalService
                ? MatchConfigPresets.merged
                : MatchConfigPresets.editor;

        // For paired North/South routes, preserve block continuity by chaining on actual gap.
        reassignBlocksForTables(relatedTables, baseName, reassignmentConfig);
    };

    const {
        handleCellEdit,
        handleRecoveryEdit,
        handleTimeAdjust,
        handleDuplicateTrip,
    } = useScheduleEditing(schedules, onSchedulesChange ?? (() => {}), {
        cascadeMode,
        logAction,
        showSuccessToast,
        onEditImpact: impact => {
            if (impact.changedTripCount > 0) setEditImpact(impact);
        },
        onEditNotice: setEditNotice,
    });

    const handleDeleteTrips = (tripIds: string[], options?: { treatAsRoundTrip?: boolean }) => {
        const uniqueTripIds = Array.from(new Set(tripIds.filter(Boolean)));
        if (uniqueTripIds.length === 0) return;

        const confirmMessage = options?.treatAsRoundTrip || uniqueTripIds.length > 1
            ? 'Delete round trip?'
            : 'Delete trip?';
        if (!confirm(confirmMessage)) return;

        const newScheds = deepCloneSchedules(schedules);

        for (const tripId of uniqueTripIds) {
            for (const t of newScheds) {
                const tripToDelete = t.trips.find(x => x.id === tripId);
                if (tripToDelete) {
                    logAction('delete', `Deleted trip from Block ${tripToDelete.blockId}`, {
                        tripId,
                        blockId: tripToDelete.blockId,
                        field: 'trip'
                    });
                    t.trips = t.trips.filter(x => x.id !== tripId);
                    validateRouteTable(t);
                    break;
                }
            }
        }

        onSchedulesChange(newScheds);
        const impact = summarizeScheduleEditImpact(schedules, newScheds);
        if (impact.changedTripCount > 0) setEditImpact(impact);
    };

    const handleDeleteTrip = (tripId: string) => {
        handleDeleteTrips([tripId], { treatAsRoundTrip: false });
    };

    // Context Menu Action Handler
    const handleContextMenuAction = (action: TripContextMenuAction) => {
        switch (action.type) {
            case 'deleteTrip':
                handleDeleteTrip(action.tripId);
                break;

            case 'deleteRoundTrip':
                handleDeleteTrips(action.tripIds ?? [action.tripId], { treatAsRoundTrip: true });
                break;

            case 'addTripBefore': {
                const addResult = findTableAndTrip(schedules, action.tripId);
                if (addResult) {
                    openAddTripModal(action.tripId, { north: activeRoute.north, south: activeRoute.south }, 'before');
                }
                break;
            }

            case 'addTripAfter': {
                // Find the trip and open add modal
                const addResult = findTableAndTrip(schedules, action.tripId);
                if (addResult) {
                    openAddTripModal(action.tripId, { north: activeRoute.north, south: activeRoute.south }, 'after');
                }
                break;
            }

            case 'editTrip': {
                const editResult = findTableAndTrip(schedules, action.tripId);
                if (editResult) {
                    openEditModal(action.tripId);
                }
                break;
            }

            case 'endBlockHere':
                if (action.stopIndex !== undefined) {
                    // Set endStopIndex on this trip
                    let newScheds = setTripEndStop(schedules, action.tripId, action.stopIndex);

                    // Also remove all subsequent trips in this block
                    newScheds = endBlockAtTrip(newScheds, action.tripId);

                    logAction('edit', `Ended block at stop ${action.stopName}`, {
                        tripId: action.tripId,
                        field: 'endStopIndex',
                        newValue: action.stopIndex
                    });

                    onSchedulesChange(newScheds);
                    const impact = summarizeScheduleEditImpact(schedules, newScheds);
                    if (impact.changedTripCount > 0) setEditImpact(impact);
                    showSuccessToast('Block ended - subsequent trips removed');
                }
                break;

            case 'startBlockHere':
                if (action.stopIndex !== undefined) {
                    const newScheds = setTripStartStop(schedules, action.tripId, action.stopIndex);

                    logAction('edit', `Started block at stop ${action.stopName}`, {
                        tripId: action.tripId,
                        field: 'startStopIndex',
                        newValue: action.stopIndex
                    });

                    onSchedulesChange(newScheds);
                    const impact = summarizeScheduleEditImpact(schedules, newScheds);
                    if (impact.changedTripCount > 0) setEditImpact(impact);
                    showSuccessToast('Block start point updated');
                }
                break;

            case 'duplicateTrip':
                handleDuplicateTrip(action.tripId);
                break;

            case 'extendTrip': {
                const extendContext = buildExtendTripModalContext(schedules, action.tripId);
                if (extendContext) {
                    setExtendTripModalContext(extendContext);
                }
                break;
            }
        }
        setContextMenu(null);
    };

    // Right-click handler for trip rows
    const handleTripRightClick = (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number,
        tripOptions?: Array<{ id: string; direction: 'North' | 'South' }>
    ) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            tripId,
            tripDirection,
            blockId,
            stopName,
            stopIndex,
            stops,
            tripOptions
        });
    };

    // Menu open handler for kebab button click
    const handleMenuOpen = ({
        tripId,
        x,
        y,
        direction,
        blockId,
        stops,
        beforeTripId,
        afterTripId,
        rowTripIds,
        tripOptions,
        menuLabel,
        addLabel,
        deleteLabel,
        hideTripSpecificActions,
        quickAddActionsOnly
    }: {
        tripId: string;
        x: number;
        y: number;
        direction: 'North' | 'South';
        blockId: string;
        stops: string[];
        beforeTripId?: string;
        afterTripId?: string;
        rowTripIds?: string[];
        tripOptions?: Array<{ id: string; direction: 'North' | 'South' }>;
        menuLabel?: string;
        addLabel?: string;
        deleteLabel?: string;
        hideTripSpecificActions?: boolean;
        quickAddActionsOnly?: boolean;
    }) => {
        setContextMenu({
            x,
            y,
            tripId,
            tripDirection: direction,
            blockId,
            stops,
            beforeTripId,
            afterTripId,
            rowTripIds,
            tripOptions,
            menuLabel,
            addLabel,
            deleteLabel,
            hideTripSpecificActions,
            quickAddActionsOnly
        });
    };

    const handleExtendTripFromModal = (result: ExtendTripResult, modalContext: ExtendTripModalContext) => {
        const { schedules: nextSchedules, updatedTripId, blockConflict } = applyExtendTripResultToSchedules(schedules, modalContext, result);

        if (blockConflict) {
            showSuccessToast(`Cannot extend trip: block ${blockConflict.blockId} already has overlapping work on ${blockConflict.routeName}.`);
            return;
        }

        const found = nextSchedules.flatMap(table => table.trips).find(trip => trip.id === updatedTripId) ?? null;
        onSchedulesChange(nextSchedules);
        const impact = summarizeScheduleEditImpact(schedules, nextSchedules);
        if (impact.changedTripCount > 0) setEditImpact(impact);
        setExtendTripModalContext(null);
        setSelectedTripId(updatedTripId);
        setSubView('editor');

        if (found) {
            const stopLabel = result.stopName;
            const directionLabel = found.direction.toLowerCase();
            logAction('edit', `Extended ${directionLabel}bound trip to ${stopLabel}`, {
                tripId: updatedTripId,
                blockId: found.blockId,
                field: result.mode === 'earlier' ? 'startStopIndex' : 'endStopIndex',
                newValue: stopLabel
            });
            showSuccessToast(`✓ Extended ${directionLabel}bound trip to ${stopLabel}`);
        }
    };

    const handleOpenExtendTripModal = (tripId: string) => {
        const extendContext = buildExtendTripModalContext(schedules, tripId);
        if (!extendContext) return;
        setExtendTripModalContext(extendContext);
    };

    // Timeline drag handler - updates trip times from timeline view
    const handleTimelineTripTimeChange = (tripId: string, newStartTime: number, newDuration: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;

        const { table, trip } = result;
        const oldStartTime = trip.startTime;
        const oldDuration = Math.max(0, trip.endTime - trip.startTime);
        const clampedDuration = Math.max(0, newDuration);
        const delta = newStartTime - oldStartTime;
        const durationDelta = clampedDuration - oldDuration;
        const originalBlockId = trip.blockId;
        const originalBlockTripIds = schedules
            .flatMap(schedule => schedule.trips)
            .filter(candidate => candidate.blockId === originalBlockId)
            .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))
            .map(candidate => candidate.id);

        // Shift all stop and arrival times by start delta.
        Object.keys(trip.stops).forEach(stop => {
            const t = TimeUtils.toMinutes(trip.stops[stop]);
            if (t !== null) {
                trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
            }
        });
        Object.keys(trip.arrivalTimes || {}).forEach(stop => {
            const t = TimeUtils.toMinutes(trip.arrivalTimes?.[stop]);
            if (t !== null && trip.arrivalTimes) {
                trip.arrivalTimes[stop] = TimeUtils.fromMinutes(t + delta);
            }
        });

        // Apply duration delta to the last timed stop so resize persists after recalc.
        if (durationDelta !== 0) {
            let lastStopWithTime: string | null = null;
            for (const stop of table.stops) {
                const stopTime = TimeUtils.toMinutes(trip.stops[stop]);
                if (stopTime !== null) lastStopWithTime = stop;
            }

            if (lastStopWithTime) {
                const lastStopTime = TimeUtils.toMinutes(trip.stops[lastStopWithTime]);
                if (lastStopTime !== null) {
                    trip.stops[lastStopWithTime] = TimeUtils.fromMinutes(lastStopTime + durationDelta);
                }

                const lastArrivalTime = TimeUtils.toMinutes(trip.arrivalTimes?.[lastStopWithTime]);
                if (lastArrivalTime !== null && trip.arrivalTimes) {
                    trip.arrivalTimes[lastStopWithTime] = TimeUtils.fromMinutes(lastArrivalTime + durationDelta);
                }
            }
        }

        // Update trip computed values
        trip.startTime = newStartTime;
        trip.endTime = newStartTime + clampedDuration;
        trip.travelTime = clampedDuration;

        // Recalculate derived values
        recalculateTrip(trip, table.stops);
        const endDelta = trip.endTime - (oldStartTime + oldDuration);
        const baseName = getTrueBaseRoute(table.routeName);
        const shouldCascadeFollowing = cascadeMode === 'always'
            || (isMergedRouteBase(baseName) && cascadeMode !== 'none');
        if (shouldCascadeFollowing && endDelta !== 0) {
            const currentIndex = originalBlockTripIds.indexOf(tripId);
            originalBlockTripIds.slice(currentIndex + 1).forEach(followingTripId => {
                const following = findTableAndTrip(newScheds, followingTripId);
                if (!following) return;
                const followingTrip = following.trip;
                Object.keys(followingTrip.stops).forEach(stop => {
                    const minute = TimeUtils.toMinutes(followingTrip.stops[stop]);
                    if (minute !== null) followingTrip.stops[stop] = TimeUtils.fromMinutes(minute + endDelta);
                });
                Object.keys(followingTrip.arrivalTimes || {}).forEach(stop => {
                    const minute = TimeUtils.toMinutes(followingTrip.arrivalTimes?.[stop]);
                    if (minute !== null && followingTrip.arrivalTimes) {
                        followingTrip.arrivalTimes[stop] = TimeUtils.fromMinutes(minute + endDelta);
                    }
                });
                Object.keys(followingTrip.stopMinutes || {}).forEach(stop => {
                    if (followingTrip.stopMinutes?.[stop] !== undefined) {
                        followingTrip.stopMinutes[stop] += endDelta;
                    }
                });
                followingTrip.startTime += endDelta;
                followingTrip.endTime += endDelta;
                recalculateTrip(followingTrip, following.table.stops);
                validateRouteTable(following.table);
            });
        }
        validateRouteTable(table);
        reassignBlocksForRelatedTables(newScheds, baseName);

        logAction('edit', `Timeline: Moved trip to ${TimeUtils.fromMinutes(newStartTime)}`, {
            tripId,
            blockId: trip.blockId,
            field: 'startTime',
            oldValue: TimeUtils.fromMinutes(oldStartTime),
            newValue: TimeUtils.fromMinutes(newStartTime)
        });

        onSchedulesChange(newScheds);
        const impact = summarizeScheduleEditImpact(schedules, newScheds);
        if (impact.changedTripCount > 0) setEditImpact(impact);
    };

    // Handle trip selection from timeline
    const handleTripSelect = (tripId: string) => {
        setSelectedTripId(tripId);
    };

    // NOTE: Travel time grid handlers moved to useTravelTimeGrid hook (see gridHandlers.* above)

    const sanitizeExportFileNamePart = (value: string): string => value
            .split('')
            .map(char => {
                const code = char.charCodeAt(0);
                return code <= 31 || /[<>:"/\\|?*]/.test(char) ? ' ' : char;
            })
            .join('')
            .replace(/\s+/g, ' ')
            .trim();

    const buildDraftExportFileName = (scope: ExportScope): string => {
        const sanitizedDraftName = sanitizeExportFileNamePart(draftName || 'Schedule Draft');
        if (scope === 'current-route') {
            const routeLabel = sanitizeExportFileNamePart(`Route ${activeRouteGroup?.name || 'Current Route'}`);
            const dayLabel = sanitizeExportFileNamePart(activeDay || 'Current Day');
            return `${sanitizedDraftName || 'Schedule Draft'} - ${routeLabel} - ${dayLabel}.xlsx`;
        }
        return `${sanitizedDraftName || 'Schedule Draft'}.xlsx`;
    };

    const handleExport = () => {
        setShowExportScopeModal(true);
    };

    const exportSchedules = async (scope: ExportScope) => {
        const tablesToExport = scope === 'current-route' ? activeRouteTables : exportableTables;
        if (tablesToExport.length === 0) {
            setShowExportScopeModal(false);
            return;
        }

        setShowExportScopeModal(false);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Barrie Transit Scheduler';
        workbook.created = new Date();

        // Helper: minutes to hours
        const toHours = (min: number) => (min / 60).toFixed(1);

        // Helper: convert hex color to ARGB
        const hexToArgb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

        // Helper: determine if text should be light or dark based on background
        const getContrastTextColor = (bgHex: string): string => {
            const hex = bgHex.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? 'FF1F2937' : 'FFFFFFFF';
        };

        // Annual multipliers
        const WEEKDAY_DAYS = 260; // 5 days × 52 weeks
        const SATURDAY_DAYS = 52;
        const SUNDAY_DAYS = 52;

        // Collect summary data
        const routeSummaries: { route: string; dayType: string; cycleHours: number }[] = [];

        // Common styles
        const headerAlignment: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };
        const cellAlignment: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };
        const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFE5E7EB' } };
        const allBorders: Partial<ExcelJS.Borders> = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

        // Create summary sheet FIRST so it appears first in workbook
        const summarySheet = workbook.addWorksheet('Service Hours Summary');

        const singleDirectionHeaderFill = 'FFE5E7EB';
        const recoveryHeaderFill = 'FFDBEAFE';
        const northHeaderFill = 'FFE0ECFF';
        const southHeaderFill = 'FFFCE7D6';
        const northRecoveryFill = 'FFD7E9FF';
        const southRecoveryFill = 'FFF9D9C0';

        type ExportColumnDef = {
            name: string;
            subheader: string;
            isRecovery: boolean;
            stopName?: string;
            side?: 'north' | 'south';
        };

        const getDirectionLabel = (baseName: string, tableDirection: 'North' | 'South' | null): string => {
            const routeConfig = getRouteConfig(baseName);
            const isNorth = tableDirection === 'North';
            const isSouth = tableDirection === 'South';
            let direction = isNorth ? 'NORTHBOUND' : isSouth ? 'SOUTHBOUND' : 'ALL TRIPS';

            if (routeConfig) {
                if (routeConfig.segments.length === 1) {
                    direction = `LOOP (${routeConfig.segments[0].name.toUpperCase()})`;
                } else if (routeConfig.segments.length === 2) {
                    const northSegment = routeConfig.segments.find(s => s.name === 'North');
                    const southSegment = routeConfig.segments.find(s => s.name === 'South');
                    if (isNorth && northSegment) {
                        direction = `${northSegment.variant} NORTHBOUND → ${northSegment.terminus}`;
                    } else if (isSouth && southSegment) {
                        direction = `${southSegment.variant} SOUTHBOUND → ${southSegment.terminus}`;
                    }
                }
            }

            return direction;
        };

        const applySummaryCard = (
            ws: ExcelJS.Worksheet,
            startColumn: number,
            routeColorArgb: string,
            routeColorHex: string,
            totalTrips: number,
            totalTravelTime: number,
            totalRecovery: number,
            totalCycleTime: number
        ) => {
            const recoveryRatio = totalTravelTime > 0 ? ((totalRecovery / totalTravelTime) * 100).toFixed(1) + '%' : '0%';
            const summaryStartRow = 2;

            ws.getCell(summaryStartRow, startColumn).value = 'DAY SUMMARY';
            ws.mergeCells(summaryStartRow, startColumn, summaryStartRow, startColumn + 1);
            ws.getCell(summaryStartRow, startColumn).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
            ws.getCell(summaryStartRow, startColumn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            ws.getCell(summaryStartRow, startColumn).alignment = headerAlignment;

            const summaryItems = [
                ['Total Trips', totalTrips],
                ['Total Travel', toHours(totalTravelTime) + ' hrs'],
                ['Total Recovery', toHours(totalRecovery) + ' hrs'],
                ['Total Cycle', toHours(totalCycleTime) + ' hrs'],
                ['Recovery Ratio', recoveryRatio]
            ];

            summaryItems.forEach((item, idx) => {
                const r = summaryStartRow + 1 + idx;
                ws.getCell(r, startColumn).value = item[0];
                ws.getCell(r, startColumn).font = { size: 10, color: { argb: 'FF6B7280' } };
                ws.getCell(r, startColumn).alignment = { horizontal: 'right', vertical: 'middle' };
                ws.getCell(r, startColumn + 1).value = item[1];
                ws.getCell(r, startColumn + 1).font = { bold: true, size: 10 };
                ws.getCell(r, startColumn + 1).alignment = cellAlignment;
                if (idx === 3) {
                    ws.getCell(r, startColumn + 1).font = { bold: true, size: 11, color: { argb: hexToArgb(routeColorHex) } };
                }
            });

            ws.getColumn(startColumn).width = 14;
            ws.getColumn(startColumn + 1).width = 10;
        };

        const addSingleDirectionSheet = (table: MasterRouteTable, baseName: string, dayType: string) => {
            const ws = workbook.addWorksheet(`${baseName} (${dayType})`.substring(0, 31));
            const tableDirection = extractDirectionFromName(table.routeName);
            const routeColor = getRouteColor(baseName);
            const routeTextColor = getContrastTextColor(routeColor);
            const routeColorArgb = hexToArgb(routeColor);

            const totalTrips = table.trips.length;
            const totalTravelTime = table.trips.reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecovery = table.trips.reduce((sum, t) => sum + t.recoveryTime, 0);
            const totalCycleTime = totalTravelTime + totalRecovery;
            routeSummaries.push({ route: baseName, dayType, cycleHours: totalCycleTime / 60 });

            const stopsWithRecovery = new Set<string>();
            table.trips.forEach(t => {
                if (t.recoveryTimes) {
                    Object.entries(t.recoveryTimes).forEach(([s, m]) => {
                        if (m != null) stopsWithRecovery.add(s);
                    });
                }
            });

            const columnDefs: ExportColumnDef[] = [{ name: 'Block', subheader: '', isRecovery: false }];
            table.stops.forEach((stop) => {
                if (stopsWithRecovery.has(stop)) {
                    columnDefs.push({ name: stop, subheader: 'ARR', isRecovery: false, stopName: stop });
                    columnDefs.push({ name: 'R', subheader: 'R', isRecovery: true, stopName: stop });
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop });
                } else {
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop });
                }
            });
            columnDefs.push({ name: 'Travel', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Recovery', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Cycle', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Ratio', subheader: '', isRecovery: false });

            const routeRow = ws.addRow([`ROUTE ${baseName} - ${dayType.toUpperCase()}`]);
            ws.mergeCells(1, 1, 1, columnDefs.length);
            routeRow.height = 28;
            routeRow.getCell(1).font = { bold: true, size: 16, color: { argb: routeTextColor } };
            routeRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            routeRow.getCell(1).alignment = headerAlignment;
            routeRow.getCell(1).border = allBorders;

            const dirRow = ws.addRow([getDirectionLabel(baseName, tableDirection)]);
            ws.mergeCells(2, 1, 2, columnDefs.length);
            dirRow.height = 22;
            dirRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF374151' } };
            dirRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            dirRow.getCell(1).alignment = headerAlignment;
            dirRow.getCell(1).border = allBorders;

            const headerRow = ws.addRow(columnDefs.map(c => c.name));
            headerRow.height = 20;
            headerRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columnDefs[colNumber - 1]?.isRecovery ? recoveryHeaderFill : singleDirectionHeaderFill } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
                if (columnDefs[colNumber - 1]?.isRecovery) {
                    cell.font = { bold: true, size: 10, color: { argb: 'FF1D4ED8' } };
                }
            });

            const subheaderRow = ws.addRow(columnDefs.map(c => c.subheader));
            subheaderRow.height = 16;
            subheaderRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columnDefs[colNumber - 1]?.isRecovery ? recoveryHeaderFill : 'FFF9FAFB' } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
                if (columnDefs[colNumber - 1]?.isRecovery) {
                    cell.font = { bold: true, size: 9, color: { argb: 'FF1D4ED8' } };
                }
            });

            table.trips.forEach((trip, tripIdx) => {
                const rowData: (string | number)[] = [trip.blockId];

                table.stops.forEach((stop) => {
                    const depTime = getTripStopValue(trip.stops, stop) || '';
                    const recovery = getTripStopValue(trip.recoveryTimes, stop) ?? 0;

                    if (stopsWithRecovery.has(stop)) {
                        let arrTime = getTripStopValue(trip.arrivalTimes, stop) || '';
                        if (!arrTime && depTime) {
                            const depMin = TimeUtils.toMinutes(depTime);
                            if (depMin !== null) {
                                arrTime = TimeUtils.fromMinutes(depMin - recovery);
                            }
                        }
                        rowData.push(arrTime);
                        rowData.push(recovery || '');
                        rowData.push(depTime);
                    } else {
                        rowData.push(depTime);
                    }
                });

                const ratio = trip.travelTime > 0 ? ((trip.recoveryTime / trip.travelTime) * 100).toFixed(0) + '%' : '-';
                rowData.push(trip.travelTime);
                rowData.push(trip.recoveryTime);
                rowData.push(trip.cycleTime);
                rowData.push(ratio);

                const row = ws.addRow(rowData);
                row.height = 18;
                row.eachCell((cell, colNumber) => {
                    cell.font = { size: 10 };
                    cell.alignment = cellAlignment;
                    cell.border = allBorders;
                    const bgColor = tripIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                    if (columnDefs[colNumber - 1]?.isRecovery) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
                        cell.font = { size: 10, color: { argb: 'FF1D4ED8' }, bold: true };
                    }
                });
            });

            columnDefs.forEach((col, idx) => {
                ws.getColumn(idx + 1).width = col.isRecovery ? 5 : col.name === 'Block' ? 10 : Math.max(col.name.length + 2, 10);
            });
            applySummaryCard(ws, columnDefs.length + 3, routeColorArgb, routeColor, totalTrips, totalTravelTime, totalRecovery, totalCycleTime);
        };

        const addMergedRouteSheet = (baseName: string, dayType: string, northTable: MasterRouteTable, southTable: MasterRouteTable) => {
            const ws = workbook.addWorksheet(`${baseName} (${dayType})`.substring(0, 31));
            const roundTrip = buildRoundTripView(northTable, southTable);
            const routeColor = getRouteColor(baseName);
            const routeTextColor = getContrastTextColor(routeColor);
            const routeColorArgb = hexToArgb(routeColor);

            const totalTrips = northTable.trips.length + southTable.trips.length;
            const totalTravelTime = [...northTable.trips, ...southTable.trips].reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecovery = [...northTable.trips, ...southTable.trips].reduce((sum, t) => sum + t.recoveryTime, 0);
            const totalCycleTime = totalTravelTime + totalRecovery;
            routeSummaries.push({ route: baseName, dayType, cycleHours: totalCycleTime / 60 });

            const northStopsWithRecovery = new Set<string>();
            northTable.trips.forEach(trip => {
                if (trip.recoveryTimes) {
                    Object.entries(trip.recoveryTimes).forEach(([stopName, minutes]) => {
                        if (minutes != null) northStopsWithRecovery.add(stopName);
                    });
                }
            });
            const southStopsWithRecovery = new Set<string>();
            southTable.trips.forEach(trip => {
                if (trip.recoveryTimes) {
                    Object.entries(trip.recoveryTimes).forEach(([stopName, minutes]) => {
                        if (minutes != null) southStopsWithRecovery.add(stopName);
                    });
                }
            });

            const columnDefs: ExportColumnDef[] = [{ name: 'Block', subheader: '', isRecovery: false }];
            roundTrip.northStops.forEach((stop) => {
                if (northStopsWithRecovery.has(stop)) {
                    columnDefs.push({ name: stop, subheader: 'ARR', isRecovery: false, stopName: stop, side: 'north' });
                    columnDefs.push({ name: 'R', subheader: 'R', isRecovery: true, stopName: stop, side: 'north' });
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop, side: 'north' });
                } else {
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop, side: 'north' });
                }
            });
            roundTrip.southStops.forEach((stop) => {
                if (southStopsWithRecovery.has(stop)) {
                    columnDefs.push({ name: stop, subheader: 'ARR', isRecovery: false, stopName: stop, side: 'south' });
                    columnDefs.push({ name: 'R', subheader: 'R', isRecovery: true, stopName: stop, side: 'south' });
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop, side: 'south' });
                } else {
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop, side: 'south' });
                }
            });
            columnDefs.push({ name: 'Travel', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Recovery', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Cycle', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Ratio', subheader: '', isRecovery: false });

            const routeRow = ws.addRow([`ROUTE ${baseName} - ${dayType.toUpperCase()}`]);
            ws.mergeCells(1, 1, 1, columnDefs.length);
            routeRow.height = 28;
            routeRow.getCell(1).font = { bold: true, size: 16, color: { argb: routeTextColor } };
            routeRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            routeRow.getCell(1).alignment = headerAlignment;
            routeRow.getCell(1).border = allBorders;

            const dirRow = ws.addRow(['Merged round-trip view (North / South paired like the schedule editor)']);
            ws.mergeCells(2, 1, 2, columnDefs.length);
            dirRow.height = 22;
            dirRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF374151' } };
            dirRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            dirRow.getCell(1).alignment = headerAlignment;
            dirRow.getCell(1).border = allBorders;

            const headerRow = ws.addRow(columnDefs.map(c => c.name));
            headerRow.height = 20;
            headerRow.eachCell((cell, colNumber) => {
                const col = columnDefs[colNumber - 1];
                const fillColor = col.isRecovery
                    ? (col.side === 'south' ? southRecoveryFill : northRecoveryFill)
                    : col.side === 'north'
                        ? northHeaderFill
                        : col.side === 'south'
                            ? southHeaderFill
                            : singleDirectionHeaderFill;
                const fontColor = col.isRecovery
                    ? (col.side === 'south' ? 'FFB45309' : 'FF1D4ED8')
                    : col.side === 'north'
                        ? 'FF1D4ED8'
                        : col.side === 'south'
                            ? 'FFC2410C'
                            : 'FF1F2937';
                cell.font = { bold: true, size: 10, color: { argb: fontColor } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
            });

            const subheaderRow = ws.addRow(columnDefs.map(c => c.subheader));
            subheaderRow.height = 16;
            subheaderRow.eachCell((cell, colNumber) => {
                const col = columnDefs[colNumber - 1];
                const fillColor = col.isRecovery
                    ? (col.side === 'south' ? southRecoveryFill : northRecoveryFill)
                    : col.side === 'north'
                        ? 'FFF5F9FF'
                        : col.side === 'south'
                            ? 'FFFFF7ED'
                            : 'FFF9FAFB';
                const fontColor = col.isRecovery
                    ? (col.side === 'south' ? 'FFB45309' : 'FF1D4ED8')
                    : 'FF6B7280';
                cell.font = { bold: true, size: 9, color: { argb: fontColor } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
            });

            roundTrip.rows.forEach((roundTripRow, rowIndex) => {
                const northTrip = roundTripRow.trips.find(trip => trip.direction === 'North');
                const southTrip = roundTripRow.trips.find(trip => trip.direction === 'South');
                const rowData: (string | number)[] = [roundTripRow.blockId];

                const appendTripColumns = (
                    trip: MasterTrip | undefined,
                    stops: string[],
                    stopsWithRecovery: Set<string>
                ) => {
                    stops.forEach((stop) => {
                        const depTime = trip ? (getTripStopValue(trip.stops, stop) || '') : '';
                        const recovery = trip ? (getTripStopValue(trip.recoveryTimes, stop) ?? 0) : 0;
                        if (stopsWithRecovery.has(stop)) {
                            let arrTime = trip ? (getTripStopValue(trip.arrivalTimes, stop) || '') : '';
                            if (!arrTime && depTime) {
                                const depMin = TimeUtils.toMinutes(depTime);
                                if (depMin !== null) {
                                    arrTime = TimeUtils.fromMinutes(depMin - recovery);
                                }
                            }
                            rowData.push(arrTime);
                            rowData.push(trip ? (recovery || '') : '');
                            rowData.push(depTime);
                        } else {
                            rowData.push(depTime);
                        }
                    });
                };

                appendTripColumns(northTrip, roundTrip.northStops, northStopsWithRecovery);
                appendTripColumns(southTrip, roundTrip.southStops, southStopsWithRecovery);

                const ratio = roundTripRow.totalTravelTime > 0
                    ? ((roundTripRow.totalRecoveryTime / roundTripRow.totalTravelTime) * 100).toFixed(0) + '%'
                    : '-';
                rowData.push(roundTripRow.totalTravelTime);
                rowData.push(roundTripRow.totalRecoveryTime);
                rowData.push(roundTripRow.totalCycleTime);
                rowData.push(ratio);

                const row = ws.addRow(rowData);
                row.height = 18;
                row.eachCell((cell, colNumber) => {
                    const col = columnDefs[colNumber - 1];
                    cell.font = { size: 10 };
                    cell.alignment = cellAlignment;
                    cell.border = allBorders;
                    const baseFill = rowIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                    let fillColor = baseFill;
                    if (col?.isRecovery) {
                        fillColor = col.side === 'south' ? 'FFFFF1E8' : 'FFEFF6FF';
                    }
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                    if (col?.isRecovery) {
                        cell.font = { size: 10, color: { argb: col.side === 'south' ? 'FFB45309' : 'FF1D4ED8' }, bold: true };
                    }
                });
            });

            columnDefs.forEach((col, idx) => {
                ws.getColumn(idx + 1).width = col.isRecovery ? 5 : col.name === 'Block' ? 10 : Math.max(col.name.length + 2, 10);
            });
            applySummaryCard(ws, columnDefs.length + 3, routeColorArgb, routeColor, totalTrips, totalTravelTime, totalRecovery, totalCycleTime);
        };

        const exportRouteGroups = consolidateRoutes(tablesToExport);
        exportRouteGroups.forEach((group) => {
            Object.entries(group.days)
                .sort(([dayA], [dayB]) => ['Weekday', 'Saturday', 'Sunday'].indexOf(dayA) - ['Weekday', 'Saturday', 'Sunday'].indexOf(dayB))
                .forEach(([dayType, dayGroup]) => {
                    if (dayGroup.north && dayGroup.south) {
                        addMergedRouteSheet(group.name, dayType, dayGroup.north, dayGroup.south);
                    } else {
                        const table = dayGroup.north || dayGroup.south;
                        if (table) {
                            addSingleDirectionSheet(table, group.name, dayType);
                        }
                    }
                });
        });

        // ========================================
        // Populate Service Hours Summary Sheet
        // ========================================
        const routes = [...new Set(routeSummaries.map(r => r.route))].sort();

        // Title row
        const titleRow = summarySheet.addRow(['SERVICE HOURS SUMMARY']);
        summarySheet.mergeCells(1, 1, 1, 10);
        titleRow.height = 32;
        titleRow.getCell(1).font = { bold: true, size: 18, color: { argb: 'FF1F2937' } };
        titleRow.getCell(1).alignment = headerAlignment;

        // Subtitle
        const subtitleRow = summarySheet.addRow(['Annual metrics based on: Weekday × 260 days | Saturday × 52 days | Sunday × 52 days']);
        summarySheet.mergeCells(2, 1, 2, 10);
        subtitleRow.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
        subtitleRow.getCell(1).alignment = headerAlignment;

        // Empty row
        summarySheet.addRow([]);

        // Daily Hours section header
        const dailyHeader = summarySheet.addRow(['', 'DAILY SERVICE HOURS', '', '', '', 'ANNUAL SERVICE HOURS']);
        dailyHeader.height = 24;
        summarySheet.mergeCells(4, 2, 4, 5);
        summarySheet.mergeCells(4, 6, 4, 9);
        dailyHeader.getCell(2).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        dailyHeader.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        dailyHeader.getCell(2).alignment = headerAlignment;
        dailyHeader.getCell(6).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        dailyHeader.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
        dailyHeader.getCell(6).alignment = headerAlignment;

        // Column headers
        const colHeader = summarySheet.addRow(['Route', 'Weekday', 'Saturday', 'Sunday', 'Total', 'Weekday', 'Saturday', 'Sunday', 'Total']);
        colHeader.height = 22;
        colHeader.eachCell((cell, col) => {
            if (col === 1) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            } else if (col <= 5) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            } else {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
            }
            cell.font = { bold: true, size: 10 };
            cell.alignment = headerAlignment;
            cell.border = allBorders;
        });

        let totalWeekday = 0, totalSaturday = 0, totalSunday = 0;

        routes.forEach((route, idx) => {
            const weekday = routeSummaries.filter(r => r.route === route && r.dayType === 'Weekday').reduce((sum, r) => sum + r.cycleHours, 0);
            const saturday = routeSummaries.filter(r => r.route === route && r.dayType === 'Saturday').reduce((sum, r) => sum + r.cycleHours, 0);
            const sunday = routeSummaries.filter(r => r.route === route && r.dayType === 'Sunday').reduce((sum, r) => sum + r.cycleHours, 0);
            const dailyTotal = weekday + saturday + sunday;

            const annualWeekday = weekday * WEEKDAY_DAYS;
            const annualSaturday = saturday * SATURDAY_DAYS;
            const annualSunday = sunday * SUNDAY_DAYS;
            const annualTotal = annualWeekday + annualSaturday + annualSunday;

            totalWeekday += weekday;
            totalSaturday += saturday;
            totalSunday += sunday;

            // Get route color
            const routeColor = getRouteColor(route);
            const routeColorArgb = hexToArgb(routeColor);
            const routeTextColor = getContrastTextColor(routeColor);

            const row = summarySheet.addRow([
                route,
                weekday.toFixed(1),
                saturday.toFixed(1),
                sunday.toFixed(1),
                dailyTotal.toFixed(1),
                annualWeekday.toFixed(0),
                annualSaturday.toFixed(0),
                annualSunday.toFixed(0),
                annualTotal.toFixed(0)
            ]);
            row.height = 20;
            row.eachCell((cell, col) => {
                cell.alignment = col === 1 ? { horizontal: 'left', vertical: 'middle' } : cellAlignment;
                cell.border = allBorders;
                cell.font = { size: 10 };
                const bgColor = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                if (col === 1) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
                    cell.font = { bold: true, size: 10, color: { argb: routeTextColor } };
                }
                if (col === 5 || col === 9) {
                    cell.font = { bold: true, size: 10 };
                }
            });
        });

        // Total row
        const grandTotal = totalWeekday + totalSaturday + totalSunday;
        const annualGrandTotal = (totalWeekday * WEEKDAY_DAYS) + (totalSaturday * SATURDAY_DAYS) + (totalSunday * SUNDAY_DAYS);

        const totalRow = summarySheet.addRow([
            'TOTAL',
            totalWeekday.toFixed(1),
            totalSaturday.toFixed(1),
            totalSunday.toFixed(1),
            grandTotal.toFixed(1),
            (totalWeekday * WEEKDAY_DAYS).toFixed(0),
            (totalSaturday * SATURDAY_DAYS).toFixed(0),
            (totalSunday * SUNDAY_DAYS).toFixed(0),
            annualGrandTotal.toFixed(0)
        ]);
        totalRow.height = 24;
        totalRow.eachCell((cell) => {
            cell.font = { bold: true, size: 11 };
            cell.alignment = cellAlignment;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
            cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
            cell.border = allBorders;
        });

        // Column widths
        summarySheet.getColumn(1).width = 12;
        [2, 3, 4, 5].forEach(c => summarySheet.getColumn(c).width = 11);
        [6, 7, 8, 9].forEach(c => summarySheet.getColumn(c).width = 11);

        // Write file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = buildDraftExportFileName(scope);
        link.click();
    };

    // Active Data
    const activeRouteGroup = consolidatedRoutes[activeRouteIdx];
    const activeRoute = activeRouteGroup?.days[activeDay] || activeRouteGroup?.days[Object.keys(activeRouteGroup?.days || {})[0]];
    const activeRouteIdentity = activeRouteGroup ? `${activeRouteGroup.name}-${activeDay}` : null;

    useEffect(() => {
        if (!teamId || !activeRouteIdentity) {
            setActiveRouteConnectionConfig(null);
            return;
        }

        let cancelled = false;
        setActiveRouteConnectionConfig({
            routeIdentity: activeRouteIdentity,
            connections: [],
            optimizationMode: 'hybrid'
        });

        getRouteConnectionConfig(teamId, activeRouteIdentity)
            .then((config) => {
                if (cancelled) return;
                setActiveRouteConnectionConfig(config || {
                    routeIdentity: activeRouteIdentity,
                    connections: [],
                    optimizationMode: 'hybrid'
                });
            })
            .catch((error) => {
                console.error('Failed to load route connection config:', error);
                if (cancelled) return;
                setActiveRouteConnectionConfig({
                    routeIdentity: activeRouteIdentity,
                    connections: [],
                    optimizationMode: 'hybrid'
                });
            });

        return () => {
            cancelled = true;
        };
    }, [teamId, activeRouteIdentity]);

    const summaryTable = useMemo(() => {
        if (!activeRoute) return { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
        if (activeRoute.combined) return { routeName: activeRouteGroup.name, trips: [...(activeRoute.north?.trips || []), ...(activeRoute.south?.trips || [])], stops: [], stopIds: {} };
        return activeRoute.north || activeRoute.south || { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
    }, [activeRoute, activeRouteGroup?.name]);
    const activeRouteTables = useMemo(() => (
        [activeRoute?.north, activeRoute?.south].filter((table): table is MasterRouteTable => !!table)
    ), [activeRoute?.north, activeRoute?.south]);
    const activeRouteMasterBaseline = useMemo(() => (
        (masterBaseline || []).filter(table => tableMatchesActiveCompareScope(table, activeRouteTables))
    ), [activeRouteTables, masterBaseline]);
    const activeRouteExportChangeSummary = useMemo(() => {
        if (activeRouteTables.length === 0 || activeRouteMasterBaseline.length === 0) return null;
        const detailed = buildDetailedMasterComparison(activeRouteTables, activeRouteMasterBaseline);
        return buildMasterComparisonChangeSummary(activeRouteTables, detailed);
    }, [activeRouteMasterBaseline, activeRouteTables]);
    const fullExportChangeSummary = useMemo(() => {
        if (exportableTables.length === 0 || !masterBaseline || masterBaseline.length === 0) return null;
        const detailed = buildDetailedMasterComparison(exportableTables, masterBaseline);
        return buildMasterComparisonChangeSummary(exportableTables, detailed);
    }, [exportableTables, masterBaseline]);
    const aiReviewSnapshot = useMemo(() => {
        if (!activeRouteGroup || !activeRoute || activeRouteTables.length === 0) return null;
        return buildScheduleReviewSnapshot({
            draftName,
            routeGroupName: activeRouteGroup.name,
            dayType: activeDay as DayType,
            routeIdentity: `${activeRouteGroup.name}-${activeDay}`,
            routeTables: activeRouteTables,
            targetHeadwayMinutes: targetHeadway,
            targetCycleMinutes: targetCycleTime,
            masterBaseline: activeRouteMasterBaseline,
        });
    }, [
        activeDay,
        activeRoute,
        activeRouteGroup,
        activeRouteMasterBaseline,
        activeRouteTables,
        draftName,
        targetCycleTime,
        targetHeadway,
    ]);

    if (!activeRouteGroup || !activeRoute) return <div className="p-8 text-center text-gray-600">No Routes Loaded</div>;

    const handleOpenTimetable = () => {
        openTimetablePublisher({
            routeNumber: activeRouteGroup.name,
            dayType: activeDay as DayType,
        });
    };

    const compactEditorTools = compactStep4 ? (
        <div className="space-y-3">
            <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500">Draft actions</div>
                <div className="mt-2 grid gap-1.5">
                    {onSaveVersion && (
                        <button
                            type="button"
                            onClick={() => { void onSaveVersion(); }}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Save now
                        </button>
                    )}
                    {onOpenDrafts && (
                        <button
                            type="button"
                            onClick={onOpenDrafts}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Drafts
                        </button>
                    )}
                    {onNewDraft && (
                        <button
                            type="button"
                            onClick={onNewDraft}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            New draft
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleExport}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        Export Draft
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenTimetable}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-left text-sm font-semibold text-amber-800 hover:bg-amber-100"
                    >
                        Timetable
                    </button>
                </div>
            </div>

            <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500">Utilities</div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {undo && (
                        <button
                            type="button"
                            onClick={undo}
                            disabled={!canUndo}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Undo
                        </button>
                    )}
                    {redo && (
                        <button
                            type="button"
                            onClick={redo}
                            disabled={!canRedo}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Redo
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsFullScreen(!isFullScreen)}
                        className="col-span-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        {isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    const combinedReviewToolsSlot = compactStep4 ? (
        <div className="space-y-3">
            {reviewToolsSlot}
            {compactEditorTools}
        </div>
    ) : reviewToolsSlot;

    return (
        <>
            {addTripModalContext && (
                <AddTripModal
                    context={addTripModalContext}
                    onCancel={closeAddTripModal}
                    onConfirm={handleAddTripFromModal}
                />
            )}

            {extendTripModalContext && (
                <ExtendTripModal
                    context={extendTripModalContext}
                    onCancel={() => setExtendTripModalContext(null)}
                    onConfirm={handleExtendTripFromModal}
                />
            )}

            {/* Trip Context Menu (right-click) */}
            {contextMenu && (
                <TripContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    tripId={contextMenu.tripId}
                    tripDirection={contextMenu.tripDirection}
                    blockId={contextMenu.blockId}
                    currentStopName={contextMenu.stopName}
                    currentStopIndex={contextMenu.stopIndex}
                    stops={contextMenu.stops}
                    beforeTripId={contextMenu.beforeTripId}
                    afterTripId={contextMenu.afterTripId}
                    rowTripIds={contextMenu.rowTripIds}
                    tripOptions={contextMenu.tripOptions}
                    menuLabel={contextMenu.menuLabel}
                    addLabel={contextMenu.addLabel}
                    deleteLabel={contextMenu.deleteLabel}
                    hideTripSpecificActions={contextMenu.hideTripSpecificActions}
                    quickAddActionsOnly={contextMenu.quickAddActionsOnly}
                    onAction={handleContextMenuAction}
                    onClose={() => setContextMenu(null)}
                />
            )}

            <Modal
                isOpen={showExportScopeModal}
                onClose={() => setShowExportScopeModal(false)}
                size="sm"
            >
                <Modal.Header>Export draft</Modal.Header>
                <Modal.Body className="space-y-3">
                    <p className="text-sm text-gray-600">
                        Choose whether to export just the current route or the entire draft.
                    </p>
                    {(activeRouteExportChangeSummary || fullExportChangeSummary) && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-700">Change summary</div>
                            <div className="mt-2 space-y-1 text-xs text-slate-700">
                                {activeRouteExportChangeSummary && (
                                    <div>
                                        <span className="font-semibold text-slate-900">Current route:</span>{' '}
                                        {activeRouteExportChangeSummary.counts.totalChanges > 0
                                            ? formatChangeSummary(activeRouteExportChangeSummary.counts)
                                            : 'No detected changes from baseline'}
                                    </div>
                                )}
                                {fullExportChangeSummary && (
                                    <div>
                                        <span className="font-semibold text-slate-900">All routes:</span>{' '}
                                        {fullExportChangeSummary.counts.totalChanges > 0
                                            ? formatChangeSummary(fullExportChangeSummary.counts)
                                            : 'No detected changes from baseline'}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => { void exportSchedules('current-route'); }}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-100"
                    >
                        <div className="text-sm font-semibold text-blue-900">Current route</div>
                        <div className="mt-1 text-xs text-blue-700">
                            Export Route {activeRouteGroup.name} · {activeDay}
                        </div>
                        {activeRouteExportChangeSummary && activeRouteExportChangeSummary.counts.totalChanges > 0 && (
                            <div className="mt-2 text-[11px] font-medium text-blue-800">
                                {formatChangeSummary(activeRouteExportChangeSummary.counts)}
                            </div>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => { void exportSchedules('all-routes'); }}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-gray-300 hover:bg-gray-50"
                    >
                        <div className="text-sm font-semibold text-gray-900">All routes in system draft</div>
                        <div className="mt-1 text-xs text-gray-600">
                            Export {exportableRouteCount} route{exportableRouteCount === 1 ? '' : 's'} across the full loaded system draft
                        </div>
                        {fullExportChangeSummary && fullExportChangeSummary.counts.totalChanges > 0 && (
                            <div className="mt-2 text-[11px] font-medium text-gray-700">
                                {formatChangeSummary(fullExportChangeSummary.counts)}
                            </div>
                        )}
                    </button>
                </Modal.Body>
                <Modal.Footer>
                    <button
                        type="button"
                        onClick={() => setShowExportScopeModal(false)}
                        className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                </Modal.Footer>
            </Modal>

            <div className={`h-full flex flex-col bg-gray-50 overflow-hidden ${isFullScreen ? 'fixed inset-0 z-[9999] bg-white' : ''}`}>
                {/* WorkspaceHeader - hidden in embedded mode */}
                {!embedded && (
                    <WorkspaceHeader
                        routeGroupName={activeRouteGroup.name}
                        dayLabel={activeDay}
                        isRoundTrip={!!activeRoute.combined}
                        subView={subView}
                        onViewChange={setSubView}
                        onSaveVersion={readOnly ? undefined : onSaveVersion}
                        autoSaveStatus={readOnly ? undefined : autoSaveStatus}
                        lastSaved={readOnly ? undefined : lastSaved}
                        hasUnsavedChanges={effectiveHasUnsavedChanges}
                        summaryTable={summaryTable}
                        draftName={readOnly ? 'Master Schedule' : draftName}
                        onRenameDraft={readOnly ? undefined : onRenameDraft}
                        onOpenDrafts={readOnly ? undefined : onOpenDrafts}
                        onNewDraft={readOnly ? undefined : onNewDraft}
                        onDuplicateDraft={readOnly ? undefined : onDuplicateDraft}
                        onClose={onClose}
                        onExport={handleExport}
                        isFullScreen={isFullScreen}
                        onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                        bands={bands}
                        canUndo={readOnly ? false : canUndo}
                        canRedo={readOnly ? false : canRedo}
                        onUndo={readOnly ? undefined : undo}
                        onRedo={readOnly ? undefined : redo}
                        hideAutoSave={readOnly || hideAutoSave}
                        onPublish={readOnly ? undefined : onPublish}
                        publishLabel={publishLabel}
                        isPublishing={isPublishing}
                        publishDisabled={publishDisabled}
                        sourceLabel={sourceLabel}
                        changeCount={changeCount}
                        warningCount={warningCount}
                        onReviewChanges={onReviewChanges}
                        reviewChangesDisabled={reviewChangesDisabled}
                        onOpenConnections={teamId && userId && !readOnly ? () => {
                            setShowAiReviewPanel(false);
                            setShowConnectionsPanel(true);
                        } : undefined}
                        onOpenAiReview={aiReviewEnabled && !readOnly && aiReviewSnapshot ? () => {
                            setShowConnectionsPanel(false);
                            setShowAiReviewPanel(true);
                        } : undefined}
                        onOpenTimetable={handleOpenTimetable}
                        compactTools={compactStep4}
                    />
                )}

                {!readOnly && editImpact && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-900">
                        <span className="font-semibold">{formatScheduleEditImpact(editImpact)}</span>
                        <div className="flex items-center gap-3">
                            {undo && canUndo && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        undo();
                                        setEditImpact(null);
                                    }}
                                    className="font-bold text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                >
                                    Undo
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setEditImpact(null)}
                                className="text-blue-700 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                aria-label="Dismiss edit impact"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                )}

                {!readOnly && editNotice && (
                    <div role="status" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                        <span className="font-medium">{editNotice}</span>
                        <button
                            type="button"
                            onClick={() => setEditNotice(null)}
                            className="font-semibold text-amber-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                <div className="flex-grow flex flex-col lg:flex-row overflow-hidden">
                    {/* Sidebar - hidden in embedded mode or when hideSidebar is true */}
                    {!isFullScreen && !embedded && !hideSidebar && !(compactStep4 && consolidatedRoutes.length <= 1) && (
                        <div className="w-full lg:w-72 lg:min-w-[280px] lg:max-w-[320px] flex-shrink-0 bg-[#F7F7F7] border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col overflow-hidden z-20">
                            {/* Header */}
                            <div className="p-4 border-b border-gray-200 bg-white flex justify-between items-center">
                                <div>
                                    <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-800">{readOnly ? 'Master Schedule' : 'Route Editor'}</h2>
                                    <div className="mt-1 text-xs font-medium text-gray-500">
                                        {consolidatedRoutes.length} route{consolidatedRoutes.length === 1 ? '' : 's'} loaded
                                    </div>
                                </div>
                                {onClose && <button onClick={onClose} className="text-sm font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded-lg px-2 py-1 hover:bg-blue-50"><ArrowLeft size={12} /> Back</button>}
                            </div>

                            {/* Route List */}
                            <div className="overflow-y-auto custom-scrollbar flex-grow p-3 space-y-2">
                                {consolidatedRoutes.map((route, i) => (
                                    <div key={route.name} className="space-y-1">
                                        <button
                                            onClick={() => setActiveRouteIdx(i)}
                                            className={`w-full text-left px-3 py-2.5 rounded-2xl text-sm font-extrabold flex justify-between items-center border transition-all ${i === activeRouteIdx ? 'shadow-sm ring-2 ring-offset-1 ring-offset-[#F7F7F7]' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50/40'}`}
                                            style={i === activeRouteIdx ? { backgroundColor: getRouteColor(route.name), color: getRouteTextColor(route.name), borderColor: getRouteColor(route.name) } : undefined}
                                        >
                                            <span>Route {route.name}</span>
                                            {i === activeRouteIdx ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </button>

                                        {i === activeRouteIdx && (
                                            <div className="ml-2 border-l-2 border-gray-200 pl-2 space-y-1">
                                                {['Weekday', 'Saturday', 'Sunday'].filter(d => Object.keys(route.days).includes(d)).map(day => (
                                                    <div key={day} className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => setActiveDay(day)}
                                                            className={`flex-1 text-left px-3 py-1.5 rounded-xl text-sm flex items-center gap-2 border ${activeDay === day ? 'bg-blue-50 border-blue-200 font-extrabold text-blue-800 shadow-sm' : 'border-transparent text-gray-700 hover:bg-white hover:border-gray-200'}`}
                                                        >
                                                            <div className={`w-1.5 h-1.5 rounded-full ${activeDay === day ? 'bg-blue-600 ring-2 ring-blue-100' : 'bg-gray-300'}`} />
                                                            {day}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Footer Actions - hidden in readOnly mode */}
                            {!readOnly && (
                                <div className="border-t border-gray-100">
                                </div>
                            )}
                        </div>
                    )}

                    {/* Editor Content */}
                    <div className={`flex-grow min-w-0 overflow-auto flex flex-col bg-[#F7F7F7] px-2 pb-2 md:px-4 md:pb-4 ${subView === 'editor' ? 'pt-0' : 'pt-2 md:pt-4'}`}>
                        {subView === 'matrix' ? (
                            <TravelTimeGrid
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onBulkAdjust={gridHandlers.handleBulkAdjustTravelTime}
                                onRecoveryAdjust={gridHandlers.handleBulkAdjustRecoveryTime}
                                onSingleTripAdjust={gridHandlers.handleSingleTripTravelAdjust}
                                onSingleRecoveryAdjust={gridHandlers.handleSingleRecoveryAdjust}
                                originalSchedules={originalSchedules?.filter(table => (
                                    table.routeName === activeRoute.north?.routeName ||
                                    table.routeName === activeRoute.south?.routeName
                                ))}
                                onResetOriginals={onResetOriginals}
                                bands={bands}
                                analysis={analysis}
                                segmentNames={segmentNames}
                            />
                        ) : subView === 'timeline' ? (
                            <TimelineView
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onTripTimeChange={handleTimelineTripTimeChange}
                                onTripSelect={handleTripSelect}
                                selectedTripId={selectedTripId}
                                editScopeLabel={cascadeMode === 'always' || (isMergedRouteBase(activeRouteGroup.name) && cascadeMode !== 'none')
                                    ? 'Timeline edits shift following trips in this block'
                                    : 'Timeline edits affect the selected trip only'}
                            />
                        ) : (
                            <>
                                <RoundTripTableView
                                    schedules={activeRouteTables}
                                    useAuthoritativeTimepoints={useAuthoritativeTimepoints}
                                    initialTimepointOnly={initialTimepointOnly}
                                    condensedTimepointView={condensedTimepointView}
                                    onCellEdit={readOnly ? undefined : handleCellEdit}
                                    onTimeAdjust={readOnly ? undefined : handleTimeAdjust}
                                    onRecoveryEdit={readOnly ? undefined : handleRecoveryEdit}
                                    originalSchedules={originalSchedules?.filter(table => (
                                        table.routeName === activeRoute.north?.routeName ||
                                        table.routeName === activeRoute.south?.routeName
                                    ))}
                                    initialShowDeltas={initialShowDeltas}
                                    onResetOriginals={onResetOriginals}
                                    onDeleteTrip={readOnly ? undefined : handleDeleteTrips}
                                    onDuplicateTrip={readOnly ? undefined : handleDuplicateTrip}
                                    onAddTrip={readOnly ? undefined : (tripId, placement) => openAddTripModal(tripId, { north: activeRoute.north, south: activeRoute.south }, placement)}
                                    onExtendTrip={readOnly ? undefined : handleOpenExtendTripModal}
                                    onTripRightClick={readOnly ? undefined : handleTripRightClick}
                                    onMenuOpen={readOnly ? undefined : handleMenuOpen}
                                    draftName={draftName}
                                    filter={filter}
                                    targetCycleTime={targetCycleTime}
                                    targetHeadway={targetHeadway}
                                    readOnly={readOnly}
                                    connectionLibrary={connectionLibrary}
                                    routeConnectionConfig={activeRouteConnectionConfig}
                                    dayType={activeDay as DayType}
                                    masterBaseline={activeRouteMasterBaseline}
                                    compareBaselineLabel={compareBaselineLabel}
                                    highlightedTripId={highlightedTripId || recentlyAddedTripId}
                                    visibleTripIds={visibleTripIds}
                                    toolbarSlot={!readOnly ? (
                                        <CascadeModeSelector
                                            mode={cascadeMode}
                                            onChange={setCascadeMode}
                                            allowedModes={['always', 'within-trip', 'none']}
                                        />
                                    ) : undefined}
                                    toolbarMode={compactStep4 ? 'sidebar' : 'inline'}
                                    reviewToolsSlot={combinedReviewToolsSlot}
                                    onInputError={setEditNotice}
                                />
                            </>
                        )}
                    </div>

                    {/* Connections Panel (right sidebar) */}
                    {showConnectionsPanel && teamId && userId && activeRouteGroup && (
                        <ConnectionsPanel
                            schedules={connectionScopeSchedules || schedules}
                            routeIdentity={`${activeRouteGroup.name}-${activeDay}`}
                            dayType={activeDay as 'Weekday' | 'Saturday' | 'Sunday'}
                            teamId={teamId}
                            userId={userId}
                            onLibraryChanged={setConnectionLibrary}
                            onRouteConfigChanged={setActiveRouteConnectionConfig}
                            onClose={() => setShowConnectionsPanel(false)}
                        />
                    )}

                    {showAiReviewPanel && aiReviewSnapshot && (
                        <AIReviewPanel
                            snapshot={aiReviewSnapshot}
                            onClose={() => setShowAiReviewPanel(false)}
                        />
                    )}
                </div>
            </div>

            {/* Audit Log Panel */}
            <AuditLogPanel
                entries={auditEntries}
                isOpen={showAuditLog}
                onToggle={() => setShowAuditLog(!showAuditLog)}
            />

        </>
    );
};
