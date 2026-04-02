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
    currentTripId: string;
    confidence: 'low';
    reason: string;
}

export interface AmbiguousMasterComparisonEntry {
    status: 'ambiguous';
    direction: DirectionKey;
    currentTripId: string;
    confidence: 'low';
    reason: string;
    shiftMinutes?: number;
    candidates: AmbiguousMasterComparisonCandidate[];
}

export interface RemovedMasterComparisonEntry {
    status: 'removed';
    direction: DirectionKey;
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

const DIRECTIONS: DirectionKey[] = ['North', 'South'];

export const buildTripKey = (direction: DirectionKey, tripId: string): string => `${direction}::${tripId}`;
const buildMatchedMasterKey = (direction: DirectionKey, trip: MasterTrip): string => (
    `${direction}::${trip.lineageId || trip.id}::${trip.startTime}::${trip.rowId}`
);

const toDirection = (routeName: string): DirectionKey =>
    (extractDirectionFromName(routeName) || 'North') as DirectionKey;

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
                        currentTripId: currentTrip.id,
                        confidence: 'low',
                        shiftMinutes: bestShift,
                        candidates: shortlist,
                        reason: `Multiple master trips are plausible after ${bestShift > 0 ? '+' : ''}${bestShift}m alignment. Review before trusting this delta.`,
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
                    masterTrip: { ...trip, direction: dir },
                    confidence: 'low',
                    reason: 'No current trip matched this master trip.',
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
                currentTripId: currentTrip.id,
                confidence: 'low',
                reason: 'No master trip matched this current trip.',
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
