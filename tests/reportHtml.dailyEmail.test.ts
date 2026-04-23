import { describe, expect, it } from 'vitest';
import { buildReportHtml } from '../functions/src/reportHtml';
import type {
  DailySummary,
  DwellIncident,
  DwellSeverity,
  HourMetrics,
  OTPBreakdown,
  RouteMetrics,
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

function makeIncident(params: {
  date: string;
  routeId?: string;
  routeName?: string;
  observedDepartureTime?: string;
  trackedDwellSeconds: number;
  severity: DwellSeverity;
}): DwellIncident {
  return {
    operatorId: 'op-1',
    date: params.date,
    routeId: params.routeId ?? '2',
    routeName: params.routeName ?? 'Route 2',
    stopName: 'Downtown',
    stopId: '1',
    tripName: 'Trip 1',
    block: 'block-1',
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
    byStop: [],
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

    const routeSection = between(html, 'Route Scorecard', 'Last 2 Days Trend');
    const route2Row = rowForText(routeSection, 'Route 2');
    const route5Row = rowForText(routeSection, 'Route 5');

    expect(route2Row).toContain('>1.5<');
    expect(route5Row).toContain('>1.0<');

    const hourlySection = between(html, 'Boardings by Hour', 'Stop Highlights');
    const sevenRow = rowForText(hourlySection, '07:00');
    const eightRow = rowForText(hourlySection, '08:00');

    expect(sevenRow).toContain('>3.5<');
    expect(eightRow).toContain('>0.5<');
    expect(eightRow).not.toContain('>1.0<');
    expect(routeSection).not.toContain('Total dwell (exact)');
    expect(hourlySection).not.toContain('Total dwell (exact)');
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
    const hourlySection = between(html, 'Boardings by Hour', 'Stop Highlights');

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

    const hourlySection = between(html, 'Boardings by Hour', 'Stop Highlights');
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
});
