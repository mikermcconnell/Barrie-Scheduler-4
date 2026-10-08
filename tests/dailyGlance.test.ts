import { describe, expect, it } from 'vitest';
import { buildGlance, findLatePattern, type GlanceInput, type RouteHistoryDay } from '../functions/src/dailyGlance';
import type { DailySummary, DayType, RouteMetrics, TripMetrics } from '../functions/src/types';

const LATEST = '2026-10-07';

function otp(onTimePercent: number, total = 100) {
  return {
    total,
    onTime: Math.round((total * onTimePercent) / 100),
    early: 0,
    late: total - Math.round((total * onTimePercent) / 100),
    onTimePercent,
    earlyPercent: 0,
    latePercent: 100 - onTimePercent,
    avgDeviationSeconds: 0,
  };
}

function route(routeId: string, onTime: number, extra: Partial<RouteMetrics> = {}): RouteMetrics {
  return {
    routeId,
    routeName: `Route ${routeId}`,
    otp: otp(onTime),
    ridership: 500,
    alightings: 500,
    apcStatus: 'ok',
    tripCount: 40,
    serviceHours: 20,
    avgLoad: 10,
    maxLoad: 30,
    avgDeviationSeconds: 0,
    wheelchairTrips: 0,
    ...extra,
  };
}

function day(date: string, params: { dayType?: DayType; otp?: number; riders?: number; routes?: RouteMetrics[]; missed?: DailySummary['missedTrips'] } = {}): DailySummary {
  return {
    date,
    dayType: params.dayType ?? 'weekday',
    system: { otp: otp(params.otp ?? 89), totalRidership: params.riders ?? 8400, tripCount: 580 },
    byRoute: params.routes ?? [route('A', 94), route('B', 90)],
    missedTrips: params.missed,
  } as unknown as DailySummary;
}

/** The `count` weekdays before LATEST, newest first. */
function priorWeekdays(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${LATEST}T12:00:00Z`);
  while (dates.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function trip(routeId: string, direction: string, departure: string, late: boolean): TripMetrics {
  return {
    tripId: `${routeId}-${direction}-${departure}`,
    tripName: '',
    block: '',
    routeId,
    routeName: `Route ${routeId}`,
    direction,
    terminalDepartureTime: departure,
    otp: { ...otp(late ? 50 : 100, 4), late: late ? 2 : 0 },
    boardings: 10,
    maxLoad: 10,
  };
}

function input(latestDay: DailySummary, history: DailySummary[], extra: Partial<GlanceInput> = {}): GlanceInput {
  const all = [...history, latestDay];
  return {
    latestDay,
    systemHistory: all,
    routeHistory: all.map((d): RouteHistoryDay => ({ date: d.date, dayType: d.dayType, byRoute: d.byRoute })),
    latestTrips: [],
    lastMissedTripDataDate: LATEST,
    ...extra,
  };
}

const normalHistory = () => priorWeekdays(20).map(date => day(date));

describe('buildGlance', () => {
  it('reads a normal day as normal, with no actions', () => {
    const glance = buildGlance(input(day(LATEST), normalHistory()));

    expect(glance.status).toBe('STABLE');
    expect(glance.headline).toBe('A normal weekday. No route ran well below its usual.');
    expect(glance.comparisons.map(row => row.verdict)).toEqual(['normal', 'normal']);
    expect(glance.standouts).toEqual([]);
    expect(glance.actions).toEqual([]);
  });

  it('flags a busy day and a route well below its own usual, with its late-trip window', () => {
    const latestTrips = [
      trip('A', 'N', '09:20', true),
      trip('A', 'S', '12:50', true),
      trip('A', 'N', '13:20', true),
      trip('A', 'S', '13:50', true),
      trip('A', 'N', '14:20', true),
      trip('A', 'S', '15:20', true),
      trip('A', 'N', '16:00', false),
      trip('A', 'S', '17:00', false),
    ];
    const glance = buildGlance(input(
      day(LATEST, { riders: 9100, routes: [route('A', 86), route('B', 90)] }),
      normalHistory(),
      { latestTrips },
    ));

    expect(glance.status).toBe('REVIEW');
    expect(glance.headline).toBe('A busy weekday with normal on-time. Route A ran well below its usual.');
    expect(glance.comparisons[1].verdict).toBe('▲ 8% · busiest weekday in 4 weeks');
    expect(glance.standouts.map(s => s.routeId)).toEqual(['A']);
    expect(glance.standouts[0].sentence).toBe('on-time 86.0%, usually 94.0%.');
    expect(glance.standouts[0].latePattern).toBe('Late trips mostly 12:50–15:20.');
    expect(glance.actions[0]).toMatchObject({
      title: 'Route A late trips',
      detail: '6 of 8 trips late, 5 of them 12:50–15:20.',
      severity: 'medium',
    });
  });

  it('ranks a busy or quiet day against the same day type, in weeks', () => {
    const history = priorWeekdays(20).map((date, i) => day(date, { riders: i < 4 ? 9500 : 8400 }));
    const busy = buildGlance(input(day(LATEST, { riders: 9100 }), history));
    expect(busy.comparisons[1].verdict).toBe('▲ 8% · 5th busiest weekday in 4 weeks');

    const quiet = buildGlance(input(day(LATEST, { riders: 7500 }), normalHistory()));
    expect(quiet.comparisons[1].verdict).toBe('▼ 11% · quietest weekday in 4 weeks');
  });

  it('counts how many days in a row a route has stood out and raises severity', () => {
    const history = priorWeekdays(20).map((date, i) => day(date, { routes: [route('A', i < 2 ? 85 : 94), route('B', 90)] }));
    const glance = buildGlance(input(day(LATEST, { routes: [route('A', 86), route('B', 90)] }), history));

    expect(glance.standouts[0].daysInRow).toBe(3);
    expect(glance.actions[0].detail).toContain('3rd weekday in a row.');
    expect(glance.actions[0].severity).toBe('high');
  });

  it('ignores routes with too few on-time readings', () => {
    const glance = buildGlance(input(
      day(LATEST, { routes: [route('A', 60, { otp: otp(60, 10) }), route('B', 90)] }),
      normalHistory(),
    ));
    expect(glance.standouts).toEqual([]);
  });

  it('splits APC flags into chronic counts and new flags', () => {
    const history = priorWeekdays(20).map(date => day(date, {
      routes: [route('A', 94, { apcStatus: 'suspect' }), route('B', 90), route('C', 90)],
    }));
    const glance = buildGlance(input(
      day(LATEST, { routes: [route('A', 94, { apcStatus: 'suspect' }), route('B', 90), route('C', 90, { apcStatus: 'review', apcDiscrepancyPct: 31 })] }),
      history,
    ));

    expect(glance.ongoing[0]).toEqual({ text: 'APC counts flagged in the last 60 days: A on 21 days', newRoutes: ['C'] });
    expect(glance.actions).toContainEqual(expect.objectContaining({ title: 'Route C APC counts', severity: 'low' }));
    expect(glance.actions.some(action => action.title === 'Route A APC counts')).toBe(false);
  });

  it('moves a route that is routinely lowest into ongoing instead of a standout', () => {
    const history = priorWeekdays(20).map(date => day(date, { routes: [route('A', 94), route('B', 90), route('12A', 80)] }));
    const glance = buildGlance(input(day(LATEST, { routes: [route('A', 94), route('B', 90), route('12A', 78)] }), history));

    expect(glance.standouts).toEqual([]);
    expect(glance.ongoing).toContainEqual({ text: 'Route 12A lowest (78.0%). Normal for 12A: lowest on 20 of the last 20 weekdays.' });
  });

  it('reports a missed-trip data gap as ongoing and, once long, as an action', () => {
    const glance = buildGlance(input(day(LATEST), normalHistory(), { lastMissedTripDataDate: '2026-08-29' }));

    expect(glance.ongoing).toContainEqual({ text: 'Missed-trip data: none received since Aug 29.' });
    expect(glance.actions).toContainEqual(expect.objectContaining({
      title: 'Missed-trip feed',
      detail: 'No missed-trip data since Aug 29 (39 days). Check the export.',
    }));
  });

  it('turns missed trips into a ranked action', () => {
    const glance = buildGlance(input(
      day(LATEST, { missed: { totalScheduled: 590, totalMatched: 578, totalMissed: 12, missedPct: 2.03, notPerformedCount: 12, lateOver15Count: 0, byRoute: [{ routeId: '8A', count: 7, earliestDep: '06:00' }, { routeId: '2B', count: 5, earliestDep: '07:00' }] } }),
      normalHistory(),
    ));
    expect(glance.actions[0]).toMatchObject({ title: '12 missed trips', detail: '2.0% of scheduled trips, on Routes 8A, 2B.', severity: 'high' });
  });

  it('adds an operator dwell action when dwell is elevated', () => {
    const glance = buildGlance(input(day(LATEST), normalHistory(), {
      dwell: { per100: 121, usualPer100: 74, elevated: true, topRouteId: '8A', topRouteHours: 1.94 },
    }));
    expect(glance.status).toBe('REVIEW');
    expect(glance.actions).toContainEqual(expect.objectContaining({
      title: 'Operator dwell high',
      detail: '121 min / 100 trips, usual 74. Most on Route 8A (1.9 hrs).',
    }));
  });

  it('skips comparisons when the day type has too little history', () => {
    const saturdays = ['2026-09-26', '2026-09-19'].map(date => day(date, { dayType: 'saturday' }));
    const glance = buildGlance(input(day('2026-10-03', { dayType: 'saturday', otp: 93, riders: 5754 }), saturdays));

    expect(glance.comparisons).toEqual([]);
    expect(glance.headline).toBe('On-time 93.0% with 5,754 riders. No route ran well below its usual.');
  });

  it('marks a big system on-time drop as needing attention', () => {
    const glance = buildGlance(input(day(LATEST, { otp: 82 }), normalHistory()));
    expect(glance.status).toBe('NEEDS ATTENTION');
    expect(glance.headline).toBe('Normal ridership for a weekday, with on-time below usual. No route ran well below its usual.');
    expect(glance.comparisons[0]).toMatchObject({ verdict: '▼ 7.0 pts', tone: 'bad' });
  });
});

describe('findLatePattern', () => {
  it('names a direction only when the route runs both ways and late trips lean one way', () => {
    const twoWay = [
      trip('A', 'N', '07:00', true), trip('A', 'N', '11:00', true), trip('A', 'N', '16:00', true), trip('A', 'N', '20:00', true),
      trip('A', 'S', '08:00', false), trip('A', 'S', '12:00', false),
    ];
    expect(findLatePattern(twoWay)).toMatchObject({ direction: 'northbound', window: null, lateTrips: 4, trips: 6 });

    const oneWay = ['06:30', '09:08', '10:28', '15:16', '18:40'].map(dep => trip('15A', 'W', dep, true));
    expect(findLatePattern(oneWay).direction).toBeNull();
  });

  it('says "all" when every late trip falls in the window', () => {
    const trips = ['07:05', '07:27', '07:50', '08:12', '09:20', '10:05'].map(dep => trip('101', 'CCW', dep, true));
    expect(findLatePattern(trips).window).toEqual({ from: '07:05', to: '10:05', count: 6 });
  });

  it('needs at least three late trips to describe a pattern', () => {
    expect(findLatePattern([trip('A', 'N', '07:00', true), trip('A', 'N', '07:30', true)]).window).toBeNull();
  });
});
