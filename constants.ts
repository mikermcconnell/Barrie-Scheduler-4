export const TIME_SLOTS_PER_DAY = 96; // 24 * 4 (15 min increments)
export const START_HOUR = 4; // 4 AM start of service visualization
export const END_HOUR = 26; // 2 AM next day (service visualization end)

// Mock Data Configuration
export const PEAK_AM_START = 7;
export const PEAK_AM_END = 9;
export const PEAK_PM_START = 15;
export const PEAK_PM_END = 18;

export const BASE_REQUIREMENT = 4;
export const PEAK_REQUIREMENT = 8;

// Break & Shift Rules
export const SHIFT_DURATION_HOURS = 8; // Default reference
export const SHIFT_DURATION_SLOTS = SHIFT_DURATION_HOURS * 4;
export const BREAK_DURATION_MINUTES = 45;
export const BREAK_DURATION_SLOTS = 3; // 45 mins / 15 mins
export const MAX_HOURS_WITHOUT_BREAK = 5;

// New Union Rules
export const MIN_SHIFT_HOURS = 5;
export const MAX_SHIFT_HOURS = 11;
export const BREAK_THRESHOLD_HOURS = 7.5; // Shifts > 7.5h need a break