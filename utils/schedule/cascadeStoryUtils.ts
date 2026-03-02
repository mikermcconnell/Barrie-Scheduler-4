import type { CascadeAffectedTrip } from '../performanceDataTypes';

export interface TimelinePoint {
  index: number;
  stopName: string;
  stopId: string;
  scheduledDeparture: string;
  observedDeparture: string | null;
  deviationMinutes: number | null;
  isLate: boolean;
  tripIndex: number;
  tripName: string;
  isTripStart: boolean;
}

/**
 * Flatten all trips' timepoints into a sequential array of chart-ready points.
 */
export function buildTimelinePoints(trips: CascadeAffectedTrip[]): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  let idx = 0;
  for (let ti = 0; ti < trips.length; ti++) {
    const trip = trips[ti];
    for (let si = 0; si < trip.timepoints.length; si++) {
      const tp = trip.timepoints[si];
      points.push({
        index: idx++,
        stopName: tp.stopName,
        stopId: tp.stopId,
        scheduledDeparture: tp.scheduledDeparture,
        observedDeparture: tp.observedDeparture,
        deviationMinutes: tp.deviationSeconds != null ? tp.deviationSeconds / 60 : null,
        isLate: tp.isLate,
        tripIndex: ti,
        tripName: trip.tripName,
        isTripStart: si === 0,
      });
    }
  }
  return points;
}

export type TripNodeColor = 'red' | 'amber' | 'green';

/**
 * Determine trip node color based on how many timepoints were late.
 */
export function getTripNodeColor(trip: CascadeAffectedTrip): TripNodeColor {
  if (trip.lateTimepointCount === 0) return 'green';
  if (trip.lateTimepointCount >= trip.timepoints.length) return 'red';
  return 'amber';
}
