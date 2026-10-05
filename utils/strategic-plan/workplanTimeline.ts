import { addStrategicWorkplanDays } from './workplanBaseline';

export type StrategicWorkplanTimelineDragMode = 'move' | 'resize-start' | 'resize-end';

export interface StrategicWorkplanTimelineRange {
    startDate: string;
    endDate: string;
}

const DAY_MS = 86_400_000;

export function strategicWorkplanDateDifference(start: string, end: string): number {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}

export function strategicWorkplanPointerDeltaDays(
    clientDeltaX: number,
    timelineWidth: number,
    scheduleStart: string,
    scheduleEnd: string,
): number {
    if (!Number.isFinite(clientDeltaX) || !Number.isFinite(timelineWidth) || timelineWidth <= 0) return 0;
    const scheduleDays = Math.max(1, strategicWorkplanDateDifference(scheduleStart, scheduleEnd));
    const rawDays = (clientDeltaX / timelineWidth) * scheduleDays;
    return Math.round(rawDays / 7) * 7;
}

function clampDate(value: string, minimum: string, maximum: string): string {
    if (value < minimum) return minimum;
    if (value > maximum) return maximum;
    return value;
}

export function calculateStrategicWorkplanTimelineRange(options: {
    mode: StrategicWorkplanTimelineDragMode;
    startDate: string;
    endDate: string;
    scheduleStart: string;
    scheduleEnd: string;
    deltaDays: number;
}): StrategicWorkplanTimelineRange {
    const { mode, startDate, endDate, scheduleStart, scheduleEnd } = options;
    const deltaDays = Math.round(options.deltaDays / 7) * 7;

    if (mode === 'resize-start') {
        return {
            startDate: clampDate(addStrategicWorkplanDays(startDate, deltaDays), scheduleStart, endDate),
            endDate,
        };
    }

    if (mode === 'resize-end') {
        return {
            startDate,
            endDate: clampDate(addStrategicWorkplanDays(endDate, deltaDays), startDate, scheduleEnd),
        };
    }

    const minimumDelta = strategicWorkplanDateDifference(startDate, scheduleStart);
    const maximumDelta = strategicWorkplanDateDifference(endDate, scheduleEnd);
    const boundedDelta = Math.max(minimumDelta, Math.min(maximumDelta, deltaDays));
    return {
        startDate: addStrategicWorkplanDays(startDate, boundedDelta),
        endDate: addStrategicWorkplanDays(endDate, boundedDelta),
    };
}
