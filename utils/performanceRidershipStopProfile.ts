import type {
    DailySummary,
    LoadProfileStop,
    RouteLoadProfile,
    RouteRidershipHeatmap,
} from './performanceDataTypes';

type LoadProfileStopWithCount = LoadProfileStop & {
    loadObservationCount?: number;
};

export interface RidershipStopProfileRow {
    stopId: string;
    stopName: string;
    /** Zero-based visit number when a physical stop appears more than once in a trip. */
    occurrenceIndex?: number;
    /** Typical route position: the median index observed across service days. */
    routeStopIndex: number;
    isTimepoint: boolean;
    /** Exact total for one day; average per route-direction service day for multiple days. */
    boardings: number;
    /** Exact total for one day; average per route-direction service day for multiple days. */
    alightings: number;
    /** Distinct route-direction service days on which this stop appeared. */
    servedDays: number;
    /** Average reliable departure load, or null when no load observation is available. */
    averageLoad: number | null;
    /** Exact reliable-load observation count; null for legacy estimated weighting. */
    loadObservationCount: number | null;
    /** True when averageLoad uses the legacy average-of-daily-averages fallback. */
    loadEstimated: boolean;
}

export interface RidershipStopProfileHighlight {
    stopId: string;
    stopName: string;
    value: number;
}

export interface RidershipStopProfileLoadHighlight extends RidershipStopProfileHighlight {
    loadObservationCount: number | null;
    estimated: boolean;
}

export interface RidershipStopProfileOption {
    key: string;
    routeId: string;
    routeName: string;
    direction: string;
    /** Distinct dates containing a heatmap for this route and direction. */
    serviceDays: number;
    /** Raw activity across the selected period, used to choose the busiest default option. */
    totalBoardings: number;
    totalAlightings: number;
    multipleStopPatterns: boolean;
    rows: RidershipStopProfileRow[];
    busiestBoardingStop: RidershipStopProfileHighlight | null;
    busiestAlightingStop: RidershipStopProfileHighlight | null;
    peakAverageLoad: RidershipStopProfileLoadHighlight | null;
    hasEstimatedLoad: boolean;
}

export interface RidershipStopProfileResult {
    /** Ordered busiest first, with deterministic route and direction tie-breaks. */
    options: RidershipStopProfileOption[];
    defaultOptionKey: string | null;
}

interface DailyRouteData {
    date: string;
    heatmap: RouteRidershipHeatmap;
    loadProfile?: RouteLoadProfile;
}

interface StopAccumulator {
    stopId: string;
    occurrenceIndex: number;
    names: string[];
    routeStopIndexes: number[];
    isTimepoint: boolean;
    totalBoardings: number;
    totalAlightings: number;
    servedDates: Set<string>;
    loads: Array<{ value: number; observationCount?: number }>;
}

function optionKey(routeId: string, direction: string): string {
    return `${routeId}__${direction}`;
}

function loadStopOccurrenceKey(stopId: string, routeStopIndex: number): string {
    return JSON.stringify([stopId, routeStopIndex]);
}

function profileStopOccurrenceKey(stopId: string, occurrenceOrdinal: number): string {
    return JSON.stringify([stopId, occurrenceOrdinal]);
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function deterministicMode(values: string[]): string {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

function patternSignature(heatmap: RouteRidershipHeatmap): string {
    return [...heatmap.stops]
        .sort((a, b) => a.routeStopIndex - b.routeStopIndex || a.stopId.localeCompare(b.stopId))
        .map(stop => stop.stopId)
        .join('\u001f');
}

function sumStopCellActivity(heatmap: RouteRidershipHeatmap, stopIndex: number): [number, number] {
    let boardings = 0;
    let alightings = 0;
    for (const cell of heatmap.cells[stopIndex] ?? []) {
        if (!cell) continue;
        boardings += cell[0];
        alightings += cell[1];
    }
    return [boardings, alightings];
}

function chooseLoadProfile(
    profiles: RouteLoadProfile[],
    routeId: string,
    direction: string,
): RouteLoadProfile | undefined {
    return profiles.find(profile => profile.routeId === routeId && profile.direction === direction);
}

function calculateLoad(loads: StopAccumulator['loads']): {
    averageLoad: number | null;
    loadObservationCount: number | null;
    loadEstimated: boolean;
} {
    const ambiguousLegacyZero = loads.some(load =>
        load.observationCount === undefined && load.value === 0
    );
    // Schema v10 used zero for both a genuine zero load and no reliable APC
    // sample. Exclude that ambiguous value rather than presenting missing data
    // as an observed zero. Schema v11 zeroes remain valid because they carry a
    // positive observation count.
    const usable = loads.filter(load =>
        Number.isFinite(load.value)
        && !(load.observationCount === undefined && load.value === 0)
    );
    if (usable.length === 0) {
        return {
            averageLoad: null,
            loadObservationCount: null,
            loadEstimated: ambiguousLegacyZero,
        };
    }

    const legacyPresent = usable.some(load => load.observationCount === undefined);
    if (legacyPresent) {
        return {
            averageLoad: usable.reduce((sum, load) => sum + load.value, 0) / usable.length,
            loadObservationCount: null,
            loadEstimated: true,
        };
    }

    const observed = usable.filter(load => (load.observationCount ?? 0) > 0);
    const count = observed.reduce((sum, load) => sum + (load.observationCount ?? 0), 0);
    if (count === 0) {
        return { averageLoad: null, loadObservationCount: 0, loadEstimated: false };
    }

    return {
        averageLoad: observed.reduce(
            (sum, load) => sum + load.value * (load.observationCount ?? 0),
            0,
        ) / count,
        loadObservationCount: count,
        loadEstimated: false,
    };
}

function highestRow(
    rows: RidershipStopProfileRow[],
    value: (row: RidershipStopProfileRow) => number,
): RidershipStopProfileRow | null {
    return [...rows].sort((a, b) =>
        value(b) - value(a)
        || a.routeStopIndex - b.routeStopIndex
        || a.stopId.localeCompare(b.stopId)
    )[0] ?? null;
}

function buildOption(routeDays: DailyRouteData[]): RidershipStopProfileOption {
    const first = routeDays[0].heatmap;
    const serviceDates = new Set(routeDays.map(day => day.date));
    const serviceDays = serviceDates.size;
    const patterns = new Set(routeDays.map(day => patternSignature(day.heatmap)));
    const stops = new Map<string, StopAccumulator>();

    for (const day of routeDays) {
        const dailyStopOccurrences = new Set<string>();
        const occurrenceLoadStops = new Map(
            (day.loadProfile?.stops ?? [])
                .filter(stop => stop.occurrenceIndex !== undefined)
                .map(stop => [
                    profileStopOccurrenceKey(stop.stopId, stop.occurrenceIndex!),
                    stop as LoadProfileStopWithCount,
                ]),
        );
        const legacyLoadStops = new Map(
            (day.loadProfile?.stops ?? [])
                .filter(stop => stop.occurrenceIndex === undefined)
                .map(stop => [
                loadStopOccurrenceKey(stop.stopId, stop.routeStopIndex),
                stop as LoadProfileStopWithCount,
                ]),
        );
        const occurrenceCounts = new Map<string, number>();

        for (let stopIndex = 0; stopIndex < day.heatmap.stops.length; stopIndex++) {
            const stop = day.heatmap.stops[stopIndex];
            // Match the same physical occurrence across days by its ordinal visit,
            // not its sequence index, because route patterns can insert or remove
            // other stops. Repeated visits to one stop within a loop remain distinct.
            const derivedOccurrenceIndex = occurrenceCounts.get(stop.stopId) ?? 0;
            occurrenceCounts.set(stop.stopId, derivedOccurrenceIndex + 1);
            const occurrenceIndex = stop.occurrenceIndex ?? derivedOccurrenceIndex;
            const occurrenceKey = profileStopOccurrenceKey(stop.stopId, occurrenceIndex);
            const loadOccurrenceKey = loadStopOccurrenceKey(stop.stopId, stop.routeStopIndex);
            const [boardings, alightings] = sumStopCellActivity(day.heatmap, stopIndex);
            let accumulator = stops.get(occurrenceKey);
            if (!accumulator) {
                accumulator = {
                    stopId: stop.stopId,
                    occurrenceIndex,
                    names: [],
                    routeStopIndexes: [],
                    isTimepoint: false,
                    totalBoardings: 0,
                    totalAlightings: 0,
                    servedDates: new Set(),
                    loads: [],
                };
                stops.set(occurrenceKey, accumulator);
            }

            accumulator.names.push(stop.stopName);
            accumulator.routeStopIndexes.push(stop.routeStopIndex);
            accumulator.isTimepoint ||= stop.isTimepoint;
            accumulator.totalBoardings += boardings;
            accumulator.totalAlightings += alightings;
            accumulator.servedDates.add(day.date);

            // A duplicated stop ID within one daily pattern should not duplicate its load observation.
            if (!dailyStopOccurrences.has(occurrenceKey)) {
                const loadStop = occurrenceLoadStops.get(occurrenceKey)
                    ?? legacyLoadStops.get(loadOccurrenceKey);
                if (loadStop) {
                    accumulator.loads.push({
                        value: loadStop.avgLoad,
                        observationCount: loadStop.loadObservationCount,
                    });
                }
                dailyStopOccurrences.add(occurrenceKey);
            }
        }
    }

    const divisor = serviceDays > 1 ? serviceDays : 1;
    const rows = [...stops.values()].map((stop): RidershipStopProfileRow => {
        const load = calculateLoad(stop.loads);
        return {
            stopId: stop.stopId,
            stopName: deterministicMode(stop.names),
            occurrenceIndex: stop.occurrenceIndex,
            routeStopIndex: median(stop.routeStopIndexes),
            isTimepoint: stop.isTimepoint,
            boardings: stop.totalBoardings / divisor,
            alightings: stop.totalAlightings / divisor,
            servedDays: stop.servedDates.size,
            ...load,
        };
    }).sort((a, b) =>
        a.routeStopIndex - b.routeStopIndex
        || a.stopId.localeCompare(b.stopId)
        || a.stopName.localeCompare(b.stopName)
    );

    const busiestBoarding = highestRow(rows, row => row.boardings);
    const busiestAlighting = highestRow(rows, row => row.alightings);
    const loadRows = rows.filter(row => row.averageLoad !== null);
    const peakLoad = highestRow(loadRows, row => row.averageLoad ?? Number.NEGATIVE_INFINITY);

    return {
        key: optionKey(first.routeId, first.direction),
        routeId: first.routeId,
        routeName: deterministicMode(routeDays.map(day => day.heatmap.routeName)),
        direction: first.direction,
        serviceDays,
        totalBoardings: [...stops.values()].reduce((sum, stop) => sum + stop.totalBoardings, 0),
        totalAlightings: [...stops.values()].reduce((sum, stop) => sum + stop.totalAlightings, 0),
        multipleStopPatterns: patterns.size > 1
            || routeDays.some(day => day.heatmap.multipleStopPatterns === true),
        rows,
        busiestBoardingStop: busiestBoarding ? {
            stopId: busiestBoarding.stopId,
            stopName: busiestBoarding.stopName,
            value: busiestBoarding.boardings,
        } : null,
        busiestAlightingStop: busiestAlighting ? {
            stopId: busiestAlighting.stopId,
            stopName: busiestAlighting.stopName,
            value: busiestAlighting.alightings,
        } : null,
        peakAverageLoad: peakLoad ? {
            stopId: peakLoad.stopId,
            stopName: peakLoad.stopName,
            value: peakLoad.averageLoad!,
            loadObservationCount: peakLoad.loadObservationCount,
            estimated: peakLoad.loadEstimated,
        } : null,
        hasEstimatedLoad: rows.some(row => row.loadEstimated),
    };
}

/**
 * Builds chart-ready passenger flow profiles from already-filtered daily summaries.
 * Heatmaps are authoritative for boarding/alighting totals; load profiles only provide load.
 */
export function buildRidershipStopProfiles(days: DailySummary[]): RidershipStopProfileResult {
    const grouped = new Map<string, DailyRouteData[]>();
    const seenServiceDays = new Set<string>();

    for (const day of days) {
        for (const heatmap of day.ridershipHeatmaps ?? []) {
            const key = optionKey(heatmap.routeId, heatmap.direction);
            const serviceDayKey = `${day.date}\u001f${key}`;
            if (seenServiceDays.has(serviceDayKey)) continue;
            seenServiceDays.add(serviceDayKey);
            const entry: DailyRouteData = {
                date: day.date,
                heatmap,
                loadProfile: chooseLoadProfile(day.loadProfiles ?? [], heatmap.routeId, heatmap.direction),
            };
            const existing = grouped.get(key);
            if (existing) existing.push(entry);
            else grouped.set(key, [entry]);
        }
    }

    const options = [...grouped.values()].map(buildOption).sort((a, b) =>
        b.totalBoardings - a.totalBoardings
        || a.routeId.localeCompare(b.routeId, undefined, { numeric: true })
        || a.direction.localeCompare(b.direction)
    );

    return {
        options,
        defaultOptionKey: options[0]?.key ?? null,
    };
}
