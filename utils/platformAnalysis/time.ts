import type { MasterTrip } from '../masterScheduleParser';

/**
 * Parse time string to minutes from midnight.
 * Handles multiple formats:
 * - 12-hour with AM/PM: "6:30 AM", "11:45 PM"
 * - 24-hour: "06:30", "23:45"
 * - Excel day fractions: 0.5 = 12:00 PM, 1.02 = 12:30 AM (next day)
 */
export function parseTimeToMinutes(timeStr: string): number {
    if (!timeStr) return -1;

    const str = timeStr.trim();

    // Handle Excel numeric format (day fractions)
    const numVal = parseFloat(str);
    if (!isNaN(numVal) && !str.includes(':')) {
        // Excel stores times as fractions of a day
        // Values >= 1.0 are post-midnight (next day)
        const fractional = numVal >= 1 ? numVal - Math.floor(numVal) : numVal;
        const totalMinutes = Math.round(fractional * 24 * 60);
        return totalMinutes;
    }

    // Handle string time formats
    const lowerStr = str.toLowerCase();
    const [hStr, mStr] = str.split(':');
    let h = parseInt(hStr);
    let m = parseInt(mStr?.replace(/\D+/g, '') || '0');

    if (isNaN(h) || isNaN(m)) return -1;

    // Check for AM/PM
    const hasAm = lowerStr.includes('am');
    const hasPm = lowerStr.includes('pm');

    if (hasPm && h !== 12) h += 12;
    if (hasAm && h === 12) h = 0;

    return (h * 60) + m;
}

/**
 * Format minutes to time string
 */
export function formatMinutesToTime(minutes: number): string {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
}

/**
 * Get arrival and departure times for a trip at a stop.
 *
 * Handles two data conventions:
 *   scheduleGenerator: stops = departure times, arrivalTimes = arrival times
 *   GTFS importer:     stops = arrival times,   recoveryTimes = dwell delta
 *
 * No fallback dwell — if the schedule has no recovery, arrival = departure.
 */
export function getDwellTimes(trip: MasterTrip, stopName: string): { arrivalMin: number; departureMin: number } {
    // Arrival: prefer arrivalTimes, fall back to stops
    const arrivalStr = trip.arrivalTimes?.[stopName] || trip.stops[stopName];
    const arrivalMin = parseTimeToMinutes(arrivalStr);

    // Recovery/dwell at this stop
    const recovery = trip.recoveryTimes?.[stopName] || 0;

    if (recovery > 0) {
        return { arrivalMin, departureMin: arrivalMin + recovery };
    }

    // No explicit recovery: check if stops has a later time than arrival
    // (scheduleGenerator pattern where stops = departure)
    const stopsMin = parseTimeToMinutes(trip.stops[stopName]);
    if (stopsMin > arrivalMin) {
        return { arrivalMin, departureMin: stopsMin };
    }

    // No dwell in schedule data — arrival = departure
    return { arrivalMin, departureMin: arrivalMin };
}
