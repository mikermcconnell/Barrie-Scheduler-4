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

function getHubNameForStopId(stopId: string): string | null {
  const normalizedStopId = stopId.trim();
  if (!normalizedStopId) return null;

  for (const hub of HUBS) {
    if (hub.stopCodes.includes(normalizedStopId)) return hub.name;
  }

  return null;
}

/** Merge stops belonging to the same hub, summing boardings/alightings and averaging OTP */
function mergeHubStops(stops: StopMetrics[]): StopMetrics[] {
  const merged = new Map<string, StopMetrics>();
  const hubRouteSets = new Map<string, Set<string>>();
  const standalone: StopMetrics[] = [];

  for (const stop of stops) {
    const hubName = getHubNameForStopId(stop.stopId);
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

function kpiCard(label: string, value: string, subtitle?: string, accentColor = '#2563eb', subtitleColor?: string, icon = ''): string {
  const subColor = subtitleColor || '#9ca3af';
  const subWeight = subtitleColor ? 'font-weight:600;' : '';
  return `
    <td style="width:25%;padding:6px;vertical-align:top;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 12px;text-align:center;border-left:4px solid ${accentColor};box-shadow:0 2px 8px rgba(15,23,42,0.06);">
        ${icon ? `<div style="font-size:22px;line-height:1;margin-bottom:8px;">${icon}</div>` : ''}
        <div style="font-size:13px;color:#1e3a5f;font-weight:700;">${label}</div>
        <div style="font-size:28px;font-weight:800;color:${accentColor};margin:8px 0 4px;letter-spacing:-0.5px;">${value}</div>
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
    <div style="margin:22px 0 10px;">
      <div style="font-size:18px;font-weight:800;color:#082b63;">${title}</div>
      ${subtitle ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${subtitle}</div>` : ''}
    </div>`;
}

function cardWrap(content: string, bg = '#ffffff'): string {
  return `<div style="background:${bg};border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;box-shadow:0 2px 8px rgba(15,23,42,0.05);">${content}</div>`;
}

function deriveReportStatus(latestDay: DailySummary): {
  label: 'STABLE' | 'REVIEW' | 'NEEDS ATTENTION';
  tone: string;
  bg: string;
  color: string;
  border: string;
  message: string;
  attentionCount: number;
} {
  const mt = latestDay.missedTrips;
  const apcIssueRoutes = latestDay.byRoute.filter(route => apcStatusForRoute(route) !== 'ok');
  const lowOtpRoutes = latestDay.byRoute.filter(route => route.otp.onTimePercent < 85);
  const highDwellCount = getReportableDwellIncidents(latestDay).filter(incident => incident.severity === 'high').length;
  const attentionCount = (mt?.totalMissed ?? 0) + apcIssueRoutes.length + lowOtpRoutes.length + highDwellCount;

  if ((mt?.missedPct ?? 0) >= 5 || latestDay.system.otp.onTimePercent < 75) {
    return {
      label: 'NEEDS ATTENTION',
      tone: 'Critical',
      bg: '#fef2f2',
      color: '#991b1b',
      border: '#ef4444',
      message: `${attentionCount || 1} item${attentionCount === 1 ? '' : 's'} need attention`,
      attentionCount,
    };
  }

  if ((mt?.totalMissed ?? 0) > 0 || latestDay.system.otp.onTimePercent < 85 || apcIssueRoutes.length > 0 || highDwellCount > 0) {
    return {
      label: 'REVIEW',
      tone: 'Review',
      bg: '#fffbeb',
      color: '#92400e',
      border: '#f59e0b',
      message: `Mostly stable, ${attentionCount || 1} item${attentionCount === 1 ? '' : 's'} need attention`,
      attentionCount,
    };
  }

  return {
    label: 'STABLE',
    tone: 'Stable',
    bg: '#ecfdf5',
    color: '#166534',
    border: '#22c55e',
    message: 'Service delivery was stable',
    attentionCount: 0,
  };
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
  const status = deriveReportStatus(latestDay);
  const summaryLead = status.label === 'NEEDS ATTENTION'
    ? `Service delivery needs attention for ${formatDateLong(latestDay.date)}.`
    : status.label === 'REVIEW'
      ? `Service delivery was mostly stable on ${formatDateLong(latestDay.date)}, with a few items to review.`
      : `Service delivery was generally stable on ${formatDateLong(latestDay.date)}.`;

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
    ${sectionHeader('Yesterday at a Glance')}
    ${cardWrap(`
      <div style="margin-bottom:10px;">
        <span style="display:inline-block;background:${status.bg};color:${status.color};padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.3px;text-transform:uppercase;">${status.label}</span>
      </div>
      ${bullets.map(item => `
        <div style="font-size:13px;line-height:1.5;color:#374151;margin:6px 0;">
          <span style="color:#2563eb;font-weight:700;margin-right:6px;">•</span>${item}
        </div>
      `).join('')}`)}
    `;
}

function buildDwellKpiCard(latestDay: DailySummary, trendDays: DailySummary[]): string {
  const dwell = latestDay.byOperatorDwell;
  const testingNote = '<div style="font-size:10px;color:#9ca3af;margin-top:3px;">Operator dwell metric under testing.</div>';

  if (!dwell) {
    return `
      <td style="width:25%;padding:6px;vertical-align:top;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 12px;text-align:center;border-left:4px solid #0891b2;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
          <div style="font-size:22px;line-height:1;margin-bottom:8px;">⏱️</div>
          <div style="font-size:13px;color:#1e3a5f;font-weight:700;">Operator Dwell</div>
          <div style="font-size:28px;font-weight:800;color:#0891b2;margin:8px 0 4px;letter-spacing:-0.5px;">—</div>
          <div style="font-size:11px;color:#9ca3af;">No dwell data</div>
          ${testingNote}
        </div>
      </td>`;
  }

  const reportableIncidents = getReportableDwellIncidents(latestDay);
  const reportableSeconds = reportableIncidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0);
  const totalHours = (reportableSeconds / 3600).toFixed(1);
  const highCount = reportableIncidents.filter(incident => incident.severity === 'high').length;
  const moderateCount = reportableIncidents.filter(incident => incident.severity === 'moderate').length;

  let accentColor = '#0891b2';
  let valueColor = '#111827';
  let averageLine = '';

  const sameDayTypeDays = trendDays.filter(day =>
    day.date >= DWELL_AVG_BASELINE_START_DATE
    && day.dayType === latestDay.dayType
    && typeof day.byOperatorDwell?.totalTrackedDwellMinutes === 'number'
  );

  if (sameDayTypeDays.length > 0) {
    const averageSeconds = sameDayTypeDays.reduce((sum, day) => sum + getDailyReportableDwellSeconds(day), 0)
      / sameDayTypeDays.length;
    const dayTypeLabel = latestDay.dayType === 'weekday'
      ? 'Weekday'
      : latestDay.dayType === 'saturday'
        ? 'Saturday'
        : 'Sunday';

    if (averageSeconds > 0 && reportableSeconds > (averageSeconds * 1.5)) {
      accentColor = '#d97706';
      valueColor = '#d97706';
      averageLine = `<div style="font-size:10px;color:#d97706;margin-top:3px;">&#9650; ${dayTypeLabel} avg: ${(averageSeconds / 3600).toFixed(1)} hrs</div>`;
    } else {
      averageLine = `<div style="font-size:10px;color:#b0b8c4;margin-top:3px;">${dayTypeLabel} avg: ${(averageSeconds / 3600).toFixed(1)} hrs</div>`;
    }
  }

  return `
    <td style="width:25%;padding:6px;vertical-align:top;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 12px;text-align:center;border-left:4px solid ${accentColor};box-shadow:0 2px 8px rgba(15,23,42,0.06);">
        <div style="font-size:22px;line-height:1;margin-bottom:8px;">⏱️</div>
        <div style="font-size:13px;color:#1e3a5f;font-weight:700;">Operator Dwell</div>
        <div style="font-size:28px;font-weight:800;color:${valueColor};margin:8px 0 4px;letter-spacing:-0.5px;">${totalHours} hrs</div>
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
  const reportableFromIncidents = getReportableDwellIncidents(day)
    .reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0);

  if (reportableFromIncidents > 0) return reportableFromIncidents;

  const dwell = day.byOperatorDwell;
  if (!dwell) return 0;

  // Report snapshots intentionally strip older incident arrays to keep the email payload small.
  // Use the persisted reportable total for historical averages when detailed incidents are absent.
  if ((dwell.incidents?.length ?? 0) === 0 && typeof dwell.totalReportableDwellMinutes === 'number') {
    return dwell.totalReportableDwellMinutes * 60;
  }

  // Backward-compatible fallback for older report snapshots created before totalReportableDwellMinutes existed.
  if ((dwell.incidents?.length ?? 0) === 0 && typeof dwell.totalTrackedDwellMinutes === 'number') {
    return dwell.totalTrackedDwellMinutes * 60;
  }

  return reportableFromIncidents;
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

function buildStopDwellTable(day: DailySummary): string {
  type StopDwellRow = {
    stopName: string;
    stopId: string;
    routes: Set<string>;
    incidentCount: number;
    highCount: number;
    moderateCount: number;
    totalDwellSeconds: number;
  };

  const rowsByStop = new Map<string, StopDwellRow>();

  for (const incident of getReportableDwellIncidents(day)) {
    const stopId = incident.stopId?.trim() || '';
    const hubName = getHubNameForStopId(stopId);
    const stopName = hubName || incident.stopName?.trim() || 'Unknown stop';
    const displayStopId = hubName ? '' : stopId;
    const key = hubName ? `hub||${hubName}` : `${displayStopId}||${stopName}`;
    let row = rowsByStop.get(key);
    if (!row) {
      row = {
        stopName,
        stopId: displayStopId,
        routes: new Set<string>(),
        incidentCount: 0,
        highCount: 0,
        moderateCount: 0,
        totalDwellSeconds: 0,
      };
      rowsByStop.set(key, row);
    }

    if (incident.routeId?.trim()) row.routes.add(incident.routeId.trim());
    row.incidentCount += 1;
    row.totalDwellSeconds += incident.trackedDwellSeconds;
    if (incident.severity === 'high') row.highCount += 1;
    if (incident.severity === 'moderate') row.moderateCount += 1;
  }

  const rows = [...rowsByStop.values()]
    .filter(row => row.incidentCount >= 3 || row.totalDwellSeconds >= 1800)
    .sort((a, b) =>
      b.totalDwellSeconds - a.totalDwellSeconds
      || b.incidentCount - a.incidentCount
      || a.stopName.localeCompare(b.stopName)
    );

  if (rows.length === 0) return '';

  return `
    ${sectionHeader('Operator Dwell by Stop', 'Moderate/high dwell only; showing stops with 3+ incidents or at least 0.5 dwell hours')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Stop</th>
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Routes</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Incidents</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">High</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Moderate</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Dwell (hrs)</th>
      </tr>
      ${rows.map((row, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        const routes = [...row.routes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${stopLabel(row.stopName, row.stopId)}</td>
        <td style="padding:6px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${routes.length > 0 ? formatRouteList(routes, 5) : '—'}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(row.incidentCount)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#991b1b;border-bottom:1px solid #f3f4f6;">${num(row.highCount)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#92400e;border-bottom:1px solid #f3f4f6;">${num(row.moderateCount)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${formatDwellHours(row.totalDwellSeconds)}</td>
      </tr>`;
      }).join('')}
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">Dwell is grouped by STREETS stop/timepoint, merged across known terminal/platform groups, and displayed to 0.1 hours.</div>`;
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

function buildStatusBanner(latestDay: DailySummary): string {
  const status = deriveReportStatus(latestDay);
  const icon = status.label === 'STABLE' ? '✓' : status.label === 'REVIEW' ? '⚠' : '!';
  return `
    <div style="background:${status.bg};border:1px solid ${status.border};border-radius:10px;padding:12px 14px;margin:0 0 14px;color:${status.color};">
      <span style="display:inline-block;width:26px;font-size:20px;font-weight:800;vertical-align:middle;">${icon}</span>
      <span style="font-size:14px;font-weight:800;vertical-align:middle;">${status.label}</span>
      <span style="font-size:14px;color:#111827;vertical-align:middle;"> · ${status.message}</span>
    </div>`;
}

function buildActionFocus(latestDay: DailySummary): string {
  const actions: string[] = [];
  const mt = latestDay.missedTrips;
  const apcIssueRoutes = latestDay.byRoute
    .filter(route => apcStatusForRoute(route) !== 'ok')
    .sort((a, b) => apcDiscrepancyPctForRoute(b) - apcDiscrepancyPctForRoute(a));
  const lowestOtpRoute = [...latestDay.byRoute]
    .filter(route => route.otp.total > 0)
    .sort((a, b) => a.otp.onTimePercent - b.otp.onTimePercent)[0];
  const dwellRoutes = [...buildRouteDwellMap(latestDay).entries()]
    .filter(([, seconds]) => seconds >= 1800)
    .sort((a, b) => b[1] - a[1]);

  if (apcIssueRoutes[0]) {
    actions.push(`Check Route ${apcIssueRoutes[0].routeId} APC gap`);
  }
  if (lowestOtpRoute && lowestOtpRoute.otp.onTimePercent < 85) {
    actions.push(`Review Route ${lowestOtpRoute.routeId} late trips`);
  }
  if (mt && mt.totalMissed > 0) {
    actions.push(`Review ${num(mt.totalMissed)} missed trip${mt.totalMissed === 1 ? '' : 's'}`);
  }
  if (dwellRoutes[0]) {
    actions.push(`Check Route ${dwellRoutes[0][0]} operator dwell`);
  }

  const visibleActions = actions.length > 0
    ? actions.slice(0, 3)
    : ['No urgent follow-up flagged'];

  return `
    ${sectionHeader('Action Focus')}
    ${cardWrap(`
      ${visibleActions.map(action => `
        <div style="font-size:13px;line-height:1.5;color:#082b63;margin:9px 0;">
          <span style="display:inline-block;width:18px;height:18px;border:2px solid #60a5fa;border-radius:999px;text-align:center;line-height:15px;color:#2563eb;font-size:11px;font-weight:800;margin-right:8px;">✓</span>
          ${action}
        </div>
      `).join('')}
    `, '#eff6ff')}`;
}

function buildTrendTable(trendRows: Array<{ day: DailySummary; dwellSeconds: number; rollingAverageSeconds: number }>, latestDate: string): string {
  const recentTrend = trendRows.slice(-7);
  if (recentTrend.length <= 1) return '';

  const maxDwell = Math.max(...recentTrend.map(row => row.rollingAverageSeconds), 1);
  const rows = recentTrend.map(({ day, dwellSeconds, rollingAverageSeconds }, i) => {
    const isLatest = day.date === latestDate;
    const bg = isLatest ? '#eff6ff' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
    const sparkWidth = Math.max(8, Math.round((rollingAverageSeconds / maxDwell) * 64));
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 8px;font-size:11px;color:#374151;border-bottom:1px solid #f3f4f6;font-weight:${isLatest ? '800' : '600'};">${formatDate(day.date)}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(day.system.otp.onTimePercent)}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:right;color:#082b63;border-bottom:1px solid #f3f4f6;font-weight:${isLatest ? '800' : '600'};">${num(day.system.totalRidership)}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${formatDwellHours(dwellSeconds)}</td>
        <td style="padding:6px 8px;text-align:right;color:#374151;font-size:11px;border-bottom:1px solid #f3f4f6;">
          <span>${formatDwellHours(rollingAverageSeconds)}</span>
          <div style="height:4px;width:${sparkWidth}px;background:#2563eb;border-radius:999px;margin-left:auto;"></div>
        </td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader(`Last ${recentTrend.length} Days Trend`, 'Dwell reflects moderate/high incidents only')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 8px;text-align:left;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Date</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Riders</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Dwell</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb;">7-day</th>
      </tr>
      ${rows}
    </table>`;
}

/** Horizontal stacked bar showing early/on-time/late distribution */
function otpBar(earlyPct: number, onTimePct: number, latePct: number): string {
  return `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;box-shadow:0 2px 8px rgba(15,23,42,0.05);margin:10px 0 16px;">
      <div style="font-size:16px;font-weight:800;color:#082b63;margin-bottom:10px;">OTP Distribution</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#f59e0b;height:24px;width:${earlyPct}%;border-radius:5px 0 0 5px;text-align:center;">
            ${earlyPct >= 8 ? `<span style="font-size:11px;color:#fff;font-weight:700;">${pct(earlyPct)}</span>` : ''}
          </td>
          <td style="background:#18a765;height:24px;width:${onTimePct}%;text-align:center;">
            <span style="font-size:12px;color:#fff;font-weight:800;">${pct(onTimePct)}</span>
          </td>
          <td style="background:#ef4444;height:24px;width:${latePct}%;border-radius:0 5px 5px 0;text-align:center;">
            ${latePct >= 8 ? `<span style="font-size:11px;color:#fff;font-weight:700;">${pct(latePct)}</span>` : ''}
          </td>
        </tr>
      </table>
      <div style="text-align:center;font-size:11px;color:#6b7280;margin-top:12px;">
        <span style="color:#f59e0b;">●</span> Early ${pct(earlyPct)} &nbsp;
        <span style="color:#18a765;">●</span> On time ${pct(onTimePct)} &nbsp;
        <span style="color:#ef4444;">●</span> Late ${pct(latePct)}
      </div>
    </div>`;
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
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">Displayed dwell values are rounded to 0.1 hours.</div>`;
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
    const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    const dwellHours = formatDwellHours(dwellByRoute.get(r.routeId) ?? 0);
    return `
      <tr style="background:${bg};">
        <td style="padding:8px 10px;font-size:12px;font-weight:800;color:#082b63;border-bottom:1px solid #f3f4f6;">${r.routeId}</td>
        <td style="padding:8px 10px;font-size:12px;color:#1f2a44;border-bottom:1px solid #f3f4f6;">${r.routeName}</td>
        <td style="padding:8px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(r.otp.onTimePercent)}</td>
        <td style="padding:8px 10px;font-size:12px;text-align:right;color:#082b63;border-bottom:1px solid #f3f4f6;">${num(r.ridership)}</td>
        <td style="padding:8px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${dwellHours}</td>
        <td style="padding:8px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;${apcStatusCellStyle(apcStatus)}">
          ${apcPill(apcStatus)}
          <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${pct(discrepancyPct)} gap</div>
        </td>
        <td style="padding:8px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${bphPill(r.bph)}</td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader('Route Scorecard', 'Sorted by BPH (highest to lowest) — APC review at 25% gap, suspect at 50% gap')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.05);">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Riders</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Dwell (hrs)</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">APC</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">BPH</th>
      </tr>
      ${rows}
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">Dwell hours reflect moderate/high dwell incidents only. Displayed route dwell values are rounded to 0.1 hours. APC status is based on the daily difference between route boardings and alightings. For review/suspect rows, only the lower of Boards/Alights is highlighted.</div>`;
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
  const status = deriveReportStatus(latestDay);
  const missedTripsSection = latestDay.missedTrips && latestDay.missedTrips.totalMissed > 0
    ? buildMissedTripsTable(latestDay, trendDays)
    : '';

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
  const tripsOperatedValue = (() => {
    const mt = latestDay.missedTrips;
    if (mt && mt.totalScheduled > 0) return num(mt.totalMatched);
    return num(sys.tripCount);
  })();
  const tripsOperatedSubtitle = (() => {
    const mt = latestDay.missedTrips;
    if (mt && mt.totalScheduled > 0) {
      return mt.totalMissed === 0
        ? `${num(mt.totalScheduled)} scheduled · all operated`
        : `${num(mt.totalMissed)} missed of ${num(mt.totalScheduled)} scheduled`;
    }
    return `${num(sys.vehicleCount)} vehicles · ${totalServiceHours.toFixed(1)} svc hrs`;
  })();

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;">
    <!-- Header -->
    <div style="background:#082f69;padding:26px 24px 20px;text-align:center;border-bottom:4px solid #3b82f6;">
      <div style="display:inline-block;background:#2563eb;color:#ffffff;border-radius:10px;padding:7px 9px;font-size:24px;line-height:1;margin-bottom:8px;">🚌</div>
      <div style="font-size:30px;font-weight:900;color:#ffffff;line-height:1.15;">${teamName}</div>
      <div style="font-size:27px;font-weight:900;color:#ffffff;margin-top:8px;line-height:1.15;">Daily Performance Report</div>
      <div style="font-size:17px;color:#60a5fa;font-weight:800;margin-top:10px;">${formatDateLong(latestDay.date)}</div>
      <div style="margin-top:16px;">
        <a href="https://transitscheduler.ca/#operations/performance" style="display:inline-block;color:#ffffff;text-decoration:none;border:1px solid #60a5fa;border-radius:7px;padding:9px 16px;font-size:14px;font-weight:800;">Open full dashboard →</a>
      </div>
      <div style="font-size:13px;color:#dbeafe;font-weight:700;margin-top:14px;">${dateRangeLabel}${dayTypeLabel ? ` · ${dayTypeLabel}` : ''}</div>
    </div>

    <div style="padding:18px;background:#f8fafc;">

      ${buildStatusBanner(latestDay)}

      <!-- ═══ 1. KPI CARDS ═══ -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
        <tr>
          ${kpiCard('On-time performance', pct(sys.otp.onTimePercent), `${pct(sys.otp.earlyPercent)} early · ${pct(sys.otp.latePercent)} late`, otpColor(sys.otp.onTimePercent), undefined, '↻')}
          ${kpiCard('Total ridership', num(sys.totalRidership), `${num(sys.totalAlightings)} alightings`, '#2563eb', undefined, '👥')}
          ${kpiCard('Trips operated', tripsOperatedValue, tripsOperatedSubtitle, status.label === 'NEEDS ATTENTION' ? '#dc2626' : '#6d28d9', status.label === 'NEEDS ATTENTION' ? '#dc2626' : undefined, '🚌')}
          ${buildDwellKpiCard(latestDay, trendDays)}
        </tr>
      </table>

      <!-- OTP Distribution Bar -->
      ${otpBar(sys.otp.earlyPercent, sys.otp.onTimePercent, sys.otp.latePercent)}

      <!-- ═══ 2. EXECUTIVE SUMMARY ═══ -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:62%;padding:0 6px 0 0;vertical-align:top;">${buildExecutiveSummary(latestDay)}</td>
          <td style="width:38%;padding:0 0 0 6px;vertical-align:top;">${buildActionFocus(latestDay)}</td>
        </tr>
      </table>

      <!-- ═══ 3. ROUTE SCORECARD ═══ -->
      ${buildRouteScorecard(latestDay.byRoute, dwellByRoute)}

      <!-- ═══ 4. LAST 7 DAYS TREND ═══ -->
      ${buildTrendTable(trendRows, latestDay.date)}

      <!-- ═══ 5. BOARDINGS BY HOUR ═══ -->
      ${buildHourlyTable(latestDay.byHour, totalServiceHours, dwellByHour)}

      <!-- ═══ 6. MISSED TRIPS - EXCEPTION ONLY ═══ -->
      ${missedTripsSection}

      <!-- ═══ 7. OPERATOR DWELL BY STOP ═══ -->
      ${buildStopDwellTable(latestDay)}

      <!-- ═══ 8. STOP HIGHLIGHTS ═══ -->
      ${buildTopStops(latestDay.byStop)}

    </div>

    <!-- Footer -->
    <div style="background:#eaf2ff;border-top:1px solid #bfdbfe;padding:18px 22px;">
      <div style="font-size:13px;color:#0f3a76;font-weight:700;">Questions or feedback? Reply to this email or contact the Operations Planning team.</div>
      <div style="font-size:11px;color:#64748b;margin-top:5px;">This is an automated report. Generated by Scheduler 4 · ${new Date().toISOString().slice(0, 10)}</div>
    </div>
  </div>
</body>
</html>`;
}
