/**
 * Shared Time Utilities
 * 
 * Centralized time parsing and formatting for the scheduler application.
 * Used by AddTripModal, FixedRouteWorkspace, and other components.
 */

/**
 * Convert a time string (e.g., "10:30 AM") to minutes from midnight.
 * Also handles Excel decimal format and raw minute numbers.
 */
export const toMinutes = (timeStr: string | number): number | null => {
    if (timeStr === null || timeStr === undefined || timeStr === '') return null;

    // Handle Excel decimal days (e.g., 0.5 = 12:00 PM)
    if (typeof timeStr === 'number') {
        if (timeStr > 2) {
            const fraction = timeStr % 1;
            return Math.round(fraction * 24 * 60);
        }
        return Math.round(timeStr * 24 * 60);
    }

    const str = String(timeStr).trim().toLowerCase();

    // Skip invalid strings (headers)
    if (str.includes('route') || str.includes('block') || str.includes('notes')) return null;

    // Handle raw minutes (e.g., "5" for recovery time)
    if (!str.includes(':') && !str.includes('am') && !str.includes('pm')) {
        const num = parseInt(str);
        return isNaN(num) ? null : num;
    }

    // Parse time string
    const match = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
    if (!match) return null;

    const [, hStr, mStr] = match;
    let h = parseInt(hStr);
    const m = parseInt(mStr);

    if (str.includes('pm') && h !== 12) h += 12;
    if (str.includes('am') && h === 12) h = 0;

    return (h * 60) + m;
};

/**
 * Convert minutes from midnight to a formatted time string (e.g., "10:30 AM").
 */
export const fromMinutes = (totalMinutes: number): string => {
    let h = Math.floor(totalMinutes / 60);
    let m = Math.round(totalMinutes % 60);

    // Handle rounding up 60 mins
    if (m === 60) {
        h += 1;
        m = 0;
    }

    const period = h >= 12 && h < 24 ? 'PM' : 'AM';

    if (h > 12) h -= 12;
    if (h === 0 || h === 24) h = 12;
    if (h > 24) h -= 24;

    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

/**
 * Add minutes to a time string and return a new time string.
 */
export const addMinutes = (timeStr: string, minutes: number): string => {
    const m = toMinutes(timeStr);
    if (m === null) return timeStr;
    return fromMinutes(m + minutes);
};

/**
 * TimeUtils object for backwards compatibility.
 * Use the individual exports for new code.
 */
export const TimeUtils = {
    toMinutes,
    fromMinutes,
    addMinutes
};
