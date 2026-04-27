import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { extractDirectionFromName } from '../config/routeDirectionConfig';

type DirectionKey = 'North' | 'South';
export type MasterComparisonMatchMethod = 'lineage' | 'trip-id' | 'time-shift';
export type MasterComparisonConfidence = 'high' | 'medium' | 'low';

export interface AmbiguousMasterComparisonCandidate {
    masterTrip: MasterTrip;
    diffMinutes: number;
}

export interface MatchedMasterComparisonEntry {
    status: 'matched';
    direction: DirectionKey;
    routeName: string;
    currentTripId: string;
    masterTrip: MasterTrip;
    matchMethod: MasterComparisonMatchMethod;
    confidence: MasterComparisonConfidence;
    reason: string;
    shiftMinutes?: number;
}

export interface NewMasterComparisonEntry {
    status: 'new';
    direction: DirectionKey;
    routeName: string;
    currentTripId: string;
    confidence: 'low';
    reason: string;
}

export interface AmbiguousMasterComparisonEntry {
    status: 'ambiguous';
    direction: DirectionKey;
    routeName: string;
    currentTripId: string;
    confidence: 'low';
    reason: string;
    shiftMinutes?: number;
    candidates: AmbiguousMasterComparisonCandidate[];
}

export interface RemovedMasterComparisonEntry {
    status: 'removed';
    direction: DirectionKey;
    routeName: string;
    masterTrip: MasterTrip;
    confidence: 'low';
    reason: string;
}

export type CurrentTripComparisonEntry =
    | MatchedMasterComparisonEntry
    | NewMasterComparisonEntry
    | AmbiguousMasterComparisonEntry;

export interface DetailedMasterComparisonResult {
    currentTripComparisons: Map<string, CurrentTripComparisonEntry>;
    removedMasterTrips: RemovedMasterComparisonEntry[];
    masterShiftByDir: Partial<Record<DirectionKey, number>>;
}

export interface MasterComparisonResult {
    masterMatchMap: Map<string, MasterTrip>;
    unmatchedMasterTrips: MasterTrip[];
    masterShiftByDir: Partial<Record<DirectionKey, number>>;
}

export type TripChangeKind =
    | 'new'
    | 'extended'
    | 'shortened'
    | 'retimed'
    | 'review'
    | 'removed'
    | 'unchanged';

export interface MasterComparisonChangeCounts {
    new: number;
    extended: number;
    shortened: number;
    retimed: number;
    review: number;
    removed: number;
    unchanged: number;
    totalChanges: number;
}

export interface MasterComparisonChangeSummary {
    counts: MasterComparisonChangeCounts;
    currentTripKinds: Map<string, TripChangeKind>;
    removedMasterTrips: RemovedMasterComparisonEntry[];
}

const DIRECTIONS: DirectionKey[] = ['North', 'South'];

export const buildTripKey = (direction: DirectionKey, tripId: string): string => `${direction}::${tripId}`;
const buildMatchedMasterKey = (direction: DirectionKey, trip: MasterTrip): string => (
    `${direction}::${trip.lineageId || trip.id}::${trip.startTime}::${trip.rowId}`
);

const toDirection = (routeName: string): DirectionKey =>
    (extractDirectionFromName(routeName) || 'North') as DirectionKey;

const emptyChangeCounts = (): MasterComparisonChangeCounts => ({
    new: 0,
    extended: 0,
    shortened: 0,
    retimed: 0,
    review: 0,
    removed: 0,
    unchanged: 0,
    totalChanges: 0,
});

const getTimedStopCount = (trip: MasterTrip): number => {
    const stopKeys = new Set<string>();

    Object.entries(trip.stops || {}).forEach(([key, value]) => {
        if (value) stopKeys.add(key);
    });
    Object.entries(trip.arrivalTimes || {}).forEach(([key, value]) => {
        if (value) stopKeys.add(key);
    });

    return stopKeys.size;
};

const recordsDiffer = (
    a?: Record<string, string | number>,
    b?: Record<string, string | number>
): boolean => {
    const keys = new Set([
        ...Object.keys(a || {}),
        ...Object.keys(b || {}),
    ]);

    for (const key of keys) {
        const left = a?.[key];
        const right = b?.[key];
        if ((left ?? '') !== (right ?? '')) {
            return true;
        }
    }

    return false;
};

export const classifyMatchedTripChange = (currentTrip: MasterTrip, masterTrip: MasterTrip): TripChangeKind => {
    const extendsEarlier = currentTrip.startTime < masterTrip.startTime;
    const extendsLater = currentTrip.endTime > masterTrip.endTime;
    const startsLater = currentTrip.startTime > masterTrip.startTime;
    const endsEarlier = currentTrip.endTime < masterTrip.endTime;

    const startStopExtended = (
        currentTrip.startStopIndex !== undefined
        && masterTrip.startStopIndex !== undefined
        && currentTrip.startStopIndex < masterTrip.startStopIndex
    );
    const startStopReduced = (
        currentTrip.startStopIndex !== undefined
        && masterTrip.startStopIndex !== undefined
        && currentTrip.startStopIndex > masterTrip.startStopIndex
    );
    const endStopExtended = (
        currentTrip.endStopIndex !== undefined
        && masterTrip.endStopIndex !== undefined
        && currentTrip.endStopIndex > masterTrip.endStopIndex
    );
    const endStopReduced = (
        currentTrip.endStopIndex !== undefined
        && masterTrip.endStopIndex !== undefined
        && currentTrip.endStopIndex < masterTrip.endStopIndex
    );

    const currentTimedStopCount = getTimedStopCount(currentTrip);
    const masterTimedStopCount = getTimedStopCount(masterTrip);
    const hasMoreTimedStops = currentTimedStopCount > masterTimedStopCount;
    const hasFewerTimedStops = currentTimedStopCount < masterTimedStopCount;

    const isExtended = extendsEarlier || extendsLater || startStopExtended || endStopExtended || hasMoreTimedStops;
    const isShortened = startsLater || endsEarlier || startStopReduced || endStopReduced || hasFewerTimedStops;
    const hasTimingDelta = (
        currentTrip.startTime !== masterTrip.startTime
        || currentTrip.endTime !== masterTrip.endTime
        || currentTrip.travelTime !== masterTrip.travelTime
        || currentTrip.recoveryTime !== masterTrip.recoveryTime
        || recordsDiffer(currentTrip.stops, masterTrip.stops)
        || recordsDiffer(currentTrip.arrivalTimes, masterTrip.arrivalTimes)
        || recordsDiffer(currentTrip.recoveryTimes, masterTrip.recoveryTimes)
    );

    if (isExtended && !isShortened) return 'extended';
    if (isShortened && !isExtended) return 'shortened';
    if (hasTimingDelta) return 'retimed';
    return 'unchanged';
};

export const buildMasterComparisonChangeSummary = (
    schedules: MasterRouteTable[],
    detailed: DetailedMasterComparisonResult,
    options?: { routeNames?: string[] }
): MasterComparisonChangeSummary => {
    const counts = emptyChangeCounts();
    const routeNameFilter = options?.routeNames ? new Set(options.routeNames) : null;
    const routeDirectionFilter = options?.routeNames
        ? new Set(options.routeNames.map(routeName => extractDirectionFromName(routeName)).filter(Boolean) as DirectionKey[])
        : null;
    const routeFilterAllowsDirectionless = options?.routeNames
        ? options.routeNames.some(routeName => !extractDirectionFromName(routeName))
        : false;
    const currentTripLookup = new Map<string, MasterTrip>();
    const currentTripKinds = new Map<string, TripChangeKind>();
    const routeNameIsInScope = (routeName: string, direction: DirectionKey): boolean => {
        if (!routeNameFilter) return true;
        if (routeNameFilter.has(routeName)) return true;
        if (routeFilterAllowsDirectionless) return true;
        return routeDirectionFilter?.has(direction) ?? false;
    };

    schedules.forEach(table => {
        const dir = toDirection(table.routeName);
        table.trips.forEach(trip => {
            currentTripLookup.set(buildTripKey(dir, trip.id), trip);
        });
    });

    detailed.currentTripComparisons.forEach((entry, key) => {
        if (!routeNameIsInScope(entry.routeName, entry.direction)) {
            return;
        }

        let kind: TripChangeKind = 'unchanged';
        if (entry.status === 'new') {
            kind = 'new';
        } else if (entry.status === 'ambiguous') {
            kind = 'review';
        } else {
            const currentTrip = currentTripLookup.get(key);
            kind = currentTrip
                ? classifyMatchedTripChange(currentTrip, entry.masterTrip)
                : 'retimed';
        }

        currentTripKinds.set(key, kind);
        counts[kind] += 1;
    });

    const removedMasterTrips = detailed.removedMasterTrips.filter(entry => (
        routeNameIsInScope(entry.routeName, entry.direction)
    ));
    counts.removed = removedMasterTrips.length;
    counts.totalChanges = counts.new + counts.extended + counts.shortened + counts.retimed + counts.review + counts.removed;

    return {
        counts,
        currentTripKinds,
        removedMasterTrips,
    };
};

export const buildDetailedMasterComparison = (
    schedules: MasterRouteTable[],
    masterBaseline: MasterRouteTable[] | null | undefined
): DetailedMasterComparisonResult => {
    if (!masterBaseline || masterBaseline.length === 0) {
        return {
            currentTripComparisons: new Map<string, CurrentTripComparisonEntry>(),
            removedMasterTrips: [],
            masterShiftByDir: {}
        };
    }

    const THRESHOLD = 5;
    const SHIFT_SEARCH_RANGE = 15;

    const currentTripComparisons = new Map<string, CurrentTripComparisonEntry>();
    const matchedMasterKeys = new Set<string>();
    const ambiguityProtectedMasterKeys = new Set<string>();
    const shiftByDir: Partial<Record<DirectionKey, number>> = {};

    const masterByDir: Record<DirectionKey, MasterTrip[]> = { North: [], South: [] };
    const currentRouteNamesByTripKey = new Map<string, string>();
    masterBaseline.forEach(table => {
        const dir = toDirection(table.routeName);
        table.trips.forEach(trip => {
            masterByDir[dir].push(trip);
        });
    });

    const currentByDir: Record<DirectionKey, MasterTrip[]> = { North: [], South: [] };
    schedules.forEach(table => {
        const dir = toDirection(table.routeName);
        table.trips.forEach(trip => {
            currentByDir[dir].push(trip);
            currentRouteNamesByTripKey.set(buildTripKey(dir, trip.id), table.routeName);
        });
    });

    const setMatched = (
        direction: DirectionKey,
        currentTrip: MasterTrip,
        masterTrip: MasterTrip,
        matchMethod: MasterComparisonMatchMethod,
        shiftMinutes?: number
    ) => {
        const currentTripKey = buildTripKey(direction, currentTrip.id);
        const reason = matchMethod === 'lineage'
            ? 'Matched by stable trip lineage.'
            : matchMethod === 'trip-id'
                ? 'Matched by the same trip ID.'
                : `Matched by ${shiftMinutes && shiftMinutes !== 0 ? `${shiftMinutes > 0 ? '+' : ''}${shiftMinutes}m ` : ''}time alignment.`;

        currentTripComparisons.set(currentTripKey, {
            status: 'matched',
            direction,
            routeName: currentRouteNamesByTripKey.get(currentTripKey) || direction,
            currentTripId: currentTrip.id,
            masterTrip,
            matchMethod,
            confidence: matchMethod === 'time-shift' ? 'medium' : 'high',
            reason,
            ...(matchMethod === 'time-shift' ? { shiftMinutes } : {})
        });
        matchedMasterKeys.add(buildMatchedMasterKey(direction, masterTrip));
    };

    for (const dir of DIRECTIONS) {
        const masterTrips = [...masterByDir[dir]].sort((a, b) => a.startTime - b.startTime);
        const currentTrips = [...currentByDir[dir]].sort((a, b) => a.startTime - b.startTime);

        if (masterTrips.length === 0 || currentTrips.length === 0) continue;
        const baselineHasDurableLineage = masterTrips.some(masterTrip => !!masterTrip.lineageId);

        const exactIdQueues = new Map<string, MasterTrip[]>();
        const exactLineageQueues = new Map<string, MasterTrip[]>();
        masterTrips.forEach(masterTrip => {
            const queue = exactIdQueues.get(masterTrip.id) || [];
            queue.push(masterTrip);
            exactIdQueues.set(masterTrip.id, queue);

            if (masterTrip.lineageId) {
                const lineageQueue = exactLineageQueues.get(masterTrip.lineageId) || [];
                lineageQueue.push(masterTrip);
                exactLineageQueues.set(masterTrip.lineageId, lineageQueue);
            }
        });

        const remainingCurrentTrips: MasterTrip[] = [];

        currentTrips.forEach(currentTrip => {
            if (currentTrip.lineageId) {
                const lineageQueue = exactLineageQueues.get(currentTrip.lineageId) || [];
                const lineageMatch = lineageQueue.find(masterTrip => !matchedMasterKeys.has(buildMatchedMasterKey(dir, masterTrip)));

                if (lineageMatch) {
                    setMatched(dir, currentTrip, lineageMatch, 'lineage');
                    return;
                }

                // When the baseline carries durable lineage IDs, a current trip with a
                // different/new lineage is operationally new. Do not "helpfully" match it
                // to a same-time baseline trip, or added duplicate service can be shown as
                // RETIMED instead of NEW.
                if (baselineHasDurableLineage) {
                    return;
                }
            }

            const queue = exactIdQueues.get(currentTrip.id) || [];
            const exactMatch = queue.find(masterTrip => !matchedMasterKeys.has(buildMatchedMasterKey(dir, masterTrip)));

            if (exactMatch) {
                setMatched(dir, currentTrip, exactMatch, 'trip-id');
                return;
            }

            remainingCurrentTrips.push(currentTrip);
        });

        const remainingMasterTrips = masterTrips.filter(masterTrip => !matchedMasterKeys.has(buildMatchedMasterKey(dir, masterTrip)));
        if (remainingCurrentTrips.length === 0 || remainingMasterTrips.length === 0) continue;

        const runGreedyMatch = (shiftMinutes: number) => {
            const localUsed = new Set<string>();
            const pairs: Array<{ current: MasterTrip; master: MasterTrip }> = [];
            let totalDiff = 0;

            for (const currentTrip of remainingCurrentTrips) {
                let bestMatch: MasterTrip | null = null;
                let bestDiff = Infinity;

                for (const masterTrip of remainingMasterTrips) {
                    const masterKey = buildMatchedMasterKey(dir, masterTrip);
                    if (localUsed.has(masterKey)) continue;
                    if (matchedMasterKeys.has(masterKey)) continue;

                    const adjustedStart = currentTrip.startTime - shiftMinutes;
                    const diff = Math.abs(adjustedStart - masterTrip.startTime);
                    if (diff <= THRESHOLD && diff < bestDiff) {
                        bestDiff = diff;
                        bestMatch = masterTrip;
                    }
                }

                if (bestMatch) {
                    localUsed.add(buildMatchedMasterKey(dir, bestMatch));
                    pairs.push({ current: currentTrip, master: bestMatch });
                    totalDiff += bestDiff;
                }
            }

            return { pairs, count: pairs.length, totalDiff };
        };

        let bestShift = 0;
        let bestCount = -1;
        let bestTotalDiff = Infinity;

        for (let shift = -SHIFT_SEARCH_RANGE; shift <= SHIFT_SEARCH_RANGE; shift++) {
            const result = runGreedyMatch(shift);
            if (
                result.count > bestCount ||
                (result.count === bestCount && result.totalDiff < bestTotalDiff) ||
                (result.count === bestCount && result.totalDiff === bestTotalDiff && Math.abs(shift) < Math.abs(bestShift))
            ) {
                bestShift = shift;
                bestCount = result.count;
                bestTotalDiff = result.totalDiff;
            }
        }

        const finalMatch = runGreedyMatch(bestShift);
        if (finalMatch.count > 0) {
            shiftByDir[dir] = bestShift;
        }

        const locallyUsedMasterKeys = new Set<string>();
        for (const currentTrip of remainingCurrentTrips) {
            const candidates = remainingMasterTrips
                .map(masterTrip => {
                    const masterKey = buildMatchedMasterKey(dir, masterTrip);
                    if (matchedMasterKeys.has(masterKey) || locallyUsedMasterKeys.has(masterKey)) {
                        return null;
                    }

                    const adjustedStart = currentTrip.startTime - bestShift;
                    const diffMinutes = Math.abs(adjustedStart - masterTrip.startTime);
                    if (diffMinutes > THRESHOLD) return null;

                    return { masterTrip, diffMinutes, masterKey };
                })
                .filter((entry): entry is { masterTrip: MasterTrip; diffMinutes: number; masterKey: string } => !!entry)
                .sort((a, b) => (
                    a.diffMinutes - b.diffMinutes
                    || a.masterTrip.startTime - b.masterTrip.startTime
                ));

            if (candidates.length === 0) {
                continue;
            }

            if (candidates.length > 1) {
                const [bestCandidate, secondCandidate] = candidates;
                const bestDiff = bestCandidate.diffMinutes;
                const secondDiff = secondCandidate.diffMinutes;
                const isAmbiguous = secondDiff <= bestDiff + 1;

                if (isAmbiguous) {
                    const key = buildTripKey(dir, currentTrip.id);
                    const shortlist = candidates.slice(0, 3).map(candidate => ({
                        masterTrip: candidate.masterTrip,
                        diffMinutes: candidate.diffMinutes,
                    }));
                    shortlist.forEach(candidate => {
                        ambiguityProtectedMasterKeys.add(buildMatchedMasterKey(dir, candidate.masterTrip));
                    });

                    currentTripComparisons.set(key, {
                        status: 'ambiguous',
                        direction: dir,
                        routeName: currentRouteNamesByTripKey.get(key) || dir,
                        currentTripId: currentTrip.id,
                        confidence: 'low',
                        shiftMinutes: bestShift,
                        candidates: shortlist,
                        reason: `Multiple baseline trips are plausible after ${bestShift > 0 ? '+' : ''}${bestShift}m alignment. Review before trusting this delta.`,
                    });
                    continue;
                }
            }

            const bestCandidate = candidates[0];
            locallyUsedMasterKeys.add(bestCandidate.masterKey);
            setMatched(dir, currentTrip, bestCandidate.masterTrip, 'time-shift', bestShift);
        }
    }

    const removedMasterTrips: RemovedMasterComparisonEntry[] = [];
    masterBaseline.forEach(table => {
        const dir = toDirection(table.routeName);
        table.trips.forEach(trip => {
            const masterKey = buildMatchedMasterKey(dir, trip);
            if (!matchedMasterKeys.has(masterKey) && !ambiguityProtectedMasterKeys.has(masterKey)) {
                removedMasterTrips.push({
                    status: 'removed',
                    direction: dir,
                    routeName: table.routeName,
                    masterTrip: { ...trip, direction: dir },
                    confidence: 'low',
                    reason: 'No current trip matched this baseline trip.',
                });
            }
        });
    });
    removedMasterTrips.sort((a, b) => a.masterTrip.startTime - b.masterTrip.startTime);

    for (const dir of DIRECTIONS) {
        currentByDir[dir].forEach(currentTrip => {
            const key = buildTripKey(dir, currentTrip.id);
            if (currentTripComparisons.has(key)) return;

            currentTripComparisons.set(key, {
                status: 'new',
                direction: dir,
                routeName: currentRouteNamesByTripKey.get(key) || dir,
                currentTripId: currentTrip.id,
                confidence: 'low',
                reason: 'No baseline trip matched this current trip.',
            });
        });
    }

    return {
        currentTripComparisons,
        removedMasterTrips,
        masterShiftByDir: shiftByDir
    };
};

export const buildMasterComparison = (
    schedules: MasterRouteTable[],
    masterBaseline: MasterRouteTable[] | null | undefined
): MasterComparisonResult => {
    const detailed = buildDetailedMasterComparison(schedules, masterBaseline);

    const masterMatchMap = new Map<string, MasterTrip>();
    detailed.currentTripComparisons.forEach((entry, key) => {
        if (entry.status === 'matched') {
            masterMatchMap.set(key, entry.masterTrip);
        }
    });

    return {
        masterMatchMap,
        unmatchedMasterTrips: detailed.removedMasterTrips.map(entry => entry.masterTrip),
        masterShiftByDir: detailed.masterShiftByDir,
    };
};
