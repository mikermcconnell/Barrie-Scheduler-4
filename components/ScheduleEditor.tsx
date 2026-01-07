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
    Undo2,
    Redo2,
    Minus,
    Clock,
    AlertTriangle,
    Car,
    GitCompare,
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
    buildRoundTripView,
    InterlineConfig,
    InterlineRule,
    applyInterlineRules,
    clearInterlineMetadata
} from '../utils/masterScheduleParser';
import { InterlineConfigPanel } from './InterlineConfigPanel';
import { RouteSummary } from './RouteSummary';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AutoSaveStatus } from '../hooks/useAutoSave';
import { TimeUtils } from '../utils/timeUtils';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';
import { AddTripModal, AddTripModalContext } from './AddTripModal';
import { useAddTrip } from '../hooks/useAddTrip';
import { TravelTimeGrid } from './TravelTimeGrid';
import { ScenarioComparisonModal } from './ScenarioComparisonModal';
import { AuditLogPanel, useAuditLog } from './AuditLogPanel';
import { TripContextMenu, TripContextMenuAction } from './NewSchedule/TripContextMenu';
import { SegmentTimeEditor } from './NewSchedule/SegmentTimeEditor';
import { QuickActionsBar, FilterState, shouldGrayOutTrip, shouldHighlightTrip, matchesSearch } from './NewSchedule/QuickActionsBar';
import { TimelineView } from './NewSchedule/TimelineView';
import {
    cascadeTripTimes,
    updateSegmentTime,
    endBlockAtTrip,
    setTripStartStop,
    setTripEndStop
} from './NewSchedule/utils/timeCascade';
import { UploadToMasterModal } from './UploadToMasterModal';
import { BulkUploadToMasterModal, RouteForUpload } from './BulkUploadToMasterModal';
import {
    uploadToMasterSchedule,
    prepareUpload
} from '../utils/masterScheduleService';
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
} from '../utils/scheduleEditorUtils';
import { StackedTimeCell, StackedTimeInput } from './ui/StackedTimeInput';
import { RoundTripTableView } from './schedule/RoundTripTableView';
import { SingleRouteView } from './schedule/SingleRouteView';
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
    onSchedulesChange?: (schedules: MasterRouteTable[]) => void;
    originalSchedules?: MasterRouteTable[];
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
    // Force simple view even when both North/South tables exist
    forceSimpleView?: boolean;

    // Upload to Master Schedule (optional - only shown if teamId is provided)
    teamId?: string;
    userId?: string;
    uploaderName?: string;

    // Interline configuration (optional - for persistence)
    initialInterlineConfig?: InterlineConfig;
    onInterlineConfigChange?: (config: InterlineConfig) => void;
}

export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({
    schedules,
    onSchedulesChange,
    originalSchedules,
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
    forceSimpleView,
    teamId,
    userId,
    uploaderName,
    initialInterlineConfig,
    onInterlineConfigChange,
    readOnly = false,
    embedded = false
}) => {
    const [activeRouteIdx, setActiveRouteIdx] = useState(0);
    const [activeDay, setActiveDay] = useState<string>('Weekday');
    const [subView, setSubView] = useState<'editor' | 'matrix' | 'timeline'>('editor');
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showComparisonModal, setShowComparisonModal] = useState(false);
    const [showAuditLog, setShowAuditLog] = useState(false);

    // Upload to Master State
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
    const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmation | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadRouteKey, setUploadRouteKey] = useState<{ routeNumber: string; dayType: DayType } | null>(null);

    // Interline Configuration State
    const [showInterlineConfig, setShowInterlineConfig] = useState(false);
    const [interlineConfig, setInterlineConfigInternal] = useState<InterlineConfig>(
        initialInterlineConfig || { rules: [] }
    );

    // Wrapper to notify parent when interline config changes
    const setInterlineConfig = (config: InterlineConfig) => {
        setInterlineConfigInternal(config);
        onInterlineConfigChange?.(config);
    };

    // Handler to apply interline rules to schedules
    const handleApplyInterlineRules = () => {
        const cloned = deepCloneSchedules(schedules);
        clearInterlineMetadata(cloned);
        const result = applyInterlineRules(cloned, interlineConfig.rules);
        onSchedulesChange(cloned);
        showSuccessToast(`Applied ${result.applied} interline connection(s)`);
        setShowInterlineConfig(false);
    };

    // Auto-initialize and auto-apply interline rules for 8A/8B routes
    const [hasAutoAppliedInterline, setHasAutoAppliedInterline] = useState(false);

    useEffect(() => {
        // Only run once when schedules are loaded and we haven't auto-applied yet
        if (hasAutoAppliedInterline || schedules.length === 0) return;

        // Extract route names
        const routeNames = new Set<string>();
        schedules.forEach(t => {
            const match = t.routeName.match(/^([\dA-Za-z]+)/);
            if (match) routeNames.add(match[1]);
        });

        const has8A = routeNames.has('8A');
        const has8B = routeNames.has('8B');

        // Only proceed if both 8A and 8B exist
        if (!has8A || !has8B) return;

        // Find the interline stop
        const allStops = new Set<string>();
        schedules.forEach(t => t.stops.forEach(s => allStops.add(s)));
        const stopsArray = Array.from(allStops);
        const atStop = stopsArray.find(s => s.toLowerCase().includes('barrie allandale transit terminal'))
            || stopsArray.find(s => s.toLowerCase().includes('allandale'))
            || stopsArray[0] || '';

        if (!atStop) return;

        // Create default rules if config is empty
        const needsDefaultRules = interlineConfig.rules.length === 0;

        const defaultRules: InterlineRule[] = needsDefaultRules ? [
            // Weekday/Saturday rules (8 PM to 1:35 AM)
            {
                id: 'rule-8a-8b-weekday',
                fromRoute: '8A',
                fromDirection: 'North' as const,
                toRoute: '8B',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 1200, end: 1535 },
                days: ['Weekday', 'Saturday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            },
            {
                id: 'rule-8b-8a-weekday',
                fromRoute: '8B',
                fromDirection: 'North' as const,
                toRoute: '8A',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 1200, end: 1535 },
                days: ['Weekday', 'Saturday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            },
            // Sunday rules (All Day)
            {
                id: 'rule-8a-8b-sunday',
                fromRoute: '8A',
                fromDirection: 'North' as const,
                toRoute: '8B',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 0, end: 1535 },
                days: ['Sunday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            },
            {
                id: 'rule-8b-8a-sunday',
                fromRoute: '8B',
                fromDirection: 'North' as const,
                toRoute: '8A',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 0, end: 1535 },
                days: ['Sunday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            }
        ] : interlineConfig.rules;

        // Update config with default rules if needed
        if (needsDefaultRules) {
            setInterlineConfig({
                ...interlineConfig,
                rules: defaultRules,
                lastUpdated: new Date().toISOString()
            });
        }

        // Auto-apply rules (only enabled ones)
        const enabledRules = defaultRules.filter(r => r.enabled);
        if (enabledRules.length > 0) {
            const cloned = deepCloneSchedules(schedules);
            clearInterlineMetadata(cloned);
            const result = applyInterlineRules(cloned, enabledRules);
            if (result.applied > 0) {
                onSchedulesChange(cloned);
            }
        }

        setHasAutoAppliedInterline(true);
    }, [schedules, interlineConfig.rules.length, hasAutoAppliedInterline]);

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

            const baseName = table.routeName
                .replace(/\s?\((Weekday|Saturday|Sunday)\)/g, '')
                .replace(/\s?\((North|South)\)/g, '')
                .trim();

            if (!routeGroups[baseName]) routeGroups[baseName] = { name: baseName, days: {} };
            if (!routeGroups[baseName].days[dayType]) routeGroups[baseName].days[dayType] = {};

            const dayGroup = routeGroups[baseName].days[dayType];
            if (table.routeName.includes('(North)')) dayGroup.north = table;
            else if (table.routeName.includes('(South)')) dayGroup.south = table;
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

    console.log('ScheduleEditor consolidatedRoutes:', consolidatedRoutes.length, consolidatedRoutes.map(r => ({
        name: r.name,
        days: Object.keys(r.days),
        hasNorth: !!r.days['Weekday']?.north,
        hasSouth: !!r.days['Weekday']?.south,
        hasCombined: !!r.days['Weekday']?.combined,
        northTrips: r.days['Weekday']?.north?.trips?.length || 0,
        southTrips: r.days['Weekday']?.south?.trips?.length || 0
    })));



    // Auto-select day if current is invalid
    useEffect(() => {
        if (!consolidatedRoutes.length) return;
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
            // Ctrl+S: Save version
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                onSaveVersion();
                showSuccessToast('Version saved');
            }
            // Ctrl+Z: Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
            }
            // Ctrl+Y or Ctrl+Shift+Z: Redo
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
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
    }, [canUndo, canRedo, undo, redo, onSaveVersion, showSuccessToast, isFullScreen]);

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
            trip.cycleTime = end - start;
            trip.travelTime = Math.max(0, trip.cycleTime - trip.recoveryTime);
        }
    };

    // Re-assign blocks for related tables based on time matching
    // Trips are linked when: endTime + recovery at last stop ≈ next trip's startTime (within 1 min)
    const reassignBlocksForRelatedTables = (
        tables: MasterRouteTable[],
        baseName: string
    ) => {
        // Find all related tables (same route, different directions)
        const relatedTables = tables.filter(t => {
            const tBase = t.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();
            return tBase === baseName;
        });

        if (relatedTables.length === 0) return;

        // Collect all trips with their table reference
        interface TripWithTable {
            trip: MasterTrip;
            table: MasterRouteTable;
            assigned: boolean;
        }

        const allTrips: TripWithTable[] = [];
        relatedTables.forEach(table => {
            table.trips.forEach(trip => {
                allTrips.push({ trip, table, assigned: false });
            });
        });

        // Sort by start time for consistent block assignment
        const getOperationalSortTime = (minutes: number): number => {
            const DAY_START = 240; // 4:00 AM
            return minutes < DAY_START ? minutes + 1440 : minutes;
        };
        allTrips.sort((a, b) =>
            getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
        );

        // Assign blocks based on time matching
        let blockCounter = 1;
        for (const item of allTrips) {
            if (item.assigned) continue;

            const blockId = `${baseName}-${blockCounter}`;
            let currentItem: TripWithTable | undefined = item;
            let tripNumberInBlock = 1;

            while (currentItem) {
                currentItem.assigned = true;
                currentItem.trip.blockId = blockId;
                currentItem.trip.tripNumber = tripNumberInBlock++;

                // Find next matching trip in opposite direction
                const currentEndTime = currentItem.trip.endTime;
                const currentDirection = currentItem.trip.direction;

                // For generated schedules, endTime is already the departure time from the last stop
                // (includes recovery). For imported schedules, endTime may be arrival time.
                // Use endTime directly as the expected start of the next trip.
                const expectedStart = currentEndTime;

                const oppositeDirection = currentDirection === 'North' ? 'South' : 'North';

                // Find next trip in opposite direction with matching start time
                currentItem = allTrips.find(t =>
                    !t.assigned &&
                    t.trip.direction === oppositeDirection &&
                    Math.abs(t.trip.startTime - expectedStart) <= 1
                );

                // If no opposite direction match, try same direction (for loop routes)
                if (!currentItem) {
                    currentItem = allTrips.find(t =>
                        !t.assigned &&
                        Math.abs(t.trip.startTime - expectedStart) <= 1
                    );
                }
            }

            blockCounter++;
        }
    };

    const handleCellEdit = (tripId: string, col: string, val: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        const oldValue = trip.stops[col];
        const oldTime = TimeUtils.toMinutes(oldValue);
        const newTime = TimeUtils.toMinutes(val);
        const colIdx = table.stops.indexOf(col);

        // Log the edit to audit log
        if (oldValue !== val) {
            logAction('edit', `Edited ${col} time`, {
                tripId,
                blockId: trip.blockId,
                field: col,
                oldValue: oldValue || '-',
                newValue: val || '-'
            });
        }

        trip.stops[col] = val;

        if (oldTime !== null && newTime !== null && colIdx !== -1) {
            const delta = newTime - oldTime;
            if (delta !== 0) {
                for (let i = colIdx + 1; i < table.stops.length; i++) {
                    const nextStop = table.stops[i];
                    const nextTime = TimeUtils.toMinutes(trip.stops[nextStop]);
                    if (nextTime !== null) trip.stops[nextStop] = TimeUtils.fromMinutes(nextTime + delta);
                }
            }
        }

        const oldEndTime = trip.endTime;
        recalculateTrip(trip, table.stops);
        const newEndTime = trip.endTime;
        const deltaEnd = newEndTime - oldEndTime;

        if (deltaEnd !== 0) {
            // Ripple to subsequent trips in the same block
            // Extract base route name (remove direction and day type suffixes)
            const baseName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();

            // Find all tables for this route (both directions if bidirectional)
            const relatedTables = newScheds.filter(t => {
                const tBase = t.routeName
                    .replace(/\s*\((North|South)\)/gi, '')
                    .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                    .trim();
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
                    // Shift all stop times by the delta
                    nextTable.stops.forEach(s => {
                        const stopTime = nextTrip.stops[s];
                        if (stopTime) {
                            nextTrip.stops[s] = TimeUtils.addMinutes(stopTime, deltaEnd);
                        }
                    });
                    recalculateTrip(nextTrip, nextTable.stops);
                }
            }
        }

        newScheds.forEach(t => validateRouteTable(t));

        // Re-assign blocks after time changes to maintain proper linking
        const baseName = table.routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
            .trim();
        reassignBlocksForRelatedTables(newScheds, baseName);

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
        const newRec = Math.max(0, oldRec + delta);
        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;
        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

        for (let i = stopIdx + 1; i < table.stops.length; i++) {
            const nextStop = table.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[nextStop]);
            if (t !== null) trip.stops[nextStop] = TimeUtils.fromMinutes(t + delta);
        }
        recalculateTrip(trip, table.stops);
        validateRouteTable(table);

        // Re-assign blocks after recovery time changes
        const baseName = table.routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
            .trim();
        reassignBlocksForRelatedTables(newScheds, baseName);

        onSchedulesChange(newScheds);
    };

    const handleTimeAdjust = (tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        const currentTime = trip.stops[stopName];
        if (!currentTime) return;

        const newTime = TimeUtils.addMinutes(currentTime, delta);
        handleCellEdit(tripId, stopName, newTime);
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
            tripNumber: table.trips.length + 1,
            startTime: trip.startTime + 1, // Offset by 1 minute
            endTime: trip.endTime + 1,
        };

        // Shift all stop times by 1 minute
        Object.keys(newTrip.stops).forEach(stop => {
            if (newTrip.stops[stop]) {
                newTrip.stops[stop] = TimeUtils.addMinutes(newTrip.stops[stop], 1);
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

        logAction('add', `Duplicated trip from Block ${trip.blockId}`, {
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
        const delta = newStartTime - oldStartTime;

        // Shift all stop times by the delta
        Object.keys(trip.stops).forEach(stop => {
            const t = TimeUtils.toMinutes(trip.stops[stop]);
            if (t !== null) {
                trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
            }
        });

        // Update trip computed values
        trip.startTime = newStartTime;
        trip.endTime = newStartTime + newDuration;
        trip.travelTime = newDuration;

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

    const handleBulkAdjustTravelTime = (fromStop: string, toStop: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const toIdx = targetTable.stops.indexOf(toStop);
        if (toIdx === -1) return;

        // Log bulk adjustment
        logAction('bulk_adjust', `Bulk travel time ${delta > 0 ? '+' : ''}${delta} min`, {
            field: `${fromStop} → ${toStop}`,
            newValue: delta,
            count: targetTable.trips.length
        });

        targetTable.trips.forEach(trip => {
            for (let i = toIdx; i < targetTable.stops.length; i++) {
                const stop = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[stop]);
                if (t !== null) {
                    trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleSingleTripTravelAdjust = (tripId: string, fromStop: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const fromIdx = targetTable.stops.indexOf(fromStop);
        if (fromIdx === -1) return;

        // Adjust this stop and all subsequent stops for this trip only
        for (let i = fromIdx; i < targetTable.stops.length; i++) {
            const stop = targetTable.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[stop]);
            if (t !== null) {
                trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleBulkAdjustRecoveryTime = (stopName: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const stopIdx = targetTable.stops.indexOf(stopName);

        targetTable.trips.forEach(trip => {
            const oldRec = trip.recoveryTimes?.[stopName] || 0;
            const newRec = Math.max(0, oldRec + delta);
            if (!trip.recoveryTimes) trip.recoveryTimes = {};
            trip.recoveryTimes[stopName] = newRec;

            if (stopIdx !== -1) {
                for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                    const s = targetTable.stops[i];
                    const t = TimeUtils.toMinutes(trip.stops[s]);
                    if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + delta);
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleSingleRecoveryAdjust = (tripId: string, stopName: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const stopIdx = targetTable.stops.indexOf(stopName);

        // Adjust recovery for this trip
        const oldRec = trip.recoveryTimes?.[stopName] || 0;
        const newRec = Math.max(0, oldRec + delta);
        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;

        // Cascade time changes to subsequent stops
        if (stopIdx !== -1) {
            for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                const s = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[s]);
                if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + delta);
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

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

            // Extract info
            const direction = table.routeName.includes('(North)') ? 'NORTHBOUND' :
                table.routeName.includes('(South)') ? 'SOUTHBOUND' : 'ALL TRIPS';
            const dayType = table.routeName.includes('Saturday') ? 'Saturday' :
                table.routeName.includes('Sunday') ? 'Sunday' : 'Weekday';
            const baseName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();

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

            // Build column structure
            const columnDefs: { name: string; isRecovery: boolean }[] = [];
            columnDefs.push({ name: 'Block', isRecovery: false });

            table.stops.forEach((stop, idx) => {
                columnDefs.push({ name: stop, isRecovery: false });
                if (idx < table.stops.length - 1) {
                    const hasRecovery = table.trips.some(t => t.recoveryTimes?.[stop] && t.recoveryTimes[stop] > 0);
                    if (hasRecovery) {
                        columnDefs.push({ name: 'R', isRecovery: true });
                    }
                }
            });
            columnDefs.push({ name: 'Travel', isRecovery: false });
            columnDefs.push({ name: 'Recovery', isRecovery: false });
            columnDefs.push({ name: 'Cycle', isRecovery: false });
            columnDefs.push({ name: 'Ratio', isRecovery: false });

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

            // Row 3: Column headers
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

            // Data rows
            table.trips.forEach((trip, tripIdx) => {
                const rowData: (string | number)[] = [trip.blockId];

                table.stops.forEach((stop, idx) => {
                    rowData.push(trip.stops[stop] || '');
                    if (idx < table.stops.length - 1) {
                        const hasRecovery = table.trips.some(t => t.recoveryTimes?.[stop] && t.recoveryTimes[stop] > 0);
                        if (hasRecovery) {
                            rowData.push(trip.recoveryTimes?.[stop] || '');
                        }
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

    // Get routes available for upload (combines North/South tables for each route-day)
    const routesForUpload = useMemo((): RouteForUpload[] => {
        const result: RouteForUpload[] = [];
        consolidatedRoutes.forEach(group => {
            Object.entries(group.days).forEach(([dayType, dayData]) => {
                const north = dayData.north;
                const south = dayData.south;
                if (north || south) {
                    result.push({
                        routeNumber: group.name,
                        dayType: dayType as DayType,
                        displayName: `Route ${group.name} (${dayType})`,
                        tripCount: (north?.trips.length || 0) + (south?.trips.length || 0),
                        northStopCount: north?.stops.length || 0,
                        southStopCount: south?.stops.length || 0
                    });
                }
            });
        });
        return result;
    }, [consolidatedRoutes]);

    // Get North/South tables for a specific route-day
    const getTablesForRoute = (routeNumber: string, dayType: DayType): { north: MasterRouteTable | null; south: MasterRouteTable | null } => {
        const group = consolidatedRoutes.find(g => g.name === routeNumber);
        if (!group) return { north: null, south: null };
        const dayData = group.days[dayType];
        if (!dayData) return { north: null, south: null };
        return { north: dayData.north || null, south: dayData.south || null };
    };

    // Initiate single route upload
    const handleInitiateUpload = async (routeNumber: string, dayType: DayType) => {
        if (!teamId || !userId) {
            showSuccessToast('Please join a team to upload to Master Schedule');
            return;
        }

        const { north, south } = getTablesForRoute(routeNumber, dayType);
        if (!north && !south) {
            showSuccessToast('No schedule data found for this route');
            return;
        }

        try {
            // Use empty table if one direction is missing
            const northTable = north || { routeName: `${routeNumber} (${dayType}) (North)`, stops: [], stopIds: {}, trips: [] };
            const southTable = south || { routeName: `${routeNumber} (${dayType}) (South)`, stops: [], stopIds: {}, trips: [] };

            const confirmation = await prepareUpload(teamId, northTable, southTable, routeNumber, dayType);
            setUploadConfirmation(confirmation);
            setUploadRouteKey({ routeNumber, dayType });
            setShowUploadModal(true);
        } catch (error) {
            console.error('Error preparing upload:', error);
            showSuccessToast('Failed to prepare upload');
        }
    };

    // Confirm single route upload
    const handleConfirmUpload = async () => {
        if (!teamId || !userId || !uploaderName || !uploadRouteKey) return;

        setIsUploading(true);
        try {
            const { north, south } = getTablesForRoute(uploadRouteKey.routeNumber, uploadRouteKey.dayType);
            const northTable = north || { routeName: `${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) (North)`, stops: [], stopIds: {}, trips: [] };
            const southTable = south || { routeName: `${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) (South)`, stops: [], stopIds: {}, trips: [] };

            await uploadToMasterSchedule(
                teamId,
                userId,
                uploaderName,
                northTable,
                southTable,
                uploadRouteKey.routeNumber,
                uploadRouteKey.dayType,
                'tweaker'
            );

            showSuccessToast(`Route ${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) uploaded to Master`);
            setShowUploadModal(false);
            setUploadConfirmation(null);
            setUploadRouteKey(null);
        } catch (error) {
            console.error('Error uploading to master:', error);
            showSuccessToast('Failed to upload to Master Schedule');
        } finally {
            setIsUploading(false);
        }
    };

    // Bulk upload handler
    const handleBulkUpload = async (selectedRoutes: RouteForUpload[]) => {
        if (!teamId || !userId || !uploaderName) return [];

        const results: Array<{ routeNumber: string; dayType: DayType; success: boolean; error?: string; newVersion?: number }> = [];

        for (const route of selectedRoutes) {
            try {
                const { north, south } = getTablesForRoute(route.routeNumber, route.dayType);
                const northTable = north || { routeName: `${route.routeNumber} (${route.dayType}) (North)`, stops: [], stopIds: {}, trips: [] };
                const southTable = south || { routeName: `${route.routeNumber} (${route.dayType}) (South)`, stops: [], stopIds: {}, trips: [] };

                const entry = await uploadToMasterSchedule(
                    teamId,
                    userId,
                    uploaderName,
                    northTable,
                    southTable,
                    route.routeNumber,
                    route.dayType,
                    'tweaker'
                );

                results.push({
                    routeNumber: route.routeNumber,
                    dayType: route.dayType,
                    success: true,
                    newVersion: entry.currentVersion
                });
            } catch (error) {
                results.push({
                    routeNumber: route.routeNumber,
                    dayType: route.dayType,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount > 0) {
            showSuccessToast(`${successCount} route(s) uploaded to Master Schedule`);
        }

        return results;
    };

    // Active Data
    const activeRouteGroup = consolidatedRoutes[activeRouteIdx];
    const activeRoute = activeRouteGroup?.days[activeDay] || activeRouteGroup?.days[Object.keys(activeRouteGroup?.days || {})[0]];
    const summaryTable = useMemo(() => {
        if (!activeRoute) return { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
        if (activeRoute.combined) return { routeName: activeRouteGroup.name, trips: [...(activeRoute.north?.trips || []), ...(activeRoute.south?.trips || [])], stops: [], stopIds: {} };
        return activeRoute.north || activeRoute.south || { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
    }, [activeRoute]);

    if (!activeRouteGroup || !activeRoute) return <div className="p-8 text-center text-gray-400">No Routes Loaded</div>;

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

            {/* Scenario Comparison Modal */}
            <ScenarioComparisonModal
                isOpen={showComparisonModal}
                onClose={() => setShowComparisonModal(false)}
                currentSchedules={schedules}
                baselineSchedules={originalSchedules || null}
                currentLabel={draftName}
                baselineLabel="Original"
            />

            {/* Upload to Master Modal (Single Route) */}
            <UploadToMasterModal
                isOpen={showUploadModal}
                confirmation={uploadConfirmation}
                onConfirm={handleConfirmUpload}
                onCancel={() => {
                    setShowUploadModal(false);
                    setUploadConfirmation(null);
                    setUploadRouteKey(null);
                }}
                isUploading={isUploading}
            />

            {/* Bulk Upload to Master Modal */}
            <BulkUploadToMasterModal
                isOpen={showBulkUploadModal}
                routes={routesForUpload}
                onConfirm={handleBulkUpload}
                onCancel={() => setShowBulkUploadModal(false)}
            />

            <div className={`h-full flex flex-col bg-gray-50/30 overflow-hidden ${isFullScreen ? 'fixed inset-0 z-[9999] bg-white' : ''}`}>
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
                    />
                )}

                <div className="flex-grow flex overflow-hidden">
                    {/* Sidebar - hidden in embedded mode */}
                    {!isFullScreen && !embedded && (
                        <div className="w-80 min-w-[320px] flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden z-20">
                            {/* Header */}
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-sm font-bold uppercase tracking-wider">{readOnly ? 'Master Schedule' : 'Route Tweaker'}</h2>
                                {onClose && <button onClick={onClose} className="text-xs text-blue-600 flex items-center gap-1"><ArrowLeft size={10} /> Back</button>}
                            </div>

                            {/* Route List */}
                            <div className="overflow-y-auto custom-scrollbar flex-grow p-4 space-y-2">
                                {consolidatedRoutes.map((route, i) => (
                                    <div key={route.name} className="space-y-1">
                                        <button
                                            onClick={() => setActiveRouteIdx(i)}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex justify-between items-center ${i === activeRouteIdx ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}
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
                                                            className={`flex-1 text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 ${activeDay === day ? 'bg-blue-100 font-bold text-blue-800' : 'text-gray-500 hover:bg-gray-50'}`}
                                                        >
                                                            <div className={`w-1.5 h-1.5 rounded-full ${activeDay === day ? 'bg-blue-600' : 'bg-gray-300'}`} />
                                                            {day}
                                                        </button>
                                                        {teamId && !readOnly && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleInitiateUpload(route.name, day as DayType);
                                                                }}
                                                                className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
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
                                                onClick={() => setShowBulkUploadModal(true)}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                                            >
                                                <Database size={16} />
                                                Upload to Master
                                            </button>
                                            <p className="text-xs text-gray-500 text-center mt-2">
                                                {routesForUpload.length} route{routesForUpload.length !== 1 ? 's' : ''} available
                                            </p>
                                        </div>
                                    )}

                                    {/* Editor Actions */}
                                    {subView === 'editor' && (
                                        <div className="p-4 flex gap-2 justify-center">
                                            <button onClick={undo} disabled={!canUndo} className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50" title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
                                            <button onClick={redo} disabled={!canRedo} className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50" title="Redo (Ctrl+Y)"><Redo2 size={16} /></button>
                                            <div className="w-px bg-gray-200 mx-1" />
                                            <button
                                                onClick={() => setShowComparisonModal(true)}
                                                disabled={!originalSchedules}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                                title="Compare with original"
                                            >
                                                <GitCompare size={14} /> Compare
                                            </button>
                                            <button
                                                onClick={() => setShowInterlineConfig(true)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm font-medium"
                                                title="Configure route interlining"
                                            >
                                                <ArrowRight size={14} /> Interline
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-grow min-w-0 overflow-auto flex flex-col p-4">
                        {subView === 'matrix' ? (
                            <TravelTimeGrid
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onBulkAdjust={handleBulkAdjustTravelTime}
                                onRecoveryAdjust={handleBulkAdjustRecoveryTime}
                                onSingleTripAdjust={handleSingleTripTravelAdjust}
                                onSingleRecoveryAdjust={handleSingleRecoveryAdjust}
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
                            (activeRoute.combined && !forceSimpleView) ? (
                                <>
                                    {!isFullScreen && !embedded && <QuickActionsBar filter={filter} onFilterChange={setFilter} />}
                                    <RoundTripTableView
                                        schedules={schedules}
                                        onCellEdit={readOnly ? undefined : handleCellEdit}
                                        onTimeAdjust={readOnly ? undefined : handleTimeAdjust}
                                        onRecoveryEdit={readOnly ? undefined : handleRecoveryEdit}
                                        originalSchedules={originalSchedules}
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
                                    />
                                </>
                            ) : (
                                <SingleRouteView
                                    table={activeRoute.north || activeRoute.south!}
                                    originalTable={originalSchedules?.find(t => t.routeName === (activeRoute.north?.routeName || activeRoute.south?.routeName))}
                                    onCellEdit={readOnly ? undefined : handleCellEdit}
                                    onRecoveryEdit={readOnly ? undefined : handleRecoveryEdit}
                                    onTimeAdjust={readOnly ? undefined : handleTimeAdjust}
                                    onDeleteTrip={readOnly ? undefined : handleDeleteTrip}
                                    onDuplicateTrip={readOnly ? undefined : handleDuplicateTrip}
                                    onAddTrip={readOnly ? undefined : (_, tripId) => openAddTripModal(tripId, {})}
                                    readOnly={readOnly}
                                />
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Interline Config Panel */}
            <InterlineConfigPanel
                isOpen={showInterlineConfig}
                onClose={() => setShowInterlineConfig(false)}
                config={interlineConfig}
                onConfigChange={setInterlineConfig}
                tables={schedules}
                onApplyRules={handleApplyInterlineRules}
            />

            {/* Audit Log Panel */}
            <AuditLogPanel
                entries={auditEntries}
                isOpen={showAuditLog}
                onToggle={() => setShowAuditLog(!showAuditLog)}
            />

        </>
    );
};
