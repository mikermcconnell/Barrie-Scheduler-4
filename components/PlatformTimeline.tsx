/**
 * Platform Timeline Component
 *
 * SVG Gantt visualization of platform utilization across transit hubs.
 * Replaces the card-based PlatformSummary with a time-axis timeline.
 */

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
    AlertTriangle,
    Bus,
    CircleHelp,
    Clock,
    MapPin,
    X,
    ZoomIn,
    ZoomOut,
    Settings
} from 'lucide-react';
import { getRouteColor, getRouteTextColor } from '../utils/config/routeColors';
import {
    aggregatePlatformData,
    formatMinutesToTime,
    type HubAnalysis,
    type PlatformAnalysis,
    type DwellEvent,
    type ConflictWindow
} from '../utils/platform/platformAnalysis';
import type { MasterScheduleEntry, MasterScheduleContent, RouteIdentity, DayType } from '../utils/masterScheduleTypes';
import { useTeam } from './contexts/TeamContext';
import { useAuth } from './contexts/AuthContext';
import { usePlatformConfig } from '../hooks/usePlatformConfig';
import { PlatformConfigEditor } from './PlatformConfigEditor';
import {
    describePlatformRouteDirection,
    formatPlatformRouteDirection,
    getDisplayRoutes,
    getPlatformDirectionBadge
} from '../utils/platform/platformDisplay';

// ============ CONSTANTS ============

const GUTTER_WIDTH = 180;
const ROW_HEIGHT = 28;
const HUB_HEADER_HEIGHT = 24;
const AXIS_HEIGHT = 32;
const PADDING_BOTTOM = 16;

// Operational window: 5:00 AM (300 min) to 1:30 AM next day (1530 min)
const TIME_START = 300;   // 5:00 AM
const TIME_END = 1530;    // 1:30 AM next day (25.5 hours * 60)
const TIME_SPAN = TIME_END - TIME_START; // 1230 minutes

const ZOOM_LEVELS = [1, 2, 4] as const;

// ============ PROPS ============

interface PlatformTimelineProps {
    dayType: DayType;
    schedules: MasterScheduleEntry[];
    contentCache: Map<RouteIdentity, MasterScheduleContent>;
    loadingContent?: boolean;
}

// ============ HELPER: time→pixel ============

function timeToX(minutes: number, timelineWidth: number): number {
    return GUTTER_WIDTH + ((minutes - TIME_START) / TIME_SPAN) * timelineWidth;
}

interface ConflictMarkerData {
    hubName: string;
    platformId: string;
    capacity: number;
    window: ConflictWindow;
}

type ConflictType = 'true_overlap' | 'same_vehicle_handoff' | 'mapping_ambiguity';

interface ConflictVehicle {
    key: string;
    route: string;
    direction: 'North' | 'South';
    blockId: string;
    gtfsBlockId?: string;
    stopName: string;
    stopId?: string;
    arrivalMin: number;
    departureMin: number;
}

interface ConflictDiagnostics {
    conflictType: ConflictType;
    overBy: number;
    vehicles: ConflictVehicle[];
    distinctStopCodes: string[];
    distinctStops: string[];
    reason: string;
}

interface PlatformReassignmentSuggestion {
    eventUid: string;
    route: string;
    direction: 'North' | 'South';
    blockLabel: string;
    fromPlatformId: string;
    toPlatformId: string;
    startMin: number;
    endMin: number;
    projectedLoadAfterMove: number;
    capacity: number;
}

function getVehicleKey(event: DwellEvent): string {
    const gtfs = event.gtfsBlockId?.trim().toUpperCase();
    if (gtfs) return `gtfs:${gtfs}`;
    const block = event.blockId?.trim().toUpperCase();
    if (block) return `block:${block}`;
    return `trip:${event.tripId}`;
}

function getEventDirectionLabel(event: Pick<DwellEvent, 'route' | 'direction'>): string | null {
    return getPlatformDirectionBadge(event.route, event.direction);
}

function buildEventAriaLabel(event: DwellEvent): string {
    return [
        describePlatformRouteDirection(event.route, event.direction),
        `${formatMinutesToTime(event.arrivalMin)} to ${formatMinutesToTime(event.departureMin)}`,
        event.stopId ? `${event.stopName}, stop ${event.stopId}` : event.stopName
    ].join(', ');
}

function buildConflictAriaLabel(conflict: ConflictMarkerData): string {
    const diagnostics = getConflictDiagnostics(conflict);
    return [
        `Conflict at ${conflict.hubName} ${conflict.platformId}`,
        `${formatMinutesToTime(conflict.window.startMin)} to ${formatMinutesToTime(conflict.window.endMin)}`,
        `Demand ${conflict.window.busCount} versus capacity ${conflict.capacity}`,
        diagnostics.reason
    ].join(', ');
}

function getConflictDiagnostics(conflict: ConflictMarkerData): ConflictDiagnostics {
    const vehiclesByKey = new Map<string, ConflictVehicle>();

    for (const event of conflict.window.events) {
        const key = getVehicleKey(event);
        if (!vehiclesByKey.has(key)) {
            vehiclesByKey.set(key, {
                key,
                route: event.route,
                direction: event.direction,
                blockId: event.blockId,
                gtfsBlockId: event.gtfsBlockId,
                stopName: event.stopName,
                stopId: event.stopId,
                arrivalMin: event.arrivalMin,
                departureMin: event.departureMin
            });
        }
    }

    const vehicles = Array.from(vehiclesByKey.values())
        .sort((a, b) => a.arrivalMin - b.arrivalMin);

    const distinctStopCodes = Array.from(new Set(
        conflict.window.events
            .map(e => e.stopId?.trim())
            .filter((v): v is string => !!v)
    ));

    const distinctStops = Array.from(new Set(
        conflict.window.events
            .map(e => e.stopName.trim())
            .filter(Boolean)
    ));

    const hasPotentialHandoff = conflict.window.events.length > vehicles.length;
    const hasMappingAmbiguity = distinctStopCodes.length > 1;

    let conflictType: ConflictType = 'true_overlap';
    if (hasMappingAmbiguity) {
        conflictType = 'mapping_ambiguity';
    } else if (hasPotentialHandoff) {
        conflictType = 'same_vehicle_handoff';
    }

    const overBy = Math.max(0, conflict.window.busCount - conflict.capacity);

    const reasonByType: Record<ConflictType, string> = {
        true_overlap: `Demand exceeds capacity by ${overBy} bus${overBy !== 1 ? 'es' : ''} in this window.`,
        same_vehicle_handoff: 'At least one physical vehicle appears multiple times in overlapping events (possible direction/branch handoff).',
        mapping_ambiguity: 'Overlapping events use different stop codes on the same platform assignment (possible platform mapping ambiguity).'
    };

    return {
        conflictType,
        overBy,
        vehicles,
        distinctStopCodes,
        distinctStops,
        reason: reasonByType[conflictType]
    };
}

function getConflictTypeBadge(conflictType: ConflictType): { label: string; className: string } {
    if (conflictType === 'mapping_ambiguity') {
        return {
            label: 'Mapping Ambiguity',
            className: 'bg-amber-100 text-amber-800 border border-amber-200'
        };
    }
    if (conflictType === 'same_vehicle_handoff') {
        return {
            label: 'Same-Vehicle Handoff',
            className: 'bg-blue-100 text-blue-800 border border-blue-200'
        };
    }
    return {
        label: 'True Overlap',
        className: 'bg-red-100 text-red-800 border border-red-200'
    };
}

function getBaseRoute(route: string): string {
    return route.trim().toUpperCase().replace(/[A-Z]$/i, '');
}

function canPlatformServeRoute(platform: PlatformAnalysis, route: string): boolean {
    const normalizedRoute = route.trim().toUpperCase();
    const baseRoute = getBaseRoute(normalizedRoute);
    return platform.routes.some(r => {
        const candidate = r.trim().toUpperCase();
        return candidate === normalizedRoute || candidate === baseRoute;
    });
}

function countActiveVehicles(
    platform: PlatformAnalysis,
    startMin: number,
    endMin: number
): number {
    const vehicles = new Set<string>();
    for (const event of platform.events) {
        if (event.arrivalMin < endMin && event.departureMin > startMin) {
            vehicles.add(getVehicleKey(event));
        }
    }
    return vehicles.size;
}

function getReassignmentSuggestions(
    conflict: ConflictMarkerData,
    hubAnalyses: HubAnalysis[]
): PlatformReassignmentSuggestion[] {
    const hub = hubAnalyses.find(h => h.hubName === conflict.hubName);
    if (!hub) return [];

    const sourcePlatform = hub.platforms.find(p => p.platformId === conflict.platformId);
    if (!sourcePlatform) return [];

    const uniqueEvents = Array.from(
        new Map(conflict.window.events.map(event => [event.eventUid, event])).values()
    );

    const suggestions: PlatformReassignmentSuggestion[] = [];
    for (const event of uniqueEvents) {
        const compatibleTargets = hub.platforms.filter(platform =>
            platform.platformId !== sourcePlatform.platformId &&
            canPlatformServeRoute(platform, event.route)
        );

        const viable = compatibleTargets
            .map(platform => {
                const activeVehicles = countActiveVehicles(
                    platform,
                    event.arrivalMin,
                    event.departureMin
                );
                return { platform, activeVehicles };
            })
            .filter(({ platform, activeVehicles }) => activeVehicles < platform.capacity)
            .sort((a, b) => {
                const spareA = a.platform.capacity - a.activeVehicles;
                const spareB = b.platform.capacity - b.activeVehicles;
                if (spareA !== spareB) return spareB - spareA;
                return a.activeVehicles - b.activeVehicles;
            });

        const best = viable[0];
        if (!best) continue;

        suggestions.push({
            eventUid: event.eventUid,
            route: event.route,
            direction: event.direction,
            blockLabel: event.gtfsBlockId ? `GTFS ${event.gtfsBlockId}` : `Block ${event.blockId}`,
            fromPlatformId: sourcePlatform.platformId,
            toPlatformId: best.platform.platformId,
            startMin: event.arrivalMin,
            endMin: event.departureMin,
            projectedLoadAfterMove: best.activeVehicles + 1,
            capacity: best.platform.capacity
        });
    }

    return suggestions;
}

// ============ TOOLTIP STATE ============

type TooltipData =
    | { kind: 'event'; event: DwellEvent; x: number; y: number }
    | { kind: 'conflict'; conflict: ConflictMarkerData; x: number; y: number };

// ============ MAIN COMPONENT ============

export const PlatformTimeline: React.FC<PlatformTimelineProps> = ({
    dayType,
    schedules,
    contentCache,
    loadingContent = false
}) => {
    const { team, canManageTeam } = useTeam();
    const { user } = useAuth();
    const { config, loading: configLoading, error: configError, refresh: refreshConfig } = usePlatformConfig(team?.id);

    const [visibleHubs, setVisibleHubs] = useState<Set<string>>(new Set());
    const [zoomIndex, setZoomIndex] = useState(0);
    const [showConflictsOnly, setShowConflictsOnly] = useState(false);
    const [tooltip, setTooltip] = useState<TooltipData | null>(null);
    const [selectedConflict, setSelectedConflict] = useState<ConflictMarkerData | null>(null);
    const [showConfigEditor, setShowConfigEditor] = useState(false);
    const [hubsInitialized, setHubsInitialized] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [containerWidth, setContainerWidth] = useState(900);

    const zoomLevel = ZOOM_LEVELS[zoomIndex];

    // Resize observer
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Aggregate analysis
    const hubAnalyses = useMemo(() => {
        const relevantSchedules: MasterScheduleContent[] = [];
        const routeNumbers: string[] = [];

        for (const entry of schedules) {
            if (entry.dayType === dayType) {
                const content = contentCache.get(entry.id as RouteIdentity);
                if (content) {
                    relevantSchedules.push(content);
                    routeNumbers.push(entry.routeNumber);
                }
            }
        }

        if (relevantSchedules.length === 0) return [];

        return aggregatePlatformData(
            relevantSchedules,
            routeNumbers,
            config?.hubs
        );
    }, [schedules, dayType, contentCache, config]);

    // Initialize visible hubs (show all when data first loads)
    useEffect(() => {
        if (hubAnalyses.length > 0 && !hubsInitialized) {
            setVisibleHubs(new Set(hubAnalyses.map(h => h.hubName)));
            setHubsInitialized(true);
        }
    }, [hubAnalyses, hubsInitialized]);

    // Reset hub initialization when day type changes
    useEffect(() => {
        setHubsInitialized(false);
    }, [dayType]);

    // Stats
    const loadedScheduleCount = schedules.filter(s =>
        s.dayType === dayType && contentCache.has(s.id as RouteIdentity)
    ).length;
    const totalSchedulesForDayType = schedules.filter(s => s.dayType === dayType).length;

    const totalVisits = hubAnalyses.reduce((sum, h) => sum + h.totalDailyVisits, 0);
    const totalConflicts = hubAnalyses.reduce((sum, h) => sum + h.totalConflictWindows, 0);
    const hubsWithConflicts = hubAnalyses.filter(h => h.conflictCount > 0).length;

    // Filter/group hubs + platforms for current view mode
    const filteredHubGroups = useMemo(() => {
        return hubAnalyses
            .filter(hub => visibleHubs.has(hub.hubName))
            .map(hub => {
                const activePlatforms = hub.platforms
                    .filter(platform => platform.routes.length > 0)
                    .filter(platform => !showConflictsOnly || platform.conflictWindows.length > 0)
                    .map(platform => {
                        if (!showConflictsOnly) return platform;

                        // In conflicts-only mode, keep only bars that overlap conflict windows.
                        const conflictEvents = platform.events.filter(event =>
                            platform.conflictWindows.some(window =>
                                event.departureMin > window.startMin && event.arrivalMin < window.endMin
                            )
                        );
                        const conflictRoutes = Array.from(new Set(conflictEvents.map(e => e.route))).sort();

                        return {
                            ...platform,
                            events: conflictEvents,
                            routes: conflictRoutes.length > 0 ? conflictRoutes : platform.routes
                        };
                    });

                return { hub, activePlatforms };
            })
            .filter(group => !showConflictsOnly || group.activePlatforms.length > 0);
    }, [hubAnalyses, visibleHubs, showConflictsOnly]);

    // SVG dimensions
    const timelineWidth = (containerWidth - GUTTER_WIDTH) * zoomLevel;
    const totalSvgWidth = GUTTER_WIDTH + timelineWidth;

    // Calculate SVG height based on visible hubs/platforms
    let totalRows = 0;
    for (const group of filteredHubGroups) {
        totalRows += 1; // hub header
        totalRows += group.activePlatforms.length;
    }
    const svgHeight = AXIS_HEIGHT + totalRows * ROW_HEIGHT + PADDING_BOTTOM;

    // Toggle hub visibility
    const toggleHub = (hubName: string) => {
        setVisibleHubs(prev => {
            const next = new Set(prev);
            if (next.has(hubName)) {
                next.delete(hubName);
            } else {
                next.add(hubName);
            }
            return next;
        });
    };

    // Collect all unique routes from visible data for legend
    const allRoutes = useMemo(() => {
        const routes = new Set<string>();
        for (const group of filteredHubGroups) {
            for (const platform of group.activePlatforms) {
                for (const event of platform.events) {
                    routes.add(event.route);
                }
            }
        }
        return Array.from(routes).sort();
    }, [filteredHubGroups]);

    const hasConflictViewData = filteredHubGroups.some(group => group.activePlatforms.length > 0);

    // Current time indicator (minutes from midnight)
    const now = new Date();
    const currentTimeMin = now.getHours() * 60 + now.getMinutes();

    // Tooltip handlers
    const handleBarMouseEnter = useCallback((event: DwellEvent, svgX: number, svgY: number) => {
        setTooltip({ kind: 'event', event, x: svgX, y: svgY });
    }, []);

    const handleConflictMouseEnter = useCallback((conflict: ConflictMarkerData, svgX: number, svgY: number) => {
        setTooltip({ kind: 'conflict', conflict, x: svgX, y: svgY });
    }, []);

    const handleConflictClick = useCallback((conflict: ConflictMarkerData) => {
        setSelectedConflict(conflict);
        setTooltip(null);
    }, []);

    const handleBarMouseLeave = useCallback(() => {
        setTooltip(null);
    }, []);

    if (loadedScheduleCount === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <MapPin size={48} className="mb-4 opacity-50" />
                <p className="text-lg font-medium">
                    {loadingContent && totalSchedulesForDayType > 0
                        ? `Loading ${dayType} schedules…`
                        : `No schedules loaded for ${dayType}`}
                </p>
                <p className="text-sm mt-2">
                    {totalSchedulesForDayType > 0
                        ? loadingContent
                            ? `Loading ${totalSchedulesForDayType} available schedule(s) for platform analysis`
                            : `Open the Platforms tab and the schedules for ${dayType} will load automatically`
                        : 'No schedules have been uploaded for this day type yet'}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <TimelineHeader
                totalVisits={totalVisits}
                totalConflicts={totalConflicts}
                hubsWithConflicts={hubsWithConflicts}
                loadedScheduleCount={loadedScheduleCount}
                totalSchedulesForDayType={totalSchedulesForDayType}
                hubAnalyses={hubAnalyses}
                visibleHubs={visibleHubs}
                onToggleHub={toggleHub}
                zoomIndex={zoomIndex}
                onZoomIn={() => setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
                onZoomOut={() => setZoomIndex(i => Math.max(i - 1, 0))}
                zoomLevel={zoomLevel}
                showConflictsOnly={showConflictsOnly}
                onToggleConflictsOnly={() => setShowConflictsOnly(v => !v)}
                onOpenConfig={() => setShowConfigEditor(true)}
                canEditConfig={canManageTeam}
                configLoading={configLoading}
            />

            {configLoading && (
                <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    Loading platform configuration…
                </div>
            )}

            {configError && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    {configError}
                </div>
            )}

            {showConflictsOnly && !hasConflictViewData ? (
                <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-gray-500">
                    No conflict windows found for loaded {dayType} routes.
                </div>
            ) : (
                <div className="flex items-start gap-4">
                    {/* Scrollable SVG container */}
                    <div
                        ref={containerRef}
                        className="relative bg-white border border-gray-200 rounded-lg overflow-x-auto flex-1 min-w-0"
                        style={{ maxHeight: '70vh' }}
                    >
                        <svg
                            ref={svgRef}
                            width={totalSvgWidth}
                            height={svgHeight}
                            className="block"
                        >
                            {/* Time axis */}
                            <TimeAxis timelineWidth={timelineWidth} />

                            {/* Hub groups */}
                            {(() => {
                                let yOffset = AXIS_HEIGHT;
                                return filteredHubGroups.map(group => {
                                    const groupHeight = HUB_HEADER_HEIGHT + group.activePlatforms.length * ROW_HEIGHT;
                                    const startY = yOffset;
                                    yOffset += groupHeight;
                                    return (
                                    <HubGroup
                                        key={group.hub.hubName}
                                        hub={group.hub}
                                        activePlatforms={group.activePlatforms}
                                        y={startY}
                                        timelineWidth={timelineWidth}
                                        totalSvgWidth={totalSvgWidth}
                                        onBarMouseEnter={handleBarMouseEnter}
                                        onConflictMouseEnter={handleConflictMouseEnter}
                                        onMarkerMouseLeave={handleBarMouseLeave}
                                        onConflictClick={handleConflictClick}
                                    />
                                    );
                                });
                            })()}

                            {/* Current time indicator */}
                            {currentTimeMin >= TIME_START && currentTimeMin <= TIME_END && (
                                <line
                                    x1={timeToX(currentTimeMin, timelineWidth)}
                                    y1={AXIS_HEIGHT}
                                    x2={timeToX(currentTimeMin, timelineWidth)}
                                    y2={svgHeight - PADDING_BOTTOM}
                                    stroke="#6366F1"
                                    strokeWidth={1.5}
                                    strokeDasharray="6,3"
                                    opacity={0.7}
                                />
                            )}
                        </svg>

                        {/* Tooltip (HTML over SVG) */}
                        {tooltip && (
                            <TooltipOverlay
                                tooltip={tooltip}
                                containerRef={containerRef}
                            />
                        )}
                    </div>

                {selectedConflict && (
                    <ConflictInspectorPanel
                        conflict={selectedConflict}
                        hubAnalyses={hubAnalyses}
                        onClose={() => setSelectedConflict(null)}
                    />
                )}
                </div>
            )}

            {/* Legend */}
            {allRoutes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span className="font-medium mr-1">Routes:</span>
                    {allRoutes.map(route => (
                        <span
                            key={route}
                            className="px-2 py-0.5 rounded font-bold"
                            style={{
                                backgroundColor: getRouteColor(route),
                                color: getRouteTextColor(route)
                            }}
                        >
                            {route}
                        </span>
                    ))}
                    <span className="ml-3 flex items-center gap-1">
                        <span className="inline-block w-4 border-t-[3px] border-red-500" />
                        Conflict
                    </span>
                    <span className="text-[11px] text-gray-500 ml-2">Click a red marker to inspect conflict details</span>
                </div>
            )}

            {/* Config Editor Modal */}
            {showConfigEditor && team && user && canManageTeam && (
                <PlatformConfigEditor
                    teamId={team.id}
                    userId={user.uid}
                    onClose={() => setShowConfigEditor(false)}
                    onSaved={() => {
                        refreshConfig();
                        setShowConfigEditor(false);
                    }}
                />
            )}
        </div>
    );
};

// ============ TIMELINE HEADER ============

interface TimelineHeaderProps {
    totalVisits: number;
    totalConflicts: number;
    hubsWithConflicts: number;
    loadedScheduleCount: number;
    totalSchedulesForDayType: number;
    hubAnalyses: HubAnalysis[];
    visibleHubs: Set<string>;
    onToggleHub: (name: string) => void;
    zoomIndex: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    zoomLevel: number;
    showConflictsOnly: boolean;
    onToggleConflictsOnly: () => void;
    onOpenConfig: () => void;
    canEditConfig: boolean;
    configLoading: boolean;
}

const TimelineHeader: React.FC<TimelineHeaderProps> = ({
    totalVisits,
    totalConflicts,
    hubsWithConflicts,
    loadedScheduleCount,
    totalSchedulesForDayType,
    hubAnalyses,
    visibleHubs,
    onToggleHub,
    zoomIndex,
    onZoomIn,
    onZoomOut,
    zoomLevel,
    showConflictsOnly,
    onToggleConflictsOnly,
    onOpenConfig,
    canEditConfig,
    configLoading
}) => {
    const [showExplain, setShowExplain] = useState(false);

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            {/* Summary row */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-5 flex-wrap">
                    <div className="flex items-center gap-1.5">
                        <Bus className="text-gray-400" size={18} />
                        <span className="text-sm text-gray-600">
                            <span className="font-bold text-gray-900">{totalVisits}</span> visits
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Clock className="text-gray-400" size={18} />
                        <span className="text-sm text-gray-600">
                            <span className="font-bold text-gray-900">{loadedScheduleCount}</span>/{totalSchedulesForDayType} routes
                        </span>
                    </div>
                    {totalConflicts > 0 && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 rounded-full">
                            <AlertTriangle className="text-red-500" size={14} />
                            <span className="text-sm font-medium text-red-700">
                                {totalConflicts} conflict{totalConflicts !== 1 ? 's' : ''} at {hubsWithConflicts} hub{hubsWithConflicts !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                    <button
                        onClick={() => setShowExplain(v => !v)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                        title="How conflicts are computed"
                    >
                        <CircleHelp size={13} />
                        How computed
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onToggleConflictsOnly}
                        className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                            showConflictsOnly
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                        title="Show only conflict lanes and bars"
                    >
                        Conflicts Only
                    </button>
                    {/* Zoom controls */}
                    <button
                        onClick={onZoomOut}
                        disabled={zoomIndex === 0}
                        className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        title="Zoom out"
                    >
                        <ZoomOut size={16} />
                    </button>
                    <span className="text-xs text-gray-500 font-mono w-8 text-center">{zoomLevel}x</span>
                    <button
                        onClick={onZoomIn}
                        disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                        className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        title="Zoom in"
                    >
                        <ZoomIn size={16} />
                    </button>
                    {canEditConfig && (
                        <>
                            <div className="w-px h-5 bg-gray-200 mx-1" />
                            <button
                                onClick={onOpenConfig}
                                disabled={configLoading}
                                className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 transition-colors"
                                title={configLoading ? 'Loading platform configuration' : 'Platform configuration'}
                            >
                                <Settings size={16} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {showExplain && (
                <div className="text-xs text-gray-700 bg-slate-50 border border-slate-200 rounded px-3 py-2.5 space-y-1.5">
                    <div className="font-semibold text-slate-900">How conflict detection works</div>
                    <div>Conflict is flagged when unique physical buses at a platform exceed its configured capacity.</div>
                    <div>Unique bus identity uses `GTFS block` when available, then normalized `Block ID`, then `Trip ID` fallback.</div>
                    <div>Platform assignment uses stop code + exact route matching first, then safe fallback rules.</div>
                    <div>If not all routes are loaded for this day, conflict totals may be incomplete.</div>
                </div>
            )}

            {/* Incomplete data warning */}
            {loadedScheduleCount < totalSchedulesForDayType && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                    Only {loadedScheduleCount} of {totalSchedulesForDayType} routes loaded — conflict detection may be incomplete. Click route tabs to load more.
                </div>
            )}

            {/* Hub filter checkboxes */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 font-medium mr-1">Hubs:</span>
                {hubAnalyses.map(hub => (
                    <label
                        key={hub.hubName}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                            visibleHubs.has(hub.hubName)
                                ? hub.conflictCount > 0
                                    ? 'bg-white text-gray-800 border border-red-300'
                                    : 'bg-white text-gray-800 border border-gray-300'
                                : 'bg-gray-50 text-gray-400 border border-gray-200'
                        }`}
                    >
                        <input
                            type="checkbox"
                            checked={visibleHubs.has(hub.hubName)}
                            onChange={() => onToggleHub(hub.hubName)}
                            className="sr-only"
                        />
                        {hub.hubName}
                        {hub.conflictCount > 0 && (
                            <AlertTriangle
                                size={10}
                                className={visibleHubs.has(hub.hubName) ? 'text-red-500' : 'text-gray-300'}
                            />
                        )}
                    </label>
                ))}
            </div>
        </div>
    );
};

// ============ TIME AXIS ============

interface TimeAxisProps {
    timelineWidth: number;
}

const TimeAxis: React.FC<TimeAxisProps> = ({ timelineWidth }) => {
    // Generate hour ticks from 5 AM to 1 AM next day
    const ticks: { minutes: number; label: string }[] = [];
    for (let h = 5; h <= 25; h++) {
        const displayH = h > 24 ? h - 24 : h;
        const m = h * 60;
        if (m >= TIME_START && m <= TIME_END) {
            const period = displayH >= 12 && displayH < 24 ? 'PM' : 'AM';
            const display12 = displayH > 12 ? displayH - 12 : displayH === 0 ? 12 : displayH;
            ticks.push({ minutes: m, label: `${display12}${period}` });
        }
    }

    return (
        <g>
            {/* Axis background */}
            <rect x={0} y={0} width={GUTTER_WIDTH + timelineWidth} height={AXIS_HEIGHT}
                fill="#F9FAFB" />
            {/* Gutter label */}
            <text x={10} y={20} fontSize={11} fontWeight={600} fill="#6B7280">
                Platform
            </text>
            {/* Tick marks and labels */}
            {ticks.map(tick => {
                const x = timeToX(tick.minutes, timelineWidth);
                return (
                    <g key={tick.minutes}>
                        <line x1={x} y1={AXIS_HEIGHT - 6} x2={x} y2={AXIS_HEIGHT}
                            stroke="#D1D5DB" strokeWidth={1} />
                        <text x={x} y={16} fontSize={10} fill="#9CA3AF" textAnchor="middle">
                            {tick.label}
                        </text>
                    </g>
                );
            })}
            {/* Bottom border */}
            <line x1={0} y1={AXIS_HEIGHT} x2={GUTTER_WIDTH + timelineWidth} y2={AXIS_HEIGHT}
                stroke="#E5E7EB" strokeWidth={1} />
        </g>
    );
};

// ============ HUB GROUP ============

interface HubGroupProps {
    hub: HubAnalysis;
    activePlatforms: PlatformAnalysis[];
    y: number;
    timelineWidth: number;
    totalSvgWidth: number;
    onBarMouseEnter: (event: DwellEvent, x: number, y: number) => void;
    onConflictMouseEnter: (conflict: ConflictMarkerData, x: number, y: number) => void;
    onMarkerMouseLeave: () => void;
    onConflictClick: (conflict: ConflictMarkerData) => void;
}

const HubGroup: React.FC<HubGroupProps> = ({
    hub,
    activePlatforms,
    y,
    timelineWidth,
    totalSvgWidth,
    onBarMouseEnter,
    onConflictMouseEnter,
    onMarkerMouseLeave,
    onConflictClick
}) => (
    <g>
        {/* Hub header row */}
        <rect x={0} y={y} width={totalSvgWidth} height={HUB_HEADER_HEIGHT}
            fill="#F3F4F6" />
        <text x={10} y={y + 16} fontSize={11} fontWeight={700}
            fill="#374151">
            {hub.hubName}
        </text>
        <text x={GUTTER_WIDTH - 10} y={y + 16} fontSize={10} fill="#9CA3AF" textAnchor="end">
            {hub.totalDailyVisits} visits
        </text>
        <line x1={0} y1={y + HUB_HEADER_HEIGHT} x2={totalSvgWidth} y2={y + HUB_HEADER_HEIGHT}
            stroke="#E5E7EB" strokeWidth={0.5} />

        {/* Platform lanes */}
        {activePlatforms.map((platform, idx) => {
            const rowY = y + HUB_HEADER_HEIGHT + idx * ROW_HEIGHT;
            return (
                <PlatformLane
                    key={platform.platformId}
                    platform={platform}
                    y={rowY}
                    timelineWidth={timelineWidth}
                    totalSvgWidth={totalSvgWidth}
                    hubName={hub.hubName}
                    onBarMouseEnter={onBarMouseEnter}
                    onConflictMouseEnter={onConflictMouseEnter}
                    onMarkerMouseLeave={onMarkerMouseLeave}
                    onConflictClick={onConflictClick}
                />
            );
        })}
    </g>
);

// ============ PLATFORM LANE ============

interface PlatformLaneProps {
    hubName: string;
    platform: PlatformAnalysis;
    y: number;
    timelineWidth: number;
    totalSvgWidth: number;
    onBarMouseEnter: (event: DwellEvent, x: number, y: number) => void;
    onConflictMouseEnter: (conflict: ConflictMarkerData, x: number, y: number) => void;
    onMarkerMouseLeave: () => void;
    onConflictClick: (conflict: ConflictMarkerData) => void;
}

const PlatformLane: React.FC<PlatformLaneProps> = ({
    hubName,
    platform,
    y,
    timelineWidth,
    totalSvgWidth,
    onBarMouseEnter,
    onConflictMouseEnter,
    onMarkerMouseLeave,
    onConflictClick
}) => {
    const barY = y + 4;
    const barHeight = ROW_HEIGHT - 8;
    const displayRoutes = getDisplayRoutes(platform.routes);

    return (
        <g>
            {/* Row background */}
            <rect x={0} y={y} width={totalSvgWidth} height={ROW_HEIGHT}
                fill="transparent" />

            {/* Gutter: platform ID */}
            <text x={12} y={y + 18} fontSize={10} fontWeight={600} fill="#4B5563"
                fontFamily="monospace">
                {platform.platformId}
            </text>

            {/* Gutter: route color badges */}
            {displayRoutes.slice(0, 4).map((route, i) => (
                <g key={route}>
                    <rect
                        x={90 + i * 28}
                        y={y + 7}
                        width={26}
                        height={14}
                        rx={3}
                        fill={getRouteColor(route)}
                    />
                    <text
                        x={90 + i * 28 + 13}
                        y={y + 17}
                        fontSize={8}
                        fontWeight={700}
                        fill={getRouteTextColor(route)}
                        textAnchor="middle"
                    >
                        {route}
                    </text>
                </g>
            ))}

            {/* Conflict markers (small red ticks at top of row) */}
            {platform.conflictWindows.map((cw, i) => {
                const x1 = timeToX(cw.startMin, timelineWidth);
                const x2 = timeToX(cw.endMin, timelineWidth);
                const w = Math.max(x2 - x1, 4);
                const hitW = Math.max(w, 14);
                const hitX = x1 - (hitW - w) / 2;
                const conflictMarker: ConflictMarkerData = {
                    hubName,
                    platformId: platform.platformId,
                    capacity: platform.capacity,
                    window: cw
                };
                return (
                    <g key={`conflict-${i}`}>
                        <line
                            x1={x1}
                            y1={y}
                            x2={x1 + w}
                            y2={y}
                            stroke="#FFFFFF"
                            strokeWidth={4}
                        />
                        <line
                            x1={x1}
                            y1={y}
                            x2={x1 + w}
                            y2={y}
                            stroke="#DC2626"
                            strokeWidth={2.5}
                        />
                        <rect
                            x={hitX}
                            y={y - 10}
                            width={hitW}
                            height={20}
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseEnter={() => onConflictMouseEnter(conflictMarker, x1 + w / 2, y)}
                            onMouseLeave={onMarkerMouseLeave}
                            onClick={() => onConflictClick(conflictMarker)}
                            onFocus={() => onConflictMouseEnter(conflictMarker, x1 + w / 2, y)}
                            onBlur={onMarkerMouseLeave}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onConflictClick(conflictMarker);
                                }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={buildConflictAriaLabel(conflictMarker)}
                        />
                    </g>
                );
            })}

            {/* Dwell bars */}
            {platform.events.map(event => {
                const x1 = timeToX(event.arrivalMin, timelineWidth);
                const x2 = timeToX(event.departureMin, timelineWidth);
                const w = Math.max(x2 - x1, 3); // min 3px
                const color = getRouteColor(event.route);

                return (
                    <rect
                        key={event.eventUid}
                        x={x1}
                        y={barY}
                        width={w}
                        height={barHeight}
                        rx={2}
                        fill={color}
                        opacity={0.85}
                        className="cursor-pointer"
                        onMouseEnter={() => onBarMouseEnter(event, x1 + w / 2, y)}
                        onMouseLeave={onMarkerMouseLeave}
                        onFocus={() => onBarMouseEnter(event, x1 + w / 2, y)}
                        onBlur={onMarkerMouseLeave}
                        tabIndex={0}
                        role="img"
                        aria-label={buildEventAriaLabel(event)}
                    />
                );
            })}

            {/* Row bottom border */}
            <line x1={0} y1={y + ROW_HEIGHT} x2={totalSvgWidth} y2={y + ROW_HEIGHT}
                stroke="#F3F4F6" strokeWidth={0.5} />
        </g>
    );
};

// ============ TOOLTIP OVERLAY ============

interface TooltipOverlayProps {
    tooltip: TooltipData;
    containerRef: React.RefObject<HTMLDivElement | null>;
}

const TooltipOverlay: React.FC<TooltipOverlayProps> = ({ tooltip, containerRef }) => {
    const { x, y } = tooltip;

    // Adjust for scroll position
    const scrollLeft = containerRef.current?.scrollLeft || 0;
    const scrollTop = containerRef.current?.scrollTop || 0;
    const left = x - scrollLeft;
    const top = y - scrollTop;

    if (tooltip.kind === 'event') {
        const { event } = tooltip;
        const directionLabel = getEventDirectionLabel(event);
        return (
            <div
                className="absolute pointer-events-none z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
                style={{
                    left: `${left}px`,
                    top: `${top - 8}px`,
                    transform: 'translate(-50%, -100%)',
                    maxWidth: '260px'
                }}
            >
                <div className="flex items-center gap-2 mb-1">
                    <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                        style={{
                            backgroundColor: getRouteColor(event.route),
                            color: getRouteTextColor(event.route)
                        }}
                    >
                        {event.route}
                    </span>
                    {directionLabel && (
                        <span className="font-medium">{directionLabel}</span>
                    )}
                    {event.blockId && (
                        <span className="text-gray-400">Block {event.blockId}</span>
                    )}
                </div>
                <div className="text-gray-300">
                    {formatMinutesToTime(event.arrivalMin)} → {formatMinutesToTime(event.departureMin)}
                </div>
                <div className="text-gray-400 truncate">
                    {event.stopName}
                    {event.stopId ? ` [${event.stopId}]` : ''}
                </div>
            </div>
        );
    }

    const { conflict } = tooltip;
    const diagnostics = getConflictDiagnostics(conflict);
    const badge = getConflictTypeBadge(diagnostics.conflictType);

    return (
        <div
            className="absolute pointer-events-none z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
            style={{
                left: `${left}px`,
                top: `${top - 8}px`,
                transform: 'translate(-50%, -100%)',
                maxWidth: '340px'
            }}
        >
            <div className="font-semibold mb-1">
                Conflict: {formatMinutesToTime(conflict.window.startMin)}-{formatMinutesToTime(conflict.window.endMin)}
            </div>
            <div className="text-gray-300 mb-1">
                {conflict.hubName} • {conflict.platformId}
            </div>
            <div className="text-gray-300 mb-2">
                Demand {conflict.window.busCount} vs capacity {conflict.capacity}
                {diagnostics.overBy > 0 ? ` (over by ${diagnostics.overBy})` : ''}
            </div>
            <div className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold mb-2 ${badge.className}`}>
                {badge.label}
            </div>
            <div className="text-gray-300 text-[11px] mb-1.5">Vehicles involved:</div>
            <div className="space-y-1">
                {diagnostics.vehicles.slice(0, 4).map(v => (
                    <div key={v.key} className="text-[11px] text-gray-200 truncate">
                        {formatPlatformRouteDirection(v.route, v.direction)} •
                        {v.gtfsBlockId ? `GTFS ${v.gtfsBlockId}` : `Block ${v.blockId}`}
                        {v.stopId ? ` • Stop ${v.stopId}` : ''}
                    </div>
                ))}
                {diagnostics.vehicles.length > 4 && (
                    <div className="text-[11px] text-gray-400">+{diagnostics.vehicles.length - 4} more vehicles</div>
                )}
            </div>
            <div className="text-[11px] text-gray-400 mt-2">Click marker for full conflict inspector</div>
        </div>
    );
};

interface ConflictInspectorPanelProps {
    conflict: ConflictMarkerData;
    hubAnalyses: HubAnalysis[];
    onClose: () => void;
}

const ConflictInspectorPanel: React.FC<ConflictInspectorPanelProps> = ({ conflict, hubAnalyses, onClose }) => {
    const diagnostics = useMemo(() => getConflictDiagnostics(conflict), [conflict]);
    const badge = getConflictTypeBadge(diagnostics.conflictType);
    const reassignmentSuggestions = useMemo(
        () => getReassignmentSuggestions(conflict, hubAnalyses),
        [conflict, hubAnalyses]
    );

    const sortedEvents = useMemo(() => {
        return [...conflict.window.events].sort((a, b) => a.arrivalMin - b.arrivalMin);
    }, [conflict]);

    const miniTimelineLayout = useMemo(() => {
        // Interval graph coloring: place each event in the first free lane where
        // arrival >= lane end. Guarantees overlapping events render on separate rows.
        const laneEnds: number[] = [];
        const placed = sortedEvents.map(event => {
            let lane = laneEnds.findIndex(endMin => event.arrivalMin >= endMin);
            if (lane === -1) {
                lane = laneEnds.length;
                laneEnds.push(event.departureMin);
            } else {
                laneEnds[lane] = event.departureMin;
            }
            return { event, lane };
        });
        return {
            placed,
            laneCount: Math.max(1, laneEnds.length)
        };
    }, [sortedEvents]);

    const minT = Math.max(TIME_START, conflict.window.startMin - 10);
    const maxT = Math.min(TIME_END, conflict.window.endMin + 10);
    const span = Math.max(1, maxT - minT);
    const pct = (m: number) => ((m - minT) / span) * 100;

    const MINI_LANE_HEIGHT = 12;
    const MINI_BAR_HEIGHT = 9;
    const MINI_TOP_PADDING = 4;
    const MINI_BOTTOM_PADDING = 4;
    const miniTimelineHeight =
        MINI_TOP_PADDING +
        miniTimelineLayout.laneCount * MINI_LANE_HEIGHT +
        MINI_BOTTOM_PADDING;

    return (
        <aside className="w-[360px] shrink-0 bg-white border border-gray-200 rounded-lg p-4 space-y-4 sticky top-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Conflict Inspector</h3>
                    <div className="text-xs text-gray-500 mt-0.5">
                        {conflict.hubName} • {conflict.platformId}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-gray-100 text-gray-500"
                    title="Close inspector"
                >
                    <X size={14} />
                </button>
            </div>

            <div className="text-sm text-gray-800">
                {formatMinutesToTime(conflict.window.startMin)}-{formatMinutesToTime(conflict.window.endMin)}
            </div>
            <div className="text-xs text-gray-600">
                Demand <span className="font-semibold">{conflict.window.busCount}</span> vs capacity <span className="font-semibold">{conflict.capacity}</span>
                {diagnostics.overBy > 0 ? ` (over by ${diagnostics.overBy})` : ''}
            </div>
            <div className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${badge.className}`}>
                {badge.label}
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-gray-700">Mini Timeline</div>
                <div
                    className="relative bg-gray-50 border border-gray-200 rounded"
                    style={{ height: `${miniTimelineHeight}px` }}
                >
                    <div
                        className="absolute top-0 bottom-0 bg-red-100 border-l border-r border-red-300"
                        style={{
                            left: `${pct(conflict.window.startMin)}%`,
                            width: `${Math.max(1, pct(conflict.window.endMin) - pct(conflict.window.startMin))}%`
                        }}
                    />
                    {miniTimelineLayout.placed.map(({ event, lane }) => {
                        const left = pct(event.arrivalMin);
                        const width = Math.max(1, pct(event.departureMin) - left);
                        return (
                            <div
                                key={`${event.eventUid}-mini`}
                                className="absolute rounded"
                                style={{
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    top: `${MINI_TOP_PADDING + lane * MINI_LANE_HEIGHT}px`,
                                    height: `${MINI_BAR_HEIGHT}px`,
                                    backgroundColor: getRouteColor(event.route),
                                    opacity: 0.85
                                }}
                            />
                        );
                    })}
                </div>
                <div className="flex justify-between text-[11px] text-gray-500">
                    <span>{formatMinutesToTime(minT)}</span>
                    <span>{formatMinutesToTime(maxT)}</span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-gray-700">Why Flagged</div>
                <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">
                    {diagnostics.reason}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-gray-700">Optimizer (Same Hub)</div>
                {reassignmentSuggestions.length > 0 ? (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {reassignmentSuggestions.slice(0, 6).map(suggestion => (
                            <div key={suggestion.eventUid} className="text-xs border border-emerald-200 bg-emerald-50 rounded px-2 py-1.5">
                                <div className="font-medium text-emerald-800">
                                    Move {formatPlatformRouteDirection(suggestion.route, suggestion.direction)}: {suggestion.fromPlatformId} → {suggestion.toPlatformId}
                                </div>
                                <div className="text-emerald-700">
                                    {formatMinutesToTime(suggestion.startMin)} → {formatMinutesToTime(suggestion.endMin)} • {suggestion.blockLabel}
                                </div>
                                <div className="text-emerald-700">
                                    Projected load: {suggestion.projectedLoadAfterMove}/{suggestion.capacity}
                                </div>
                            </div>
                        ))}
                        {reassignmentSuggestions.length > 6 && (
                            <div className="text-[11px] text-gray-500">+{reassignmentSuggestions.length - 6} more possible reassignments</div>
                        )}
                    </div>
                ) : (
                    <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
                        No free compatible platform found at this hub for the conflicting trips.
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-gray-700">Trips In Window</div>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {sortedEvents.map(event => {
                        const directionLabel = getEventDirectionLabel(event);
                        return (
                        <div key={event.eventUid} className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                                    style={{
                                        backgroundColor: getRouteColor(event.route),
                                        color: getRouteTextColor(event.route)
                                    }}
                                >
                                    {event.route}
                                </span>
                                {directionLabel && (
                                    <span className="font-medium text-gray-800">{directionLabel}</span>
                                )}
                                <span className="text-gray-500">
                                    {event.gtfsBlockId ? `GTFS ${event.gtfsBlockId}` : `Block ${event.blockId}`}
                                </span>
                                {event.stopId && <span className="text-gray-500">Stop {event.stopId}</span>}
                            </div>
                            <div className="text-gray-600 mt-1">
                                {formatMinutesToTime(event.arrivalMin)} → {formatMinutesToTime(event.departureMin)}
                            </div>
                            <div className="text-gray-500 truncate">{event.stopName}</div>
                        </div>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
};

export default PlatformTimeline;
