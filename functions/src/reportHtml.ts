import { DailySummary, RouteMetrics, StopMetrics, DwellIncident, TripMetrics } from './types';
import { FULL_LOAD } from '../../utils/performanceRouteLoad';
import type { FeaturedTrip } from './featuredTrip';
import { EMAIL_ICON_PNG } from './emailIconData';
import { apcDiscrepancyPctForRoute, apcStatusForRoute } from './routeApc';
import { buildGlance, type GlanceAction, type GlanceModel, type GlanceTone, type RouteHistoryDay } from './dailyGlance';
import { median, type WeeklyDwellSummary } from '../../utils/performanceDwellHistory';

export interface ReportData {
  latestDay: DailySummary;
  trendDays: DailySummary[];
  teamName: string;
  featuredTrip?: FeaturedTrip | null;
  weeklyDwell?: WeeklyDwellSummary | null;
  /** Full weekly dwell section (Monday emails); other days get one line in the dwell card. */
  showWeeklyDwellSection?: boolean;
  /** Route-level history; when present the glance section compares each route with its usual. */
  routeHistory?: RouteHistoryDay[];
  /** Latest day's trips, for late-trip patterns in the glance section. */
  latestTrips?: TripMetrics[];
  lastMissedTripDataDate?: string | null;
}

// Reset dwell comparison baselines from the current report rollout onward.
// The morning report currently uses 2026-03-09 as its latest service day.
const DWELL_AVG_BASELINE_START_DATE = '2026-03-09';
// Fixed height keeps all four KPI cards the same size; fits a "usual" line and a two-line detail.
const KPI_CARD_HEIGHT_PX = 200;
const DWELL_MEDIAN_MIN_DAYS = 3;
const DWELL_DAY_TYPE_LABEL: Record<DailySummary['dayType'], string> = {
  weekday: 'Weekday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/** Hub definitions — stops at the same hub get merged in stop rankings */
const HUBS: { name: string; stopCodes: string[] }[] = [
  { name: 'Park Place', stopCodes: ['777'] },
  { name: 'Barrie South GO', stopCodes: ['725'] },
  { name: 'Allandale Terminal', stopCodes: ['9003', '9004', '9005', '9006', '9009', '9012', '9013', '9014'] },
  { name: 'Downtown', stopCodes: ['1', '2', '10'] },
  { name: 'Georgian College', stopCodes: ['327', '328', '329', '330', '331', '335'] },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cloneStopMetrics(stop: StopMetrics): StopMetrics {
  return {
    ...stop,
    otp: { ...stop.otp },
    routes: [...stop.routes],
    routeBreakdown: stop.routeBreakdown?.map(row => ({
      ...row,
      hourlyBoardings: row.hourlyBoardings ? [...row.hourlyBoardings] : undefined,
      hourlyAlightings: row.hourlyAlightings ? [...row.hourlyAlightings] : undefined,
    })),
    hourlyBoardings: stop.hourlyBoardings ? [...stop.hourlyBoardings] : undefined,
    hourlyAlightings: stop.hourlyAlightings ? [...stop.hourlyAlightings] : undefined,
  };
}

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
      standalone.push(cloneStopMetrics(stop));
      continue;
    }

    const routeSet = hubRouteSets.get(hubName) ?? new Set<string>();
    stop.routes.forEach(route => {
      if (route) routeSet.add(route);
    });
    hubRouteSets.set(hubName, routeSet);

    const existing = merged.get(hubName);
    if (!existing) {
      merged.set(hubName, {
        ...cloneStopMetrics(stop),
        stopName: hubName,
        stopId: '',
      });
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

  for (const [hubName, stop] of merged) {
    const routes = Array.from(hubRouteSets.get(hubName) ?? []).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    stop.routes = routes;
    stop.routeCount = routes.length;
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

function earlyPctColor(value: number): string {
  if (value > 8) return '#78350f';
  if (value > 3) return '#92400e';
  return '#64748b';
}

function latePctColor(value: number): string {
  if (value > 15) return '#7f1d1d';
  if (value > 10) return '#991b1b';
  return '#64748b';
}

function routeOtpCell(otp: RouteMetrics['otp']): string {
  if (!otp || otp.total <= 0) {
    return `
      <div style="display:inline-block;min-width:104px;text-align:right;">
        <span style="color:#cbd5e1;font-size:12px;font-weight:700;">—</span>
        <div style="margin-top:4px;font-size:10px;line-height:1.35;color:#94a3b8;white-space:nowrap;">No OTP obs</div>
      </div>`;
  }

  return `
    <div class="otp-cell" style="display:inline-block;min-width:104px;text-align:right;">
      ${otpPill(otp.onTimePercent)}
      <div class="otp-split" style="margin-top:4px;font-size:10px;line-height:1.35;color:#64748b;white-space:nowrap;letter-spacing:0.01em;">
        <span style="font-weight:700;color:${earlyPctColor(otp.earlyPercent)};">${pct(otp.earlyPercent)}</span> early
        <span style="color:#cbd5e1;padding:0 4px;">•</span>
        <span style="font-weight:700;color:${latePctColor(otp.latePercent)};">${pct(otp.latePercent)}</span> late
      </div>
    </div>`;
}

type EmailIconName = 'bus' | 'performance' | 'ridership' | 'trips' | 'dwell';

const EMAIL_ICON_ALT: Record<EmailIconName, string> = {
  bus: 'Bus',
  performance: 'Clock',
  ridership: 'Riders',
  trips: 'Route',
  dwell: 'Stopwatch',
};

// Colour used when an icon has no PNG for the requested colour.
const EMAIL_ICON_DEFAULT_COLOR: Record<EmailIconName, string> = {
  bus: '#ffffff',
  performance: '#16a34a',
  ridership: '#2563eb',
  trips: '#6d28d9',
  dwell: '#0891b2',
};

const EMAIL_ICON_CID_PATTERN = /cid:icon-([a-z]+-[0-9a-f]{6})/g;

function emailIconKey(name: EmailIconName, color: string): string {
  const key = `${name}-${color.replace('#', '').toLowerCase()}`;
  return EMAIL_ICON_PNG[key] ? key : `${name}-${EMAIL_ICON_DEFAULT_COLOR[name].slice(1)}`;
}

/** Illustrated icon as an embedded PNG; `box` must match the size it was rendered at in generate-email-icons.mjs. */
function iconBadge(name: EmailIconName, color: string, box: number): string {
  return `<img src="cid:icon-${emailIconKey(name, color)}" width="${box}" height="${box}" alt="${EMAIL_ICON_ALT[name]}" style="display:inline-block;width:${box}px;height:${box}px;border:0;outline:none;text-decoration:none;vertical-align:middle;" />`;
}

/** Inline attachments for each icon the email references, for the mail extension's nodemailer. */
export function emailIconAttachments(html: string): Array<{ filename: string; content: string; encoding: 'base64'; contentType: 'image/png'; cid: string }> {
  const keys = new Set([...html.matchAll(EMAIL_ICON_CID_PATTERN)].map(match => match[1]));
  return [...keys]
    .filter(key => EMAIL_ICON_PNG[key])
    .map(key => ({
      filename: `${key}.png`,
      content: EMAIL_ICON_PNG[key],
      encoding: 'base64',
      contentType: 'image/png',
      cid: `icon-${key}`,
    }));
}

function kpiCard(label: string, value: string, subtitle?: string, accentColor = '#2563eb', subtitleColor?: string, icon?: EmailIconName, detail?: string): string {
  const subColor = subtitleColor || '#64748b';
  const subWeight = subtitleColor ? 'font-weight:600;' : '';
  return `
    <td class="kpi-cell" style="width:25%;height:${KPI_CARD_HEIGHT_PX}px;vertical-align:top;box-sizing:border-box;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 10px;text-align:center;border-left:4px solid ${accentColor};box-shadow:0 2px 8px rgba(15,23,42,0.06);overflow-wrap:break-word;word-break:break-word;">
        ${icon ? `<div style="line-height:1;margin-bottom:8px;">${iconBadge(icon, accentColor, 48)}</div>` : ''}
        <div style="font-size:13px;color:#1e3a5f;font-weight:700;">${label}</div>
        <div class="kpi-value" style="font-size:28px;font-weight:800;color:${accentColor};margin:8px 0 4px;letter-spacing:-0.5px;">${value}</div>
        ${subtitle ? `<div style="font-size:11px;color:${subColor};${subWeight}">${subtitle}</div>` : ''}
        ${detail ? `<div style="font-size:11px;color:#94a3b8;margin-top:5px;padding-top:5px;border-top:1px solid #f1f5f9;">${detail}</div>` : ''}
    </td>`;
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


function stopLabel(name: string, id: string): string {
  const safeName = escapeHtml(name);
  if (!id) return safeName;
  return `${safeName} <span style="color:#9ca3af;font-weight:400;">(${escapeHtml(id)})</span>`;
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

function routeIdFromText(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;

  const patterns = [
    /\broute\s+(\d{1,3}[A-Z]?)\b/i,
    /^(\d{1,3}[A-Z]?)(?=\b|\s|-)/i,
    /\b(\d{1,3}[A-Z]?)(?=\s*[-:])/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const routeId = match?.[1]?.toUpperCase();
    if (routeId) return routeId;
  }

  return null;
}

function getIncidentRouteId(incident: DwellIncident): string | null {
  return (
    incident.routeId?.trim()
    || routeIdFromText(incident.routeName)
    || routeIdFromText(incident.tripName)
    || routeIdFromText(incident.block)
  );
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
      : `Missed-trip data unavailable.`,
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

const DASHBOARD_OTP_URL = 'https://transitscheduler.ca/#operations/performance/otp';

const GLANCE_TONE_COLOR: Record<GlanceTone, string> = {
  neutral: '#64748b',
  good: '#16a34a',
  bad: '#dc2626',
  warn: '#d97706',
};
const GLANCE_SEVERITY_COLOR = { high: '#dc2626', medium: '#d97706', low: '#94a3b8' } as const;

function buildRouteDwellLeader(latestDay: DailySummary): { routeId: string | null; hours: number } {
  const [top] = [...buildRouteDwellMap(latestDay).entries()].sort((a, b) => b[1] - a[1]);
  return top ? { routeId: top[0], hours: top[1] / 3600 } : { routeId: null, hours: 0 };
}

/** Headline, shown directly under the header. */
function buildStatusStrip(glance: GlanceModel): string {
  return `
    <div style="background:#ffffff;border-bottom:1px solid #e5e7eb;padding:14px 20px;font-size:16px;font-weight:700;color:#0f172a;line-height:1.4;">
      ${escapeHtml(glance.headline)}
    </div>`;
}

/**
 * "What Stood Out": one item per finding. A route that ran well below its usual shows once,
 * with its late-trip detail, then the other follow-ups (missed trips, dwell, APC, data feed), then ongoing items.
 */
function buildGlanceFindings(glance: GlanceModel): string {
  const item = (severity: GlanceAction['severity'], title: string, detail: string | null, link?: string) => `
      <div style="background:#ffffff;border:1px solid #eef2f7;border-left:4px solid ${GLANCE_SEVERITY_COLOR[severity]};border-radius:8px;padding:9px 12px;margin:0 0 8px;">
        <div style="font-size:13px;line-height:1.45;color:#082b63;">${title}</div>
        ${detail ? `<div style="font-size:12px;color:#475569;line-height:1.45;margin-top:2px;">${escapeHtml(detail)}</div>` : ''}
        ${link ? `<div style="font-size:12px;margin-top:4px;"><a href="${link}" style="color:#2563eb;font-weight:600;text-decoration:none;">Open on-time dashboard &rarr;</a></div>` : ''}
      </div>`;

  const routeItems = glance.standouts.map(standout => {
    const action = glance.actions.find(entry => entry.routeId === standout.routeId);
    return item(
      action?.severity ?? 'medium',
      `<b>Route ${escapeHtml(standout.routeId)}</b> ${escapeHtml(standout.sentence)}`,
      // With no trip list the action detail only repeats the on-time sentence, so use the late pattern.
      standout.trips > 0 && action ? action.detail : standout.latePattern,
      action?.link,
    );
  });
  const otherItems = glance.actions
    .filter(action => !action.routeId)
    .map(action => item(action.severity, `<b>${escapeHtml(action.title)}</b>`, action.detail, action.link));
  const items = [...routeItems, ...otherItems];

  const body = items.length === 0
    ? '<div style="font-size:13px;line-height:1.5;color:#64748b;margin-bottom:8px;">No route ran well below its usual, and nothing new to follow up.</div>'
    : items.join('');
  const newTag = (routeId: string) => `<span style="background:#dbeafe;color:#1d4ed8;font-weight:700;padding:0 5px;border-radius:4px;">${escapeHtml(routeId)} new</span>`;
  const ongoing = glance.ongoing.length === 0 ? '' : `
    <div style="margin-top:6px;padding:10px 12px;background:#f8fafc;border-radius:8px;">
      <div style="font-size:11px;font-weight:800;color:#94a3b8;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:4px;">Ongoing</div>
      <div style="font-size:12px;line-height:1.55;color:#64748b;">
        ${glance.ongoing.map(entry => `${escapeHtml(entry.text)}${(entry.newRoutes ?? []).map(routeId => ` ${newTag(routeId)}`).join('')}`).join('<br>')}
      </div>
    </div>`;

  return `
    ${sectionHeader('What Stood Out')}
    ${cardWrap(`${body}${ongoing}`)}`;
}

/** Today's dwell rate against the same day type's median; null when there is no dwell data. */
function dwellComparison(latestDay: DailySummary, trendDays: DailySummary[]): {
  per100: number;
  typicalPer100: number | null;
  elevated: boolean;
} | null {
  if (!latestDay.byOperatorDwell || !(latestDay.system.tripCount > 0)) return null;
  const per100 = dwellMinutesPer100Trips(latestDay);

  // Compare per-100-trip rates, not raw hours, so busy and quiet days compare fairly.
  const priorSameDayTypeRates = trendDays
    .filter(day =>
      day.date >= DWELL_AVG_BASELINE_START_DATE
      && day.date < latestDay.date
      && day.dayType === latestDay.dayType
      && typeof day.byOperatorDwell?.totalTrackedDwellMinutes === 'number'
      && day.system.tripCount > 0
    )
    .map(dwellMinutesPer100Trips);
  const typicalPer100 = priorSameDayTypeRates.length >= DWELL_MEDIAN_MIN_DAYS
    ? median(priorSameDayTypeRates)
    : null;
  const elevated = typicalPer100 !== null && typicalPer100 > 0 && per100 > typicalPer100 * 1.5;
  return { per100, typicalPer100, elevated };
}

/** "usual 89.1% · normal" for a KPI card, from the glance comparison with this label. */
function usualLine(glance: GlanceModel | null, label: string): string | undefined {
  const comparison = glance?.comparisons.find(row => row.label === label);
  if (!comparison) return undefined;
  return `${escapeHtml(comparison.usual)} · <span style="color:${GLANCE_TONE_COLOR[comparison.tone]};font-weight:700;">${escapeHtml(comparison.verdict)}</span>`;
}

function buildDwellKpiCard(latestDay: DailySummary, trendDays: DailySummary[]): string {
  const comparison = dwellComparison(latestDay, trendDays);
  if (!comparison) {
    return kpiCard('Operator Dwell', '—', 'No dwell data', '#0891b2', undefined, 'dwell');
  }

  const totalHours = (getDailyReportableDwellSeconds(latestDay) / 3600).toFixed(1);
  const minutesPer100 = Math.round(comparison.per100);
  const { typicalPer100, elevated } = comparison;
  const accentColor = elevated ? '#d97706' : '#0891b2';
  const usual = typicalPer100 !== null
    ? `usual ${Math.round(typicalPer100)} · <span style="color:${elevated ? '#d97706' : GLANCE_TONE_COLOR.neutral};font-weight:700;">${elevated ? 'high' : 'normal'}</span>`
    : undefined;

  return kpiCard(
    'Operator Dwell',
    `${minutesPer100} <span style="font-size:12px;font-weight:700;">min / 100 trips</span>`,
    usual,
    accentColor,
    undefined,
    'dwell',
    `Total: ${totalHours} hrs`,
  );
}

function dwellMinutesPer100Trips(day: DailySummary): number {
  return (getDailyReportableDwellSeconds(day) / 60 / day.system.tripCount) * 100;
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
    const routeId = getIncidentRouteId(incident);
    if (!routeId) continue;
    totals.set(routeId, (totals.get(routeId) ?? 0) + incident.trackedDwellSeconds);
  }

  return totals;
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

const TREND_CHART_HEIGHT = 74;
const TREND_LABEL_HEIGHT = 14;
const TREND_BAR_MIN_PX = 2;
const TREND_OTP_SCALE_MIN = 70;
const TREND_OTP_SCALE_MAX = 100;
/** Each bar is compared with the same weekday over the 4 weeks before it. */
const TREND_BASELINE_WEEKS = 4;
const TREND_BASELINE_MIN_SAMPLES = 2;
const TREND_AVERAGE_LINE = '2px dashed #0f172a';
const DAY_MS = 24 * 60 * 60 * 1000;

type TrendVerdict = 'better' | 'worse' | 'usual';

const TREND_COLORS: Record<TrendVerdict, { latest: string; earlier: string }> = {
  better: { latest: '#16a34a', earlier: '#86efac' },
  worse: { latest: '#dc2626', earlier: '#fca5a5' },
  usual: { latest: '#64748b', earlier: '#cbd5e1' },
};

interface TrendBar {
  date: string;
  value: number | null;
  average: number | null;
  label: string;
  color: string;
}

interface TrendMetric {
  value: (day: DailySummary) => number | null;
  /** Differences smaller than this count as about usual. */
  isUsual: (value: number, average: number) => boolean;
  higherIsBetter: boolean;
  format: (value: number) => string;
}

/** Mean of the same weekday over the prior 4 weeks, or null when there are too few samples. */
function sameWeekdayAverage(date: string, history: DailySummary[], value: (day: DailySummary) => number | null): number | null {
  const time = Date.parse(`${date}T12:00:00Z`);
  const samples = history
    .filter(day => {
      const daysBack = Math.round((time - Date.parse(`${day.date}T12:00:00Z`)) / DAY_MS);
      return daysBack > 0 && daysBack % 7 === 0 && daysBack <= TREND_BASELINE_WEEKS * 7;
    })
    .map(value)
    .filter((sample): sample is number => sample !== null);
  if (samples.length < TREND_BASELINE_MIN_SAMPLES) return null;
  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
}

function trendBar(day: DailySummary, history: DailySummary[], metric: TrendMetric, latestDate: string): TrendBar {
  const value = metric.value(day);
  const average = sameWeekdayAverage(day.date, history, metric.value);
  let verdict: TrendVerdict = 'usual';
  if (value !== null && average !== null && !metric.isUsual(value, average)) {
    verdict = (value > average) === metric.higherIsBetter ? 'better' : 'worse';
  }
  const palette = TREND_COLORS[verdict];
  return {
    date: day.date,
    value,
    average,
    label: value === null ? '—' : metric.format(value),
    color: day.date === latestDate ? palette.latest : palette.earlier,
  };
}

function trendSegment(px: number, background: string, averageLine: boolean, rounded: boolean): string {
  if (px <= 0) return '';
  const lineStyle = averageLine ? `border-top:${TREND_AVERAGE_LINE};` : '';
  const radius = rounded ? 'border-radius:3px 3px 0 0;' : '';
  const height = averageLine ? Math.max(0, px - 2) : px;
  return `<div style="height:${height}px;margin:0 3px;background:${background};${lineStyle}${radius}font-size:0;line-height:0;">&nbsp;</div>`;
}

/** One small bar chart: a value label over each bar, a dashed same-weekday average, short weekday names under the axis. */
function buildTrendBarChart(title: string, bars: TrendBar[], heightFor: (value: number) => number, latestDate: string): string {
  const columns = bars.map(bar => {
    const isLatest = bar.date === latestDate;
    const height = bar.value === null
      ? 0
      : Math.min(TREND_CHART_HEIGHT, Math.max(TREND_BAR_MIN_PX, Math.round(heightFor(bar.value))));
    const averageHeight = bar.average === null
      ? null
      : Math.min(TREND_CHART_HEIGHT, Math.max(2, Math.round(heightFor(bar.average))));
    const label = `<div style="font-size:10px;line-height:${TREND_LABEL_HEIGHT}px;text-align:center;white-space:nowrap;color:${isLatest ? '#0f172a' : '#64748b'};font-weight:${isLatest ? 800 : 400};">${bar.label}</div>`;
    let block: string;
    if (averageHeight === null) {
      block = trendSegment(height, bar.color, false, true);
    } else if (averageHeight > height) {
      // Average above the bar: dashed line, empty space, then the bar.
      block = trendSegment(averageHeight - height, 'transparent', true, false) + trendSegment(height, bar.color, false, true);
    } else {
      // Average inside the bar: split the bar at the average.
      block = trendSegment(height - averageHeight, bar.color, false, true) + trendSegment(averageHeight, bar.color, true, height === averageHeight);
    }
    return `<td valign="bottom" style="height:${TREND_CHART_HEIGHT + TREND_LABEL_HEIGHT}px;padding:0;vertical-align:bottom;border-bottom:1px solid #9ca3af;">${label}${block}</td>`;
  }).join('');
  const days = bars.map(bar => {
    const isLatest = bar.date === latestDate;
    const weekday = new Date(`${bar.date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '');
    return `<td style="padding:3px 0 0;font-size:10px;text-align:center;color:${isLatest ? '#0f172a' : '#6b7280'};font-weight:${isLatest ? 800 : 400};">${weekday}</td>`;
  }).join('');

  return `
    <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">${title}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
      <tr>${columns}</tr>
      <tr>${days}</tr>
    </table>`;
}

function compactCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

const OTP_TREND: TrendMetric = {
  value: day => day.system.otp.onTimePercent,
  isUsual: (value, average) => Math.abs(value - average) < 1,
  higherIsBetter: true,
  format: value => value.toFixed(1),
};
const RIDERS_TREND: TrendMetric = {
  value: day => day.system.totalRidership,
  isUsual: (value, average) => average <= 0 || Math.abs(value - average) / average < 0.05,
  higherIsBetter: true,
  format: compactCount,
};
const DWELL_TREND: TrendMetric = {
  value: day => (day.system.tripCount > 0 && day.byOperatorDwell ? dwellMinutesPer100Trips(day) : null),
  isUsual: (value, average) => average <= 0 || Math.abs(value - average) / average < 0.1,
  higherIsBetter: false,
  format: value => String(Math.round(value)),
};

/** Last 7 days as three bar charts (on-time, riders, operator dwell), each against its same-weekday average. */
function buildTrendCharts(trendDays: DailySummary[], latestDate: string): string {
  const history = trendDays.filter(day => day.date <= latestDate);
  const days = [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);
  if (days.length < 2) return '';

  const otpBars = days.map(day => trendBar(day, history, OTP_TREND, latestDate));
  const riderBars = days.map(day => trendBar(day, history, RIDERS_TREND, latestDate));
  const dwellBars = days.map(day => trendBar(day, history, DWELL_TREND, latestDate));

  const chartMax = (bars: TrendBar[]): number => Math.max(0, ...bars.flatMap(bar => [bar.value ?? 0, bar.average ?? 0]));
  const scaled = (max: number) => (value: number): number => (max > 0 ? (value / max) * TREND_CHART_HEIGHT : 0);
  const otpHeight = (value: number): number =>
    ((value - TREND_OTP_SCALE_MIN) / (TREND_OTP_SCALE_MAX - TREND_OTP_SCALE_MIN)) * TREND_CHART_HEIGHT;
  const note = (text: string) => ` <span style="font-weight:400;color:#94a3b8;">${text}</span>`;
  const swatch = (color: string) =>
    `<span style="display:inline-block;width:9px;height:9px;background:${color};border-radius:2px;margin:0 4px 0 12px;vertical-align:middle;"></span>`;
  const hasAverage = [...otpBars, ...riderBars, ...dwellBars].some(bar => bar.average !== null);
  const legend = hasAverage
    ? `<div style="margin-top:10px;font-size:10px;color:#64748b;line-height:1.6;"><span style="display:inline-block;width:16px;border-top:${TREND_AVERAGE_LINE};vertical-align:middle;margin-right:4px;"></span>Average for the same day of the week, past 4 weeks${swatch(TREND_COLORS.better.earlier)}Better${swatch(TREND_COLORS.worse.earlier)}Worse${swatch(TREND_COLORS.usual.earlier)}About usual</div>`
    : '';

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
      <tr>
        <td style="width:33%;padding:0 11px 0 0;vertical-align:top;">${buildTrendBarChart(`On-time${note('(scale 70–100%)')}`, otpBars, otpHeight, latestDate)}</td>
        <td style="width:34%;padding:0 11px;vertical-align:top;">${buildTrendBarChart('Riders', riderBars, scaled(chartMax(riderBars)), latestDate)}</td>
        <td style="width:33%;padding:0 0 0 11px;vertical-align:top;">${buildTrendBarChart(`Operator dwell${note('(min / 100 trips)')}`, dwellBars, scaled(chartMax(dwellBars)), latestDate)}</td>
      </tr>
    </table>${legend}`;

  return `${sectionHeader(`Last ${days.length} Days`)}${cardWrap(content)}`;
}

const WEEKLY_DWELL_CHART_HEIGHT = 120;
const WEEKLY_DWELL_LAST_COLOR = '#d97706';
const WEEKLY_DWELL_EARLIER_COLOR = '#93c5fd';
const WEEKLY_DWELL_MEDIAN_LINE = '1px dashed #1f2937';
const WEEKLY_DWELL_WORSE_COLOR = '#b45309';
const WEEKLY_DWELL_BETTER_COLOR = '#15803d';
/** Trend changes smaller than this (percent) read as steady. */
const WEEKLY_DWELL_STEADY_PERCENT = 2;

function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

/** Plain-language rank: a higher percentile means more dwell, which is worse. */
function weeklyDwellRank(weekly: WeeklyDwellSummary): string {
  if (weekly.percentile >= 100) return `Most dwell of ${weekly.weeks.length} weeks`;
  if (weekly.percentile <= 0) return `Least dwell of ${weekly.weeks.length} weeks`;
  if (weekly.percentile >= 50) {
    return `Worse than ${Math.min(9, Math.max(5, Math.round(weekly.percentile / 10)))} in 10 weeks`;
  }
  return `Better than ${Math.min(9, Math.max(1, Math.round((100 - weekly.percentile) / 10)))} in 10 weeks`;
}

function weeklyDwellTrend(weekly: WeeklyDwellSummary): { label: string; color: string; accent: string } | null {
  if (weekly.trendPercent === null) return null;
  if (Math.abs(weekly.trendPercent) < WEEKLY_DWELL_STEADY_PERCENT) {
    return { label: 'Steady', color: '#374151', accent: '#9ca3af' };
  }
  const rounded = Math.round(Math.abs(weekly.trendPercent));
  return weekly.trendPercent > 0
    ? { label: `&#9650; ${rounded}%`, color: WEEKLY_DWELL_WORSE_COLOR, accent: '#d97706' }
    : { label: `&#9660; ${rounded}%`, color: WEEKLY_DWELL_BETTER_COLOR, accent: '#16a34a' };
}

/** One line for the Operator Dwell KPI card on days without the weekly section. */
/** Fixed-height card: title, big number, unit, and one grey detail line. */
function weeklyDwellTile(title: string, value: string, detail: string, valueColor: string, accent: string): string {
  return `
    <td style="width:33%;padding:4px;vertical-align:top;">
      <div style="height:104px;background:#ffffff;border:1px solid #e5e7eb;border-left:4px solid ${accent};border-radius:10px;padding:10px 12px;">
        <div style="font-size:12px;color:#1e3a5f;font-weight:700;">${title}</div>
        <div style="font-size:26px;font-weight:800;color:${valueColor};margin:4px 0 0;line-height:1.15;">${value}</div>
        <div style="font-size:11px;color:#374151;">min per 100 trips</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:3px;">${detail}</div>
      </div>
    </td>`;
}

/** Bars of dwell per 100 trips by week; last week highlighted with its percentile, dashed median. */
function buildWeeklyDwellChart(weekly: WeeklyDwellSummary): string {
  const scaleMax = (Math.max(...weekly.weeks.map(week => week.minutesPer100Trips)) * 1.08) || 1;
  const heightFor = (value: number): number => Math.round((value / scaleMax) * WEEKLY_DWELL_CHART_HEIGHT);
  const medianTop = WEEKLY_DWELL_CHART_HEIGHT - heightFor(weekly.medianPer100Trips);
  const block = (height: number, style: string): string =>
    height > 0 ? `<div style="height:${height}px;${style}font-size:0;line-height:0;">&nbsp;</div>` : '';

  const columns = weekly.weeks.map((week, index) => {
    const isLast = index === weekly.weeks.length - 1;
    const bar = `background:${isLast ? WEEKLY_DWELL_LAST_COLOR : WEEKLY_DWELL_EARLIER_COLOR};`;
    const barHeight = heightFor(week.minutesPer100Trips);
    const barTop = WEEKLY_DWELL_CHART_HEIGHT - barHeight;
    // The median line is a top border on whichever block starts at its height.
    const body = barTop <= medianTop
      ? block(barTop, '')
        + block(medianTop - barTop, `${bar}border-radius:3px 3px 0 0;`)
        + block(WEEKLY_DWELL_CHART_HEIGHT - medianTop, `${bar}border-top:${WEEKLY_DWELL_MEDIAN_LINE};`)
      : block(medianTop, '')
        + block(barTop - medianTop, `border-top:${WEEKLY_DWELL_MEDIAN_LINE};`)
        + block(barHeight, `${bar}border-radius:3px 3px 0 0;`);
    const title = `Week of ${formatShortDate(week.weekStart)}: ${week.minutesPer100Trips.toFixed(0)} min per 100 trips (${week.dwellHours.toFixed(1)} hrs)`;
    return `<td valign="bottom" style="padding:0 1px;vertical-align:bottom;" title="${title}">${body}</td>`;
  }).join('');

  const months = weekly.weeks.map((week, index) => {
    const startsMonth = index === 0 || weekly.weeks[index - 1].weekStart.slice(0, 7) !== week.weekStart.slice(0, 7);
    if (!startsMonth) return '<td></td>';
    const month = new Date(`${week.weekStart}T12:00:00`).toLocaleDateString('en-CA', { month: 'short' });
    return `<td style="font-size:10px;color:#6b7280;padding-top:3px;white-space:nowrap;">${month}</td>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-bottom:1px solid #9ca3af;">
      <tr>${columns}</tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
      <tr>${months}</tr>
    </table>
    <div style="font-size:11px;color:#6b7280;margin-top:8px;">
      <span style="display:inline-block;width:10px;height:10px;background:${WEEKLY_DWELL_LAST_COLOR};border-radius:2px;vertical-align:middle;"></span> Last week
      &nbsp;&nbsp;<span style="display:inline-block;width:10px;height:10px;background:${WEEKLY_DWELL_EARLIER_COLOR};border-radius:2px;vertical-align:middle;"></span> Earlier weeks
      &nbsp;&nbsp;<span style="display:inline-block;width:14px;border-top:${WEEKLY_DWELL_MEDIAN_LINE};vertical-align:middle;"></span> Typical week (median)
    </div>`;
}

/** Where last week sits between the best and worst weeks compared. */
function buildWeeklyDwellRankStrip(weekly: WeeklyDwellSummary): string {
  const rates = weekly.weeks.map(week => week.minutesPer100Trips);
  const position = Math.min(98, Math.max(0, weekly.percentile));
  const track = 'height:8px;background:#e5e7eb;font-size:0;line-height:0;';
  const before = position > 0
    ? `<td style="width:${position}%;padding:0;"><div style="${track}border-radius:4px 0 0 4px;">&nbsp;</div></td>`
    : '';
  return `
    <div style="margin-top:14px;font-size:12px;font-weight:700;color:#374151;">Last week: ${weeklyDwellRank(weekly).toLowerCase()}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;table-layout:fixed;">
      <tr>
        ${before}
        <td style="width:2%;padding:0;"><div style="height:16px;margin-top:-4px;background:#92400e;border-radius:2px;font-size:0;line-height:0;">&nbsp;</div></td>
        <td style="padding:0;"><div style="${track}border-radius:0 4px 4px 0;">&nbsp;</div></td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:3px;">
      <tr>
        <td style="font-size:10px;color:#6b7280;">Best week (${Math.min(...rates).toFixed(0)} min)</td>
        <td style="font-size:10px;color:#6b7280;text-align:center;">Typical (${weekly.medianPer100Trips.toFixed(0)} min)</td>
        <td style="font-size:10px;color:#6b7280;text-align:right;">Worst week (${Math.max(...rates).toFixed(0)} min)</td>
      </tr>
    </table>`;
}

function buildWeeklyDwellSection(weekly: WeeklyDwellSummary | null | undefined): string {
  if (!weekly) return '';
  const { lastWeek } = weekly;
  const trend = weeklyDwellTrend(weekly);
  const trendDetail = trend && weekly.recentAvgPer100Trips !== null && weekly.priorAvgPer100Trips !== null
    ? `${weekly.recentAvgPer100Trips.toFixed(0)} now vs ${weekly.priorAvgPer100Trips.toFixed(0)} before`
    : 'Needs 8 weeks of data';

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
      <tr>
        ${weeklyDwellTile(
          `Last week (${formatShortDate(lastWeek.weekStart)} – ${formatShortDate(lastWeek.weekEnd)})`,
          lastWeek.minutesPer100Trips.toFixed(0),
          `${lastWeek.dwellHours.toFixed(1)} hrs total`,
          '#111827',
          '#0891b2',
        )}
        ${weeklyDwellTile('Typical week', weekly.medianPer100Trips.toFixed(0), `Median of ${weekly.weeks.length} weeks`, '#111827', '#9ca3af')}
        ${weeklyDwellTile('4-week trend', trend ? trend.label : '—', trendDetail, trend ? trend.color : '#6b7280', trend ? trend.accent : '#9ca3af')}
      </tr>
    </table>
    <div style="font-size:13px;font-weight:700;color:#374151;margin:14px 0 6px;">Dwell minutes per 100 trips, by week</div>
    ${buildWeeklyDwellChart(weekly)}
    ${buildWeeklyDwellRankStrip(weekly)}
    <div style="font-size:11px;color:#9ca3af;margin-top:10px;">Moderate and high dwell only. Weeks with fewer than 5 days of data are left out.</div>`;

  return `${sectionHeader('Weekly Operator Dwell', 'Monday to Sunday weeks. Higher means more dwell.')}${cardWrap(content)}`;
}

function buildMissedTripsTable(latestDay: DailySummary): string {
  const mt = latestDay.missedTrips;
  if (!mt || mt.totalScheduled <= 0) return '';
  const header = sectionHeader('Missed Trips', `${num(mt.totalMissed)} of ${num(mt.totalScheduled)} scheduled trips missed (${mt.missedPct.toFixed(1)}%)`);
  const th = 'padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;';
  const td = 'padding:6px 10px;font-size:12px;border-bottom:1px solid #f3f4f6;';

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

  const trips = sortTrips(mt.trips);
  if (trips.length > 0) {
    const rows = trips.map((t, i) => {
      const late = t.missType === 'late_over_15';
      const reason = late
        ? `Late ${t.lateByMinutes ? `${Math.round(t.lateByMinutes)} min` : '15+ min'}`
        : 'No data recorded';
      return `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="${td}font-weight:700;color:#374151;">${escapeHtml(t.routeId)}</td>
        <td style="${td}text-align:right;color:#374151;">${escapeHtml(t.departure)}</td>
        <td style="${td}color:${late ? '#b45309' : '#991b1b'};">${reason}</td>
      </tr>`;
    }).join('');

    return `
    ${header}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="${th}text-align:left;">Route</th>
        <th style="${th}text-align:right;">Sched. Departure</th>
        <th style="${th}text-align:left;">Reason</th>
      </tr>
      ${rows}
    </table>`;
  }

  // Fallback: no trip-level data, show route-level summary
  const fallbackRows = mt.byRoute.length > 0
    ? mt.byRoute.map((r, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      return `
      <tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.routeId)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${num(r.count)}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:right;color:#6b7280;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.earliestDep)}</td>
      </tr>`;
    }).join('')
    : `
      <tr style="background:#ffffff;">
        <td colspan="3" style="padding:10px;font-size:12px;color:#6b7280;text-align:center;border-bottom:1px solid #f3f4f6;">
          Trip-level missed-trip rows are unavailable in this dataset.
        </td>
      </tr>`;

  return `
    ${header}
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

function scorecardFlag(text: string, bg: string, color: string): string {
  return `<span class="sc-flag" style="display:inline-block;background:${bg};color:${color};padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;margin:1px 4px 1px 0;">${text}</span>`;
}

/** Flags for a scorecard row: on-time well below usual, APC counts that disagree, high dwell. */
function scorecardFlags(route: RouteMetrics, dwellSeconds: number, glance: GlanceModel | null): { html: string; standout: boolean } {
  const flags: string[] = [];
  const standout = glance?.standouts.find(entry => entry.routeId === route.routeId);
  if (standout) {
    flags.push(scorecardFlag(`&#9660; ${(standout.usualOtp - standout.otp).toFixed(1)} pts below usual`, '#fee2e2', '#991b1b'));
  }
  if (apcStatusForRoute(route) !== 'ok') {
    const isNew = glance?.ongoing.some(item => item.newRoutes?.includes(route.routeId));
    flags.push(isNew ? scorecardFlag('APC issue · new', '#dbeafe', '#1d4ed8') : scorecardFlag('APC issue', '#f1f5f9', '#64748b'));
  }
  if (dwellSeconds >= 1800) {
    flags.push(scorecardFlag(`Dwell ${formatDwellHours(dwellSeconds)} hrs`, '#fffbeb', '#b45309'));
  }
  return { html: flags.join(''), standout: Boolean(standout) };
}

/** Official route colours. Copy of utils/config/routeColors.ts: functions cannot import from outside src. */
const ROUTE_BADGE_COLORS: Record<string, string> = {
  '2': '#006838',
  '7': '#F58220',
  '8': '#000000',
  '10': '#681757',
  '11': '#B2D235',
  '12': '#F8A1BE',
  '100': '#910005',
  '101': '#2464A2',
  '400': '#00C4DC',
};
const ROUTE_BADGE_FALLBACK = '#6B7280';

function routeBadgeColor(routeId: string): string {
  const normalized = routeId.toUpperCase().trim();
  const base = normalized.match(/\d+/)?.[0];
  return ROUTE_BADGE_COLORS[normalized] ?? (base ? ROUTE_BADGE_COLORS[base] : undefined) ?? ROUTE_BADGE_FALLBACK;
}

function routeBadgeTextColor(background: string): string {
  const r = parseInt(background.slice(1, 3), 16);
  const g = parseInt(background.slice(3, 5), 16);
  const b = parseInt(background.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
}

/** Route number in a filled circle in the route's colour. */
function routeBadge(routeId: string): string {
  const background = routeBadgeColor(routeId);
  const fontSize = routeId.length >= 3 ? 10 : 12;
  return `<span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:999px;background:${background};color:${routeBadgeTextColor(background)};font-size:${fontSize}px;font-weight:800;text-align:center;white-space:nowrap;">${escapeHtml(routeId)}</span>`;
}

function buildRouteScorecard(routes: RouteMetrics[], dwellByRoute: Map<string, number>, glance: GlanceModel | null): string {
  const routesWithBph = routes.map(r => ({
    ...r,
    bph: r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0,
  }));
  const sorted = [...routesWithBph].sort((a, b) => b.bph - a.bph);
  const cell = 'padding:8px 10px;font-size:12px;border-bottom:1px solid #f3f4f6;';
  const head = 'padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;';

  const rows = sorted.map((r, i) => {
    const flags = scorecardFlags(r, dwellByRoute.get(r.routeId) ?? 0, glance);
    const bg = flags.standout ? '#fef2f2' : i % 2 === 0 ? '#ffffff' : '#f9fafb';
    // APC counts disagree: keep riders and BPH visible but greyed, so they read as unreliable.
    const apcIssue = apcStatusForRoute(r) !== 'ok';
    const greyed = 'background:#f3f4f6;color:#9ca3af;';
    return `
      <tr style="background:${bg};">
        <td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;width:30px;">${routeBadge(r.routeId)}</td>
        <td style="${cell}color:#1f2a44;">${escapeHtml(r.routeName)}</td>
        <td style="${cell}text-align:right;${apcIssue ? greyed : ''}">${apcIssue ? `<span style="padding:2px 8px;font-weight:700;font-size:12px;color:#9ca3af;">${r.bph.toFixed(1)}</span>` : bphPill(r.bph)}</td>
        <td style="${cell}text-align:right;${apcIssue ? greyed : 'color:#082b63;'}">${num(r.ridership)}</td>
        <td style="${cell}text-align:right;">${routeOtpCell(r.otp)}</td>
        <td style="${cell}text-align:left;">${flags.html}</td>
      </tr>`;
  }).join('');

  return `
    ${sectionHeader('Route Scorecard', 'Ranked by boardings per service hour (BPH), highest first')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.05);">
      <tr style="background:#f9fafb;">
        <th style="${head}text-align:left;">Route</th>
        <th style="${head}text-align:left;">Name</th>
        <th style="${head}text-align:right;">BPH</th>
        <th style="${head}text-align:right;">Riders</th>
        <th style="${head}text-align:right;">On-time</th>
        <th style="${head}text-align:left;">Flags</th>
      </tr>
      ${rows}
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">A flag shows only when a route needs a look: on-time well below its usual, APC counts that do not agree, or 0.5 hours or more of operator dwell. Greyed riders and BPH mean an APC issue, so treat those figures with care.</div>`;
}

function buildTopStops(stops: StopMetrics[]): string {
  if (stops.length === 0) return '';

  const busiestStops = mergeHubStops(stops)
    .sort((a, b) => (b.boardings + b.alightings) - (a.boardings + a.alightings))
    .slice(0, 10);
  const th = 'padding:5px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;';
  const td = 'padding:5px 10px;font-size:12px;border-bottom:1px solid #f3f4f6;';

  return `
    ${sectionHeader('Top 10 Stops by Ridership', 'Boardings plus alightings; terminal platforms count as one stop')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="${th}text-align:left;">Stop</th>
        <th style="${th}text-align:right;">Boardings</th>
        <th style="${th}text-align:right;">Alightings</th>
        <th style="${th}text-align:right;">Routes</th>
      </tr>
      ${busiestStops.map((s, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="${td}font-weight:600;color:#374151;">${stopLabel(s.stopName, s.stopId)}</td>
        <td style="${td}text-align:right;color:#374151;">${num(s.boardings)}</td>
        <td style="${td}text-align:right;color:#374151;">${num(s.alightings)}</td>
        <td style="${td}text-align:right;color:#6b7280;">${s.routeCount}</td>
      </tr>`).join('')}
    </table>`;
}

const TRIP_CHART_HEIGHT = 110;
const TRIP_LINE_WIDTH = 2;
/** Headroom above the plot for the peak label. */
const TRIP_LABEL_ROOM = 16;
const TRIP_LOAD_COLOR = '#2563eb';
const TRIP_LOAD_FILL = '#dbeafe';
const TRIP_FULL_LOAD_COLOR = '#dc2626';
const TRIP_BOARD_COLOR = '#0d9488';
const TRIP_ALIGHT_COLOR = '#ea580c';
/** Stops with more than this many boardings or alightings are listed as major stops. */
const MAJOR_STOP_MIN_MOVEMENT = 3;
const MAJOR_STOP_BAR_MAX_PX = 110;
/** Labels in the right part of the axis read leftwards from their tick so they stay on the chart. */
const AXIS_RIGHT_ANCHOR_SHARE = 0.65;
/** Minimum gap between labelled stops, as a share of the trip's stops. */
const AXIS_MIN_LABEL_GAP_SHARE = 0.07;

function isMajorStop(stop: { boardings: number; alightings: number }): boolean {
  return Math.round(stop.boardings) > MAJOR_STOP_MIN_MOVEMENT || Math.round(stop.alightings) > MAJOR_STOP_MIN_MOVEMENT;
}

/**
 * Stop names under the load line. The ends and the peak come first, then the
 * busiest major stops, then timepoints, skipping any too close to a name
 * already placed. Names alternate between two rows; each starts (or, near the
 * right edge, ends) at its stop's tick.
 */
function buildTripStopAxis(trip: FeaturedTrip, peakIndex: number): string {
  const count = trip.stops.length;
  const minGap = Math.max(1, Math.ceil(count * AXIS_MIN_LABEL_GAP_SHARE));
  const priority = (stop: FeaturedTrip['stops'][number], index: number): number => {
    if (index === 0 || index === count - 1 || index === peakIndex) return Number.POSITIVE_INFINITY;
    if (isMajorStop(stop)) return 1000 + stop.boardings + stop.alightings;
    return stop.isTimepoint ? 1 : 0;
  };
  const placed: number[] = [];
  trip.stops
    .map((stop, index) => ({ index, rank: priority(stop, index) }))
    .filter(candidate => candidate.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .forEach(({ index }) => {
      if (placed.every(other => Math.abs(other - index) >= minGap)) placed.push(index);
    });
  const labelled = placed
    .sort((a, b) => a - b)
    .map(index => ({ stop: trip.stops[index], index }));
  const labelledIndexes = new Set(labelled.map(({ index }) => index));
  const tickColor = '#6b7280';

  const ticks = trip.stops.map((_, index) => `<td style="height:5px;padding:0;font-size:0;line-height:0;${labelledIndexes.has(index) ? `border-left:1px solid ${tickColor};` : ''}">&nbsp;</td>`).join('');
  const labelRow = (row: typeof labelled): string => {
    const cells: string[] = [];
    let cursor = 0;
    const filler = (end: number): void => {
      if (end > cursor) cells.push(`<td colspan="${end - cursor}" style="padding:0;"></td>`);
      cursor = Math.max(cursor, end);
    };
    row.forEach(({ stop, index }, position) => {
      const next = row[position + 1];
      const rightAnchored = index >= count * AXIS_RIGHT_ANCHOR_SHARE;
      let start: number;
      let end: number;
      if (rightAnchored) {
        start = cursor;
        end = index + 1;
      } else {
        start = index;
        const nextRight = next && next.index >= count * AXIS_RIGHT_ANCHOR_SHARE;
        end = !next ? count : nextRight ? Math.ceil((index + next.index + 1) / 2) : next.index;
      }
      filler(start);
      end = Math.max(end, cursor + 1);
      const isPeak = index === peakIndex;
      const shortName = stop.stopName.replace(/\s+Platform\s+\S+$/i, '');
      cells.push(`<td colspan="${end - cursor}" title="${escapeHtml(stop.stopName)}" style="padding:2px ${rightAnchored ? '0 0 2px' : '2px 0 0'};font-size:10px;line-height:13px;color:${isPeak ? '#111827' : '#4b5563'};font-weight:${isPeak ? 800 : 400};text-align:${rightAnchored ? 'right' : 'left'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(shortName)}</td>`);
      cursor = end;
    });
    filler(count);
    return `<tr>${cells.join('')}</tr>`;
  };

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
      <tr>${ticks}</tr>
      ${labelRow(labelled.filter((_, position) => position % 2 === 0))}
      ${labelRow(labelled.filter((_, position) => position % 2 === 1))}
    </table>`;
}

function formatClockTime(time: string): string {
  const [hoursText, minutesText = '00'] = time.split(':');
  const hours = Number.parseInt(hoursText, 10);
  if (!Number.isFinite(hours)) return time;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours % 24 < 12 ? 'AM' : 'PM';
  return `${hour12}:${minutesText.padStart(2, '0')} ${suffix}`;
}

const DIRECTION_LABELS: Record<string, string> = { N: 'northbound', S: 'southbound', E: 'eastbound', W: 'westbound' };

function directionLabel(direction: string): string {
  return DIRECTION_LABELS[direction.trim().toUpperCase()] ?? direction;
}

/**
 * Load along the trip as a stepped line. Email clients drop SVG, so each stop
 * is a table column whose stacked divs draw the step and its vertical joint.
 */
function buildTripLoadChart(trip: FeaturedTrip): string {
  const scaleMax = Math.max(trip.peakLoad, FULL_LOAD);
  const peakIndex = trip.stops.findIndex(stop => stop.load === trip.peakLoad);
  const yFor = (load: number): number =>
    TRIP_CHART_HEIGHT - Math.max(TRIP_LINE_WIDTH, Math.round((load / scaleMax) * TRIP_CHART_HEIGHT));
  const block = (height: number, style: string): string =>
    height > 0 ? `<div style="height:${height}px;${style}font-size:0;line-height:0;">&nbsp;</div>` : '';

  const columns = trip.stops.map((stop, index) => {
    const riders = Math.round(stop.load);
    const color = stop.load >= FULL_LOAD ? TRIP_FULL_LOAD_COLOR : TRIP_LOAD_COLOR;
    const y = yFor(stop.load);
    const prevY = index === 0 ? y : yFor(trip.stops[index - 1].load);
    const joint = `border-left:${TRIP_LINE_WIDTH}px solid ${color};`;
    const step = `border-top:${TRIP_LINE_WIDTH}px solid ${color};`;
    const fill = `background:${TRIP_LOAD_FILL};`;
    // The top spacer carries the peak label, sitting just above the line.
    const top = Math.min(y, prevY) + TRIP_LABEL_ROOM;
    const spacer = index === peakIndex
      ? block(top - TRIP_LABEL_ROOM, '')
        + `<div style="height:${TRIP_LABEL_ROOM}px;font-size:11px;line-height:${TRIP_LABEL_ROOM}px;font-weight:800;color:#111827;text-align:center;white-space:nowrap;">${riders}</div>`
      : block(top, '');
    // Rising: joint hangs below the new level, inside the fill. Falling: joint drops down to it.
    let body: string;
    if (y < prevY) {
      body = block(prevY - y, step + joint + fill) + block(TRIP_CHART_HEIGHT - prevY, fill);
    } else if (y > prevY) {
      body = block(y - prevY, joint) + block(TRIP_CHART_HEIGHT - y, step + fill);
    } else {
      body = block(TRIP_CHART_HEIGHT - y, step + fill);
    }
    return `<td valign="bottom" style="padding:0;vertical-align:bottom;" title="${escapeHtml(stop.stopName)}: ${riders} on board">${spacer}${body}</td>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-bottom:1px solid #9ca3af;">
      <tr>${columns}</tr>
    </table>
    ${buildTripStopAxis(trip, peakIndex)}
    <div style="font-size:11px;color:#6b7280;margin-top:6px;">
      <span style="display:inline-block;width:14px;height:0;border-top:${TRIP_LINE_WIDTH}px solid ${TRIP_LOAD_COLOR};vertical-align:middle;"></span> Load (people on board)
      &nbsp;&nbsp;<span style="display:inline-block;width:14px;height:0;border-top:${TRIP_LINE_WIDTH}px solid ${TRIP_FULL_LOAD_COLOR};vertical-align:middle;"></span> Full (${FULL_LOAD}+ riders)
    </div>`;
}

/** Boardings and alightings at stops with more than MAJOR_STOP_MIN_MOVEMENT of either, in route order. */
function buildMajorStopsChart(trip: FeaturedTrip): string {
  const majorStops = trip.stops
    .map(stop => ({ ...stop, on: Math.round(stop.boardings), off: Math.round(stop.alightings) }))
    .filter(isMajorStop);
  if (majorStops.length === 0) return '';

  const scaleMax = Math.max(...majorStops.map(stop => Math.max(stop.on, stop.off)));
  const bar = (value: number, color: string): string => {
    const width = value > 0 ? Math.max(2, Math.round((value / scaleMax) * MAJOR_STOP_BAR_MAX_PX)) : 0;
    const mark = width > 0
      ? `<span style="display:inline-block;width:${width}px;height:10px;background:${color};border-radius:0 4px 4px 0;vertical-align:middle;"></span> `
      : '';
    return `${mark}<span style="font-size:12px;color:#374151;vertical-align:middle;">${value}</span>`;
  };
  const cell = 'padding:4px 8px;font-size:12px;border-bottom:1px solid #f3f4f6;';
  const head = 'padding:5px 8px;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;';
  const rows = majorStops.map((stop, index) => `
      <tr style="background:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="${cell}font-weight:600;color:#374151;">${escapeHtml(stop.stopName)}</td>
        <td style="${cell}white-space:nowrap;">${bar(stop.on, TRIP_BOARD_COLOR)}</td>
        <td style="${cell}white-space:nowrap;">${bar(stop.off, TRIP_ALIGHT_COLOR)}</td>
        <td style="${cell}text-align:right;color:#6b7280;">${Math.round(stop.load)}</td>
      </tr>`).join('');

  return `
    <div style="font-size:13px;font-weight:700;color:#374151;margin:18px 0 6px;">Major stops (more than ${MAJOR_STOP_MIN_MOVEMENT} on or off)</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <th style="${head}">Stop</th>
        <th style="${head}"><span style="display:inline-block;width:10px;height:10px;background:${TRIP_BOARD_COLOR};border-radius:2px;vertical-align:middle;"></span> Boardings</th>
        <th style="${head}"><span style="display:inline-block;width:10px;height:10px;background:${TRIP_ALIGHT_COLOR};border-radius:2px;vertical-align:middle;"></span> Alightings</th>
        <th style="${head}text-align:right;">Load after</th>
      </tr>${rows}
    </table>`;
}

function buildFeaturedTripSection(trip: FeaturedTrip | null | undefined): string {
  if (!trip) return '';

  const peakRiders = Math.round(trip.peakLoad);
  const isFull = trip.fullStops > 0;
  const tagColor = isFull ? '#b91c1c' : trip.scoreParts.lateness >= 0.5 ? '#b45309' : '#1d4ed8';
  const tagBg = isFull ? '#fef2f2' : trip.scoreParts.lateness >= 0.5 ? '#fffbeb' : '#eff6ff';
  const facts = [
    `Up to <strong>${peakRiders} people</strong> were on the bus at once, near <strong>${escapeHtml(trip.peakStopName)}</strong>.`,
    isFull
      ? `The bus was <strong style="color:#b91c1c;">full</strong> (${FULL_LOAD}+ riders) for ${trip.fullStops} stop${trip.fullStops === 1 ? '' : 's'}.`
      : `The bus never got full (full is ${FULL_LOAD}+ riders).`,
    `${num(trip.boardings)} people got on during the trip.`,
  ];
  if (trip.lateMinutes !== null && trip.lateMinutes >= 1) {
    facts.push(`It ran about <strong>${Math.round(trip.lateMinutes)} minute${Math.round(trip.lateMinutes) === 1 ? '' : 's'} late</strong>.`);
  }

  const content = `
    <div style="margin-bottom:10px;">
      <span style="display:inline-block;background:${tagBg};color:${tagColor};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:800;">${escapeHtml(trip.reason)}</span>
    </div>
    <div style="font-size:20px;font-weight:800;color:#082b63;margin-bottom:8px;">Route ${escapeHtml(trip.routeId)} ${escapeHtml(directionLabel(trip.direction))} · ${formatClockTime(trip.departure)} departure</div>
    ${facts.map(fact => `<div style="font-size:14px;line-height:1.6;color:#374151;">${fact}</div>`).join('')}
    <div style="font-size:13px;font-weight:700;color:#374151;margin:16px 0 6px;">Load along the route</div>
    ${buildTripLoadChart(trip)}
    ${buildMajorStopsChart(trip)}`;

  return `${sectionHeader('Trip of the Day', 'One notable trip from yesterday, picked automatically. Rider counts are estimated from boardings and alightings.')}${cardWrap(content)}`;
}

/** Glance model for the report, or null when there is no route history (falls back to the older summary). */
export function buildReportGlance(data: ReportData): GlanceModel | null {
  if (!data.routeHistory) return null;
  const { latestDay, trendDays } = data;
  const dwell = dwellComparison(latestDay, trendDays);
  const leader = buildRouteDwellLeader(latestDay);
  return buildGlance({
    latestDay,
    systemHistory: trendDays,
    routeHistory: data.routeHistory,
    latestTrips: data.latestTrips ?? [],
    lastMissedTripDataDate: data.lastMissedTripDataDate ?? null,
    dwell: dwell
      ? { per100: dwell.per100, usualPer100: dwell.typicalPer100, elevated: dwell.elevated, topRouteId: leader.routeId, topRouteHours: leader.hours }
      : null,
    routeLink: DASHBOARD_OTP_URL,
  });
}

const DASHBOARD_URL = 'https://transitscheduler.ca/#operations/performance';

export function buildReportHtml(data: ReportData): string {
  const { latestDay, trendDays, teamName, featuredTrip, weeklyDwell, showWeeklyDwellSection } = data;
  const sys = latestDay.system;
  // System totals
  const totalServiceHours = latestDay.byRoute.reduce((s, r) => s + r.serviceHours, 0);
  const dwellByRoute = buildRouteDwellMap(latestDay);
  const glance = buildReportGlance(data);
  const statusLabel = glance ? glance.status : deriveReportStatus(latestDay).label;
  const missedTripsSection = latestDay.missedTrips && latestDay.missedTrips.totalMissed > 0
    ? buildMissedTripsTable(latestDay)
    : '';

  const tripsOperatedValue = (() => {
    const mt = latestDay.missedTrips;
    if (mt && mt.totalScheduled > 0) {
      return `${num(mt.totalMatched)} <span style="font-size:14px;font-weight:700;color:#9ca3af;">of ${num(mt.totalScheduled)}</span>`;
    }
    return num(sys.tripCount);
  })();
  const tripsOperatedSubtitle = (() => {
    const mt = latestDay.missedTrips;
    if (mt && mt.totalScheduled > 0) {
      return mt.totalMissed === 0
        ? 'all scheduled trips operated'
        : `<strong style="font-weight:800;color:#dc2626;">${num(mt.totalMissed)}</strong> missed`;
    }
    return `${num(sys.vehicleCount)} vehicles · ${totalServiceHours.toFixed(1)} svc hrs`;
  })();
  const otpEarlyLate = `${pct(sys.otp.earlyPercent)} early · ${pct(sys.otp.latePercent)} late`;
  const otpUsual = usualLine(glance, 'On-time');
  const ridersDetail = glance?.comparisons.find(row => row.label === 'Riders')?.detail;
  const tripsAlert = statusLabel === 'NEEDS ATTENTION';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @media only screen and (max-width: 620px) {
    .kpi-table { border-spacing: 0 !important; }
    .kpi-cell { display: inline-block !important; width: 48% !important; height: auto !important; min-height: 190px; margin: 0 1% 10px !important; }
    .kpi-value { font-size: 24px !important; }
    .hdr-cell { display: block !important; text-align: left !important; padding: 12px 0 0 !important; }
    .otp-cell { min-width: 0 !important; }
    .otp-split { display: none !important; }
    .sc-flag { white-space: normal !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;">
    <!-- Header -->
    <div style="background:#082f69;padding:16px 20px;border-bottom:4px solid #3b82f6;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">${iconBadge('bus', '#ffffff', 44)}</td>
                <td style="vertical-align:middle;">
                  <div style="font-size:20px;font-weight:900;color:#ffffff;line-height:1.2;">${escapeHtml(teamName)} Daily Performance Report</div>
                  <div style="font-size:13px;color:#93c5fd;font-weight:700;margin-top:3px;">${formatDateLong(latestDay.date)} · ${DWELL_DAY_TYPE_LABEL[latestDay.dayType]} service</div>
                </td>
              </tr>
            </table>
          </td>
          <td class="hdr-cell" style="vertical-align:middle;text-align:right;white-space:nowrap;padding-left:16px;">
            <a href="${DASHBOARD_URL}" style="display:inline-block;color:#ffffff;text-decoration:none;border:1px solid #60a5fa;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:800;">Open full dashboard →</a>
          </td>
        </tr>
      </table>
    </div>

    ${glance ? buildStatusStrip(glance) : ''}

    <div style="padding:18px;background:#f8fafc;">

      <!-- ═══ 1. KPI CARDS ═══ -->
      <table class="kpi-table" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;border-collapse:separate;border-spacing:10px 0;">
        <tr>
          ${kpiCard('On-time performance', pct(sys.otp.onTimePercent), otpUsual ?? otpEarlyLate, otpColor(sys.otp.onTimePercent), undefined, 'performance', otpUsual ? otpEarlyLate : undefined)}
          ${kpiCard('Total ridership', num(sys.totalRidership), usualLine(glance, 'Riders'), '#2563eb', undefined, 'ridership', ridersDetail ? escapeHtml(ridersDetail) : undefined)}
          ${kpiCard('Trips operated', tripsOperatedValue, tripsOperatedSubtitle, tripsAlert ? '#dc2626' : '#6d28d9', tripsAlert ? '#dc2626' : undefined, 'trips')}
          ${buildDwellKpiCard(latestDay, trendDays)}
        </tr>
      </table>

      <!-- ═══ 2. WHAT STOOD OUT ═══ -->
      ${glance ? buildGlanceFindings(glance) : `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:62%;padding:0 6px 0 0;vertical-align:top;">${buildExecutiveSummary(latestDay)}</td>
          <td style="width:38%;padding:0 0 0 6px;vertical-align:top;">${buildActionFocus(latestDay)}</td>
        </tr>
      </table>`}

      <!-- ═══ 3. ROUTE SCORECARD ═══ -->
      ${buildRouteScorecard(latestDay.byRoute, dwellByRoute, glance)}

      <!-- ═══ 4. LAST 7 DAYS ═══ -->
      ${buildTrendCharts(trendDays, latestDay.date)}

      <!-- ═══ 5. WEEKLY OPERATOR DWELL (MONDAYS) ═══ -->
      ${showWeeklyDwellSection ? buildWeeklyDwellSection(weeklyDwell) : ''}

      <!-- ═══ 6. MISSED TRIPS - EXCEPTION ONLY ═══ -->
      ${missedTripsSection}

      <!-- ═══ 7. TOP 10 STOPS ═══ -->
      ${buildTopStops(latestDay.byStop)}

      <!-- ═══ 8. TRIP OF THE DAY ═══ -->
      ${buildFeaturedTripSection(featuredTrip)}

    </div>

    <!-- Footer -->
    <div style="background:#eaf2ff;border-top:1px solid #bfdbfe;padding:14px 20px;font-size:11px;color:#64748b;line-height:1.6;">
      <div>Boardings by hour, stop detail and operator dwell by stop are on the <a href="${DASHBOARD_URL}" style="color:#2563eb;font-weight:600;text-decoration:none;">dashboard</a>.</div>
      <div style="margin-top:4px;"><b style="color:#334155;">On-time:</b> between 3 min early and 5 min late. <b style="color:#334155;">Usual:</b> median of recent days of the same day type. <b style="color:#334155;">BPH:</b> boardings per service hour. <b style="color:#334155;">APC:</b> automatic passenger counter; a flag means boardings and alightings do not agree. <b style="color:#334155;">Dwell:</b> moderate and high operator dwell only.</div>
      <div style="margin-top:4px;">This is an automated report. Generated by Scheduler 4 · ${new Date().toISOString().slice(0, 10)}</div>
    </div>
  </div>
</body>
</html>`;
}
