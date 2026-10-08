import type { DailySummary, DayType, RouteMetrics, TripMetrics } from './types';
import { apcDiscrepancyPctForRoute, apcStatusForRoute } from './routeApc';

/**
 * Rules for the "Yesterday at a Glance" and "Action Focus" sections.
 * Everything is compared with the same day type's recent median ("usual"),
 * so the wording changes with what actually happened each day.
 */
export const GLANCE_RULES = {
  /** Recent same-day-type days used for "usual". */
  usualDays: 20,
  /** Fewer earlier days than this hides a comparison. */
  usualMinDays: 5,
  /** On-time within this many points of usual reads as normal. */
  otpNormalBandPts: 2,
  /** Riders within this percent of usual reads as normal. */
  ridersNormalBandPct: 7,
  /** Show a rank ("5th busiest weekday in 4 weeks") only for the top or bottom few. */
  ridersRankMax: 5,
  /** A route stands out when its on-time is this far below its own usual. */
  standoutDropPts: 5,
  /** Ignore routes with fewer on-time readings than this. */
  standoutMinObs: 30,
  standoutMax: 3,
  /** A trip counts as late when this share of its timepoints was late. */
  lateTripShare: 0.25,
  /** Late trips need at least this many to describe a pattern. */
  patternMinLateTrips: 3,
  /** Time pattern: this share of late trips inside a window this long. */
  patternWindowMinutes: 180,
  patternWindowShare: 0.6,
  /** Direction pattern: this share of late trips in one direction. */
  patternDirectionShare: 0.8,
  apcLookbackDays: 60,
  /** An APC flag is "new" when the route had none in this many earlier days. */
  apcNewQuietDays: 7,
  /** Lowest route moves to "ongoing" when it was lowest this often. */
  chronicLowestMinDays: 3,
  /** Data feed gap shown as ongoing after this many days, and as an action after the second. */
  dataGapOngoingDays: 2,
  dataGapActionDays: 7,
  actionMax: 3,
} as const;

export interface RouteHistoryDay {
  date: string;
  dayType: DayType;
  byRoute: RouteMetrics[];
}

export interface GlanceDwellInput {
  per100: number;
  usualPer100: number | null;
  elevated: boolean;
  topRouteId: string | null;
  topRouteHours: number;
}

export interface GlanceInput {
  latestDay: DailySummary;
  /** System-level days (any order, may include the latest day). */
  systemHistory: DailySummary[];
  /** Route-level days (any order, may include the latest day). */
  routeHistory: RouteHistoryDay[];
  latestTrips: TripMetrics[];
  /** Latest service date that had missed-trip data, if any. */
  lastMissedTripDataDate: string | null;
  dwell?: GlanceDwellInput | null;
  /** Dashboard link used on route actions. */
  routeLink?: string;
}

export type GlanceTone = 'neutral' | 'good' | 'bad' | 'warn';
export type GlanceStatus = 'STABLE' | 'REVIEW' | 'NEEDS ATTENTION';

export interface GlanceComparison {
  label: string;
  value: string;
  usual: string;
  verdict: string;
  tone: GlanceTone;
}

export interface GlanceStandout {
  routeId: string;
  otp: number;
  usualOtp: number;
  daysInRow: number;
  trips: number;
  lateTrips: number;
  sentence: string;
  /** Late-trip pattern, shown on its own row under the sentence. */
  latePattern: string | null;
}

export interface GlanceOngoing {
  text: string;
  /** Route IDs to tag "new" after the text. */
  newRoutes?: string[];
}

export interface GlanceAction {
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  link?: string;
}

export interface GlanceModel {
  status: GlanceStatus;
  headline: string;
  comparisons: GlanceComparison[];
  standouts: GlanceStandout[];
  ongoing: GlanceOngoing[];
  actions: GlanceAction[];
}

const DAY_LABEL: Record<DayType, string> = { weekday: 'weekday', saturday: 'Saturday', sunday: 'Sunday' };
const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
const DIRECTION_WORD: Record<string, string> = {
  N: 'northbound', NB: 'northbound', NORTH: 'northbound', NORTHBOUND: 'northbound',
  S: 'southbound', SB: 'southbound', SOUTH: 'southbound', SOUTHBOUND: 'southbound',
  E: 'eastbound', EB: 'eastbound', EAST: 'eastbound', EASTBOUND: 'eastbound',
  W: 'westbound', WB: 'westbound', WEST: 'westbound', WESTBOUND: 'westbound',
  CW: 'clockwise', CLOCKWISE: 'clockwise',
  CCW: 'counter-clockwise', COUNTERCLOCKWISE: 'counter-clockwise',
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / 86_400_000);
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const formatNumber = (n: number): string => Math.round(n).toLocaleString('en-CA');
const formatPct = (n: number): string => `${n.toFixed(1)}%`;

function parseMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function directionWord(direction: string): string {
  const key = direction.trim().toUpperCase().replace(/[\s-]/g, '');
  return DIRECTION_WORD[key] ?? direction.trim();
}

function isLateTrip(trip: TripMetrics): boolean {
  return trip.otp.total > 0 && trip.otp.late / trip.otp.total >= GLANCE_RULES.lateTripShare;
}

/** Earlier days of the same type, newest first, capped at the "usual" window. */
function priorSameType<T extends { date: string; dayType: DayType }>(days: T[], latest: DailySummary): T[] {
  return days
    .filter(day => day.date < latest.date && day.dayType === latest.dayType)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, GLANCE_RULES.usualDays);
}

interface LatePattern {
  window: { from: string; to: string; count: number } | null;
  direction: string | null;
  lateTrips: number;
  trips: number;
}

/** Finds the busiest late-trip window and any single direction the late trips share. */
export function findLatePattern(trips: TripMetrics[]): LatePattern {
  const late = trips
    .filter(isLateTrip)
    .map(trip => ({ trip, minutes: parseMinutes(trip.terminalDepartureTime) }))
    .filter((entry): entry is { trip: TripMetrics; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  const pattern: LatePattern = { window: null, direction: null, lateTrips: trips.filter(isLateTrip).length, trips: trips.length };
  if (late.length < GLANCE_RULES.patternMinLateTrips) return pattern;

  let best = { start: 0, end: 0 };
  for (let start = 0, end = 0; start < late.length; start++) {
    while (end + 1 < late.length && late[end + 1].minutes - late[start].minutes <= GLANCE_RULES.patternWindowMinutes) end++;
    if (end - start > best.end - best.start) best = { start, end };
  }
  const count = best.end - best.start + 1;
  if (count / late.length >= GLANCE_RULES.patternWindowShare) {
    pattern.window = {
      from: late[best.start].trip.terminalDepartureTime.slice(0, 5),
      to: late[best.end].trip.terminalDepartureTime.slice(0, 5),
      count,
    };
  }

  const directions = new Set(trips.map(trip => directionWord(trip.direction)).filter(Boolean));
  if (directions.size >= 2) {
    const byDirection = new Map<string, number>();
    for (const { trip } of late) {
      const word = directionWord(trip.direction);
      byDirection.set(word, (byDirection.get(word) ?? 0) + 1);
    }
    const [topDirection, topCount] = [...byDirection.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount / late.length >= GLANCE_RULES.patternDirectionShare) pattern.direction = topDirection;
  }
  return pattern;
}

function patternPhrase(pattern: LatePattern): string | null {
  const parts: string[] = [];
  if (pattern.window) {
    parts.push(pattern.window.count === pattern.lateTrips
      ? `all ${pattern.window.from}–${pattern.window.to}`
      : `mostly ${pattern.window.from}–${pattern.window.to}`);
  }
  if (pattern.direction) parts.push(pattern.window ? pattern.direction : `mostly ${pattern.direction}`);
  return parts.length > 0 ? `Late trips ${parts.join(', ')}.` : null;
}

function buildComparisons(latest: DailySummary, prior: DailySummary[]): {
  comparisons: GlanceComparison[];
  otpDiff: number | null;
  ridersDiffPct: number | null;
} {
  if (prior.length < GLANCE_RULES.usualMinDays) return { comparisons: [], otpDiff: null, ridersDiffPct: null };

  const otp = latest.system.otp.onTimePercent;
  const usualOtp = median(prior.map(day => day.system.otp.onTimePercent));
  const otpDiff = otp - usualOtp;
  const otpNormal = Math.abs(otpDiff) <= GLANCE_RULES.otpNormalBandPts;

  const riders = latest.system.totalRidership;
  const usualRiders = median(prior.map(day => day.system.totalRidership));
  const ridersDiffPct = usualRiders > 0 ? ((riders - usualRiders) / usualRiders) * 100 : 0;
  const ridersNormal = Math.abs(ridersDiffPct) <= GLANCE_RULES.ridersNormalBandPct;
  // "In N weeks" spans the earliest compared day to today, e.g. 20 weekdays is 4 weeks.
  const weeks = Math.max(1, Math.round((daysBetween(prior[prior.length - 1].date, latest.date) + 1) / 7));
  const busierDays = prior.filter(day => day.system.totalRidership > riders).length;
  const quieterDays = prior.filter(day => day.system.totalRidership < riders).length;
  let riderVerdict = 'normal';
  if (!ridersNormal) {
    const up = ridersDiffPct > 0;
    const rank = (up ? busierDays : quieterDays) + 1;
    riderVerdict = `${up ? '▲' : '▼'} ${Math.round(Math.abs(ridersDiffPct))}%`
      + (rank <= GLANCE_RULES.ridersRankMax
        ? ` · ${rank === 1 ? '' : `${ordinal(rank)} `}${up ? 'busiest' : 'quietest'} ${DAY_LABEL[latest.dayType]} in ${weeks} weeks`
        : '');
  }

  return {
    otpDiff,
    ridersDiffPct,
    comparisons: [
      {
        label: 'On-time',
        value: formatPct(otp),
        usual: `usual ${formatPct(usualOtp)}`,
        verdict: otpNormal ? 'normal' : `${otpDiff > 0 ? '▲' : '▼'} ${Math.abs(otpDiff).toFixed(1)} pts`,
        tone: otpNormal ? 'neutral' : otpDiff > 0 ? 'good' : 'bad',
      },
      {
        label: 'Riders',
        value: formatNumber(riders),
        usual: `usual ${formatNumber(usualRiders)}`,
        verdict: riderVerdict,
        tone: ridersNormal ? 'neutral' : ridersDiffPct > 0 ? 'good' : 'warn',
      },
    ],
  };
}

function routeOn(day: RouteHistoryDay, routeId: string): RouteMetrics | undefined {
  return day.byRoute.find(route => route.routeId === routeId);
}

function hasEnoughObs(route: RouteMetrics | undefined): route is RouteMetrics {
  return Boolean(route && route.otp.total >= GLANCE_RULES.standoutMinObs);
}

function buildStandouts(input: GlanceInput, priorRouteDays: RouteHistoryDay[]): GlanceStandout[] {
  const { latestDay } = input;
  const candidates: GlanceStandout[] = [];

  for (const route of latestDay.byRoute) {
    if (!hasEnoughObs(route)) continue;
    const history = priorRouteDays.map(day => routeOn(day, route.routeId)).filter(hasEnoughObs);
    if (history.length < GLANCE_RULES.usualMinDays) continue;
    const usualOtp = median(history.map(entry => entry.otp.onTimePercent));
    if (usualOtp - route.otp.onTimePercent < GLANCE_RULES.standoutDropPts) continue;

    let daysInRow = 1;
    for (const day of priorRouteDays) {
      const entry = routeOn(day, route.routeId);
      if (!hasEnoughObs(entry) || usualOtp - entry.otp.onTimePercent < GLANCE_RULES.standoutDropPts) break;
      daysInRow++;
    }

    const pattern = findLatePattern(input.latestTrips.filter(trip => trip.routeId === route.routeId));
    const phrase = patternPhrase(pattern);
    candidates.push({
      routeId: route.routeId,
      otp: route.otp.onTimePercent,
      usualOtp,
      daysInRow,
      trips: pattern.trips,
      lateTrips: pattern.lateTrips,
      sentence: `on-time ${formatPct(route.otp.onTimePercent)}, usually ${formatPct(usualOtp)}.`,
      latePattern: phrase,
    });
  }

  return candidates
    .sort((a, b) => (b.usualOtp - b.otp) - (a.usualOtp - a.otp))
    .slice(0, GLANCE_RULES.standoutMax);
}

function buildApcOngoing(input: GlanceInput): { item: GlanceOngoing | null; newRoutes: string[] } {
  const { latestDay, routeHistory } = input;
  const flaggedToday = latestDay.byRoute.filter(route => apcStatusForRoute(route) !== 'ok');
  if (flaggedToday.length === 0) return { item: null, newRoutes: [] };

  const window = routeHistory.filter(day => day.date <= latestDay.date && daysBetween(day.date, latestDay.date) < GLANCE_RULES.apcLookbackDays);
  const recent = routeHistory.filter(day => day.date < latestDay.date && daysBetween(day.date, latestDay.date) <= GLANCE_RULES.apcNewQuietDays);
  const flaggedOn = (day: RouteHistoryDay, routeId: string) => {
    const entry = routeOn(day, routeId);
    return Boolean(entry && apcStatusForRoute(entry) !== 'ok');
  };

  const newRoutes: string[] = [];
  const chronic: Array<{ routeId: string; days: number }> = [];
  for (const route of flaggedToday) {
    if (!recent.some(day => flaggedOn(day, route.routeId))) {
      newRoutes.push(route.routeId);
      continue;
    }
    const days = window.filter(day => day.date !== latestDay.date && flaggedOn(day, route.routeId)).length + 1;
    chronic.push({ routeId: route.routeId, days });
  }
  chronic.sort((a, b) => b.days - a.days);

  const parts = chronic.map((entry, i) => (i === 0 ? `${entry.routeId} on ${entry.days} days` : `${entry.routeId} on ${entry.days}`));
  const text = parts.length > 0
    ? `APC counts flagged in the last ${GLANCE_RULES.apcLookbackDays} days: ${parts.join(' · ')}`
    : 'APC counts flagged:';
  return { item: { text, newRoutes }, newRoutes };
}

function buildChronicLowest(latestDay: DailySummary, priorRouteDays: RouteHistoryDay[], standouts: GlanceStandout[]): GlanceOngoing | null {
  const lowest = latestDay.byRoute.filter(hasEnoughObs).sort((a, b) => a.otp.onTimePercent - b.otp.onTimePercent)[0];
  if (!lowest || standouts.some(standout => standout.routeId === lowest.routeId)) return null;

  const timesLowest = priorRouteDays.filter(day => {
    const dayLowest = day.byRoute.filter(hasEnoughObs).sort((a, b) => a.otp.onTimePercent - b.otp.onTimePercent)[0];
    return dayLowest?.routeId === lowest.routeId;
  }).length;
  if (timesLowest < GLANCE_RULES.chronicLowestMinDays) return null;

  return {
    text: `Route ${lowest.routeId} lowest (${formatPct(lowest.otp.onTimePercent)}). Normal for ${lowest.routeId}: lowest on ${timesLowest} of the last ${priorRouteDays.length} ${DAY_LABEL[latestDay.dayType]}s.`,
  };
}

function missedTripGapDays(input: GlanceInput): number | null {
  const mt = input.latestDay.missedTrips;
  if (mt && mt.totalScheduled > 0) return null;
  if (!input.lastMissedTripDataDate) return Infinity;
  return daysBetween(input.lastMissedTripDataDate, input.latestDay.date);
}

function buildActions(input: GlanceInput, standouts: GlanceStandout[], newApcRoutes: string[]): GlanceAction[] {
  const { latestDay } = input;
  const dayLabel = DAY_LABEL[latestDay.dayType];
  const actions: GlanceAction[] = [];

  for (const standout of standouts) {
    const pattern = findLatePattern(input.latestTrips.filter(trip => trip.routeId === standout.routeId));
    const details = [`${standout.lateTrips} of ${standout.trips} trips late`];
    if (pattern.window && pattern.window.count === pattern.lateTrips) details.push(`all ${pattern.window.from}–${pattern.window.to}`);
    else if (pattern.window) details.push(`${pattern.window.count} of them ${pattern.window.from}–${pattern.window.to}`);
    if (pattern.direction) details.push(pattern.window ? pattern.direction : `mostly ${pattern.direction}`);
    const streak = standout.daysInRow >= 2 ? ` ${ordinal(standout.daysInRow)} ${dayLabel} in a row.` : '';
    actions.push({
      title: `Route ${standout.routeId} late trips`,
      detail: standout.trips > 0
        ? `${details.join(', ')}.${streak}`
        : `On-time ${formatPct(standout.otp)}, usually ${formatPct(standout.usualOtp)}.${streak}`,
      severity: standout.usualOtp - standout.otp >= 10 || standout.daysInRow >= 3 ? 'high' : 'medium',
      link: input.routeLink,
    });
  }

  const mt = latestDay.missedTrips;
  if (mt && mt.totalScheduled > 0 && mt.totalMissed > 0) {
    const routes = mt.byRoute.map(route => route.routeId);
    actions.push({
      title: `${formatNumber(mt.totalMissed)} missed trip${mt.totalMissed === 1 ? '' : 's'}`,
      detail: `${mt.missedPct.toFixed(1)}% of scheduled trips${routes.length > 0 ? `, on Route${routes.length === 1 ? '' : 's'} ${routes.join(', ')}` : ''}.`,
      severity: mt.missedPct >= 2 ? 'high' : 'medium',
      link: input.routeLink,
    });
  }

  const dwell = input.dwell;
  if (dwell?.elevated) {
    actions.push({
      title: 'Operator dwell high',
      detail: `${Math.round(dwell.per100)} min / 100 trips${dwell.usualPer100 !== null ? `, usual ${Math.round(dwell.usualPer100)}` : ''}.`
        + (dwell.topRouteId ? ` Most on Route ${dwell.topRouteId} (${dwell.topRouteHours.toFixed(1)} hrs).` : ''),
      severity: 'medium',
    });
  }

  for (const routeId of newApcRoutes) {
    const route = latestDay.byRoute.find(entry => entry.routeId === routeId);
    actions.push({
      title: `Route ${routeId} APC counts`,
      detail: `Boardings and alightings differ by ${Math.round(route ? apcDiscrepancyPctForRoute(route) : 0)}%. Not flagged in the ${GLANCE_RULES.apcNewQuietDays} days before.`,
      severity: 'low',
    });
  }

  const gap = missedTripGapDays(input);
  if (gap !== null && gap > GLANCE_RULES.dataGapActionDays) {
    actions.push({
      title: 'Missed-trip feed',
      detail: input.lastMissedTripDataDate
        ? `No missed-trip data since ${shortDate(input.lastMissedTripDataDate)} (${gap} days). Check the export.`
        : 'No missed-trip data in recent reports. Check the export.',
      severity: 'low',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return actions
    .map((action, order) => ({ action, order }))
    .sort((a, b) => rank[a.action.severity] - rank[b.action.severity] || a.order - b.order)
    .slice(0, GLANCE_RULES.actionMax)
    .map(({ action }) => action);
}

function buildHeadline(dayType: DayType, otpDiff: number | null, ridersDiffPct: number | null, standouts: GlanceStandout[], latest: DailySummary): string {
  const dayLabel = DAY_LABEL[dayType];
  const standoutSentence = standouts.length === 0
    ? 'No route ran well below its usual.'
    : standouts.length === 1
      ? `Route ${standouts[0].routeId} ran well below its usual.`
      : `${COUNT_WORD[standouts.length] ?? standouts.length} routes ran well below their usual.`;

  if (otpDiff === null || ridersDiffPct === null) {
    return `On-time ${formatPct(latest.system.otp.onTimePercent)} with ${formatNumber(latest.system.totalRidership)} riders. ${standoutSentence}`;
  }

  const otpNormal = Math.abs(otpDiff) <= GLANCE_RULES.otpNormalBandPts;
  const ridersNormal = Math.abs(ridersDiffPct) <= GLANCE_RULES.ridersNormalBandPct;
  const otpPhrase = otpNormal ? 'normal on-time' : otpDiff > 0 ? 'on-time above usual' : 'on-time below usual';
  const dayPhrase = ridersNormal && otpNormal
    ? `A normal ${dayLabel}.`
    : ridersNormal
      ? `Normal ridership for a ${dayLabel}, with ${otpPhrase}.`
      : `A ${ridersDiffPct > 0 ? 'busy' : 'quiet'} ${dayLabel} with ${otpPhrase}.`;
  return `${dayPhrase} ${standoutSentence}`;
}

function deriveStatus(otpDiff: number | null, standouts: GlanceStandout[], latest: DailySummary, dwellElevated: boolean): GlanceStatus {
  const missedPct = latest.missedTrips && latest.missedTrips.totalScheduled > 0 ? latest.missedTrips.missedPct : 0;
  const worstDrop = Math.max(0, ...standouts.map(standout => standout.usualOtp - standout.otp));
  if ((otpDiff !== null && otpDiff <= -5) || missedPct >= 5 || worstDrop >= 15 || latest.system.otp.onTimePercent < 75) {
    return 'NEEDS ATTENTION';
  }
  const otpBelow = otpDiff !== null && otpDiff < -GLANCE_RULES.otpNormalBandPts;
  if (standouts.length > 0 || otpBelow || missedPct > 0 || dwellElevated) return 'REVIEW';
  return 'STABLE';
}

export function buildGlance(input: GlanceInput): GlanceModel {
  const { latestDay } = input;
  const priorSystem = priorSameType(input.systemHistory.filter(day => day.system.tripCount > 0), latestDay);
  const priorRouteDays = priorSameType(input.routeHistory, latestDay);

  const { comparisons, otpDiff, ridersDiffPct } = buildComparisons(latestDay, priorSystem);
  const standouts = buildStandouts(input, priorRouteDays);
  const apc = buildApcOngoing(input);

  const ongoing: GlanceOngoing[] = [];
  if (apc.item) ongoing.push(apc.item);
  const chronicLowest = buildChronicLowest(latestDay, priorRouteDays, standouts);
  if (chronicLowest) ongoing.push(chronicLowest);
  const gap = missedTripGapDays(input);
  if (gap !== null && gap > GLANCE_RULES.dataGapOngoingDays) {
    ongoing.push({
      text: input.lastMissedTripDataDate
        ? `Missed-trip data: none received since ${shortDate(input.lastMissedTripDataDate)}.`
        : 'Missed-trip data: none in recent reports.',
    });
  }

  return {
    status: deriveStatus(otpDiff, standouts, latestDay, Boolean(input.dwell?.elevated)),
    headline: buildHeadline(latestDay.dayType, otpDiff, ridersDiffPct, standouts, latestDay),
    comparisons,
    standouts,
    ongoing,
    actions: buildActions(input, standouts, apc.newRoutes),
  };
}
