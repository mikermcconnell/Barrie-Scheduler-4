
export interface TimeSlot {
  timeLabel: string; // "08:00"
  timestamp: number; // minutes from midnight

  // Demand
  northRequirement: number;
  southRequirement: number;
  floaterRequirement: number;
  floaterEffectiveRequirement: number;
  floaterEffectiveCoverage: number;
  totalRequirement: number;

  // Supply (Drivers)
  northCoverage: number;
  southCoverage: number;
  floaterCoverage: number;

  // Break Tracking
  driversOnBreak: number;
  northBreaks: number;
  southBreaks: number;
  floaterBreaks: number;
  driversInChangeoff: number;
  northChangeoffs: number;
  southChangeoffs: number;
  floaterChangeoffs: number;

  // Calculated
  totalActiveCoverage: number; // Physical active vehicles on the road
  totalEffectiveCoverage: number; // Zone-valid coverage after floater relief
  totalOverlappingShifts: number; // Includes drivers still on shift but unavailable due to break/changeoff
  northRelief: number; // Floater contribution to North
  southRelief: number; // Floater contribution to South
  floaterAssignedRelief: number; // Floaters temporarily covering North/South demand
  floaterAvailableCoverage: number; // Floaters still available to cover floater demand after relief
  originalActiveCoverage?: number; // For ghost line comparison in All view
  originalEffectiveCoverage?: number; // For ghost line comparison
  netDifference: number; // Effective coverage - Required
}

export interface SummaryMetrics {
  totalMasterHours: number;
  totalShiftHours: number;
  netDiffHours: number;
  coveragePercent: number;
}

export interface OnDemandChangeoffSettings {
  northChangeoffMinutes: number;
  southChangeoffMinutes: number;
}

export type OnDemandChangeoffLocation =
  | 'downtown'
  | 'park_place'
  | 'barrie_south_go'
  | 'welham'
  | 'garage';

export const DEFAULT_CHANGEOFF_LOCATION: OnDemandChangeoffLocation = 'garage';

export const ON_DEMAND_CHANGEOFF_LOCATION_LABELS: Record<OnDemandChangeoffLocation, string> = {
  downtown: 'Downtown Terminal',
  park_place: 'Park Place',
  barrie_south_go: 'Barrie South GO',
  welham: 'Welham',
  garage: 'Garage / off-site',
};

export enum Zone {
  NORTH = 'North',
  SOUTH = 'South',
  FLOATER = 'Floater'
}

export type ZoneFilterType = 'All' | 'North' | 'South' | 'Floater';

export interface Shift {
  id: string;
  driverName: string;
  zone: Zone;
  startSlot: number; // Active TOD planning-grid slot index.
  endSlot: number;
  breakStartSlot: number;
  breakDurationSlots: number;
  isPlaceholder?: boolean;
  isStraightShift?: boolean;
  handoffFromShiftId?: string;
  handoffToShiftId?: string;
  handoffFromLocation?: OnDemandChangeoffLocation;
  handoffToLocation?: OnDemandChangeoffLocation;
  dayType?: 'Weekday' | 'Saturday' | 'Sunday';
}

export const isSchedulableShift = (shift: Shift): boolean =>
  !shift.isPlaceholder && shift.endSlot > shift.startSlot;

export interface Requirement {
  slotIndex: number;
  total: number;
  north: number;
  south: number;
  floater: number;
}

// --- OTP Analysis Types ---

export interface OTPRecord {
  id: string;
  date: string; // ISO Date "2023-10-01"
  routeId: string;
  stopName: string;
  scheduledTime: string; // "07:10"
  actualTime: string; // "07:12"
  scheduledMinutes: number;
  actualMinutes: number;
  deviation: number; // Actual - Scheduled (minutes). Positive = Late.
  status: 'Early' | 'On Time' | 'Late' | 'Missed';
}

export interface OTPMetrics {
  totalTrips: number;
  onTimePercent: number;
  earlyPercent: number;
  latePercent: number;
  connectionSuccessPercent: number; // % of trips arriving before transfer buffer
  avgDeviation: number;
}
