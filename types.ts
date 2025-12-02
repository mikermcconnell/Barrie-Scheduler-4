
export interface TimeSlot {
  timeLabel: string; // "08:00"
  timestamp: number; // minutes from midnight
  
  // Demand
  northRequirement: number;
  southRequirement: number;
  totalRequirement: number;

  // Supply (Drivers)
  northCoverage: number;
  southCoverage: number;
  floaterCoverage: number;
  
  // Break Tracking
  driversOnBreak: number;

  // Calculated
  totalActiveCoverage: number; // North + South + Floater
  netDifference: number; // Active - Required
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

export interface Shift {
  id: string;
  driverName: string;
  zone: Zone;
  startSlot: number; // 0-96 (15 min increments)
  endSlot: number;
  breakStartSlot: number;
  breakDurationSlots: number;
}

export interface Requirement {
  slotIndex: number;
  total: number;
  north: number;
  south: number;
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
