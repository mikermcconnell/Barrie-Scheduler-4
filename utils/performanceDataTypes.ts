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
export type DwellSeverity = 'minor' | 'moderate' | 'high';

export const DWELL_THRESHOLDS = {
  lateGateSeconds: 180,          // 3 min late departure gate (matches legacy)
  boardingAllowanceSeconds: 120, // 2 min — minor/moderate boundary
  highRawSeconds: 300,           // 5 min — moderate/high boundary
} as const;

/** Classify effective dwell seconds. Returns null if <= 0. */
export function classifyDwell(dwellSeconds: number): DwellSeverity | null {
  if (dwellSeconds <= 0) return null;
  if (dwellSeconds > DWELL_THRESHOLDS.highRawSeconds) return 'high';
  if (dwellSeconds > DWELL_THRESHOLDS.boardingAllowanceSeconds) return 'moderate';
  return 'minor';
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
  deviationSeconds: number | null;  // attributed delay after subtracting pre-existing lateness
  rawDeviationSeconds?: number | null; // raw observed departure deviation vs schedule
  isLate: boolean;                  // attributed delay > OTP late threshold (300s)
  boardings: number;                // APC-observed boardings at this stop
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
  lateTimepointCount: number;         // count of attributed late departures (>5 min)
  affectedTimepointCount: number;     // count of timepoints with any attributable delay (>0)
  backUnderThresholdAtStop?: string | null; // first stop in this trip where attributed delay is <= 5 min
  recoveredAtStop: string | null;     // stop where attributed delay fully reached zero
  otpStatus: OTPStatus;               // derived from attributed delay
  backUnderThresholdHere?: boolean;   // true if attributed delay dropped to <= 5 min during this trip
  recoveredHere: boolean;             // true if attributed delay reached zero during this trip
  lateSeconds: number;                // legacy field: sum of attributed delay seconds across affected timepoints
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
  blastRadius: number;            // total attributed late departures across all trips
  affectedTripCount: number;      // number of trips touched before attributed recovery
  backUnderThresholdAtTrip?: string | null; // trip where attributed delay first dropped to <= 5 min
  backUnderThresholdAtStop?: string | null; // stop where attributed delay first dropped to <= 5 min
  recoveredAtTrip: string | null; // trip name where chain ended
  recoveredAtStop: string | null; // specific stop where attributed delay reached zero
  totalLateSeconds: number;       // legacy field: sum of attributed delay across all affected timepoints
  recoveryTimeAvailableSeconds: number; // scheduled recovery between incident trip and next trip
  observedRecoverySeconds?: number;     // actual recovery (AVL-based, less if bus ran late)
}

export interface CascadeStopImpact {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  totalTrackedDwellSeconds: number;
  totalBlastRadius: number;
  avgBlastRadius: number;
  cascadedCount: number;        // incidents that produced any cascade
  nonCascadedCount: number;     // incidents with no downstream late timepoints
  avgTotalLateSeconds: number;  // avg totalLateSeconds per cascading incident
}

/** Per-terminal recovery sufficiency analysis. */
export interface TerminalRecoveryStats {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  absorbedCount: number;
  cascadedCount: number;
  avgScheduledRecoverySeconds: number;
  avgObservedRecoverySeconds?: number;        // actual recovery (AVL-based)
  avgExcessLateSeconds: number;
  sufficientRecovery: boolean;                // true if ≥75% of incidents absorbed
}

export interface DailyCascadeMetrics {
  cascades: DwellCascade[];
  byStop: CascadeStopImpact[];
  byTerminal: TerminalRecoveryStats[];
  totalCascaded: number;          // incidents that produced cascade
  totalNonCascaded: number;       // incidents with no downstream impact
  avgBlastRadius: number;         // avg attributed-late departures per cascading incident
  totalBlastRadius: number;       // sum of all blast radii
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

export interface DailyStopSegmentRuntimeEntry {
  routeId: string;
  direction: string;
  fromStopId: string;
  toStopId: string;
  fromStopName: string;
  toStopName: string;
  fromRouteStopIndex: number;
  toRouteStopIndex: number;
  segmentName: string;  // display label: "{fromStopName} to {toStopName}"
  observations: SegmentRuntimeObservation[];
}

export interface DailyStopSegmentRuntimes {
  entries: DailyStopSegmentRuntimeEntry[];
  totalObservations: number;
  tripsWithData: number;
}

export interface TripStopSegmentObservation {
  fromStopId: string;
  toStopId: string;
  fromRouteStopIndex: number;
  toRouteStopIndex: number;
  runtimeMinutes: number;
  timeBucket: string;  // scheduled bucket start for the from-stop departure
}

export interface DailyTripStopSegmentRuntimeEntry {
  tripId: string;
  tripName: string;
  routeId: string;
  direction: string;
  terminalDepartureTime: string;
  segments: TripStopSegmentObservation[];
}

export interface DailyTripStopSegmentRuntimes {
  entries: DailyTripStopSegmentRuntimeEntry[];
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
  apcDiscrepancyCount?: number;
  apcDiscrepancyPct?: number;
  apcStatus?: 'ok' | 'review' | 'suspect';
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

export interface RouteHourMetrics {
  routeId: string;
  hour: number;        // 0-23
  avgLoad: number;
  boardings: number;
  otp?: OTPBreakdown;
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

// ─── Route Stop Deviation Profile (per-route schedule adherence) ────

export interface RouteStopDeviationEntry {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  deviations: number[];  // raw deviation seconds per OTP-eligible observation
}

export interface RouteStopDeviationProfile {
  routeId: string;
  direction: string;
  stops: RouteStopDeviationEntry[];  // ordered by routeStopIndex
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
  byCascade?: DailyCascadeMetrics;
  segmentRuntimes?: DailySegmentRuntimes;
  stopSegmentRuntimes?: DailyStopSegmentRuntimes;
  tripStopSegmentRuntimes?: DailyTripStopSegmentRuntimes;
  routeStopDeviations?: RouteStopDeviationProfile[];
  byRouteHour?: RouteHourMetrics[];
  dataQuality: DataQuality;
  schemaVersion: number;
}

export const PERFORMANCE_SCHEMA_VERSION = 7;

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
