import { describe, expect, it } from 'vitest';
import {
  appendFeaturedTripHistory,
  FEATURED_HISTORY_LIMIT,
  parseFeaturedTripHistory,
  recentFeaturedRouteIds,
  selectFeaturedTrip,
} from '../functions/src/featuredTrip';
import { buildReportHtml } from '../functions/src/reportHtml';
import type { DailySummary, RouteRidershipHeatmap, TripMetrics } from '../functions/src/types';
import { FULL_LOAD } from '../utils/performanceRouteLoad';

type Cell = [number, number] | null;

const STOPS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** One route-direction heatmap; each trip lists one cell per stop. */
function heatmap(routeId: string, trips: Cell[][]): RouteRidershipHeatmap {
  return {
    routeId,
    routeName: `Route ${routeId}`,
    direction: 'N',
    trips: trips.map((_, index) => ({
      tripId: `${routeId}-T${index}`,
      terminalDepartureTime: `${String(7 + index).padStart(2, '0')}:15`,
      tripName: `Trip ${index}`,
      block: `${routeId}-B${index}`,
      direction: 'North',
    })),
    stops: STOPS.map((stopId, index) => ({ stopId, stopName: `Stop ${stopId}`, routeStopIndex: index, isTimepoint: index % 2 === 0 })),
    cells: STOPS.map((_, stopIndex) => trips.map(trip => trip[stopIndex])),
  };
}

/** A trip that boards `riders` over the first two stops and drops them over the last two. */
function tripCarrying(riders: number): Cell[] {
  const half = Math.round(riders / 2);
  return [[half, 0], [riders - half, 0], [0, 0], [0, 0], [0, half], [0, riders - half]];
}

function tripMetrics(tripId: string, routeId: string, lateSeconds: number): TripMetrics {
  return {
    tripId,
    tripName: tripId,
    block: '',
    routeId,
    routeName: `Route ${routeId}`,
    direction: 'North',
    terminalDepartureTime: '07:15',
    otp: {
      total: 4,
      onTime: 4,
      early: 0,
      late: 0,
      onTimePercent: 100,
      earlyPercent: 0,
      latePercent: 0,
      avgDeviationSeconds: lateSeconds,
    },
    boardings: 0,
    maxLoad: 0,
  };
}

function day(heatmaps: RouteRidershipHeatmap[], byTrip: TripMetrics[] = []): DailySummary {
  return { date: '2026-10-06', byTrip, ridershipHeatmaps: heatmaps } as unknown as DailySummary;
}

describe('selectFeaturedTrip', () => {
  it('picks the busiest trip and reports where it peaked', () => {
    const trip = selectFeaturedTrip(day([
      heatmap('2', [tripCarrying(30)]),
      heatmap('8A', [tripCarrying(20), tripCarrying(60)]),
    ]))!;

    expect(trip.routeId).toBe('8A');
    expect(trip.departure).toBe('08:15');
    expect(trip.peakLoad).toBe(60);
    expect(trip.peakStopName).toBe('Stop B');
    expect(trip.fullStops).toBe(3);
    expect(trip.reason).toBe('Full bus');
  });

  it('lets lateness lift a trip above a slightly busier on-time one', () => {
    const trip = selectFeaturedTrip(day(
      [heatmap('2', [tripCarrying(40)]), heatmap('5', [tripCarrying(36)])],
      [tripMetrics('5-T0', '5', 12 * 60)],
    ))!;

    expect(trip.routeId).toBe('5');
    expect(trip.lateMinutes).toBe(12);
    expect(trip.reason).toBe('Busy and running late');
  });

  it('skips recently featured routes unless nothing else qualifies', () => {
    const summary = day([heatmap('2', [tripCarrying(60)]), heatmap('5', [tripCarrying(25)])]);

    expect(selectFeaturedTrip(summary, ['2'])!.routeId).toBe('5');
    expect(selectFeaturedTrip(summary, ['2', '5'])!.routeId).toBe('2');
  });

  it('ignores near-empty and short trips, and returns null without load data', () => {
    const shortTrip: Cell[] = [[20, 0], [0, 20], null, null, null, null];

    expect(selectFeaturedTrip(day([heatmap('2', [tripCarrying(8), shortTrip])]))).toBeNull();
    expect(selectFeaturedTrip(day([]))).toBeNull();
  });
});

describe('featured trip history', () => {
  it('keeps one entry per service date, trimmed to the limit, and reads recent routes', () => {
    const trip = selectFeaturedTrip(day([heatmap('2', [tripCarrying(40)])]))!;
    let history = parseFeaturedTripHistory([{ serviceDate: 'bad' }, null]);
    for (let index = 0; index < FEATURED_HISTORY_LIMIT + 3; index++) {
      history = appendFeaturedTripHistory(history, `2026-09-${String(index + 1).padStart(2, '0')}`, trip);
    }
    history = appendFeaturedTripHistory(history, history.at(-1)!.serviceDate, trip);

    expect(history).toHaveLength(FEATURED_HISTORY_LIMIT);
    expect(recentFeaturedRouteIds(history)).toEqual(Array(7).fill('2'));
  });
});

describe('buildReportHtml Trip of the Day', () => {
  const base = {
    date: '2026-10-06',
    dayType: 'weekday',
    system: {
      otp: { total: 1, onTime: 1, early: 0, late: 0, onTimePercent: 100, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 },
      totalRidership: 100,
      totalBoardings: 100,
      totalAlightings: 100,
      vehicleCount: 1,
      tripCount: 1,
      wheelchairTrips: 0,
      avgSystemLoad: 1,
      peakLoad: 1,
    },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfiles: [],
    dataQuality: { totalRecords: 1, inBetweenFiltered: 0, missingAVL: 0, missingAPC: 0, detourRecords: 0, tripperRecords: 0, loadCapped: 0, apcExcludedFromLoad: 0 },
    schemaVersion: 8,
  } as unknown as DailySummary;

  it('renders a plain-language card with a load line and major stops above operator dwell', () => {
    const featuredTrip = selectFeaturedTrip(day([heatmap('8A', [tripCarrying(60)])]));
    const html = buildReportHtml({ latestDay: base, trendDays: [base], teamName: 'Barrie Transit', featuredTrip });

    expect(html).toContain('Trip of the Day');
    expect(html).toContain('Route 8A northbound · 7:15 AM departure');
    expect(html).toContain('Up to <strong>60 people</strong>');
    expect(html).toContain(`full</strong> (${FULL_LOAD}+ riders) for 3 stops`);
    expect(html.match(/title="Stop [A-F]: \d+ on board"/g)).toHaveLength(STOPS.length);
    expect(html).toContain('Load (people on board)');
    expect(html).not.toContain('Room to spare');
    // Ends, peak and major stops are named under the load line, not just start and end.
    expect(html.match(/<td colspan="\d+" title="Stop [A-F]"/g)?.length).toBeGreaterThan(2);

    const majorStops = html.slice(html.indexOf('Major stops (more than 3 on or off)'));
    expect(majorStops).toContain('Stop A');
    expect(majorStops).toContain('Stop F');
    expect(majorStops).not.toContain('Stop C');
    expect(majorStops).not.toContain('Stop D');
    expect(html.indexOf('Trip of the Day')).toBeLessThan(html.indexOf('<!-- ═══ 8. OPERATOR DWELL BY STOP ═══ -->'));
  });

  it('omits the section when no trip was picked', () => {
    const html = buildReportHtml({ latestDay: base, trendDays: [base], teamName: 'Barrie Transit', featuredTrip: null });

    expect(html).not.toContain('Trip of the Day');
  });
});
