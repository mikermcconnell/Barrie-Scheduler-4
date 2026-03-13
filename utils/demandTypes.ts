
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

  // Calculated
  totalActiveCoverage: number; // Physical active vehicles on the road
  totalEffectiveCoverage: number; // Zone-valid coverage after floater relief
  totalOverlappingShifts: number; // Includes drivers currently on break
  northRelief: number; // Floater contribution to North
  southRelief: number; // Floater contribution to South
  floaterAssignedRelief: number; // Floaters temporarily covering North/South demand
  floaterAvailableCoverage: number; // Floaters still available to cover floater demand after relief
  originalEffectiveCoverage?: number; // For ghost line comparison
  netDifference: number; // Effective coverage - Required
}

export interface SummaryMetrics {
  totalMasterHours: number;
  totalShiftHours: number;
  netDiffHours: number;
  coveragePercent: number;
}

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
  startSlot: number; // 0-96 (15 min increments)
  endSlot: number;
  breakStartSlot: number;
  breakDurationSlots: number;
  dayType?: 'Weekday' | 'Saturday' | 'Sunday';
}

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
