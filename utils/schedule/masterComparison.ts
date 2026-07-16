import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { extractDirectionFromName, parseRouteInfo } from '../config/routeDirectionConfig';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';

type DirectionKey = 'North' | 'South';
export type MasterComparisonMatchMethod = 'lineage' | 'trip-id' | 'time-shift';
export type MasterComparisonConfidence = 'high' | 'medium' | 'low';

export interface AmbiguousMasterComparisonCandidate {
    masterTrip: MasterTrip;
    diffMinutes: number;
}

export interface PossibleMasterReplacementCandidate {
    currentTripId: string;
    routeName: string;
    startTime: number;
    endTime: number;
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
    possibleReplacements: PossibleMasterReplacementCandidate[];
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

const toDirection = (routeName: string): DirectionKey =>
    (extractDirectionFromName(routeName) || 'North') as DirectionKey;

const getRouteKey = (routeName: string): string => (
    parseRouteInfo(routeName).baseRoute.trim().toUpperCase()
);

const buildRouteDirectionBucketKey = (routeName: string, direction: DirectionKey): string => (
    `${getRouteKey(routeName)}::${direction}`
);

export const buildTripKey = (direction: DirectionKey, tripId: string, routeName?: string): string => (
    routeName
        ? `${buildRouteDirectionBucketKey(routeName, direction)}::${tripId}`
        : `${direction}::${tripId}`
);

const buildTripKeyForBucket = (bucketKey: string, tripId: string): string => `${bucketKey}::${tripId}`;

const buildMatchedMasterKey = (bucketKey: string, trip: MasterTrip): string => (
    `${bucketKey}::${trip.lineageId || trip.id}::${trip.startTime}::${trip.rowId}`
);

const getRouteBucketInfo = (routeName: string): { routeKey: string; direction: DirectionKey; bucketKey: string } => {
    const direction = toDirection(routeName);
    const routeKey = getRouteKey(routeName);
    return {
        routeKey,
        direction,
        bucketKey: `${routeKey}::${direction}`,
    };
};

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

const getTimedStopNames = (trip: MasterTrip): Set<string> => {
    const names = new Set<string>();
    Object.entries(trip.stops || {}).forEach(([key, value]) => {
        if (value) names.add(key.toLowerCase().trim());
    });
    Object.entries(trip.arrivalTimes || {}).forEach(([key, value]) => {
        if (value) names.add(key.toLowerCase().trim());
    });
    return names;
};

const getStopPatternPenalty = (currentTrip: MasterTrip, masterTrip: MasterTrip): number => {
    const currentStops = getTimedStopNames(currentTrip);
    const masterStops = getTimedStopNames(masterTrip);
    if (currentStops.size === 0 || masterStops.size === 0) return 0;

    let overlap = 0;
    currentStops.forEach(stop => {
        if (masterStops.has(stop)) overlap += 1;
    });

    const maxSize = Math.max(currentStops.size, masterStops.size);
    const overlapRatio = overlap / maxSize;
    return Math.round((1 - overlapRatio) * 20);
};

const scorePotentialMatch = (
    currentTrip: MasterTrip,
    masterTrip: MasterTrip,
    shiftMinutes: number,
): { score: number; startDiff: number } => {
    const adjustedStart = getOperationalSortTime(currentTrip.startTime) - shiftMinutes;
    const adjustedEnd = getOperationalSortTime(currentTrip.endTime) - shiftMinutes;
    const startDiff = Math.abs(adjustedStart - getOperationalSortTime(masterTrip.startTime));
    const endDiff = Math.abs(adjustedEnd - getOperationalSortTime(masterTrip.endTime));
    const travelDiff = Math.abs((currentTrip.travelTime || 0) - (masterTrip.travelTime || 0));
    const blockPenalty = currentTrip.blockId && masterTrip.blockId && currentTrip.blockId !== masterTrip.blockId ? 3 : 0;
    const stopPatternPenalty = getStopPatternPenalty(currentTrip, masterTrip);

    return {
        startDiff,
        score: (startDiff * 3) + endDiff + travelDiff + blockPenalty + stopPatternPenalty,
    };
};

export const classifyMatchedTripChange = (currentTrip: MasterTrip, masterTrip: MasterTrip): TripChangeKind => {
    const currentStart = getOperationalSortTime(currentTrip.startTime);
    const currentEnd = getOperationalSortTime(currentTrip.endTime);
    const masterStart = getOperationalSortTime(masterTrip.startTime);
    const masterEnd = getOperationalSortTime(masterTrip.endTime);
    const extendsEarlier = currentStart < masterStart;
    const extendsLater = currentEnd > masterEnd;
    const startsLater = currentStart > masterStart;
    const endsEarlier = currentEnd < masterEnd;

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
        const routeBucket = buildRouteDirectionBucketKey(routeName, direction);
        const routeKey = getRouteKey(routeName);
        const scopedBuckets = new Set(options?.routeNames?.map(name => {
            const dir = extractDirectionFromName(name);
            return dir ? buildRouteDirectionBucketKey(name, dir as DirectionKey) : null;
        }).filter((bucket): bucket is string => !!bucket) ?? []);
        const scopedRouteKeys = new Set(options?.routeNames?.map(getRouteKey) ?? []);
        if (scopedBuckets.has(routeBucket)) return true;
        if (routeFilterAllowsDirectionless && scopedRouteKeys.has(routeKey)) return true;
        return (routeDirectionFilter?.has(direction) ?? false) && scopedRouteKeys.has(routeKey);
    };

    schedules.forEach(table => {
        const dir = toDirection(table.routeName);
        table.trips.forEach(trip => {
            currentTripLookup.set(buildTripKey(dir, trip.id, table.routeName), trip);
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

    const TIME_MATCH_THRESHOLD = 10;
    const SHIFT_SEARCH_RANGE = 15;
    const MIN_GLOBAL_SHIFT_MATCHES = 2;

    const currentTripComparisons = new Map<string, CurrentTripComparisonEntry>();
    const matchedMasterKeys = new Set<string>();
    const ambiguityProtectedMasterKeys = new Set<string>();
    const shiftByDir: Partial<Record<DirectionKey, number>> = {};

    const masterByBucket = new Map<string, { routeKey: string; direction: DirectionKey; trips: MasterTrip[] }>();
    const currentRouteNamesByTripKey = new Map<string, string>();
    masterBaseline.forEach(table => {
        const bucket = getRouteBucketInfo(table.routeName);
        const existingBucket = masterByBucket.get(bucket.bucketKey) || {
            routeKey: bucket.routeKey,
            direction: bucket.direction,
            trips: [],
        };
        table.trips.forEach(trip => {
            existingBucket.trips.push(trip);
        });
        masterByBucket.set(bucket.bucketKey, existingBucket);
    });

    const currentByBucket = new Map<string, { routeKey: string; direction: DirectionKey; trips: MasterTrip[] }>();
    schedules.forEach(table => {
        const bucket = getRouteBucketInfo(table.routeName);
        const existingBucket = currentByBucket.get(bucket.bucketKey) || {
            routeKey: bucket.routeKey,
            direction: bucket.direction,
            trips: [],
        };
        table.trips.forEach(trip => {
            existingBucket.trips.push(trip);
            currentRouteNamesByTripKey.set(buildTripKeyForBucket(bucket.bucketKey, trip.id), table.routeName);
        });
        currentByBucket.set(bucket.bucketKey, existingBucket);
    });

    const setMatched = (
        bucketKey: string,
        direction: DirectionKey,
        currentTrip: MasterTrip,
        masterTrip: MasterTrip,
        matchMethod: MasterComparisonMatchMethod,
        shiftMinutes?: number
    ) => {
        const currentTripKey = buildTripKeyForBucket(bucketKey, currentTrip.id);
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
        matchedMasterKeys.add(buildMatchedMasterKey(bucketKey, masterTrip));
    };

    currentByBucket.forEach((currentBucket, bucketKey) => {
        const dir = currentBucket.direction;
        const masterTrips = [...(masterByBucket.get(bucketKey)?.trips || [])].sort((a, b) => (
            getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime)
        ));
        const currentTrips = [...currentBucket.trips].sort((a, b) => (
            getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime)
        ));

        if (masterTrips.length === 0 || currentTrips.length === 0) return;
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
                const lineageMatch = lineageQueue.find(masterTrip => !matchedMasterKeys.has(buildMatchedMasterKey(bucketKey, masterTrip)));

                if (lineageMatch) {
                    setMatched(bucketKey, dir, currentTrip, lineageMatch, 'lineage');
                    return;
                }

                // Lineage is a high-confidence signal, but not a hard requirement.
                // Generated/imported drafts can legitimately recreate the same public
                // service trip with a new lineage. In that case, fall through to exact
                // ID and time-proximity matching so a 7:01 replacement for a 7:00
                // master trip is shown as +1m, not NEW plus REMOVED.
            }

            const queue = exactIdQueues.get(currentTrip.id) || [];
            const exactMatch = queue.find(masterTrip => !matchedMasterKeys.has(buildMatchedMasterKey(bucketKey, masterTrip)));

            if (exactMatch) {
                setMatched(bucketKey, dir, currentTrip, exactMatch, 'trip-id');
                return;
            }

            remainingCurrentTrips.push(currentTrip);
        });

        const remainingMasterTrips = masterTrips.filter(masterTrip => !matchedMasterKeys.has(buildMatchedMasterKey(bucketKey, masterTrip)));
        if (remainingCurrentTrips.length === 0 || remainingMasterTrips.length === 0) return;

        const currentByExactStart = new Map<number, MasterTrip[]>();
        const masterByExactStart = new Map<number, MasterTrip[]>();
        remainingCurrentTrips.forEach(currentTrip => {
            const operationalStart = getOperationalSortTime(currentTrip.startTime);
            const currentQueue = currentByExactStart.get(operationalStart) || [];
            currentQueue.push(currentTrip);
            currentByExactStart.set(operationalStart, currentQueue);
        });
        remainingMasterTrips.forEach(masterTrip => {
            const operationalStart = getOperationalSortTime(masterTrip.startTime);
            const masterQueue = masterByExactStart.get(operationalStart) || [];
            masterQueue.push(masterTrip);
            masterByExactStart.set(operationalStart, masterQueue);
        });

        currentByExactStart.forEach((currentQueue, startTime) => {
            const masterQueue = masterByExactStart.get(startTime) || [];
            if (currentQueue.length !== 1 || masterQueue.length !== 1) return;

            const [currentTrip] = currentQueue;
            const [masterTrip] = masterQueue;
            const masterKey = buildMatchedMasterKey(bucketKey, masterTrip);
            if (matchedMasterKeys.has(masterKey)) return;

            setMatched(bucketKey, dir, currentTrip, masterTrip, 'time-shift', 0);
        });

        const shiftCandidateCurrentTrips = remainingCurrentTrips.filter(currentTrip => (
            !currentTripComparisons.has(buildTripKeyForBucket(bucketKey, currentTrip.id))
        ));
        const shiftCandidateMasterTrips = remainingMasterTrips.filter(masterTrip => (
            !matchedMasterKeys.has(buildMatchedMasterKey(bucketKey, masterTrip))
        ));
        if (shiftCandidateCurrentTrips.length === 0 || shiftCandidateMasterTrips.length === 0) return;

        const runGreedyMatch = (shiftMinutes: number) => {
            const localUsed = new Set<string>();
            const pairs: Array<{ current: MasterTrip; master: MasterTrip }> = [];
            let totalDiff = 0;

            for (const currentTrip of shiftCandidateCurrentTrips) {
                let bestMatch: MasterTrip | null = null;
                let bestDiff = Infinity;

                for (const masterTrip of shiftCandidateMasterTrips) {
                    const masterKey = buildMatchedMasterKey(bucketKey, masterTrip);
                    if (localUsed.has(masterKey)) continue;
                    if (matchedMasterKeys.has(masterKey)) continue;

                    const matchScore = scorePotentialMatch(currentTrip, masterTrip, shiftMinutes);
                    if (matchScore.startDiff <= TIME_MATCH_THRESHOLD && matchScore.score < bestDiff) {
                        bestDiff = matchScore.score;
                        bestMatch = masterTrip;
                    }
                }

                if (bestMatch) {
                    localUsed.add(buildMatchedMasterKey(bucketKey, bestMatch));
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

        const unshiftedMatch = bestShift === 0 ? { count: bestCount } : runGreedyMatch(0);
        const effectiveShift = (
            bestShift !== 0
            && (
                bestCount >= MIN_GLOBAL_SHIFT_MATCHES
                || bestCount > unshiftedMatch.count
            )
        )
            ? bestShift
            : 0;

        const finalMatch = runGreedyMatch(effectiveShift);
        if (finalMatch.count > 0) {
            if (effectiveShift !== 0) {
                shiftByDir[dir] = effectiveShift;
            }
        }

        const locallyUsedMasterKeys = new Set<string>();
        const fallbackShifts = Array.from(new Set([effectiveShift, 0]));
        for (const currentTrip of shiftCandidateCurrentTrips) {
            const candidates = shiftCandidateMasterTrips
                .map(masterTrip => {
                    const masterKey = buildMatchedMasterKey(bucketKey, masterTrip);
                    if (matchedMasterKeys.has(masterKey) || locallyUsedMasterKeys.has(masterKey)) {
                        return null;
                    }

                    const shiftedScores = fallbackShifts
                        .map(shiftMinutes => ({
                            shiftMinutes,
                            ...scorePotentialMatch(currentTrip, masterTrip, shiftMinutes),
                        }))
                        .filter(matchScore => matchScore.startDiff <= TIME_MATCH_THRESHOLD)
                        .sort((a, b) => (
                            a.score - b.score
                            || a.startDiff - b.startDiff
                            || Math.abs(a.shiftMinutes) - Math.abs(b.shiftMinutes)
                        ));

                    const matchScore = shiftedScores[0];
                    if (!matchScore) return null;

                    return {
                        masterTrip,
                        diffMinutes: matchScore.startDiff,
                        score: matchScore.score,
                        shiftMinutes: matchScore.shiftMinutes,
                        masterKey,
                    };
                })
                .filter((entry): entry is { masterTrip: MasterTrip; diffMinutes: number; score: number; shiftMinutes: number; masterKey: string } => !!entry)
                .sort((a, b) => (
                    a.score - b.score
                    || a.diffMinutes - b.diffMinutes
                    || Math.abs(a.shiftMinutes) - Math.abs(b.shiftMinutes)
                    || getOperationalSortTime(a.masterTrip.startTime) - getOperationalSortTime(b.masterTrip.startTime)
                ));

            if (candidates.length === 0) {
                continue;
            }

            if (candidates.length > 1) {
                const [bestCandidate, secondCandidate] = candidates;
                const isAmbiguous = secondCandidate.score <= bestCandidate.score + 4;

                if (isAmbiguous) {
                    const key = buildTripKeyForBucket(bucketKey, currentTrip.id);
                    const shortlist = candidates.slice(0, 3).map(candidate => ({
                        masterTrip: candidate.masterTrip,
                        diffMinutes: candidate.diffMinutes,
                    }));
                    shortlist.forEach(candidate => {
                        ambiguityProtectedMasterKeys.add(buildMatchedMasterKey(bucketKey, candidate.masterTrip));
                    });

                    currentTripComparisons.set(key, {
                        status: 'ambiguous',
                        direction: dir,
                        routeName: currentRouteNamesByTripKey.get(key) || dir,
                        currentTripId: currentTrip.id,
                        confidence: 'low',
                        ...(bestCandidate.shiftMinutes !== 0 ? { shiftMinutes: bestCandidate.shiftMinutes } : {}),
                        candidates: shortlist,
                        reason: bestCandidate.shiftMinutes !== 0
                            ? `Multiple baseline trips are plausible after ${bestCandidate.shiftMinutes > 0 ? '+' : ''}${bestCandidate.shiftMinutes}m alignment. Review before trusting this delta.`
                            : 'Multiple baseline trips are plausible. Review before trusting this delta.',
                    });
                    continue;
                }
            }

            const bestCandidate = candidates[0];
            locallyUsedMasterKeys.add(bestCandidate.masterKey);
            setMatched(bucketKey, dir, currentTrip, bestCandidate.masterTrip, 'time-shift', bestCandidate.shiftMinutes);
        }
    });

    const POSSIBLE_REPLACEMENT_WINDOW = 35;
    const getPossibleReplacements = (
        bucketKey: string,
        direction: DirectionKey,
        masterTrip: MasterTrip,
    ): PossibleMasterReplacementCandidate[] => {
        const bucket = currentByBucket.get(bucketKey);
        if (!bucket) return [];

        return bucket.trips
            .filter(currentTrip => !currentTripComparisons.has(buildTripKeyForBucket(bucketKey, currentTrip.id)))
            .map(currentTrip => ({
                currentTripId: currentTrip.id,
                routeName: currentRouteNamesByTripKey.get(buildTripKeyForBucket(bucketKey, currentTrip.id)) || direction,
                startTime: currentTrip.startTime,
                endTime: currentTrip.endTime,
                diffMinutes: getOperationalSortTime(currentTrip.startTime)
                    - getOperationalSortTime(masterTrip.startTime),
            }))
            .filter(candidate => Math.abs(candidate.diffMinutes) <= POSSIBLE_REPLACEMENT_WINDOW)
            .sort((a, b) => (
                Math.abs(a.diffMinutes) - Math.abs(b.diffMinutes)
                || getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime)
            ))
            .slice(0, 2);
    };

    const removedMasterTrips: RemovedMasterComparisonEntry[] = [];
    masterBaseline.forEach(table => {
        const bucket = getRouteBucketInfo(table.routeName);
        const dir = bucket.direction;
        table.trips.forEach(trip => {
            const masterKey = buildMatchedMasterKey(bucket.bucketKey, trip);
            if (!matchedMasterKeys.has(masterKey) && !ambiguityProtectedMasterKeys.has(masterKey)) {
                removedMasterTrips.push({
                    status: 'removed',
                    direction: dir,
                    routeName: table.routeName,
                    masterTrip: { ...trip, direction: dir },
                    confidence: 'low',
                    reason: 'No current trip matched this baseline trip.',
                    possibleReplacements: getPossibleReplacements(bucket.bucketKey, dir, trip),
                });
            }
        });
    });
    removedMasterTrips.sort((a, b) => (
        getOperationalSortTime(a.masterTrip.startTime)
        - getOperationalSortTime(b.masterTrip.startTime)
    ));

    currentByBucket.forEach((currentBucket, bucketKey) => {
        const dir = currentBucket.direction;
        currentBucket.trips.forEach(currentTrip => {
            const key = buildTripKeyForBucket(bucketKey, currentTrip.id);
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
    });

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
            // Preserve the legacy direction/id lookup for older callers that compare
            // only one route at a time. Route-scoped keys above avoid multi-route
            // collisions in full-export summaries.
            masterMatchMap.set(buildTripKey(entry.direction, entry.currentTripId), entry.masterTrip);
        }
    });

    return {
        masterMatchMap,
        unmatchedMasterTrips: detailed.removedMasterTrips.map(entry => entry.masterTrip),
        masterShiftByDir: detailed.masterShiftByDir,
    };
};
