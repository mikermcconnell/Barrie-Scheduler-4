
import { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { ScheduleConfig } from '../../components/NewSchedule/steps/Step3Build';
import { TimeBand, TripBucketAnalysis, BandSummary, DirectionBandSummary, MIN_RELIABLE_OBSERVATIONS } from '../ai/runtimeAnalysis';
import { SegmentRawData, extractTimepointsFromSegments } from '../../components/NewSchedule/utils/csvParser';
import { getOperationalSortTime, reassignBlocksForTables } from '../blocks/blockAssignmentCore';
import { normalizeSegmentStopKey } from '../runtimeSegmentMatching';

const normalizeStopLookupKey = (value: string): string => {
    return value
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bpl\b/g, ' place ')
        .replace(/\bcoll\b/g, ' college ')
        .replace(/\bctr\b/g, ' centre ')
        .replace(/\bstn\b/g, ' station ')
        .replace(/\bterm\b/g, ' terminal ')
        .replace(/\bhwy\b/g, ' highway ')
        .replace(/\bgovernors\b/g, 'govenors ')
        .replace(/[()[\]{}'".,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const buildNormalizedLookup = (
    ...lookups: Array<Record<string, string> | undefined>
): Record<string, string> => {
    const normalized: Record<string, string> = {};
    lookups.forEach(lookup => {
        if (!lookup) return;
        Object.entries(lookup).forEach(([name, code]) => {
            const n = normalizeStopLookupKey(name);
            if (n && code && !normalized[n]) {
                normalized[n] = code;
            }
        });
        });
    return normalized;
};

const normalizeStopNameForDirectionMatch = (value: string): string => {
    return value
        .toLowerCase()
        .replace(/^(arrive|arrival|depart|departure)\s+/i, '')
        .replace(/\s*\(\d+\)\s*$/g, '')
        .replace(/\bpl\b/g, ' place ')
        .replace(/\bcoll\b/g, ' college ')
        .replace(/\bctr\b/g, ' centre ')
        .replace(/\bstn\b/g, ' station ')
        .replace(/\bterm\b/g, ' terminal ')
        .replace(/[()[\]{}'".,#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const matchesStopNameForDirectionMatch = (
    normalizedStop: string,
    normalizedTarget: string
): boolean => {
    if (!normalizedStop || !normalizedTarget) return false;
    return normalizedStop === normalizedTarget
        || normalizedStop.includes(normalizedTarget)
        || normalizedTarget.includes(normalizedStop);
};

const resolveInitialDirection = (
    isRoundTrip: boolean,
    blockStartStop: string | undefined,
    hasNorth: boolean,
    directions: string[],
    timepointsMap: Record<string, string[]>,
    blockStartDirection?: 'North' | 'South'
): string => {
    let initialDirection = hasNorth ? 'North' : directions[0];
    if (!isRoundTrip || !blockStartStop) return initialDirection;

    const normalizedStart = normalizeStopNameForDirectionMatch(blockStartStop);
    const northStops = timepointsMap['North'] || [];
    const southStops = timepointsMap['South'] || [];

    const northOrigin = northStops[0];
    const southOrigin = southStops[0];
    const northTerminus = northStops[northStops.length - 1];
    const southTerminus = southStops[southStops.length - 1];

    const matchesNorthOrigin = !!northOrigin
        && matchesStopNameForDirectionMatch(normalizeStopNameForDirectionMatch(northOrigin), normalizedStart);
    const matchesSouthOrigin = !!southOrigin
        && matchesStopNameForDirectionMatch(normalizeStopNameForDirectionMatch(southOrigin), normalizedStart);
    const matchesNorthTerminus = !!northTerminus
        && matchesStopNameForDirectionMatch(normalizeStopNameForDirectionMatch(northTerminus), normalizedStart);
    const matchesSouthTerminus = !!southTerminus
        && matchesStopNameForDirectionMatch(normalizeStopNameForDirectionMatch(southTerminus), normalizedStart);

    if (matchesNorthOrigin && !matchesSouthOrigin) return 'North';
    if (matchesSouthOrigin && !matchesNorthOrigin) return 'South';

    // Starting at the opposite terminus means the first trip should depart in reverse.
    if (matchesNorthTerminus && !matchesSouthTerminus) return 'South';
    if (matchesSouthTerminus && !matchesNorthTerminus) return 'North';

    const northHasStop = northStops.some(stop =>
        matchesStopNameForDirectionMatch(normalizeStopNameForDirectionMatch(stop), normalizedStart)
    );
    const southHasStop = southStops.some(stop =>
        matchesStopNameForDirectionMatch(normalizeStopNameForDirectionMatch(stop), normalizedStart)
    );
    if (northHasStop && !southHasStop) return 'North';
    if (southHasStop && !northHasStop) return 'South';

    // Ambiguous mid-route stop (appears in both directions): use the explicit
    // block start direction if provided, otherwise keep the default.
    if (northHasStop && southHasStop) return blockStartDirection || initialDirection;

    return initialDirection;
};

/**
 * Generates a complete schedule from configuration and runtime analysis data.
 *
 * LOCKED LOGIC (see context.md):
 * - Segment Rounding: Each segment is rounded BEFORE summing
 * - Trip Pairing: North and South trips are paired per round trip
 * - Cycle Time: Configured cycle time drives headway calculations
 */
export const generateSchedule = (
    config: ScheduleConfig,
    buckets: TripBucketAnalysis[],
    bands: TimeBand[],
    bandSummary: DirectionBandSummary,
    segmentsMap: Record<string, SegmentRawData[]>,
    dayType: string = 'Weekday',
    gtfsStopLookup?: Record<string, string>,
    fallbackStopLookup?: Record<string, string>,
    canonicalTimepointsMap?: Record<string, string[]>
): MasterRouteTable[] => {
    // 1. Validation
    const isFloatingMode = config.cycleMode === 'Floating';
    const cycleTimeMinutes = config.cycleTime;
    if (!isFloatingMode && (!cycleTimeMinutes || cycleTimeMinutes <= 0)) return [];

    // 2. Identify available directions
    const directionKeys = new Set([
        ...Object.keys(segmentsMap),
        ...Object.keys(canonicalTimepointsMap || {}),
    ]);
    const directions = Array.from(directionKeys).filter(direction => {
        const hasSegments = (segmentsMap[direction]?.length || 0) > 0;
        const hasCanonicalStops = (canonicalTimepointsMap?.[direction]?.length || 0) > 1;
        return hasSegments || hasCanonicalStops;
    });
    if (directions.length === 0) return [];

    // Determine if Round Trip (North & South)
    const hasNorth = segmentsMap['North'] && segmentsMap['North'].length > 0;
    const hasSouth = segmentsMap['South'] && segmentsMap['South'].length > 0;
    const isRoundTrip = hasNorth && hasSouth;

    // Extract timepoints for each direction
    const timepointsMap: Record<string, string[]> = {};
    const stopIdsMap: Record<string, Record<string, string>> = {};
    const normalizedStopLookup = buildNormalizedLookup(gtfsStopLookup, fallbackStopLookup);

    directions.forEach(dir => {
        const canonicalStops = canonicalTimepointsMap?.[dir];
        timepointsMap[dir] = canonicalStops && canonicalStops.length > 1
            ? [...canonicalStops]
            : extractTimepointsFromSegments(segmentsMap[dir] || []);
        stopIdsMap[dir] = {};
        timepointsMap[dir].forEach((tp, i) => {
            const exactCode = gtfsStopLookup?.[tp] || fallbackStopLookup?.[tp];
            if (exactCode) {
                stopIdsMap[dir][tp] = exactCode;
                return;
            }

            // Normalized fallback catches abbreviations/case/punctuation differences.
            const normalizedCode = normalizedStopLookup[normalizeStopLookupKey(tp)];
            stopIdsMap[dir][tp] = normalizedCode || String(i + 1);
        });
    });

    // Helper: Convert "06:00" to minutes from midnight
    const toMinutes = (timeStr: string): number => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    // Helper: Convert minutes to "6:00 AM" format
    const toTimeStr = (totalMinutes: number): string => {
        // Normalize to 0-1439 range (handles negative and overflow)
        let normalized = totalMinutes % 1440;
        if (normalized < 0) normalized += 1440;

        const h = Math.floor(normalized / 60);
        const m = Math.floor(normalized % 60);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 || 12;
        return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    // Helper: Find the bucket for a given time (or closest bucket if not found)
    const findBucketForTime = (timeMinutes: number): TripBucketAnalysis | null => {
        const h = Math.floor(timeMinutes / 60) % 24;
        const m = Math.floor(timeMinutes % 60);
        const slotM = m >= 30 ? 30 : 0;
        const lookupStr = `${Math.floor(h).toString().padStart(2, '0')}:${slotM.toString().padStart(2, '0')}`;

        // First try exact match
        const bucket = buckets.find(b => b.timeBucket.startsWith(lookupStr) && !b.ignored && b.assignedBand);
        if (bucket) return bucket;

        // If no exact match, find the CLOSEST bucket with valid data
        const validBuckets = buckets.filter(b => !b.ignored && b.assignedBand && b.totalP50 > 0);
        if (validBuckets.length === 0) return null;

        let closestBucket = validBuckets[0];
        let minDiff = Infinity;

        validBuckets.forEach(b => {
            const bucketStart = b.timeBucket.split(' - ')[0];
            const [bh, bm] = bucketStart.split(':').map(Number);
            const bucketMins = bh * 60 + bm;
            const diff = Math.abs(bucketMins - timeMinutes);
            if (diff < minDiff) {
                minDiff = diff;
                closestBucket = b;
            }
        });

        return closestBucket;
    };

    // Helper: Get band travel time for a given time slot
    // Helper: Find which band a time slot falls into for a specific direction
    const getBandForTime = (timeMinutes: number, direction: string): BandSummary | null => {
        const bucket = findBucketForTime(timeMinutes);
        if (!bucket || !bucket.assignedBand) return null;

        const dirBands = bandSummary[direction];
        if (!dirBands) return null;

        return dirBands.find(bs => bs.bandId === bucket.assignedBand) || null;
    };

    // Helper: Segment Runtime (Legacy / Fallback)
    const getRawSegmentRuntime = (segments: SegmentRawData[], fromStop: string, toStop: string, timeMinutes: number): number => {
        const normalizedFromStop = normalizeSegmentStopKey(fromStop);
        const normalizedToStop = normalizeSegmentStopKey(toStop);
        const segment = segments.find(seg => {
            const parts = seg.segmentName.split(' to ');
            return parts.length === 2
                && normalizeSegmentStopKey(parts[0].trim()) === normalizedFromStop
                && normalizeSegmentStopKey(parts[1].trim()) === normalizedToStop;
        });

        if (!segment) return 5; // Default fallback

        const h = Math.floor(timeMinutes / 60) % 24;
        const m = Math.floor(timeMinutes % 60);
        const slotM = m >= 30 ? 30 : 0;
        const lookupStr = `${Math.floor(h).toString().padStart(2, '0')}:${slotM.toString().padStart(2, '0')}`;

        const bucketKey = Object.keys(segment.timeBuckets).find(b => b.startsWith(lookupStr));
        if (bucketKey) return segment.timeBuckets[bucketKey].p50;

        const allValues = Object.values(segment.timeBuckets);
        if (allValues.length > 0) return allValues.reduce((sum, v) => sum + v.p50, 0) / allValues.length;

        return 5;
    };

    const allTables: MasterRouteTable[] = [];

    // Initialize trips arrays per direction
    const resultTrips: Record<string, MasterTrip[]> = {};
    directions.forEach(dir => resultTrips[dir] = []);

    // Generate Trips Block by Block
    config.blocks.forEach(block => {
        const startMins = toMinutes(block.startTime);
        let endMins = toMinutes(block.endTime);
        // Overnight block window: e.g., start 5:09 AM, end 12:33 AM (next day).
        // Time inputs are clock-only, so treat end <= start as rollover to next day.
        if (endMins <= startMins) {
            endMins += 1440;
        }
        let currentTime = startMins;

        // Determine starting direction from block start stop when available.
        let currentDir = resolveInitialDirection(
            isRoundTrip,
            block.startStop,
            hasNorth,
            directions,
            timepointsMap,
            block.startDirection
        );
        let tripSequence = 1;

        // For mid-route starts: find start stop index in the first trip's direction.
        // Only applies to the first trip of the block; cleared after generation.
        let pendingStartStopIdx: number | undefined;
        if (block.startStop) {
            const normalizedBlockStart = normalizeStopNameForDirectionMatch(block.startStop);
            const firstDirTimepoints = timepointsMap[currentDir];
            if (firstDirTimepoints && normalizedBlockStart) {
                const firstStopNorm = normalizeStopNameForDirectionMatch(firstDirTimepoints[0]);
                if (!matchesStopNameForDirectionMatch(firstStopNorm, normalizedBlockStart)) {
                    const idx = firstDirTimepoints.findIndex(tp =>
                        matchesStopNameForDirectionMatch(
                            normalizeStopNameForDirectionMatch(tp),
                            normalizedBlockStart
                        )
                    );
                    if (idx > 0) {
                        pendingStartStopIdx = idx;
                    }
                }
            }
        }

        // Loop until we exceed the block end time
        while (currentTime < endMins) {
            const dirSegments = segmentsMap[currentDir] || [];
            const dirTimepoints = timepointsMap[currentDir];

            // Use the trip's own departure time to select the runtime band for that direction.
            const currentBand: BandSummary | null = getBandForTime(currentTime, currentDir);

            // Hardened segment time lookup with adjacent-band fallback
            const getReliableSegmentTime = (fromStop: string, toStop: string): { time: number; source: string } => {
                const segmentName = `${fromStop} to ${toStop}`;
                const dirBands = bandSummary[currentDir];

                // 1. Current band — use if reliable (n >= threshold)
                if (currentBand) {
                    const seg = currentBand.segments.find(s => s.segmentName === segmentName);
                    if (seg && seg.totalN >= MIN_RELIABLE_OBSERVATIONS) {
                        return { time: seg.avgTime, source: 'band' };
                    }
                }

                // 2. Adjacent band fallback — walk outward from current band
                if (dirBands && currentBand) {
                    const bandOrder = ['A', 'B', 'C', 'D', 'E'];
                    const currentIdx = bandOrder.indexOf(currentBand.bandId);

                    for (let offset = 1; offset < bandOrder.length; offset++) {
                        for (const step of [1, -1]) {
                            const idx = currentIdx + (offset * step);
                            if (idx < 0 || idx >= bandOrder.length) continue;
                            const adjacentBand = dirBands.find(b => b.bandId === bandOrder[idx]);
                            if (!adjacentBand) continue;
                            const seg = adjacentBand.segments.find(s => s.segmentName === segmentName);
                            if (seg && seg.totalN >= MIN_RELIABLE_OBSERVATIONS) {
                                return { time: seg.avgTime, source: `adjacent-${adjacentBand.bandId}` };
                            }
                        }
                    }

                    // 3. All-band weighted average
                    let totalSum = 0;
                    let totalWeight = 0;
                    dirBands.forEach(b => {
                        const seg = b.segments.find(s => s.segmentName === segmentName);
                        if (seg && seg.avgTime > 0) {
                            const weight = seg.totalN && seg.totalN > 0
                                ? seg.totalN
                                : Math.max(1, b.timeSlots.length);
                            totalSum += seg.avgTime * weight;
                            totalWeight += weight;
                        }
                    });
                    if (totalWeight > 0) {
                        return { time: totalSum / totalWeight, source: 'all-band-avg' };
                    }
                }

                // 4. Raw time bucket fallback
                const rawTime = getRawSegmentRuntime(dirSegments, fromStop, toStop, currentTime);
                return { time: rawTime, source: rawTime === 5 ? 'default-5min' : 'raw-bucket' };
            };

            // Mid-route start: active segment index (0 = full trip)
            const activeStartIdx = pendingStartStopIdx || 0;

            // First pass: collect raw segment times and sum
            const rawSegmentTimes: number[] = [];
            let rawSum = 0;

            for (let i = 0; i < dirTimepoints.length - 1; i++) {
                const fromStop = dirTimepoints[i];
                const toStop = dirTimepoints[i + 1];

                const reliable = getReliableSegmentTime(fromStop, toStop);
                let segTime: number | null = reliable.time;

                rawSegmentTimes.push(segTime);
                // Only count active segments toward raw sum
                if (i >= activeStartIdx) {
                    rawSum += segTime;
                }
            }

            // Use the observed segment chain as the target after per-segment rounding.
            const isPartialTrip = activeStartIdx > 0;
            const directionTarget = Math.max(1, Math.round(rawSum));

            // Second pass: round each segment, then adjust last active segment to hit target exactly
            // LOCKED LOGIC: Round BEFORE summing
            const finalSegmentRuntimes: number[] = [];
            let allocatedTime = 0;
            const lastActiveIdx = rawSegmentTimes.length - 1;

            for (let i = 0; i < rawSegmentTimes.length; i++) {
                if (i < activeStartIdx) {
                    // Inactive segment (before mid-route start): zero placeholder
                    finalSegmentRuntimes.push(0);
                } else if (i === lastActiveIdx) {
                    // Last active segment: use remainder to hit target exactly
                    const lastSegTime = Math.max(1, directionTarget - allocatedTime);
                    finalSegmentRuntimes.push(lastSegTime);
                    allocatedTime += lastSegTime;
                } else {
                    const roundedSegTime = Math.round(rawSegmentTimes[i]);
                    finalSegmentRuntimes.push(roundedSegTime);
                    allocatedTime += roundedSegTime;
                }
            }
            const pureTravelTime = allocatedTime;

            // 3. Cycle & Recovery Calculation (Strict vs Floating)
            let tripCycleAllocated = 0;
            let totalRecovery = 0;
            let nextTripStart = 0;

            if (config.cycleMode === 'Floating') {
                // Floating: Cycle = Travel + (Travel * Ratio)
                // Per-band lookup > global config > default 15%
                const bandId = currentBand?.bandId;
                const bandDefault = bandId ? config.bandRecoveryDefaults?.find(bd => bd.bandId === bandId) : undefined;
                const ratio = (bandDefault?.avgRecoveryRatio ?? config.recoveryRatio ?? 15) / 100;
                totalRecovery = Math.round(pureTravelTime * ratio);
                tripCycleAllocated = pureTravelTime + totalRecovery;
                nextTripStart = currentTime + tripCycleAllocated;
            } else {
                // Strict: Cycle is Fixed. Recovery fills the gap.
                // Per-band lookup > global config > default 60m
                const bandId = currentBand?.bandId;
                const bandDefault = bandId ? config.bandRecoveryDefaults?.find(bd => bd.bandId === bandId) : undefined;
                const totalCycle = bandDefault?.avgCycleTime ?? config.cycleTime;
                const allocated = isRoundTrip ? totalCycle / 2 : totalCycle;
                tripCycleAllocated = allocated;

                totalRecovery = Math.max(0, Math.round(allocated - pureTravelTime));
                nextTripStart = currentTime + allocated;
            }

            // Partial pullout trips: use proportional recovery instead of cycle-gap.
            // Without this, Strict mode assigns (halfCycle - tinyTravel) = inflated
            // recovery (e.g., 59 min at Rose St for a 1-min Georgian Coll → Rose pullout).
            if (isPartialTrip) {
                const bandId = currentBand?.bandId;
                const bandDefault = bandId ? config.bandRecoveryDefaults?.find(bd => bd.bandId === bandId) : undefined;
                const ratio = (bandDefault?.avgRecoveryRatio ?? config.recoveryRatio ?? 15) / 100;
                totalRecovery = Math.round(pureTravelTime * ratio);
                tripCycleAllocated = pureTravelTime + totalRecovery;
                nextTripStart = currentTime + tripCycleAllocated;
            }

            // 4. Distribute Recovery PROPORTIONALLY across all stops (except first)
            const recoveryTimes: Record<string, number> = {};
            const stopPaddings: number[] = new Array(dirTimepoints.length).fill(0);

            if (totalRecovery > 0) {
                let distributedSoFar = 0;
                finalSegmentRuntimes.forEach((st, idx) => {
                    if (idx < finalSegmentRuntimes.length - 1) {
                        const share = Math.floor((st / pureTravelTime) * totalRecovery);
                        stopPaddings[idx + 1] = share;
                        recoveryTimes[dirTimepoints[idx + 1]] = share;
                        distributedSoFar += share;
                    }
                });
                // Last stop: gets remainder (always >= 0 since we used Math.floor above)
                const lastIdx = dirTimepoints.length - 1;
                const remainder = totalRecovery - distributedSoFar;
                stopPaddings[lastIdx] = remainder;
                recoveryTimes[dirTimepoints[lastIdx]] = remainder;
            } else {
                dirTimepoints.forEach((stop, idx) => {
                    if (idx > 0) recoveryTimes[stop] = 0;
                });
            }

            // 5. Construct Trip Object with Arrival Times, Recovery Times, and Departure Times
            const stopTimes: Record<string, string> = {};
            const arrivalTimes: Record<string, string> = {};
            let currentStopMins = currentTime;

            dirTimepoints.forEach((stop, idx) => {
                // Skip stops before the mid-route start
                if (idx < activeStartIdx) return;

                if (idx > activeStartIdx) {
                    currentStopMins += finalSegmentRuntimes[idx - 1];
                }

                const arrivalMins = currentStopMins;
                const recovery = recoveryTimes[stop] || 0;
                const departureMins = arrivalMins + recovery;

                arrivalTimes[stop] = toTimeStr(arrivalMins);
                stopTimes[stop] = toTimeStr(departureMins);
                currentStopMins = departureMins;
            });

            // Create MasterTrip with full time breakdown
            const newTrip: MasterTrip = {
                id: `${block.id}-${tripSequence}`,
                blockId: block.id,
                direction: currentDir as 'North' | 'South',
                startTime: currentTime,
                endTime: currentStopMins,
                endTimeIncludesRecovery: true,
                tripNumber: tripSequence,
                rowId: 0,
                travelTime: pureTravelTime,
                stops: stopTimes,
                arrivalTimes: arrivalTimes,
                recoveryTimes: recoveryTimes,
                recoveryTime: totalRecovery,
                cycleTime: tripCycleAllocated,
                assignedBand: currentBand?.bandId || undefined,
                startStopIndex: activeStartIdx > 0 ? activeStartIdx : undefined
            };

            resultTrips[currentDir].push(newTrip);

            // 6. Advance
            currentTime = nextTripStart;
            tripSequence++;
            // Clear mid-route start after first trip — subsequent trips are full-route
            pendingStartStopIdx = undefined;

            // Toggle Direction for Round Trip
            if (isRoundTrip) {
                const wasNorth = currentDir === 'North';
                currentDir = wasNorth ? 'South' : 'North';
            }
        }
    });

    // Final Assembly (Separate tables per direction)
    directions.forEach(dir => {
        if (resultTrips[dir].length > 0) {
            allTables.push({
                routeName: `${config.routeNumber} (${dayType}) (${dir})`,
                stops: timepointsMap[dir],
                stopIds: stopIdsMap[dir],
                // Sort by operational time: midnight-4AM trips are late-night, not early morning
                trips: resultTrips[dir].sort((a, b) => getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime))
            });
        }
    });

    // Reassign blocks using terminal continuity.
    // Generated schedules can include terminal waits between opposite directions
    // (e.g., ARR 6:29 -> DEP 6:44), so use gap-based matching with location checks.
    const blockCount = Math.max(1, config.blocks?.length || 1);
    const headway = Math.max(1, Math.round((config.cycleTime || 60) / blockCount));
    const maxGap = Math.max(10, headway * 2); // Allow up to ~2 headways of terminal wait.

    reassignBlocksForTables(allTables, config.routeNumber, {
        timeTolerance: 1,
        checkLocation: true,
        maxGap
    });

    return allTables;
};
