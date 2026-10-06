import type { DailySummary } from './performanceDataTypes';

/** Passengers onboard at which a bus is considered full. */
export const FULL_LOAD = 55;
/**
 * Loop routes: riders can stay on through the terminal, so a trip may start with
 * riders already aboard (inferred from alightings its own boardings can't explain).
 * Every other route (including direction pairs such as 2A/2B) starts each trip empty.
 */
export const LOOP_ROUTE_IDS: ReadonlySet<string> = new Set(['10', '11', '100', '101', '8A', '8B']);
/** Stops served by fewer usable trips than this show a gap instead of a value. */
export const MIN_LOAD_SAMPLES = 5;
/** Stops served by less than this share of the route's usable trips are treated as partial-pattern stops. */
export const PARTIAL_PATTERN_SHARE = 0.2;
/**
 * Trips whose total boardings and alightings differ by
 * more than this factor are excluded: the counts are too inconsistent to
 * reconstruct a load from.
 */
export const MAX_TRIP_IMBALANCE_RATIO = 1.5;
/** A vehicle whose median boardings/alightings ratio falls outside this band is flagged. */
export const VEHICLE_RATIO_BAND: readonly [number, number] = [0.85, 1.15];
/** Running-load shortfalls smaller than this are rounding noise, not a clamp. */
const CLAMP_TOLERANCE = 0.5;
const BUSIEST_TRIP_LIMIT = 10;

export const IMBALANCE_BUCKETS = [
    { label: 'Far more alightings', max: 1 / MAX_TRIP_IMBALANCE_RATIO },
    { label: '10–33% more alightings', max: 0.9 },
    { label: 'Within 10%', max: 1.1 },
    { label: '10–50% more boardings', max: MAX_TRIP_IMBALANCE_RATIO },
    { label: 'Far more boardings', max: Infinity },
] as const;

export function isLoopRoute(routeId: string): boolean {
    return LOOP_ROUTE_IDS.has(routeId.trim().toUpperCase());
}

export type LoadTimePeriod = 'all' | 'am' | 'midday' | 'pm' | 'evening';

/** Time-of-day windows by trip departure, in minutes after midnight (evening wraps past midnight). */
export const LOAD_TIME_PERIODS: ReadonlyArray<{ id: LoadTimePeriod; label: string; range: string; start: number; end: number }> = [
    { id: 'all', label: 'All day', range: '', start: 0, end: Infinity },
    { id: 'am', label: 'AM peak', range: '6–9', start: 6 * 60, end: 9 * 60 },
    { id: 'midday', label: 'Midday', range: '9–3', start: 9 * 60, end: 15 * 60 },
    { id: 'pm', label: 'PM peak', range: '3–6', start: 15 * 60, end: 18 * 60 },
    { id: 'evening', label: 'Evening', range: '6pm+', start: 18 * 60, end: 30 * 60 },
];

export function isInLoadTimePeriod(departure: string, period: LoadTimePeriod): boolean {
    if (period === 'all') return true;
    const window = LOAD_TIME_PERIODS.find(p => p.id === period)!;
    let minutes = timeToMinutes(departure);
    // Early-morning trips before 6:00 belong with the previous evening.
    if (period === 'evening' && minutes < 6 * 60) minutes += 24 * 60;
    return minutes >= window.start && minutes < window.end;
}

export interface RouteLoadStop {
    key: string;
    stopNumber: number;
    stopName: string;
    stopId: string;
    routeStopIndex: number;
    occurrenceIndex: number;
    isTimepoint: boolean;
    /** Average boardings per trip at this stop (all trips with counts that served it). */
    avgBoardings: number;
    /** Average alightings per trip at this stop (all trips with counts that served it). */
    avgAlightings: number;
    /** Average inferred onboard load leaving this stop; null when no usable trip served it. */
    avgLoad: number | null;
    /** Highest inferred onboard load leaving this stop on any single trip. */
    maxLoad: number | null;
    /** 10th and 90th percentile of trip loads leaving this stop: the spread of typical trips without outliers. */
    p10Load: number | null;
    p90Load: number | null;
    /** Usable trips that served this stop. */
    loadSamples: number;
    lowSample: boolean;
    partialPattern: boolean;
}

export interface BusyTrip {
    departure: string;
    block: string;
    /** Days this scheduled trip had a usable inferred load. */
    days: number;
    avgPeakLoad: number;
    maxPeakLoad: number;
    /** Stop where this trip most often peaked. */
    peakStopName: string;
    /** Days this trip reached FULL_LOAD. */
    fullDays: number;
    /** Average load leaving each stop on this scheduled trip, keyed by stop key. */
    stopLoads: Record<string, number>;
    /** Average boardings and alightings at each stop on this scheduled trip, keyed by stop key. */
    stopBoardings: Record<string, number>;
    stopAlightings: Record<string, number>;
}

export interface ApcComparison {
    stopsCompared: number;
    /** Mean of (inferred − APC) average load across compared stops. */
    meanDifference: number;
    meanAbsoluteDifference: number;
}

export interface RouteLoadDiagnostics {
    /** Trips with no boardings or alightings at all. */
    noCountTrips: number;
    imbalanceBuckets: Array<{ label: string; trips: number }>;
    medianRatio: number | null;
    /** Average boardings on trips kept for inference. */
    keptAvgBoardings: number | null;
    /** Average boardings on trips left out for unbalanced counts. */
    skippedAvgBoardings: number | null;
    /** Share of kept trips where the running load had to be floored at zero. */
    clampedTripShare: number | null;
    /** Average riders carried in from the previous trip (loop routes only; null otherwise). */
    avgCarriedInLoad: number | null;
    apcComparison: ApcComparison | null;
}

export interface RouteLoadView {
    key: string;
    routeId: string;
    routeName: string;
    direction: string;
    /** True for loop routes, where riders are carried across consecutive trips on a block. */
    carriesLoad: boolean;
    /** Trips with any passenger counts. */
    tripCount: number;
    /** Trips whose counts were consistent enough to infer a load. */
    usableTripCount: number;
    serviceDays: number;
    stops: RouteLoadStop[];
    /** Stop with the highest average load, excluding low-sample and partial-pattern stops. */
    peakStop: RouteLoadStop | null;
    /** Highest inferred load on any single trip at any stop. */
    maxTripLoad: number | null;
    /** Usable trips that reached FULL_LOAD at any stop. */
    fullTripCount: number;
    /** Share of trips with counts that were usable for inference; null without trips. */
    usableShare: number | null;
    busiestTrips: BusyTrip[];
    diagnostics: RouteLoadDiagnostics;
}

export interface VehicleCountDiagnostic {
    vehicleId: string;
    trips: number;
    medianRatio: number | null;
    skippedShare: number;
    flagged: boolean;
}

export interface RouteLoadAnalysis {
    views: RouteLoadView[];
    vehicles: VehicleCountDiagnostic[];
}

export interface TripMovementAnalysis {
    /** Inferred load leaving each stop; null when the trip is unusable. */
    loads: number[] | null;
    /** Total boardings / total alightings; null when either total is zero. */
    ratio: number | null;
    /** Stops where the running load had to be floored at zero. */
    clampedStops: number;
}

interface LoadRun {
    loads: number[] | null;
    ratio: number | null;
    clamped: boolean[];
    carriedIn: number;
}

/**
 * Reconstructs onboard load leaving each stop of one trip. Alightings are
 * scaled so the trip balances (everyone who boards gets off), and the running
 * load never drops below zero. When `inferCarry` is set (loop routes), riders
 * already aboard at the start are inferred from the alightings that boardings
 * alone cannot explain. The trip is unusable when its counts are empty or too
 * unbalanced to trust.
 */
function runLoads(movements: Array<[number, number]>, inferCarry = false): LoadRun {
    const totalBoardings = movements.reduce((sum, [b]) => sum + b, 0);
    const totalAlightings = movements.reduce((sum, [, a]) => sum + a, 0);
    if (totalBoardings <= 0 || totalAlightings <= 0) return { loads: null, ratio: null, clamped: [], carriedIn: 0 };

    let carriedIn = 0;
    if (inferCarry) {
        let running = 0;
        for (const [boardings, alightings] of movements) {
            running += boardings - alightings;
            carriedIn = Math.max(carriedIn, -running);
        }
        carriedIn = Math.min(carriedIn, FULL_LOAD);
    }
    const ratio = (totalBoardings + carriedIn) / totalAlightings;
    if (ratio > MAX_TRIP_IMBALANCE_RATIO || ratio < 1 / MAX_TRIP_IMBALANCE_RATIO) {
        return { loads: null, ratio, clamped: [], carriedIn };
    }

    let load = carriedIn;
    const clamped: boolean[] = [];
    const loads = movements.map(([boardings, alightings]) => {
        const next = load + boardings - alightings * ratio;
        clamped.push(next < -CLAMP_TOLERANCE);
        load = Math.max(0, next);
        return load;
    });
    return { loads, ratio, clamped, carriedIn };
}

/** Infers the load of a single trip that starts empty. */
export function analyzeTripMovements(movements: Array<[number, number]>): TripMovementAnalysis {
    const run = runLoads(movements);
    return { loads: run.loads, ratio: run.ratio, clampedStops: run.clamped.filter(Boolean).length };
}

export function inferTripLoads(movements: Array<[number, number]>): number[] | null {
    return analyzeTripMovements(movements).loads;
}

interface StopAccumulator {
    stopName: string;
    stopId: string;
    routeStopIndex: number;
    occurrenceIndex: number;
    isTimepoint: boolean;
    boardings: number;
    alightings: number;
    countTrips: number;
    loadSum: number;
    loadTrips: number;
    maxLoad: number;
    loads: number[];
    apcLoadWeighted: number;
    apcSamples: number;
}

interface TripRecord {
    routeId: string;
    date: string;
    departure: string;
    block: string;
    vehicleId: string | null;
    served: Array<{ stopKey: string; movement: [number, number] }>;
    firstStopId: string;
    firstStopName: string;
    lastStopId: string;
    lastStopName: string;
    boardings: number;
    hasCounts: boolean;
    /** Riders onboard when the trip started (carried from the previous loop trip). */
    carriedInLoad: number;
    analysis: TripMovementAnalysis;
}

interface RouteAccumulator {
    routeId: string;
    routeName: string;
    direction: string;
    days: Set<string>;
    stops: Map<string, StopAccumulator>;
    trips: TripRecord[];
}

function stopKeyFor(stop: { stopId: string; routeStopIndex: number; stopName: string; occurrenceIndex?: number }): string {
    const occurrenceIndex = stop.occurrenceIndex ?? 0;
    return stop.stopId
        ? `${stop.stopId}__${occurrenceIndex}`
        : `${stop.routeStopIndex}__${occurrenceIndex}__${stop.stopName}`;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
}

function share(part: number, whole: number): number | null {
    return whole > 0 ? part / whole : null;
}

function quantile(sorted: number[], q: number): number | null {
    if (sorted.length === 0) return null;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function analyzeTrip(trip: TripRecord): void {
    const run = runLoads(trip.served.map(s => s.movement), isLoopRoute(trip.routeId));
    trip.carriedInLoad = run.loads ? run.carriedIn : 0;
    trip.analysis = { loads: run.loads, ratio: run.ratio, clampedStops: run.clamped.filter(Boolean).length };
}

function buildBusiestTrips(trips: TripRecord[], stopNames: Map<string, string>): BusyTrip[] {
    const byDeparture = new Map<string, Array<{ trip: TripRecord; peak: number; peakStopKey: string }>>();
    for (const trip of trips) {
        const loads = trip.analysis.loads;
        if (!loads) continue;
        let peakIndex = 0;
        loads.forEach((load, index) => { if (load > loads[peakIndex]) peakIndex = index; });
        const entry = { trip, peak: loads[peakIndex], peakStopKey: trip.served[peakIndex].stopKey };
        const list = byDeparture.get(trip.departure);
        if (list) list.push(entry);
        else byDeparture.set(trip.departure, [entry]);
    }
    return Array.from(byDeparture.entries())
        .map(([departure, entries]): BusyTrip => {
            const peakStopCounts = new Map<string, number>();
            for (const entry of entries) peakStopCounts.set(entry.peakStopKey, (peakStopCounts.get(entry.peakStopKey) ?? 0) + 1);
            const commonPeakStop = [...peakStopCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            const latest = [...entries].sort((a, b) => b.trip.date.localeCompare(a.trip.date))[0];
            const stopSums = new Map<string, { load: number; boardings: number; alightings: number; count: number }>();
            for (const { trip } of entries) {
                trip.served.forEach(({ stopKey, movement: [boardings, alightings] }, index) => {
                    const acc = stopSums.get(stopKey) ?? { load: 0, boardings: 0, alightings: 0, count: 0 };
                    acc.load += trip.analysis.loads![index];
                    acc.boardings += boardings;
                    acc.alightings += alightings;
                    acc.count++;
                    stopSums.set(stopKey, acc);
                });
            }
            const averageBy = (pick: (acc: { load: number; boardings: number; alightings: number; count: number }) => number) =>
                Object.fromEntries([...stopSums.entries()].map(([key, acc]) => [key, pick(acc) / acc.count]));
            return {
                departure,
                block: latest.trip.block,
                days: entries.length,
                avgPeakLoad: entries.reduce((sum, e) => sum + e.peak, 0) / entries.length,
                maxPeakLoad: Math.max(...entries.map(e => e.peak)),
                peakStopName: stopNames.get(commonPeakStop) ?? '',
                fullDays: entries.filter(e => e.peak >= FULL_LOAD).length,
                stopLoads: averageBy(acc => acc.load),
                stopBoardings: averageBy(acc => acc.boardings),
                stopAlightings: averageBy(acc => acc.alightings),
            };
        })
        .sort((a, b) => b.avgPeakLoad - a.avgPeakLoad || timeToMinutes(a.departure) - timeToMinutes(b.departure))
        .slice(0, BUSIEST_TRIP_LIMIT);
}

function buildDiagnostics(
    route: RouteAccumulator,
    periodTrips: TripRecord[],
    countedTrips: TripRecord[],
    inferredStops: RouteLoadStop[],
    carriesLoad: boolean,
): RouteLoadDiagnostics {
    const ratios = countedTrips.map(t => t.analysis.ratio).filter((r): r is number => r !== null);
    const kept = countedTrips.filter(t => t.analysis.loads);
    const skipped = countedTrips.filter(t => !t.analysis.loads);

    const apcPairs = inferredStops
        .filter(stop => stop.avgLoad !== null && !stop.lowSample && !stop.partialPattern)
        .map(stop => {
            const acc = route.stops.get(stop.key)!;
            return acc.apcSamples >= MIN_LOAD_SAMPLES ? stop.avgLoad! - acc.apcLoadWeighted / acc.apcSamples : null;
        })
        .filter((d): d is number => d !== null);

    return {
        noCountTrips: periodTrips.length - countedTrips.length,
        imbalanceBuckets: IMBALANCE_BUCKETS.map((bucket, index) => {
            const min = index === 0 ? -Infinity : IMBALANCE_BUCKETS[index - 1].max;
            return { label: bucket.label, trips: ratios.filter(r => r >= min && r < bucket.max).length };
        }),
        medianRatio: median(ratios),
        keptAvgBoardings: mean(kept.map(t => t.boardings)),
        skippedAvgBoardings: mean(skipped.map(t => t.boardings)),
        clampedTripShare: share(kept.filter(t => t.analysis.clampedStops > 0).length, kept.length),
        avgCarriedInLoad: carriesLoad ? mean(kept.map(t => t.carriedInLoad)) : null,
        apcComparison: apcPairs.length > 0
            ? {
                stopsCompared: apcPairs.length,
                meanDifference: mean(apcPairs)!,
                meanAbsoluteDifference: mean(apcPairs.map(Math.abs))!,
            }
            : null,
    };
}

function buildVehicleDiagnostics(trips: TripRecord[]): VehicleCountDiagnostic[] {
    const byVehicle = new Map<string, TripRecord[]>();
    for (const trip of trips) {
        if (!trip.hasCounts || !trip.vehicleId) continue;
        const list = byVehicle.get(trip.vehicleId);
        if (list) list.push(trip);
        else byVehicle.set(trip.vehicleId, [trip]);
    }
    return Array.from(byVehicle.entries())
        .map(([vehicleId, vehicleTrips]): VehicleCountDiagnostic => {
            const medianRatio = median(vehicleTrips.map(t => t.analysis.ratio).filter((r): r is number => r !== null));
            const skippedShare = vehicleTrips.filter(t => !t.analysis.loads).length / vehicleTrips.length;
            const outOfBand = medianRatio === null || medianRatio < VEHICLE_RATIO_BAND[0] || medianRatio > VEHICLE_RATIO_BAND[1];
            return {
                vehicleId,
                trips: vehicleTrips.length,
                medianRatio,
                skippedShare,
                flagged: vehicleTrips.length >= MIN_LOAD_SAMPLES && (outOfBand || skippedShare > 0.5),
            };
        })
        .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.skippedShare - a.skippedShare || b.trips - a.trips);
}

/**
 * Builds per-trip load views per route and direction from the daily
 * stop-by-trip boarding/alighting grids, plus diagnostics on how trustworthy
 * the inference is. Load is inferred, never read from APC departure loads;
 * APC loads appear only as a diagnostic comparison. Loads are always inferred
 * over the whole day (so loop carry-over is right); the period only selects
 * which trips are summarised.
 */
export function buildRouteLoadAnalysis(days: DailySummary[], period: LoadTimePeriod = 'all'): RouteLoadAnalysis {
    const routes = new Map<string, RouteAccumulator>();
    const allTrips: TripRecord[] = [];

    for (const day of days) {
        const dayTrips: TripRecord[] = [];
        for (const heatmap of day.ridershipHeatmaps ?? []) {
            const routeKey = `${heatmap.routeId}__${heatmap.direction}`;
            let route = routes.get(routeKey);
            if (!route) {
                route = {
                    routeId: heatmap.routeId,
                    routeName: heatmap.routeName,
                    direction: heatmap.direction,
                    days: new Set(),
                    stops: new Map(),
                    trips: [],
                };
                routes.set(routeKey, route);
            }
            route.days.add(day.date);

            const stopKeys = heatmap.stops.map(stop => {
                const key = stopKeyFor(stop);
                const existing = route!.stops.get(key);
                if (!existing) {
                    route!.stops.set(key, {
                        stopName: stop.stopName,
                        stopId: stop.stopId,
                        routeStopIndex: stop.routeStopIndex,
                        occurrenceIndex: stop.occurrenceIndex ?? 0,
                        isTimepoint: stop.isTimepoint,
                        boardings: 0,
                        alightings: 0,
                        countTrips: 0,
                        loadSum: 0,
                        loadTrips: 0,
                        maxLoad: 0,
                        loads: [],
                        apcLoadWeighted: 0,
                        apcSamples: 0,
                    });
                } else {
                    existing.isTimepoint = existing.isTimepoint || stop.isTimepoint;
                    existing.routeStopIndex = Math.min(existing.routeStopIndex, stop.routeStopIndex);
                }
                return key;
            });

            heatmap.trips.forEach((trip, tripIndex) => {
                const served: TripRecord['served'] = [];
                const servedStops: Array<{ stopId: string; stopName: string }> = [];
                heatmap.cells.forEach((row, stopIndex) => {
                    const cell = row[tripIndex];
                    if (!cell) return;
                    served.push({ stopKey: stopKeys[stopIndex], movement: cell });
                    servedStops.push(heatmap.stops[stopIndex]);
                });
                if (served.length === 0) return;
                const first = servedStops[0];
                const last = servedStops[servedStops.length - 1];
                const record: TripRecord = {
                    routeId: heatmap.routeId,
                    date: day.date,
                    departure: trip.terminalDepartureTime,
                    block: trip.block,
                    vehicleId: trip.vehicleId ?? null,
                    served,
                    firstStopId: first.stopId,
                    firstStopName: first.stopName,
                    lastStopId: last.stopId,
                    lastStopName: last.stopName,
                    boardings: served.reduce((sum, s) => sum + s.movement[0], 0),
                    hasCounts: served.some(({ movement: [b, a] }) => b > 0 || a > 0),
                    carriedInLoad: 0,
                    analysis: { loads: null, ratio: null, clampedStops: 0 },
                };
                route!.trips.push(record);
                dayTrips.push(record);
            });
        }
        dayTrips.filter(trip => trip.hasCounts).forEach(analyzeTrip);
        allTrips.push(...dayTrips);

        // APC departure loads are kept only to compare against the inference.
        for (const profile of day.loadProfiles ?? []) {
            const route = routes.get(`${profile.routeId}__${profile.direction}`);
            if (!route) continue;
            for (const stop of profile.stops) {
                const acc = route.stops.get(stopKeyFor(stop));
                const samples = stop.loadObservationCount;
                if (!acc || typeof samples !== 'number' || !(samples > 0)) continue;
                acc.apcLoadWeighted += stop.avgLoad * samples;
                acc.apcSamples += samples;
            }
        }
    }

    const views = Array.from(routes.entries())
        .map(([key, route]) => ({ key, route, periodTrips: route.trips.filter(t => isInLoadTimePeriod(t.departure, period)) }))
        .filter(({ periodTrips }) => periodTrips.length > 0)
        .map(({ key, route, periodTrips }): RouteLoadView => {
            const carriesLoad = isLoopRoute(route.routeId);
            const countedTrips = periodTrips.filter(t => t.hasCounts);
            const usedTrips = countedTrips.filter(t => t.analysis.loads);

            for (const trip of countedTrips) {
                trip.served.forEach(({ stopKey, movement: [boardings, alightings] }, index) => {
                    const acc = route.stops.get(stopKey)!;
                    acc.boardings += boardings;
                    acc.alightings += alightings;
                    acc.countTrips++;
                    const load = trip.analysis.loads?.[index];
                    if (load === undefined) return;
                    acc.loadSum += load;
                    acc.loadTrips++;
                    acc.maxLoad = Math.max(acc.maxLoad, load);
                    acc.loads.push(load);
                });
            }

            const ordered = Array.from(route.stops.entries())
                .filter(([, s]) => s.countTrips > 0)
                .sort(([, a], [, b]) => a.routeStopIndex - b.routeStopIndex
                    || a.occurrenceIndex - b.occurrenceIndex
                    || a.stopName.localeCompare(b.stopName));
            const stops = ordered.map(([stopKey, s], index): RouteLoadStop => {
                const hasLoad = s.loadTrips > 0;
                const sortedLoads = [...s.loads].sort((a, b) => a - b);
                return {
                    key: stopKey,
                    stopNumber: index + 1,
                    stopName: s.stopName,
                    stopId: s.stopId,
                    routeStopIndex: s.routeStopIndex,
                    occurrenceIndex: s.occurrenceIndex,
                    isTimepoint: s.isTimepoint,
                    avgBoardings: s.countTrips > 0 ? s.boardings / s.countTrips : 0,
                    avgAlightings: s.countTrips > 0 ? s.alightings / s.countTrips : 0,
                    avgLoad: hasLoad ? s.loadSum / s.loadTrips : null,
                    maxLoad: hasLoad ? s.maxLoad : null,
                    p10Load: quantile(sortedLoads, 0.1),
                    p90Load: quantile(sortedLoads, 0.9),
                    loadSamples: s.loadTrips,
                    lowSample: s.loadTrips < MIN_LOAD_SAMPLES,
                    partialPattern: usedTrips.length > 0 && s.loadTrips < usedTrips.length * PARTIAL_PATTERN_SHARE,
                };
            });

            const peakStop = stops
                .filter(s => s.avgLoad !== null && !s.lowSample && !s.partialPattern)
                .reduce<RouteLoadStop | null>((best, s) => (!best || (s.avgLoad ?? 0) > (best.avgLoad ?? 0) ? s : best), null);
            const tripMaxima = stops.map(s => s.maxLoad).filter((v): v is number => v !== null);
            const stopNames = new Map(ordered.map(([stopKey, s]) => [stopKey, s.stopName]));

            return {
                key,
                routeId: route.routeId,
                routeName: route.routeName,
                direction: route.direction,
                carriesLoad,
                tripCount: countedTrips.length,
                usableTripCount: usedTrips.length,
                serviceDays: route.days.size,
                stops,
                peakStop,
                maxTripLoad: tripMaxima.length > 0 ? Math.max(...tripMaxima) : null,
                fullTripCount: usedTrips.filter(t => t.analysis.loads!.some(load => load >= FULL_LOAD)).length,
                usableShare: share(usedTrips.length, countedTrips.length),
                busiestTrips: buildBusiestTrips(usedTrips, stopNames),
                diagnostics: buildDiagnostics(route, periodTrips, countedTrips, stops, carriesLoad),
            };
        })
        .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true, sensitivity: 'base' })
            || a.direction.localeCompare(b.direction));

    return { views, vehicles: buildVehicleDiagnostics(allTrips) };
}

export function buildRouteLoadViews(days: DailySummary[], period: LoadTimePeriod = 'all'): RouteLoadView[] {
    return buildRouteLoadAnalysis(days, period).views;
}
