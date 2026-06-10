import type { RoutePlanner2StopRole } from './routePlanner2Types';
import { snapRoutePlanner2WaypointsToRoad } from './routePlanner2RoadSnap';

export interface RoutePlanner2OptimizationStop {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    occurrenceCount: number;
    notes: string;
    sourceRows: number[];
    role?: RoutePlanner2StopRole;
}

export interface RoutePlanner2RoadTimeOptimizationOptions {
    token?: string | null;
    fetchImpl?: typeof fetch;
    concurrency?: number;
    exactStopLimit?: number;
    onProgress?: (progress: { completed: number; total: number }) => void;
}

export interface RoutePlanner2RoadTimeOptimizationResult<T extends RoutePlanner2OptimizationStop> {
    orderedStops: T[];
    totalDurationSeconds?: number;
    totalDistanceMeters?: number;
    method: 'exact-road-time' | 'road-time-heuristic' | 'approximate-distance';
    pairCount: number;
}

interface PairCost {
    fromIndex: number;
    toIndex: number;
    durationSeconds: number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_EXACT_STOP_LIMIT = 10;

function coordinate(stop: RoutePlanner2OptimizationStop): [number, number] {
    return [stop.lng, stop.lat];
}

function distanceMetersBetween(from: RoutePlanner2OptimizationStop, to: RoutePlanner2OptimizationStop): number {
    const radiusMeters = 6371000;
    const toRadians = (degrees: number) => degrees * Math.PI / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radiusMeters * Math.asin(Math.sqrt(a));
}

function assertMapboxDuration(
    result: Awaited<ReturnType<typeof snapRoutePlanner2WaypointsToRoad>>,
    from: RoutePlanner2OptimizationStop,
    to: RoutePlanner2OptimizationStop,
): number {
    if (result.source !== 'mapbox' || typeof result.durationSeconds !== 'number' || !Number.isFinite(result.durationSeconds)) {
        throw new Error(`Road-time optimization needs Mapbox travel time between "${from.name}" and "${to.name}". Check the Mapbox token and try again.`);
    }
    return result.durationSeconds;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    const safeConcurrency = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function runWorker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index]!);
        }
    }

    await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));
    return results;
}

async function buildRoadTimeMatrix<T extends RoutePlanner2OptimizationStop>(
    stops: T[],
    options: RoutePlanner2RoadTimeOptimizationOptions,
): Promise<number[][]> {
    const pairs: PairCost[] = [];
    for (let fromIndex = 0; fromIndex < stops.length; fromIndex += 1) {
        for (let toIndex = 0; toIndex < stops.length; toIndex += 1) {
            if (fromIndex !== toIndex) pairs.push({ fromIndex, toIndex, durationSeconds: 0 });
        }
    }

    let completed = 0;
    options.onProgress?.({ completed, total: pairs.length });

    const costs = await mapWithConcurrency(
        pairs,
        options.concurrency ?? DEFAULT_CONCURRENCY,
        async (pair) => {
            const from = stops[pair.fromIndex]!;
            const to = stops[pair.toIndex]!;
            const result = await snapRoutePlanner2WaypointsToRoad([coordinate(from), coordinate(to)], {
                token: options.token,
                fetchImpl: options.fetchImpl,
            });
            completed += 1;
            options.onProgress?.({ completed, total: pairs.length });
            return {
                ...pair,
                durationSeconds: assertMapboxDuration(result, from, to),
            };
        },
    );

    const matrix = Array.from({ length: stops.length }, () => Array(stops.length).fill(Number.POSITIVE_INFINITY));
    costs.forEach((cost) => {
        matrix[cost.fromIndex]![cost.toIndex] = cost.durationSeconds;
    });
    return matrix;
}

function optimizeExactOrder(matrix: number[][], intermediateCount: number): { order: number[]; totalDurationSeconds: number } {
    if (intermediateCount === 0) {
        return { order: [0, 1], totalDurationSeconds: matrix[0]![1]! };
    }

    const endIndex = intermediateCount + 1;
    const fullMask = (1 << intermediateCount) - 1;
    const dp = Array.from({ length: 1 << intermediateCount }, () => Array(intermediateCount).fill(Number.POSITIVE_INFINITY));
    const parent = Array.from({ length: 1 << intermediateCount }, () => Array<number | null>(intermediateCount).fill(null));

    for (let node = 0; node < intermediateCount; node += 1) {
        dp[1 << node]![node] = matrix[0]![node + 1]!;
    }

    for (let mask = 1; mask <= fullMask; mask += 1) {
        for (let last = 0; last < intermediateCount; last += 1) {
            if ((mask & (1 << last)) === 0) continue;
            const currentCost = dp[mask]![last]!;
            if (!Number.isFinite(currentCost)) continue;

            for (let next = 0; next < intermediateCount; next += 1) {
                if ((mask & (1 << next)) !== 0) continue;
                const nextMask = mask | (1 << next);
                const candidateCost = currentCost + matrix[last + 1]![next + 1]!;
                if (candidateCost < dp[nextMask]![next]!) {
                    dp[nextMask]![next] = candidateCost;
                    parent[nextMask]![next] = last;
                }
            }
        }
    }

    let bestLast = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let last = 0; last < intermediateCount; last += 1) {
        const candidateCost = dp[fullMask]![last]! + matrix[last + 1]![endIndex]!;
        if (candidateCost < bestCost) {
            bestCost = candidateCost;
            bestLast = last;
        }
    }

    const reversedIntermediateIndexes: number[] = [];
    let mask = fullMask;
    let last: number | null = bestLast;
    while (last !== null) {
        reversedIntermediateIndexes.push(last + 1);
        const previous = parent[mask]![last];
        mask &= ~(1 << last);
        last = previous;
    }

    return {
        order: [0, ...reversedIntermediateIndexes.reverse(), endIndex],
        totalDurationSeconds: bestCost,
    };
}

function routeCost(order: number[], matrix: number[][]): number {
    return order.slice(1).reduce((sum, toIndex, index) => sum + matrix[order[index]!]![toIndex]!, 0);
}

function optimizeHeuristicOrder(matrix: number[][], intermediateCount: number): { order: number[]; totalDurationSeconds: number } {
    const endIndex = intermediateCount + 1;
    const remaining = new Set(Array.from({ length: intermediateCount }, (_, index) => index + 1));
    const order = [0];

    while (remaining.size > 0) {
        const current = order[order.length - 1]!;
        let bestNext: number | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        remaining.forEach((candidate) => {
            const score = matrix[current]![candidate]! + matrix[candidate]![endIndex]!;
            if (score < bestScore) {
                bestScore = score;
                bestNext = candidate;
            }
        });
        order.push(bestNext!);
        remaining.delete(bestNext!);
    }
    order.push(endIndex);

    let improved = true;
    while (improved) {
        improved = false;
        for (let left = 1; left < order.length - 2; left += 1) {
            for (let right = left + 1; right < order.length - 1; right += 1) {
                const nextOrder = [
                    ...order.slice(0, left),
                    ...order.slice(left, right + 1).reverse(),
                    ...order.slice(right + 1),
                ];
                if (routeCost(nextOrder, matrix) < routeCost(order, matrix)) {
                    order.splice(0, order.length, ...nextOrder);
                    improved = true;
                }
            }
        }
    }

    return { order, totalDurationSeconds: routeCost(order, matrix) };
}

export async function optimizeRoutePlanner2StopsByRoadTime<T extends RoutePlanner2OptimizationStop>(
    startTerminal: T,
    intermediateStops: T[],
    endTerminal: T,
    options: RoutePlanner2RoadTimeOptimizationOptions = {},
): Promise<RoutePlanner2RoadTimeOptimizationResult<T>> {
    const stops = [
        { ...startTerminal, role: 'start-terminal' as const },
        ...intermediateStops.map((stop) => ({ ...stop, role: stop.role ?? 'regular' as const })),
        { ...endTerminal, role: 'end-terminal' as const },
    ] as T[];
    const matrix = await buildRoadTimeMatrix(stops, options);
    const intermediateCount = intermediateStops.length;
    const exactLimit = options.exactStopLimit ?? DEFAULT_EXACT_STOP_LIMIT;
    const optimized = intermediateCount <= exactLimit
        ? optimizeExactOrder(matrix, intermediateCount)
        : optimizeHeuristicOrder(matrix, intermediateCount);

    return {
        orderedStops: optimized.order.map((index) => stops[index]!),
        totalDurationSeconds: optimized.totalDurationSeconds,
        method: intermediateCount <= exactLimit ? 'exact-road-time' : 'road-time-heuristic',
        pairCount: stops.length * Math.max(0, stops.length - 1),
    };
}

export function optimizeRoutePlanner2StopsApproximately<T extends RoutePlanner2OptimizationStop>(
    startTerminal: T,
    intermediateStops: T[],
    endTerminal: T,
): RoutePlanner2RoadTimeOptimizationResult<T> {
    const stops = [
        { ...startTerminal, role: 'start-terminal' as const },
        ...intermediateStops.map((stop) => ({ ...stop, role: stop.role ?? 'regular' as const })),
        { ...endTerminal, role: 'end-terminal' as const },
    ] as T[];
    const remaining = new Set(Array.from({ length: intermediateStops.length }, (_, index) => index + 1));
    const endIndex = stops.length - 1;
    const order = [0];

    while (remaining.size > 0) {
        const current = order[order.length - 1]!;
        let bestNext: number | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        remaining.forEach((candidate) => {
            const score = distanceMetersBetween(stops[current]!, stops[candidate]!)
                + distanceMetersBetween(stops[candidate]!, stops[endIndex]!);
            if (score < bestScore) {
                bestScore = score;
                bestNext = candidate;
            }
        });
        order.push(bestNext!);
        remaining.delete(bestNext!);
    }
    order.push(endIndex);

    let totalDistanceMeters = 0;
    order.slice(1).forEach((toIndex, index) => {
        totalDistanceMeters += distanceMetersBetween(stops[order[index]!]!, stops[toIndex]!);
    });

    return {
        orderedStops: order.map((index) => stops[index]!),
        totalDistanceMeters,
        method: 'approximate-distance',
        pairCount: 0,
    };
}
