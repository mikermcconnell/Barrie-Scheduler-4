
import { MasterRouteTable, MasterTrip } from '../../../utils/masterScheduleParser';
import { ScheduleConfig } from '../steps/Step3Build';
import { TimeBand, TripBucketAnalysis, BandSummary, DirectionBandSummary } from './runtimeAnalysis';
import { SegmentRawData, extractTimepointsFromSegments } from './csvParser';

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
    dayType: string = 'Weekday'
): MasterRouteTable[] => {
    // 1. Validation
    const cycleTimeMinutes = config.cycleTime;
    if (!cycleTimeMinutes || cycleTimeMinutes <= 0) return [];

    // 2. Identify available directions
    const directions = Object.keys(segmentsMap).filter(d => segmentsMap[d].length > 0);
    if (directions.length === 0) return [];

    // Determine if Round Trip (North & South)
    const hasNorth = segmentsMap['North'] && segmentsMap['North'].length > 0;
    const hasSouth = segmentsMap['South'] && segmentsMap['South'].length > 0;
    const isRoundTrip = hasNorth && hasSouth;

    // Extract timepoints for each direction
    const timepointsMap: Record<string, string[]> = {};
    const stopIdsMap: Record<string, Record<string, string>> = {};

    directions.forEach(dir => {
        timepointsMap[dir] = extractTimepointsFromSegments(segmentsMap[dir]);
        stopIdsMap[dir] = {};
        timepointsMap[dir].forEach((tp, i) => { stopIdsMap[dir][tp] = String(i + 1); });
    });

    // Helper: Convert "06:00" to minutes from midnight
    const toMinutes = (timeStr: string): number => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    // Helper: Convert minutes to "6:00 AM" format
    const toTimeStr = (totalMinutes: number): string => {
        let h = Math.floor(totalMinutes / 60);
        const m = Math.floor(totalMinutes % 60);
        const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
        let displayH = h % 12;
        if (displayH === 0) displayH = 12;
        if (h >= 24) h -= 24;
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
    const getBandTargetTime = (timeMinutes: number): number | null => {
        const bucket = findBucketForTime(timeMinutes);
        if (bucket && bucket.assignedBand) {
            const band = bands.find(b => b.id === bucket.assignedBand);
            if (band) return band.avg;
        }
        return null;
    };

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
        const segment = segments.find(seg => {
            const parts = seg.segmentName.split(' to ');
            return parts.length === 2 && parts[0].trim() === fromStop && parts[1].trim() === toStop;
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
        const endMins = toMinutes(block.endTime);
        let currentTime = startMins;

        let currentDir = hasNorth ? 'North' : directions[0];
        let tripSequence = 1;

        // For round-trip routes, track the band determined at the START of the round trip
        // This ensures North and South legs use the same band based on initial departure
        let roundTripBandId: string | null = null;
        let roundTripNorthTravelTime: number = 0;

        // Loop until we exceed the block end time
        while (currentTime < endMins) {
            const dirSegments = segmentsMap[currentDir];
            const dirTimepoints = timepointsMap[currentDir];

            // For round-trip routes: determine band at the START of each round trip (North leg)
            // and reuse it for the South leg
            let currentBand: BandSummary | null = null;

            if (isRoundTrip) {
                if (currentDir === 'North' || !roundTripBandId) {
                    // Starting a new round trip - determine band from initial departure
                    currentBand = getBandForTime(currentTime, currentDir);
                    roundTripBandId = currentBand?.bandId || null;
                } else {
                    // South leg - reuse the band from the North leg
                    const dirBands = bandSummary[currentDir];
                    currentBand = dirBands?.find(b => b.bandId === roundTripBandId) || null;
                }
            } else {
                // Not a round trip - lookup band normally for each trip
                currentBand = getBandForTime(currentTime, currentDir);
            }

            // Helper: Get segment time directly from currentBand
            const getSegmentTimeFromBand = (fromStop: string, toStop: string): number | null => {
                if (!currentBand) return null;
                const segmentName = `${fromStop} to ${toStop}`;
                const segment = currentBand.segments.find(s => s.segmentName === segmentName);
                return segment?.avgTime ?? null;
            };

            // First pass: collect raw segment times and sum
            const rawSegmentTimes: number[] = [];
            let rawSum = 0;
            let usedBandData = true;

            for (let i = 0; i < dirTimepoints.length - 1; i++) {
                const fromStop = dirTimepoints[i];
                const toStop = dirTimepoints[i + 1];

                // Get segment time directly from the current band (NOT by time lookup)
                let segTime = getSegmentTimeFromBand(fromStop, toStop);

                if (segTime === null) {
                    // Fallback: use raw segment data
                    segTime = getRawSegmentRuntime(dirSegments, fromStop, toStop, currentTime);
                    usedBandData = false;
                }

                rawSegmentTimes.push(segTime);
                rawSum += segTime;
            }

            // Calculate direction target to ensure North + South = band's avgTotal exactly
            let directionTarget: number;
            const bandTotal = Math.round(currentBand?.avgTotal || rawSum);

            if (isRoundTrip) {
                if (currentDir === 'North') {
                    // North leg: use floor of half to leave room for South
                    directionTarget = Math.floor(bandTotal / 2);
                } else {
                    // South leg: use remainder to hit exact total
                    directionTarget = bandTotal - roundTripNorthTravelTime;
                }
            } else {
                // Single direction: use full target
                directionTarget = bandTotal;
            }

            // Second pass: round each segment, then adjust last segment to hit target exactly
            // LOCKED LOGIC: Round BEFORE summing
            const finalSegmentRuntimes: number[] = [];
            let allocatedTime = 0;

            for (let i = 0; i < rawSegmentTimes.length; i++) {
                if (i === rawSegmentTimes.length - 1) {
                    // Last segment: use remainder to hit target exactly
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
                const ratio = (config.recoveryRatio ?? 15) / 100;
                totalRecovery = Math.round(pureTravelTime * ratio);
                tripCycleAllocated = pureTravelTime + totalRecovery;
                nextTripStart = currentTime + tripCycleAllocated;
            } else {
                // Strict: Cycle is Fixed. Recovery fills the gap.
                const totalCycle = config.cycleTime;
                const allocated = isRoundTrip ? totalCycle / 2 : totalCycle;
                tripCycleAllocated = allocated;

                totalRecovery = Math.max(0, Math.round(allocated - pureTravelTime));
                nextTripStart = currentTime + allocated;
            }

            // 4. Distribute Recovery PROPORTIONALLY across all stops (except first)
            const recoveryTimes: Record<string, number> = {};
            const stopPaddings: number[] = new Array(dirTimepoints.length).fill(0);

            if (totalRecovery > 0) {
                let distributedSoFar = 0;
                finalSegmentRuntimes.forEach((st, idx) => {
                    if (idx < finalSegmentRuntimes.length - 1) {
                        const share = Math.round((st / pureTravelTime) * totalRecovery);
                        stopPaddings[idx + 1] = share;
                        recoveryTimes[dirTimepoints[idx + 1]] = share;
                        distributedSoFar += share;
                    }
                });
                // Last stop: gets remainder to ensure total matches
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
                if (idx > 0) {
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
                tripNumber: tripSequence,
                rowId: 0,
                travelTime: pureTravelTime,
                stops: stopTimes,
                arrivalTimes: arrivalTimes,
                recoveryTimes: recoveryTimes,
                recoveryTime: totalRecovery,
                cycleTime: tripCycleAllocated,
                assignedBand: roundTripBandId || currentBand?.bandId || undefined
            };

            resultTrips[currentDir].push(newTrip);

            // Track North travel time for computing South target
            if (isRoundTrip && currentDir === 'North') {
                roundTripNorthTravelTime = pureTravelTime;
            }

            // 6. Advance
            currentTime = nextTripStart;
            tripSequence++;

            // Toggle Direction for Round Trip
            if (isRoundTrip) {
                const wasNorth = currentDir === 'North';
                currentDir = wasNorth ? 'South' : 'North';

                // After completing South leg, reset for next round trip
                if (!wasNorth) {
                    roundTripBandId = null;
                    roundTripNorthTravelTime = 0;
                }
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
                trips: resultTrips[dir].sort((a, b) => a.startTime - b.startTime)
            });
        }
    });

    return allTables;
};
