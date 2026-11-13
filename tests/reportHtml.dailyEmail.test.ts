import { describe, expect, it } from 'vitest';
import { buildReportHtml, emailIconAttachments } from '../functions/src/reportHtml';
import { summarizeWeeklyDwell, type DwellHistoryDay } from '../utils/performanceDwellHistory';
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
  // One row only: the text before the match may not cross into another row.
  const match = sectionHtml.match(new RegExp(`<tr[^>]*>(?:(?!<tr)[\\s\\S])*?${escaped}[\\s\\S]*?<\\/tr>`));
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

    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');
    const routeRow = rowForText(routeSection, 'Route 2');

    expect(routeSection).toContain('Ranked by boardings per service hour (BPH), highest first');
    expect(routeSection).toMatch(/<th[^>]*>On-time<\/th>/);
    expect(routeSection).not.toMatch(/<th[^>]*>Early/i);
    expect(routeSection).not.toMatch(/<th[^>]*>Late/i);
    expect(routeRow).toContain('82.2%');
    expect(routeRow).toContain('4.4%');
    expect(routeRow).toContain('13.4%');
    expect(routeRow).toContain('early');
    expect(routeRow).toContain('late');
  });

  it('shows each route number in a circle in its official route colour', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      routes: [
        makeRoute('12A', 'Georgian Mall'),
        makeRoute('8B', 'Crosstown/Essa'),
        makeRoute('99', 'Unknown'),
      ],
    });
    const html = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');

    // Pink 12 series uses dark text; black route 8 uses white text; unknown routes are grey.
    expect(rowForText(routeSection, 'Georgian Mall')).toMatch(/border-radius:999px;background:#F8A1BE;color:#000000;[^>]*>12A<\/span>/);
    expect(rowForText(routeSection, 'Crosstown/Essa')).toMatch(/background:#000000;color:#ffffff;[^>]*>8B<\/span>/);
    expect(rowForText(routeSection, 'Unknown')).toMatch(/background:#6B7280;color:#ffffff;[^>]*>99<\/span>/);
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

    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');
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
      '<strong style="font-weight:800;color:#dc2626;">3</strong> missed',
    );
  });
});

describe('buildReportHtml dwell reporting', () => {
  it('flags routes with 0.5 hours or more of moderate/high dwell in the route scorecard', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      incidents: [
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:15:00', trackedDwellSeconds: 1800, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '2', routeName: 'Route 2', observedDepartureTime: '07:45:00', trackedDwellSeconds: 3600, severity: 'high' }),
        makeIncident({ date: '2026-04-20', routeId: '5', routeName: 'Route 5', observedDepartureTime: '08:05:00', trackedDwellSeconds: 1200, severity: 'moderate' }),
        makeIncident({ date: '2026-04-20', routeId: '5', routeName: 'Route 5', observedDepartureTime: '08:30:00', trackedDwellSeconds: 7200, severity: 'minor' }),
        makeIncident({ date: '2026-04-20', routeId: '', routeName: 'Unknown', observedDepartureTime: '07:20:00', trackedDwellSeconds: 7200, severity: 'high' }),
      ],
    });
    const priorDay = makeSummary({ date: '2026-04-19', incidents: [] });

    const html = buildReportHtml({
      latestDay,
      trendDays: [priorDay, latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).toContain('Total: 3.8 hrs');
    expect(html).toContain('min / 100 trips');

    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');
    const route2Row = rowForText(routeSection, 'Route 2');
    const route5Row = rowForText(routeSection, 'Route 5');

    expect(routeSection).not.toContain('Dwell (hrs)');
    expect(route2Row).toContain('Dwell 1.5 hrs');
    expect(route5Row).not.toContain('Dwell ');
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

    const stopSection = between(html, 'Top 10 Stops by Ridership', '<!-- Footer -->');

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

    const stopSection = between(html, 'Top 10 Stops by Ridership', '<!-- Footer -->');
    const downtownRow = rowForText(stopSection, 'Downtown');

    expect(downtownRow).toContain('>35<');
    expect(downtownRow).toContain('>15<');
    expect(downtownRow).toContain('>2<');
    expect(stopSection).not.toContain('<script>');
    expect(originalOtp.onTimePercent).toBe(80);
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

    const withRoutes = buildReportHtml({
      latestDay: { ...latestDay, byRoute: ['5', '10', '12A'].map(id => makeRoute(id, `Route ${id}`)) },
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });
    const flaggedSection = between(withRoutes, 'Route Scorecard', '<!-- Footer -->');
    for (const id of ['5', '10', '12A']) {
      expect(rowForText(flaggedSection, `Route ${id}<`)).toContain('Dwell 0.5 hrs');
    }
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

    expect(html).toContain('Total: 1.0 hrs');
  });


  it('does not render total dwell rows in the route scorecard', () => {
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

    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');

    expect(routeSection).not.toContain('Total dwell (exact)');
    expect(routeSection).not.toContain('Dwell (hrs)');
  });

  it('shows the last 7 days as three bar charts without the rolling dwell average', () => {
    const trendDays = Array.from({ length: 8 }, (_, index) => {
      const day = `2026-04-${(13 + index).toString().padStart(2, '0')}`;
      const hours = index + 1;
      return makeSummary({
        date: day,
        totalRidership: 1000 + index * 100,
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

    const trendSection = between(html, 'Last 7 Days', '<!-- ═══ 5.');

    expect(trendSection).toContain('On-time');
    expect(trendSection).toContain('(scale 70–100%)');
    expect(trendSection).toContain('Riders');
    expect(trendSection).toContain('Operator dwell');
    expect(trendSection).not.toContain('<svg');
    // Seven bars per chart, three charts.
    expect(trendSection.match(/<td valign="bottom"/g)).toHaveLength(21);
    // Latest day: 1,700 riders, 8 hrs over 20 trips = 2,400 min / 100 trips; first visible day is Apr 14.
    expect(trendSection).toContain('font-weight:800;">1.7k</div>');
    expect(trendSection).toContain('font-weight:800;">2400</div>');
    expect(trendSection).toContain('>1.1k</div>');
    expect(trendSection).not.toContain('>1.0k</div>');
    expect(html).not.toContain('7-day avg dwell');
    expect(html).not.toContain('rolling average');
  });

  it('compares each trend bar with its same-weekday average over the past 4 weeks', () => {
    // Mar 30 – Apr 20: four Mondays. Earlier Mondays: 1,000 riders and 90% on time.
    const trendDays = Array.from({ length: 22 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 2, 30 + index)).toISOString().slice(0, 10);
      const isLatest = index === 21;
      const day = makeSummary({ date, totalRidership: isLatest ? 2000 : 1000 });
      day.system = { ...day.system, otp: makeOtp({ onTimePercent: isLatest ? 80 : 90 }) };
      return day;
    });
    const latestDay = trendDays[trendDays.length - 1]!;
    const html = buildReportHtml({ latestDay, trendDays, teamName: 'Barrie Transit' });
    const trendSection = between(html, 'Last 7 Days', '<!-- ═══ 5.');
    const otpChart = between(trendSection, 'On-time', 'Riders');
    const riderChart = between(trendSection, 'Riders', 'Operator dwell');

    expect(trendSection).toContain('Average for the same day of the week, past 4 weeks');
    expect(trendSection).toContain('border-top:2px dashed #0f172a');
    // Latest Monday: riders double the average (better), on-time 10 pts below (worse).
    expect(riderChart).toContain('background:#16a34a');
    expect(otpChart).toContain('background:#dc2626');
    // Earlier days match their averages exactly.
    expect(riderChart).toContain('background:#cbd5e1');
    expect(otpChart).not.toContain('background:#fca5a5');
  });

  it('gives low on-time days the minimum bar and days without dwell data a dash', () => {
    const lowDay = makeSummary({ date: '2026-04-19' });
    lowDay.system = { ...lowDay.system, otp: makeOtp({ onTimePercent: 60 }) };
    lowDay.byOperatorDwell = undefined;
    const latestDay = makeSummary({ date: '2026-04-20' });

    const html = buildReportHtml({ latestDay, trendDays: [lowDay, latestDay], teamName: 'Barrie Transit' });
    const trendSection = between(html, 'Last 2 Days', '<!-- ═══ 5.');

    expect(trendSection).toContain('>60.0</div><div style="height:2px;');
    expect(trendSection).toContain('>—</div></td>');
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

  it('shows the status strip before the KPI cards only when route history is given', () => {
    const latestDay = makeSummary({ date: '2026-04-20' });
    const routeHistory = [{ date: latestDay.date, dayType: latestDay.dayType, byRoute: latestDay.byRoute }];

    const glanceHtml = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit', routeHistory, lastMissedTripDataDate: '2026-04-20' });
    const strip = between(glanceHtml, '<!-- Header -->', '<!-- ═══ 1. KPI CARDS ═══ -->');
    expect(strip).not.toMatch(/>(STABLE|REVIEW|NEEDS ATTENTION)</);
    expect(strip).toContain('No route ran well below its usual.');

    const olderHtml = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    const beforeKpis = between(olderHtml, '<!-- Header -->', '<!-- ═══ 1. KPI CARDS ═══ -->');
    expect(beforeKpis).not.toMatch(/>(STABLE|REVIEW|NEEDS ATTENTION)</);
    expect(beforeKpis).not.toContain('Mostly stable');
  });

  it('renders a compact header with the service day type', () => {
    const latestDay = makeSummary({ date: '2026-04-18', dayType: 'saturday' });
    const trendDays = Array.from({ length: 40 }, (_, i) => makeSummary({ date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}` }));
    const html = buildReportHtml({ latestDay, trendDays: [...trendDays, latestDay], teamName: 'Barrie <Transit>' });
    const header = between(html, '<!-- Header -->', '<!-- ═══ 1. KPI CARDS ═══ -->');

    expect(header).toContain('Barrie &lt;Transit&gt; Daily Performance Report');
    expect(header).toContain('Saturday service');
    expect(header).toContain('Open full dashboard');
    expect(html).not.toContain('Service Data');
  });

  it('leaves out the removed sections', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
      stops: [makeStop({ stopName: 'Slow Stop', stopId: '101', boardings: 5, alightings: 5, otp: makeOtp({ total: 20, onTimePercent: 50 }) })],
      incidents: [
        makeIncident({ date: '2026-04-20', stopName: 'Downtown', stopId: '1', trackedDwellSeconds: 3600, severity: 'high' }),
      ],
    });
    const html = buildReportHtml({ latestDay, trendDays: [makeSummary({ date: '2026-04-19' }), latestDay], teamName: 'Barrie Transit' });

    expect(html).not.toContain('OTP Distribution');
    expect(html).not.toContain('Boardings by Hour');
    expect(html).not.toContain('Operator Dwell by Stop');
    expect(html).not.toContain('Lowest OTP Stops');
    expect(html).not.toContain('alightings</div>');
    expect(html).toContain('Top 10 Stops by Ridership');
    expect(html).toContain('href="https://transitscheduler.ca/#operations/performance" style="color:#2563eb;font-weight:600;text-decoration:none;">dashboard</a>');
    expect(html).toContain('This is an automated report. Generated by Scheduler 4');
    expect(html.indexOf('Top 10 Stops by Ridership')).toBeLessThan(html.indexOf('<!-- Footer -->'));
  });

  it('embeds duotone icons as inline attachments and removes the feedback reply notice', () => {
    const latestDay = makeSummary({
      date: '2026-04-20',
    });

    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).not.toContain('email-icons');
    expect(html).not.toContain('Questions or feedback?');
    expect(html).not.toContain('&#128652;');
    expect(html).toContain('src="cid:icon-bus-ffffff"');
    expect(html).toContain('src="cid:icon-ridership-2563eb"');

    const attachments = emailIconAttachments(html);
    const cids = attachments.map(attachment => attachment.cid);
    expect(new Set(cids).size).toBe(cids.length);
    expect(cids).toEqual(expect.arrayContaining(['icon-bus-ffffff', 'icon-ridership-2563eb', 'icon-trips-6d28d9']));
    for (const cid of [...html.matchAll(/src="cid:([^"]+)"/g)].map(match => match[1])) {
      expect(cids).toContain(cid);
    }
    for (const attachment of attachments) {
      expect(attachment.encoding).toBe('base64');
      expect(Buffer.from(attachment.content, 'base64').subarray(1, 4).toString()).toBe('PNG');
    }
  });
});

describe('buildReportHtml weekly operator dwell', () => {
  /** Eight Monday–Sunday weeks from 2026-03-09; each day has `rate` minutes over 100 trips. */
  function weeklyDwell() {
    const history: DwellHistoryDay[] = [10, 10, 10, 10, 20, 20, 20, 20].flatMap((rate, weekIndex) =>
      Array.from({ length: 7 }, (_, dayIndex) => {
        const date = new Date(Date.UTC(2026, 2, 9 + weekIndex * 7 + dayIndex, 12));
        return { date: date.toISOString().slice(0, 10), dayType: 'weekday', reportableDwellMinutes: rate, tripCount: 100 };
      }));
    return summarizeWeeklyDwell(history, '2026-05-03');
  }

  const latestDay = makeSummary({ date: '2026-05-03', dayType: 'sunday' });

  it('shows the full section with rank, trend and chart on the week-closing send', () => {
    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
      weeklyDwell: weeklyDwell(),
      showWeeklyDwellSection: true,
    });
    const section = between(html, 'Weekly Operator Dwell', '<!-- ═══ 6. MISSED TRIPS');

    expect(section).toContain('Last week: worse than 6 in 10 weeks');
    expect(section).toContain('2.3 hrs total');
    expect(section).toContain('Median of 8 weeks');
    expect(section).toContain('&#9650; 100%');
    expect(section).toContain('20 now vs 10 before');
    expect(section).not.toContain('percentile');
    expect(section.match(/height:104px/g)).toHaveLength(3);
    expect(section).toContain('Week of Mar 9: 10 min per 100 trips');
    expect(html).not.toContain('min per 100 trips · worse');
  });

  it('keeps the weekly section off other days without adding a line to the dwell card', () => {
    const html = buildReportHtml({
      latestDay,
      trendDays: [latestDay],
      teamName: 'Barrie Transit',
      weeklyDwell: weeklyDwell(),
      showWeeklyDwellSection: false,
    });

    expect(html).not.toContain('Weekly Operator Dwell');
    expect(html).not.toContain('Last week:');
  });

  it('leaves both out without enough weeks to rank', () => {
    const html = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit', weeklyDwell: null, showWeeklyDwellSection: true });

    expect(html).not.toContain('Weekly Operator Dwell');
    expect(html).not.toContain('Last week:');
  });
});

describe('buildReportHtml dwell KPI card median', () => {
  const dwellDay = (date: string, seconds: number, dayType: DailySummary['dayType'] = 'weekday') =>
    makeSummary({
      date,
      dayType,
      incidents: [makeIncident({ date, trackedDwellSeconds: seconds, severity: 'moderate' })],
    });

  it('shows the median per-100-trip rate for earlier days of the same day type', () => {
    // 20 trips per day: 1800s = 150 min / 100 trips, 3600s = 300.
    const latestDay = dwellDay('2026-04-20', 3600);
    const html = buildReportHtml({
      latestDay,
      trendDays: [
        dwellDay('2026-04-14', 1800),
        dwellDay('2026-04-15', 1200),
        dwellDay('2026-04-16', 2400),
        dwellDay('2026-04-18', 36000, 'saturday'),
        latestDay,
      ],
      teamName: 'Barrie Transit',
    });

    expect(html).toContain('usual 150 · <span style="color:#d97706;font-weight:700;">high</span>');
    expect(html).toContain('Total: 1.0 hrs');
    // 300 is more than 1.5x the median, so the card turns amber.
    expect(html).toContain('border-left:4px solid #d97706;box-shadow');
  });

  it('leaves the median out until there are enough earlier days', () => {
    const latestDay = dwellDay('2026-04-20', 3600);
    const html = buildReportHtml({
      latestDay,
      trendDays: [dwellDay('2026-04-16', 1800), dwellDay('2026-04-17', 1800), latestDay],
      teamName: 'Barrie Transit',
    });

    expect(html).toContain('Total: 1.0 hrs');
    expect(html).not.toContain('usual ');
    expect(html).not.toContain('Weekday median');
  });
});

describe('buildReportHtml KPI card sizing', () => {
  it('gives all four KPI cards the same base height, and lets them grow and wrap on small screens', () => {
    const latestDay = makeSummary({ date: '2026-04-20' });
    const html = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    const heights = [...html.matchAll(/class="kpi-cell" style="width:25%;height:(\d+)px;/g)].map(m => m[1]);
    expect(html).toContain('@media only screen and (max-width: 620px)');
    expect(html).toContain('.kpi-cell { display: inline-block !important; width: 48% !important; height: auto !important;');

    expect(heights).toHaveLength(4);
    expect(new Set(heights).size).toBe(1);
  });
});

describe('buildReportHtml glance section', () => {
  it('shows a route well below its usual once, with its late-trip detail, and no Action Focus column', () => {
    const priorWeekdays = ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
    const routesFor = (otp2: number) => [
      makeRoute('2', 'Route 2', { otp: makeOtp({ total: 60, onTimePercent: otp2 }) }),
      makeRoute('5', 'Route 5', { otp: makeOtp({ total: 60, onTimePercent: 90 }) }),
    ];
    const history = priorWeekdays.map(date => makeSummary({ date, routes: routesFor(92) }));
    const latestDay = makeSummary({ date: '2026-04-20', routes: routesFor(80) });
    const routeHistory = [...history, latestDay].map(day => ({ date: day.date, dayType: day.dayType, byRoute: day.byRoute }));

    const html = buildReportHtml({ latestDay, trendDays: [...history, latestDay], teamName: 'Barrie Transit', routeHistory, lastMissedTripDataDate: '2026-04-20' });
    const section = between(html, 'What Stood Out', 'Route Scorecard');

    expect(html).not.toContain('Action Focus');
    expect(section.match(/Route 2/g)).toHaveLength(1);
    expect(section).toContain('Open on-time dashboard');
  });

  it('uses the glance section when route history is given, and the older summary otherwise', () => {
    const latestDay = makeSummary({ date: '2026-04-20' });
    const routeHistory = [{ date: latestDay.date, dayType: latestDay.dayType, byRoute: latestDay.byRoute }];

    const glanceHtml = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit', routeHistory, lastMissedTripDataDate: '2026-04-20' });
    expect(glanceHtml).not.toContain('Yesterday at a Glance');
    const glanceSection = between(glanceHtml, 'What Stood Out', 'Route Scorecard');
    expect(glanceSection).toContain('No route ran well below its usual, and nothing new to follow up.');
    expect(glanceSection).not.toContain('Service delivery was');
    expect(glanceHtml).not.toContain('Action Focus');

    const olderHtml = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    expect(between(olderHtml, 'Yesterday at a Glance', 'Action Focus')).toContain('Service delivery was');
  });
});

describe('buildReportHtml KPI usual lines', () => {
  const priorWeekdays = ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];

  it('shows usual and verdict on the on-time and ridership cards, with early/late and rank below', () => {
    const latestDay = makeSummary({ date: '2026-04-20', totalRidership: 300 });
    const trendDays = [...priorWeekdays.map(date => makeSummary({ date, totalRidership: 180 })), latestDay];
    const routeHistory = trendDays.map(day => ({ date: day.date, dayType: day.dayType, byRoute: day.byRoute }));

    const html = buildReportHtml({ latestDay, trendDays, teamName: 'Barrie Transit', routeHistory, lastMissedTripDataDate: '2026-04-20' });
    const kpis = between(html, '<!-- ═══ 1. KPI CARDS ═══ -->', '<!-- ═══ 2.');

    expect(kpis).toContain('usual 86.0% · <span style="color:#64748b;font-weight:700;">normal</span>');
    expect(kpis).toContain('6.0% early · 8.0% late');
    expect(kpis).toContain('usual 180 · <span style="color:#16a34a;font-weight:700;">▲ 67%</span>');
    expect(kpis).toContain('busiest weekday in');
  });

  it('keeps only early/late on the on-time card without route history', () => {
    const latestDay = makeSummary({ date: '2026-04-20' });
    const html = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    const kpis = between(html, '<!-- ═══ 1. KPI CARDS ═══ -->', '<!-- ═══ 2.');

    expect(kpis).not.toContain('usual');
    expect(kpis).toContain('6.0% early · 8.0% late');
  });
});

describe('buildReportHtml route scorecard flags', () => {
  const priorWeekdays = ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const apcGap = { ridership: 100, alightings: 40 };

  it('flags a route well below its usual and tells new APC flags from ongoing ones', () => {
    const routesFor = (otp2: number, apc7: boolean) => [
      makeRoute('2', 'Route 2', { otp: makeOtp({ total: 60, onTimePercent: otp2 }) }),
      makeRoute('5', 'Route 5', { otp: makeOtp({ total: 60, onTimePercent: 90 }), ...apcGap }),
      makeRoute('7', 'Route 7', { otp: makeOtp({ total: 60, onTimePercent: 90 }), ...(apc7 ? apcGap : {}) }),
    ];
    // Route 5's APC gap shows on every earlier day (ongoing); Route 7's only today (new).
    const history = priorWeekdays.map(date => makeSummary({ date, routes: routesFor(92, false) }));
    const latestDay = makeSummary({ date: '2026-04-20', routes: routesFor(80, true) });
    const routeHistory = [...history, latestDay].map(day => ({ date: day.date, dayType: day.dayType, byRoute: day.byRoute }));

    const html = buildReportHtml({ latestDay, trendDays: [...history, latestDay], teamName: 'Barrie Transit', routeHistory, lastMissedTripDataDate: '2026-04-20' });
    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');
    const route2Row = rowForText(routeSection, 'Route 2');

    expect(route2Row).toContain('&#9660; 12.0 pts below usual');
    expect(route2Row).toContain('background:#fef2f2;');
    const route5Row = rowForText(routeSection, 'Route 5');
    expect(route5Row).toContain('>APC issue<');
    expect(route5Row).not.toContain('ongoing');
    expect(route5Row).toContain('background:#f3f4f6;color:#9ca3af;');
    expect(rowForText(routeSection, 'Route 7')).toContain('APC issue · new');
    expect(route2Row).not.toContain('background:#f3f4f6;color:#9ca3af;');
    expect(routeSection).toContain('A flag shows only when a route needs a look');
  });

  it('shows a plain APC check flag without route history', () => {
    const latestDay = makeSummary({ date: '2026-04-20', routes: [makeRoute('5', 'Route 5', apcGap), makeRoute('7', 'Route 7')] });
    const html = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    const routeSection = between(html, 'Route Scorecard', '<!-- Footer -->');

    expect(rowForText(routeSection, 'Route 5')).toContain('>APC issue<');
    expect(rowForText(routeSection, 'Route 7')).not.toContain('APC');
  });
});

describe('buildReportHtml missed trips', () => {
  it('lists yesterday\'s missed trips with a reason column and no summary tiles', () => {
    const latestDay = makeSummary({ date: '2026-04-20' });
    latestDay.missedTrips = {
      totalScheduled: 20,
      totalMatched: 18,
      totalMissed: 3,
      missedPct: 15,
      notPerformedCount: 1,
      lateOver15Count: 2,
      byRoute: [{ routeId: '2', count: 3, earliestDep: '07:00' }],
      trips: [
        { tripId: 't3', routeId: '2', departure: '09:00', headsign: 'North', blockId: 'b1', serviceId: 'wk', missType: 'not_performed' },
        { tripId: 't1', routeId: '2', departure: '07:00', headsign: 'North', blockId: 'b1', serviceId: 'wk', missType: 'late_over_15', lateByMinutes: 22 },
        { tripId: 't2', routeId: '5', departure: '08:00', headsign: 'North', blockId: 'b2', serviceId: 'wk', missType: 'late_over_15' },
      ],
    };

    const html = buildReportHtml({ latestDay, trendDays: [latestDay], teamName: 'Barrie Transit' });
    const section = between(html, 'Missed Trips', '<!-- ═══ 7.');

    expect(section).toContain('3 of 20 scheduled trips missed (15.0%)');
    expect(section).toMatch(/<th[^>]*>Reason<\/th>/);
    expect(section).toContain('Late 22 min');
    expect(section).toContain('Late 15+ min');
    expect(section).toContain('No data recorded');
    expect(section.indexOf('07:00')).toBeLessThan(section.indexOf('08:00'));
    expect(section.indexOf('08:00')).toBeLessThan(section.indexOf('09:00'));
    expect(section).not.toContain('Impacted Routes');
    expect(section).not.toContain('Late Departures');
  });
});
