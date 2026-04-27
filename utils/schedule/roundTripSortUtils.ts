import { getRouteConfig } from '../config/routeDirectionConfig';
import { RoundTripRow, RoundTripTable, MasterTrip } from '../parsers/masterScheduleParser';
import { TimeUtils } from '../timeUtils';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import { getScheduleDepartureDisplayTime } from './scheduleEditorUtils';

const serializeRecord = (record: Record<string, unknown> | undefined): string => {
    if (!record) return '';
    return Object.keys(record)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(key => `${key}:${String(record[key])}`)
        .join('|');
};

const getStopValue = <T,>(record: Record<string, T> | undefined, stopName: string): T | undefined => {
    if (!record) return undefined;
    if (record[stopName] !== undefined) return record[stopName];

    const baseName = stopName.replace(/\s*\(\d+\)$/, '');
    if (baseName !== stopName && record[baseName] !== undefined) return record[baseName];

    const lowerStop = stopName.toLowerCase();
    const lowerBase = baseName.toLowerCase();
    for (const key of Object.keys(record)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === lowerStop || lowerKey === lowerBase) return record[key];
    }

    return undefined;
};

const getStopMinutesValue = (
    record: Record<string, number> | undefined,
    stopName: string
): number | undefined => {
    if (!record) return undefined;
    if (record[stopName] !== undefined) return record[stopName];

    const baseName = stopName.replace(/\s*\(\d+\)$/, '');
    if (baseName !== stopName && record[baseName] !== undefined) return record[baseName];

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

const getDepartureDisplayTime = (trip: MasterTrip | undefined, stopName: string): string => {
    return getScheduleDepartureDisplayTime(trip, stopName);
};

const getFirstDepartureCellMinutes = (
    trip: MasterTrip | undefined,
    stops: string[]
): number | null => {
    if (!trip) return null;

    const firstStop = stops[0];
    if (!firstStop) return trip.startTime;

    const operationalStopMinutes = getStopMinutesValue(trip.stopMinutes, firstStop);
    if (operationalStopMinutes !== undefined) return operationalStopMinutes;

    const departure = getDepartureDisplayTime(trip, firstStop);
    if (!departure) return null;

    return TimeUtils.toMinutes(departure);
};

const getLastArrivalCellMinutes = (
    trip: MasterTrip | undefined,
    stops: string[]
): number | null => {
    if (!trip) return null;

    const lastStop = stops[stops.length - 1];
    if (!lastStop) return trip.endTime;

    const arrival = getArrivalDisplayTime(trip, lastStop);
    if (!arrival) return null;

    return TimeUtils.toMinutes(arrival);
};

const getLastDepartureCellMinutes = (
    trip: MasterTrip | undefined,
    stops: string[]
): number | null => {
    if (!trip) return null;

    const lastStop = stops[stops.length - 1];
    if (!lastStop) return trip.endTime;

    const departure = getDepartureDisplayTime(trip, lastStop);
    if (!departure) return null;

    return TimeUtils.toMinutes(departure);
};

export const getRoundTripDisplayedCycleTime = (row: RoundTripRow): number => row.totalCycleTime;

export const getRoundTripSortTimeForColumn = (
    row: RoundTripRow,
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>,
    sortColumn: string
): number | null => {
    const northTrip = row.trips.find(t => t.direction === 'North');
    const southTrip = row.trips.find(t => t.direction === 'South');

    const toOperationalSortTime = (value: number | null | undefined): number | null => (
        value === null || value === undefined ? null : getOperationalSortTime(value)
    );

    if (sortColumn === 'startTime') {
        return toOperationalSortTime(getRoundTripStartSortTime(row, combined));
    }

    if (sortColumn === 'endTime') {
        const lastTrip = [...row.trips].sort((tripA, tripB) => tripB.endTime - tripA.endTime)[0];
        return toOperationalSortTime(lastTrip?.endTime);
    }

    if (sortColumn.startsWith('north:')) {
        const stopName = sortColumn.replace('north:', '');
        const stopTime = getStopMinutesValue(northTrip?.stopMinutes, stopName)
            ?? TimeUtils.toMinutes(northTrip?.stops?.[stopName] || '');
        return toOperationalSortTime(stopTime);
    }

    if (sortColumn.startsWith('south:')) {
        const stopName = sortColumn.replace('south:', '');
        const stopTime = getStopMinutesValue(southTrip?.stopMinutes, stopName)
            ?? TimeUtils.toMinutes(southTrip?.stops?.[stopName] || '');
        return toOperationalSortTime(stopTime);
    }

    return null;
};

export const getRoundTripRowKey = (row: RoundTripRow): string => {
    const northTrip = row.trips.find(t => t.direction === 'North');
    const southTrip = row.trips.find(t => t.direction === 'South');
    return `${row.blockId}-${northTrip?.id || 'n'}-${southTrip?.id || 's'}`;
};

export const getRoundTripRowSignature = (row: RoundTripRow): string => {
    const serializedTrips = row.trips.map(trip => [
        trip.id,
        trip.blockId,
        trip.direction || '',
        trip.tripNumber ?? '',
        trip.startTime ?? '',
        trip.endTime ?? '',
        trip.travelTime ?? '',
        trip.recoveryTime ?? '',
        trip.cycleTime ?? '',
        serializeRecord(trip.stops),
        serializeRecord(trip.arrivalTimes),
        serializeRecord(trip.recoveryTimes),
        serializeRecord(trip.stopMinutes)
    ].join('~')).join('||');

    return [
        row.blockId,
        row.pairIndex ?? '',
        row.totalTravelTime,
        row.totalRecoveryTime,
        row.totalCycleTime,
        serializedTrips
    ].join('##');
};

/**
 * Return the row sort time for "Start Time".
 *
 * For routes where A/B suffixes represent direction (2, 7, 12), schedule pages
 * should sort by the left-side first departure in the round-trip table, with
 * opposite-side fallback when that first cell is blank.
 *
 * All other routes keep the existing north-first behavior.
 */
export const getRoundTripStartSortTime = (
    row: RoundTripRow,
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>
): number => {
    const northTrip = row.trips.find(t => t.direction === 'North');
    const southTrip = row.trips.find(t => t.direction === 'South');

    const northDeparture = getFirstDepartureCellMinutes(northTrip, combined.northStops);
    const southDeparture = getFirstDepartureCellMinutes(southTrip, combined.southStops);

    return northDeparture
        ?? southDeparture
        ?? northTrip?.startTime
        ?? southTrip?.startTime
        ?? 0;
};

/**
 * Block Flow fallback for routes where A/B suffixes represent direction.
 *
 * These routes should sort by the A-side end arrival first, with B-side first
 * departure as the fallback when the A-side terminal arrival cell is blank.
 * This only applies to the default Block Flow sort on the schedule page.
 *
 * Returns null for routes that should keep their existing Block Flow behavior.
 */
export const getRoundTripBlockFlowSortTime = (
    row: RoundTripRow,
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>
): number | null => {
    const baseRoute = combined.routeName.split(' ')[0];
    const config = getRouteConfig(baseRoute);
    const northTrip = row.trips.find(t => t.direction === 'North');
    const southTrip = row.trips.find(t => t.direction === 'South');

    if (!config?.suffixIsDirection) return null;

    return getLastArrivalCellMinutes(northTrip, combined.northStops)
        ?? getFirstDepartureCellMinutes(southTrip, combined.southStops)
        ?? northTrip?.endTime
        ?? southTrip?.startTime
        ?? 0;
};

export const compareRoundTripBlockFlowRows = (
    a: RoundTripRow,
    b: RoundTripRow,
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>,
    compareBlockIds: (a: string, b: string) => number
): number | null => {
    const baseRoute = combined.routeName.split(' ')[0];
    const config = getRouteConfig(baseRoute);

    if (new Set(['10', '11', '100', '101']).has(baseRoute)) {
        const aStart = getOperationalSortTime(getRoundTripStartSortTime(a, combined));
        const bStart = getOperationalSortTime(getRoundTripStartSortTime(b, combined));
        if (aStart !== bStart) return aStart - bStart;

        return compareBlockIds(a.blockId, b.blockId);
    }

    if (config?.segments.length === 1) {
        const blockDiff = compareBlockIds(a.blockId, b.blockId);
        if (blockDiff !== 0) return blockDiff;

        const aStart = getOperationalSortTime(getRoundTripStartSortTime(a, combined));
        const bStart = getOperationalSortTime(getRoundTripStartSortTime(b, combined));
        if (aStart !== bStart) return aStart - bStart;

        return 0;
    }

    const aTime = getRoundTripBlockFlowSortTime(a, combined);
    const bTime = getRoundTripBlockFlowSortTime(b, combined);

    if (aTime === null && bTime === null) return null;

    const timeDiff = getOperationalSortTime(aTime ?? 0) - getOperationalSortTime(bTime ?? 0);
    if (timeDiff !== 0) return timeDiff;

    return compareBlockIds(a.blockId, b.blockId);
};

/**
 * Headway anchor for the paired round-trip table.
 *
 * Uses the displayed row's last departure (right-most departure cell) so the
 * Hdwy column reflects the visible operating sequence. Falls back to trip end
 * times when the final departure cell is blank.
 */
export const getRoundTripLastDepartureTime = (
    row: RoundTripRow,
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>
): number | null => {
    const northTrip = row.trips.find(t => t.direction === 'North');
    const southTrip = row.trips.find(t => t.direction === 'South');

    return getLastDepartureCellMinutes(southTrip, combined.southStops)
        ?? southTrip?.endTime
        ?? getLastDepartureCellMinutes(northTrip, combined.northStops)
        ?? northTrip?.endTime
        ?? null;
};

type HeadwayAnchor = {
    key: string;
    minute: number;
    displayOrder: number;
};

const normalizeHeadwayStopKey = (stopName: string): string => (
    stopName
        .replace(/\s*\(\d+\)$/, '')
        .trim()
        .toLowerCase()
);

const getTripTimepointMinute = (
    trip: MasterTrip | undefined,
    stopName: string
): number | null => {
    if (!trip) return null;

    const stopMinute = getStopMinutesValue(trip.stopMinutes, stopName);
    if (stopMinute !== undefined) return stopMinute;

    const departure = getDepartureDisplayTime(trip, stopName);
    const departureMinute = departure ? TimeUtils.toMinutes(departure) : null;
    if (departureMinute !== null) return departureMinute;

    const arrival = getArrivalDisplayTime(trip, stopName);
    return arrival ? TimeUtils.toMinutes(arrival) : null;
};

const getRowHeadwayAnchors = (
    row: RoundTripRow,
    combined: Pick<RoundTripTable, 'northStops' | 'southStops'>
): HeadwayAnchor[] => {
    const anchors: HeadwayAnchor[] = [];
    const northTrip = row.trips.find(t => t.direction === 'North');
    const southTrip = row.trips.find(t => t.direction === 'South');
    const southOffset = combined.northStops.length;

    combined.northStops.forEach((stopName, index) => {
        const minute = getTripTimepointMinute(northTrip, stopName);
        if (minute === null) return;
        anchors.push({
            key: `North:${normalizeHeadwayStopKey(stopName)}`,
            minute,
            displayOrder: index,
        });
    });

    combined.southStops.forEach((stopName, index) => {
        const minute = getTripTimepointMinute(southTrip, stopName);
        if (minute === null) return;
        anchors.push({
            key: `South:${normalizeHeadwayStopKey(stopName)}`,
            minute,
            displayOrder: southOffset + index,
        });
    });

    return anchors;
};

const getSharedHeadwayMinutes = (
    previousRow: RoundTripRow,
    currentRow: RoundTripRow,
    combined: Pick<RoundTripTable, 'northStops' | 'southStops'>
): number | null => {
    const previousAnchors = new Map(getRowHeadwayAnchors(previousRow, combined).map(anchor => [anchor.key, anchor]));
    const sharedAnchors = getRowHeadwayAnchors(currentRow, combined)
        .map(current => {
            const previous = previousAnchors.get(current.key);
            return previous ? { current, previous } : null;
        })
        .filter((entry): entry is { current: HeadwayAnchor; previous: HeadwayAnchor } => !!entry)
        .sort((a, b) => (
            b.current.displayOrder - a.current.displayOrder
            || getOperationalSortTime(b.current.minute) - getOperationalSortTime(a.current.minute)
        ));

    const bestSharedAnchor = sharedAnchors[0];
    if (!bestSharedAnchor) return null;

    return getOperationalSortTime(bestSharedAnchor.current.minute) - getOperationalSortTime(bestSharedAnchor.previous.minute);
};

/**
 * Calculate displayed round-trip headways in the order rows are shown.
 *
 * This intentionally does not re-sort rows. The first displayed row should
 * have no headway, and subsequent rows compare the most downstream shared
 * timepoint with the nearest prior row that serves that same timepoint. This
 * keeps short-turn and unique trips from producing misleading negative or
 * inflated headways at stops they do not serve.
 */
export const getRoundTripDisplayedHeadways = (
    rows: RoundTripRow[],
    combined: Pick<RoundTripTable, 'routeName' | 'northStops' | 'southStops'>
): Record<string, number> => {
    const headways: Record<string, number> = {};

    rows.forEach((row, index) => {
        for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
            const headway = getSharedHeadwayMinutes(rows[previousIndex], row, combined);
            if (headway === null) continue;
            headways[getRoundTripRowKey(row)] = headway;
            break;
        }
    });

    return headways;
};
