/**
 * RoundTripTableView Component
 *
 * Displays schedules in a combined North/South round-trip format.
 * Shows trips paired by block with metrics.
 *
 * Extracted from ScheduleEditor.tsx for maintainability.
 */

import React, { useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Plus,
    Pencil,
    Trash2,
    ArrowUpDown
} from 'lucide-react';
import {
    MasterRouteTable,
    MasterTrip,
    RoundTripTable,
    buildRoundTripView
} from '../../utils/masterScheduleParser';
import { TimeUtils } from '../../utils/timeUtils';
import { getRouteVariant, getRouteConfig, getDirectionDisplay, extractDirectionFromName, parseRouteInfo } from '../../utils/routeDirectionConfig';
import {
    calculateHeadways,
    getRatioColor,
    getRecoveryStatus,
    calculatePeakVehicles,
    calculateServiceSpan,
    analyzeHeadways,
    calculateTripsPerHour,
    getBandRowColor,
    parseTimeInput,
    validateSchedule,
    compareBlockIds
} from '../../utils/scheduleEditorUtils';
import { getOperationalSortTime } from '../../utils/blockAssignmentCore';
import {
    FilterState,
    shouldGrayOutTrip,
    shouldHighlightTrip,
    matchesSearch
} from '../NewSchedule/QuickActionsBar';
import { StackedTimeCell, StackedTimeInput } from '../ui/StackedTimeInput';
import type { ConnectionLibrary } from '../../utils/connectionTypes';
import type { DayType } from '../../utils/masterScheduleParser';
import { getConnectionsForStop } from '../../utils/connectionUtils';
import { ConnectionIndicator } from './ConnectionIndicator';

// --- Spreadsheet-style column letters ---
// Converts 0-indexed column number to Excel-style letter (A, B, C... Z, AA, AB...)
const getColumnLetter = (colIndex: number): string => {
    let result = '';
    let n = colIndex;
    while (n >= 0) {
        result = String.fromCharCode((n % 26) + 65) + result;
        n = Math.floor(n / 26) - 1;
    }
    return result;
};

// Column info for tooltip display
interface ColumnInfo {
    letter: string;
    label: string; // e.g., "Block", "Stop Name ARR", etc.
}

type DensityMode = 'ultra' | 'compact' | 'comfortable';

const STOP_ABBREVIATIONS: Array<[RegExp, string]> = [
    [/barrie south go station/gi, 'B. South GO'],
    [/barrie allandale transit terminal platforms?/gi, 'Allandale Term'],
    [/barrie allandale transit terminal/gi, 'Allandale Term'],
    [/georgian college/gi, 'Georgian Coll'],
    [/park place/gi, 'Park Pl'],
    [/downtown/gi, 'Downtown'],
    [/station/gi, 'Stn'],
    [/terminal/gi, 'Term'],
    [/community centre/gi, 'Comm Ctr'],
    [/community/gi, 'Comm'],
    [/veterans/gi, 'Vets'],
    [/mapleview/gi, 'Mapleview'],
    [/essa at/gi, 'Essa @'],
    [/peggy hill/gi, 'Peggy Hill']
];

const abbreviateStopName = (name: string): string => {
    let out = name;
    for (const [pattern, replacement] of STOP_ABBREVIATIONS) {
        out = out.replace(pattern, replacement);
    }
    return out.replace(/\s+/g, ' ').trim();
};

const isMajorTimepointStop = (stopName: string, index: number, stops: string[]): boolean => {
    if (index === 0 || index === stops.length - 1) return true;
    const n = stopName.toLowerCase();
    return (
        n.includes('terminal') ||
        n.includes('station') ||
        n.includes('downtown') ||
        n.includes('allandale') ||
        n.includes('georgian') ||
        n.includes('park place') ||
        n.includes('college') ||
        n.includes('go')
    );
};

const pickDisplayStops = (stops: string[], timepointOnly: boolean): string[] => {
    if (!timepointOnly || stops.length <= 3) return stops;
    const filtered = stops.filter((s, i) => isMajorTimepointStop(s, i, stops));
    if (filtered.length >= 3) return filtered;
    const midpoint = stops[Math.floor(stops.length / 2)];
    return Array.from(new Set([stops[0], midpoint, stops[stops.length - 1]]));
};

// --- Helper: Fuzzy stop name lookup ---
// Handles "(2)", "(3)" suffixes in loop routes where column headers have suffixes
// but trip data may not
const getStopValue = <T,>(record: Record<string, T> | undefined, stopName: string): T | undefined => {
    if (!record) return undefined;
    // Try exact match first
    if (record[stopName] !== undefined) return record[stopName];
    // Strip "(n)" suffix and try base name
    const baseName = stopName.replace(/\s*\(\d+\)$/, '');
    if (baseName !== stopName && record[baseName] !== undefined) return record[baseName];
    // Try case-insensitive match
    const lowerStop = stopName.toLowerCase();
    const lowerBase = baseName.toLowerCase();
    for (const key of Object.keys(record)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === lowerStop || lowerKey === lowerBase) return record[key];
    }
    return undefined;
};

const getArrivalDisplayTime = (trip: MasterTrip | undefined, stopName: string): string => {
    if (!trip) return '';
    return getStopValue(trip.arrivalTimes, stopName) || getStopValue(trip.stops, stopName) || '';
};

const getDepartureDisplayTime = (
    trip: MasterTrip | undefined,
    stopName: string,
    _routeName?: string,
    _isLastSouthStop?: boolean
): string => {
    if (!trip) return '';
    const arrival = getArrivalDisplayTime(trip, stopName);
    if (!arrival) return '';

    const recovery = getStopValue(trip.recoveryTimes, stopName) || 0;

    return recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery);
};

const getDeltaMinutes = (currentTime: string, originalTime: string): number | null => {
    const current = TimeUtils.toMinutes(currentTime);
    const original = TimeUtils.toMinutes(originalTime);
    if (current === null || original === null) return null;

    let diff = current - original;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
};

// --- Georgian College Pattern (moved up for use in getArrivalTimeForStop) ---
const GEORGIAN_COLLEGE_PATTERN = 'georgian college';

/**
 * Check if a stop is Georgian College.
 */
const isGeorgianCollegeStop = (stopName: string): boolean => {
    return stopName.toLowerCase().includes(GEORGIAN_COLLEGE_PATTERN);
};

// Get arrival time for a stop, handling loop routes where final stop uses trip.endTime
const getArrivalTimeForStop = (
    trip: MasterTrip | undefined,
    stopName: string,
    stopIndex: number,
    totalStops: number
): string => {
    if (!trip) return '';

    // Check if this is a "(n)" suffixed stop (loop route second occurrence)
    const hasSuffix = /\s*\(\d+\)$/.test(stopName);
    const isLastStop = stopIndex === totalStops - 1;

    // For loop routes: last stop with suffix uses trip.endTime
    if (hasSuffix && isLastStop) {
        return TimeUtils.fromMinutes(trip.endTime);
    }

    // Normal lookup
    return getStopValue(trip.arrivalTimes, stopName) || getStopValue(trip.stops, stopName) || '';
};

// --- Types ---

export interface RoundTripTableViewProps {
    schedules: MasterRouteTable[];
    onCellEdit?: (tripId: string, col: string, val: string) => void;
    onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void;
    onRecoveryEdit?: (tripId: string, stopName: string, delta: number) => void;
    originalSchedules?: MasterRouteTable[];
    onDeleteTrip?: (tripId: string) => void;
    onDuplicateTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
    onTripRightClick?: (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number
    ) => void;
    onMenuOpen?: (tripId: string, x: number, y: number, direction: 'North' | 'South', blockId: string, stops: string[]) => void;
    draftName?: string;
    filter?: FilterState;
    targetCycleTime?: number;
    targetHeadway?: number;
    readOnly?: boolean;
    connectionLibrary?: ConnectionLibrary | null;
    dayType?: DayType;
}

// --- Component ---

type RoundTripPair = {
    north: MasterRouteTable;
    south: MasterRouteTable;
    combined: RoundTripTable;
    northTripOrder: Map<string, number>;
    southTripOrder: Map<string, number>;
};

export const RoundTripTableView: React.FC<RoundTripTableViewProps> = ({
    schedules,
    onCellEdit,
    onTimeAdjust,
    onRecoveryEdit,
    originalSchedules,
    onDeleteTrip,
    onDuplicateTrip,
    onAddTrip,
    onTripRightClick,
    onMenuOpen,
    draftName,
    filter,
    targetCycleTime,
    targetHeadway,
    readOnly = false,
    connectionLibrary,
    dayType = 'Weekday'
}) => {
    // Sort state: 'blockFlow' (default), 'blockId', 'endTime', 'startTime', or a stop name
    const [sortColumn, setSortColumn] = useState<string>('blockFlow');
    const [focusMode, setFocusMode] = useState(true);
    const [showDirectionLegend, setShowDirectionLegend] = useState(false);
    const [density, setDensity] = useState<DensityMode>('compact');
    const [timepointOnly, setTimepointOnly] = useState(false);
    const [showMetaCols, setShowMetaCols] = useState(true);
    const [showActionsCol, setShowActionsCol] = useState(false);
    const [showRowNumberCol, setShowRowNumberCol] = useState(false);

    const originalTripLookup = useMemo(() => {
        const lookup = new Map<string, MasterTrip>();
        (originalSchedules || []).forEach(table => {
            table.trips.forEach(trip => {
                lookup.set(`${table.routeName}::${trip.id}`, trip);
            });
        });
        return lookup;
    }, [originalSchedules]);

    const getOriginalTrip = (routeName: string, tripId: string): MasterTrip | undefined =>
        originalTripLookup.get(`${routeName}::${tripId}`);

    const roundTripData = useMemo(() => {
        const pairs: RoundTripPair[] = [];
        const routeGroups: Record<string, { north?: MasterRouteTable; south?: MasterRouteTable }> = {};

        schedules.forEach(table => {
            // Strip direction suffixes to get the route variant
            const routeVariant = table.routeName.replace(/ \(North\).*$/, '').replace(/ \(South\).*$/, '').trim();

            // Use parseRouteInfo to determine if this is a direction variant (like 2A/2B)
            // For routes where A=North, B=South, we group them under the base route number
            const parsed = parseRouteInfo(routeVariant);
            const baseName = parsed.suffixIsDirection ? parsed.baseRoute : routeVariant;

            if (!routeGroups[baseName]) routeGroups[baseName] = {};

            // Determine direction: either from explicit (North)/(South) suffix or from A/B variant
            let tableDirection = extractDirectionFromName(table.routeName);
            if (!tableDirection && parsed.suffixIsDirection) {
                // A/B suffix IS the direction (e.g., 2A=North, 2B=South)
                tableDirection = parsed.direction;
            }

            if (tableDirection === 'North') routeGroups[baseName].north = table;
            else if (tableDirection === 'South') routeGroups[baseName].south = table;
            else if (!routeGroups[baseName].north) routeGroups[baseName].north = table;
            else routeGroups[baseName].south = table;
        });

        Object.entries(routeGroups).forEach(([baseName, group]) => {
            if (!group.north && !group.south) return;

            // Normalize to always have both tables so formatting stays consistent across
            // directional and loop/single-sided routes.
            const northTable: MasterRouteTable = group.north || {
                routeName: `${baseName} (North)`,
                stops: [],
                stopIds: {},
                trips: []
            };
            const southTable: MasterRouteTable = group.south || {
                routeName: `${baseName} (South)`,
                stops: [],
                stopIds: {},
                trips: []
            };

            const combined = buildRoundTripView(northTable, southTable);
            const northTripOrder = new Map<string, number>();
            northTable.trips.forEach((trip, idx) => {
                northTripOrder.set(trip.id, idx + 1);
            });
            const southTripOrder = new Map<string, number>();
            southTable.trips.forEach((trip, idx) => {
                southTripOrder.set(trip.id, idx + 1);
            });
            pairs.push({ north: northTable, south: southTable, combined, northTripOrder, southTripOrder });
        });
        return pairs;
    }, [schedules]);

    if (roundTripData.length === 0) return <div className="text-center p-8 text-gray-400">No matching North/South pairs found.</div>;

    return (
        <div className="space-y-8 h-full flex flex-col">
            {roundTripData.map(({ combined, north, south, northTripOrder, southTripOrder }) => {
                const allNorthTrips = north?.trips || [];
                const allSouthTrips = south?.trips || [];
                const headways = calculateHeadways([...allNorthTrips, ...allSouthTrips]);
                const northStopsWithRecovery = new Set<string>();
                const southStopsWithRecovery = new Set<string>();

                combined.rows.forEach(row => {
                    row.trips.forEach(t => {
                        if (t.recoveryTimes) {
                            Object.entries(t.recoveryTimes).forEach(([stop, min]) => {
                                if (min !== undefined && min !== null) {
                                    // Use stop's location (north vs south stops) rather than trip direction
                                    // Fixes loop routes where trips may have inconsistent direction values
                                    const isNorthStop = combined.northStops.includes(stop);
                                    const isSouthStop = combined.southStops.includes(stop);
                                    if (isNorthStop) northStopsWithRecovery.add(stop);
                                    if (isSouthStop) southStopsWithRecovery.add(stop);
                                }
                            });
                        }
                    });
                });

                const summaryTable: MasterRouteTable = {
                    routeName: combined.routeName,
                    trips: [...allNorthTrips, ...allSouthTrips],
                    stops: [], stopIds: {}
                };

                // Detect merged terminus: last North stop = first South stop (for A/B merged routes like 2A+2B)
                // When merged, the last North stop shows only ARRIVE (not ARR|R|DEP)
                // and the first South stop shows only DEPART (already the default)
                const lastNorthStop = combined.northStops[combined.northStops.length - 1];
                const firstSouthStop = combined.southStops[0];
                const hasMergedTerminus = lastNorthStop && firstSouthStop &&
                    lastNorthStop.toLowerCase() === firstSouthStop.toLowerCase();
                const northDisplayStops = pickDisplayStops(combined.northStops, timepointOnly);
                const southDisplayStops = pickDisplayStops(combined.southStops, timepointOnly);
                const lastNorthStopIdx = northDisplayStops.length - 1;
                const showActions = !readOnly && showActionsCol;
                const showRowNum = showRowNumberCol;
                const densityClass =
                    density === 'ultra'
                        ? { cell: 'text-[10px]', header: 'text-[10px]', pad: 'p-1', rowH: 'h-8' }
                        : density === 'comfortable'
                            ? { cell: 'text-sm', header: 'text-sm', pad: 'p-2', rowH: 'h-12' }
                            : { cell: 'text-xs', header: 'text-xs', pad: 'p-1.5', rowH: 'h-10' };

                // Build column mapping for spreadsheet-style references (A, B, C...)
                const columnMapping: ColumnInfo[] = [];
                let colIdx = 0;

                // Row # column (A)
                if (showRowNum) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Row #' });
                }

                // Actions column (only if not readOnly)
                if (showActions) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Actions' });
                }

                // Pattern column (before Block ID)
                if (showMetaCols) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Pattern' });
                }

                // Block ID column
                columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Block' });

                // North stops with sub-columns
                northDisplayStops.forEach((stop, i) => {
                    const isLastStop = i === lastNorthStopIdx;
                    const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                    const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                    const showArrRCols = hasRecovery || isMergedTerminusStop;

                    if (showArrRCols) {
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} ARR` });
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} R` });
                    }
                    if (!isMergedTerminusStop) {
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} DEP` });
                    }
                });

                // South stops with sub-columns
                southDisplayStops.forEach((stop, i) => {
                    const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);

                    if (hasRecovery) {
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} ARR` });
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} R` });
                    }
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} DEP` });
                });

                // Metrics columns
                if (showMetaCols) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Travel' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Band' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Rec' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Ratio' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Hdwy' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Cycle' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Trip #' });
                }

                // Calculate Route Totals for the Header
                const totalTrips = combined.rows.length;
                const allTrips = [...allNorthTrips, ...allSouthTrips];
                const totalRecoverySum = combined.rows.reduce((sum, r) => sum + r.totalRecoveryTime, 0);
                const totalCycleSum = combined.rows.reduce((sum, r) => sum + r.totalCycleTime, 0);
                // Derive travel from cycle - recovery so the math always adds up
                const totalTravelSum = Math.max(0, totalCycleSum - totalRecoverySum);
                const avgTravel = totalTrips > 0 ? (totalTravelSum / totalTrips).toFixed(1) : '0';
                const avgRecovery = totalTrips > 0 ? (totalRecoverySum / totalTrips).toFixed(1) : '0';

                const overallRatio = totalTravelSum > 0 ? ((totalRecoverySum / totalTravelSum) * 100) : 0;
                const ratioStatus = getRecoveryStatus(overallRatio);

                const peakVehicles = calculatePeakVehicles(allTrips);
                const serviceSpan = calculateServiceSpan(allTrips);
                const headwayAnalysis = analyzeHeadways(allTrips);
                const tripsPerHour = calculateTripsPerHour(allTrips);
                const warnings = validateSchedule(allTrips);

                const hours = Object.keys(tripsPerHour).map(Number).sort((a, b) => a - b);
                const minHour = hours.length > 0 ? hours[0] : 6;
                const maxHour = hours.length > 0 ? hours[hours.length - 1] : 22;
                const maxTripsInHour = Math.max(...Object.values(tripsPerHour), 1);

                return (
                    <div key={combined.routeName} className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 h-full min-h-0">

                        {/* Focus Toolbar + Optional Stats */}
                        <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0 bg-gray-50">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={() => setFocusMode(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${focusMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                                    title="Focus mode prioritizes schedule grid space"
                                >
                                    Focus
                                </button>
                                <button
                                    onClick={() => setTimepointOnly(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${timepointOnly ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    Timepoints
                                </button>
                                {!readOnly && (
                                    <button
                                        onClick={() => setShowActionsCol(v => !v)}
                                        className={`px-2 py-1 rounded text-xs font-semibold border ${showActionsCol ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                    >
                                        Actions
                                    </button>
                                )}
                                <button
                                    onClick={() => setShowRowNumberCol(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${showRowNumberCol ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    Row #
                                </button>
                                <select
                                    value={density}
                                    onChange={(e) => setDensity(e.target.value as DensityMode)}
                                    className="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-700"
                                    title="Density"
                                >
                                    <option value="ultra">Ultra</option>
                                    <option value="compact">Compact</option>
                                    <option value="comfortable">Comfortable</option>
                                </select>
                                <button
                                    onClick={() => setShowDirectionLegend(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${showDirectionLegend ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    Legend
                                </button>

                                {/* Always-visible summary */}
                                <div className="flex items-center gap-2 text-xs md:text-sm">
                                    <span className="font-semibold text-gray-800">{serviceSpan.start} – {serviceSpan.end}</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-700"><span className="font-semibold">{peakVehicles}</span> vehicles</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-700"><span className="font-semibold">{totalTrips}</span> trips</span>
                                    <span className="text-gray-500">•</span>
                                    {/* Sort dropdown */}
                                    <div className="flex items-center gap-1">
                                        <ArrowUpDown size={12} className="text-gray-600" />
                                        <select
                                            value={sortColumn}
                                            onChange={(e) => setSortColumn(e.target.value)}
                                            className="text-xs md:text-sm bg-transparent border-none text-gray-700 cursor-pointer hover:text-gray-900 pr-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded"
                                        >
                                            <option value="blockFlow">Sort: Block Flow</option>
                                            <option value="blockId">Sort: Block #</option>
                                            <option value="endTime">Sort: End Arrival</option>
                                            <option value="startTime">Sort: Start Time</option>
                                            <optgroup label="North Stops">
                                                {northDisplayStops.map(stop => (
                                                    <option key={`n-${stop}`} value={`north:${stop}`}>{stop}</option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="South Stops">
                                                {southDisplayStops.map(stop => (
                                                    <option key={`s-${stop}`} value={`south:${stop}`}>{stop}</option>
                                                ))}
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>

                                {/* Expanded stats */}
                                {!focusMode && (
                                    <>
                                        <div className="flex-1" />
                                        <div className="flex items-center gap-4 text-sm text-gray-700">
                                            <span className={`font-semibold ${overallRatio > 25 ? 'text-amber-700' : overallRatio < 10 ? 'text-red-700' : 'text-gray-700'}`}>
                                                {overallRatio.toFixed(0)}% recovery
                                            </span>
                                            <span>{headwayAnalysis.avg} min avg headway</span>
                                            <span>{(totalCycleSum / 60).toFixed(1)}h service ({(totalTravelSum / 60).toFixed(1)}h travel + {(totalRecoverySum / 60).toFixed(1)}h recovery)</span>
                                            {!readOnly && (() => {
                                                const hourCounts = Object.values(tripsPerHour).filter(c => c > 0);
                                                const avgTrips = hourCounts.length > 0
                                                    ? (hourCounts.reduce((a, b) => a + b, 0) / hourCounts.length).toFixed(1)
                                                    : '0';
                                                return <span>Avg {avgTrips} trips/hr • Peak {maxTripsInHour}/hr</span>;
                                            })()}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Direction Info Row */}
                        {showDirectionLegend && (() => {
                            // Extract route number - don't strip A/B suffix, let getRouteConfig handle it
                            // (8A/8B are distinct routes, not direction variants)
                            const baseRoute = combined.routeName.split(' ')[0];
                            const config = getRouteConfig(baseRoute);
                            const isLoop = config?.segments.length === 1;
                            const northSegment = config?.segments.find(s => s.name === 'North');
                            const southSegment = config?.segments.find(s => s.name === 'South');
                            const northVariant = northSegment?.variant ?? baseRoute;
                            const southVariant = southSegment?.variant ?? baseRoute;
                            const northTerminus = northSegment?.terminus ?? '';
                            const southTerminus = southSegment?.terminus ?? '';

                            return (
                                <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center gap-4 text-xs md:text-sm">
                                    <span className="font-semibold text-blue-800">Route Directions:</span>
                                    {isLoop ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-blue-700">Loop:</span>
                                            <code className="bg-blue-100 px-2 py-0.5 rounded font-mono text-blue-800">
                                                {config?.segments[0]?.name ?? 'Unknown'}
                                            </code>
                                            <span className="text-gray-600">({(north?.trips?.length || 0) + (south?.trips?.length || 0)} trips)</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2">
                                                <span className="text-blue-700">Northbound:</span>
                                                <code className="bg-green-100 px-2 py-0.5 rounded font-mono text-green-800 font-bold">
                                                    {northVariant}
                                                </code>
                                                {northTerminus && (
                                                    <span className="text-gray-700">â†’ {northTerminus}</span>
                                                )}
                                                <span className="text-gray-600">({north?.trips?.length || 0} trips)</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-blue-700">Southbound:</span>
                                                <code className="bg-orange-100 px-2 py-0.5 rounded font-mono text-orange-800 font-bold">
                                                    {southVariant}
                                                </code>
                                                {southTerminus && (
                                                    <span className="text-gray-700">â†’ {southTerminus}</span>
                                                )}
                                                <span className="text-gray-600">({south?.trips?.length || 0} trips)</span>
                                            </div>
                                        </>
                                    )}
                                    {!config && (
                                        <span className="text-amber-600 italic">âš  Route not in config</span>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Main Table Area */}
                        <div className="overflow-auto custom-scrollbar relative w-full flex-1 min-h-0">

                            <table className={`w-full text-left border-collapse ${densityClass.cell}`} style={{ tableLayout: 'fixed' }}>
                                <colgroup>
                                    {/* Row number column - sticky */}
                                    {showRowNum && <col className="w-8" />}
                                    {showActions && <col className="w-16" />}
                                    {showMetaCols && <col style={{ width: '200px' }} />}  {/* Pattern */}
                                    <col className="w-14" />
                                    {northDisplayStops.map((stop, i) => {
                                        // For merged terminus, show ARR | R (no DEP) for last North stop
                                        const isLastStop = i === lastNorthStopIdx;
                                        const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                        const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                        const showArrRCols = hasRecovery || isMergedTerminusStop;
                                        return (
                                            <React.Fragment key={`n-col-${i}`}>
                                                {showArrRCols && <col className="w-14" />}
                                                {showArrRCols && <col className="w-8" />}
                                                {/* Skip DEP column for merged terminus (only show ARR | R) */}
                                                {!isMergedTerminusStop && <col style={{ width: '80px' }} />}
                                            </React.Fragment>
                                        );
                                    })}
                                    {southDisplayStops.map((stop, i) => (
                                        <React.Fragment key={`s-col-${i}`}>
                                            {i > 0 && southStopsWithRecovery.has(stop) && <col className="w-14" />}
                                            {i > 0 && southStopsWithRecovery.has(stop) && <col className="w-8" />}
                                            <col style={{ width: '80px' }} />
                                        </React.Fragment>
                                    ))}
                                    {showMetaCols && <col style={{ width: '50px' }} />}  {/* Travel */}
                                    {showMetaCols && <col style={{ width: '42px' }} />}  {/* Band */}
                                    {showMetaCols && <col style={{ width: '38px' }} />}  {/* Rec */}
                                    {showMetaCols && <col style={{ width: '46px' }} />}  {/* Ratio */}
                                    {showMetaCols && <col style={{ width: '42px' }} />}  {/* Hdwy */}
                                    {showMetaCols && <col style={{ width: '48px' }} />}  {/* Cycle */}
                                    {showMetaCols && <col style={{ width: '46px' }} />}  {/* Trip # */}
                                </colgroup>
                                <thead className="sticky top-0 z-40 bg-white shadow-sm">
                                    {/* Column Letters Row (Spreadsheet-style) */}
                                    {!focusMode && (
                                        <tr className="bg-gray-100 border-b border-gray-200">
                                            {columnMapping.map((col, idx) => (
                                                <th
                                                    key={`col-letter-${idx}`}
                                                    className="py-0.5 px-1 text-center text-xs font-mono font-medium text-gray-600 border-r border-gray-200 last:border-r-0"
                                                    title={col.label}
                                                >
                                                    {col.letter}
                                                </th>
                                            ))}
                                        </tr>
                                    )}
                                    {/* Stop Names Row */}
                                    <tr className="bg-white">
                                        {/* Row # header - spans 2 rows */}
                                        {showRowNum && <th rowSpan={2} className="p-1 border-b border-gray-200 bg-gray-100 text-xs font-mono font-medium text-gray-600 text-center align-middle">#</th>}
                                        {showActions && <th rowSpan={2} className="p-2 border-b border-gray-200 bg-gray-100 text-xs font-medium text-gray-600 uppercase text-center align-middle"></th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Shape/Pattern">Pattern</th>}
                                        <th rowSpan={2} className={`p-2 border-b border-gray-200 bg-gray-100 sticky left-0 z-50 ${densityClass.header} font-semibold text-gray-700 uppercase tracking-wide text-center align-middle`}>Block</th>
                                        {northDisplayStops.map((stop, i) => {
                                            const isLastStop = i === lastNorthStopIdx;
                                            const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                            const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                            // For merged terminus: ARR | R = 2 cols. Otherwise: normal (1 or 3)
                                            const colSpan = i === 0 ? 1 : (isMergedTerminusStop ? 2 : (hasRecovery ? 3 : 1));
                                            // For merged terminus, show "ARRIVE" prefix on last North stop
                                            const displayName = isMergedTerminusStop ? `ARRIVE ${stop}` : stop;
                                            const stopCode = combined.northStopIds?.[stop];
                                            return (
                                                <th
                                                    key={`n-name-${stop}`}
                                                    colSpan={colSpan}
                                                    className={`px-1 py-1 border-b border-l border-gray-200 bg-blue-50/50 ${densityClass.header} font-semibold text-blue-800 uppercase tracking-tight text-center align-middle`}
                                                    title={stopCode ? `${stop} (Stop #${stopCode})` : stop}
                                                >
                                                    <div className="leading-tight line-clamp-2 overflow-hidden">
                                                        {abbreviateStopName(displayName)}
                                                    </div>
                                                    {stopCode && (
                                                        <div className="text-[10px] font-normal text-blue-600/70 mt-0.5">#{stopCode}</div>
                                                    )}
                                                </th>
                                            );
                                        })}
                                        {southDisplayStops.map((stop, i) => {
                                            const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);
                                            const colSpan = i === 0 ? 1 : (hasRecovery ? 3 : 1);
                                            // For merged terminus, show "DEPART" prefix on first South stop
                                            const isFirstStop = i === 0;
                                            const displayName = (isFirstStop && hasMergedTerminus) ? `DEPART ${stop}` : stop;
                                            const stopCode = combined.southStopIds?.[stop];
                                            return (
                                                <th
                                                    key={`s-name-${stop}`}
                                                    colSpan={colSpan}
                                                    className={`px-1 py-1 border-b border-l border-gray-200 bg-orange-50/50 ${densityClass.header} font-semibold text-orange-800 uppercase tracking-tight text-center align-middle`}
                                                    title={stopCode ? `${stop} (Stop #${stopCode})` : stop}
                                                >
                                                    <div className="leading-tight line-clamp-2 overflow-hidden">
                                                        {abbreviateStopName(displayName)}
                                                    </div>
                                                    {stopCode && (
                                                        <div className="text-[10px] font-normal text-orange-600/70 mt-0.5">#{stopCode}</div>
                                                    )}
                                                </th>
                                            );
                                        })}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Travel Time">Travel</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Time Band">Band</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Recovery Time">Rec</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Recovery Ratio">Ratio</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Headway">Hdwy</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Cycle Time">Cycle</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Trip Number">Trip #</th>}
                                    </tr>
                                    {/* Sub-headers Row */}
                                    <tr className="bg-gray-50 text-gray-500">
                                        {northDisplayStops.map((stop, i) => {
                                            const isLastStop = i === lastNorthStopIdx;
                                            const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                            const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                            const showArrRCols = hasRecovery || isMergedTerminusStop;
                                            return (
                                                <React.Fragment key={`n-sub-${stop}`}>
                                                    {showArrRCols && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-xs font-medium text-gray-700 uppercase">Arr</th>}
                                                    {showArrRCols && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-xs font-medium text-gray-700">R</th>}
                                                    {/* Skip DEP column for merged terminus - only show Arr | R */}
                                                    {!isMergedTerminusStop && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-xs font-medium text-gray-700 uppercase">Dep</th>}
                                                </React.Fragment>
                                            );
                                        })}
                                        {southDisplayStops.map((stop, i) => (
                                            <React.Fragment key={`s-sub-${stop}`}>
                                                {i > 0 && southStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-xs font-medium text-gray-700 uppercase">Arr</th>}
                                                {i > 0 && southStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-xs font-medium text-gray-700">R</th>}
                                                <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-xs font-medium text-gray-700 uppercase">Dep</th>
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-100">
                                    {(() => {
                                        // Helper to get sort time for a row based on selected column
                                        const getSortTime = (row: typeof combined.rows[0]): number => {
                                            const northTrip = row.trips.find(t => t.direction === 'North');
                                            const southTrip = row.trips.find(t => t.direction === 'South');

                                            if (sortColumn === 'startTime') {
                                                return northTrip?.startTime ?? southTrip?.startTime ?? 0;
                                            }
                                            if (sortColumn === 'endTime') {
                                                // End arrival = last trip's end time
                                                const lastTrip = [...row.trips].sort((a, b) => b.endTime - a.endTime)[0];
                                                return lastTrip?.endTime ?? 0;
                                            }
                                            // Stop-based sorting: "north:StopName" or "south:StopName"
                                            if (sortColumn.startsWith('north:')) {
                                                const stopName = sortColumn.replace('north:', '');
                                                const timeStr = northTrip?.stops?.[stopName];
                                                return timeStr ? TimeUtils.toMinutes(timeStr) ?? 0 : 0;
                                            }
                                            if (sortColumn.startsWith('south:')) {
                                                const stopName = sortColumn.replace('south:', '');
                                                const timeStr = southTrip?.stops?.[stopName];
                                                return timeStr ? TimeUtils.toMinutes(timeStr) ?? 0 : 0;
                                            }
                                            return northTrip?.startTime ?? southTrip?.startTime ?? 0;
                                        };

                                        // Route 8A/8B: default sort by North Allandale departure
                                        const baseRoute = combined.routeName.split(' ')[0];
                                        const isRoute8 = baseRoute === '8A' || baseRoute === '8B';
                                        const northAllandaleStop = isRoute8
                                            ? combined.northStops.find(s => s.toLowerCase().includes('allandale'))
                                            : undefined;
                                        const southAllandaleStop = isRoute8
                                            ? combined.southStops.find(s => s.toLowerCase().includes('allandale'))
                                            : undefined;

                                        // Sort rows by the selected column
                                        const sortedRows = [...combined.rows].sort((a, b) => {
                                            if (sortColumn === 'blockFlow') {
                                                if (isRoute8 && northAllandaleStop) {
                                                    // Route 8A/8B: chronological by North Allandale Terminal departure
                                                    // South-only pullout trips (no North leg) use South Allandale
                                                    // arrival as fallback — keeps them grouped at top of morning
                                                    // Post-midnight trips (12am-3am) sort at bottom via operational time
                                                    const getRoute8SortTime = (row: typeof combined.rows[0]): number => {
                                                        const north = row.trips.find(t => t.direction === 'North');
                                                        const northTime = north?.stops?.[northAllandaleStop];
                                                        if (northTime) return TimeUtils.toMinutes(northTime) ?? 0;
                                                        // South-only pullout: use South Allandale arrival
                                                        if (southAllandaleStop) {
                                                            const south = row.trips.find(t => t.direction === 'South');
                                                            const southTime = south?.stops?.[southAllandaleStop];
                                                            if (southTime) return TimeUtils.toMinutes(southTime) ?? 0;
                                                        }
                                                        return getSortTime(row);
                                                    };
                                                    const timeDiff = getOperationalSortTime(getRoute8SortTime(a))
                                                                   - getOperationalSortTime(getRoute8SortTime(b));
                                                    if (timeDiff !== 0) return timeDiff;
                                                    return compareBlockIds(a.blockId, b.blockId);
                                                }
                                                // All other routes: block flow by pairIndex
                                                const pairDiff = (a.pairIndex || 0) - (b.pairIndex || 0);
                                                if (pairDiff !== 0) return pairDiff;
                                                const timeDiff = getSortTime(a) - getSortTime(b);
                                                if (timeDiff !== 0) return timeDiff;
                                                const blockDiff = compareBlockIds(a.blockId, b.blockId);
                                                if (blockDiff !== 0) return blockDiff;
                                            }
                                            if (sortColumn === 'blockId') {
                                                const blockDiff = compareBlockIds(a.blockId, b.blockId);
                                                if (blockDiff !== 0) return blockDiff;
                                            }
                                            return getSortTime(a) - getSortTime(b);
                                        });

                                        return sortedRows.map((row, rowIdx) => {
                                        const northTrip = row.trips.find(t => t.direction === 'North');
                                        const southTrip = row.trips.find(t => t.direction === 'South');
                                        const lastTrip = [...row.trips].sort((a, b) => a.startTime - b.startTime).pop();

                                        const uniqueRowKey = `${row.blockId}-${northTrip?.id || 'n'}-${southTrip?.id || 's'}-${rowIdx}`;

                                        const totalRec = (northTrip?.recoveryTime || 0) + (southTrip?.recoveryTime || 0);
                                        const displayCycleTime = row.totalCycleTime;
                                        // Derive travel from cycle - recovery so the math always adds up
                                        const totalTravel = Math.max(0, displayCycleTime - totalRec);
                                        const ratio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;

                                        const headway = northTrip ? headways[northTrip.id] : (southTrip ? headways[southTrip.id] : '-');

                                        const ratioColorClass = getRatioColor(ratio);

                                        const assignedBand = northTrip?.assignedBand || southTrip?.assignedBand;
                                        const northIndex = northTrip ? northTripOrder.get(northTrip.id) : undefined;
                                        const southIndex = southTrip ? southTripOrder.get(southTrip.id) : undefined;
                                        const routeTripNumber = northIndex ?? southIndex ?? rowIdx + 1;
                                        const bandColor = getBandRowColor(assignedBand);
                                        const rowBg = bandColor || (rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50');
                                        const originalNorthTrip = northTrip ? getOriginalTrip(north.routeName, northTrip.id) : undefined;
                                        const originalSouthTrip = southTrip ? getOriginalTrip(south.routeName, southTrip.id) : undefined;

                                        const tripStartTime = northTrip?.startTime || southTrip?.startTime || 0;
                                        const tripEndTime = northTrip?.endTime || southTrip?.endTime || 0;
                                        const isGrayedOut = filter ? shouldGrayOutTrip(tripStartTime, tripEndTime, filter) : false;
                                        const isHighlighted = filter ? shouldHighlightTrip(totalTravel, totalRec, typeof headway === 'number' ? headway : null, filter) : false;
                                        const matchesSearchFilter = filter ? matchesSearch(row.blockId, [...combined.northStops, ...combined.southStops], filter.search) : true;

                                        const grayOutClass = isGrayedOut ? 'opacity-40' : '';
                                        const filterHighlightClass = isHighlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-200' : '';
                                        const searchHideClass = !matchesSearchFilter ? 'hidden' : '';

                                        // Calculate the display row number (1-indexed)
                                        const displayRowNum = rowIdx + 1;

                                        // Track column index for cell references (starts after optional row#, optional actions, block)
                                        let dataColIdx = 1; // block
                                        if (showRowNum) dataColIdx += 1;
                                        if (showActions) dataColIdx += 1;
                                        const getCellRef = () => {
                                            const col = columnMapping[dataColIdx];
                                            return col ? `${col.letter}${displayRowNum}` : '';
                                        };

                                        return (
                                            <tr
                                                key={uniqueRowKey}
                                                className={`group hover:bg-blue-50/50 ${rowBg} ${grayOutClass} ${filterHighlightClass} ${searchHideClass}`}
                                                onContextMenu={(e) => {
                                                    if (onTripRightClick && northTrip) {
                                                        onTripRightClick(e, northTrip.id, 'North', row.blockId, combined.northStops);
                                                    }
                                                }}
                                            >
                                                {/* Row Number Column */}
                                                {showRowNum && (
                                                    <td
                                                        className="p-1 border-r border-gray-200 bg-gray-50 z-20 text-center text-xs font-mono text-gray-600"
                                                        title={`Row ${displayRowNum}`}
                                                    >
                                                        {displayRowNum}
                                                    </td>
                                                )}
                                                {/* Actions Column */}
                                                {showActions && (
                                                    <td className="p-1 border-r border-gray-100 bg-white group-hover:bg-gray-100 z-20">
                                                        <div className="flex items-center justify-center gap-0.5">
                                                            {onAddTrip && (
                                                                <button
                                                                    onClick={() => onAddTrip(row.blockId, lastTrip?.id || '')}
                                                                    className="p-1 rounded hover:bg-green-50 text-gray-600 hover:text-green-700 transition-colors"
                                                                    title="Add trip to block"
                                                                    aria-label="Add trip"
                                                                >
                                                                    <Plus size={12} />
                                                                </button>
                                                            )}
                                                            {northTrip && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        if (onMenuOpen) {
                                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                                            onMenuOpen(northTrip.id, rect.left, rect.bottom + 4, 'North', row.blockId, combined.northStops);
                                                                        }
                                                                    }}
                                                                    className="p-1 rounded hover:bg-blue-50 text-gray-600 hover:text-blue-700 transition-colors"
                                                                    title="Edit trip"
                                                                    aria-label="Edit trip"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                            )}
                                                            {onDeleteTrip && northTrip && (
                                                                <button
                                                                    onClick={() => onDeleteTrip(northTrip.id)}
                                                                    className="p-1 rounded hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
                                                                    title="Delete trip"
                                                                    aria-label="Delete trip"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}

                                                {/* Pattern */}
                                                {showMetaCols && (
                                                    <td className="p-1 text-left text-xs text-gray-500" title={`${northTrip?.patternLabel || '-'}\n${southTrip?.patternLabel || '-'}`}>
                                                        <div className="flex flex-col gap-0.5 leading-tight">
                                                            <span className="truncate"><span className="font-semibold text-blue-700">N</span> {northTrip?.patternLabel || '-'}</span>
                                                            <span className="truncate"><span className="font-semibold text-orange-600">S</span> {southTrip?.patternLabel || '-'}</span>
                                                        </div>
                                                    </td>
                                                )}

                                                {/* Block ID */}
                                                <td className={`p-2 border-r border-gray-100 sticky left-0 bg-white group-hover:bg-gray-100 z-30 font-medium text-xs text-gray-700 text-center`}>
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span>{row.blockId}</span>
                                                        {lastTrip?.isBlockEnd && (
                                                            <span className="text-[9px] text-orange-600 font-bold">END</span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* North Cells */}
                                                {northDisplayStops.map((stop, i) => {
                                                    // For merged terminus (A/B routes), show ARR | R but skip DEP for last North stop
                                                    const isMergedTerminusStop = i === lastNorthStopIdx && hasMergedTerminus;
                                                    const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                                    const showArrRCols = hasRecovery || isMergedTerminusStop;

                                                    // Check if this is a partial trip that STARTS at this stop
                                                    // (no stops with times BEFORE this one)
                                                    const isPartialTripStartingHere = northTrip && i > 0 && (() => {
                                                        const previousStops = northDisplayStops.slice(0, i);
                                                        return !previousStops.some(prevStop =>
                                                            getStopValue(northTrip.stops, prevStop) ||
                                                            getStopValue(northTrip.arrivalTimes, prevStop)
                                                        );
                                                    })();

                                                    // Get actual arrival time at this stop (used to decide if recovery should show)
                                                    const northArrivalAtStop = isPartialTripStartingHere ? '' : getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);

                                                    // Check if this trip ends at this north stop (no data at subsequent stops)
                                                    const isNorthTripEndingHere = !!(northTrip && northArrivalAtStop && (() => {
                                                        const remainingStops = northDisplayStops.slice(i + 1);
                                                        return !remainingStops.some(nextStop =>
                                                            getStopValue(northTrip.stops, nextStop) ||
                                                            getStopValue(northTrip.arrivalTimes, nextStop)
                                                        );
                                                    })());

                                                    const canAdjustNorthDep = !!northTrip && (() => {
                                                        const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                        if (!arrival) return false;

                                                        const remainingStops = northDisplayStops.slice(i + 1);
                                                        const hasContinuingStops = remainingStops.some(nextStop =>
                                                            getStopValue(northTrip.stops, nextStop) ||
                                                            getStopValue(northTrip.arrivalTimes, nextStop)
                                                        );
                                                        if (!hasContinuingStops) return false;

                                                        return true;
                                                    })();

                                                    // Get cell references for this stop's columns
                                                    const arrCellRef = showArrRCols ? columnMapping[dataColIdx]?.letter + displayRowNum : '';
                                                    const rCellRef = showArrRCols ? columnMapping[dataColIdx + 1]?.letter + displayRowNum : '';
                                                    const depCellRef = !isMergedTerminusStop ? columnMapping[dataColIdx + (showArrRCols ? 2 : 0)]?.letter + displayRowNum : '';

                                                    // Increment dataColIdx after computing refs
                                                    const stopColCount = (showArrRCols ? 2 : 0) + (isMergedTerminusStop ? 0 : 1);
                                                    dataColIdx += stopColCount;

                                                    return (
                                                    <React.Fragment key={`n-${stop}`}>
                                                        {showArrRCols && (
                                                            <td className="p-0 relative h-10 group/arr" title={arrCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onTimeAdjust && northTrip && northArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, `${stop}__ARR`, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <StackedTimeInput
                                                                        value={northArrivalAtStop}
                                                                        onChange={(val) => northTrip && onCellEdit?.(northTrip.id, `${stop}__ARR`, val)}
                                                                        onBlur={(val) => {
                                                                            if (northTrip && val && onCellEdit) {
                                                                                const formatted = parseTimeInput(val, northArrivalAtStop);
                                                                                if (formatted) onCellEdit(northTrip.id, `${stop}__ARR`, formatted);
                                                                            }
                                                                        }}
                                                                        disabled={readOnly || !northTrip || !northArrivalAtStop}
                                                                        focusClass="focus:ring-blue-100"
                                                                        onAdjust={onTimeAdjust && northTrip && northArrivalAtStop ? (delta) => onTimeAdjust(northTrip.id, `${stop}__ARR`, delta) : undefined}
                                                                    />
                                                                    {(() => {
                                                                        const originalArrival = getArrivalDisplayTime(originalNorthTrip, stop);
                                                                        const diff = getDeltaMinutes(northArrivalAtStop, originalArrival);
                                                                        if (!diff) return null;
                                                                        return (
                                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                                {diff > 0 ? '+' : ''}{diff}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                    {onTimeAdjust && northTrip && northArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, `${stop}__ARR`, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {showArrRCols && (
                                                            <td className="p-0 relative h-8 group/rec text-center font-mono text-xs text-gray-700 font-medium" title={rCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && northTrip && !isNorthTripEndingHere && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(northTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{northArrivalAtStop && !isNorthTripEndingHere ? (getStopValue(northTrip?.recoveryTimes, stop) ?? '') : ''}</span>
                                                                    {onRecoveryEdit && northTrip && !isNorthTripEndingHere && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(northTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="+1 min recovery"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {/* Skip DEP cell for merged terminus - South's first stop handles departure */}
                                                        {!isMergedTerminusStop && (() => {
                                                            // Compute departure time for connection indicator
                                                            const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                            const recovery = getStopValue(northTrip?.recoveryTimes, stop) || 0;
                                                            const depTimeMinutes = arrival ? TimeUtils.toMinutes(
                                                                recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery)
                                                            ) : null;
                                                            const stopCode = combined.northStopIds?.[stop] || '';
                                                            const connections = connectionLibrary && stopCode && depTimeMinutes !== null
                                                                ? getConnectionsForStop(stopCode, depTimeMinutes, connectionLibrary, dayType)
                                                                : [];

                                                            return (
                                                            <td className={`p-0 relative ${connections.length > 0 ? 'h-14' : 'h-10'} group/cell ${i === 0 ? 'sticky left-14 z-20 bg-white border-l border-dashed border-gray-100' : ''}`} title={depCellRef}>
                                                                <div className={`flex ${connections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
                                                                    {onTimeAdjust && northTrip && canAdjustNorthDep && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={12} />
                                                                        </button>
                                                                    )}
                                                                    {(() => {
                                                                        // Standard calculation: arrival + recovery
                                                                        const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                                        if (!arrival) return null;

                                                                        // Check if this is a trip that ENDS at this stop
                                                                        const remainingStops = northDisplayStops.slice(i + 1);
                                                                        const hasContinuingStops = northTrip ? remainingStops.some(nextStop =>
                                                                            getStopValue(northTrip.stops, nextStop) ||
                                                                            getStopValue(northTrip.arrivalTimes, nextStop)
                                                                        ) : false;

                                                                        // If trip ends here, show empty
                                                                        if (!hasContinuingStops) {
                                                                            return null;
                                                                        }

                                                                        const recovery = getStopValue(northTrip?.recoveryTimes, stop) || 0;

                                                                        const depValue = recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery);

                                                                        return (
                                                                            <StackedTimeInput
                                                                                value={depValue}
                                                                                onChange={(val) => northTrip && onCellEdit?.(northTrip.id, stop, val)}
                                                                                onBlur={(val) => {
                                                                                    if (northTrip && val && onCellEdit) {
                                                                                        const originalValue = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                                                        const formatted = parseTimeInput(val, originalValue);
                                                                                        if (formatted) onCellEdit(northTrip.id, stop, formatted);
                                                                                    }
                                                                                }}
                                                                                disabled={readOnly || !northTrip}
                                                                                focusClass="focus:ring-blue-100"
                                                                                onAdjust={onTimeAdjust && northTrip && canAdjustNorthDep ? (delta) => onTimeAdjust(northTrip.id, stop, delta) : undefined}
                                                                            />
                                                                        );
                                                                    })()}
                                                                    {onTimeAdjust && northTrip && canAdjustNorthDep && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={12} />
                                                                        </button>
                                                                    )}
                                                                    {connections.length > 0 && (
                                                                        <ConnectionIndicator connections={connections} />
                                                                    )}
                                                                    {(() => {
                                                                        const currentDep = northTrip ? getDepartureDisplayTime(northTrip, stop, combined.routeName, false) : '';
                                                                        const originalDep = getDepartureDisplayTime(originalNorthTrip, stop, combined.routeName, false);
                                                                        const diff = getDeltaMinutes(currentDep, originalDep);
                                                                        if (!diff) return null;
                                                                        return (
                                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                                {diff > 0 ? '+' : ''}{diff}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </td>
                                                            );
                                                        })()}
                                                    </React.Fragment>
                                                    );
                                                })}

                                                {/* South Cells */}
                                                {southDisplayStops.map((stop, i) => {
                                                    const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);

                                                    // Get cell references for this stop's columns
                                                    const arrCellRef = hasRecovery ? columnMapping[dataColIdx]?.letter + displayRowNum : '';
                                                    const rCellRef = hasRecovery ? columnMapping[dataColIdx + 1]?.letter + displayRowNum : '';
                                                    const depCellRef = columnMapping[dataColIdx + (hasRecovery ? 2 : 0)]?.letter + displayRowNum;

                                                    // Increment dataColIdx after computing refs
                                                    const stopColCount = (hasRecovery ? 2 : 0) + 1;
                                                    dataColIdx += stopColCount;

                                                    const southArrivalAtStop = getStopValue(southTrip?.arrivalTimes, stop) || getStopValue(southTrip?.stops, stop) || '';

                                                    // Check if this trip ends at this south stop (no data at subsequent stops)
                                                    const isSouthTripEndingHere = !!(southTrip && southArrivalAtStop && (() => {
                                                        const remainingStops = southDisplayStops.slice(i + 1);
                                                        return !remainingStops.some(nextStop =>
                                                            getStopValue(southTrip.stops, nextStop) ||
                                                            getStopValue(southTrip.arrivalTimes, nextStop)
                                                        );
                                                    })());

                                                    return (
                                                    <React.Fragment key={`s-${stop}`}>
                                                        {hasRecovery && (
                                                            <td className="p-0 relative h-10 group/arr" title={arrCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onTimeAdjust && southTrip && southArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(southTrip.id, `${stop}__ARR`, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <StackedTimeInput
                                                                        value={southArrivalAtStop}
                                                                        onChange={(val) => southTrip && onCellEdit?.(southTrip.id, `${stop}__ARR`, val)}
                                                                        onBlur={(val) => {
                                                                            if (southTrip && val && onCellEdit) {
                                                                                const originalValue = getStopValue(southTrip.arrivalTimes, stop) || getStopValue(southTrip.stops, stop);
                                                                                const formatted = parseTimeInput(val, originalValue);
                                                                                if (formatted) onCellEdit(southTrip.id, `${stop}__ARR`, formatted);
                                                                            }
                                                                        }}
                                                                        disabled={readOnly || !southTrip || !southArrivalAtStop}
                                                                        focusClass="focus:ring-indigo-100"
                                                                        onAdjust={onTimeAdjust && southTrip && southArrivalAtStop ? (delta) => onTimeAdjust(southTrip.id, `${stop}__ARR`, delta) : undefined}
                                                                    />
                                                                    {(() => {
                                                                        const originalArrival = getArrivalDisplayTime(originalSouthTrip, stop);
                                                                        const diff = getDeltaMinutes(southArrivalAtStop, originalArrival);
                                                                        if (!diff) return null;
                                                                        return (
                                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                                {diff > 0 ? '+' : ''}{diff}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                    {onTimeAdjust && southTrip && southArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(southTrip.id, `${stop}__ARR`, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {hasRecovery && (
                                                            <td className="p-0 relative h-8 group/rec text-center font-mono text-xs text-gray-700 font-medium" title={rCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && southTrip && !isSouthTripEndingHere && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(southTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{southArrivalAtStop && !isSouthTripEndingHere ? (getStopValue(southTrip?.recoveryTimes, stop) ?? '') : ''}</span>
                                                                    {onRecoveryEdit && southTrip && !isSouthTripEndingHere && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(southTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="+1 min recovery"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {(() => {
                                                            // Compute departure time for connection indicator
                                                            const southArrival = getStopValue(southTrip?.arrivalTimes, stop) || getStopValue(southTrip?.stops, stop);
                                                            const southRecovery = getStopValue(southTrip?.recoveryTimes, stop) || 0;
                                                            // Suppress departure when trip ends at this stop
                                                            const southDepValue = (southArrival && !isSouthTripEndingHere)
                                                                ? (southRecovery === 0 ? southArrival : TimeUtils.addMinutes(southArrival, southRecovery))
                                                                : '';
                                                            const canAdjustSouthDep = !!southTrip && !!southDepValue;
                                                            const southDepTimeMinutes = southDepValue ? TimeUtils.toMinutes(southDepValue) : null;
                                                            const southStopCode = combined.southStopIds?.[stop] || '';
                                                            const southConnections = connectionLibrary && southStopCode && southDepTimeMinutes !== null
                                                                ? getConnectionsForStop(southStopCode, southDepTimeMinutes, connectionLibrary, dayType)
                                                                : [];

                                                            return (
                                                        <td className={`p-0 relative ${southConnections.length > 0 ? 'h-14' : 'h-10'} group/cell ${i === 0 ? 'border-l border-dashed border-gray-100' : ''}`} title={depCellRef}>
                                                            <div className={`flex ${southConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
                                                                {onTimeAdjust && southTrip && canAdjustSouthDep && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(southTrip.id, stop, -1)}
                                                                        className="absolute left-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                                                        title="-1 min"
                                                                    >
                                                                        <ChevronDown size={12} />
                                                                    </button>
                                                                )}
                                                                <StackedTimeInput
                                                                    value={southDepValue}
                                                                    onChange={(val) => southTrip && onCellEdit?.(southTrip.id, stop, val)}
                                                                    onBlur={(val) => {
                                                                        if (southTrip && val && onCellEdit) {
                                                                            const originalValue = getStopValue(southTrip.arrivalTimes, stop) || getStopValue(southTrip.stops, stop);
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(southTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={readOnly || !southTrip}
                                                                    focusClass="focus:ring-indigo-100"
                                                                    onAdjust={onTimeAdjust && southTrip && canAdjustSouthDep ? (delta) => onTimeAdjust(southTrip.id, stop, delta) : undefined}
                                                                />
                                                                {onTimeAdjust && southTrip && canAdjustSouthDep && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(southTrip.id, stop, 1)}
                                                                        className="absolute right-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                                                        title="+1 min"
                                                                    >
                                                                        <ChevronUp size={12} />
                                                                    </button>
                                                                )}
                                                                {southConnections.length > 0 && (
                                                                    <ConnectionIndicator connections={southConnections} />
                                                                )}
                                                                {(() => {
                                                                    const isLastSouthStop = i === southDisplayStops.length - 1;
                                                                    const currentDep = southTrip ? getDepartureDisplayTime(southTrip, stop, combined.routeName, isLastSouthStop) : '';
                                                                    const originalDep = getDepartureDisplayTime(originalSouthTrip, stop, combined.routeName, isLastSouthStop);
                                                                    const diff = getDeltaMinutes(currentDep, originalDep);
                                                                    if (!diff) return null;
                                                                    return (
                                                                        <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                            {diff > 0 ? '+' : ''}{diff}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </td>
                                                            );
                                                        })()}
                                                    </React.Fragment>
                                                    );
                                                })}

                                                {/* Metrics Columns */}
                                                {showMetaCols && (
                                                    <>
                                                        <td className="p-2 text-center text-sm font-semibold text-gray-700 border-l border-gray-100" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{totalTravel}</td>
                                                        <td className="p-1 text-center" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {(() => {
                                                                const displayBand = northTrip?.assignedBand || southTrip?.assignedBand || '-';
                                                                return (
                                                                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                                                        {displayBand}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="p-2 text-center text-sm text-gray-700" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{totalRec}</td>

                                                        <td className={`p-2 text-center text-sm font-semibold ${ratio > 25 ? 'text-amber-700' : ratio < 10 ? 'text-red-700' : 'text-gray-700'}`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {ratio.toFixed(0)}%
                                                        </td>

                                                        <td className={`p-2 text-center text-sm ${targetHeadway && typeof headway === 'number' && headway !== targetHeadway
                                                            ? 'text-amber-700 bg-amber-100 font-bold ring-1 ring-amber-300'
                                                            : 'text-gray-700'
                                                            }`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {headway}
                                                            {targetHeadway && typeof headway === 'number' && headway !== targetHeadway && (
                                                                <span className="ml-1 text-xs font-semibold">({headway > targetHeadway ? '+' : ''}{headway - targetHeadway})</span>
                                                            )}
                                                        </td>

                                                        <td className={`p-2 text-center text-sm font-semibold ${targetCycleTime && Math.round(displayCycleTime) !== targetCycleTime
                                                            ? 'text-amber-700 bg-amber-100 font-bold ring-1 ring-amber-300'
                                                            : 'text-gray-800'
                                                            }`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {Math.round(displayCycleTime)}
                                                            {targetCycleTime && Math.round(displayCycleTime) !== targetCycleTime && (
                                                                <span className="ml-1 text-xs font-semibold">({Math.round(displayCycleTime) > targetCycleTime ? '+' : ''}{Math.round(displayCycleTime) - targetCycleTime})</span>
                                                            )}
                                                        </td>

                                                        <td className="p-2 text-center text-sm font-mono text-gray-700" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{routeTripNumber}</td>
                                                    </>
                                                )}

                                            </tr>
                                        );
                                    });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}

        </div>
    );
};
