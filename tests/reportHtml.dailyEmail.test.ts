import { describe, expect, it } from 'vitest';
import { buildReportHtml } from '../functions/src/reportHtml';
import type {
  DailySummary,
  DwellIncident,
  DwellSeverity,
  HourMetrics,
  OTPBreakdown,
  RouteMetrics,
  StopMetrics,
  SystemMetrics,
} from '../functions/src/types';

function makeOtp(overrides: Partial<OTPBreakdown> = {}): OTPBreakdown {
  return {
    total: 10,
    onTime: 8,
    early: 1,
    late: 1,
    onTimePercent: 80,
    earlyPercent: 10,
    latePercent: 10,
    avgDeviationSeconds: 60,
    ...overrides,
  };
}

function makeSystem(overrides: Partial<SystemMetrics> = {}): SystemMetrics {
  return {
    otp: makeOtp({ onTimePercent: 86, earlyPercent: 6, latePercent: 8 }),
    totalRidership: 180,
    totalBoardings: 180,
    totalAlightings: 170,
    vehicleCount: 8,
    tripCount: 20,
    wheelchairTrips: 1,
    avgSystemLoad: 18,
    peakLoad: 32,
    ...overrides,
  };
}

function makeRoute(routeId: string, routeName: string, overrides: Partial<RouteMetrics> = {}): RouteMetrics {
  return {
    routeId,
    routeName,
    otp: makeOtp({ onTimePercent: 84, earlyPercent: 7, latePercent: 9 }),
    ridership: 100,
    alightings: 95,
    tripCount: 8,
    serviceHours: 5,
    avgLoad: 20,
    maxLoad: 35,
    avgDeviationSeconds: 90,
    wheelchairTrips: 1,
    ...overrides,
  };
}

function makeHour(hour: number, boardings: number, overrides: Partial<HourMetrics> = {}): HourMetrics {
  return {
    hour,
    otp: makeOtp({ total: 4, onTimePercent: 82, earlyPercent: 8, latePercent: 10 }),
    boardings,
    alightings: Math.max(0, boardings - 5),
    avgLoad: 16,
    ...overrides,
  };
}

function makeStop(overrides: Partial<StopMetrics> = {}): StopMetrics {
  return {
    stopName: 'Test Stop',
    stopId: '100',
    lat: 44.38,
    lon: -79.69,
    isTimepoint: true,
    otp: makeOtp({ total: 10, onTimePercent: 80, earlyPercent: 10, latePercent: 10 }),
    boardings: 0,
    alightings: 0,
    avgLoad: 0,
    routeCount: 1,
    routes: ['1'],
    ...overrides,
  };
}

function makeIncident(params: {
  date: string;
  routeId?: string;
  routeName?: string;
  observedDepartureTime?: string;
  stopName?: string;
  stopId?: string;
  tripName?: string;
  block?: string;
  trackedDwellSeconds: number;
  severity: DwellSeverity;
}): DwellIncident {
  return {
    operatorId: 'op-1',
    date: params.date,
    routeId: params.routeId ?? '2',
    routeName: params.routeName ?? 'Route 2',
    stopName: params.stopName ?? 'Downtown',
    stopId: params.stopId ?? '1',
    tripName: params.tripName ?? 'Trip 1',
    block: params.block ?? 'block-1',
    observedArrivalTime: '07:00:00',
    observedDepartureTime: params.observedDepartureTime ?? '07:15:00',
    rawDwellSeconds: params.trackedDwellSeconds,
    trackedDwellSeconds: params.trackedDwellSeconds,
    severity: params.severity,
  };
}

function makeSummary(params: {
  date: string;
  totalRidership?: number;
  routes?: RouteMetrics[];
  hours?: HourMetrics[];
  incidents?: DwellIncident[];
  dayType?: DailySummary['dayType'];
  stops?: StopMetrics[];
}): DailySummary {
  const incidents = params.incidents ?? [];
  const moderateCount = incidents.filter((incident) => incident.severity === 'moderate').length;
  const highCount = incidents.filter((incident) => incident.severity === 'high').length;

  return {
    date: params.date,
    dayType: params.dayType ?? 'weekday',
    system: makeSystem({ totalRidership: params.totalRidership ?? 180, totalBoardings: params.totalRidership ?? 180 }),
    byRoute: params.routes ?? [
      makeRoute('2', 'Route 2', { ridership: 110, alightings: 102, serviceHours: 5.5 }),
      makeRoute('5', 'Route 5', { ridership: 70, alightings: 68, serviceHours: 4.5, otp: makeOtp({ onTimePercent: 88, earlyPercent: 5, latePercent: 7 }) }),
    ],
    byHour: params.hours ?? [
      makeHour(7, 90),
      makeHour(8, 60),
    ],
    byStop: params.stops ?? [],
    byTrip: [],
    loadProfiles: [],
    byOperatorDwell: {
      incidents,
      byOperator: [{
        operatorId: 'op-1',
        moderateCount,
        highCount,
        totalIncidents: incidents.length,
        totalTrackedDwellSeconds: incidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0),
        avgTrackedDwellSeconds: incidents.length > 0
          ? incidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0) / incidents.length
          : 0,
      }],
      totalIncidents: moderateCount + highCount,
      totalTrackedDwellMinutes: incidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0) / 60,
      totalReportableDwellMinutes: incidents
        .filter((incident) => incident.severity === 'moderate' || incident.severity === 'high')
        .reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0) / 60,
    },
    dataQuality: {
      totalRecords: 100,
      inBetweenFiltered: 0,
      missingAVL: 0,
      missingAPC: 0,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 8,
  };
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function between(html: string, startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  return html.slice(start, end >= 0 ? end : undefined);
}

function rowForText(sectionHtml: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sectionHtml.match(new RegExp(`<tr[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/tr>`));
  return match?.[0] ?? '';
}

describe('buildReportHtml route scorecard OTP detail', () => {
  it('keeps OTP in one column and stacks early/late percentages below on-time performance', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      routes: [
        makeRoute('2', 'Route 2', {
          otp: makeOtp({
            total: 50,
            onTimePercent: 82.2,
            earlyPercent: 4.4,
            latePercent: 13.4,
          }),
        }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const routeSection = between(html, 'Route Scorecard', 'Boardings by Hour');
    const routeRow = rowForText(routeSection, 'Route 2');

    expect(routeSection).toContain('OTP shows on-time % with early/late % below');
    expect(routeSection).not.toMatch(/<th[^>]*>Early/i);
    expect(routeSection).not.toMatch(/<th[^>]*>Late/i);
    expect(routeRow).toContain('82.2%');
    expect(routeRow).toContain('4.4%');
    expect(routeRow).toContain('13.4%');
    expect(routeRow).toContain('early');
    expect(routeRow).toContain('late');
  });

  it('only colors route scorecard early and late percentages above alert thresholds', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      routes: [
        makeRoute('2', 'Route 2', {
          otp: makeOtp({
            total: 50,
            onTimePercent: 87.2,
            earlyPercent: 2.9,
            latePercent: 9.9,
          }),
        }),
        makeRoute('7', 'Route 7', {
          otp: makeOtp({
            total: 50,
            onTimePercent: 74.6,
            earlyPercent: 4.1,
            latePercent: 11.3,
          }),
        }),
        makeRoute('8A', 'Route 8A', {
          otp: makeOtp({
            total: 50,
            onTimePercent: 63.5,
            earlyPercent: 9.1,
            latePercent: 18.8,
          }),
        }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const routeSection = between(html, 'Route Scorecard', 'Boardings by Hour');
    const normalRow = rowForText(routeSection, 'Route 2');
    const alertRow = rowForText(routeSection, 'Route 7');
    const darkerAlertRow = rowForText(routeSection, 'Route 8A');

    expect(normalRow).toContain('color:#64748b;">2.9%</span> early');
    expect(normalRow).toContain('color:#64748b;">9.9%</span> late');
    expect(alertRow).toContain('color:#92400e;">4.1%</span> early');
    expect(alertRow).toContain('color:#991b1b;">11.3%</span> late');
    expect(darkerAlertRow).toContain('color:#78350f;">9.1%</span> early');
    expect(darkerAlertRow).toContain('color:#7f1d1d;">18.8%</span> late');
  });
});

describe('buildReportHtml trips operated KPI', () => {
  it('bolds the missed-trip count in the KPI subtitle', () => {
    const latestDay = makeSummary({ date: '2026-04-20' });
    latestDay.missedTrips = {
      totalScheduled: 20,
      totalMatched: 17,
      totalMissed: 3,
      missedPct: 15,
      notPerformedCount: 3,
      lateOver15Count: 0,
      byRoute: [{ routeId: '2', count: 3, earliestDep: '07:00' }],
    };

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).toContain(
      '<strong style="font-weight:800;color:#dc2626;">3</strong> missed of 20 scheduled',
    );
  });
});

describe('buildReportHtml dwell reporting', () => {
  it('adds moderate/high dwell hours to the route scorecard and boardings-by-hour table', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:15:00', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:45:00', trackedDwellSeconds: 3600, severity: 'high' }),
        makeIncident({ date: '2026-04-20', routeId: '5', routeName: 'Route 5', observedDepartureTime: '08:05:00', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:30:00', trackedDwellSeconds: 60, severity: 'minor' }),
        makeIncident({ date: '2026-04-20', routeId: '', routeName: 'Unknown', observedDepartureTime: '07:20:00', trackedDwellSeconds: 7200, severity: 'high' }),
        makeIncident({ date: '2026-04-20', routeId: '5', routeName: 'Route 5', observedDepartureTime: 'bad-time', trackedDwellSeconds: 1800, severity: 'high' }),
      ],
    });
    const priorDay = makeSummary({ date: '2026-04-19', incidents: [] });

    const html = buildReportHtml({
      latestDay,
      trendDays: [priorDay, latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).toContain('Dwell (hrs)');
    expect(html).toContain('>4.5 hrs<');

    const routeSection = between(html, 'Route Scorecard', 'Boardings by Hour');
    const route2Row = rowForText(routeSection, 'Route 2');
    const route5Row = rowForText(routeSection, 'Route 5');

    expect(route2Row).toContain('>1.5<');
    expect(route5Row).toContain('>1.0<');

    const hourlySection = between(html, 'Boardings by Hour', 'Operator Dwell by Stop');
    const sevenRow = rowForText(hourlySection, '07:00');
    const eightRow = rowForText(hourlySection, '08:00');

    expect(sevenRow).toContain('>3.5<');
    expect(eightRow).toContain('>0.5<');
    expect(eightRow).not.toContain('>1.0<');
    expect(routeSection).not.toContain('Total dwell (exact)');
    expect(hourlySection).not.toContain('Total dwell (exact)');
  });



  it('adds a standalone operator dwell by stop table sorted highest to lowest', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '5', stopName: 'Georgian College', stopId: '327', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', stopName: 'Downtown', stopId: '1', trackedDwellSeconds: 5400, severity: 'high' }),
        makeIncident({ date: '2026-04-20', routeId: '8A', stopName: 'Park Place', stopId: '777', trackedDwellSeconds: 3600, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', stopName: 'Downtown', stopId: '1', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '5', stopName: 'Georgian College', stopId: '327', trackedDwellSeconds: 60, severity: 'minor' }),
        makeIncident({ date: '2026-04-20', routeId: '11', stopName: 'One-off Stop', stopId: '111', trackedDwellSeconds: 1200, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '12A', stopName: 'Repeated Stop', stopId: '222', trackedDwellSeconds: 300, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '12A', stopName: 'Repeated Stop', stopId: '222', trackedDwellSeconds: 300, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '12A', stopName: 'Repeated Stop', stopId: '222', trackedDwellSeconds: 300, severity: 'moderate' }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const stopSection = between(html, 'Operator Dwell by Stop', 'Stop Highlights');
    const downtownIndex = stopSection.indexOf('Downtown');
    const parkPlaceIndex = stopSection.indexOf('Park Place');
    const georgianIndex = stopSection.indexOf('Georgian College');
    const downtownRow = rowForText(stopSection, 'Downtown');

    expect(stopSection).toContain('3+ incidents or at least 0.5 dwell hours');
    expect(downtownIndex).toBeGreaterThan(-1);
    expect(parkPlaceIndex).toBeGreaterThan(downtownIndex);
    expect(georgianIndex).toBeGreaterThan(parkPlaceIndex);
    expect(downtownRow).toContain('>2.0<');
    expect(downtownRow).toContain('>2<');
    expect(stopSection).toContain('Repeated Stop');
    expect(stopSection).not.toContain('One-off Stop');
    expect(stopSection).not.toContain('>0.0<');
  });

  it('ranks busiest stops by total boardings plus alightings', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      stops: [
        makeStop({ stopName: 'Boarding Heavy', stopId: '101', boardings: 40, alightings: 0 }),
        makeStop({ stopName: 'Total Activity Heavy', stopId: '102', boardings: 30, alightings: 50 }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const stopSection = between(html, 'Busiest Stops', 'Lowest OTP Stops');

    expect(stopSection.indexOf('Total Activity Heavy')).toBeLessThan(stopSection.indexOf('Boarding Heavy'));
  });

  it('merges hub stop routes and escapes external stop labels in busiest stops', () => {
    const originalOtp = makeOtp({ total: 10, onTimePercent: 80, earlyPercent: 10, latePercent: 10 });
    const latestDay = makeSummary({
      date: '2026-04-20',
      stops: [
        makeStop({
          stopName: 'Downtown <script>',
          stopId: '1',
          boardings: 20,
          alightings: 10,
          routeCount: 1,
          routes: ['2A'],
          otp: originalOtp,
        }),
        makeStop({
          stopName: 'Downtown Platform 2',
          stopId: '2',
          boardings: 15,
          alightings: 5,
          routeCount: 1,
          routes: ['5'],
          otp: makeOtp({ total: 10, onTimePercent: 100, earlyPercent: 0, latePercent: 0 }),
        }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const stopSection = between(html, 'Busiest Stops', 'Lowest OTP Stops');
    const downtownRow = rowForText(stopSection, 'Downtown');

    expect(downtownRow).toContain('>35<');
    expect(downtownRow).toContain('>15<');
    expect(downtownRow).toContain('>2<');
    expect(stopSection).not.toContain('<script>');
    expect(originalOtp.onTimePercent).toBe(80);
  });

  it('merges platform stop IDs into the same hub row in operator dwell by stop', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '2A', stopName: 'Allandale Platform 1', stopId: '9003', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '7A', stopName: 'Allandale Platform 2', stopId: '9004', trackedDwellSeconds: 3600, severity: 'high' }),
        makeIncident({ date: '2026-04-20', routeId: '8A', stopName: 'Park Place Platform', stopId: '777', trackedDwellSeconds: 1200, severity: 'moderate' }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const stopSection = between(html, 'Operator Dwell by Stop', 'Stop Highlights');
    const allandaleRow = rowForText(stopSection, 'Allandale Terminal');

    expect(allandaleRow).toContain('>1.5<');
    expect(allandaleRow).toContain('2A, 7A');
    expect(stopSection).not.toContain('Allandale Platform 1');
    expect(stopSection).not.toContain('Allandale Platform 2');
  });

  it('falls back to route name, trip name, or block when dwell incident route IDs are blank', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '', routeName: 'Route 5', stopName: 'Georgian College', stopId: '327', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '', routeName: 'Unknown', tripName: '10 - 10FD - 12:40', stopName: 'Georgian College', stopId: '327', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '', routeName: 'Unknown', tripName: 'Missing route', block: '12A-3', stopName: 'Georgian College', stopId: '327', trackedDwellSeconds: 1800, severity: 'moderate' }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const stopSection = between(html, 'Operator Dwell by Stop', 'Stop Highlights');
    const georgianRow = rowForText(stopSection, 'Georgian College');

    expect(georgianRow).toContain('5, 10, 12A');
  });

  it('uses trimmed report snapshot totals for historical weekday dwell averages', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', trackedDwellSeconds: 3600, severity: 'moderate' }),
      ],
    });
    const priorWeekday = makeSummary({
      date: '2026-04-17',
      incidents: [
        makeIncident({ date: '2026-04-17', trackedDwellSeconds: 7200, severity: 'moderate' }),
      ],
    });
    priorWeekday.byOperatorDwell = {
      ...priorWeekday.byOperatorDwell!,
      incidents: [],
      byOperator: [],
      totalTrackedDwellMinutes: 120,
      totalReportableDwellMinutes: 120,
    };

    const html = buildReportHtml({
      latestDay,
      trendDays: [priorWeekday, latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).toContain('Weekday avg: 1.5 hrs');
  });


  it('does not render total dwell rows in route or hour tables', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      routes: [
        makeRoute('2', 'Route 2'),
        makeRoute('5', 'Route 5'),
        makeRoute('7', 'Route 7'),
      ],
      hours: [
        makeHour(7, 30),
        makeHour(8, 30),
        makeHour(9, 30),
      ],
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:05:00', trackedDwellSeconds: 864, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '5', routeName: 'Route 5', observedDepartureTime: '08:05:00', trackedDwellSeconds: 864, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '7', routeName: 'Route 7', observedDepartureTime: '09:05:00', trackedDwellSeconds: 864, severity: 'moderate' }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const routeSection = between(html, 'Route Scorecard', 'Boardings by Hour');
    const hourlySection = between(html, 'Boardings by Hour', 'Operator Dwell by Stop');

    expect(routeSection).not.toContain('Total dwell (exact)');
    expect(hourlySection).not.toContain('Total dwell (exact)');
    expect(routeSection).toContain('rounded to 0.1 hours');
    expect(hourlySection).toContain('rounded to 0.1 hours');
  });

  it('shows daily dwell hours and trailing 7-day average dwell in the trend table using hidden prior history', () => {
    const trendDays = Array.from({ length: 8 }, (_, index) => {
      const day = `2026-04-${(13 + index).toString().padStart(2, '0')}`;
      const hours = index + 1;
      return makeSummary({
        date: day,
        totalRidership: 100 + index,
        incidents: [
          makeIncident({
            date: day,
            routeId: '2',
            routeName: 'Route 2',
            observedDepartureTime: '07:10:00',
            trackedDwellSeconds: hours * 3600,
            severity: 'moderate',
          }),
        ],
      });
    });

    const latestDay = trendDays[trendDays.length - 1]!;
    const html = buildReportHtml({
      latestDay,
      trendDays,
      teamName: 'Barrie Transit',
    });

    const trendSection = between(html, 'Last 7 Days Trend', 'Boardings by Hour');
    const firstVisibleRow = rowForText(trendSection, formatDate('2026-04-14'));
    const latestRow = rowForText(trendSection, formatDate('2026-04-20'));

    expect(firstVisibleRow).toContain(`>${formatDate('2026-04-14')}<`);
    expect(firstVisibleRow).toContain('>2.0<');
    expect(firstVisibleRow).toContain('>1.5<');
    expect(trendSection).toContain('7-day avg dwell (hrs)');
    expect(trendSection).toContain('7-day avg dwell is the rolling average');

    expect(latestRow).toContain(`>${formatDate('2026-04-20')}<`);
    expect(latestRow).toContain('>8.0<');
    expect(latestRow).toContain('>5.0<');
  });

  it('skips malformed hourly dwell times without breaking email generation', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '09:05:00', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: 'not-a-time', trackedDwellSeconds: 7200, severity: 'high' }),
      ],
      hours: [
        makeHour(9, 45),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [makeSummary({ date: '2026-04-19', incidents: [] }), latestDay],
      teamName: 'Barrie Transit',
    });

    const hourlySection = between(html, 'Boardings by Hour', 'Operator Dwell by Stop');
    const nineRow = rowForText(hourlySection, '09:00');

    expect(() => buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    })).not.toThrow();
    expect(nineRow).toContain('>0.5<');
    expect(nineRow).not.toContain('>2.5<');
  });

  it('does not render header snapshot or beta labels', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:15:00', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:45:00', trackedDwellSeconds: 3600, severity: 'high' }),
        makeIncident({ date: '2026-04-20', routeId: '5', routeName: 'Route 5', observedDepartureTime: '08:05:00', trackedDwellSeconds: 1800, severity: 'moderate' }),
      ],
      routes: [
        makeRoute('2', 'Route 2', { serviceHours: 5 }),
        makeRoute('5', 'Route 5', { serviceHours: 5 }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).not.toContain('Operator Dwell Snapshot');
    expect(html).not.toContain('tracked hrs');
    expect(html).not.toContain('operators flagged');
    expect(html).not.toContain('BETA');
    expect(html).not.toContain('under active testing');
  });

  it('does not render the review status banner above the KPI cards', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      routes: [
        makeRoute('2', 'Route 2', {
          otp: makeOtp({ onTimePercent: 80, earlyPercent: 8, latePercent: 12 }),
        }),
      ],
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    const beforeKpis = between(html, '<div style="padding:18px;background:#f8fafc;">', '<!-- ═══ 1. KPI CARDS ═══ -->');

    expect(beforeKpis).not.toContain('REVIEW');
    expect(beforeKpis).not.toContain('Mostly stable');
  });

  it('uses inline icon symbols and removes the feedback reply notice', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).not.toContain('<img src=');
    expect(html).not.toContain('email-icons');
    expect(html).not.toContain('Questions or feedback?');
    expect(html).toContain('&#128652;');
  });
});
