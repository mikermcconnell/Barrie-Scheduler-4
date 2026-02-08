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

    // Handle Excel decimal days (e.g., 0.5 = 12:00 PM, 1.02 = 12:30 AM next day)
    // Values >= 1.0 represent times past midnight (the integer part is the day offset)
    if (typeof timeStr === 'number') {
        if (timeStr >= 1) {
            const wholeDays = Math.floor(timeStr);
            const fraction = timeStr % 1;
            if (fraction < 0.001) return null; // Pure date with no time
            return (wholeDays * 24 * 60) + Math.round(fraction * 24 * 60);
        }
        // Pure time fraction (< 1.0): 0.5 = noon, 0.75 = 6 PM
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
    const match = str.match(/(\d{1,2}):(\d{2})\s*([ap]m?|[ap])?/);
    if (!match) return null;

    const [, hStr, mStr] = match;
    let h = parseInt(hStr);
    const m = parseInt(mStr);

    const periodChar = match[3]?.toLowerCase()?.[0];
    if (periodChar === 'p' && h !== 12) h += 12;
    if (periodChar === 'a' && h === 12) h = 0;

    return (h * 60) + m;
};

/**
 * Convert minutes from midnight to a formatted time string (e.g., "10:30 AM").
 * Handles negative values and values >= 24 hours (wraps around).
 */
export const fromMinutes = (totalMinutes: number): string => {
    // Normalize to 0-1439 range (24 hours = 1440 minutes)
    let normalized = totalMinutes % 1440;
    if (normalized < 0) normalized += 1440;

    let h = Math.floor(normalized / 60);
    let m = Math.round(normalized % 60);

    // Handle rounding up 60 mins
    if (m === 60) {
        h += 1;
        m = 0;
        if (h >= 24) h = 0;
    }

    // Determine AM/PM based on 24-hour value
    const period = h >= 12 ? 'PM' : 'AM';

    // Convert to 12-hour format
    const h12 = h % 12 || 12;

    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
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
