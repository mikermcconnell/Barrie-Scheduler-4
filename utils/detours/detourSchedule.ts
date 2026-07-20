import { DETOUR_TIME_ZONE, type DetourDerivedState, type DetourNotice } from './detourTypes';

const localDateTime = (date: Date): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: DETOUR_TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
};

export const deriveDetourState = (notice: DetourNotice, now = new Date()): DetourDerivedState => {
    const latestPostedRevision = notice.publications.reduce<number | null>(
        (latest, publication) => latest === null || publication.revision > latest ? publication.revision : latest,
        null,
    );
    const updateNeeded = notice.status === 'posted'
        && (latestPostedRevision === null || notice.revision > latestPostedRevision);

    if (notice.status === 'archived') return { lifecycle: 'archived', updateNeeded: false, latestPostedRevision };
    if (notice.status === 'draft') return { lifecycle: 'draft', updateNeeded: false, latestPostedRevision };

    const current = localDateTime(now);
    const start = `${notice.schedule.startDate}T${notice.schedule.startTime}:00`;
    if (current < start) return { lifecycle: 'upcoming', updateNeeded, latestPostedRevision };
    if (notice.schedule.end.mode === 'fixed') {
        const end = `${notice.schedule.end.date}T${notice.schedule.end.time}:59`;
        if (current > end) return { lifecycle: 'expired', updateNeeded, latestPostedRevision };
    }
    return { lifecycle: 'active', updateNeeded, latestPostedRevision };
};
