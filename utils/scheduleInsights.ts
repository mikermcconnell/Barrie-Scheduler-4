/**
 * Schedule Insights
 *
 * Detects headway and recovery anomalies for smart suggestion badges.
 * Non-intrusive: information-only indicators on the schedule grid.
 */

import type { MasterTrip } from './masterScheduleParser';
import { analyzeHeadways, calculateHeadways } from './scheduleEditorUtils';

export interface ScheduleInsight {
    type: 'headway' | 'recovery';
    severity: 'info' | 'warning';
    message: string;
}

/**
 * Detect headway anomalies for a trip.
 * Flags trips where headway deviates >50% from the average headway.
 */
export function getHeadwayInsights(
    trip: MasterTrip,
    allTrips: MasterTrip[],
    targetHeadway?: number
): ScheduleInsight | null {
    if (allTrips.length < 3) return null;

    const headways = calculateHeadways(allTrips);
    const tripHeadway = headways[trip.id];
    if (typeof tripHeadway !== 'number') return null;

    const { avg } = analyzeHeadways(allTrips);
    const reference = targetHeadway || avg;
    if (!reference || reference === 0) return null;

    const deviation = Math.abs(tripHeadway - reference) / reference;
    if (deviation > 0.5) {
        const dir = tripHeadway > reference ? 'longer' : 'shorter';
        return {
            type: 'headway',
            severity: 'warning',
            message: `Headway ${tripHeadway}m is ${Math.round(deviation * 100)}% ${dir} than avg ${reference}m`,
        };
    }

    return null;
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
    trips: MasterTrip[],
    allTrips: MasterTrip[],
    totalTravel: number,
    totalRecovery: number,
    targetHeadway?: number
): ScheduleInsight[] {
    const insights: ScheduleInsight[] = [];

    // Check headway for the first trip in the row
    const primaryTrip = trips[0];
    if (primaryTrip) {
        const headwayInsight = getHeadwayInsights(primaryTrip, allTrips, targetHeadway);
        if (headwayInsight) insights.push(headwayInsight);
    }

    // Check recovery ratio
    const recoveryInsight = getRecoveryInsights(totalRecovery, totalTravel);
    if (recoveryInsight) insights.push(recoveryInsight);

    return insights;
}
