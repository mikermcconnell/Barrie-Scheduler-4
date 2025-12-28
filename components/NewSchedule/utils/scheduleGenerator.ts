
import { MasterRouteTable, MasterTrip } from '../../../utils/masterScheduleParser';
import { ScheduleConfig } from '../steps/Step3Build';
import { TimeBand, TripBucketAnalysis, BandSummary, DirectionBandSummary } from './runtimeAnalysis';
import { SegmentRawData, extractTimepointsFromSegments } from './csvParser';

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
    // Note: In Floating mode, cycleTime is just a reference, but must be > 0 to have generated blocks from Step 3
    if (!cycleTimeMinutes || cycleTimeMinutes <= 0) return [];

    // 2. Identify available directions
    const directions = Object.keys(segmentsMap).filter(d => segmentsMap[d].length > 0);
    if (directions.length === 0) return []; // No data

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

    // DEBUG: Log the input data state
    console.log('=== SCHEDULE GENERATOR DEBUG ===');
    console.log('bandSummary keys:', Object.keys(bandSummary));
    Object.entries(bandSummary).forEach(([dir, bands]) => {
        console.log(`  ${dir}: ${bands.length} bands`);
        bands.forEach(b => {
            console.log(`    Band ${b.bandId}: ${b.segments.length} segments, avgTotal=${b.avgTotal?.toFixed(1)}`);
            if (b.segments.length > 0) {
                console.log(`      Sample segments: ${b.segments.slice(0, 2).map(s => `"${s.segmentName}" (${s.avgTime})`).join(', ')}`);
            }
        });
    });
    console.log('timepointsMap:', timepointsMap);
    console.log('=================================');

    // Helper: Convert "06:00" to minutes from midnight
    const toMinutes = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    // Helper: Convert minutes to "6:00 AM" format
    const toTimeStr = (totalMinutes: number) => {
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
        let bucket = buckets.find(b => b.timeBucket.startsWith(lookupStr) && !b.ignored && b.assignedBand);
        if (bucket) return bucket;

        // If no exact match, find the CLOSEST bucket with valid data
        // Parse all bucket start times and find the nearest one
        const validBuckets = buckets.filter(b => !b.ignored && b.assignedBand && b.totalP50 > 0);
        if (validBuckets.length === 0) return null;

        let closestBucket = validBuckets[0];
        let minDiff = Infinity;

        validBuckets.forEach(b => {
            const bucketStart = b.timeBucket.split(' - ')[0]; // e.g., "07:00"
            const [bh, bm] = bucketStart.split(':').map(Number);
            const bucketMins = bh * 60 + bm;
            const diff = Math.abs(bucketMins - timeMinutes);
            if (diff < minDiff) {
                minDiff = diff;
                closestBucket = b;
            }
        });

        console.log(`  [CLOSEST] No bucket for ${lookupStr}, using ${closestBucket.timeBucket} (Band ${closestBucket.assignedBand})`);
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
        console.log(`  [getBandForTime] time=${timeMinutes}, direction="${direction}"`);

        const bucket = findBucketForTime(timeMinutes);
        console.log(`    bucket found:`, bucket ? `"${bucket.timeBucket}" band=${bucket.assignedBand}` : 'null');

        if (!bucket || !bucket.assignedBand) {
            console.log(`    EARLY RETURN: bucket or assignedBand is null`);
            return null;
        }

        // Look up from the direction-specific band summary
        console.log(`    bandSummary has keys:`, Object.keys(bandSummary));
        const dirBands = bandSummary[direction];
        console.log(`    dirBands for "${direction}":`, dirBands ? `${dirBands.length} bands` : 'undefined');

        if (!dirBands) {
            console.log(`    EARLY RETURN: no bands for direction "${direction}"`);
            return null;
        }

        const matchedBand = dirBands.find(bs => bs.bandId === bucket.assignedBand);
        console.log(`    looking for bandId="${bucket.assignedBand}", found:`, matchedBand ? `Band ${matchedBand.bandId} with ${matchedBand.segments.length} segments` : 'null');

        return matchedBand || null;
    };

    // Helper: Get segment time from band summary table (SOURCE OF TRUTH)
    // This uses the averaged segment times directly from the Step 2 table
    // Now direction-aware to avoid segment name collisions
    const getBandSegmentTime = (timeMinutes: number, fromStop: string, toStop: string, direction: string): number | null => {
        const band = getBandForTime(timeMinutes, direction);
        if (!band) {
            console.log(`  [NO BAND] getBandForTime returned null for time ${timeMinutes}, dir ${direction}`);
            console.log(`    bandSummary keys:`, Object.keys(bandSummary));
            console.log(`    bandSummary[${direction}]:`, bandSummary[direction]?.length || 0, 'bands');
            return null;
        }

        const segmentName = `${fromStop} to ${toStop}`;
        console.log(`  [getBandSegmentTime] Looking for segment: "${segmentName}"`);
        console.log(`    Band ${band.bandId} has ${band.segments.length} segments`);

        const segment = band.segments.find(s => s.segmentName === segmentName);

        if (segment && segment.avgTime > 0) {
            console.log(`    ✓ MATCH FOUND: avgTime=${segment.avgTime}`);
            return segment.avgTime;
        }

        // Debug: Show what segments ARE available in this band with exact character comparison
        console.log(`    ✗ NO MATCH. Available segments:`);
        band.segments.forEach((s, i) => {
            const matches = s.segmentName === segmentName;
            console.log(`      [${i}] "${s.segmentName}" (avgTime=${s.avgTime}) ${matches ? '← SHOULD MATCH!' : ''}`);
        });

        // Character-level debug for first segment
        if (band.segments.length > 0) {
            const first = band.segments[0].segmentName;
            console.log(`    Character comparison:`);
            console.log(`      Looking for: [${segmentName.split('').map(c => c.charCodeAt(0)).join(',')}]`);
            console.log(`      First avail: [${first.split('').map(c => c.charCodeAt(0)).join(',')}]`);
        }
        return null;
    };

    // Helper: Segment Runtime (Legacy / Fallback)
    const getRawSegmentRuntime = (segments: SegmentRawData[], fromStop: string, toStop: string, timeMinutes: number): number => {
        const segment = segments.find(seg => {
            const parts = seg.segmentName.split(' to ');
            return parts.length === 2 && parts[0].trim() === fromStop && parts[1].trim() === toStop;
        });

        if (!segment) return 5; // Default

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

    let tripGlobalCounter = 1;

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
        let roundTripStartTime: number | null = null;

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
                    roundTripStartTime = currentTime;
                    currentBand = getBandForTime(currentTime, currentDir);
                    roundTripBandId = currentBand?.bandId || null;
                    console.log(`[ROUND TRIP START] Time=${currentTime}, Band=${roundTripBandId}`);
                } else {
                    // South leg - reuse the band from the North leg
                    // But get the South direction's segment data for that band
                    const dirBands = bandSummary[currentDir];
                    currentBand = dirBands?.find(b => b.bandId === roundTripBandId) || null;
                    console.log(`[ROUND TRIP SOUTH] Reusing Band=${roundTripBandId} from start time=${roundTripStartTime}`);
                }
            } else {
                // Not a round trip - lookup band normally for each trip
                currentBand = getBandForTime(currentTime, currentDir);
            }

            const bandTargetRoundTrip = getBandTargetTime(currentTime);

            // 1. Get segment times - USE BAND TOTAL as the exact travel time
            // Then distribute proportionally across segments
            const finalSegmentRuntimes: number[] = [];
            let pureTravelTime = 0;
            let usedBandData = true;

            // First, get raw segment times to determine proportions
            const rawSegmentTimes: number[] = [];
            let rawTotal = 0;

            for (let i = 0; i < dirTimepoints.length - 1; i++) {
                const fromStop = dirTimepoints[i];
                const toStop = dirTimepoints[i + 1];

                // Get segment average from band summary
                let segTime = getBandSegmentTime(currentTime, fromStop, toStop, currentDir);

                if (segTime === null) {
                    // Fallback: use raw segment data
                    segTime = getRawSegmentRuntime(dirSegments, fromStop, toStop, currentTime);
                    usedBandData = false;
                }

                rawSegmentTimes.push(segTime);
                rawTotal += segTime;
            }

            // Use the band's avgTotal as the EXACT travel time target
            // avgTotal is the one-way travel time for this band
            const bandTravelTarget = currentBand?.avgTotal || rawTotal;

            // Scale segment times proportionally to match the band target exactly
            if (rawTotal > 0 && currentBand?.avgTotal) {
                const scaleFactor = bandTravelTarget / rawTotal;
                let allocatedTime = 0;

                for (let i = 0; i < rawSegmentTimes.length; i++) {
                    if (i === rawSegmentTimes.length - 1) {
                        // Last segment gets remainder to avoid rounding issues
                        const lastSegTime = Math.round(bandTravelTarget - allocatedTime);
                        finalSegmentRuntimes.push(lastSegTime);
                        allocatedTime += lastSegTime;
                    } else {
                        const scaledTime = Math.round(rawSegmentTimes[i] * scaleFactor);
                        finalSegmentRuntimes.push(scaledTime);
                        allocatedTime += scaledTime;
                    }
                }
                pureTravelTime = Math.round(bandTravelTarget);
            } else {
                // No band data - use raw times
                rawSegmentTimes.forEach(t => {
                    const rounded = Math.round(t);
                    finalSegmentRuntimes.push(rounded);
                    pureTravelTime += rounded;
                });
            }

            console.log(`Trip ${tripSequence} at ${currentTime} mins:`, {
                band: currentBand?.bandId || 'none',
                bandAvgTotal: currentBand?.avgTotal?.toFixed(0) || 'N/A',
                pureTravelTime,
                usedBandData,
                isRoundTrip
            });

            console.log(`  -> pureTravelTime: ${pureTravelTime}, bandTarget: ${bandTargetRoundTrip}`);

            // 3. Cycle & Recovery Calculation (Strict vs Floating)
            let tripCycleAllocated = 0;
            let totalRecovery = 0;
            let nextTripStart = 0;

            if (config.cycleMode === 'Floating') {
                // Floating: Cycle = Travel + (Travel * Ratio)
                // Default ratio 15% if not set
                const ratio = (config.recoveryRatio || 15) / 100;
                totalRecovery = Math.round(pureTravelTime * ratio);
                tripCycleAllocated = pureTravelTime + totalRecovery;
                // Next trip starts after this full cycle
                nextTripStart = currentTime + tripCycleAllocated;
            } else {
                // Strict: Cycle is Fixed. Recovery fills the gap.
                // If Round Trip, allocate half.
                const totalCycle = config.cycleTime;
                const allocated = isRoundTrip ? totalCycle / 2 : totalCycle;
                tripCycleAllocated = allocated;

                totalRecovery = Math.max(0, Math.round(allocated - pureTravelTime));

                // Next trip starts exact cycle time later to maintain clockface
                nextTripStart = currentTime + allocated;
            }


            // 4. Distribute Recovery (End or Proportional)
            const recoveryTimes: Record<string, number> = {};
            const stopPaddings: number[] = new Array(dirTimepoints.length).fill(0);

            if (config.recoveryDistribution === 'Proportional' && totalRecovery > 0) {
                // Distribute proportional to travel time
                let distributedSoFar = 0;
                finalSegmentRuntimes.forEach((st, idx) => {
                    const share = Math.round((st / pureTravelTime) * totalRecovery);
                    stopPaddings[idx + 1] = share;
                    recoveryTimes[dirTimepoints[idx + 1]] = share;
                    distributedSoFar += share;
                });
                // Remainder at end
                const remainder = totalRecovery - distributedSoFar;
                const lastIdx = dirTimepoints.length - 1;
                stopPaddings[lastIdx] += remainder;
                recoveryTimes[dirTimepoints[lastIdx]] = (recoveryTimes[dirTimepoints[lastIdx]] || 0) + remainder;

            } else {
                // "End" mode
                dirTimepoints.forEach((stop, idx) => {
                    if (idx > 0 && idx < dirTimepoints.length - 1) recoveryTimes[stop] = 0;
                });
                recoveryTimes[dirTimepoints[dirTimepoints.length - 1]] = totalRecovery;
                stopPaddings[dirTimepoints.length - 1] = totalRecovery;
            }


            // 5. Construct Trip Object
            const stopTimes: Record<string, string> = {};
            let currentStopMins = currentTime;

            dirTimepoints.forEach((stop, idx) => {
                // Arrival
                // For first stop, arrival = departure (start time)
                // For others, add travel time from prev
                if (idx > 0) {
                    currentStopMins += finalSegmentRuntimes[idx - 1]; // Add travel time
                }

                // We store DEPARTURE times in the generic map usually, 
                // but MasterTrip structure is flexible. 
                // Let's store Arrival/Departure distinct if needed?
                // The MasterTrip usually stores strings relative to columns.
                // Here we just need generic "Time" for the column. 
                // Typically Scheduler uses Departure time for the column unless Arrive/Depart designated.
                // We'll just store the departure time (Arrival + Dwell/Recovery).

                // Actually, recovery is usually added AFTER arrival, before next departure.
                // So "Time" displayed is often Arrival or Departure?
                // ScheduleEditor displays Arr | R | Dep.
                // We populate `stopTimes` with the DEPARTURE time from that stop?
                // Or we separate them?

                // `MasterTrip` has `stopTimes: Record<string, string>`.
                // It usually implies the Departure time.

                const arrivalMins = currentStopMins;
                const recovery = recoveryTimes[stop] || 0;
                const departureMins = arrivalMins + recovery; // Add recovery (which is dwell here)

                stopTimes[stop] = toTimeStr(departureMins);

                // Advance currentStopMins to Departure for next segment calculation base?
                // No, next segment adds to *Departure* of prev stop? 
                // Yes, travel time is Dep -> Arr.
                currentStopMins = departureMins;
            });

            // Create MasterTrip
            const newTrip: MasterTrip = {
                id: `${block.id}-${tripSequence}`,
                blockId: block.id,
                direction: currentDir as 'North' | 'South',
                startTime: currentTime,
                endTime: currentStopMins,
                tripNumber: tripSequence,
                rowId: 0,
                travelTime: pureTravelTime, // Use actual calculated travel time, not cycle-derived
                stops: stopTimes,
                // Add extended data for Editor to parse back properly if needed
                recoveryTime: totalRecovery,
                cycleTime: tripCycleAllocated,
                // Store the assigned band (determined by initial round-trip departure time)
                assignedBand: roundTripBandId || currentBand?.bandId || undefined
            };

            resultTrips[currentDir].push(newTrip);

            // 6. Advance
            currentTime = nextTripStart;
            tripSequence++;

            // Toggle Direction for Round Trip
            if (isRoundTrip) {
                const wasNorth = currentDir === 'North';
                currentDir = wasNorth ? 'South' : 'North';

                // After completing South leg, reset for next round trip
                if (!wasNorth) {
                    // Just finished South, now starting new North - clear the saved band
                    roundTripBandId = null;
                    roundTripStartTime = null;
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
