import { DailySummary, RouteMetrics, HourMetrics, StopMetrics, TripMetrics } from './types';

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
            <span style="color:#f59e0b;">● Early</span> &nbsp;
            <span style="color:#10b981;">● On Time</span> &nbsp;
            <span style="color:#ef4444;">● Late</span>
          </div>
        </td>
      </tr>
    </table>`;
}

function buildWorthWatching(latestDay: DailySummary): string {
  const belowTarget = latestDay.byRoute
    .filter(r => r.otp.onTimePercent < 85)
    .sort((a, b) => a.otp.onTimePercent - b.otp.onTimePercent)
    .slice(0, 5);

  const lateTrips = latestDay.byTrip
    .filter(t => t.otp.avgDeviationSeconds > 300)
    .sort((a, b) => b.otp.avgDeviationSeconds - a.otp.avgDeviationSeconds)
    .slice(0, 5);

  if (belowTarget.length === 0 && lateTrips.length === 0) {
    return `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-top:12px;">
        <div style="font-size:13px;font-weight:600;color:#16a34a;">All routes within OTP targets today</div>
      </div>`;
  }

  let html = `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:12px;">
      <div style="font-size:14px;font-weight:700;color:#92400e;margin-bottom:10px;">Worth Watching</div>`;

  if (belowTarget.length > 0) {
    html += `<div style="font-size:11px;font-weight:600;color:#78350f;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Routes Below 85% OTP</div>`;
    html += belowTarget.map(r =>
      `<div style="font-size:12px;color:#374151;margin-bottom:4px;padding:4px 0;border-bottom:1px solid #fef3c7;">
        <strong>${r.routeId} ${r.routeName}</strong>
        <span style="float:right;">${otpPill(r.otp.onTimePercent)} <span style="color:#9ca3af;font-size:11px;">${pct(r.otp.latePercent)} late</span></span>
      </div>`
    ).join('');
  }

  if (lateTrips.length > 0) {
    if (belowTarget.length > 0) html += `<div style="margin:10px 0 6px;border-top:1px solid #fde68a;"></div>`;
    html += `<div style="font-size:11px;font-weight:600;color:#78350f;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Late-Running Trips</div>`;
    html += lateTrips.map(t => {
      const delayMin = Math.round(t.otp.avgDeviationSeconds / 60);
      return `<div style="font-size:12px;color:#374151;margin-bottom:4px;padding:4px 0;border-bottom:1px solid #fef3c7;">
        <strong>${t.tripName}</strong>
        <span style="color:#9ca3af;font-size:11px;">Route ${t.routeId} · ${t.terminalDepartureTime}</span>
        <span style="float:right;color:#d97706;font-weight:600;">avg +${delayMin} min</span>
      </div>`;
    }).join('');
  }

  html += `</div>`;
  return html;
}

function buildHourlyTable(byHour: HourMetrics[]): string {
  const active = byHour.filter(h => h.boardings > 0).sort((a, b) => a.hour - b.hour);
  if (active.length === 0) return '';

  const peakHour = active.reduce((a, b) => b.boardings > a.boardings ? b : a);
  const totalBoards = active.reduce((s, h) => s + h.boardings, 0);

  const rows = active.map((h, i) => {
    const hourLabel = `${h.hour.toString().padStart(2, '0')}:00`;
    const isPeak = h.hour === peakHour.hour;
    const bg = isPeak ? '#ecfdf5' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
    const sharePct = totalBoards > 0 ? (h.boardings / totalBoards * 100) : 0;
    // Simple inline bar for visual weight
    const barWidth = Math.max(2, Math.round(sharePct * 2.5));
    return `
      <tr style="background:${bg};">
        <td style="padding:5px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;font-weight:${isPeak ? '700' : '400'};">${hourLabel}${isPeak ? ' ★' : ''}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(h.boardings)}</td>
        <td style="padding:5px 10px;font-size:12px;border-bottom:1px solid #f3f4f6;">
          <div style="background:#06b6d4;height:10px;width:${barWidth}%;border-radius:3px;min-width:4px;"></div>
        </td>
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
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
      </tr>
      ${rows}
    </table>`;
}

function buildRouteScorecard(routes: RouteMetrics[]): string {
  const sorted = [...routes].sort((a, b) => b.otp.onTimePercent - a.otp.onTimePercent);
  const routesWithBph = sorted.map(r => ({
    ...r,
    bph: r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0,
  }));

  const rows = routesWithBph.map((r, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${r.routeId}</td>
        <td style="padding:6px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${r.routeName}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(r.otp.onTimePercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#d97706;border-bottom:1px solid #f3f4f6;">${pct(r.otp.earlyPercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#dc2626;border-bottom:1px solid #f3f4f6;">${pct(r.otp.latePercent)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(r.ridership)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(r.alightings)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;font-weight:600;color:#0891b2;border-bottom:1px solid #f3f4f6;">${r.bph.toFixed(1)}</td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader('Route Scorecard', 'Sorted by OTP — all routes')}
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
      <td style="padding:5px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${s.stopName}</td>
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
        <td style="padding:5px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${s.stopName}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${otpPill(s.otp.onTimePercent)}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6;">${num(s.otp.total)} obs</td>
      </tr>`).join('')}
    </table>`;
  }

  return html;
}

function buildTripDetail(trips: TripMetrics[]): string {
  if (trips.length === 0) return '';

  // Highest ridership trips
  const busiestTrips = [...trips].sort((a, b) => b.boardings - a.boardings).slice(0, 8);

  // Highest load trips
  const highLoadTrips = [...trips].filter(t => t.maxLoad > 0).sort((a, b) => b.maxLoad - a.maxLoad).slice(0, 5);

  let html = sectionHeader('Trip Highlights', 'Busiest trips and highest loads');

  html += `<div style="font-size:11px;font-weight:600;color:#1e3a5f;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Busiest Trips</div>`;
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:12px;">
    <tr style="background:#f9fafb;">
      <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Trip</th>
      <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
      <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Depart</th>
      <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Boards</th>
      <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
    </tr>
    ${busiestTrips.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:5px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${t.tripName}</td>
      <td style="padding:5px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${t.routeId}</td>
      <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${t.terminalDepartureTime}</td>
      <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(t.boardings)}</td>
      <td style="padding:5px 10px;font-size:12px;text-align:right;border-bottom:1px solid #f3f4f6;">${t.otp.total > 0 ? otpPill(t.otp.onTimePercent) : '<span style="color:#d1d5db;">—</span>'}</td>
    </tr>`).join('')}
  </table>`;

  if (highLoadTrips.length > 0) {
    html += `<div style="font-size:11px;font-weight:600;color:#1e3a5f;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Highest Peak Load</div>`;
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Trip</th>
        <th style="padding:5px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Route</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Max Load</th>
        <th style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Boards</th>
      </tr>
      ${highLoadTrips.map((t, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="padding:5px 10px;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;">${t.tripName}</td>
        <td style="padding:5px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${t.routeId} · ${t.terminalDepartureTime}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;font-weight:700;color:#d97706;border-bottom:1px solid #f3f4f6;">${t.maxLoad}</td>
        <td style="padding:5px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(t.boardings)}</td>
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
          ${kpiCard('Trips Operated', num(sys.tripCount), `${num(sys.vehicleCount)} vehicles · ${totalServiceHours.toFixed(1)} svc hrs`)}
          ${kpiCard('System BPH', systemBph, `Peak load: ${num(sys.peakLoad)} · Avg: ${sys.avgSystemLoad.toFixed(1)}`)}
        </tr>
      </table>

      <!-- OTP Distribution Bar -->
      ${otpBar(sys.otp.earlyPercent, sys.otp.onTimePercent, sys.otp.latePercent)}

      <!-- ═══ 2. WORTH WATCHING ═══ -->
      ${buildWorthWatching(latestDay)}

      <!-- ═══ 3. OTP TREND ═══ -->
      ${trendDays.length > 1 ? `
      ${sectionHeader(`OTP Trend — Last ${trendDays.length} Days`)}
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Date</th>
          <th style="padding:6px 10px;text-align:center;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Day</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">OTP</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Riders</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Vehicles</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Peak Load</th>
        </tr>
        ${trendDays.map((day, i) => {
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
      </table>` : ''}

      <!-- ═══ 4. BOARDINGS BY HOUR ═══ -->
      ${buildHourlyTable(latestDay.byHour)}

      <!-- ═══ 5. ROUTE SCORECARD ═══ -->
      ${buildRouteScorecard(latestDay.byRoute)}

      <!-- ═══ 6. STOP HIGHLIGHTS ═══ -->
      ${buildTopStops(latestDay.byStop)}

      <!-- ═══ 7. TRIP HIGHLIGHTS ═══ -->
      ${buildTripDetail(latestDay.byTrip)}

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
