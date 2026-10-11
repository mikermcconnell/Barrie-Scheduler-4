import type { DailySummary } from './performanceDataTypes';

/** Passengers onboard at which a bus is considered full. */
export const FULL_LOAD = 55;
/** Stops served by fewer usable trips than this show a gap instead of a value. */
export const MIN_LOAD_SAMPLES = 5;
/** Stops served by less than this share of the route's usable trips are treated as partial-pattern stops. */
export const PARTIAL_PATTERN_SHARE = 0.2;
/**
 * Trips whose total boardings and alightings differ by more than this factor are
 * excluded: the counts are too inconsistent to reconstruct a load from.
 */
export const MAX_TRIP_IMBALANCE_RATIO = 1.5;
/** Inference is withheld when more than this share of a route's trips loop or continue as another route. */
export const ROUTE_CLASSIFICATION_SHARE = 0.5;
/** A vehicle whose median boardings/alightings ratio falls outside this band is flagged. */
export const VEHICLE_RATIO_BAND: readonly [number, number] = [0.85, 1.15];
/** Running-load shortfalls smaller than this are rounding noise, not a clamp. */
const CLAMP_TOLERANCE = 0.5;
const LOOP_DIRECTION = /^(cw|ccw|loop)$/i;
const BUSIEST_TRIP_LIMIT = 10;

export const IMBALANCE_BUCKETS = [
    { label: 'Far more alightings', max: 1 / MAX_TRIP_IMBALANCE_RATIO },
    { label: '10–33% more alightings', max: 0.9 },
    { label: 'Within 10%', max: 1.1 },
    { label: '10–50% more boardings', max: MAX_TRIP_IMBALANCE_RATIO },
    { label: 'Far more boardings', max: Infinity },
] as const;

export type LoadInferenceBlock = 'loop' | 'interlined';

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
    /** Share of loop-shaped trips (first stop is also the last). */
    loopTripShare: number | null;
    /** Share of trips that continue on the same block as a different route from the same stop. */
    interlinedTripShare: number | null;
    apcComparison: ApcComparison | null;
}

export interface RouteLoadView {
    key: string;
    routeId: string;
    routeName: string;
    direction: string;
    /** Trips with any passenger counts. */
    tripCount: number;
    /** Trips whose counts were consistent enough to infer a load. */
    usableTripCount: number;
    serviceDays: number;
    /** Why load is not inferred for this route; null when it is. */
    inferenceBlocked: LoadInferenceBlock | null;
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

/**
 * Reconstructs onboard load leaving each stop of one trip from its boardings and
 * alightings. Alightings are scaled so the trip balances (everyone who boards
 * gets off), and the running load never drops below zero. The trip is unusable
 * when its counts are empty or too unbalanced to trust.
 */
export function analyzeTripMovements(movements: Array<[number, number]>): TripMovementAnalysis {
    const totalBoardings = movements.reduce((sum, [b]) => sum + b, 0);
    const totalAlightings = movements.reduce((sum, [, a]) => sum + a, 0);
    if (totalBoardings <= 0 || totalAlightings <= 0) return { loads: null, ratio: null, clampedStops: 0 };
    const ratio = totalBoardings / totalAlightings;
    if (ratio > MAX_TRIP_IMBALANCE_RATIO || ratio < 1 / MAX_TRIP_IMBALANCE_RATIO) {
        return { loads: null, ratio, clampedStops: 0 };
    }

    let load = 0;
    let clampedStops = 0;
    const loads = movements.map(([boardings, alightings]) => {
        const next = load + boardings - alightings * ratio;
        if (next < -CLAMP_TOLERANCE) clampedStops++;
        load = Math.max(0, next);
        return load;
    });
    return { loads, ratio, clampedStops };
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
    apcLoadWeighted: number;
    apcSamples: number;
}

interface TripRecord {
    routeKey: string;
    routeId: string;
    date: string;
    departure: string;
    block: string;
    vehicleId: string | null;
    served: Array<{ stopKey: string; movement: [number, number] }>;
    firstStopId: string;
    lastStopId: string;
    boardings: number;
    hasCounts: boolean;
    continuesAsOtherRoute: boolean;
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

/** Flags trips that continue on their block as a different route from the stop where they ended. */
function markInterlinedTrips(trips: TripRecord[]): void {
    const byBlock = new Map<string, TripRecord[]>();
    for (const trip of trips) {
        if (!trip.block) continue;
        const key = `${trip.date}__${trip.block}`;
        const list = byBlock.get(key);
        if (list) list.push(trip);
        else byBlock.set(key, [trip]);
    }
    for (const blockTrips of byBlock.values()) {
        blockTrips.sort((a, b) => timeToMinutes(a.departure) - timeToMinutes(b.departure));
        for (let i = 0; i < blockTrips.length - 1; i++) {
            const current = blockTrips[i];
            const next = blockTrips[i + 1];
            if (next.routeId !== current.routeId && next.firstStopId === current.lastStopId) {
                current.continuesAsOtherRoute = true;
            }
        }
    }
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
            return {
                departure,
                block: latest.trip.block,
                days: entries.length,
                avgPeakLoad: entries.reduce((sum, e) => sum + e.peak, 0) / entries.length,
                maxPeakLoad: Math.max(...entries.map(e => e.peak)),
                peakStopName: stopNames.get(commonPeakStop) ?? '',
                fullDays: entries.filter(e => e.peak >= FULL_LOAD).length,
            };
        })
        .sort((a, b) => b.avgPeakLoad - a.avgPeakLoad || timeToMinutes(a.departure) - timeToMinutes(b.departure))
        .slice(0, BUSIEST_TRIP_LIMIT);
}

function buildDiagnostics(route: RouteAccumulator, countedTrips: TripRecord[], inferredStops: RouteLoadStop[]): RouteLoadDiagnostics {
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
        noCountTrips: route.trips.length - countedTrips.length,
        imbalanceBuckets: IMBALANCE_BUCKETS.map((bucket, index) => {
            const min = index === 0 ? -Infinity : IMBALANCE_BUCKETS[index - 1].max;
            return { label: bucket.label, trips: ratios.filter(r => r >= min && r < bucket.max).length };
        }),
        medianRatio: median(ratios),
        keptAvgBoardings: mean(kept.map(t => t.boardings)),
        skippedAvgBoardings: mean(skipped.map(t => t.boardings)),
        clampedTripShare: share(kept.filter(t => t.analysis.clampedStops > 0).length, kept.length),
        loopTripShare: share(countedTrips.filter(t => t.firstStopId === t.lastStopId).length, countedTrips.length),
        interlinedTripShare: share(countedTrips.filter(t => t.continuesAsOtherRoute).length, countedTrips.length),
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
 * APC loads appear only as a diagnostic comparison.
 */
export function buildRouteLoadAnalysis(days: DailySummary[]): RouteLoadAnalysis {
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
                const servedStopIds: string[] = [];
                heatmap.cells.forEach((row, stopIndex) => {
                    const cell = row[tripIndex];
                    if (!cell) return;
                    served.push({ stopKey: stopKeys[stopIndex], movement: cell });
                    servedStopIds.push(heatmap.stops[stopIndex].stopId);
                });
                if (served.length === 0) return;
                const record: TripRecord = {
                    routeKey,
                    routeId: heatmap.routeId,
                    date: day.date,
                    departure: trip.terminalDepartureTime,
                    block: trip.block,
                    vehicleId: trip.vehicleId ?? null,
                    served,
                    firstStopId: servedStopIds[0],
                    lastStopId: servedStopIds[servedStopIds.length - 1],
                    boardings: served.reduce((sum, s) => sum + s.movement[0], 0),
                    hasCounts: served.some(({ movement: [b, a] }) => b > 0 || a > 0),
                    continuesAsOtherRoute: false,
                    analysis: analyzeTripMovements(served.map(s => s.movement)),
                };
                route!.trips.push(record);
                dayTrips.push(record);
            });
        }
        markInterlinedTrips(dayTrips);
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
        .map(([key, route]): RouteLoadView => {
            const countedTrips = route.trips.filter(t => t.hasCounts);
            const loopShare = share(countedTrips.filter(t => t.firstStopId === t.lastStopId).length, countedTrips.length) ?? 0;
            const interlinedShare = share(countedTrips.filter(t => t.continuesAsOtherRoute).length, countedTrips.length) ?? 0;
            const inferenceBlocked: LoadInferenceBlock | null = LOOP_DIRECTION.test(route.direction) || loopShare > ROUTE_CLASSIFICATION_SHARE
                ? 'loop'
                : interlinedShare > ROUTE_CLASSIFICATION_SHARE ? 'interlined' : null;
            const usedTrips = inferenceBlocked ? [] : countedTrips.filter(t => t.analysis.loads);

            for (const trip of countedTrips) {
                trip.served.forEach(({ stopKey, movement: [boardings, alightings] }, index) => {
                    const acc = route.stops.get(stopKey)!;
                    acc.boardings += boardings;
                    acc.alightings += alightings;
                    acc.countTrips++;
                    const load = inferenceBlocked ? undefined : trip.analysis.loads?.[index];
                    if (load === undefined) return;
                    acc.loadSum += load;
                    acc.loadTrips++;
                    acc.maxLoad = Math.max(acc.maxLoad, load);
                });
            }

            const ordered = Array.from(route.stops.entries())
                .sort(([, a], [, b]) => a.routeStopIndex - b.routeStopIndex
                    || a.occurrenceIndex - b.occurrenceIndex
                    || a.stopName.localeCompare(b.stopName));
            const stops = ordered.map(([stopKey, s], index): RouteLoadStop => {
                const hasLoad = s.loadTrips > 0;
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
                tripCount: countedTrips.length,
                usableTripCount: usedTrips.length,
                serviceDays: route.days.size,
                inferenceBlocked,
                stops,
                peakStop,
                maxTripLoad: tripMaxima.length > 0 ? Math.max(...tripMaxima) : null,
                fullTripCount: usedTrips.filter(t => t.analysis.loads!.some(load => load >= FULL_LOAD)).length,
                usableShare: inferenceBlocked ? null : share(usedTrips.length, countedTrips.length),
                busiestTrips: buildBusiestTrips(usedTrips, stopNames),
                diagnostics: buildDiagnostics(route, countedTrips, stops),
            };
        })
        .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true, sensitivity: 'base' })
            || a.direction.localeCompare(b.direction));

    return { views, vehicles: buildVehicleDiagnostics(allTrips) };
}

export function buildRouteLoadViews(days: DailySummary[]): RouteLoadView[] {
    return buildRouteLoadAnalysis(days).views;
}
