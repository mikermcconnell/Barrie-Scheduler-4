import { DailySummary, RouteMetrics, HourMetrics, StopMetrics, DwellIncident } from './types';

export interface ReportData {
  latestDay: DailySummary;
  trendDays: DailySummary[];
  teamName: string;
}

// Reset dwell comparison baselines from the current report rollout onward.
// The morning report currently uses 2026-03-09 as its latest service day.
const DWELL_AVG_BASELINE_START_DATE = '2026-03-09';

/** Hub definitions — stops at the same hub get merged in stop rankings */
const HUBS: { name: string; stopCodes: string[] }[] = [
  { name: 'Park Place', stopCodes: ['777'] },
  { name: 'Barrie South GO', stopCodes: ['725'] },
  { name: 'Allandale Terminal', stopCodes: ['9003', '9004', '9005', '9006', '9009', '9012', '9013', '9014'] },
  { name: 'Downtown', stopCodes: ['1', '2', '10'] },
  { name: 'Georgian College', stopCodes: ['327', '328', '329', '330', '331', '335'] },
];

/** Merge stops belonging to the same hub, summing boardings/alightings and averaging OTP */
function mergeHubStops(stops: StopMetrics[]): StopMetrics[] {
  const hubMap = new Map<string, string>(); // stopId → hub name
  for (const hub of HUBS) {
    for (const code of hub.stopCodes) {
      hubMap.set(code, hub.name);
    }
  }

  const merged = new Map<string, StopMetrics>();
  const hubRouteSets = new Map<string, Set<string>>();
  const standalone: StopMetrics[] = [];

  for (const stop of stops) {
    const hubName = hubMap.get(stop.stopId);
    if (!hubName) {
      standalone.push(stop);
      continue;
    }

    const existing = merged.get(hubName);
    if (!existing) {
      merged.set(hubName, {
        ...stop,
        stopName: hubName,
        stopId: '',
      });
      hubRouteSets.set(hubName, new Set());
    } else {
      existing.boardings += stop.boardings;
      existing.alightings += stop.alightings;
      // Weighted OTP average by observation count
      const totalObs = existing.otp.total + stop.otp.total;
      if (totalObs > 0) {
        existing.otp.onTimePercent =
          (existing.otp.onTimePercent * existing.otp.total + stop.otp.onTimePercent * stop.otp.total) / totalObs;
        existing.otp.earlyPercent =
          (existing.otp.earlyPercent * existing.otp.total + stop.otp.earlyPercent * stop.otp.total) / totalObs;
        existing.otp.latePercent =
          (existing.otp.latePercent * existing.otp.total + stop.otp.latePercent * stop.otp.total) / totalObs;
      }
      existing.otp.total = totalObs;
      existing.avgLoad = (existing.avgLoad + stop.avgLoad) / 2;
    }
  }

  return [...merged.values(), ...standalone];
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function num(value: number): string {
  return value.toLocaleString('en-CA');
}

function otpColor(otpPercent: number): string {
  if (otpPercent >= 85) return '#16a34a'; // green
  if (otpPercent >= 75) return '#d97706'; // orange
  return '#dc2626'; // red
}

function otpBg(otpPercent: number): string {
  if (otpPercent >= 85) return '#f0fdf4';
  if (otpPercent >= 75) return '#fffbeb';
  return '#fef2f2';
}

function otpPill(value: number): string {
  return `<span style="background:${otpBg(value)};color:${otpColor(value)};padding:2px 8px;border-radius:4px;font-weight:600;font-size:12px;">${pct(value)}</span>`;
}

function kpiCard(label: string, value: string, subtitle?: string, accentColor?: string, subtitleColor?: string): string {
  const border = accentColor ? `border-left:3px solid ${accentColor};` : '';
  const subColor = subtitleColor || '#9ca3af';
  const subWeight = subtitleColor ? 'font-weight:600;' : '';
  return `
    <td style="width:50%;padding:6px;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center;${border}">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="font-size:24px;font-weight:700;color:#111827;margin:4px 0;">${value}</div>
        ${subtitle ? `<div style="font-size:11px;color:${subColor};${subWeight}">${subtitle}</div>` : ''}
      </div>
    </td>`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatReportDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function bphColor(value: number): string {
  if (value < 10 || value > 30) return '#dc2626'; // red
  if (value >= 20) return '#16a34a'; // green
  return '#111827'; // black
}

function bphBg(value: number): string {
  if (value < 10 || value > 30) return '#fef2f2';
  if (value >= 20) return '#f0fdf4';
  return 'transparent';
}

function bphPill(value: number): string {
  const bg = bphBg(value);
  const color = bphColor(value);
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px;">${value.toFixed(1)}</span>`;
}

function apcDiscrepancyPctForRoute(route: RouteMetrics): number {
  if (typeof route.apcDiscrepancyPct === 'number') return route.apcDiscrepancyPct;
  const baseline = Math.max(route.ridership, route.alightings, 1);
  return Math.round((Math.abs(route.ridership - route.alightings) * 1000) / baseline) / 10;
}

function apcStatusForRoute(route: RouteMetrics): 'ok' | 'review' | 'suspect' {
  if (route.apcStatus === 'review' || route.apcStatus === 'suspect' || route.apcStatus === 'ok') {
    return route.apcStatus;
  }
  const discrepancyPct = apcDiscrepancyPctForRoute(route);
  if (discrepancyPct >= 50) return 'suspect';
  if (discrepancyPct >= 25) return 'review';
  return 'ok';
}

function apcStatusBg(status: 'ok' | 'review' | 'suspect'): string {
  if (status === 'suspect') return '#fef2f2';
  if (status === 'review') return '#fffbeb';
  return '#f3f4f6';
}

function apcStatusColor(status: 'ok' | 'review' | 'suspect'): string {
  if (status === 'suspect') return '#b91c1c';
  if (status === 'review') return '#b45309';
  return '#4b5563';
}

function apcStatusLabel(status: 'ok' | 'review' | 'suspect'): string {
  if (status === 'suspect') return 'Suspect';
  if (status === 'review') return 'Review';
  return 'OK';
}

function apcPill(status: 'ok' | 'review' | 'suspect'): string {
  return `<span style="background:${apcStatusBg(status)};color:${apcStatusColor(status)};padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;">${apcStatusLabel(status)}</span>`;
}

function apcIssueSideForRoute(
  route: RouteMetrics,
  status: 'ok' | 'review' | 'suspect',
): 'boards' | 'alights' | null {
  if (status === 'ok') return null;
  if (route.ridership === route.alightings) return null;
  return route.ridership < route.alightings ? 'boards' : 'alights';
}

function apcIssueCellStyle(
  status: 'ok' | 'review' | 'suspect',
  isIssue: boolean,
): string {
  if (!isIssue || status === 'ok') {
    return 'color:#374151;';
  }

  if (status === 'suspect') {
    return 'color:#b91c1c;background:#fef2f2;font-weight:700;box-shadow: inset 3px 0 0 #dc2626;';
  }

  return 'color:#b45309;background:#fffbeb;font-weight:700;box-shadow: inset 3px 0 0 #f59e0b;';
}

function apcStatusCellStyle(status: 'ok' | 'review' | 'suspect'): string {
  if (status === 'suspect') {
    return 'background:#fef2f2;box-shadow: inset 3px 0 0 #dc2626;';
  }
  if (status === 'review') {
    return 'background:#fffbeb;box-shadow: inset 3px 0 0 #f59e0b;';
  }
  return '';
}

function stopLabel(name: string, id: string): string {
  if (!id) return name;
  return `${name} <span style="color:#9ca3af;font-weight:400;">(${id})</span>`;
}

function sectionHeader(title: string, subtitle?: string): string {
  return `
    <div style="margin:24px 0 10px;">
      <div style="font-size:15px;font-weight:700;color:#1e3a5f;padding-bottom:4px;border-bottom:2px solid #e5e7eb;">${title}</div>
      ${subtitle ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${subtitle}</div>` : ''}
    </div>`;
}

function formatRouteList(routeIds: string[], maxShown = 4): string {
  const unique = [...new Set(routeIds.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (unique.length === 0) return 'None';
  if (unique.length <= maxShown) return unique.join(', ');
  return `${unique.slice(0, maxShown).join(', ')} +${unique.length - maxShown} more`;
}

function buildExecutiveSummary(latestDay: DailySummary): string {
  const mt = latestDay.missedTrips;
  const apcIssueRoutes = latestDay.byRoute.filter(route => apcStatusForRoute(route) !== 'ok');
  const worstOtpRoute = [...latestDay.byRoute]
    .sort((a, b) => a.otp.onTimePercent - b.otp.onTimePercent)[0];

  let statusLabel = 'Stable';
  let statusBg = '#ecfdf5';
  let statusColor = '#166534';
  let summaryLead = `Service delivery was generally stable on ${formatDateLong(latestDay.date)}.`;

  if ((mt?.missedPct ?? 0) >= 5 || latestDay.system.otp.onTimePercent < 75) {
    statusLabel = 'Needs Attention';
    statusBg = '#fef2f2';
    statusColor = '#991b1b';
    summaryLead = `Service delivery needs attention for ${formatDateLong(latestDay.date)}.`;
  } else if ((mt?.totalMissed ?? 0) > 0 || latestDay.system.otp.onTimePercent < 85 || apcIssueRoutes.length > 0) {
    statusLabel = 'Review';
    statusBg = '#fffbeb';
    statusColor = '#92400e';
    summaryLead = `Service delivery was mostly stable on ${formatDateLong(latestDay.date)}, with a few items to review.`;
  }

  const bullets = [
    summaryLead,
    `System OTP was ${pct(latestDay.system.otp.onTimePercent)} with ${num(latestDay.system.totalRidership)} riders.`,
    mt && mt.totalScheduled > 0
      ? mt.totalMissed === 0
        ? `All ${num(mt.totalScheduled)} scheduled trips operated.`
        : `${num(mt.totalMissed)} of ${num(mt.totalScheduled)} scheduled trips were missed (${mt.missedPct.toFixed(1)}%), affecting Routes ${formatRouteList(mt.byRoute.map(route => route.routeId))}.`
      : `No missed-trip summary was available in this dataset.`,
    apcIssueRoutes.length > 0
      ? `APC review flags were triggered on ${apcIssueRoutes.length} route${apcIssueRoutes.length === 1 ? '' : 's'} (${formatRouteList(apcIssueRoutes.map(route => route.routeId))}).`
      : 'No APC review flags were triggered yesterday.',
    worstOtpRoute
      ? `Lowest route OTP was ${worstOtpRoute.routeId} ${worstOtpRoute.routeName} at ${pct(worstOtpRoute.otp.onTimePercent)}.`
      : 'Route-level OTP details were unavailable.',
  ];

  return `
    ${sectionHeader('Yesterday at a Glance', 'Quick management summary of the previous service day')}
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
      <div style="margin-bottom:10px;">
        <span style="display:inline-block;background:${statusBg};color:${statusColor};padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${statusLabel}</span>
      </div>
      ${bullets.map(item => `
        <div style="font-size:13px;line-height:1.5;color:#374151;margin:6px 0;">
          <span style="color:#2563eb;font-weight:700;margin-right:6px;">•</span>${item}
        </div>
      `).join('')}
    </div>`;
}

function buildDwellKpiCard(latestDay: DailySummary, trendDays: DailySummary[]): string {
  const dwell = latestDay.byOperatorDwell;
  const testingNote = '<div style="font-size:10px;color:#9ca3af;margin-top:3px;">Operator dwell metric under testing.</div>';

  if (!dwell) {
    return `
      <td style="width:50%;padding:6px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center;border-left:3px solid #0891b2;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Operator Dwell</div>
          <div style="font-size:24px;font-weight:700;color:#111827;margin:4px 0;">—</div>
          <div style="font-size:11px;color:#9ca3af;">No dwell data</div>
          ${testingNote}
        </div>
      </td>`;
  }

  const totalHours = (dwell.totalTrackedDwellMinutes / 60).toFixed(1);
  const highCount = dwell.byOperator.reduce((sum, operator) => sum + operator.highCount, 0);
  const moderateCount = dwell.byOperator.reduce((sum, operator) => sum + operator.moderateCount, 0);

  let accentColor = '#0891b2';
  let valueColor = '#111827';
  let averageLine = '';

  const sameDayTypeDays = trendDays.filter(day =>
    day.date >= DWELL_AVG_BASELINE_START_DATE
    && day.dayType === latestDay.dayType
    && typeof day.byOperatorDwell?.totalTrackedDwellMinutes === 'number'
  );

  if (sameDayTypeDays.length > 0) {
    const averageMinutes = sameDayTypeDays.reduce(
      (sum, day) => sum + (day.byOperatorDwell?.totalTrackedDwellMinutes ?? 0),
      0,
    ) / sameDayTypeDays.length;
    const dayTypeLabel = latestDay.dayType === 'weekday'
      ? 'Weekday'
      : latestDay.dayType === 'saturday'
        ? 'Saturday'
        : 'Sunday';

    if (averageMinutes > 0 && dwell.totalTrackedDwellMinutes > (averageMinutes * 1.5)) {
      accentColor = '#d97706';
      valueColor = '#d97706';
      averageLine = `<div style="font-size:10px;color:#d97706;margin-top:3px;">&#9650; ${dayTypeLabel} avg: ${(averageMinutes / 60).toFixed(1)} hrs</div>`;
    } else {
      averageLine = `<div style="font-size:10px;color:#b0b8c4;margin-top:3px;">${dayTypeLabel} avg: ${(averageMinutes / 60).toFixed(1)} hrs</div>`;
    }
  }

  return `
    <td style="width:50%;padding:6px;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center;border-left:3px solid ${accentColor};">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Operator Dwell</div>
        <div style="font-size:24px;font-weight:700;color:${valueColor};margin:4px 0;">${totalHours} hrs</div>
        <div style="font-size:11px;color:#9ca3af;">${highCount} high · ${moderateCount} moderate</div>
        ${averageLine}
        ${testingNote}
      </div>
      </td>`;
}

function formatDwellHours(totalSeconds: number): string {
  return (totalSeconds / 3600).toFixed(1);
}

function isReportableDwellIncident(incident: DwellIncident): boolean {
  return incident.severity === 'moderate' || incident.severity === 'high';
}

function getReportableDwellIncidents(day: DailySummary): DwellIncident[] {
  return (day.byOperatorDwell?.incidents ?? []).filter(isReportableDwellIncident);
}

function getDailyReportableDwellSeconds(day: DailySummary): number {
  return getReportableDwellIncidents(day)
    .reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0);
}

function buildRouteDwellMap(day: DailySummary): Map<string, number> {
  const totals = new Map<string, number>();

  for (const incident of getReportableDwellIncidents(day)) {
    const routeId = incident.routeId?.trim();
    if (!routeId) continue;
    totals.set(routeId, (totals.get(routeId) ?? 0) + incident.trackedDwellSeconds);
  }

  return totals;
}

function parseServiceHour(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;

  const hour = Number.parseInt(match[1] || '', 10);
  const minute = Number.parseInt(match[2] || '', 10);
  const second = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
  if (hour < 0 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  return hour % 24;
}

function buildHourlyDwellMap(day: DailySummary): Map<number, number> {
  const totals = new Map<number, number>();

  for (const incident of getReportableDwellIncidents(day)) {
    const hour = parseServiceHour(incident.observedDepartureTime);
    if (hour === null) continue;
    totals.set(hour, (totals.get(hour) ?? 0) + incident.trackedDwellSeconds);
  }

  return totals;
}

function buildTrendRows(trendDays: DailySummary[]): Array<{
  day: DailySummary;
  dwellSeconds: number;
  rollingAverageSeconds: number;
}> {
  const dwellSeconds = trendDays.map(getDailyReportableDwellSeconds);

  return trendDays.map((day, index) => {
    const windowStart = Math.max(0, index - 6);
    const window = dwellSeconds.slice(windowStart, index + 1);
    const windowAverage = window.length > 0
      ? window.reduce((sum, value) => sum + value, 0) / window.length
      : 0;

    return {
      day,
      dwellSeconds: dwellSeconds[index] ?? 0,
      rollingAverageSeconds: windowAverage,
    };
  });
}

/** Horizontal stacked bar showing early/on-time/late distribution */
function otpBar(earlyPct: number, onTimePct: number, latePct: number): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
      <tr>
        <td style="background:#f59e0b;height:18px;width:${earlyPct}%;border-radius:4px 0 0 4px;text-align:center;">
          ${earlyPct >= 8 ? `<span style="font-size:10px;color:#fff;font-weight:600;">${pct(earlyPct)}</span>` : ''}
        </td>
        <td style="background:#10b981;height:18px;width:${onTimePct}%;text-align:center;">
          <span style="font-size:10px;color:#fff;font-weight:600;">${pct(onTimePct)}</span>
        </td>
        <td style="background:#ef4444;height:18px;width:${latePct}%;border-radius:0 4px 4px 0;text-align:center;">
          ${latePct >= 8 ? `<span style="font-size:10px;color:#fff;font-weight:600;">${pct(latePct)}</span>` : ''}
        </td>
      </tr>
      <tr>
        <td colspan="3" style="padding-top:3px;">
          <div style="font-size:10px;color:#9ca3af;text-align:center;">
            <span style="color:#f59e0b;">● Early ${pct(earlyPct)}</span> &nbsp;
            <span style="color:#10b981;">● On Time ${pct(onTimePct)}</span> &nbsp;
            <span style="color:#ef4444;">● Late ${pct(latePct)}</span>
          </div>
        </td>
      </tr>
    </table>`;
}

function buildMissedTripsTable(latestDay: DailySummary, trendDays: DailySummary[]): string {
  const mt = latestDay.missedTrips;
  if (!mt || mt.totalScheduled <= 0) return '';
  const impactedRoutes = mt.trips?.map(trip => trip.routeId) ?? mt.byRoute.map(route => route.routeId);
  const missedTripSummary = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;">
      <tr>
        <td style="width:25%;padding:0 4px 8px 0;">
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Missed Trips</div>
            <div style="font-size:22px;font-weight:700;color:#111827;margin-top:2px;">${num(mt.totalMissed)}</div>
          </div>
        </td>
        <td style="width:25%;padding:0 0 8px 4px;">
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">No Data Recorded</div>
            <div style="font-size:22px;font-weight:700;color:#991b1b;margin-top:2px;">${num(mt.notPerformedCount)}</div>
          </div>
        </td>
      </tr>
      <tr>
        <td style="width:25%;padding:0 4px 0 0;">
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Late 15+ Min</div>
            <div style="font-size:22px;font-weight:700;color:#92400e;margin-top:2px;">${num(mt.lateOver15Count)}</div>
          </div>
        </td>
        <td style="width:75%;padding:0 0 0 4px;">
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Impacted Routes</div>
            <div style="font-size:14px;font-weight:700;color:#111827;margin-top:4px;">${formatRouteList(impactedRoutes, 6)}</div>
          </div>
        </td>
      </tr>
    </table>`;

  if (mt.totalMissed === 0) {
    return `
      ${sectionHeader('Missed Trips', `0 of ${num(mt.totalScheduled)} scheduled trips missed (0.0%)`)}
      ${missedTripSummary}
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 12px;">
        <div style="font-size:12px;font-weight:700;color:#166534;">All scheduled trips operated.</div>
        <div style="font-size:11px;color:#15803d;margin-top:2px;">No missed trips were detected for this service day.</div>
      </div>`;
  }

  const departureSortMinutes = (time: string): number => {
    const [hRaw, mRaw] = time.split(':');
    const h = Number.parseInt(hRaw || '0', 10);
    const m = Number.parseInt(mRaw || '0', 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.MAX_SAFE_INTEGER;
    const base = (h * 60) + m;
    return base <= 180 ? base + (24 * 60) : base;
  };

  const sortTrips = (trips: typeof mt.trips) =>
    [...(trips || [])].sort((a, b) => {
      const depCmp = departureSortMinutes(a.departure) - departureSortMinutes(b.departure);
      if (depCmp !== 0) return depCmp;
      const routeCmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
      if (routeCmp !== 0) return routeCmp;
      return a.tripId.localeCompare(b.tripId);
    });

  const allTrips = mt.trips || [];

  // Split into two categories
  const lateTrips = sortTrips(allTrips.filter(t => t.missType === 'late_over_15'));
  const noDataTrips = sortTrips(allTrips.filter(t => t.missType === 'not_performed'));

  // Late trips table is built from a rolling multi-day window (min 3 days).
  const tripDaysWithRows = trendDays.filter(d => (d.missedTrips?.trips?.length ?? 0) > 0);
  const lateTrendDays = tripDaysWithRows.slice(-7);
  const canBuildLateTrend = lateTrendDays.length >= 3;
  const lateTrendRangeLabel = lateTrendDays.length > 0
    ? `${formatDate(lateTrendDays[0].date)} to ${formatDate(lateTrendDays[lateTrendDays.length - 1].date)}`
    : '';

  type LateTrendAggregate = {
    routeId: string;
    departure: string;
    occurrences: number;
    totalLateMinutes: number;
    lateSamples: number;
  };

  const lateTrendMap = new Map<string, LateTrendAggregate>();
  if (canBuildLateTrend) {
    for (const day of lateTrendDays) {
      const dayTrips = day.missedTrips?.trips || [];
      for (const t of dayTrips) {
        if (t.missType !== 'late_over_15') continue;
        const key = `${t.routeId}|${t.departure}`;
        const prev = lateTrendMap.get(key);
        if (!prev) {
          lateTrendMap.set(key, {
            routeId: t.routeId,
            departure: t.departure,
            occurrences: 1,
            totalLateMinutes: t.lateByMinutes ?? 0,
            lateSamples: t.lateByMinutes ? 1 : 0,
          });
        } else {
          prev.occurrences += 1;
          if (t.lateByMinutes) {
            prev.totalLateMinutes += t.lateByMinutes;
            prev.lateSamples += 1;
          }
        }
      }
    }
  }

  const lateTrendRows = [...lateTrendMap.values()].sort((a, b) => {
    const occCmp = b.occurrences - a.occurrences;
    if (occCmp !== 0) return occCmp;
    const aAvg = a.lateSamples > 0 ? a.totalLateMinutes / a.lateSamples : 0;
    const bAvg = b.lateSamples > 0 ? b.totalLateMinutes / b.lateSamples : 0;
    const avgCmp = bAvg - aAvg;
    if (avgCmp !== 0) return avgCmp;
    const depCmp = departureSortMinutes(a.departure) - departureSortMinutes(b.departure);
    if (depCmp !== 0) return depCmp;
    return a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
  });

  // If we have trip-level data, render the two-section layout
  if (allTrips.length > 0) {
    let html = sectionHeader('Missed Trips', `${num(mt.totalMissed)} of ${num(mt.totalScheduled)} scheduled trips missed (${mt.missedPct.toFixed(1)}%)`);
    html += missedTripSummary;

    // --- Late departures (15+ min), aggregated over a multi-day window ---
    if (canBuildLateTrend && lateTrendRows.length > 0) {
      const totalLateOccurrences = lateTrendRows.reduce((sum, row) => sum + row.occurrences, 0);
      const lateRows = lateTrendRows.map((t, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        const avgDelay = t.lateSamples > 0
          ? `${Math.round(t.totalLateMinutes / t.lateSamples)} min`
          : '15+ min';
        return `
        <tr style="background:${bg};">
          <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${t.routeId}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${t.departure}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(t.occurrences)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#d97706;border-bottom:1px solid #f3f4f6;">${avgDelay}</td>
        </tr>`;
      }).join('');

      html += `
      <div style="font-size:12px;font-weight:600;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 10px;margin:8px 0 6px;">Late Departures (15+ min) — ${num(totalLateOccurrences)} occurrence${totalLateOccurrences !== 1 ? 's' : ''} over ${lateTrendDays.length} days</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:6px;">Window: ${lateTrendRangeLabel}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:12px;">
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Sched. Departure</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Late Trips</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Avg Delay</th>
        </tr>
        ${lateRows}
      </table>`;
    } else if (!canBuildLateTrend && lateTrips.length > 0) {
      html += `
      <div style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 10px;margin:8px 0 12px;">
        Late departures table is shown after at least 3 days of trip-level data (currently ${lateTrendDays.length} day${lateTrendDays.length === 1 ? '' : 's'}).
      </div>`;
    }

    // --- No data trips ---
    if (noDataTrips.length > 0) {
      const noDataRows = noDataTrips.map((t, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        return `
        <tr style="background:${bg};">
          <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${t.routeId}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${t.departure}</td>
        </tr>`;
      }).join('');

      html += `
      <div style="font-size:12px;font-weight:600;color:#991b1b;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:8px 10px;margin:8px 0 6px;">No Data Recorded — ${num(noDataTrips.length)} trip${noDataTrips.length !== 1 ? 's' : ''}</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:6px;">No AVL/APC records found for these scheduled trips.</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Sched. Departure</th>
        </tr>
        ${noDataRows}
      </table>`;
    }

    return html;
  }

  // Fallback: no trip-level data, show route-level summary
  const fallbackRows = mt.byRoute.length > 0
    ? mt.byRoute.map((r, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${r.routeId}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(r.count)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6;">${r.earliestDep}</td>
      </tr>`;
    }).join('')
    : `
      <tr style="background:#ffffff;">
        <td colspan="3" style="padding:10px;font-size:12px;color:#6b7280;text-align:center;border-bottom:1px solid #f3f4f6;">
          Trip-level missed-trip rows are unavailable in this dataset.
        </td>
      </tr>`;

  return `
    ${sectionHeader('Missed Trips', `${num(mt.totalMissed)} of ${num(mt.totalScheduled)} scheduled trips missed (${mt.missedPct.toFixed(1)}%)`)}
    ${missedTripSummary}
    <div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Trip-level rows unavailable; showing route-level summary for this dataset.</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Missed Trips</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Earliest Departure</th>
      </tr>
      ${fallbackRows}
    </table>`;
}

function buildHourlyTable(byHour: HourMetrics[], totalServiceHours: number, dwellByHour: Map<number, number>): string {
  const active = byHour.filter(h => h.boardings > 0).sort((a, b) => a.hour - b.hour);
  if (active.length === 0) return '';

  const peakHour = active.reduce((a, b) => b.boardings > a.boardings ? b : a);
  const maxBoards = peakHour.boardings;
  const serviceHoursPerHour = active.length > 0 ? totalServiceHours / active.length : 1;

  const rows = active.map((h, i) => {
    const hourLabel = `${h.hour.toString().padStart(2, '0')}:00`;
    const isPeak = h.hour === peakHour.hour;
    const bg = isPeak ? '#ecfdf5' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
    // Scale bars relative to peak hour for clear differentiation
    const barWidth = maxBoards > 0 ? Math.max(3, Math.round((h.boardings / maxBoards) * 100)) : 3;
    const bph = serviceHoursPerHour > 0 ? (h.boardings / serviceHoursPerHour).toFixed(1) : '—';
    const dwellHours = formatDwellHours(dwellByHour.get(h.hour) ?? 0);
    return `
      <tr style="background:${bg};">
        <td style="padding:5px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;font-weight:${isPeak ? '700' : '400'};">${hourLabel}${isPeak ? ' ★' : ''}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(h.boardings)}</td>
        <td style="padding:5px 10px;font-size:12px;border-bottom:1px solid #f3f4f6;">
          <div style="background:#06b6d4;height:24px;width:${barWidth}%;border-radius:3px;min-width:4px;"></div>
        </td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;font-weight:600;color:#0891b2;border-bottom:1px solid #f3f4f6;">${bph}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${dwellHours}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${h.otp.total > 0 ? otpPill(h.otp.onTimePercent) : '<span style="color:#d1d5db;">—</span>'}</td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader('Boardings by Hour', `Peak: ${peakHour.hour.toString().padStart(2, '0')}:00 with ${num(peakHour.boardings)} boardings`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Hour</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Boards</th>
        <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;"></th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">BPH</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Dwell (hrs)</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
      </tr>
      ${rows}
    </table>`;
}

function buildRouteScorecard(routes: RouteMetrics[], dwellByRoute: Map<string, number>): string {
  const routesWithBph = routes.map(r => ({
    ...r,
    bph: r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0,
  }));
  const sorted = [...routesWithBph].sort((a, b) => b.bph - a.bph);

  const rows = sorted.map((r, i) => {
    const discrepancyPct = apcDiscrepancyPctForRoute(r);
    const apcStatus = apcStatusForRoute(r);
    const issueSide = apcIssueSideForRoute(r, apcStatus);
    const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    const dwellHours = formatDwellHours(dwellByRoute.get(r.routeId) ?? 0);
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${r.routeId}</td>
        <td style="padding:6px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${r.routeName}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(r.otp.onTimePercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6;">${pct(r.otp.earlyPercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6;">${pct(r.otp.latePercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;${apcIssueCellStyle(apcStatus, issueSide === 'boards')}">${num(r.ridership)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;${apcIssueCellStyle(apcStatus, issueSide === 'alights')}">${num(r.alightings)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${dwellHours}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;${apcStatusCellStyle(apcStatus)}">
          ${apcPill(apcStatus)}
          <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${pct(discrepancyPct)} gap</div>
        </td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${bphPill(r.bph)}</td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader('Route Scorecard', 'Sorted by BPH (highest to lowest) — APC review at 25% gap, suspect at 50% gap')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Early</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Late</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Boards</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Alights</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Dwell (hrs)</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">APC</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">BPH</th>
      </tr>
      ${rows}
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">Dwell hours reflect moderate/high dwell incidents only. APC status is based on the daily difference between route boardings and alightings. For review/suspect rows, only the lower of Boards/Alights is highlighted.</div>`;
}

function buildTopStops(stops: StopMetrics[]): string {
  if (stops.length === 0) return '';

  const hubMerged = mergeHubStops(stops);

  const busiestStops = [...hubMerged].sort((a, b) => b.boardings - a.boardings).slice(0, 10);
  const worstOtpStops = [...hubMerged]
    .filter(s => s.otp.total >= 10)
    .sort((a, b) => a.otp.onTimePercent - b.otp.onTimePercent)
    .slice(0, 5);

  let html = sectionHeader('Stop Highlights', 'Busiest stops and lowest-performing timepoints');

  // Busiest stops
  html += `<div style="font-size:11px;font-weight:600;color:#1e3a5f;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Busiest Stops</div>`;
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:12px;">
    <tr style="background:#f9fafb;">
      <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Stop</th>
      <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Boards</th>
      <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Alights</th>
      <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Routes</th>
    </tr>
    ${busiestStops.map((s, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:5px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${stopLabel(s.stopName, s.stopId)}</td>
      <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(s.boardings)}</td>
      <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(s.alightings)}</td>
      <td style="padding:5px 10px;font-size:12px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6;">${s.routeCount}</td>
    </tr>`).join('')}
  </table>`;

  // Worst OTP stops
  if (worstOtpStops.length > 0 && worstOtpStops[0].otp.onTimePercent < 85) {
    html += `<div style="font-size:11px;font-weight:600;color:#1e3a5f;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Lowest OTP Stops</div>`;
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Stop</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Measured</th>
      </tr>
      ${worstOtpStops.filter(s => s.otp.onTimePercent < 85).map((s, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="padding:5px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${stopLabel(s.stopName, s.stopId)}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(s.otp.onTimePercent)}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6;">${num(s.otp.total)} obs</td>
      </tr>`).join('')}
    </table>`;
  }

  return html;
}

export function buildReportHtml(data: ReportData): string {
  const { latestDay, trendDays, teamName } = data;
  const sys = latestDay.system;
  // System totals
  const totalServiceHours = latestDay.byRoute.reduce((s, r) => s + r.serviceHours, 0);
  const dwellByRoute = buildRouteDwellMap(latestDay);
  const dwellByHour = buildHourlyDwellMap(latestDay);
  const trendRows = buildTrendRows(trendDays);

  // Derive date range label from trend data
  const dateRangeLabel = (() => {
    const days = trendDays.length;
    if (days <= 1) {
      // Single day — check if it's yesterday
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayDate = new Date(latestDay.date + 'T12:00:00');
      const diffMs = today.getTime() - dayDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 1) return 'Yesterday Service Data';
      if (diffDays === 0) return 'Today Service Data';
      return `${formatDateLong(latestDay.date)} Data`;
    }
    // Multi-day ranges
    if (days <= 7) return 'Past Week of Service Data';
    if (days <= 31) return 'Past Month of Service Data';
    return 'Historical Service Data';
  })();

  // Day type summary for multi-day
  const dayTypeLabel = trendDays.length <= 1
    ? `${latestDay.dayType.charAt(0).toUpperCase() + latestDay.dayType.slice(1)} Service`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;">
    <!-- Header -->
    <div style="background:#1e3a5f;padding:24px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;">${teamName}</div>
      <div style="font-size:16px;color:#93c5fd;margin-top:2px;">Daily Performance Report - ${formatReportDateLabel(latestDay.date)}</div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:6px;">
        For more information:
        <a href="https://transitscheduler.ca/#operations/performance" style="color:#bfdbfe;text-decoration:underline;">https://transitscheduler.ca/#operations/performance</a>
      </div>
      <div style="font-size:13px;color:#bfdbfe;margin-top:4px;">${dateRangeLabel}${dayTypeLabel ? ` · ${dayTypeLabel}` : ''}</div>
      <div style="margin-top:10px;display:inline-block;background:#fbbf24;color:#78350f;font-size:10px;font-weight:700;padding:3px 12px;border-radius:10px;letter-spacing:0.5px;">BETA</div>
    </div>

    <div style="padding:20px;">

      <!-- ═══ 1. KPI CARDS ═══ -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
        <tr>
          ${kpiCard('On-Time Performance', pct(sys.otp.onTimePercent), `${pct(sys.otp.earlyPercent)} early · ${pct(sys.otp.latePercent)} late`, otpColor(sys.otp.onTimePercent))}
          ${kpiCard('Total Ridership', num(sys.totalRidership), `${num(sys.totalAlightings)} alightings`)}
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
        <tr>
          ${(() => {
            const mt = latestDay.missedTrips;
            if (mt && mt.totalScheduled > 0) {
              const color = mt.missedPct < 2 ? '#16a34a' : mt.missedPct < 5 ? '#d97706' : '#dc2626';
              const subtitle = mt.totalMissed === 0
                ? '✓ All trips operated'
                : `${mt.totalMissed} missed (${mt.missedPct.toFixed(1)}%)`;
              return kpiCard('Trips Operated', mt.totalMissed === 0 ? `${num(mt.totalScheduled)}/${num(mt.totalScheduled)}` : `${num(mt.totalMatched)}/${num(mt.totalScheduled)}`, subtitle, color, color);
            }
            return kpiCard('Trips Operated', num(sys.tripCount), `${num(sys.vehicleCount)} vehicles · ${totalServiceHours.toFixed(1)} svc hrs`);
          })()}
          ${buildDwellKpiCard(latestDay, trendDays)}
        </tr>
      </table>

      <!-- OTP Distribution Bar -->
      ${otpBar(sys.otp.earlyPercent, sys.otp.onTimePercent, sys.otp.latePercent)}

      <!-- ═══ 2. EXECUTIVE SUMMARY ═══ -->
      ${buildExecutiveSummary(latestDay)}

      <!-- ═══ 3. ROUTE SCORECARD ═══ -->
      ${buildRouteScorecard(latestDay.byRoute, dwellByRoute)}

      <!-- ═══ 4. MISSED TRIPS ═══ -->
      ${buildMissedTripsTable(latestDay, trendDays)}

      <!-- ═══ 5. OTP TREND ═══ -->
      ${trendDays.length > 1 ? (() => {
        const recentTrend = trendRows.slice(-7);
        return `
      ${sectionHeader(`Last ${recentTrend.length} Days Trend`, 'Dwell reflects moderate/high incidents only')}
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Date</th>
          <th style="padding:6px 10px;text-align:center;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Shift</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Riders</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Dwell (hrs)</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">7-day Avg Dwell (hrs)</th>
        </tr>
        ${recentTrend.map(({ day, dwellSeconds, rollingAverageSeconds }, i) => {
          const isLatest = day.date === latestDay.date;
          const bg = isLatest ? '#eff6ff' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
          const dayLabel = day.dayType === 'weekday' ? 'Wk' : day.dayType === 'saturday' ? 'Sat' : 'Sun';
          return `
        <tr style="background:${bg};">
          <td style="padding:6px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;font-weight:${isLatest ? '700' : '400'};">${formatDate(day.date)}</td>
          <td style="padding:6px 10px;font-size:11px;text-align:center;color:#6b7280;border-bottom:1px solid #f3f4f6;">${dayLabel}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(day.system.otp.onTimePercent)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(day.system.totalRidership)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${formatDwellHours(dwellSeconds)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${formatDwellHours(rollingAverageSeconds)}</td>
        </tr>`;
        }).join('')}
      </table>`;
      })() : ''}

      <!-- ═══ 6. BOARDINGS BY HOUR ═══ -->
      ${buildHourlyTable(latestDay.byHour, totalServiceHours, dwellByHour)}

      <!-- ═══ 7. STOP HIGHLIGHTS ═══ -->
      ${buildTopStops(latestDay.byStop)}

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px;text-align:center;">
      <div style="font-size:11px;color:#9ca3af;">Generated by Scheduler 4 · ${new Date().toISOString().slice(0, 10)}</div>
      <div style="font-size:10px;color:#d1d5db;margin-top:2px;">BETA — Report format under active testing. Feedback welcome.</div>
    </div>
  </div>
</body>
</html>`;
}
