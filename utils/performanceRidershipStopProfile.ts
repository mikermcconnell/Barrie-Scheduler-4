import type {
    DailySummary,
    LoadProfileStop,
    RouteLoadProfile,
    RouteRidershipHeatmap,
} from './performanceDataTypes';
import { DEFAULT_LOAD_CAP } from './performanceDataTypes';
import { toMinutes } from './timeUtils';

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
    /** True when averageLoad includes legacy or block-inferred estimates. */
    loadEstimated: boolean;
    /** Describes whether the displayed load is APC-backed, inferred, or a mixture. */
    loadSource: RidershipStopProfileLoadSource;
    /** Number of trip-stop loads inferred by carrying passenger deltas through a block. */
    blockInferredLoadCount: number;
}

export type RidershipStopProfileLoadSource =
    | 'observed'
    | 'legacy'
    | 'block-inferred'
    | 'mixed'
    | 'none';

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
    hasBlockInferredLoad: boolean;
    /** True when inference for this option starts usable daily blocks at an assumed empty load. */
    blockInferenceAssumedEmptyAnchor: boolean;
    /** True when at least one block uses the smallest starting load needed to keep all loads nonnegative. */
    blockInferenceUsesMinimumFeasibleAnchor: boolean;
    /** Block chains excluded because their passenger deltas produced an invalid load. */
    invalidBlockInferenceChainCount: number;
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
    inferredLoads: Map<string, number[]>;
    assumedEmptyBlockCount: number;
    minimumFeasibleBlockCount: number;
    invalidBlockCount: number;
}

type LoadSource = 'observed' | 'legacy' | 'block-inferred';

interface LoadValue {
    value: number;
    /** Reliable APC observations or inferred trip-stop observations represented by this daily value. */
    observationCount?: number;
    source: LoadSource;
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
    loads: LoadValue[];
}

interface InferredOptionLoads {
    loads: Map<string, number[]>;
    assumedEmptyBlocks: Set<string>;
    minimumFeasibleBlocks: Set<string>;
    invalidBlocks: Set<string>;
}

interface InferenceStop {
    occurrenceKey: string;
    boardings: number;
    alightings: number;
}

interface InferenceTrip {
    optionKey: string;
    block: string;
    departureMinutes: number;
    sequence: number;
    stops: InferenceStop[];
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

function isUsableProfileLoad(load: LoadProfileStopWithCount): boolean {
    if (!Number.isFinite(load.avgLoad)) return false;
    if (load.loadObservationCount !== undefined) return load.loadObservationCount > 0;
    return load.avgLoad !== 0;
}

function inferLoadsByBlock(day: DailySummary): Map<string, InferredOptionLoads> {
    const tripsByRouteBlock = new Map<string, InferenceTrip[]>();
    const optionsWithUsableProfiles = new Set(
        (day.loadProfiles ?? [])
            .filter(profile => profile.stops.some(stop => isUsableProfileLoad(stop as LoadProfileStopWithCount)))
            .map(profile => optionKey(profile.routeId, profile.direction)),
    );
    let sequence = 0;

    for (const heatmap of day.ridershipHeatmaps ?? []) {
        const routeOptionKey = optionKey(heatmap.routeId, heatmap.direction);
        const orderedStopIndexes = heatmap.stops
            .map((stop, index) => ({ stop, index }))
            .sort((a, b) => a.stop.routeStopIndex - b.stop.routeStopIndex || a.index - b.index);
        const occurrenceCounts = new Map<string, number>();
        const occurrenceKeys = new Map<number, string>();
        for (const { stop, index } of orderedStopIndexes) {
            const derivedOccurrenceIndex = occurrenceCounts.get(stop.stopId) ?? 0;
            occurrenceCounts.set(stop.stopId, derivedOccurrenceIndex + 1);
            occurrenceKeys.set(
                index,
                profileStopOccurrenceKey(stop.stopId, stop.occurrenceIndex ?? derivedOccurrenceIndex),
            );
        }

        heatmap.trips.forEach((trip, tripIndex) => {
            const block = trip.block?.trim();
            const departureMinutes = toMinutes(trip.terminalDepartureTime);
            if (!block || departureMinutes === null) return;

            const stops: InferenceStop[] = [];
            for (const { index } of orderedStopIndexes) {
                const cell = heatmap.cells[index]?.[tripIndex];
                if (!cell) continue;
                stops.push({
                    occurrenceKey: occurrenceKeys.get(index)!,
                    boardings: cell[0],
                    alightings: cell[1],
                });
            }
            if (stops.length === 0) return;

            const candidate: InferenceTrip = {
                optionKey: routeOptionKey,
                block,
                departureMinutes,
                sequence: sequence++,
                stops,
            };
            const routeBlockKey = JSON.stringify([heatmap.routeId, block]);
            const existing = tripsByRouteBlock.get(routeBlockKey);
            if (existing) existing.push(candidate);
            else tripsByRouteBlock.set(routeBlockKey, [candidate]);
        });
    }

    const result = new Map<string, InferredOptionLoads>();
    const ensureOption = (key: string): InferredOptionLoads => {
        const existing = result.get(key);
        if (existing) return existing;
        const created: InferredOptionLoads = {
            loads: new Map(),
            assumedEmptyBlocks: new Set(),
            minimumFeasibleBlocks: new Set(),
            invalidBlocks: new Set(),
        };
        result.set(key, created);
        return created;
    };

    for (const blockTrips of tripsByRouteBlock.values()) {
        const block = blockTrips[0].block;
        const orderedTrips = [...blockTrips].sort((a, b) =>
            a.departureMinutes - b.departureMinutes || a.sequence - b.sequence
        );
        const touchedOptions = new Set(orderedTrips.map(trip => trip.optionKey));
        // Daily load profiles are route-direction-stop averages, not trip anchors.
        // If any direction participating in this route/block chain has usable load,
        // suppress the independently anchored trajectory for the entire chain.
        if ([...touchedOptions].some(key => optionsWithUsableProfiles.has(key))) continue;

        let cumulativeLoad = 0;
        let minimumCumulativeLoad = 0;
        let maximumCumulativeLoad = 0;
        let valid = true;
        const pending: Array<{ optionKey: string; occurrenceKey: string; cumulativeLoad: number }> = [];

        for (const trip of orderedTrips) {
            for (const stop of trip.stops) {
                if (!Number.isFinite(stop.boardings) || !Number.isFinite(stop.alightings)) {
                    valid = false;
                    break;
                }
                cumulativeLoad += stop.boardings - stop.alightings;
                if (!Number.isFinite(cumulativeLoad)) {
                    valid = false;
                    break;
                }
                minimumCumulativeLoad = Math.min(minimumCumulativeLoad, cumulativeLoad);
                maximumCumulativeLoad = Math.max(maximumCumulativeLoad, cumulativeLoad);
                pending.push({
                    optionKey: trip.optionKey,
                    occurrenceKey: stop.occurrenceKey,
                    cumulativeLoad,
                });
            }
            if (!valid) break;
        }

        const startingLoad = Math.max(0, -minimumCumulativeLoad);
        if (!Number.isFinite(startingLoad) || startingLoad + maximumCumulativeLoad > DEFAULT_LOAD_CAP) {
            valid = false;
        }
        if (!valid) {
            for (const key of touchedOptions) ensureOption(key).invalidBlocks.add(block);
            continue;
        }

        for (const key of touchedOptions) {
            if (startingLoad === 0) ensureOption(key).assumedEmptyBlocks.add(block);
            else ensureOption(key).minimumFeasibleBlocks.add(block);
        }
        for (const entry of pending) {
            const option = ensureOption(entry.optionKey);
            const existing = option.loads.get(entry.occurrenceKey);
            const inferredLoad = startingLoad + entry.cumulativeLoad;
            if (existing) existing.push(inferredLoad);
            else option.loads.set(entry.occurrenceKey, [inferredLoad]);
        }
    }

    return result;
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
    loadSource: RidershipStopProfileLoadSource;
    blockInferredLoadCount: number;
} {
    const ambiguousLegacyZero = loads.some(load =>
        load.source === 'legacy' && load.observationCount === undefined && load.value === 0
    );
    // Schema v10 used zero for both a genuine zero load and no reliable APC
    // sample. Exclude that ambiguous value rather than presenting missing data
    // as an observed zero. Schema v11 zeroes remain valid because they carry a
    // positive observation count.
    const usable = loads.filter(load =>
        Number.isFinite(load.value)
        && !(load.source === 'legacy' && load.observationCount === undefined && load.value === 0)
    );
    if (usable.length === 0) {
        return {
            averageLoad: null,
            loadObservationCount: null,
            loadEstimated: ambiguousLegacyZero,
            loadSource: 'none',
            blockInferredLoadCount: 0,
        };
    }

    const sources = new Set(usable.map(load => load.source));
    const blockInferredLoadCount = usable
        .filter(load => load.source === 'block-inferred')
        .reduce((sum, load) => sum + (load.observationCount ?? 0), 0);
    const legacyPresent = sources.has('legacy');
    if (legacyPresent) {
        // Legacy profiles do not retain observation counts. Preserve the historical
        // contract by giving each source/day average equal weight whenever legacy
        // data participates, rather than overweighting newer count-backed days.
        return {
            averageLoad: usable.reduce((sum, load) => sum + load.value, 0) / usable.length,
            loadObservationCount: null,
            loadEstimated: true,
            loadSource: sources.size === 1
                ? 'legacy'
                : 'mixed',
            blockInferredLoadCount,
        };
    }

    const count = usable.reduce((sum, load) => sum + (load.observationCount ?? 0), 0);
    if (count <= 0) {
        return {
            averageLoad: null,
            loadObservationCount: 0,
            loadEstimated: false,
            loadSource: 'none',
            blockInferredLoadCount: 0,
        };
    }

    return {
        averageLoad: usable.reduce(
            (sum, load) => sum + load.value * (load.observationCount ?? 0),
            0,
        ) / count,
        loadObservationCount: sources.size === 1 && sources.has('observed') ? count : null,
        loadEstimated: sources.has('block-inferred'),
        loadSource: sources.size === 1
            ? (sources.has('observed') ? 'observed' : 'block-inferred')
            : 'mixed',
        blockInferredLoadCount,
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
                    if (isUsableProfileLoad(loadStop)) {
                        accumulator.loads.push({
                            value: loadStop.avgLoad,
                            observationCount: loadStop.loadObservationCount,
                            source: loadStop.loadObservationCount === undefined ? 'legacy' : 'observed',
                        });
                    } else {
                        const inferred = day.inferredLoads.get(occurrenceKey) ?? [];
                        if (inferred.length > 0) {
                            accumulator.loads.push({
                                value: inferred.reduce((sum, value) => sum + value, 0) / inferred.length,
                                observationCount: inferred.length,
                                source: 'block-inferred',
                            });
                        }
                        // Retain the legacy-zero ambiguity marker when inference is unavailable.
                        if (inferred.length === 0 && loadStop.loadObservationCount === undefined) {
                            accumulator.loads.push({ value: loadStop.avgLoad, source: 'legacy' });
                        }
                    }
                } else {
                    const inferred = day.inferredLoads.get(occurrenceKey) ?? [];
                    if (inferred.length > 0) {
                        accumulator.loads.push({
                            value: inferred.reduce((sum, value) => sum + value, 0) / inferred.length,
                            observationCount: inferred.length,
                            source: 'block-inferred',
                        });
                    }
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
        hasBlockInferredLoad: rows.some(row => row.blockInferredLoadCount > 0),
        blockInferenceAssumedEmptyAnchor: routeDays.some(day => day.assumedEmptyBlockCount > 0),
        blockInferenceUsesMinimumFeasibleAnchor: routeDays.some(day => day.minimumFeasibleBlockCount > 0),
        invalidBlockInferenceChainCount: routeDays.reduce((sum, day) => sum + day.invalidBlockCount, 0),
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
        const inferredByOption = inferLoadsByBlock(day);
        for (const heatmap of day.ridershipHeatmaps ?? []) {
            const key = optionKey(heatmap.routeId, heatmap.direction);
            const serviceDayKey = `${day.date}\u001f${key}`;
            if (seenServiceDays.has(serviceDayKey)) continue;
            seenServiceDays.add(serviceDayKey);
            const loadProfile = chooseLoadProfile(day.loadProfiles ?? [], heatmap.routeId, heatmap.direction);
            // A daily load profile is already averaged by route-direction-stop, not
            // trip-occurrence APC. If any stop is usable, keep that profile intact
            // and do not fill its gaps from a separately anchored block trajectory.
            const inferenceEligible = !loadProfile
                || !loadProfile.stops.some(stop => isUsableProfileLoad(stop as LoadProfileStopWithCount));
            const inferred = inferredByOption.get(key);
            const entry: DailyRouteData = {
                date: day.date,
                heatmap,
                loadProfile,
                inferredLoads: inferenceEligible ? (inferred?.loads ?? new Map()) : new Map(),
                assumedEmptyBlockCount: inferenceEligible ? (inferred?.assumedEmptyBlocks.size ?? 0) : 0,
                minimumFeasibleBlockCount: inferenceEligible ? (inferred?.minimumFeasibleBlocks.size ?? 0) : 0,
                invalidBlockCount: inferenceEligible ? (inferred?.invalidBlocks.size ?? 0) : 0,
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
