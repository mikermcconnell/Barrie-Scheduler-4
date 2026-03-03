
export interface SegmentRawData {
    segmentName: string;
    timeBuckets: Record<string, { p50: number, p80: number, n?: number }>;
}

export type RouteDirection = 'North' | 'South' | 'A' | 'B' | 'Loop';

export interface RuntimeData {
    segments: SegmentRawData[];
    allTimeBuckets: string[];
    detectedRouteNumber?: string;
    detectedDirection?: RouteDirection;
}

export const parseRuntimeCSV = async (file: File): Promise<RuntimeData> => {
    const text = await file.text();
    const rows = text.split('\n').map(r => r.trim()).filter(r => r.length > 0);

    // Check if we have any data
    if (rows.length < 3) throw new Error("Invalid CSV format: Too few rows");

    // We will accumulate segments throughout the file
    const resultSegments: Record<string, SegmentRawData> = {};
    const allTimeBucketsSet = new Set<string>();

    // State machine context
    let currentSegmentName: string | null = null;
    let colToBucketMap: Record<number, string> = {};

    // Helper: Initialize segment if new
    const ensureSegmentInit = (segName: string) => {
        if (!resultSegments[segName]) {
            resultSegments[segName] = {
                segmentName: segName,
                timeBuckets: {}
            };
        }
    };

    // Iterate all rows
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cols = row.split(','); // Simple split
        const rowLabel = cols[0];

        if (rowLabel.startsWith('Title')) {
            // New Block Start. Extract Segment Name.
            // Format: "Title, SegmentName, SegmentName..."
            // Usually the Name is consistent across columns but let's take the first valid one at index 1.
            const segName = cols[1]?.trim();
            if (segName) {
                currentSegmentName = segName;
                ensureSegmentInit(currentSegmentName);
            }
        }

        else if (rowLabel.startsWith('Half-Hour')) {
            // Mapping Columns to Time Buckets
            // Reset map for this block
            colToBucketMap = {};
            for (let c = 1; c < cols.length; c++) {
                const bucket = cols[c]?.trim();
                if (bucket) {
                    colToBucketMap[c] = bucket;
                    allTimeBucketsSet.add(bucket);

                    // Also ensure the current segment has this bucket initialized (if we have a segment context)
                    if (currentSegmentName) {
                        const segData = resultSegments[currentSegmentName];
                        if (!segData.timeBuckets[bucket]) {
                            segData.timeBuckets[bucket] = { p50: 0, p80: 0, n: 1 };
                        }
                    }
                }
            }
        }
        else if (rowLabel.includes('Observed Runtime-50%') || rowLabel.includes('Observed Runtime-80%')) {
            // Data Row
            if (!currentSegmentName) continue; // Skip if orphan

            const isP50 = rowLabel.includes('Observed Runtime-50%');
            const segData = resultSegments[currentSegmentName];

            for (let c = 1; c < cols.length; c++) {
                const val = parseFloat(cols[c]);
                const bucket = colToBucketMap[c];

                if (bucket && !isNaN(val)) {
                    // Initialize bucket if missing (e.g. if Half-Hour row had more cols than initialized?)
                    if (!segData.timeBuckets[bucket]) {
                        segData.timeBuckets[bucket] = { p50: 0, p80: 0, n: 1 };
                    }

                    if (isP50) segData.timeBuckets[bucket].p50 = val;
                    else segData.timeBuckets[bucket].p80 = val;
                }
            }
        }
    }

    // Sort buckets roughly by time (simple alphanumeric works for "06:30" format)
    const allBuckets = Array.from(allTimeBucketsSet).sort();

    // Detect Route Number and Direction from the data rows
    // Examples:
    //   "400 N Observed Runtime-50%" -> route: 400, direction: North
    //   "400 S Observed Runtime-50%" -> route: 400, direction: South
    //   "12A N Observed Runtime-50%" -> route: 12A, direction: North
    //   "12B S Observed Runtime-50%" -> route: 12B, direction: South
    //   "8A Observed Runtime-50%"    -> route: 8, direction: A
    //   "8B Observed Runtime-50%"    -> route: 8, direction: B
    //   "100 Observed Runtime-50%"   -> route: 100, direction: Loop (no letter)
    let detectedRouteNumber: string | undefined;
    let detectedDirection: RouteDirection | undefined;

    for (const row of rows) {
        const firstCol = row.split(',')[0].trim();

        // Pattern 0: Route number with letter suffix, then separate N/S direction
        // e.g., "12A N Observed..." or "12B S Observed..."
        // The letter (A/B) is part of the route number, N/S is the direction.
        const suffixDirPattern = firstCol.match(/^(\d+[A-Za-z])\s+([NS])\s/i);
        if (suffixDirPattern) {
            detectedRouteNumber = suffixDirPattern[1].toUpperCase();
            const dirLetter = suffixDirPattern[2].toUpperCase();
            if (dirLetter === 'N') detectedDirection = 'North';
            else if (dirLetter === 'S') detectedDirection = 'South';
            break;
        }

        // Pattern 1: Route number followed by space and direction letter
        // e.g., "400 N Observed..." or "400 S Observed..."
        const spacePattern = firstCol.match(/^(\d+)\s+([NSAB])\s/i);
        if (spacePattern) {
            detectedRouteNumber = spacePattern[1];
            const dirLetter = spacePattern[2].toUpperCase();
            if (dirLetter === 'N') detectedDirection = 'North';
            else if (dirLetter === 'S') detectedDirection = 'South';
            else if (dirLetter === 'A') detectedDirection = 'A';
            else if (dirLetter === 'B') detectedDirection = 'B';
            break;
        }

        // Pattern 2: Route number with attached direction letter (no space)
        // e.g., "8A Observed..." or "8B Observed..."
        // Only matches when there is NO separate N/S direction after (Pattern 0 handles that)
        const attachedPattern = firstCol.match(/^(\d+)([AB])\s/i);
        if (attachedPattern) {
            detectedRouteNumber = attachedPattern[1];
            const dirLetter = attachedPattern[2].toUpperCase();
            if (dirLetter === 'A') detectedDirection = 'A';
            else if (dirLetter === 'B') detectedDirection = 'B';
            break;
        }

        // Pattern 3: Just route number (no direction = Loop)
        // e.g., "100 Observed Runtime..."
        const plainPattern = firstCol.match(/^(\d+)\s+(?!N\s|S\s|Observed)/i);
        if (plainPattern) {
            detectedRouteNumber = plainPattern[1];
            detectedDirection = 'Loop';
            break;
        }

        // Pattern 4: Fallback - just extract route number
        const fallbackPattern = firstCol.match(/^(\d+)/);
        if (fallbackPattern && !detectedRouteNumber) {
            detectedRouteNumber = fallbackPattern[1];
            // Check if "Observed" follows directly (no direction letter) = Loop
            if (firstCol.match(/^\d+\s+Observed/i)) {
                detectedDirection = 'Loop';
            }
        }
    }

    return {
        segments: Object.values(resultSegments),
        allTimeBuckets: allBuckets,
        detectedRouteNumber,
        detectedDirection
    };
};

/**
 * Extracts ordered timepoint names from segment titles, building a proper chain.
 * For round-trip routes, follows the segment chain to form a complete loop.
 * 
 * Input segments (sorted by direction N→S or A→B):
 * North: "Park Place to Veteran's at Essa"
 * North: "Veteran's at Essa to Rose at Highway 400"
 * North: "Rose at Highway 400 to Georgian at Govenors"
 * North: "Georgian at Govenors to RVH Main Entrance"
 * South: "RVH Main Entrance to Georgian College"
 * South: "Georgian College to Bayfield at Highway 400"
 * South: "Bayfield at Highway 400 to Veteran's at Essa"
 * South: "Veteran's at Essa to Park Place"
 * 
 * Returns: ["Park Place", "Veteran's at Essa", "Rose at Highway 400", 
 *           "Georgian at Govenors", "RVH Main Entrance", "Georgian College",
 *           "Bayfield at Highway 400", "Veteran's at Essa", "Park Place"]
 * 
 * Note: For round-trips, first and last stops will be the same.
 */
export const extractTimepointsFromSegments = (segments: SegmentRawData[]): string[] => {
    if (segments.length === 0) return ['Start', 'End'];

    // 1. Build adjacency list (from -> to)
    const adj = new Map<string, string>();
    const allStops = new Set<string>();
    const incoming = new Set<string>();

    segments.forEach(seg => {
        const parts = seg.segmentName.split(' to ');
        if (parts.length === 2) {
            const from = parts[0].trim();
            const to = parts[1].trim();
            adj.set(from, to);
            allStops.add(from);
            allStops.add(to);
            incoming.add(to);
        }
    });

    if (adj.size === 0) return ['Start', 'End'];

    // 2. Find Start Node
    // Start is a node that is in allStops but NOT in incoming.
    let startNode: string | undefined;
    for (const stop of allStops) {
        if (!incoming.has(stop)) {
            startNode = stop;
            break;
        }
    }

    // Fallback for Loops: If no start node found (circular), use the first segment's 'from'
    // in the original list as the anchor.
    if (!startNode) {
        const parts = segments[0].segmentName.split(' to ');
        if (parts.length > 0) startNode = parts[0].trim();
    }

    if (!startNode) return ['Start', 'End'];

    // 3. Trace the path
    const path: string[] = [startNode];
    const visited = new Set<string>([startNode]);

    let current = startNode;
    // Safety break to prevent infinite loops if something goes wrong
    let iterations = 0;
    const maxIterations = allStops.size + 2;

    while (adj.has(current) && iterations < maxIterations) {
        iterations++;
        const next = adj.get(current)!;

        // Check for closing the loop
        if (visited.has(next)) {
            // If we circled back to start, add it with suffix to avoid key collision
            if (next === startNode) {
                path.push(`${next} (2)`);
            }
            break;
        }

        path.push(next);
        visited.add(next);
        current = next;
    }

    return path;
};
