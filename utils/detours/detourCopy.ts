export type DetourEndMode = 'date' | 'until-further-notice' | 'until-construction-complete';

export interface DetourRecurrenceInput {
  days: string[];
  startTime?: string;
  endTime?: string;
}

export interface DetourEffectiveScheduleInput {
  startDate: string;
  startTime?: string;
  endMode: DetourEndMode;
  endDate?: string;
  endTime?: string;
  recurrence?: DetourRecurrenceInput;
  timezone?: string;
}

export interface DetourRouteCopyInput {
  routeShortName: string;
  directionLabel?: string;
}

export interface DetourExportNoticeInput {
  noticeType?: 'route-detour' | 'stop-closure';
  title: string;
  publicSummary?: string;
  publicDetails: string;
  effectiveSchedule: DetourEffectiveScheduleInput;
  routes: DetourRouteCopyInput[];
  revision: number;
  stopCounts?: {
    closed: number;
    temporary: number;
  };
}

export interface MyRideCopyPackage {
  title: string;
  summary: string;
  accessibleDetails: string;
  routeTags: string[];
  altText: string;
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Keeps generated copy as plain text even when planner input contains markup-like characters. */
export function sanitizeDetourPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\p{Cc}/gu, character => character === '\n' ? character : '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Adapts the persisted domain model without making export utilities own that schema. */
export function toDetourExportNoticeInput(notice: import('./detourTypes').DetourNotice): DetourExportNoticeInput {
  const schedule = notice.schedule;
  const end = schedule.end;
  const recurrence = schedule.recurrence;
  const impacts = notice.overlays.flatMap(overlay => overlay.stopImpacts);
  return {
    noticeType: notice.type,
    title: notice.title,
    publicSummary: notice.publicSummary,
    publicDetails: notice.publicDetails,
    effectiveSchedule: {
      startDate: schedule.startDate,
      startTime: schedule.startTime,
      endMode: end.mode === 'fixed' ? 'date' : end.mode,
      endDate: end.mode === 'fixed' ? end.date : undefined,
      endTime: end.mode === 'fixed' ? end.time : undefined,
      recurrence: recurrence.mode === 'weekly'
        ? { days: recurrence.days, startTime: recurrence.startTime, endTime: recurrence.endTime }
        : undefined,
      timezone: schedule.timeZone,
    },
    routes: notice.overlays.map(overlay => ({
      routeShortName: overlay.routeSnapshot.routeShortName,
      directionLabel: overlay.routeSnapshot.directionLabel,
    })),
    revision: notice.revision,
    stopCounts: {
      closed: impacts.filter(impact => impact.status === 'closed').length,
      temporary: impacts.filter(impact => impact.status === 'temporary').length,
    },
  };
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  }).format(parsed);
}

function formatTime(time?: string): string {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return '';
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) return time;
  const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function formatDays(days: string[]): string {
  const normalized = [...new Set(days.map(day => day[0]?.toUpperCase() + day.slice(1).toLowerCase()))]
    .filter(day => DAY_ORDER.includes(day))
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  if (normalized.length === 7) return 'daily';
  if (normalized.join(',') === DAY_ORDER.slice(0, 5).join(',')) return 'Monday to Friday';
  if (normalized.length <= 1) return normalized[0] ?? '';
  if (normalized.length === 2) return `${normalized[0]} and ${normalized[1]}`;
  return `${normalized.slice(0, -1).join(', ')}, and ${normalized.at(-1)}`;
}

export function formatDetourEffectiveSchedule(schedule: DetourEffectiveScheduleInput): string {
  const start = [formatDate(schedule.startDate), formatTime(schedule.startTime)].filter(Boolean).join(' at ');
  let ending: string;
  if (schedule.endMode === 'until-further-notice') {
    ending = 'until further notice';
  } else if (schedule.endMode === 'until-construction-complete') {
    ending = 'until construction is complete';
  } else {
    ending = `to ${[schedule.endDate ? formatDate(schedule.endDate) : '', formatTime(schedule.endTime)]
      .filter(Boolean).join(' at ')}`;
  }

  const recurrence = schedule.recurrence;
  if (!recurrence || recurrence.days.length === 0) return `${start} ${ending}`.trim();
  const hours = recurrence.startTime && recurrence.endTime
    ? `, ${formatTime(recurrence.startTime)} to ${formatTime(recurrence.endTime)}`
    : '';
  return `${start} ${ending}; applies ${formatDays(recurrence.days)}${hours}`.trim();
}

export function formatDetourRouteLabel(routes: DetourRouteCopyInput[]): string {
  return routes
    .map(route => `Route ${sanitizeDetourPlainText(route.routeShortName)}${route.directionLabel ? ` · ${sanitizeDetourPlainText(route.directionLabel)}` : ''}`)
    .join(' / ');
}

export function buildMyRideCopyPackage(notice: DetourExportNoticeInput): MyRideCopyPackage {
  const title = sanitizeDetourPlainText(notice.title);
  const routes = notice.routes.map(route => sanitizeDetourPlainText(route.routeShortName)).filter(Boolean);
  const routeTags = [...new Set(routes)].map(route => `Route ${route}`);
  const routeLabel = formatDetourRouteLabel(notice.routes);
  const effective = formatDetourEffectiveSchedule(notice.effectiveSchedule);
  const details = sanitizeDetourPlainText(notice.publicDetails);
  const effectiveSentence = effective.endsWith('.') ? effective : `${effective}.`;
  const generatedSummary = notice.noticeType === 'stop-closure'
    ? `${routeLabel || 'Barrie Transit service'} has a temporary stop closure. ${effectiveSentence}`
    : `${routeLabel || 'Barrie Transit service'} is operating on a temporary detour. ${effectiveSentence}`;
  const summary = sanitizeDetourPlainText(notice.publicSummary?.trim() || generatedSummary);
  const impacts: string[] = [];
  if ((notice.stopCounts?.closed ?? 0) > 0) impacts.push(`${notice.stopCounts?.closed} closed stop${notice.stopCounts?.closed === 1 ? '' : 's'}`);
  if ((notice.stopCounts?.temporary ?? 0) > 0) impacts.push(`${notice.stopCounts?.temporary} temporary stop${notice.stopCounts?.temporary === 1 ? '' : 's'}`);
  const impactText = impacts.length > 0 ? ` The map identifies ${impacts.join(' and ')}.` : '';

  return {
    title,
    summary,
    accessibleDetails: [title, routeLabel, `Effective: ${effective}.`, details].filter(Boolean).join('\n\n'),
    routeTags,
    altText: `Detour map for ${routeLabel || 'Barrie Transit'}. Effective ${effective}.${impactText}`,
  };
}
