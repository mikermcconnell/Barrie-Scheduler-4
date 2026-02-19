import { DailySummary, RouteMetrics, HourMetrics, StopMetrics } from './types';

export interface ReportData {
  latestDay: DailySummary;
  trendDays: DailySummary[];
  teamName: string;
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

function kpiCard(label: string, value: string, subtitle?: string, accentColor?: string): string {
  const border = accentColor ? `border-left:3px solid ${accentColor};` : '';
  return `
    <td style="width:50%;padding:6px;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center;${border}">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="font-size:24px;font-weight:700;color:#111827;margin:4px 0;">${value}</div>
        ${subtitle ? `<div style="font-size:11px;color:#9ca3af;">${subtitle}</div>` : ''}
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
  if (value >= 30) return '#16a34a'; // green
  if (value >= 20) return '#d97706'; // amber
  return '#dc2626'; // red
}

function bphBg(value: number): string {
  if (value >= 30) return '#f0fdf4';
  if (value >= 20) return '#fffbeb';
  return '#fef2f2';
}

function bphPill(value: number): string {
  const bg = bphBg(value);
  const color = bphColor(value);
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px;">${value.toFixed(1)}</span>`;
}

function stopLabel(name: string, id: string): string {
  return `${name} <span style="color:#9ca3af;font-weight:400;">(${id})</span>`;
}

function sectionHeader(title: string, subtitle?: string): string {
  return `
    <div style="margin:24px 0 10px;">
      <div style="font-size:15px;font-weight:700;color:#1e3a5f;padding-bottom:4px;border-bottom:2px solid #e5e7eb;">${title}</div>
      ${subtitle ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${subtitle}</div>` : ''}
    </div>`;
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

function buildMissedTripsTable(latestDay: DailySummary): string {
  const mt = latestDay.missedTrips;
  if (!mt || mt.totalScheduled <= 0) return '';

  const trips = [...(mt.trips || [])].sort((a, b) => {
    const routeCmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (routeCmp !== 0) return routeCmp;
    const depCmp = a.departure.localeCompare(b.departure);
    if (depCmp !== 0) return depCmp;
    return a.tripId.localeCompare(b.tripId);
  });

  if (trips.length > 0) {
    const rows = trips.map((t, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${t.routeId}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${t.departure}</td>
        <td style="padding:6px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;">${t.tripId}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6;">${t.blockId || '—'}</td>
      </tr>`;
    }).join('');

    return `
    ${sectionHeader('Missed Trips', `${num(mt.totalMissed)} of ${num(mt.totalScheduled)} scheduled trips missed (${mt.missedPct.toFixed(1)}%)`)}
    <div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Each missed scheduled trip is listed below.</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Departure</th>
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Trip ID</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Block</th>
      </tr>
      ${rows}
    </table>`;
  }

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

function buildHourlyTable(byHour: HourMetrics[], totalServiceHours: number): string {
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
    return `
      <tr style="background:${bg};">
        <td style="padding:5px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;font-weight:${isPeak ? '700' : '400'};">${hourLabel}${isPeak ? ' ★' : ''}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(h.boardings)}</td>
        <td style="padding:5px 10px;font-size:12px;border-bottom:1px solid #f3f4f6;">
          <div style="background:#06b6d4;height:24px;width:${barWidth}%;border-radius:3px;min-width:4px;"></div>
        </td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;font-weight:600;color:#0891b2;border-bottom:1px solid #f3f4f6;">${bph}</td>
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
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
      </tr>
      ${rows}
    </table>`;
}

function buildRouteScorecard(routes: RouteMetrics[]): string {
  const routesWithBph = routes.map(r => ({
    ...r,
    bph: r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0,
  }));
  const sorted = [...routesWithBph].sort((a, b) => b.bph - a.bph);

  const rows = sorted.map((r, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${r.routeId}</td>
        <td style="padding:6px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${r.routeName}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(r.otp.onTimePercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6;">${pct(r.otp.earlyPercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6;">${pct(r.otp.latePercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(r.ridership)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(r.alightings)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${bphPill(r.bph)}</td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader('Route Scorecard', 'Sorted by BPH (highest to lowest) — all routes')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Early</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Late</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Boards</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Alights</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">BPH</th>
      </tr>
      ${rows}
    </table>`;
}

function buildTopStops(stops: StopMetrics[]): string {
  if (stops.length === 0) return '';

  const busiestStops = [...stops].sort((a, b) => b.boardings - a.boardings).slice(0, 8);
  const worstOtpStops = [...stops]
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
  const dq = latestDay.dataQuality;

  // System totals
  const totalServiceHours = latestDay.byRoute.reduce((s, r) => s + r.serviceHours, 0);
  const systemBph = totalServiceHours > 0 ? (sys.totalRidership / totalServiceHours).toFixed(1) : '—';

  // Data quality notes
  const qualityNotes: string[] = [];
  if (dq.loadCapped > 0) qualityNotes.push(`${num(dq.loadCapped)} load values capped`);
  if (dq.apcExcludedFromLoad > 0) qualityNotes.push(`${num(dq.apcExcludedFromLoad)} excluded from load (no APC)`);
  if (dq.missingAVL > 0) qualityNotes.push(`${num(dq.missingAVL)} missing AVL`);
  if (dq.missingAPC > 0) qualityNotes.push(`${num(dq.missingAPC)} missing APC`);
  if (dq.detourRecords > 0) qualityNotes.push(`${num(dq.detourRecords)} detour records`);
  if (dq.tripperRecords > 0) qualityNotes.push(`${num(dq.tripperRecords)} tripper records`);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;">
    <!-- Header -->
    <div style="background:#1e3a5f;padding:24px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;">${teamName}</div>
      <div style="font-size:16px;color:#93c5fd;margin-top:2px;">Daily Performance Report</div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:6px;">
        For more information:
        <a href="https://transitscheduler.ca/#fixed/performance" style="color:#bfdbfe;text-decoration:underline;">https://transitscheduler.ca/#fixed/performance</a>
      </div>
      <div style="font-size:13px;color:#bfdbfe;margin-top:4px;">${formatDateLong(latestDay.date)} · ${latestDay.dayType.charAt(0).toUpperCase() + latestDay.dayType.slice(1)} Service</div>
      <div style="margin-top:10px;display:inline-block;background:#fbbf24;color:#78350f;font-size:10px;font-weight:700;padding:3px 12px;border-radius:10px;letter-spacing:0.5px;">BETA — UNDER TESTING</div>
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
              return kpiCard('Trips Operated', `${num(mt.totalMatched)} / ${num(mt.totalScheduled)}`, `${mt.totalMissed} missed (${mt.missedPct.toFixed(1)}%)`, color);
            }
            return kpiCard('Trips Operated', num(sys.tripCount), `${num(sys.vehicleCount)} vehicles · ${totalServiceHours.toFixed(1)} svc hrs`);
          })()}
          ${kpiCard('System BPH', systemBph, `Peak load: ${num(sys.peakLoad)} · Avg: ${sys.avgSystemLoad.toFixed(1)}`)}
        </tr>
      </table>

      <!-- OTP Distribution Bar -->
      ${otpBar(sys.otp.earlyPercent, sys.otp.onTimePercent, sys.otp.latePercent)}

      <!-- ═══ 2. ROUTE SCORECARD ═══ -->
      ${buildRouteScorecard(latestDay.byRoute)}

      <!-- ═══ 3. MISSED TRIPS ═══ -->
      ${buildMissedTripsTable(latestDay)}

      <!-- ═══ 4. OTP TREND ═══ -->
      ${trendDays.length > 1 ? (() => {
        const recentTrend = trendDays.slice(-7);
        return `
      ${sectionHeader(`OTP Trend — Last ${recentTrend.length} Days`)}
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Date</th>
          <th style="padding:6px 10px;text-align:center;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Day</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Riders</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Vehicles</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Peak Load</th>
        </tr>
        ${recentTrend.map((day, i) => {
          const isLatest = day.date === latestDay.date;
          const bg = isLatest ? '#eff6ff' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
          const dayLabel = day.dayType === 'weekday' ? 'Wk' : day.dayType === 'saturday' ? 'Sat' : 'Sun';
          return `
        <tr style="background:${bg};">
          <td style="padding:6px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;font-weight:${isLatest ? '700' : '400'};">${formatDate(day.date)}</td>
          <td style="padding:6px 10px;font-size:11px;text-align:center;color:#6b7280;border-bottom:1px solid #f3f4f6;">${dayLabel}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(day.system.otp.onTimePercent)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(day.system.totalRidership)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(day.system.vehicleCount)}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(day.system.peakLoad)}</td>
        </tr>`;
        }).join('')}
      </table>`;
      })() : ''}

      <!-- ═══ 5. BOARDINGS BY HOUR ═══ -->
      ${buildHourlyTable(latestDay.byHour, totalServiceHours)}

      <!-- ═══ 6. STOP HIGHLIGHTS ═══ -->
      ${buildTopStops(latestDay.byStop)}

      <!-- ═══ 8. DATA QUALITY ═══ -->
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-top:20px;">
        <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:4px;">Data Quality Summary</div>
        <div style="font-size:11px;color:#9ca3af;">
          ${num(dq.totalRecords)} total records
          ${dq.inBetweenFiltered > 0 ? ` · ${num(dq.inBetweenFiltered)} in-between filtered` : ''}
          ${qualityNotes.length > 0 ? ` · ${qualityNotes.join(' · ')}` : ''}
        </div>
      </div>
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
