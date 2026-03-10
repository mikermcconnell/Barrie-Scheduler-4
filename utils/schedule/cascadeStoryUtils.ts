import type { CascadeAffectedTrip, DailySummary } from '../performanceDataTypes';

// ─── Stop Load Lookup (aggregated APC data for customer impact) ──────

export interface StopLoadData {
  avgBoardings: number;
  avgAlightings: number;
  avgLoad: number;
  dayCount: number;
}

/**
 * Aggregate load profile data across multiple daily summaries.
 * Returns Map keyed by `${routeId}_${stopId}` with averaged load data.
 * Returns empty map if fewer than `minDays` unique days are present.
 */
export function buildStopLoadLookup(
  dailySummaries: DailySummary[],
  minDays: number = 14,
): Map<string, StopLoadData> {
  const uniqueDates = new Set(dailySummaries.map(d => d.date));
  if (uniqueDates.size < minDays) return new Map();

  const acc = new Map<string, { boardings: number; alightings: number; load: number; days: number }>();

  for (const day of dailySummaries) {
    if (!day.loadProfiles) continue;
    for (const profile of day.loadProfiles) {
      for (const stop of profile.stops) {
        const key = `${profile.routeId}_${stop.stopId}`;
        const existing = acc.get(key);
        if (existing) {
          existing.boardings += stop.avgBoardings;
          existing.alightings += stop.avgAlightings;
          existing.load += stop.avgLoad;
          existing.days += 1;
        } else {
          acc.set(key, {
            boardings: stop.avgBoardings,
            alightings: stop.avgAlightings,
            load: stop.avgLoad,
            days: 1,
          });
        }
      }
    }
  }

  const result = new Map<string, StopLoadData>();
  for (const [key, val] of acc) {
    result.set(key, {
      avgBoardings: val.boardings / val.days,
      avgAlightings: val.alightings / val.days,
      avgLoad: val.load / val.days,
      dayCount: val.days,
    });
  }
  return result;
}

// ─── Timeline + Trip Segment Utils ──────────────────────────────────

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
  if (trip.affectedTimepointCount === 0) return 'green';
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
