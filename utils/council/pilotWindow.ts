import type { CouncilMeeting } from './types';

export const COUNCIL_PILOT_LOOKBACK_DAYS = 90;

export interface CouncilPilotWindow {
  startsAt: string;
  endsAt: string;
}

function requireValidDate(value: string | Date, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return date;
}

export function getCouncilPilotWindow(
  deploymentDate: string | Date,
  lookbackDays = COUNCIL_PILOT_LOOKBACK_DAYS,
): CouncilPilotWindow {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 0) {
    throw new Error('lookbackDays must be a non-negative integer.');
  }
  const endsAt = requireValidDate(deploymentDate, 'deploymentDate');
  const startsAt = new Date(endsAt.getTime());
  startsAt.setUTCDate(startsAt.getUTCDate() - lookbackDays);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

export function isDateInCouncilPilotWindow(
  value: string | Date,
  window: CouncilPilotWindow,
): boolean {
  const date = requireValidDate(value, 'value').getTime();
  const start = requireValidDate(window.startsAt, 'window.startsAt').getTime();
  const end = requireValidDate(window.endsAt, 'window.endsAt').getTime();
  if (start > end) throw new Error('Pilot window start must not be after its end.');
  return date >= start && date <= end;
}

export function filterMeetingsInCouncilPilotWindow<T extends Pick<CouncilMeeting, 'startsAt'>>(
  meetings: readonly T[],
  window: CouncilPilotWindow,
): T[] {
  return meetings.filter(meeting => isDateInCouncilPilotWindow(meeting.startsAt, window));
}
