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

/** Fill and stroke colors per trip severity, matching CascadeTripChain colorMap. */
export const TRIP_FILL_COLORS: Record<TripNodeColor, { fill: string; stroke: string }> = {
  red:   { fill: '#fecaca', stroke: '#ef4444' },
  amber: { fill: '#fef3c7', stroke: '#f59e0b' },
  green: { fill: '#d1fae5', stroke: '#10b981' },
};

export interface TripSegment {
  tripIndex: number;
  tripName: string;
  color: TripNodeColor;
  startPointIndex: number;
  endPointIndex: number;
  lateCount: number;
  totalCount: number;
}

/**
 * Build segment ranges from the flat TimelinePoint[] array, one per trip.
 */
export function buildTripSegments(
  trips: CascadeAffectedTrip[],
  points: TimelinePoint[],
): TripSegment[] {
  const segments: TripSegment[] = [];
  for (let ti = 0; ti < trips.length; ti++) {
    const trip = trips[ti];
    const tripPoints = points.filter(p => p.tripIndex === ti);
    if (tripPoints.length === 0) continue;
    segments.push({
      tripIndex: ti,
      tripName: trip.tripName,
      color: getTripNodeColor(trip),
      startPointIndex: tripPoints[0].index,
      endPointIndex: tripPoints[tripPoints.length - 1].index,
      lateCount: trip.lateTimepointCount,
      totalCount: trip.timepoints.length,
    });
  }
  return segments;
}
