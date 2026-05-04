export type SlotGranularityMinutes = 5 | 15;

export interface SlotGrid {
  slotMinutes: SlotGranularityMinutes;
  slotsPerHour: number;
  timeSlotsPerDay: number;
  slotToMinutes: (slot: number) => number;
  minutesToSlot: (minutes: number) => number;
  minutesToSlotsCeil: (minutes: number) => number;
  hoursToSlots: (hours: number) => number;
  slotDurationToHours: (slots: number) => number;
  formatSlotToTime: (slot: number) => string;
}

export const formatMinutesToTime = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.round(totalMinutes % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const createSlotGrid = (slotMinutes: SlotGranularityMinutes): SlotGrid => {
  const slotsPerHour = 60 / slotMinutes;
  const timeSlotsPerDay = 24 * slotsPerHour;

  return {
    slotMinutes,
    slotsPerHour,
    timeSlotsPerDay,
    slotToMinutes: (slot: number) => Math.round(slot * slotMinutes),
    minutesToSlot: (minutes: number) => Math.floor(minutes / slotMinutes),
    minutesToSlotsCeil: (minutes: number) => Math.ceil(minutes / slotMinutes),
    hoursToSlots: (hours: number) => Math.round(hours * slotsPerHour),
    slotDurationToHours: (slots: number) => slots / slotsPerHour,
    formatSlotToTime: (slot: number) => formatMinutesToTime(Math.round(slot * slotMinutes)),
  };
};

// Active TOD planning grid. Legacy 15-minute saved schedules are converted on load.
export const SLOT_MINUTES: SlotGranularityMinutes = 5;
export const ACTIVE_SLOT_GRID = createSlotGrid(SLOT_MINUTES);
export const SLOTS_PER_HOUR = ACTIVE_SLOT_GRID.slotsPerHour;
export const TIME_SLOTS_PER_DAY = ACTIVE_SLOT_GRID.timeSlotsPerDay; // 24 * slots/hour
export const START_HOUR = 4; // 4 AM start of service visualization
export const END_HOUR = 26; // 2 AM next day (service visualization end)

export const slotToMinutes = ACTIVE_SLOT_GRID.slotToMinutes;
export const minutesToSlot = ACTIVE_SLOT_GRID.minutesToSlot;
export const minutesToSlotsCeil = ACTIVE_SLOT_GRID.minutesToSlotsCeil;
export const hoursToSlots = ACTIVE_SLOT_GRID.hoursToSlots;
export const slotDurationToHours = ACTIVE_SLOT_GRID.slotDurationToHours;
export const formatSlotToTime = ACTIVE_SLOT_GRID.formatSlotToTime;

// Mock Data Configuration
export const PEAK_AM_START = 7;
export const PEAK_AM_END = 9;
export const PEAK_PM_START = 15;
export const PEAK_PM_END = 18;

export const BASE_REQUIREMENT = 4;
export const PEAK_REQUIREMENT = 8;

// Break & Shift Rules
export const SHIFT_DURATION_HOURS = 8; // Default reference
export const SHIFT_DURATION_SLOTS = hoursToSlots(SHIFT_DURATION_HOURS);
export const BREAK_DURATION_MINUTES = 45;
export const BREAK_DURATION_SLOTS = minutesToSlotsCeil(BREAK_DURATION_MINUTES);
export const MAX_HOURS_WITHOUT_BREAK = 5;

// New Union Rules
export const MIN_SHIFT_HOURS = 5;
export const MAX_SHIFT_HOURS = 11;
export const BREAK_THRESHOLD_HOURS = 7.5; // Shifts > 7.5h need a break
