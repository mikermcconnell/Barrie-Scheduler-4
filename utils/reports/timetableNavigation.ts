import type { DayType } from '../masterScheduleTypes';

export interface TimetablePublisherTarget {
    routeNumber?: string | null;
    dayType?: DayType | null;
}

const encodeSegment = (value: string): string => encodeURIComponent(value.trim());
const decodeSegment = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const isDayType = (value: string | undefined): value is DayType => (
    value === 'Weekday' || value === 'Saturday' || value === 'Sunday'
);

export function buildTimetablePublisherHash(target: TimetablePublisherTarget = {}): string {
    const routeNumber = target.routeNumber?.trim();
    const segments = ['fixed', 'reports'];

    if (routeNumber) {
        segments.push(encodeSegment(routeNumber));
        if (target.dayType) {
            segments.push(encodeSegment(target.dayType));
        }
    }

    return `#${segments.join('/')}`;
}

export function openTimetablePublisher(target: TimetablePublisherTarget = {}): void {
    window.location.hash = buildTimetablePublisherHash(target);
}

export function parseTimetablePublisherHash(hash = window.location.hash): TimetablePublisherTarget {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'fixed' || parts[1] !== 'reports') {
        return {};
    }

    const routeNumber = decodeSegment(parts[2])?.trim();
    const dayType = decodeSegment(parts[3])?.trim();

    return {
        routeNumber: routeNumber || undefined,
        dayType: isDayType(dayType) ? dayType : undefined,
    };
}
