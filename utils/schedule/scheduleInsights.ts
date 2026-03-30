/**
 * Schedule Insights
 *
 * Detects headway and recovery anomalies for smart suggestion badges.
 * Non-intrusive: information-only indicators on the schedule grid.
 */

export interface ScheduleInsight {
    type: 'headway' | 'recovery';
    severity: 'info' | 'warning';
    message: string;
}

const MIN_HEADWAY_SAMPLE_SIZE = 3;
const MIN_HEADWAY_ABSOLUTE_DEVIATION = 6;
const MIN_HEADWAY_PERCENT_DEVIATION = 0.25;

function getMedian(values: number[]): number | null {
    const valid = values
        .filter(value => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);

    if (valid.length === 0) return null;

    const middle = Math.floor(valid.length / 2);
    if (valid.length % 2 === 1) {
        return valid[middle];
    }

    return Math.round((valid[middle - 1] + valid[middle]) / 2);
}

/**
 * Detect headway anomalies for a displayed round-trip row.
 * Uses the visible row headways rather than raw per-trip sequencing so the
 * warning matches what the planner sees in the table.
 */
export function getHeadwayInsights(
    currentHeadway: number | null | undefined,
    displayedHeadways: number[],
    targetHeadway?: number
): ScheduleInsight | null {
    if (typeof currentHeadway !== 'number' || !Number.isFinite(currentHeadway) || currentHeadway <= 0) {
        return null;
    }

    const hasExplicitTarget = typeof targetHeadway === 'number' && Number.isFinite(targetHeadway) && targetHeadway > 0;
    const reference = hasExplicitTarget
        ? targetHeadway
        : getMedian(displayedHeadways);

    if (!reference || reference <= 0) return null;
    if (!hasExplicitTarget && displayedHeadways.filter(value => Number.isFinite(value) && value > 0).length < MIN_HEADWAY_SAMPLE_SIZE) {
        return null;
    }

    const absoluteDeviation = Math.abs(currentHeadway - reference);
    const percentDeviation = absoluteDeviation / reference;

    if (
        absoluteDeviation < MIN_HEADWAY_ABSOLUTE_DEVIATION
        || percentDeviation < MIN_HEADWAY_PERCENT_DEVIATION
    ) {
        return null;
    }

    const dir = currentHeadway > reference ? 'longer' : 'shorter';
    const referenceLabel = hasExplicitTarget ? `target ${reference}m` : `typical ${reference}m`;

    return {
        type: 'headway',
        severity: 'warning',
        message: `Headway ${currentHeadway}m is ${absoluteDeviation}m ${dir} than ${referenceLabel}`,
    };
}

/**
 * Detect recovery time anomalies for a round-trip row.
 * Flags when recovery is <10% or >25% of travel time.
 */
export function getRecoveryInsights(
    recoveryMins: number,
    travelMins: number
): ScheduleInsight | null {
    if (travelMins <= 0) return null;

    const ratio = recoveryMins / travelMins;

    if (ratio < 0.10) {
        return {
            type: 'recovery',
            severity: 'warning',
            message: `Recovery ${recoveryMins}m is only ${Math.round(ratio * 100)}% of travel time (< 10%)`,
        };
    }

    if (ratio > 0.25) {
        return {
            type: 'recovery',
            severity: 'info',
            message: `Recovery ${recoveryMins}m is ${Math.round(ratio * 100)}% of travel time (> 25%)`,
        };
    }

    return null;
}

/**
 * Get all insights for a round-trip row.
 */
export function getRowInsights(
    currentHeadway: number | null | undefined,
    displayedHeadways: number[],
    totalTravel: number,
    totalRecovery: number,
    targetHeadway?: number
): ScheduleInsight[] {
    const insights: ScheduleInsight[] = [];

    const headwayInsight = getHeadwayInsights(currentHeadway, displayedHeadways, targetHeadway);
    if (headwayInsight) insights.push(headwayInsight);

    // Check recovery ratio
    const recoveryInsight = getRecoveryInsights(totalRecovery, totalTravel);
    if (recoveryInsight) insights.push(recoveryInsight);

    return insights;
}
