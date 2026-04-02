/**
 * RoundTripTableView Component
 *
 * Displays schedules in a combined North/South round-trip format.
 * Shows trips paired by block with metrics.
 *
 * Extracted from ScheduleEditor.tsx for maintainability.
 */

import React, { useEffect, useMemo, useState, useCallback, useRef, useId } from 'react';
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
} from '../../utils/parsers/masterScheduleParser';
import { TimeUtils } from '../../utils/timeUtils';
import { getRouteVariant, getRouteConfig, getDirectionDisplay, extractDirectionFromName, parseRouteInfo, isBidirectional } from '../../utils/config/routeDirectionConfig';
import { normalizeStopName, matchesStop } from '../NewSchedule/utils/blockStartDirection';
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
} from '../../utils/schedule/scheduleEditorUtils';
import { getOperationalSortTime } from '../../utils/blocks/blockAssignmentCore';
import {
    FilterState,
    shouldGrayOutTrip,
    shouldHighlightTrip,
    matchesSearch
} from '../NewSchedule/QuickActionsBar';
import { StackedTimeCell, StackedTimeInput } from '../ui/StackedTimeInput';
import type { ConnectionLibrary } from '../../utils/connections/connectionTypes';
import type { DayType } from '../../utils/parsers/masterScheduleParser';
import { getConnectionsForStop } from '../../utils/connections/connectionUtils';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useGridNavigation, GridColumn, GridRowInfo } from '../../hooks/useGridNavigation';
import { getRowInsights, type ScheduleInsight } from '../../utils/schedule/scheduleInsights';
import {
    buildDetailedMasterComparison,
    buildTripKey,
    type CurrentTripComparisonEntry,
} from '../../utils/schedule/masterComparison';
import { getTripLineageLookupKey } from '../../utils/schedule/tripLineage';
import {
    MasterCompareReviewPanel,
    type MasterCompareReviewItem
} from './MasterCompareReviewPanel';
import {
    compareRoundTripBlockFlowRows,
    getRoundTripDisplayedCycleTime,
    getRoundTripDisplayedHeadways,
    getRoundTripRowKey,
    getRoundTripRowSignature,
    getRoundTripSortTimeForColumn
} from '../../utils/schedule/roundTripSortUtils';

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

/**
 * Resolve the "key stop" for Block Flow sorting on bidirectional routes.
 * Route 8A/8B: hardcoded Allandale (CLAUDE.md §6).
 * Other bidirectional routes: North terminus from config, fuzzy-matched in stop lists.
 * Routes where A/B means direction use B-first departure fallback logic elsewhere.
 * Loops / unknown routes: returns null → pairIndex fallback.
 */
const resolveKeyStop = (
    baseRoute: string,
    northStops: string[],
    southStops: string[]
): { northStop: string | undefined; southStop: string | undefined; label: string } | null => {
    // Route 8A/8B: hardcoded Allandale (preserves CLAUDE.md §6)
    if (baseRoute === '8A' || baseRoute === '8B') {
        const nStop = northStops.find(s => s.toLowerCase().includes('allandale'));
        const sStop = southStops.find(s => s.toLowerCase().includes('allandale'));
        if (nStop || sStop) return { northStop: nStop, southStop: sStop, label: 'Allandale' };
        return null;
    }

    // Other routes: check config
    const config = getRouteConfig(baseRoute);
    if (!isBidirectional(config)) return null;

    const northSegment = config!.segments.find(s => s.name === 'North');
    const terminus = northSegment?.terminus;
    if (!terminus) return null;

    const normTerminus = normalizeStopName(terminus);
    const nStop = northStops.find(s => matchesStop(normalizeStopName(s), normTerminus));
    const sStop = southStops.find(s => matchesStop(normalizeStopName(s), normTerminus));
    if (!nStop && !sStop) return null;

    return { northStop: nStop, southStop: sStop, label: abbreviateStopName(terminus) };
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

const pickDisplayStops = (
    stops: string[],
    timepointOnly: boolean,
    useAuthoritativeTimepoints: boolean
): string[] => {
    if (!timepointOnly || stops.length <= 3 || useAuthoritativeTimepoints) return stops;
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

const getCombinedSortCacheKey = (
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>
): string => (
    `${combined.routeName}||${combined.northStops.join('||')}||${combined.southStops.join('||')}`
);

const getRoundTripGridCellId = (routeName: string, rowIndex: number, colIndex: number): string => {
    const safeRoute = routeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `roundtrip-grid-${safeRoute || 'route'}-r${rowIndex + 1}-c${colIndex + 1}`;
};

const getRoundTripGridCellLabel = ({
    routeName,
    rowNumber,
    blockId,
    direction,
    stopName,
    cellType,
    value,
    readOnly,
}: {
    routeName: string;
    rowNumber: number;
    blockId: string;
    direction: 'North' | 'South';
    stopName: string;
    cellType: 'arr' | 'dep' | 'recovery';
    value: string;
    readOnly: boolean;
}): string => {
    const cellLabel = cellType === 'arr'
        ? 'arrival time'
        : cellType === 'dep'
            ? 'departure time'
            : 'recovery minutes';
    const currentValue = value ? `Current value ${value}.` : 'Currently empty.';
    const interactionHint = readOnly
        ? ' Read only.'
        : cellType === 'recovery'
            ? ' Use arrow up or down to adjust recovery.'
            : ' Press Enter, F2, or Space to edit.';

    return `${routeName}, row ${rowNumber}, block ${blockId}, ${direction} ${stopName}, ${cellLabel}. ${currentValue}${interactionHint}`;
};

// --- Types ---

export interface RoundTripTableViewProps {
    schedules: MasterRouteTable[];
    useAuthoritativeTimepoints?: boolean;
    onCellEdit?: (tripId: string, col: string, val: string) => void;
    onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void;
    onRecoveryEdit?: (tripId: string, stopName: string, delta: number) => void;
    originalSchedules?: MasterRouteTable[];
    onResetOriginals?: () => void;
    onDeleteTrip?: (tripIds: string[], options?: { treatAsRoundTrip?: boolean }) => void;
    onDuplicateTrip?: (tripId: string) => void;
    onAddTrip?: (afterTripId: string) => void;
    onTripRightClick?: (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number
    ) => void;
    onMenuOpen?: (request: {
        tripId: string;
        x: number;
        y: number;
        direction: 'North' | 'South';
        blockId: string;
        stops: string[];
        rowTripIds?: string[];
        menuLabel?: string;
        addLabel?: string;
        deleteLabel?: string;
        hideTripSpecificActions?: boolean;
    }) => void;
    draftName?: string;
    filter?: FilterState;
    targetCycleTime?: number;
    targetHeadway?: number;
    readOnly?: boolean;
    connectionLibrary?: ConnectionLibrary | null;
    dayType?: DayType;
    masterBaseline?: MasterRouteTable[] | null;
    highlightedTripId?: string | null;
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
    useAuthoritativeTimepoints = false,
    onCellEdit,
    onTimeAdjust,
    onRecoveryEdit,
    originalSchedules,
    onResetOriginals,
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
    dayType = 'Weekday',
    masterBaseline,
    highlightedTripId
}) => {
    // Sort state: 'blockFlow' (default), 'blockId', 'endTime', 'startTime' (first departure), or a stop name
    const [sortColumn, setSortColumn] = useState<string>('blockFlow');
    const [focusMode, setFocusMode] = useState(true);
    const [showDirectionLegend, setShowDirectionLegend] = useState(false);
    const [density, setDensity] = useState<DensityMode>('compact');
    const [timepointOnly, setTimepointOnly] = useState(false);
    const [showMetaCols, setShowMetaCols] = useState(true);
    const [showActionsCol, setShowActionsCol] = useState(true);
    const [showRowNumberCol, setShowRowNumberCol] = useState(false);
    const [showDeltas, setShowDeltas] = useState(true);
    const [compareReviewFocusTripId, setCompareReviewFocusTripId] = useState<string | null>(null);

    useEffect(() => {
        if (!highlightedTripId) return;
        const highlightedRow = document.querySelector('tr[data-highlighted-row="true"]');
        if (highlightedRow instanceof HTMLElement) {
            highlightedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [highlightedTripId, schedules]);

    const isMasterMode = !!masterBaseline && masterBaseline.length > 0;

    // Auto-enable deltas when master mode activates
    useEffect(() => {
        if (isMasterMode) setShowDeltas(true);
    }, [isMasterMode]);

    const originalTripLookup = useMemo(() => {
        const lookup = new Map<string, MasterTrip>();
        (originalSchedules || []).forEach(table => {
            table.trips.forEach(trip => {
                lookup.set(getTripLineageLookupKey(table.routeName, trip), trip);
            });
        });
        return lookup;
    }, [originalSchedules]);

    const getOriginalTrip = (
        routeName: string,
        trip: MasterTrip
    ): MasterTrip | undefined => originalTripLookup.get(getTripLineageLookupKey(routeName, trip));

    const currentTripLookup = useMemo(() => {
        const lookup = new Map<string, { trip: MasterTrip; routeName: string }>();
        schedules.forEach(table => {
            const direction = (extractDirectionFromName(table.routeName) || 'North') as 'North' | 'South';
            table.trips.forEach(trip => {
                lookup.set(buildTripKey(direction, trip.id), {
                    trip,
                    routeName: table.routeName,
                });
            });
        });
        return lookup;
    }, [schedules]);

    const { currentTripComparisons, removedMasterTrips, masterShiftByDir } = useMemo(() => {
        return buildDetailedMasterComparison(isMasterMode ? schedules : [], isMasterMode ? masterBaseline : null);
    }, [masterBaseline, schedules, isMasterMode]);

    const compareReviewItems = useMemo<MasterCompareReviewItem[]>(() => {
        if (!isMasterMode) return [];

        return Array.from(currentTripComparisons.values())
            .filter((entry): entry is Extract<CurrentTripComparisonEntry, { status: 'ambiguous' }> => entry.status === 'ambiguous')
            .map(entry => {
                const tripContext = currentTripLookup.get(buildTripKey(entry.direction, entry.currentTripId));
                const currentTrip = tripContext?.trip;

                return {
                    currentTripId: entry.currentTripId,
                    routeName: tripContext?.routeName || entry.direction,
                    direction: entry.direction,
                    blockId: currentTrip?.blockId,
                    startTime: currentTrip?.startTime ?? 0,
                    endTime: currentTrip?.endTime ?? 0,
                    reason: entry.reason,
                    shiftMinutes: entry.shiftMinutes,
                    candidates: entry.candidates.map(candidate => ({
                        masterTripId: candidate.masterTrip.id,
                        blockId: candidate.masterTrip.blockId,
                        startTime: candidate.masterTrip.startTime,
                        endTime: candidate.masterTrip.endTime,
                        diffMinutes: candidate.diffMinutes,
                    })),
                };
            })
            .sort((a, b) => a.startTime - b.startTime);
    }, [currentTripComparisons, currentTripLookup, isMasterMode]);

    useEffect(() => {
        if (compareReviewItems.length === 0) {
            setCompareReviewFocusTripId(null);
            return;
        }

        if (compareReviewFocusTripId && compareReviewItems.some(item => item.currentTripId === compareReviewFocusTripId)) {
            return;
        }

        setCompareReviewFocusTripId(compareReviewItems[0].currentTripId);
    }, [compareReviewFocusTripId, compareReviewItems]);

    useEffect(() => {
        if (!compareReviewFocusTripId) return;
        const selector = `tr[data-row-trip-ids*="|${compareReviewFocusTripId}|"]`;
        const focusedRow = document.querySelector(selector);
        if (focusedRow instanceof HTMLElement && typeof focusedRow.scrollIntoView === 'function') {
            focusedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [compareReviewFocusTripId, schedules]);

    const masterShiftLabel = useMemo(() => {
        if (!isMasterMode) return null;

        const north = masterShiftByDir.North;
        const south = masterShiftByDir.South;
        const fmt = (shift: number) => `${shift > 0 ? '+' : ''}${shift}m`;

        if (north === undefined && south === undefined) return null;
        if (north !== undefined && south !== undefined && north === south) {
            return `Auto-align ${fmt(north)}`;
        }

        const parts: string[] = [];
        if (north !== undefined) parts.push(`N ${fmt(north)}`);
        if (south !== undefined) parts.push(`S ${fmt(south)}`);
        return `Auto-align ${parts.join(' | ')}`;
    }, [isMasterMode, masterShiftByDir]);

    const getTripComparison = useCallback((direction: 'North' | 'South', tripId: string): CurrentTripComparisonEntry | undefined => (
        currentTripComparisons.get(buildTripKey(direction, tripId))
    ), [currentTripComparisons]);

    const getMasterMatchedTrip = useCallback((direction: 'North' | 'South', tripId: string): MasterTrip | undefined => {
        const comparison = getTripComparison(direction, tripId);
        return comparison?.status === 'matched' ? comparison.masterTrip : undefined;
    }, [getTripComparison]);

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

    const compareRowsForCombined = useCallback((
        combined: RoundTripTable,
        a: RoundTripTable['rows'][number],
        b: RoundTripTable['rows'][number]
    ): number => {
        const getSortTime = (row: typeof combined.rows[0]): number | null => {
            if (
                sortColumn === 'startTime' ||
                sortColumn === 'endTime' ||
                sortColumn.startsWith('north:') ||
                sortColumn.startsWith('south:')
            ) {
                return getRoundTripSortTimeForColumn(row, combined, sortColumn);
            }

            const northTrip = row.trips.find(t => t.direction === 'North');
            const southTrip = row.trips.find(t => t.direction === 'South');
            return northTrip?.startTime ?? southTrip?.startTime ?? null;
        };

        if (sortColumn === 'blockFlow') {
            const directionalSuffixCompare = compareRoundTripBlockFlowRows(a, b, combined, compareBlockIds);
            if (directionalSuffixCompare !== null) {
                return directionalSuffixCompare;
            }

            const baseRoute = combined.routeName.split(' ')[0];
            const keyStop = resolveKeyStop(baseRoute, combined.northStops, combined.southStops);

            if (keyStop) {
                const getKeyStopSortTime = (row: typeof combined.rows[0]): number => {
                    if (keyStop.northStop) {
                        const north = row.trips.find(t => t.direction === 'North');
                        const northTime = north?.stops?.[keyStop.northStop];
                        if (northTime) return TimeUtils.toMinutes(northTime) ?? 0;
                    }
                    if (keyStop.southStop) {
                        const south = row.trips.find(t => t.direction === 'South');
                        const southTime = south?.stops?.[keyStop.southStop];
                        if (southTime) return TimeUtils.toMinutes(southTime) ?? 0;
                    }
                    return getSortTime(row) ?? 0;
                };

                const timeDiff = getOperationalSortTime(getKeyStopSortTime(a))
                    - getOperationalSortTime(getKeyStopSortTime(b));
                if (timeDiff !== 0) return timeDiff;
                return compareBlockIds(a.blockId, b.blockId);
            }

            const pairDiff = (a.pairIndex || 0) - (b.pairIndex || 0);
            if (pairDiff !== 0) return pairDiff;
            const aTime = getSortTime(a);
            const bTime = getSortTime(b);

            if (aTime === null && bTime === null) return compareBlockIds(a.blockId, b.blockId);
            if (aTime === null) return -1;
            if (bTime === null) return 1;

            const timeDiff = aTime - bTime;
            if (timeDiff !== 0) return timeDiff;
            return compareBlockIds(a.blockId, b.blockId);
        }

        if (sortColumn === 'blockId') {
            const blockDiff = compareBlockIds(a.blockId, b.blockId);
            if (blockDiff !== 0) return blockDiff;
        }

        const aTime = getSortTime(a);
        const bTime = getSortTime(b);
        if (aTime === null && bTime === null) return compareBlockIds(a.blockId, b.blockId);
        if (aTime === null) return -1;
        if (bTime === null) return 1;
        return aTime - bTime;
    }, [sortColumn]);

    const stableSortCacheRef = useRef<Record<string, {
        signature: string;
        sortColumn: string;
        order: string[];
    }>>({});

    const sortedRowsByCombinedKey = useMemo(() => {
        const results = new Map<string, RoundTripTable['rows']>();

        roundTripData.forEach(({ combined }) => {
            const cacheKey = getCombinedSortCacheKey(combined);
            const signature = combined.rows.map(getRoundTripRowSignature).join('|');
            const cached = stableSortCacheRef.current[cacheKey];

            if (!cached || cached.signature !== signature || cached.sortColumn !== sortColumn) {
                const freshRows = [...combined.rows].sort((a, b) => compareRowsForCombined(combined, a, b));
                stableSortCacheRef.current[cacheKey] = {
                    signature,
                    sortColumn,
                    order: freshRows.map(getRoundTripRowKey)
                };
                results.set(cacheKey, freshRows);
                return;
            }

            const rowMap = new Map(combined.rows.map(row => [getRoundTripRowKey(row), row]));
            const cachedKeys = new Set(cached.order);
            const orderedRows = cached.order
                .map(key => rowMap.get(key))
                .filter((row): row is RoundTripTable['rows'][number] => !!row);
            const missingRows = combined.rows
                .filter(row => !cachedKeys.has(getRoundTripRowKey(row)))
                .sort((a, b) => compareRowsForCombined(combined, a, b));

            const finalRows = [...orderedRows, ...missingRows];
            if (missingRows.length > 0) {
                stableSortCacheRef.current[cacheKey] = {
                    signature,
                    sortColumn,
                    order: finalRows.map(getRoundTripRowKey)
                };
            }
            results.set(cacheKey, finalRows);
        });

        return results;
    }, [compareRowsForCombined, roundTripData, sortColumn]);

    const getSortedRows = useCallback((combined: RoundTripTable): RoundTripTable['rows'] => (
        sortedRowsByCombinedKey.get(getCombinedSortCacheKey(combined))
        ?? [...combined.rows].sort((a, b) => compareRowsForCombined(combined, a, b))
    ), [compareRowsForCombined, sortedRowsByCombinedKey]);

    // --- Grid Navigation Setup ---
    // Compute navigable columns for Excel-like keyboard navigation
    const primaryPair = roundTripData[0] || null;

    const gridColumns = useMemo<GridColumn[]>(() => {
        if (!primaryPair) return [];
        const { combined } = primaryPair;
        const columns: GridColumn[] = [];

        const nRecovery = new Set<string>();
        const sRecovery = new Set<string>();
        combined.rows.forEach(row => {
            row.trips.forEach(t => {
                if (t.recoveryTimes) {
                    Object.entries(t.recoveryTimes).forEach(([stop, min]) => {
                        if (min !== undefined && min !== null) {
                            if (combined.northStops.includes(stop)) nRecovery.add(stop);
                            if (combined.southStops.includes(stop)) sRecovery.add(stop);
                        }
                    });
                }
            });
        });

        const nDisplayStops = pickDisplayStops(combined.northStops, timepointOnly, useAuthoritativeTimepoints);
        const sDisplayStops = pickDisplayStops(combined.southStops, timepointOnly, useAuthoritativeTimepoints);
        const lastNorthStop = combined.northStops[combined.northStops.length - 1];
        const firstSouthStop = combined.southStops[0];
        const merged = lastNorthStop && firstSouthStop &&
            lastNorthStop.toLowerCase() === firstSouthStop.toLowerCase();
        const lastNIdx = nDisplayStops.length - 1;

        nDisplayStops.forEach((stop, i) => {
            const isLast = i === lastNIdx;
            const isMerged = isLast && merged;
            const hasRec = i > 0 && nRecovery.has(stop);
            const showArr = hasRec || isMerged;
            if (showArr) {
                columns.push({ stopName: stop, cellType: 'arr', direction: 'North' });
                columns.push({ stopName: stop, cellType: 'recovery', direction: 'North' });
            }
            if (!isMerged) {
                columns.push({ stopName: stop, cellType: 'dep', direction: 'North' });
            }
        });

        sDisplayStops.forEach((stop, i) => {
            const hasRec = i > 0 && sRecovery.has(stop);
            if (hasRec) {
                columns.push({ stopName: stop, cellType: 'arr', direction: 'South' });
                columns.push({ stopName: stop, cellType: 'recovery', direction: 'South' });
            }
            columns.push({ stopName: stop, cellType: 'dep', direction: 'South' });
        });

        return columns;
    }, [primaryPair, timepointOnly, useAuthoritativeTimepoints]);

    // Sort rows for grid navigation (mirrors render sort order)
    const gridSortedRows = useMemo(() => {
        if (!primaryPair) return [];
        const { combined } = primaryPair;
        return getSortedRows(combined);
    }, [getSortedRows, primaryPair]);

    // Resolve key stop label for Block Flow dropdown
    const keyStopLabel = useMemo(() => {
        if (!primaryPair) return null;
        const { combined } = primaryPair;
        const baseRoute = combined.routeName.split(' ')[0];
        const config = getRouteConfig(baseRoute);
        if (config?.suffixIsDirection) return null;
        const ks = resolveKeyStop(baseRoute, combined.northStops, combined.southStops);
        return ks?.label ?? null;
    }, [primaryPair]);

    // Build GridRowInfo for each sorted row
    const gridRows = useMemo<GridRowInfo[]>(() => {
        return gridSortedRows.map(row => {
            const nTrip = row.trips.find(t => t.direction === 'North');
            const sTrip = row.trips.find(t => t.direction === 'South');
            const populatedCols = gridColumns.map(col => {
                const trip = col.direction === 'North' ? nTrip : sTrip;
                if (!trip) return false;
                return !!(getStopValue(trip.arrivalTimes, col.stopName) || getStopValue(trip.stops, col.stopName));
            });
            return {
                northTripId: nTrip?.id || null,
                southTripId: sTrip?.id || null,
                populatedCols,
            };
        });
    }, [gridSortedRows, gridColumns]);

    // Grid nav callbacks
    const handleGridCopy = useCallback((addr: { tripId: string; stopName: string; cellType: string }) => {
        for (const table of schedules) {
            const trip = table.trips.find(t => t.id === addr.tripId);
            if (!trip) continue;
            if (addr.cellType === 'recovery') {
                const rec = getStopValue(trip.recoveryTimes, addr.stopName);
                return rec !== undefined ? String(rec) : null;
            }
            if (addr.cellType === 'arr') {
                return getArrivalDisplayTime(trip, addr.stopName) || null;
            }
            return getDepartureDisplayTime(trip, addr.stopName) || null;
        }
        return null;
    }, [schedules]);

    const handleGridPaste = useCallback((addr: { tripId: string; stopName: string; cellType: string }, value: string) => {
        if (!onCellEdit || addr.cellType === 'recovery') return;
        const col = addr.cellType === 'arr' ? `${addr.stopName}__ARR` : addr.stopName;
        let originalValue: string | undefined;
        for (const table of schedules) {
            const trip = table.trips.find(t => t.id === addr.tripId);
            if (!trip) continue;
            originalValue = addr.cellType === 'arr'
                ? getArrivalDisplayTime(trip, addr.stopName) || undefined
                : getDepartureDisplayTime(trip, addr.stopName) || undefined;
            break;
        }
        const formatted = parseTimeInput(value, originalValue);
        if (formatted) onCellEdit(addr.tripId, col, formatted);
    }, [onCellEdit, schedules]);

    const handleGridNudge = useCallback((addr: { tripId: string; stopName: string; cellType: string }, delta: number) => {
        if (addr.cellType === 'recovery') {
            onRecoveryEdit?.(addr.tripId, addr.stopName, delta);
        } else {
            const col = addr.cellType === 'arr' ? `${addr.stopName}__ARR` : addr.stopName;
            onTimeAdjust?.(addr.tripId, col, delta);
        }
    }, [onTimeAdjust, onRecoveryEdit]);

    const gridCallbacks = useMemo(() => ({
        onNudge: handleGridNudge,
        onCopy: handleGridCopy,
        onPaste: handleGridPaste,
    }), [handleGridNudge, handleGridCopy, handleGridPaste]);

    const gridNav = useGridNavigation({
        columns: gridColumns,
        rows: gridRows,
        callbacks: gridCallbacks,
        disabled: readOnly,
    });

    const gridInstructionsId = useId();
    const activeGridCellId = primaryPair && gridNav.activeCell
        ? getRoundTripGridCellId(primaryPair.combined.routeName, gridNav.activeCell.rowIndex, gridNav.activeCell.colIndex)
        : undefined;

    const handleGridRegionFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && !gridNav.activeCell) {
            gridNav.focusFirstCell();
        }
    }, [gridNav.activeCell, gridNav.focusFirstCell]);

    // Refocus grid container after edit so arrow keys keep working
    const handleNavAway = useCallback((direction: 'down' | 'right' | 'left' | 'cancel') => {
        if (direction === 'cancel') {
            gridNav.cancelEdit();
        } else {
            gridNav.commitEdit(direction === 'down' ? 'down' : direction === 'right' ? 'right' : direction === 'left' ? 'left' : 'none');
        }
        requestAnimationFrame(() => {
            gridNav.containerRef.current?.focus();
        });
    }, [gridNav.cancelEdit, gridNav.commitEdit, gridNav.containerRef]);

    // Clear active cell when sort changes (row indices shift)
    useEffect(() => {
        gridNav.clearActiveCell();
    }, [sortColumn]); // eslint-disable-line react-hooks/exhaustive-deps

    if (roundTripData.length === 0) return <div className="text-center p-8 text-gray-400">No matching North/South pairs found.</div>;

    return (
        <div
            className="space-y-8 h-full flex flex-col outline-none"
            ref={gridNav.containerRef}
            tabIndex={0}
            onKeyDown={gridNav.handleKeyDown}
            onFocus={handleGridRegionFocus}
            role="region"
            aria-label="Round-trip schedule editor grid"
            aria-describedby={gridInstructionsId}
            aria-activedescendant={activeGridCellId}
        >
            <p id={gridInstructionsId} className="sr-only">
                Use arrow keys to move between populated cells. Press Enter, F2, or Space to edit a time cell.
                While editing, Tab moves across cells, Enter saves and moves down, and Escape cancels.
                Use Control or Command plus C or V to copy or paste the active cell.
                Recovery cells use the up and down arrows to adjust minutes.
            </p>
            {roundTripData.map(({ combined, north, south, northTripOrder, southTripOrder }) => {
                const allNorthTrips = north?.trips || [];
                const allSouthTrips = south?.trips || [];
                const routeCompareReviewItems = compareReviewItems.filter(item => (
                    item.routeName === north.routeName || item.routeName === south.routeName
                ));
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
                const northDisplayStops = pickDisplayStops(combined.northStops, timepointOnly, useAuthoritativeTimepoints);
                const southDisplayStops = pickDisplayStops(combined.southStops, timepointOnly, useAuthoritativeTimepoints);
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
                const totalTravelSum = combined.rows.reduce((sum, r) => sum + r.totalTravelTime, 0);
                const totalRecoverySum = combined.rows.reduce((sum, r) => sum + r.totalRecoveryTime, 0);
                const totalCycleSum = combined.rows.reduce((sum, r) => sum + getRoundTripDisplayedCycleTime(r), 0);
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
                                {(isMasterMode || (originalSchedules && originalSchedules.length > 0)) && (
                                    <>
                                        <button
                                            onClick={() => setShowDeltas(v => !v)}
                                            className={`px-2 py-1 rounded text-xs font-semibold border ${showDeltas
                                                ? (isMasterMode ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-green-50 text-green-700 border-green-200')
                                                : 'bg-white text-gray-700 border-gray-300'}`}
                                            title={isMasterMode ? 'Show differences from Master schedule' : 'Show time differences from original'}
                                        >
                                            {isMasterMode ? 'Master Deltas' : '+/- Deltas'}
                                        </button>
                                        {isMasterMode && masterShiftLabel && (
                                            <span
                                                className="px-2 py-1 rounded text-xs font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200"
                                                title="Detected global time offset used to align current trips to master during comparison"
                                            >
                                                {masterShiftLabel}
                                            </span>
                                        )}
                                        {showDeltas && !isMasterMode && onResetOriginals && (
                                            <button
                                                onClick={onResetOriginals}
                                                className="px-2 py-1 rounded text-xs font-semibold border bg-white text-gray-700 border-gray-300 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                                                title="Revert schedule to original times"
                                            >
                                                Reset Deltas
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Always-visible summary */}
                                <div className="flex items-center gap-2 text-xs md:text-sm">
                                    <span className="text-base font-bold text-gray-900">{(totalCycleSum / 60).toFixed(1)}h cycle</span>
                                    <span className="text-gray-500">•</span>
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
                                            <option value="blockFlow">Sort: Block Flow{keyStopLabel ? ` (${keyStopLabel})` : ''}</option>
                                            <option value="blockId">Sort: Block #</option>
                                            <option value="endTime">Sort: End Arrival</option>
                                            <option value="startTime">Sort: First Departure</option>
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

                        {isMasterMode && routeCompareReviewItems.length > 0 && (
                            <div className="px-3 pb-3">
                                <MasterCompareReviewPanel
                                    items={routeCompareReviewItems}
                                    activeTripId={compareReviewFocusTripId}
                                    onSelectTrip={setCompareReviewFocusTripId}
                                />
                            </div>
                        )}

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

                            <table
                                className={`w-full text-left border-collapse ${densityClass.cell}`}
                                style={{ tableLayout: 'fixed' }}
                                role="grid"
                                aria-label={`${combined.routeName} round-trip schedule grid`}
                                aria-readonly={readOnly || undefined}
                            >
                                <colgroup>{(() => {
                                    const cols: React.ReactElement[] = [];
                                    if (showRowNum) cols.push(<col key="row-num" className="w-8" />);
                                    if (showActions) cols.push(<col key="actions" className="w-16" />);
                                    cols.push(<col key="block" className="w-14" />);

                                    northDisplayStops.forEach((stop, i) => {
                                        const isLastStop = i === lastNorthStopIdx;
                                        const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                        const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                        const showArrRCols = hasRecovery || isMergedTerminusStop;
                                        if (showArrRCols) cols.push(<col key={`n-arr-${i}`} className="w-14" />);
                                        if (showArrRCols) cols.push(<col key={`n-r-${i}`} className="w-8" />);
                                        if (!isMergedTerminusStop) cols.push(<col key={`n-dep-${i}`} style={{ width: '80px' }} />);
                                    });

                                    southDisplayStops.forEach((stop, i) => {
                                        const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);
                                        if (hasRecovery) cols.push(<col key={`s-arr-${i}`} className="w-14" />);
                                        if (hasRecovery) cols.push(<col key={`s-r-${i}`} className="w-8" />);
                                        cols.push(<col key={`s-dep-${i}`} style={{ width: '80px' }} />);
                                    });

                                    if (showMetaCols) cols.push(<col key="meta-travel" style={{ width: '50px' }} />);
                                    if (showMetaCols) cols.push(<col key="meta-band" style={{ width: '42px' }} />);
                                    if (showMetaCols) cols.push(<col key="meta-rec" style={{ width: '38px' }} />);
                                    if (showMetaCols) cols.push(<col key="meta-ratio" style={{ width: '46px' }} />);
                                    if (showMetaCols) cols.push(<col key="meta-headway" style={{ width: '50px' }} />);
                                    if (showMetaCols) cols.push(<col key="meta-cycle" style={{ width: '54px' }} />);
                                    if (showMetaCols) cols.push(<col key="meta-trip-number" style={{ width: '46px' }} />);
                                    return cols;
                                })()}</colgroup>
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
                                        <th rowSpan={2} className={`p-2 border-b border-gray-200 bg-gray-100 ${densityClass.header} font-semibold text-gray-700 uppercase tracking-wide text-center align-middle`}>Block</th>
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
                                        // Keep the displayed row order stable while editing so
                                        // repeated +/- nudges stay on the same block instead of
                                        // jumping to a different row after a live re-sort.
                                        const sortedRows = getSortedRows(combined);
                                        const rowHeadways = getRoundTripDisplayedHeadways(sortedRows, combined);
                                        const displayedHeadwayValues = Object.values(rowHeadways);

                                        return sortedRows.map((row, rowIdx) => {
                                        const northTrip = row.trips.find(t => t.direction === 'North');
                                        const southTrip = row.trips.find(t => t.direction === 'South');
                                        const lastTrip = [...row.trips].sort((a, b) => a.startTime - b.startTime).pop();
                                        const addTripReference = northTrip ?? lastTrip ?? southTrip;
                                        const actionTrip = lastTrip ?? northTrip ?? southTrip;
                                        const actionStops = actionTrip?.direction === 'South' ? combined.southStops : combined.northStops;
                                        const rowTripIds = row.trips.map(trip => trip.id);

                                        const stableRowKey = getRoundTripRowKey(row);
                                        const uniqueRowKey = stableRowKey;

            const totalTravel = row.totalTravelTime;
            const totalRec = row.totalRecoveryTime;
            const displayCycleTime = getRoundTripDisplayedCycleTime(row);
                                        const ratio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;

                                        const headway = rowHeadways[stableRowKey]
                                            ?? (northTrip ? headways[northTrip.id] : (southTrip ? headways[southTrip.id] : '-'));

                                        const ratioColorClass = getRatioColor(ratio);

                                        const assignedBand = northTrip?.assignedBand || southTrip?.assignedBand;
                                        const northIndex = northTrip ? northTripOrder.get(northTrip.id) : undefined;
                                        const southIndex = southTrip ? southTripOrder.get(southTrip.id) : undefined;
                                        const routeTripNumber = northIndex ?? southIndex ?? rowIdx + 1;
                                        const rowBg = rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50';
                                        const northComparison = northTrip ? getTripComparison('North', northTrip.id) : undefined;
                                        const southComparison = southTrip ? getTripComparison('South', southTrip.id) : undefined;
                                        const originalNorthTrip = northTrip
                                            ? (isMasterMode ? getMasterMatchedTrip('North', northTrip.id) : getOriginalTrip(north.routeName, northTrip))
                                            : undefined;
                                        const originalSouthTrip = southTrip
                                            ? (isMasterMode ? getMasterMatchedTrip('South', southTrip.id) : getOriginalTrip(south.routeName, southTrip))
                                            : undefined;

                                        // NEW trip: exists in current schedule but not matched to any master trip
                                        const isNewTrip = isMasterMode
                                            && (
                                                northComparison?.status === 'new'
                                                || southComparison?.status === 'new'
                                            )
                                            && northComparison?.status !== 'ambiguous'
                                            && southComparison?.status !== 'ambiguous'
                                            && !originalNorthTrip
                                            && !originalSouthTrip;
                                        const isReviewTrip = isMasterMode
                                            && (
                                                northComparison?.status === 'ambiguous'
                                                || southComparison?.status === 'ambiguous'
                                            );
                                        const compareReason = isMasterMode
                                            ? [northComparison?.reason, southComparison?.reason].filter(Boolean).join(' ')
                                            : undefined;
                                        const matchMethodLabel = isMasterMode
                                            ? [northComparison, southComparison]
                                                .find(entry => entry?.status === 'matched' && entry.matchMethod === 'time-shift')
                                            : undefined;

                                        const tripStartTime = northTrip?.startTime || southTrip?.startTime || 0;
                                        const tripEndTime = northTrip?.endTime || southTrip?.endTime || 0;
                                        const isGrayedOut = filter ? shouldGrayOutTrip(tripStartTime, tripEndTime, filter) : false;
                                        const isHighlighted = filter ? shouldHighlightTrip(totalTravel, totalRec, typeof headway === 'number' ? headway : null, filter) : false;
                                        const matchesSearchFilter = filter ? matchesSearch(row.blockId, [...combined.northStops, ...combined.southStops], filter.search) : true;

                                        const grayOutClass = isGrayedOut ? 'opacity-40' : '';
                                        const filterHighlightClass = isHighlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-200' : '';
                                        const searchHideClass = !matchesSearchFilter ? 'hidden' : '';
                                        const isRecentlyAddedRow = !!highlightedTripId && row.trips.some(trip => trip.id === highlightedTripId);
                                        const isCompareReviewFocusedRow = !!compareReviewFocusTripId && row.trips.some(trip => trip.id === compareReviewFocusTripId);

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

                                        // Grid navigation column index (only editable cells)
                                        let gridColIdx = 0;

                                        // Smart insight badges (amber dot on first dep cell)
                                        const rowInsights = getRowInsights(
                                            typeof headway === 'number' ? headway : null,
                                            displayedHeadwayValues,
                                            totalTravel,
                                            totalRec,
                                            targetHeadway
                                        );
                                        let insightBadgeShown = false;
                                        const getEditableCellProps = (
                                            gridCol: number,
                                            direction: 'North' | 'South',
                                            stopName: string,
                                            cellType: 'arr' | 'dep' | 'recovery',
                                            value: string
                                        ) => ({
                                            id: getRoundTripGridCellId(combined.routeName, rowIdx, gridCol),
                                            role: 'gridcell' as const,
                                            'aria-selected': gridNav.isCellActive(rowIdx, gridCol),
                                            'aria-label': getRoundTripGridCellLabel({
                                                routeName: combined.routeName,
                                                rowNumber: displayRowNum,
                                                blockId: row.blockId,
                                                direction,
                                                stopName,
                                                cellType,
                                                value,
                                                readOnly,
                                            }),
                                        });

                                        return (
                                            <tr
                                                key={uniqueRowKey}
                                                className={`group hover:bg-blue-50/50 ${rowBg} ${grayOutClass} ${filterHighlightClass} ${searchHideClass} ${isReviewTrip ? 'ring-2 ring-inset ring-amber-300 bg-amber-50/40' : ''} ${isNewTrip ? 'ring-2 ring-inset ring-green-300 bg-green-50/30' : ''} ${isRecentlyAddedRow ? 'ring-2 ring-inset ring-emerald-400 bg-emerald-50/60' : ''} ${isCompareReviewFocusedRow ? 'ring-2 ring-inset ring-amber-400 bg-amber-50/70' : ''} ${gridNav.isRowActive(rowIdx) ? 'bg-blue-50/30' : ''}`}
                                                data-highlighted-row={isRecentlyAddedRow ? 'true' : 'false'}
                                                data-row-trip-ids={`|${rowTripIds.join('|')}|`}
                                                title={compareReason}
                                                onContextMenu={(e) => {
                                                    if (onTripRightClick && actionTrip) {
                                                        onTripRightClick(e, actionTrip.id, actionTrip.direction, row.blockId, actionStops);
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
                                                            {onAddTrip && addTripReference && (
                                                                <button
                                                                    onClick={() => onAddTrip(addTripReference.id)}
                                                                    className="p-1 rounded hover:bg-green-50 text-gray-600 hover:text-green-700 transition-colors"
                                                                    title="Add trip near this row"
                                                                    aria-label="Add trip"
                                                                >
                                                                    <Plus size={12} />
                                                                </button>
                                                            )}
                                                            {actionTrip && onMenuOpen && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                        onMenuOpen({
                                                                            tripId: addTripReference?.id ?? actionTrip.id,
                                                                            x: rect.left,
                                                                            y: rect.bottom + 4,
                                                                            direction: actionTrip.direction,
                                                                            blockId: row.blockId,
                                                                            stops: actionStops,
                                                                            rowTripIds,
                                                                            menuLabel: 'Round-trip actions',
                                                                            addLabel: 'Add Trip',
                                                                            deleteLabel: 'Delete Round Trip',
                                                                            hideTripSpecificActions: true
                                                                        });
                                                                    }}
                                                                    className="p-1 rounded hover:bg-blue-50 text-gray-600 hover:text-blue-700 transition-colors"
                                                                    title="Round-trip actions"
                                                                    aria-label="Round-trip actions"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                            )}
                                                            {onDeleteTrip && rowTripIds.length > 0 && (
                                                                <button
                                                                    onClick={() => onDeleteTrip(rowTripIds, { treatAsRoundTrip: true })}
                                                                    className="p-1 rounded hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
                                                                    title="Delete round trip"
                                                                    aria-label="Delete round trip"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}

                                                {/* Block ID */}
                                                <td className={`p-2 border-r border-gray-100 ${isReviewTrip ? 'bg-amber-50' : isNewTrip ? 'bg-green-50' : 'bg-white'} group-hover:bg-gray-100 font-medium text-xs text-gray-700 text-center`}>
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span>{row.blockId}</span>
                                                        {isReviewTrip && (
                                                            <span className="text-[9px] text-amber-800 bg-amber-100 px-1 rounded font-bold" title={compareReason}>REVIEW</span>
                                                        )}
                                                        {!isReviewTrip && !isNewTrip && matchMethodLabel && (
                                                            <span className="text-[9px] text-indigo-700 bg-indigo-100 px-1 rounded font-bold" title={matchMethodLabel.reason}>ALIGNED</span>
                                                        )}
                                                        {!isReviewTrip && isNewTrip && (
                                                            <span className="text-[9px] text-green-700 bg-green-100 px-1 rounded font-bold" title={compareReason}>NEW</span>
                                                        )}
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

                                                    // Grid nav column indices for this stop
                                                    const arrGridCol = showArrRCols ? gridColIdx : -1;
                                                    const recGridCol = showArrRCols ? gridColIdx + 1 : -1;
                                                    const depGridCol = !isMergedTerminusStop ? gridColIdx + (showArrRCols ? 2 : 0) : -1;
                                                    gridColIdx += (showArrRCols ? 2 : 0) + (isMergedTerminusStop ? 0 : 1);
                                                    const northArrivalConnections = showArrRCols
                                                        ? (() => {
                                                            const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                            const recovery = getStopValue(northTrip?.recoveryTimes, stop) || 0;
                                                            const arrivalTimeMinutes = arrival ? TimeUtils.toMinutes(arrival) : null;
                                                            const depTimeMinutes = arrival ? TimeUtils.toMinutes(
                                                                recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery)
                                                            ) : null;
                                                            const stopCode = combined.northStopIds?.[stop] || '';
                                                            const stopConnections = connectionLibrary && stopCode && (arrivalTimeMinutes !== null || depTimeMinutes !== null)
                                                                ? getConnectionsForStop(
                                                                    stopCode,
                                                                    {
                                                                        arrival: arrivalTimeMinutes,
                                                                        departure: depTimeMinutes
                                                                    },
                                                                    connectionLibrary,
                                                                    dayType
                                                                )
                                                                : [];
                                                            return stopConnections.filter(connection => connection.eventType === 'departure');
                                                        })()
                                                        : [];

                                                    return (
                                                    <React.Fragment key={`n-${stop}`}>
                                                        {showArrRCols && (
                                                            <td
                                                                className={`p-0 relative ${northArrivalConnections.length > 0 ? 'h-14' : 'h-10'} group/arr ${gridNav.isCellActive(rowIdx, arrGridCol) ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                                                                title={arrCellRef}
                                                                data-grid-row={rowIdx}
                                                                data-grid-col={arrGridCol}
                                                                {...getEditableCellProps(arrGridCol, 'North', stop, 'arr', northArrivalAtStop)}
                                                            >
                                                                <div className={`flex ${northArrivalConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
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
                                                                        onChange={() => {}}
                                                                        onBlur={(val) => {
                                                                            if (northTrip && val && onCellEdit) {
                                                                                const formatted = parseTimeInput(val, northArrivalAtStop);
                                                                                if (formatted) onCellEdit(northTrip.id, `${stop}__ARR`, formatted);
                                                                            }
                                                                        }}
                                                                        disabled={readOnly || !northTrip}
                                                                        focusClass="focus:ring-blue-100"
                                                                        isActive={gridNav.isCellActive(rowIdx, arrGridCol)}
                                                                        onActivate={() => gridNav.activateCell(rowIdx, arrGridCol)}
                                                                        onNudge={(delta) => northTrip && onTimeAdjust?.(northTrip.id, `${stop}__ARR`, delta)}
                                                                        onNavigateAway={handleNavAway}
                                                                        externalEdit={gridNav.isEditing && gridNav.isCellActive(rowIdx, arrGridCol)}
                                                                        ariaLabel={getRoundTripGridCellLabel({
                                                                            routeName: combined.routeName,
                                                                            rowNumber: displayRowNum,
                                                                            blockId: row.blockId,
                                                                            direction: 'North',
                                                                            stopName: stop,
                                                                            cellType: 'arr',
                                                                            value: northArrivalAtStop,
                                                                            readOnly,
                                                                        })}
                                                                    />
                                                                    {northArrivalConnections.length > 0 && (
                                                                        <ConnectionIndicator connections={northArrivalConnections} />
                                                                    )}
                                                                    {showDeltas && (() => {
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
                                                            <td
                                                                className={`p-0 relative h-8 group/rec text-center font-mono text-xs text-gray-700 font-medium ${gridNav.isCellActive(rowIdx, recGridCol) ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                                                                title={rCellRef}
                                                                data-grid-row={rowIdx}
                                                                data-grid-col={recGridCol}
                                                                onClick={() => gridNav.activateCell(rowIdx, recGridCol)}
                                                                {...getEditableCellProps(recGridCol, 'North', stop, 'recovery', northArrivalAtStop ? String(getStopValue(northTrip?.recoveryTimes, stop) ?? '') : '')}
                                                            >
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && northTrip && northArrivalAtStop && (
                                                                        <button
                                                                            type="button"
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                onRecoveryEdit(northTrip.id, stop, -1);
                                                                            }}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{northArrivalAtStop ? (getStopValue(northTrip?.recoveryTimes, stop) ?? '') : ''}</span>
                                                                    {onRecoveryEdit && northTrip && northArrivalAtStop && (
                                                                        <button
                                                                            type="button"
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                onRecoveryEdit(northTrip.id, stop, 1);
                                                                            }}
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
                                                            const arrivalTimeMinutes = arrival ? TimeUtils.toMinutes(arrival) : null;
                                                            const depTimeMinutes = arrival ? TimeUtils.toMinutes(
                                                                recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery)
                                                            ) : null;
                                                            const stopCode = combined.northStopIds?.[stop] || '';
                                                            const connections = connectionLibrary && stopCode && (arrivalTimeMinutes !== null || depTimeMinutes !== null)
                                                                ? getConnectionsForStop(
                                                                    stopCode,
                                                                    {
                                                                        arrival: arrivalTimeMinutes,
                                                                        departure: depTimeMinutes
                                                                    },
                                                                    connectionLibrary,
                                                                    dayType
                                                                )
                                                                : [];
                                                            const departureConnections = showArrRCols
                                                                ? connections.filter(connection => connection.eventType === 'arrival')
                                                                : connections;

                                                            return (
                                                            <td
                                                                className={`p-0 relative ${departureConnections.length > 0 ? 'h-14' : 'h-10'} group/cell ${i === 0 ? 'bg-white border-l border-dashed border-gray-100' : ''} ${gridNav.isCellActive(rowIdx, depGridCol) ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                                                                title={depCellRef}
                                                                data-grid-row={rowIdx}
                                                                data-grid-col={depGridCol}
                                                                {...getEditableCellProps(depGridCol, 'North', stop, 'dep', canAdjustNorthDep ? getDepartureDisplayTime(northTrip, stop, combined.routeName, false) : '')}
                                                            >
                                                                <div className={`flex ${departureConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
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
                                                                                onChange={() => {}}
                                                                                onBlur={(val) => {
                                                                                    if (northTrip && val && onCellEdit) {
                                                                                        const originalValue = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                                                        const formatted = parseTimeInput(val, originalValue);
                                                                                        if (formatted) onCellEdit(northTrip.id, stop, formatted);
                                                                                    }
                                                                                }}
                                                                                disabled={readOnly || !northTrip}
                                                                                focusClass="focus:ring-blue-100"
                                                                                isActive={gridNav.isCellActive(rowIdx, depGridCol)}
                                                                                onActivate={() => gridNav.activateCell(rowIdx, depGridCol)}
                                                                                onNudge={(delta) => northTrip && onTimeAdjust?.(northTrip.id, stop, delta)}
                                                                                onNavigateAway={handleNavAway}
                                                                                externalEdit={gridNav.isEditing && gridNav.isCellActive(rowIdx, depGridCol)}
                                                                                ariaLabel={getRoundTripGridCellLabel({
                                                                                    routeName: combined.routeName,
                                                                                    rowNumber: displayRowNum,
                                                                                    blockId: row.blockId,
                                                                                    direction: 'North',
                                                                                    stopName: stop,
                                                                                    cellType: 'dep',
                                                                                    value: depValue,
                                                                                    readOnly,
                                                                                })}
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
                                                                    {departureConnections.length > 0 && (
                                                                        <ConnectionIndicator connections={departureConnections} />
                                                                    )}
                                                                    {!insightBadgeShown && rowInsights.length > 0 && (() => {
                                                                        insightBadgeShown = true;
                                                                        return (
                                                                            <span
                                                                                className="absolute bottom-0.5 left-0.5 w-2 h-2 rounded-full bg-amber-400"
                                                                                title={rowInsights.map(i => i.message).join(' | ')}
                                                                            />
                                                                        );
                                                                    })()}
                                                                    {showDeltas && (() => {
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

                                                    // Grid nav column indices for this South stop
                                                    const sArrGridCol = hasRecovery ? gridColIdx : -1;
                                                    const sRecGridCol = hasRecovery ? gridColIdx + 1 : -1;
                                                    const sDepGridCol = gridColIdx + (hasRecovery ? 2 : 0);
                                                    gridColIdx += (hasRecovery ? 2 : 0) + 1;

                                                    const southArrivalAtStop = getStopValue(southTrip?.arrivalTimes, stop) || getStopValue(southTrip?.stops, stop) || '';
                                                    const southArrivalConnections = hasRecovery
                                                        ? (() => {
                                                            const southArrival = getStopValue(southTrip?.arrivalTimes, stop) || getStopValue(southTrip?.stops, stop);
                                                            const southRecovery = getStopValue(southTrip?.recoveryTimes, stop) || 0;
                                                            const southArrivalTimeMinutes = southArrival ? TimeUtils.toMinutes(southArrival) : null;
                                                            const southDepTimeMinutes = southArrival ? TimeUtils.toMinutes(
                                                                southRecovery === 0 ? southArrival : TimeUtils.addMinutes(southArrival, southRecovery)
                                                            ) : null;
                                                            const southStopCode = combined.southStopIds?.[stop] || '';
                                                            const stopConnections = connectionLibrary && southStopCode && (southArrivalTimeMinutes !== null || southDepTimeMinutes !== null)
                                                                ? getConnectionsForStop(
                                                                    southStopCode,
                                                                    {
                                                                        arrival: southArrivalTimeMinutes,
                                                                        departure: southDepTimeMinutes
                                                                    },
                                                                    connectionLibrary,
                                                                    dayType
                                                                )
                                                                : [];
                                                            return stopConnections.filter(connection => connection.eventType === 'departure');
                                                        })()
                                                        : [];

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
                                                            <td
                                                                className={`p-0 relative ${southArrivalConnections.length > 0 ? 'h-14' : 'h-10'} group/arr ${gridNav.isCellActive(rowIdx, sArrGridCol) ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                                                                title={arrCellRef}
                                                                data-grid-row={rowIdx}
                                                                data-grid-col={sArrGridCol}
                                                                {...getEditableCellProps(sArrGridCol, 'South', stop, 'arr', southArrivalAtStop)}
                                                            >
                                                                <div className={`flex ${southArrivalConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
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
                                                                        onChange={() => {}}
                                                                        onBlur={(val) => {
                                                                            if (southTrip && val && onCellEdit) {
                                                                                const originalValue = getStopValue(southTrip.arrivalTimes, stop) || getStopValue(southTrip.stops, stop);
                                                                                const formatted = parseTimeInput(val, originalValue);
                                                                                if (formatted) onCellEdit(southTrip.id, `${stop}__ARR`, formatted);
                                                                            }
                                                                        }}
                                                                        disabled={readOnly || !southTrip}
                                                                        focusClass="focus:ring-indigo-100"
                                                                        isActive={gridNav.isCellActive(rowIdx, sArrGridCol)}
                                                                        onActivate={() => gridNav.activateCell(rowIdx, sArrGridCol)}
                                                                        onNudge={(delta) => southTrip && onTimeAdjust?.(southTrip.id, `${stop}__ARR`, delta)}
                                                                        onNavigateAway={handleNavAway}
                                                                        externalEdit={gridNav.isEditing && gridNav.isCellActive(rowIdx, sArrGridCol)}
                                                                        ariaLabel={getRoundTripGridCellLabel({
                                                                            routeName: combined.routeName,
                                                                            rowNumber: displayRowNum,
                                                                            blockId: row.blockId,
                                                                            direction: 'South',
                                                                            stopName: stop,
                                                                            cellType: 'arr',
                                                                            value: southArrivalAtStop,
                                                                            readOnly,
                                                                        })}
                                                                    />
                                                                    {southArrivalConnections.length > 0 && (
                                                                        <ConnectionIndicator connections={southArrivalConnections} />
                                                                    )}
                                                                    {showDeltas && (() => {
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
                                                            <td
                                                                className={`p-0 relative h-8 group/rec text-center font-mono text-xs text-gray-700 font-medium ${gridNav.isCellActive(rowIdx, sRecGridCol) ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                                                                title={rCellRef}
                                                                data-grid-row={rowIdx}
                                                                data-grid-col={sRecGridCol}
                                                                onClick={() => gridNav.activateCell(rowIdx, sRecGridCol)}
                                                                {...getEditableCellProps(sRecGridCol, 'South', stop, 'recovery', southArrivalAtStop ? String(getStopValue(southTrip?.recoveryTimes, stop) ?? '') : '')}
                                                            >
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && southTrip && southArrivalAtStop && (
                                                                        <button
                                                                            type="button"
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                onRecoveryEdit(southTrip.id, stop, -1);
                                                                            }}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{southArrivalAtStop ? (getStopValue(southTrip?.recoveryTimes, stop) ?? '') : ''}</span>
                                                                    {onRecoveryEdit && southTrip && southArrivalAtStop && (
                                                                        <button
                                                                            type="button"
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                onRecoveryEdit(southTrip.id, stop, 1);
                                                                            }}
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
                                                            const southArrivalTimeMinutes = southArrival ? TimeUtils.toMinutes(southArrival) : null;
                                                            const southDepValue = southArrival
                                                                ? (southRecovery === 0 ? southArrival : TimeUtils.addMinutes(southArrival, southRecovery))
                                                                : '';
                                                            const canAdjustSouthDep = !!southTrip && !!southDepValue;
                                                            const southDepTimeMinutes = southDepValue ? TimeUtils.toMinutes(southDepValue) : null;
                                                            const southStopCode = combined.southStopIds?.[stop] || '';
                                                            const southConnections = connectionLibrary && southStopCode && (southArrivalTimeMinutes !== null || southDepTimeMinutes !== null)
                                                                ? getConnectionsForStop(
                                                                    southStopCode,
                                                                    {
                                                                        arrival: southArrivalTimeMinutes,
                                                                        departure: southDepTimeMinutes
                                                                    },
                                                                    connectionLibrary,
                                                                    dayType
                                                                )
                                                                : [];
                                                            const departureConnections = hasRecovery
                                                                ? southConnections.filter(connection => connection.eventType === 'arrival')
                                                                : southConnections;

                                                            return (
                                                        <td
                                                            className={`p-0 relative ${departureConnections.length > 0 ? 'h-14' : 'h-10'} group/cell ${i === 0 ? 'border-l border-dashed border-gray-100' : ''} ${gridNav.isCellActive(rowIdx, sDepGridCol) ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                                                            title={depCellRef}
                                                            data-grid-row={rowIdx}
                                                            data-grid-col={sDepGridCol}
                                                            {...getEditableCellProps(sDepGridCol, 'South', stop, 'dep', southDepValue)}
                                                        >
                                                            <div className={`flex ${departureConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
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
                                                                    onChange={() => {}}
                                                                    onBlur={(val) => {
                                                                        if (southTrip && val && onCellEdit) {
                                                                            const originalValue = getStopValue(southTrip.arrivalTimes, stop) || getStopValue(southTrip.stops, stop);
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(southTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={readOnly || !southTrip}
                                                                    focusClass="focus:ring-indigo-100"
                                                                    isActive={gridNav.isCellActive(rowIdx, sDepGridCol)}
                                                                    onActivate={() => gridNav.activateCell(rowIdx, sDepGridCol)}
                                                                    onNudge={(delta) => southTrip && onTimeAdjust?.(southTrip.id, stop, delta)}
                                                                    onNavigateAway={handleNavAway}
                                                                    externalEdit={gridNav.isEditing && gridNav.isCellActive(rowIdx, sDepGridCol)}
                                                                    ariaLabel={getRoundTripGridCellLabel({
                                                                        routeName: combined.routeName,
                                                                        rowNumber: displayRowNum,
                                                                        blockId: row.blockId,
                                                                        direction: 'South',
                                                                        stopName: stop,
                                                                        cellType: 'dep',
                                                                        value: southDepValue,
                                                                        readOnly,
                                                                    })}
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
                                                                {departureConnections.length > 0 && (
                                                                    <ConnectionIndicator connections={departureConnections} />
                                                                )}
                                                                {(() => {
                                                                    const isLastSouthStop = i === southDisplayStops.length - 1;
                                                                    const currentDep = southTrip ? getDepartureDisplayTime(southTrip, stop, combined.routeName, isLastSouthStop) : '';
                                                                    const originalDep = getDepartureDisplayTime(originalSouthTrip, stop, combined.routeName, isLastSouthStop);
                                                                    const diff = showDeltas ? getDeltaMinutes(currentDep, originalDep) : null;
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

                                                        <td className={`p-1 text-center text-sm ${targetHeadway && typeof headway === 'number' && headway !== targetHeadway
                                                            ? 'text-amber-700 bg-amber-50 font-bold ring-1 ring-inset ring-amber-300'
                                                            : 'text-gray-700'
                                                            }`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            <div className="leading-tight">
                                                                <div>{headway}</div>
                                                                {targetHeadway && typeof headway === 'number' && headway !== targetHeadway && (
                                                                    <div className="text-[10px] font-semibold text-amber-600">({headway > targetHeadway ? '+' : ''}{headway - targetHeadway})</div>
                                                                )}
                                                            </div>
                                                        </td>

                                                        <td className={`p-1 text-center text-sm font-semibold ${targetCycleTime && Math.round(displayCycleTime) !== targetCycleTime
                                                            ? 'text-amber-700 bg-amber-50 font-bold ring-1 ring-inset ring-amber-300'
                                                            : 'text-gray-800'
                                                            }`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            <div className="leading-tight">
                                                                <div>{Math.round(displayCycleTime)}</div>
                                                                {targetCycleTime && Math.round(displayCycleTime) !== targetCycleTime && (
                                                                    <div className="text-[10px] font-semibold text-amber-600">({Math.round(displayCycleTime) > targetCycleTime ? '+' : ''}{Math.round(displayCycleTime) - targetCycleTime})</div>
                                                                )}
                                                            </div>
                                                        </td>

                                                        <td className="p-2 text-center text-sm font-mono text-gray-700" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{routeTripNumber}</td>
                                                    </>
                                                )}

                                            </tr>
                                        );
                                    });
                                    })()}
                                    {/* REMOVED trip ghost rows - master-only trips not matched to current schedule */}
                                    {isMasterMode && removedMasterTrips.length > 0 && removedMasterTrips.map(({ masterTrip, reason }) => {
                                        const totalColCount = columnMapping.length;
                                        return (
                                            <tr key={`removed-${masterTrip.id}`} className="bg-red-50/70 opacity-60" title={reason}>
                                                <td className="p-2 border-r border-gray-100 bg-red-50 font-medium text-xs text-center">
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span className="text-gray-400">{masterTrip.blockId || '—'}</span>
                                                        <span className="text-[9px] text-red-700 bg-red-100 px-1 rounded font-bold">REMOVED</span>
                                                    </div>
                                                </td>
                                                <td colSpan={totalColCount - 1} className="p-2 text-xs text-red-600 italic">
                                                    {TimeUtils.fromMinutes(masterTrip.startTime)} → {TimeUtils.fromMinutes(masterTrip.endTime)}
                                                    <span className="ml-2 text-red-400">({masterTrip.direction || 'Unknown'})</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}

        </div>
    );
};
