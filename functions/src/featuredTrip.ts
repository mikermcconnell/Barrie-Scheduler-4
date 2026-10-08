import { FULL_LOAD, inferDayTripLoads, InferredTripLoad } from '../../utils/performanceRouteLoad';
import { DailySummary } from './types';

/** Score weights; they sum to 1. */
const LOAD_WEIGHT = 0.45;
const CROWDING_WEIGHT = 0.2;
const LATENESS_WEIGHT = 0.2;
const VOLUME_WEIGHT = 0.15;
/** Peak loads above this multiple of FULL_LOAD score no higher. */
const LOAD_SCORE_CAP = 1.5;
/** Average lateness (minutes) that earns the full lateness score. */
const LATE_MINUTES_FOR_FULL_SCORE = 10;
/** Trips must pass these checks before they can be featured. */
const MIN_SERVED_STOPS = 5;
const MIN_PEAK_LOAD = 15;
const MAX_CLAMPED_STOPS = 2;
/** Routes featured in this many recent emails are skipped when possible. */
export const FEATURED_ROUTE_COOLDOWN = 7;
/** History entries kept in the performance metadata doc. */
export const FEATURED_HISTORY_LIMIT = 14;

export interface FeaturedTripHistoryEntry {
  serviceDate: string;
  routeId: string;
  direction: string;
  departure: string;
}

export interface FeaturedTrip extends InferredTripLoad {
  /** Stops the bus left at or above FULL_LOAD. */
  fullStops: number;
  /** Average minutes late at timepoints; null when the trip had no OTP record. */
  lateMinutes: number | null;
  score: number;
  scoreParts: { load: number; crowding: number; lateness: number; volume: number };
  /** Short plain-language reason the trip was picked. */
  reason: string;
}

function pickReason(parts: FeaturedTrip['scoreParts']): string {
  if (parts.crowding > 0 && parts.lateness >= 0.5) return 'Full bus running late';
  if (parts.crowding > 0) return 'Full bus';
  if (parts.lateness >= 0.5) return 'Busy and running late';
  return 'Busiest trip';
}

/**
 * Picks one notable trip from the latest service day: busy, crowded, late and
 * high-volume trips score highest. Routes in `recentRouteIds` are skipped
 * unless no other route has a qualifying trip.
 */
export function selectFeaturedTrip(day: DailySummary, recentRouteIds: string[] = []): FeaturedTrip | null {
  const lateByTripId = new Map(
    (day.byTrip ?? []).map(trip => [trip.tripId, trip.otp.total > 0 ? trip.otp.avgDeviationSeconds / 60 : null]),
  );

  const candidates = inferDayTripLoads(day).filter(trip =>
    trip.stops.length >= MIN_SERVED_STOPS
    && trip.peakLoad >= MIN_PEAK_LOAD
    && trip.clampedStops <= MAX_CLAMPED_STOPS);
  if (candidates.length === 0) return null;

  const maxBoardings = Math.max(...candidates.map(trip => trip.boardings));
  const scored = candidates.map((trip): FeaturedTrip => {
    const fullStops = trip.stops.filter(stop => stop.load >= FULL_LOAD).length;
    const lateMinutes = trip.tripId ? lateByTripId.get(trip.tripId) ?? null : null;
    const scoreParts = {
      load: Math.min(trip.peakLoad / FULL_LOAD, LOAD_SCORE_CAP) / LOAD_SCORE_CAP,
      crowding: fullStops / trip.stops.length,
      lateness: lateMinutes === null ? 0 : Math.min(Math.max(lateMinutes, 0) / LATE_MINUTES_FOR_FULL_SCORE, 1),
      volume: maxBoardings > 0 ? trip.boardings / maxBoardings : 0,
    };
    return {
      ...trip,
      fullStops,
      lateMinutes,
      score: scoreParts.load * LOAD_WEIGHT
        + scoreParts.crowding * CROWDING_WEIGHT
        + scoreParts.lateness * LATENESS_WEIGHT
        + scoreParts.volume * VOLUME_WEIGHT,
      scoreParts,
      reason: pickReason(scoreParts),
    };
  });

  const recent = new Set(recentRouteIds);
  const fresh = scored.filter(trip => !recent.has(trip.routeId));
  const pool = fresh.length > 0 ? fresh : scored;
  return pool.reduce((best, trip) => (trip.score > best.score ? trip : best));
}

export function recentFeaturedRouteIds(history: FeaturedTripHistoryEntry[]): string[] {
  return history.slice(-FEATURED_ROUTE_COOLDOWN).map(entry => entry.routeId);
}

export function appendFeaturedTripHistory(
  history: FeaturedTripHistoryEntry[],
  serviceDate: string,
  trip: FeaturedTrip,
): FeaturedTripHistoryEntry[] {
  return [
    ...history.filter(entry => entry.serviceDate !== serviceDate),
    { serviceDate, routeId: trip.routeId, direction: trip.direction, departure: trip.departure },
  ].slice(-FEATURED_HISTORY_LIMIT);
}

export function parseFeaturedTripHistory(value: unknown): FeaturedTripHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is FeaturedTripHistoryEntry =>
    !!entry
    && typeof entry.serviceDate === 'string'
    && typeof entry.routeId === 'string'
    && typeof entry.direction === 'string'
    && typeof entry.departure === 'string');
}
