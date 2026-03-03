// Performance Data Types — server-side copy for Cloud Functions
// Mirrors utils/performanceDataTypes.ts (source of truth is client-side)

export type DayType = 'weekday' | 'saturday' | 'sunday';

export function parseDayType(raw: string): DayType {
  switch (raw) {
    case 'SATURDAY': return 'saturday';
    case 'SUNDAY': return 'sunday';
    default: return 'weekday';
  }
}

export function deriveDayTypeFromDate(dateStr: string): DayType {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

export interface STREETSRecord {
  vehicleLocationTPKey: number;
  vehicleId: string;
  inBetween: boolean;
  isTripper: boolean;
  date: string;
  month: string;
  day: string;
  arrivalTime: string;
  observedArrivalTime: string | null;
  stopTime: string;
  observedDepartureTime: string | null;
  wheelchairUsageCount: number;
  departureLoad: number;
  boardings: number;
  alightings: number;
  apcSource: number;
  block: string;
  operatorId: string;
  tripName: string;
  stopName: string;
  routeName: string;
  branch: string;
  routeId: string;
  routeStopIndex: number;
  stopId: string;
  direction: string;
  isDetour: boolean;
  stopLat: number;
  stopLon: number;
  timePoint: boolean;
  distance: number;
  previousStopName: string | null;
  tripId: string;
  internalTripId: number;
  terminalDepartureTime: string;
}

export const STREETS_REQUIRED_COLUMNS = [
  'VehicleID', 'InBetween', 'Date', 'Day', 'ArrivalTime', 'ObservedArrivalTime',
  'StopTime', 'ObservedDepartureTime', 'DepartureLoad', 'Boardings', 'Alightings',
  'Block', 'TripName', 'StopName', 'RouteName', 'RouteID', 'RouteStopIndex',
  'StopID', 'Direction', 'StopLat', 'StopLon', 'TimePoint', 'TripID',
  'TerminalDepartureTime', 'WheelchairUsageCount',
] as const;

export type OTPStatus = 'early' | 'on-time' | 'late';

// ─── Dwell Classification ───────────────────────────────────────────
export type DwellSeverity = 'moderate' | 'high';

export const DWELL_THRESHOLDS = {
  boardingAllowanceSeconds: 120,
  highRawSeconds: 300,
} as const;

export function classifyDwell(rawDwellSeconds: number): DwellSeverity | null {
  if (rawDwellSeconds < DWELL_THRESHOLDS.boardingAllowanceSeconds) return null;
  if (rawDwellSeconds > DWELL_THRESHOLDS.highRawSeconds) return 'high';
  return 'moderate';
}

export interface DwellIncident {
  operatorId: string;
  date: string;
  routeId: string;
  routeName: string;
  stopName: string;
  stopId: string;
  tripName: string;
  block: string;
  observedArrivalTime: string;
  observedDepartureTime: string;
  rawDwellSeconds: number;
  trackedDwellSeconds: number;
  severity: DwellSeverity;
}

export interface OperatorDwellSummary {
  operatorId: string;
  moderateCount: number;
  highCount: number;
  totalIncidents: number;
  totalTrackedDwellSeconds: number;
  avgTrackedDwellSeconds: number;
  stopVisitCount?: number;
  serviceHours?: number;
  incidentsPer1kVisits?: number;
  incidentsPer100ServiceHours?: number;
}

export interface OperatorDwellMetrics {
  incidents: DwellIncident[];
  byOperator: OperatorDwellSummary[];
  totalIncidents: number;
  totalTrackedDwellMinutes: number;
  totalStopVisits?: number;
  totalServiceHours?: number;
  incidentsPer1kVisits?: number;
  incidentsPer100ServiceHours?: number;
}

// ─── Dwell Cascade Types ──────────────────────────────────────────────

/** Each timepoint observation in a downstream trip. */
export interface CascadeTimepointObs {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  scheduledDeparture: string;       // HH:MM
  observedDeparture: string | null; // HH:MM:SS from AVL
  deviationSeconds: number | null;  // positive = late, null = no AVL
  isLate: boolean;                  // deviation > OTP late threshold (300s)
}

/** A downstream trip affected by a dwell incident earlier on the same block. */
export interface CascadeAffectedTrip {
  tripName: string;
  tripId: string;
  routeId: string;
  routeName: string;
  terminalDepartureTime: string;
  scheduledRecoverySeconds: number;   // recovery before this trip (context only)
  observedRecoverySeconds?: number;   // actual recovery (uses AVL departure from prior trip)
  timepoints: CascadeTimepointObs[];  // every timepoint in the trip
  lateTimepointCount: number;         // count of late timepoint departures
  recoveredAtStop: string | null;     // stop where first on-time observed (chain-ender)
  otpStatus: OTPStatus;               // derived: 'late' if any late timepoints, else 'on-time'
  recoveredHere: boolean;             // derived: true if chain recovered during this trip
  lateSeconds: number;                // sum of positive deviation across late timepoints
}

/** A dwell incident annotated with its downstream cascade through the block. */
export interface DwellCascade {
  // Origin incident fields
  date: string;
  block: string;
  routeId: string;
  routeName: string;
  stopName: string;
  stopId: string;
  tripName: string;
  operatorId: string;
  observedDepartureTime: string;
  trackedDwellSeconds: number;
  severity: DwellSeverity;

  // Cascade results
  cascadedTrips: CascadeAffectedTrip[];
  blastRadius: number;
  affectedTripCount: number;
  recoveredAtTrip: string | null;
  recoveredAtStop: string | null;
  totalLateSeconds: number;
  recoveryTimeAvailableSeconds: number;
  observedRecoverySeconds?: number;
}

export interface CascadeStopImpact {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  totalTrackedDwellSeconds: number;
  totalBlastRadius: number;
  avgBlastRadius: number;
  cascadedCount: number;
  nonCascadedCount: number;
  avgTotalLateSeconds: number;
}

export interface TerminalRecoveryStats {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  absorbedCount: number;
  cascadedCount: number;
  avgScheduledRecoverySeconds: number;
  avgObservedRecoverySeconds?: number;
  avgExcessLateSeconds: number;
  sufficientRecovery: boolean;
}

export interface DailyCascadeMetrics {
  cascades: DwellCascade[];
  byStop: CascadeStopImpact[];
  byTerminal: TerminalRecoveryStats[];
  totalCascaded: number;          // incidents that produced cascade
  totalNonCascaded: number;       // incidents with no downstream impact
  avgBlastRadius: number;         // avg late-timepoint-departures per cascading incident
  totalBlastRadius: number;       // sum of all blast radii
}

// APC load sanitization — cap absurd departureLoad values from hardware malfunctions
export const DEFAULT_LOAD_CAP = 65; // just above crush load of 60

export const OTP_THRESHOLDS = {
  earlySeconds: -180,
  lateSeconds: 300,
} as const;

export function classifyOTP(deviationSeconds: number): OTPStatus {
  if (deviationSeconds < OTP_THRESHOLDS.earlySeconds) return 'early';
  if (deviationSeconds > OTP_THRESHOLDS.lateSeconds) return 'late';
  return 'on-time';
}

export interface OTPBreakdown {
  total: number;
  onTime: number;
  early: number;
  late: number;
  onTimePercent: number;
  earlyPercent: number;
  latePercent: number;
  avgDeviationSeconds: number;
}

export interface RouteMetrics {
  routeId: string;
  routeName: string;
  otp: OTPBreakdown;
  ridership: number;
  alightings: number;
  tripCount: number;
  serviceHours: number;
  avgLoad: number;
  maxLoad: number;
  avgDeviationSeconds: number;
  wheelchairTrips: number;
}

export interface HourMetrics {
  hour: number;
  otp: OTPBreakdown;
  boardings: number;
  alightings: number;
  avgLoad: number;
}

export interface StopMetrics {
  stopName: string;
  stopId: string;
  lat: number;
  lon: number;
  isTimepoint: boolean;
  otp: OTPBreakdown;
  boardings: number;
  alightings: number;
  avgLoad: number;
  routeCount: number;
  routes: string[];
  hourlyBoardings?: number[];
  hourlyAlightings?: number[];
}

export interface TripMetrics {
  tripId: string;
  tripName: string;
  block: string;
  routeId: string;
  routeName: string;
  direction: string;
  terminalDepartureTime: string;
  otp: OTPBreakdown;
  boardings: number;
  maxLoad: number;
}

export interface LoadProfileStop {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  avgBoardings: number;
  avgAlightings: number;
  avgLoad: number;
  maxLoad: number;
  isTimepoint: boolean;
}

export interface RouteLoadProfile {
  routeId: string;
  routeName: string;
  direction: string;
  tripCount: number;
  stops: LoadProfileStop[];
}

export interface DataQuality {
  totalRecords: number;
  inBetweenFiltered: number;
  missingAVL: number;
  missingAPC: number;
  detourRecords: number;
  tripperRecords: number;
  loadCapped: number;
  apcExcludedFromLoad: number;
}

export interface SystemMetrics {
  otp: OTPBreakdown;
  totalRidership: number;
  totalBoardings: number;
  totalAlightings: number;
  vehicleCount: number;
  tripCount: number;
  wheelchairTrips: number;
  avgSystemLoad: number;
  peakLoad: number;
}

export interface DailySummary {
  date: string;
  dayType: DayType;
  system: SystemMetrics;
  byRoute: RouteMetrics[];
  byHour: HourMetrics[];
  byStop: StopMetrics[];
  byTrip: TripMetrics[];
  loadProfiles: RouteLoadProfile[];
  missedTrips?: {
    totalScheduled: number;
    totalMatched: number;
    totalMissed: number;
    missedPct: number;
    notPerformedCount: number;
    lateOver15Count: number;
    byRoute: { routeId: string; count: number; earliestDep: string }[];
    trips?: {
      tripId: string;
      routeId: string;
      departure: string;
      headsign: string;
      blockId: string;
      serviceId: string;
      missType: 'not_performed' | 'late_over_15';
      lateByMinutes?: number;
    }[];
  };
  byOperatorDwell?: OperatorDwellMetrics;
  byCascade?: DailyCascadeMetrics;
  dataQuality: DataQuality;
  schemaVersion: number;
}

export const PERFORMANCE_SCHEMA_VERSION = 3;

export interface PerformanceDataSummary {
  dailySummaries: DailySummary[];
  metadata: PerformanceMetadata;
  schemaVersion: number;
}

export interface PerformanceMetadata {
  importedAt: string;
  importedBy: string;
  dateRange: { start: string; end: string };
  dayCount: number;
  totalRecords: number;
  storagePath?: string;
}
