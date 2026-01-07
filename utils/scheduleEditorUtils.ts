/**
 * Schedule Editor Utility Functions
 *
 * Extracted from ScheduleEditor.tsx for better maintainability.
 * Pure utility functions with no React dependencies.
 */

import { MasterRouteTable, MasterTrip } from './masterScheduleParser';

// --- Schedule Data Operations ---

/**
 * Deep clone schedules array to avoid mutation
 */
export const deepCloneSchedules = (schedules: MasterRouteTable[]): MasterRouteTable[] => {
    return JSON.parse(JSON.stringify(schedules));
};

/**
 * Find a trip by ID across all schedule tables
 */
export const findTableAndTrip = (
    schedules: MasterRouteTable[],
    tripId: string
): { table: MasterRouteTable; trip: MasterTrip; tableIdx: number } | null => {
    for (let i = 0; i < schedules.length; i++) {
        const trip = schedules[i].trips.find(t => t.id === tripId);
        if (trip) return { table: schedules[i], trip, tableIdx: i };
    }
    return null;
};

// --- Headway & Trip Analysis ---

/**
 * Calculate headways between consecutive trips by direction
 */
export const calculateHeadways = (trips: MasterTrip[]): Record<string, number> => {
    const headways: Record<string, number> = {};
    const byDir: Record<string, MasterTrip[]> = {};

    trips.forEach(t => {
        const dir = t.direction || 'Loop';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(t);
    });

    Object.values(byDir).forEach(dirTrips => {
        dirTrips.sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < dirTrips.length; i++) {
            const current = dirTrips[i];
            const prev = dirTrips[i - 1];
            headways[current.id] = current.startTime - prev.startTime;
        }
    });

    return headways;
};

/**
 * Check headway consistency and flag irregularities
 */
export const analyzeHeadways = (trips: MasterTrip[]): { avg: number; irregular: string[] } => {
    const byDir: Record<string, MasterTrip[]> = {};
    trips.forEach(t => {
        const dir = t.direction || 'Loop';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(t);
    });

    const allHeadways: number[] = [];
    const irregular: string[] = [];

    Object.entries(byDir).forEach(([dir, dirTrips]) => {
        const sorted = [...dirTrips].sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < sorted.length; i++) {
            const headway = sorted[i].startTime - sorted[i - 1].startTime;
            allHeadways.push(headway);
        }
    });

    if (allHeadways.length > 0) {
        const avg = allHeadways.reduce((a, b) => a + b, 0) / allHeadways.length;
        allHeadways.forEach((h, idx) => {
            if (Math.abs(h - avg) > avg * 0.3) { // More than 30% deviation
                irregular.push(`Trip ${idx + 2}: ${h} min (avg: ${Math.round(avg)})`);
            }
        });
        return { avg: Math.round(avg), irregular };
    }
    return { avg: 0, irregular: [] };
};

/**
 * Calculate round trips per hour (counts North departures only)
 */
export const calculateTripsPerHour = (trips: MasterTrip[]): Record<number, number> => {
    const hourCounts: Record<number, number> = {};
    const northTrips = trips.filter(t => t.direction === 'North');
    northTrips.forEach(t => {
        const hour = Math.floor(t.startTime / 60);
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    return hourCounts;
};

// --- Vehicle & Service Calculations ---

/**
 * Calculate peak vehicle requirement (unique blocks)
 */
export const calculatePeakVehicles = (trips: MasterTrip[]): number => {
    const uniqueBlocks = new Set(trips.map(t => t.blockId));
    return uniqueBlocks.size;
};

/**
 * Calculate service span (first departure to last arrival)
 */
export const calculateServiceSpan = (trips: MasterTrip[]): { start: string; end: string; hours: number } => {
    if (trips.length === 0) return { start: '-', end: '-', hours: 0 };

    const sortedByStart = [...trips].sort((a, b) => a.startTime - b.startTime);
    const sortedByEnd = [...trips].sort((a, b) => b.endTime - a.endTime);

    const startMins = sortedByStart[0].startTime;
    const endMins = sortedByEnd[0].endTime;

    const formatTime = (mins: number) => {
        const h = Math.floor(mins / 60) % 24;
        const m = mins % 60;
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
    };

    return {
        start: formatTime(startMins),
        end: formatTime(endMins),
        hours: Number(((endMins - startMins) / 60).toFixed(1))
    };
};

// --- Recovery Time Analysis ---

/**
 * Get recovery ratio color class
 * 15% is sweet spot: <10% red, 10-15% yellow, 15-20% green, 20-25% yellow, >25% red
 */
export const getRatioColor = (ratio: number): string => {
    if (ratio < 10) return 'bg-red-100 text-red-700';
    if (ratio < 15) return 'bg-yellow-50 text-yellow-700';
    if (ratio <= 20) return 'bg-emerald-50 text-emerald-700';
    if (ratio <= 25) return 'bg-yellow-50 text-yellow-700';
    return 'bg-red-100 text-red-700';
};

/**
 * Get recovery status label and color
 */
export const getRecoveryStatus = (ratio: number): { label: string; color: string } => {
    if (ratio < 10) return { label: 'Low', color: 'text-red-600' };
    if (ratio < 15) return { label: 'Marginal', color: 'text-yellow-600' };
    if (ratio <= 20) return { label: 'Optimal', color: 'text-emerald-600' };
    if (ratio <= 25) return { label: 'High', color: 'text-yellow-600' };
    return { label: 'Excessive', color: 'text-red-600' };
};

// --- UI Helpers ---

/**
 * Band colors for row tinting
 */
export const getBandRowColor = (bandId: string | undefined): string => {
    const colors: Record<string, string> = {
        'A': 'bg-red-100/30',
        'B': 'bg-orange-100/30',
        'C': 'bg-yellow-100/30',
        'D': 'bg-lime-100/30',
        'E': 'bg-emerald-100/30'
    };
    return bandId ? colors[bandId] || '' : '';
};

// --- Time Input Parsing ---

/**
 * Parse time input with smart formatting
 * Converts shorthand like "630" → "6:30 AM", "1430" → "2:30 PM"
 * Preserves original period if input doesn't specify AM/PM
 */
export const parseTimeInput = (input: string, originalValue?: string): string | null => {
    const inputLower = input.toLowerCase();

    const hasExplicitAM = inputLower.includes('am') || inputLower.includes('a.m');
    const hasExplicitPM = inputLower.includes('pm') || inputLower.includes('p.m');
    const hasExplicitPeriod = hasExplicitAM || hasExplicitPM;

    const originalPeriod = originalValue?.toLowerCase().includes('pm') ? 'PM' :
        originalValue?.toLowerCase().includes('am') ? 'AM' : null;

    const cleaned = input.replace(/[^0-9:]/g, '');

    let hours: number;
    let minutes: number;

    if (cleaned.includes(':')) {
        const [h, m] = cleaned.split(':');
        hours = parseInt(h) || 0;
        minutes = parseInt(m) || 0;
    } else if (cleaned.length <= 2) {
        hours = parseInt(cleaned) || 0;
        minutes = 0;
    } else if (cleaned.length === 3) {
        hours = parseInt(cleaned[0]) || 0;
        minutes = parseInt(cleaned.slice(1)) || 0;
    } else if (cleaned.length >= 4) {
        hours = parseInt(cleaned.slice(0, cleaned.length - 2)) || 0;
        minutes = parseInt(cleaned.slice(-2)) || 0;
    } else {
        return null;
    }

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    let period: 'AM' | 'PM';

    if (hasExplicitPM) {
        period = 'PM';
        if (hours < 12) hours += 12;
    } else if (hasExplicitAM) {
        period = 'AM';
        if (hours === 12) hours = 0;
    } else if (hours >= 12 && hours <= 23) {
        period = 'PM';
    } else if (hours === 0) {
        period = 'AM';
    } else if (!hasExplicitPeriod && originalPeriod) {
        period = originalPeriod;
    } else {
        period = hours >= 1 && hours <= 11 ? 'PM' : 'AM';
    }

    const h12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

/**
 * Sanitize input to prevent XSS and injection
 */
export const sanitizeInput = (input: string): string => {
    return input
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '')
        .trim()
        .slice(0, 20);
};

/**
 * Parse time string for stacked display
 * Converts "6:30 AM" to { time: "6:30", period: "AM" }
 */
export const parseStackedTime = (timeStr: string | undefined): { time: string; period: string } | null => {
    if (!timeStr) return null;
    const match = timeStr.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
    if (match) {
        return { time: match[1], period: match[2].toUpperCase() };
    }
    return null;
};

// --- Validation ---

export interface ValidationWarning {
    type: 'error' | 'warning' | 'info';
    message: string;
    tripId?: string;
}

/**
 * Validate schedule and return warnings
 */
export const validateSchedule = (trips: MasterTrip[]): ValidationWarning[] => {
    const warnings: ValidationWarning[] = [];

    trips.forEach(trip => {
        const ratio = trip.travelTime > 0 ? (trip.recoveryTime / trip.travelTime) * 100 : 0;

        if (ratio < 10 && trip.recoveryTime < 5) {
            warnings.push({
                type: 'warning',
                message: `Block ${trip.blockId}: Very tight recovery (${trip.recoveryTime} min, ${ratio.toFixed(0)}%)`,
                tripId: trip.id
            });
        }

        if (ratio > 25) {
            warnings.push({
                type: 'warning',
                message: `Block ${trip.blockId}: Excessive recovery (${trip.recoveryTime} min, ${ratio.toFixed(0)}%)`,
                tripId: trip.id
            });
        }

        if (trip.travelTime > 90) {
            warnings.push({
                type: 'info',
                message: `Block ${trip.blockId}: Long travel time (${trip.travelTime} min)`,
                tripId: trip.id
            });
        }
    });

    // Check for gaps in service
    const byDir: Record<string, MasterTrip[]> = {};
    trips.forEach(t => {
        const dir = t.direction || 'Loop';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(t);
    });

    Object.entries(byDir).forEach(([dir, dirTrips]) => {
        const sorted = [...dirTrips].sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].startTime - sorted[i - 1].endTime;
            if (gap > 90) {
                warnings.push({
                    type: 'warning',
                    message: `${dir}: ${gap} min gap between trips`,
                    tripId: sorted[i].id
                });
            }
        }
    });

    return warnings;
};
