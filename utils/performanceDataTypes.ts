// Performance Dashboard Types — STREETS Datawarehouse AVL/APC data
// Schema: 35 columns per stop-event record, ~36K records/day

// ─── Day Type ───────────────────────────────────────────────────────
export type DayType = 'weekday' | 'saturday' | 'sunday';

export function parseDayType(raw: string): DayType {
  switch (raw) {
    case 'SATURDAY': return 'saturday';
    case 'SUNDAY': return 'sunday';
    default: return 'weekday'; // DAY_OF_WEEK
  }
}

export function deriveDayTypeFromDate(dateStr: string): DayType {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

// ─── Raw Record (1:1 with STREETS row) ──────────────────────────────
export interface STREETSRecord {
  vehicleLocationTPKey: number;
  vehicleId: string;
  inBetween: boolean;
  isTripper: boolean;
  date: string;              // YYYY-MM-DD
  month: string;             // YYYY-MM
  day: string;               // DAY_OF_WEEK | SATURDAY | SUNDAY
  arrivalTime: string;       // HH:MM (scheduled)
  observedArrivalTime: string | null;  // HH:MM:SS (actual)
  stopTime: string;          // HH:MM
  observedDepartureTime: string | null; // HH:MM:SS
  wheelchairUsageCount: number;
  departureLoad: number;
  boardings: number;
  alightings: number;
  apcSource: number;
  block: string;             // e.g. "10-17"
  operatorId: string;
  tripName: string;          // e.g. "10 - 10FD - 12:40"
  stopName: string;
  routeName: string;         // STREETS name e.g. "NORTH LOOP"
  branch: string;            // e.g. "10 FULL", "8A SB Full"
  routeId: string;           // route number e.g. "10", "12A", "8A"
  routeStopIndex: number;
  stopId: string;
  direction: string;         // CW, CCW, N, S
  isDetour: boolean;
  stopLat: number;
  stopLon: number;
  timePoint: boolean;
  distance: number;
  previousStopName: string | null;
  tripId: string;            // GUID
  internalTripId: number;
  terminalDepartureTime: string; // HH:MM
}

// Required columns for schema validation
export const STREETS_REQUIRED_COLUMNS = [
  'VehicleID', 'InBetween', 'Date', 'Day', 'ArrivalTime', 'ObservedArrivalTime',
  'StopTime', 'ObservedDepartureTime', 'DepartureLoad', 'Boardings', 'Alightings',
  'Block', 'TripName', 'StopName', 'RouteName', 'RouteID', 'RouteStopIndex',
  'StopID', 'Direction', 'StopLat', 'StopLon', 'TimePoint', 'TripID',
  'TerminalDepartureTime', 'WheelchairUsageCount',
] as const;

// ─── OTP Classification ─────────────────────────────────────────────
export type OTPStatus = 'early' | 'on-time' | 'late';

// ─── Dwell Classification ───────────────────────────────────────────
export type DwellSeverity = 'moderate' | 'high';

export const DWELL_THRESHOLDS = {
  boardingAllowanceSeconds: 120, // 2 min normal boarding time
  highRawSeconds: 300,           // > 5 min raw = high severity
} as const;

/** Classify raw dwell seconds. Returns null if below threshold (normal boarding). */
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
}

export interface OperatorDwellMetrics {
  incidents: DwellIncident[];
  byOperator: OperatorDwellSummary[];
  totalIncidents: number;
  totalTrackedDwellMinutes: number;
}

// APC load sanitization — cap absurd departureLoad values from hardware malfunctions
export const DEFAULT_LOAD_CAP = 65; // just above crush load of 60

export const OTP_THRESHOLDS = {
  earlySeconds: -180,   // > 3 min early
  lateSeconds: 300,     // > 5 min late
} as const;

export function classifyOTP(deviationSeconds: number): OTPStatus {
  if (deviationSeconds < OTP_THRESHOLDS.earlySeconds) return 'early';
  if (deviationSeconds > OTP_THRESHOLDS.lateSeconds) return 'late';
  return 'on-time';
}

// ─── Segment Runtime (per-day AVL-derived runtimes) ─────────────────

export interface SegmentRuntimeObservation {
  runtimeMinutes: number;
  timeBucket: string;  // "06:30" — 30-min bucket start
}

export interface DailySegmentRuntimeEntry {
  routeId: string;
  direction: string;
  segmentName: string;  // "Park Place to Veteran's at Essa"
  observations: SegmentRuntimeObservation[];
}

export interface DailySegmentRuntimes {
  entries: DailySegmentRuntimeEntry[];
  totalObservations: number;
  tripsWithData: number;
}

// ─── Aggregated Metrics ─────────────────────────────────────────────

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
  hour: number;          // 0-23
  otp: OTPBreakdown;
  boardings: number;
  alightings: number;
  avgLoad: number;
}

export interface StopRouteBreakdown {
  routeId: string;
  boardings: number;
  alightings: number;
  hourlyBoardings?: number[];  // 24 entries (index=hour), boardings per hour on this route
  hourlyAlightings?: number[]; // 24 entries (index=hour), alightings per hour on this route
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
  routeCount: number;     // how many routes serve this stop
  routes: string[];       // which route IDs serve this stop
  hourlyBoardings?: number[];  // 24 entries (index=hour), boardings per hour
  hourlyAlightings?: number[]; // 24 entries (index=hour), alightings per hour
  routeBreakdown?: StopRouteBreakdown[];
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

// ─── Ridership Heatmap (stop × trip matrix) ─────────────────────────

export interface RidershipHeatmapTrip {
  terminalDepartureTime: string;  // "HH:MM" - stable key across days
  tripName: string;
  block: string;
  direction: string;
}

export interface RidershipHeatmapStop {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  isTimepoint: boolean;
}

export interface RouteRidershipHeatmap {
  routeId: string;
  routeName: string;
  direction: string;
  trips: RidershipHeatmapTrip[];         // columns (sorted by departure time)
  stops: RidershipHeatmapStop[];         // rows (sorted by routeStopIndex)
  cells: ([number, number] | null)[][];  // [stopIdx][tripIdx] = [boardings, alightings]
}

export interface DataQuality {
  totalRecords: number;
  inBetweenFiltered: number;
  missingAVL: number;       // null ObservedArrivalTime
  missingAPC: number;       // records with 0 APC source
  detourRecords: number;
  tripperRecords: number;
  loadCapped: number;       // records where departureLoad was capped at DEFAULT_LOAD_CAP
  apcExcludedFromLoad: number; // records with apcSource === 0 excluded from load calcs
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

// ─── Daily Summary (stored in Firebase) ─────────────────────────────

export interface DailySummary {
  date: string;              // YYYY-MM-DD
  dayType: DayType;
  system: SystemMetrics;
  byRoute: RouteMetrics[];
  byHour: HourMetrics[];
  byStop: StopMetrics[];
  byTrip: TripMetrics[];
  loadProfiles: RouteLoadProfile[];
  ridershipHeatmaps?: RouteRidershipHeatmap[];
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
  segmentRuntimes?: DailySegmentRuntimes;
  dataQuality: DataQuality;
  schemaVersion: number;
}

export const PERFORMANCE_SCHEMA_VERSION = 2;

// ─── Multi-Day Summary (for trend views) ────────────────────────────

export interface PerformanceDataSummary {
  dailySummaries: DailySummary[];
  metadata: PerformanceMetadata;
  schemaVersion: number;
}

// ─── Firebase Metadata ──────────────────────────────────────────────

export interface PerformanceMetadata {
  importedAt: string;
  importedBy: string;
  dateRange: { start: string; end: string };
  dayCount: number;
  totalRecords: number;
  storagePath?: string;
}

// ─── Import State (ephemeral, not stored) ───────────────────────────

export type PerformanceImportPhase = 'select' | 'preview' | 'processing' | 'error';

export interface ImportProgress {
  phase: string;
  current: number;
  total: number;
}

export interface ImportPreview {
  fileName: string;
  fileSize: number;
  rowCount: number;
  dateRange: { start: string; end: string };
  dayTypes: DayType[];
  routeIds: string[];
  sampleRows: STREETSRecord[];
  warnings: string[];
}

// ─── Tab Configuration ──────────────────────────────────────────────

export type PerformanceTab =
  | 'overview'
  | 'otp'
  | 'ridership'
  | 'load-profiles'
  | 'operator-dwell'
  | 'reports';
