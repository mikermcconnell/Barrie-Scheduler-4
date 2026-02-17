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
  dataQuality: DataQuality;
  schemaVersion: number;
}

export const PERFORMANCE_SCHEMA_VERSION = 1;

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
