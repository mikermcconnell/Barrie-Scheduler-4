import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { extractDirectionFromName } from '../config/routeDirectionConfig';

type DirectionKey = 'North' | 'South';

export interface MasterComparisonResult {
    masterMatchMap: Map<string, MasterTrip>;
    unmatchedMasterTrips: MasterTrip[];
    masterShiftByDir: Partial<Record<DirectionKey, number>>;
}

const DIRECTIONS: DirectionKey[] = ['North', 'South'];

const buildTripKey = (direction: DirectionKey, tripId: string): string => `${direction}::${tripId}`;

const toDirection = (routeName: string): DirectionKey =>
    (extractDirectionFromName(routeName) || 'North') as DirectionKey;

export const buildMasterComparison = (
    schedules: MasterRouteTable[],
    masterBaseline: MasterRouteTable[] | null | undefined
): MasterComparisonResult => {
    if (!masterBaseline || masterBaseline.length === 0) {
        return {
            masterMatchMap: new Map<string, MasterTrip>(),
            unmatchedMasterTrips: [],
            masterShiftByDir: {}
        };
    }

    const THRESHOLD = 5;
    const SHIFT_SEARCH_RANGE = 15;

    const matchMap = new Map<string, MasterTrip>();
    const matchedMasterKeys = new Set<string>();
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

    for (const dir of DIRECTIONS) {
        const masterTrips = [...masterByDir[dir]].sort((a, b) => a.startTime - b.startTime);
        const currentTrips = [...currentByDir[dir]].sort((a, b) => a.startTime - b.startTime);

        if (masterTrips.length === 0 || currentTrips.length === 0) continue;

        const exactIdQueues = new Map<string, MasterTrip[]>();
        masterTrips.forEach(masterTrip => {
            const queue = exactIdQueues.get(masterTrip.id) || [];
            queue.push(masterTrip);
            exactIdQueues.set(masterTrip.id, queue);
        });

        const remainingCurrentTrips: MasterTrip[] = [];

        currentTrips.forEach(currentTrip => {
            const queue = exactIdQueues.get(currentTrip.id) || [];
            const exactMatch = queue.find(masterTrip => !matchedMasterKeys.has(buildTripKey(dir, masterTrip.id)));

            if (exactMatch) {
                matchMap.set(buildTripKey(dir, currentTrip.id), exactMatch);
                matchedMasterKeys.add(buildTripKey(dir, exactMatch.id));
                return;
            }

            remainingCurrentTrips.push(currentTrip);
        });

        const remainingMasterTrips = masterTrips.filter(masterTrip => !matchedMasterKeys.has(buildTripKey(dir, masterTrip.id)));
        if (remainingCurrentTrips.length === 0 || remainingMasterTrips.length === 0) continue;

        const runGreedyMatch = (shiftMinutes: number) => {
            const localUsed = new Set<string>();
            const pairs: Array<{ current: MasterTrip; master: MasterTrip }> = [];
            let totalDiff = 0;

            for (const currentTrip of remainingCurrentTrips) {
                let bestMatch: MasterTrip | null = null;
                let bestDiff = Infinity;

                for (const masterTrip of remainingMasterTrips) {
                    const masterKey = buildTripKey(dir, masterTrip.id);
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
                    const key = buildTripKey(dir, bestMatch.id);
                    localUsed.add(key);
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

        for (const pair of finalMatch.pairs) {
            matchMap.set(buildTripKey(dir, pair.current.id), pair.master);
            matchedMasterKeys.add(buildTripKey(dir, pair.master.id));
        }
    }

    const unmatchedMasterTrips: MasterTrip[] = [];
    masterBaseline.forEach(table => {
        const dir = toDirection(table.routeName);
        table.trips.forEach(trip => {
            if (!matchedMasterKeys.has(buildTripKey(dir, trip.id))) {
                unmatchedMasterTrips.push({ ...trip, direction: dir });
            }
        });
    });
    unmatchedMasterTrips.sort((a, b) => a.startTime - b.startTime);

    return {
        masterMatchMap: matchMap,
        unmatchedMasterTrips,
        masterShiftByDir: shiftByDir
    };
};
