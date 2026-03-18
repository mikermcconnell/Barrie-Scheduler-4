import React, { useState, useMemo, useEffect } from 'react';
import {
    Bus,
    TrendingUp,
    Plus,
    FileSpreadsheet,
    Download,
    Trash2,
    Copy,
    Zap,
    CheckCircle2,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ArrowRight,
    ArrowLeft,
    Loader2,
    AlertCircle,
    Sparkles,
    XCircle,
    BarChart2,
    Settings2,
    CalendarPlus,
    Timer,
    MousePointerClick,
    FileText,
    Save,
    Cloud,
    CloudOff,
    History,
    Maximize2,
    Minimize2,
    Minus,
    Clock,
    AlertTriangle,
    Car,
    MoreVertical,
    Pencil,
    Upload,
    Database
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
    MasterRouteTable,
    MasterTrip,
    validateRouteTable,
    RoundTripTable,
    buildRoundTripView
} from '../utils/parsers/masterScheduleParser';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import type { ConnectionLibrary } from '../utils/connections/connectionTypes';
import { getConnectionLibrary } from '../utils/connections/connectionLibraryService';
import { RouteSummary } from './RouteSummary';
import { WorkspaceHeader } from './layout/WorkspaceHeader';
import { AutoSaveStatus } from '../hooks/useAutoSave';
import { TimeUtils } from '../utils/timeUtils';
import { getRouteColor, getRouteTextColor } from '../utils/config/routeColors';
import { AddTripModal, AddTripModalContext } from './modals/AddTripModal';
import { useAddTrip } from '../hooks/useAddTrip';
import { TravelTimeGrid } from './TravelTimeGrid';
import { AuditLogPanel, useAuditLog } from './AuditLogPanel';
import { TripContextMenu, TripContextMenuAction } from './NewSchedule/TripContextMenu';
import { SegmentTimeEditor } from './NewSchedule/SegmentTimeEditor';
import { FilterState } from './NewSchedule/QuickActionsBar';
import { TimelineView } from './NewSchedule/TimelineView';
import {
    cascadeTripTimes,
    updateSegmentTime,
    endBlockAtTrip,
    setTripStartStop,
    setTripEndStop
} from './NewSchedule/utils/timeCascade';
import { UploadToMasterModal } from './modals/UploadToMasterModal';
import { BulkUploadToMasterModal, RouteForUpload } from './modals/BulkUploadToMasterModal';
import {
    uploadToMasterSchedule,
    prepareUpload
} from '../utils/services/masterScheduleService';
import {
    extractRouteNumber,
    extractDayType,
    type DayType,
    type UploadConfirmation
} from '../utils/masterScheduleTypes';
import {
    deepCloneSchedules,
    findTableAndTrip,
    calculateHeadways,
    getRatioColor,
    getRecoveryStatus,
    calculatePeakVehicles,
    calculateServiceSpan,
    analyzeHeadways,
    calculateTripsPerHour,
    getBandRowColor,
    parseTimeInput,
    sanitizeInput,
    parseStackedTime,
    validateSchedule,
    type ValidationWarning
} from '../utils/schedule/scheduleEditorUtils';
import { StackedTimeCell, StackedTimeInput } from './ui/StackedTimeInput';
import { RoundTripTableView } from './schedule/RoundTripTableView';
import { getRouteConfig, extractDirectionFromName, parseRouteInfo } from '../utils/config/routeDirectionConfig';
import { reassignBlocksForTables, MatchConfigPresets } from '../utils/blocks/blockAssignmentCore';
import type { CascadeMode } from '../hooks/useScheduleEditing';
import { useUploadToMaster, ConsolidatedRoute } from '../hooks/useUploadToMaster';
import { useTravelTimeGrid } from '../hooks/useTravelTimeGrid';
import { ScheduleSidebar } from './layout/ScheduleSidebar';
import { CascadeModeSelector } from './ui/CascadeModeSelector';
import { isEditableEventTarget } from '../utils/domUtils';
// --- Main Editor Component ---

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

export interface ScheduleEditorProps {
    schedules: MasterRouteTable[];
    // Optional schedule scope used by Connections library validation/resolution.
    // If omitted, defaults to the currently edited schedules.
    connectionScopeSchedules?: MasterRouteTable[];
    onSchedulesChange?: (schedules: MasterRouteTable[]) => void;
    originalSchedules?: MasterRouteTable[];
    onResetOriginals?: () => void;
    draftName?: string;
    onRenameDraft?: (name: string) => void;
    autoSaveStatus?: AutoSaveStatus;
    lastSaved?: Date | null;
    onSaveVersion?: (label?: string) => Promise<void>;
    onClose?: () => void;
    onNewDraft?: () => void;
    onOpenDrafts?: () => void;

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

    // Upload to Master Schedule (optional - only shown if teamId is provided)
    teamId?: string;
    userId?: string;
    uploaderName?: string;

    // Publish action (Draft -> Publish)
    onPublish?: () => void;
    publishLabel?: string;
    isPublishing?: boolean;
    publishDisabled?: boolean;

    // Master comparison baseline (inline delta badges)
    masterBaseline?: MasterRouteTable[] | null;
}

export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({
    schedules,
    connectionScopeSchedules,
    onSchedulesChange,
    originalSchedules,
    onResetOriginals,
    draftName = 'Schedule',
    onRenameDraft,
    autoSaveStatus,
    lastSaved,
    onSaveVersion,
    onClose,
    onNewDraft,
    onOpenDrafts,
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
    masterBaseline
}) => {
    const [activeRouteIdx, setActiveRouteIdx] = useState(0);
    const [activeDay, setActiveDay] = useState<string>('Weekday');
    const [subView, setSubView] = useState<'editor' | 'matrix' | 'timeline'>('editor');
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showAuditLog, setShowAuditLog] = useState(false);

    // Upload to Master State - now handled by useUploadToMaster hook

    // Connections Panel State
    const [showConnectionsPanel, setShowConnectionsPanel] = useState(false);
    const [connectionLibrary, setConnectionLibrary] = useState<ConnectionLibrary | null>(null);

    // Load connection library when teamId is available
    useEffect(() => {
        if (!teamId) {
            setConnectionLibrary(null);
            return;
        }
        getConnectionLibrary(teamId)
            .then(lib => setConnectionLibrary(lib))
            .catch(err => {
                console.error('Failed to load connection library:', err);
                setConnectionLibrary(null);
            });
    }, [teamId]);

    // Quick Actions Bar Filter State
    const [filter, setFilter] = useState<FilterState>({
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
    } | null>(null);

    // Audit Log
    const { entries: auditEntries, logAction } = useAuditLog();

    // Cascade Mode for time editing
    const [cascadeMode, setCascadeMode] = useState<CascadeMode>('always');

    // Add Trip
    const {
        modalContext: addTripModalContext,
        openModal: openAddTripModal,
        closeModal: closeAddTripModal,
        handleConfirm: handleAddTripFromModal
    } = useAddTrip({
        schedules,
        setSchedules: onSchedulesChange,
        onSuccess: showSuccessToast
    });

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
    const consolidatedRoutes = useMemo(() => {
        const routeGroups: Record<string, {
            name: string;
            days: Record<string, {
                north?: MasterRouteTable;
                south?: MasterRouteTable;
                combined?: RoundTripTable;
            }>;
        }> = {};

        schedules.forEach(table => {
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
    }, [schedules]);

    // Upload to Master Hook
    const upload = useUploadToMaster(
        consolidatedRoutes as ConsolidatedRoute[],
        teamId,
        userId,
        uploaderName,
        showSuccessToast
    );

    // Travel Time Grid Hook
    const gridHandlers = useTravelTimeGrid(schedules, onSchedulesChange, logAction);

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
                    void onSaveVersion();
                    showSuccessToast?.('Version saved');
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
        cols.forEach(col => {
            const m = TimeUtils.toMinutes(trip.stops[col]);
            if (m !== null) {
                if (start === null) start = m;
                end = m;
            }
        });
        if (start !== null && end !== null) {
            trip.startTime = start;
            trip.endTime = end;
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

        // Use the core module for block reassignment (exact time match, no location check)
        reassignBlocksForTables(relatedTables, baseName, MatchConfigPresets.editor);
    };

    const handleCellEdit = (tripId: string, col: string, val: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        // Handle arrival time edits (col ends with __ARR)
        const isArrivalEdit = col.endsWith('__ARR');
        const stopName = isArrivalEdit ? col.replace('__ARR', '') : col;

        const oldValue = isArrivalEdit
            ? (trip.arrivalTimes?.[stopName] ?? trip.stops[stopName])
            : trip.stops[stopName];

        // Skip no-op edits — prevents onBlur from overwriting a cascaded change
        if (oldValue === val) return;

        const oldTime = TimeUtils.toMinutes(oldValue);
        const newTime = TimeUtils.toMinutes(val);
        const colIdx = table.stops.indexOf(stopName);

        // Log the edit to audit log
        if (oldValue !== val) {
            logAction('edit', `Edited ${stopName}${isArrivalEdit ? ' (arrival)' : ''} time`, {
                tripId,
                blockId: trip.blockId,
                field: stopName,
                oldValue: oldValue || '-',
                newValue: val || '-'
            });
        }

        if (isArrivalEdit) {
            if (!trip.arrivalTimes) trip.arrivalTimes = {};
            trip.arrivalTimes[stopName] = val;
            // Keep stops in sync so trip timing math (start/end/cycle) reflects ARR edits.
            trip.stops[stopName] = val;
        } else {
            trip.stops[stopName] = val;
            // Keep mirrored arrivalTimes in sync when present; many RoundTrip cells
            // display arrivalTimes first, so stop-only updates can appear as no-op.
            if (trip.arrivalTimes && trip.arrivalTimes[stopName] !== undefined) {
                const recovery = trip.recoveryTimes?.[stopName] || 0;
                if (recovery > 0) {
                    const depMin = TimeUtils.toMinutes(val);
                    if (depMin !== null) {
                        trip.arrivalTimes[stopName] = TimeUtils.fromMinutes(depMin - recovery);
                    }
                } else {
                    trip.arrivalTimes[stopName] = val;
                }
            }
        }

        if (cascadeMode !== 'none' && oldTime !== null && newTime !== null && colIdx !== -1) {
            const delta = newTime - oldTime;
            if (delta !== 0) {
                for (let i = colIdx + 1; i < table.stops.length; i++) {
                    const nextStop = table.stops[i];
                    const nextArrTime = TimeUtils.toMinutes(trip.arrivalTimes?.[nextStop] ?? trip.stops[nextStop]);
                    if (nextArrTime !== null) {
                        const proposedTime = nextArrTime + delta;
                        // Validate: don't let time go before previous stop (would create negative segment)
                        const prevStop = table.stops[i - 1];
                        const prevTime = TimeUtils.toMinutes(trip.arrivalTimes?.[prevStop] ?? trip.stops[prevStop]);
                        if (prevTime !== null && proposedTime <= prevTime) {
                            // Skip cascade - would create invalid timing
                            break;
                        }
                        // Shift stops (departure) and arrivalTimes (arrival) independently
                        const depTime = TimeUtils.toMinutes(trip.stops[nextStop]);
                        if (depTime !== null) {
                            trip.stops[nextStop] = TimeUtils.fromMinutes(depTime + delta);
                        }
                        if (trip.arrivalTimes && trip.arrivalTimes[nextStop] !== undefined) {
                            trip.arrivalTimes[nextStop] = TimeUtils.fromMinutes(proposedTime);
                        }
                    }
                }
            }
        }

        const oldEndTime = trip.endTime;
        recalculateTrip(trip, table.stops);
        const newEndTime = trip.endTime;
        const deltaEnd = newEndTime - oldEndTime;

        if (cascadeMode === 'always' && deltaEnd !== 0) {
            // Ripple to subsequent trips in the same block
            // Extract base route name using getTrueBaseRoute (handles 2A/2B direction variants)
            const baseName = getTrueBaseRoute(table.routeName);

            // Find all tables for this route (both directions if bidirectional)
            const relatedTables = newScheds.filter(t => {
                const tBase = getTrueBaseRoute(t.routeName);
                return tBase === baseName;
            });

            // Collect all trips in this block from all related tables
            const allBlockTrips: { trip: MasterTrip; table: MasterRouteTable }[] = [];
            relatedTables.forEach(t => {
                t.trips.filter(tr => tr.blockId === trip.blockId).forEach(tr => {
                    allBlockTrips.push({ trip: tr, table: t });
                });
            });

            // Sort by tripNumber to maintain proper sequence
            allBlockTrips.sort((a, b) => a.trip.tripNumber - b.trip.tripNumber);

            // Find where the edited trip is in the sequence
            const startIdx = allBlockTrips.findIndex(item => item.trip.id === trip.id);

            if (startIdx !== -1) {
                // Ripple changes to all subsequent trips in the block
                for (let i = startIdx + 1; i < allBlockTrips.length; i++) {
                    const { trip: nextTrip, table: nextTable } = allBlockTrips[i];
                    // Shift stops (departure) and arrivalTimes (arrival) independently
                    nextTable.stops.forEach(s => {
                        const stopTime = nextTrip.stops[s];
                        if (stopTime !== null && stopTime !== undefined && stopTime !== '') {
                            nextTrip.stops[s] = TimeUtils.addMinutes(stopTime, deltaEnd);
                        }
                        if (nextTrip.arrivalTimes && nextTrip.arrivalTimes[s] !== undefined &&
                            nextTrip.arrivalTimes[s] !== null && nextTrip.arrivalTimes[s] !== '') {
                            nextTrip.arrivalTimes[s] = TimeUtils.addMinutes(nextTrip.arrivalTimes[s], deltaEnd);
                        }
                    });
                    recalculateTrip(nextTrip, nextTable.stops);
                }
            }
        }

        newScheds.forEach(t => validateRouteTable(t));

        onSchedulesChange(newScheds);
    };

    const handleRecoveryEdit = (tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;
        const stopIdx = table.stops.indexOf(stopName);
        if (stopIdx === -1) return;

        const oldRec = trip.recoveryTimes?.[stopName] || 0;
        // Bound recovery: can't be negative, and can't exceed travel time - 1 (to avoid negative runtime)
        const maxRec = Math.max(0, trip.travelTime - 1);
        const newRec = Math.max(0, Math.min(oldRec + delta, maxRec));
        const actualDelta = newRec - oldRec; // May differ from requested delta if bounds were hit

        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;
        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

        // Update departure time at the modified stop: departure = arrival + recovery
        const arrivalAtStop = trip.arrivalTimes?.[stopName];
        if (arrivalAtStop) {
            const arrMin = TimeUtils.toMinutes(arrivalAtStop);
            if (arrMin !== null) {
                trip.stops[stopName] = TimeUtils.fromMinutes(arrMin + newRec);
            }
        }

        // Cascade time changes to subsequent stops (both stops and arrivalTimes)
        for (let i = stopIdx + 1; i < table.stops.length; i++) {
            const nextStop = table.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[nextStop]);
            if (t !== null) trip.stops[nextStop] = TimeUtils.fromMinutes(t + actualDelta);
            // Also update arrivalTimes
            if (trip.arrivalTimes?.[nextStop]) {
                const arr = TimeUtils.toMinutes(trip.arrivalTimes[nextStop]);
                if (arr !== null) trip.arrivalTimes[nextStop] = TimeUtils.fromMinutes(arr + actualDelta);
            }
        }
        recalculateTrip(trip, table.stops);
        validateRouteTable(table);

        if (cascadeMode === 'always' && actualDelta !== 0) {
            const baseName = getTrueBaseRoute(table.routeName);
            const relatedTables = newScheds.filter(t => {
                const tBase = getTrueBaseRoute(t.routeName);
                return tBase === baseName;
            });

            const allBlockTrips: { trip: MasterTrip; table: MasterRouteTable }[] = [];
            relatedTables.forEach(t => {
                t.trips.filter(tr => tr.blockId === trip.blockId).forEach(tr => {
                    allBlockTrips.push({ trip: tr, table: t });
                });
            });

            allBlockTrips.sort((a, b) => a.trip.tripNumber - b.trip.tripNumber);
            const startIdx = allBlockTrips.findIndex(item => item.trip.id === trip.id);

            if (startIdx !== -1) {
                for (let i = startIdx + 1; i < allBlockTrips.length; i++) {
                    const { trip: nextTrip, table: nextTable } = allBlockTrips[i];
                    // Shift stops (departure) and arrivalTimes (arrival) independently
                    nextTable.stops.forEach(s => {
                        const stopTime = nextTrip.stops[s];
                        if (stopTime !== null && stopTime !== undefined && stopTime !== '') {
                            nextTrip.stops[s] = TimeUtils.addMinutes(stopTime, actualDelta);
                        }
                        if (nextTrip.arrivalTimes && nextTrip.arrivalTimes[s] !== undefined &&
                            nextTrip.arrivalTimes[s] !== null && nextTrip.arrivalTimes[s] !== '') {
                            nextTrip.arrivalTimes[s] = TimeUtils.addMinutes(nextTrip.arrivalTimes[s], actualDelta);
                        }
                    });
                    recalculateTrip(nextTrip, nextTable.stops);
                }
            }
        }

        reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));
        onSchedulesChange(newScheds);
    };

    const handleTimeAdjust = (tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { trip } = result;

        const isArrivalAdjust = stopName.endsWith('__ARR');
        const baseStopName = isArrivalAdjust ? stopName.replace('__ARR', '') : stopName;
        const departureAtStop = (() => {
            const dep = trip.stops[baseStopName];
            if (dep) return dep;
            const arr = trip.arrivalTimes?.[baseStopName];
            if (!arr) return '';
            const recovery = trip.recoveryTimes?.[baseStopName] || 0;
            return recovery === 0 ? arr : TimeUtils.addMinutes(arr, recovery);
        })();
        const currentTime = isArrivalAdjust
            ? (trip.arrivalTimes?.[baseStopName] ?? trip.stops[baseStopName])
            : departureAtStop;
        if (!currentTime) return;

        const newTime = TimeUtils.addMinutes(currentTime, delta);
        handleCellEdit(tripId, isArrivalAdjust ? `${baseStopName}__ARR` : baseStopName, newTime);
    };

    const handleDeleteTrip = (tripId: string) => {
        if (!confirm("Delete trip?")) return;
        const newScheds = deepCloneSchedules(schedules);
        for (const t of newScheds) {
            const tripToDelete = t.trips.find(x => x.id === tripId);
            if (tripToDelete) {
                // Log deletion to audit log
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
        onSchedulesChange(newScheds);
    };

    // Handle direction change from SingleRouteView dropdown
    const handleDirectionChange = (tableRouteName: string, direction: 'North' | 'South') => {
        const newScheds = deepCloneSchedules(schedules);
        const table = newScheds.find(t => t.routeName === tableRouteName);
        if (!table) return;

        // Update route name to include direction
        // Remove any existing direction suffix first, then add new one
        let newName = table.routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .trim();
        newName = `${newName} (${direction})`;

        table.routeName = newName;

        // Also update direction on all trips in this table
        table.trips.forEach(trip => {
            trip.direction = direction;
        });

        logAction('edit', `Set direction to ${direction}`, {
            field: 'direction',
            oldValue: tableRouteName,
            newValue: newName
        });

        onSchedulesChange(newScheds);
    };

    // Context Menu Action Handler
    const handleContextMenuAction = (action: TripContextMenuAction) => {
        switch (action.type) {
            case 'deleteTrip':
                handleDeleteTrip(action.tripId);
                break;

            case 'addTripAfter':
                // Find the trip and open add modal
                const addResult = findTableAndTrip(schedules, action.tripId);
                if (addResult) {
                    // openModal expects (afterTripId, routeData)
                    openAddTripModal(action.tripId, { north: undefined, south: undefined });
                }
                break;

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
                    showSuccessToast('Block start point updated');
                }
                break;

            case 'duplicateTrip':
                handleDuplicateTrip(action.tripId);
                break;
        }
        setContextMenu(null);
    };

    // Duplicate trip handler - clones a trip with +1 minute offset
    const handleDuplicateTrip = (tripId: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;

        const { table, trip } = result;

        // Create a new trip as a clone
        const newTrip: MasterTrip = {
            ...JSON.parse(JSON.stringify(trip)),
            id: `${trip.id}-dup-${Date.now()}`,
            tripNumber: 0, // Will be set by renumbering after sort
            blockId: '', // Clear blockId - let block reassignment handle it
            startTime: trip.startTime + 1, // Offset by 1 minute
            endTime: trip.endTime + 1,
        };

        // Shift all stop times and arrival times by 1 minute
        Object.keys(newTrip.stops).forEach(stop => {
            if (newTrip.stops[stop]) {
                newTrip.stops[stop] = TimeUtils.addMinutes(newTrip.stops[stop], 1);
            }
            if (newTrip.arrivalTimes?.[stop]) {
                newTrip.arrivalTimes[stop] = TimeUtils.addMinutes(newTrip.arrivalTimes[stop], 1);
            }
        });

        // Insert after the source trip
        const tripIndex = table.trips.findIndex(t => t.id === tripId);
        table.trips.splice(tripIndex + 1, 0, newTrip);

        // Re-sort by start time
        table.trips.sort((a, b) => a.startTime - b.startTime);

        // Reassign trip numbers
        table.trips.forEach((t, i) => { t.tripNumber = i + 1; });

        validateRouteTable(table);

        // Reassign blocks to assign proper blockId to the new trip
        reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));

        logAction('add', `Duplicated trip from Block ${newTrip.blockId || 'new'}`, {
            tripId: newTrip.id,
            blockId: newTrip.blockId,
            field: 'trip'
        });

        onSchedulesChange(newScheds);
        showSuccessToast('Trip duplicated');
    };

    // Right-click handler for trip rows
    const handleTripRightClick = (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number
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
            stops
        });
    };

    // Menu open handler for kebab button click
    const handleMenuOpen = (
        tripId: string,
        x: number,
        y: number,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[]
    ) => {
        setContextMenu({
            x,
            y,
            tripId,
            tripDirection,
            blockId,
            stops
        });
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
        validateRouteTable(table);

        logAction('edit', `Timeline: Moved trip to ${TimeUtils.fromMinutes(newStartTime)}`, {
            tripId,
            blockId: trip.blockId,
            field: 'startTime',
            oldValue: TimeUtils.fromMinutes(oldStartTime),
            newValue: TimeUtils.fromMinutes(newStartTime)
        });

        onSchedulesChange(newScheds);
    };

    // Handle trip selection from timeline
    const handleTripSelect = (tripId: string) => {
        setSelectedTripId(tripId);
    };

    // NOTE: Travel time grid handlers moved to useTravelTimeGrid hook (see gridHandlers.* above)

    const handleExport = async () => {
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

        // Process each schedule table
        for (const table of schedules) {
            const ws = workbook.addWorksheet(table.routeName.substring(0, 31));

            // Extract info using centralized direction config
            const tableDirection = extractDirectionFromName(table.routeName);
            const isNorth = tableDirection === 'North';
            const isSouth = tableDirection === 'South';
            const dayType = table.routeName.includes('Saturday') ? 'Saturday' :
                table.routeName.includes('Sunday') ? 'Sunday' : 'Weekday';
            const baseName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();

            // Get direction info from config
            const routeConfig = getRouteConfig(baseName);
            let direction = isNorth ? 'NORTHBOUND' : isSouth ? 'SOUTHBOUND' : 'ALL TRIPS';
            if (routeConfig) {
                if (routeConfig.segments.length === 1) {
                    // Loop route
                    direction = `LOOP (${routeConfig.segments[0].name.toUpperCase()})`;
                } else if (routeConfig.segments.length === 2) {
                    // Bidirectional route
                    const northSegment = routeConfig.segments.find(s => s.name === 'North');
                    const southSegment = routeConfig.segments.find(s => s.name === 'South');
                    if (isNorth && northSegment) {
                        direction = `${northSegment.variant} NORTHBOUND → ${northSegment.terminus}`;
                    } else if (isSouth && southSegment) {
                        direction = `${southSegment.variant} SOUTHBOUND → ${southSegment.terminus}`;
                    }
                }
            }

            // Get route color
            const routeColor = getRouteColor(baseName);
            const routeTextColor = getContrastTextColor(routeColor);
            const routeColorArgb = hexToArgb(routeColor);

            // Calculate summary stats
            const totalTrips = table.trips.length;
            const totalTravelTime = table.trips.reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecovery = table.trips.reduce((sum, t) => sum + t.recoveryTime, 0);
            const totalCycleTime = totalTravelTime + totalRecovery;
            const recoveryRatio = totalTravelTime > 0 ? ((totalRecovery / totalTravelTime) * 100).toFixed(1) + '%' : '0%';

            // Store for summary sheet
            routeSummaries.push({ route: baseName, dayType, cycleHours: totalCycleTime / 60 });

            // Build set of stops with recovery (same logic as UI)
            const stopsWithRecovery = new Set<string>();
            table.trips.forEach(t => {
                if (t.recoveryTimes) {
                    Object.entries(t.recoveryTimes).forEach(([s, m]) => {
                        if (m != null) stopsWithRecovery.add(s);
                    });
                }
            });

            // Build column structure with ARR/R/DEP pattern
            // columnDefs: { name: string, subheader: string, isRecovery: boolean, stopName?: string }
            const columnDefs: { name: string; subheader: string; isRecovery: boolean; stopName?: string }[] = [];
            columnDefs.push({ name: 'Block', subheader: '', isRecovery: false });

            table.stops.forEach((stop) => {
                if (stopsWithRecovery.has(stop)) {
                    // Stop with recovery: ARR | R | DEP
                    columnDefs.push({ name: stop, subheader: 'ARR', isRecovery: false, stopName: stop });
                    columnDefs.push({ name: 'R', subheader: 'R', isRecovery: true, stopName: stop });
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop });
                } else {
                    // Stop without recovery: DEP only
                    columnDefs.push({ name: stop, subheader: 'DEP', isRecovery: false, stopName: stop });
                }
            });
            columnDefs.push({ name: 'Travel', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Recovery', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Cycle', subheader: '', isRecovery: false });
            columnDefs.push({ name: 'Ratio', subheader: '', isRecovery: false });

            // Row 1: Route header with route color
            const routeRow = ws.addRow([`ROUTE ${baseName} - ${dayType.toUpperCase()}`]);
            ws.mergeCells(1, 1, 1, columnDefs.length);
            routeRow.height = 28;
            routeRow.getCell(1).font = { bold: true, size: 16, color: { argb: routeTextColor } };
            routeRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            routeRow.getCell(1).alignment = headerAlignment;
            routeRow.getCell(1).border = allBorders;

            // Row 2: Direction subheader
            const dirRow = ws.addRow([direction]);
            ws.mergeCells(2, 1, 2, columnDefs.length);
            dirRow.height = 22;
            dirRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF374151' } };
            dirRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            dirRow.getCell(1).alignment = headerAlignment;
            dirRow.getCell(1).border = allBorders;

            // Row 3: Column headers (stop names)
            const headerRow = ws.addRow(columnDefs.map(c => c.name));
            headerRow.height = 20;
            headerRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
                if (columnDefs[colNumber - 1]?.isRecovery) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    cell.font = { bold: true, size: 10, color: { argb: 'FF1D4ED8' } };
                }
            });

            // Row 4: ARR/R/DEP subheaders
            const subheaderRow = ws.addRow(columnDefs.map(c => c.subheader));
            subheaderRow.height = 16;
            subheaderRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
                if (columnDefs[colNumber - 1]?.isRecovery) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    cell.font = { bold: true, size: 9, color: { argb: 'FF1D4ED8' } };
                }
            });

            // Data rows
            table.trips.forEach((trip, tripIdx) => {
                const rowData: (string | number)[] = [trip.blockId];

                table.stops.forEach((stop) => {
                    const depTime = trip.stops[stop] || '';
                    const recovery = trip.recoveryTimes?.[stop] ?? 0;

                    if (stopsWithRecovery.has(stop)) {
                        // Calculate ARR time = DEP - Recovery
                        let arrTime = '';
                        if (depTime) {
                            const depMin = TimeUtils.toMinutes(depTime);
                            if (depMin !== null) {
                                arrTime = TimeUtils.fromMinutes(depMin - recovery);
                            }
                        }
                        rowData.push(arrTime);           // ARR
                        rowData.push(recovery || '');    // R
                        rowData.push(depTime);           // DEP
                    } else {
                        rowData.push(depTime);           // DEP only
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

            // Summary card (offset to right)
            const summaryCol = columnDefs.length + 3;
            const summaryStartRow = 2;

            // Summary header
            ws.getCell(summaryStartRow, summaryCol).value = 'DAY SUMMARY';
            ws.mergeCells(summaryStartRow, summaryCol, summaryStartRow, summaryCol + 1);
            ws.getCell(summaryStartRow, summaryCol).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
            ws.getCell(summaryStartRow, summaryCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            ws.getCell(summaryStartRow, summaryCol).alignment = headerAlignment;

            const summaryItems = [
                ['Total Trips', totalTrips],
                ['Total Travel', toHours(totalTravelTime) + ' hrs'],
                ['Total Recovery', toHours(totalRecovery) + ' hrs'],
                ['Total Cycle', toHours(totalCycleTime) + ' hrs'],
                ['Recovery Ratio', recoveryRatio]
            ];

            summaryItems.forEach((item, idx) => {
                const r = summaryStartRow + 1 + idx;
                ws.getCell(r, summaryCol).value = item[0];
                ws.getCell(r, summaryCol).font = { size: 10, color: { argb: 'FF6B7280' } };
                ws.getCell(r, summaryCol).alignment = { horizontal: 'right', vertical: 'middle' };
                ws.getCell(r, summaryCol + 1).value = item[1];
                ws.getCell(r, summaryCol + 1).font = { bold: true, size: 10 };
                ws.getCell(r, summaryCol + 1).alignment = cellAlignment;
                if (idx === 3) { // Total Cycle row
                    ws.getCell(r, summaryCol + 1).font = { bold: true, size: 11, color: { argb: hexToArgb(routeColor) } };
                }
            });

            // Column widths
            columnDefs.forEach((col, idx) => {
                ws.getColumn(idx + 1).width = col.isRecovery ? 5 : col.name === 'Block' ? 10 : Math.max(col.name.length + 2, 10);
            });
            ws.getColumn(summaryCol).width = 14;
            ws.getColumn(summaryCol + 1).width = 10;
        }

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
        totalRow.eachCell((cell, col) => {
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
        link.download = 'Bus_Schedule_Export.xlsx';
        link.click();
    };

    // --- Upload to Master Handlers ---
    // NOTE: Upload handlers moved to useUploadToMaster hook (see upload.* above)

    // Active Data
    const activeRouteGroup = consolidatedRoutes[activeRouteIdx];
    const activeRoute = activeRouteGroup?.days[activeDay] || activeRouteGroup?.days[Object.keys(activeRouteGroup?.days || {})[0]];
    const summaryTable = useMemo(() => {
        if (!activeRoute) return { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
        if (activeRoute.combined) return { routeName: activeRouteGroup.name, trips: [...(activeRoute.north?.trips || []), ...(activeRoute.south?.trips || [])], stops: [], stopIds: {} };
        return activeRoute.north || activeRoute.south || { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
    }, [activeRoute]);

    if (!activeRouteGroup || !activeRoute) return <div className="p-8 text-center text-gray-600">No Routes Loaded</div>;

    return (
        <>
            {addTripModalContext && (
                <AddTripModal
                    context={addTripModalContext}
                    onCancel={closeAddTripModal}
                    onConfirm={handleAddTripFromModal}
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
                    onAction={handleContextMenuAction}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Upload to Master Modal (Single Route) */}
            <UploadToMasterModal
                isOpen={upload.showUploadModal}
                confirmation={upload.uploadConfirmation}
                onConfirm={upload.confirmUpload}
                onCancel={upload.cancelUpload}
                isUploading={upload.isUploading}
            />

            {/* Bulk Upload to Master Modal */}
            <BulkUploadToMasterModal
                isOpen={upload.showBulkUploadModal}
                routes={upload.routesForUpload}
                onConfirm={upload.handleBulkUpload}
                onCancel={upload.closeBulkUpload}
            />

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
                        hasUnsavedChanges={!readOnly && schedules.length > 0}
                        summaryTable={summaryTable}
                        draftName={readOnly ? 'Master Schedule' : draftName}
                        onRenameDraft={readOnly ? undefined : onRenameDraft}
                        onOpenDrafts={readOnly ? undefined : onOpenDrafts}
                        onNewDraft={readOnly ? undefined : onNewDraft}
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
                        onOpenConnections={teamId && userId && !readOnly ? () => setShowConnectionsPanel(true) : undefined}
                    />
                )}

                <div className="flex-grow flex flex-col lg:flex-row overflow-hidden">
                    {/* Sidebar - hidden in embedded mode or when hideSidebar is true */}
                    {!isFullScreen && !embedded && !hideSidebar && (
                        <div className="w-full lg:w-72 lg:min-w-[280px] lg:max-w-[320px] flex-shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col overflow-hidden z-20">
                            {/* Header */}
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-700">{readOnly ? 'Master Schedule' : 'Route Editor'}</h2>
                                {onClose && <button onClick={onClose} className="text-sm text-blue-700 hover:text-blue-800 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded px-1"><ArrowLeft size={12} /> Back</button>}
                            </div>

                            {/* Route List */}
                            <div className="overflow-y-auto custom-scrollbar flex-grow p-4 space-y-2">
                                {consolidatedRoutes.map((route, i) => (
                                    <div key={route.name} className="space-y-1">
                                        <button
                                            onClick={() => setActiveRouteIdx(i)}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex justify-between items-center ${i === activeRouteIdx ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50'}`}
                                            style={i === activeRouteIdx ? { backgroundColor: getRouteColor(route.name), color: getRouteTextColor(route.name) } : undefined}
                                        >
                                            Route {route.name}
                                            {i === activeRouteIdx ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </button>

                                        {i === activeRouteIdx && (
                                            <div className="pl-3 space-y-1">
                                                {['Weekday', 'Saturday', 'Sunday'].filter(d => Object.keys(route.days).includes(d)).map(day => (
                                                    <div key={day} className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => setActiveDay(day)}
                                                            className={`flex-1 text-left px-3 py-1.5 rounded text-sm flex items-center gap-2 ${activeDay === day ? 'bg-blue-100 font-bold text-blue-800' : 'text-gray-700 hover:bg-gray-50'}`}
                                                        >
                                                            <div className={`w-1.5 h-1.5 rounded-full ${activeDay === day ? 'bg-blue-600' : 'bg-gray-300'}`} />
                                                            {day}
                                                        </button>
                                                        {teamId && !readOnly && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    upload.initiateUpload(route.name, day as DayType);
                                                                }}
                                                                className="p-1.5 rounded text-gray-600 hover:text-green-700 hover:bg-green-50 transition-colors"
                                                                title={`Upload Route ${route.name} (${day}) to Master`}
                                                            >
                                                                <Upload size={12} />
                                                            </button>
                                                        )}
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
                                    {/* Upload to Master Button */}
                                    {teamId && (
                                        <div className="p-3 border-b border-gray-100">
                                            <button
                                                onClick={upload.openBulkUpload}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                                            >
                                                <Database size={16} />
                                                Upload to Master
                                            </button>
                                            <p className="text-xs text-gray-500 text-center mt-2">
                                                {upload.routesForUpload.length} route{upload.routesForUpload.length !== 1 ? 's' : ''} available
                                            </p>
                                        </div>
                                    )}

                                </div>
                            )}
                        </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-grow min-w-0 overflow-auto flex flex-col p-2 md:p-4">
                        {subView === 'matrix' ? (
                            <TravelTimeGrid
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onBulkAdjust={gridHandlers.handleBulkAdjustTravelTime}
                                onRecoveryAdjust={gridHandlers.handleBulkAdjustRecoveryTime}
                                onSingleTripAdjust={gridHandlers.handleSingleTripTravelAdjust}
                                onSingleRecoveryAdjust={gridHandlers.handleSingleRecoveryAdjust}
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
                            />
                        ) : (
                            <>
                                <RoundTripTableView
                                    schedules={schedules}
                                    onCellEdit={readOnly ? undefined : handleCellEdit}
                                    onTimeAdjust={readOnly ? undefined : handleTimeAdjust}
                                    onRecoveryEdit={readOnly ? undefined : handleRecoveryEdit}
                                    originalSchedules={originalSchedules}
                                    onResetOriginals={onResetOriginals}
                                    onDeleteTrip={readOnly ? undefined : handleDeleteTrip}
                                    onDuplicateTrip={readOnly ? undefined : handleDuplicateTrip}
                                    onAddTrip={readOnly ? undefined : (_, tripId) => openAddTripModal(tripId, {})}
                                    onTripRightClick={readOnly ? undefined : handleTripRightClick}
                                    onMenuOpen={readOnly ? undefined : handleMenuOpen}
                                    draftName={draftName}
                                    filter={filter}
                                    targetCycleTime={targetCycleTime}
                                    targetHeadway={targetHeadway}
                                    readOnly={readOnly}
                                    connectionLibrary={connectionLibrary}
                                    dayType={activeDay as DayType}
                                    masterBaseline={masterBaseline}
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
                            onClose={() => setShowConnectionsPanel(false)}
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
