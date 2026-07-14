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
export type DwellSeverity = 'minor' | 'moderate' | 'high';

export const DWELL_THRESHOLDS = {
  lateGateSeconds: 180,          // 3 min late departure gate (matches legacy)
  boardingAllowanceSeconds: 120, // 2 min — minor/moderate boundary
  highRawSeconds: 300,           // 5 min — moderate/high boundary
} as const;

export function classifyDwell(dwellSeconds: number): DwellSeverity | null {
  if (dwellSeconds <= 0) return null;
  if (dwellSeconds > DWELL_THRESHOLDS.highRawSeconds) return 'high';
  if (dwellSeconds > DWELL_THRESHOLDS.boardingAllowanceSeconds) return 'moderate';
  return 'minor';
}

export interface DwellIncident {
  /** Deterministic key used to join the incident to its downstream story. */
  incidentId?: string;
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
  tripId?: string;
  vehicleId?: string;
  direction?: string;
  routeStopIndex?: number;
  scheduledArrivalTime?: string;
  scheduledDepartureTime?: string;
  arrivalDeviationSeconds?: number;
  departureDeviationSeconds?: number;
  boardings?: number;
  alightings?: number;
  wheelchairUsageCount?: number;
  departureLoad?: number | null;
  departureLoadReliable?: boolean;
  stopLat?: number;
  stopLon?: number;
}

export interface DwellExposureSummary {
  routeId: string;
  operatorId: string;
  eligibleTimepointVisits: number;
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
  reportableDwellSeconds?: number;
  eligibleTimepointVisits?: number;
  incidentsPer1kEligibleVisits?: number;
}

export interface OperatorDwellMetrics {
  incidents: DwellIncident[];
  byOperator: OperatorDwellSummary[];
  totalIncidents: number;
  totalTrackedDwellMinutes: number;
  totalReportableDwellMinutes?: number;
  totalStopVisits?: number;
  totalServiceHours?: number;
  incidentsPer1kVisits?: number;
  incidentsPer100ServiceHours?: number;
  eligibleTimepointVisits?: number;
  incidentsPer1kEligibleVisits?: number;
  exposureByRouteOperator?: DwellExposureSummary[];
}

export type CascadeThresholdStatus = 'returned-under' | 'stayed-under';

// ─── Dwell Cascade Types ──────────────────────────────────────────────

/** Each timepoint observation in a downstream trip. */
export interface CascadeTimepointObs {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  scheduledDeparture: string;       // HH:MM
  observedDeparture: string | null; // HH:MM:SS from AVL
  deviationSeconds: number | null;  // associated delay after subtracting pre-existing lateness
  rawDeviationSeconds?: number | null; // raw observed departure deviation vs schedule
  isLate: boolean;                  // associated delay > OTP late threshold (300s)
  boardings: number;                // APC-observed boardings at this stop
}

/** A downstream trip affected by a dwell incident earlier on the same block. */
export interface CascadeAffectedTrip {
  phase?: 'same-trip' | 'later-trip';  // incident-trip remainder vs later block carryover
  tripName: string;
  tripId: string;
  routeId: string;
  routeName: string;
  terminalDepartureTime: string;
  scheduledRecoverySeconds: number;   // recovery before this trip (context only)
  observedRecoverySeconds?: number;   // actual recovery (uses AVL departure from prior trip)
  timepoints: CascadeTimepointObs[];  // every timepoint in the trip
  lateTimepointCount: number;         // count of associated late departures (>5 min)
  affectedTimepointCount: number;     // count of timepoints with any associated delay (>0)
  backUnderThresholdAtStop?: string | null; // first stop in this trip where associated delay is <= 5 min
  backUnderThresholdAtStopId?: string | null;
  thresholdStatus?: CascadeThresholdStatus | null; // returned under after OTP-late, or stayed under throughout observed points
  recoveredAtStop: string | null;     // stop where associated delay fully reached zero
  recoveredAtStopId?: string | null;
  otpStatus: OTPStatus;               // derived from associated delay
  backUnderThresholdHere?: boolean;   // true if associated delay dropped to <= 5 min during this trip
  recoveredHere: boolean;             // true if associated delay reached zero during this trip
  lateSeconds: number;                // legacy field: sum of associated delay seconds across affected timepoints
}

/** A dwell incident annotated with its downstream cascade through the block. */
export interface DwellCascade {
  // Origin incident fields
  incidentId?: string;
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
  baselineLateSeconds?: number;      // lateness already present on arrival into the dwell stop

  // Data coverage / confidence
  incidentRecordMatched?: boolean;
  sameTripObservedTimepointCount?: number;
  sameTripMissingObservedTimepointCount?: number;
  laterTripObservedTimepointCount?: number;
  laterTripMissingObservedTimepointCount?: number;

  // Cascade results
  sameTripImpact?: CascadeAffectedTrip | null; // observed remainder of the incident trip, if available
  sameTripObserved?: boolean;                  // whether any downstream same-trip observation was available
  cascadedTrips: CascadeAffectedTrip[];
  blastRadius: number;            // total associated late departures across later trips
  affectedTripCount: number;      // number of later trips touched before associated recovery
  backUnderThresholdAtTrip?: string | null; // first trip where associated delay was <= 5 min
  backUnderThresholdAtStop?: string | null; // first stop where associated delay was <= 5 min
  backUnderThresholdAtStopId?: string | null;
  thresholdStatus?: CascadeThresholdStatus | null;
  recoveredAtTrip: string | null; // trip name where associated delay fully cleared
  recoveredAtStop: string | null; // specific stop where associated delay reached zero
  recoveredAtStopId?: string | null;
  totalLateSeconds: number;       // legacy field: sum of associated delay across later-trip timepoints
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
  avgBlastRadius: number;         // avg associated-late departures per cascading incident
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
  hour: number;
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
  alightings?: number;
  otp?: OTPBreakdown;
}

export interface SegmentRuntimeObservation {
  runtimeMinutes: number;
  timeBucket: string;
}

export type RuntimePatternKind = 'normal' | 'detour';

export interface DailyRuntimePattern {
  patternId: string;
  patternKind: RuntimePatternKind;
  routeId: string;
  direction: string;
  tripCount: number;
  stopIds: string[];
  stopNames: string[];
  routeStopIndexes: number[];
}

export interface DailySegmentRuntimeEntry {
  routeId: string;
  direction: string;
  segmentName: string;
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
  patternId?: string;
  patternKind?: RuntimePatternKind;
  fromStopId: string;
  toStopId: string;
  fromStopName: string;
  toStopName: string;
  fromRouteStopIndex: number;
  toRouteStopIndex: number;
  segmentName: string;
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
  timeBucket: string;
}

export interface DailyTripStopSegmentRuntimeEntry {
  tripId: string;
  tripName: string;
  routeId: string;
  direction: string;
  patternId?: string;
  patternKind?: RuntimePatternKind;
  terminalDepartureTime: string;
  segments: TripStopSegmentObservation[];
}

export interface DailyTripStopSegmentRuntimes {
  entries: DailyTripStopSegmentRuntimeEntry[];
  totalObservations: number;
  tripsWithData: number;
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
  routeBreakdown?: {
    routeId: string;
    boardings?: number;
    alightings?: number;
    hourlyBoardings?: number[];
    hourlyAlightings?: number[];
  }[];
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
  /** Zero-based visit number for repeated appearances of this physical stop within one trip. */
  occurrenceIndex?: number;
  avgBoardings: number;
  avgAlightings: number;
  avgLoad: number;
  /** Reliable per-trip departure-load observations included in avgLoad. */
  loadObservationCount?: number;
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

export interface RouteStopDeviationEntry {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  deviations: number[];
}

export interface RouteStopDeviationProfile {
  routeId: string;
  direction: string;
  stops: RouteStopDeviationEntry[];
}

export interface RidershipHeatmapTrip {
  terminalDepartureTime: string;
  tripName: string;
  block: string;
  direction: string;
}

export interface RidershipHeatmapStop {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  /** Zero-based visit number for repeated appearances of this physical stop within one trip. */
  occurrenceIndex?: number;
  isTimepoint: boolean;
}

export interface RouteRidershipHeatmap {
  routeId: string;
  routeName: string;
  direction: string;
  /** True when this daily route-direction summary contains more than one stop pattern. */
  multipleStopPatterns?: boolean;
  trips: RidershipHeatmapTrip[];
  stops: RidershipHeatmapStop[];
  cells: ([number, number] | null)[][];
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
  runtimePatterns?: DailyRuntimePattern[];
  routeStopDeviations?: RouteStopDeviationProfile[];
  byRouteHour?: RouteHourMetrics[];
  dataQuality: DataQuality;
  schemaVersion: number;
}

export const PERFORMANCE_SCHEMA_VERSION = 13;
export const PERFORMANCE_RUNTIME_LOGIC_VERSION = 4;

export interface PerformanceDataSummary {
  dailySummaries: DailySummary[];
  metadata: PerformanceMetadata;
  schemaVersion: number;
}

export type PerformanceDetailMode =
  | 'all'
  | 'overview'
  | 'otp'
  | 'ridership'
  | 'load-profiles'
  | 'operator-dwell';

export interface PerformanceDataLoadOptions {
  dateRange?: { start: string; end: string };
  detailMode?: PerformanceDetailMode;
}

export interface PerformanceMetadata {
  importedAt: string;
  importedBy: string;
  dateRange: { start: string; end: string };
  dayCount: number;
  totalRecords: number;
  runtimeLogicVersion?: number;
  cleanHistoryStartDate?: string;
  storageMode?: 'monolithic' | 'monthly';
  storagePath?: string;
  overviewStoragePath?: string;
  reportStoragePath?: string;
  routeStoragePaths?: Record<string, string>;
  monthlyStoragePaths?: Record<string, string>;
  routeMonthlyStoragePaths?: Record<string, Record<string, string>>;
}
