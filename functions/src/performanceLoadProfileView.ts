import type {
  DailySummary,
  LoadProfileDailyView,
  LoadProfileMonthlyView,
  LoadProfilePeakTrip,
  OTPBreakdown,
  PerformanceDataSummary,
  PerformanceMetadata,
  SystemMetrics,
  TripMetrics,
} from './types';
import { LOAD_PROFILE_VIEW_SCHEMA_VERSION } from './types';

const EMPTY_OTP: OTPBreakdown = {
  total: 0,
  onTime: 0,
  early: 0,
  late: 0,
  onTimePercent: 0,
  earlyPercent: 0,
  latePercent: 0,
  avgDeviationSeconds: 0,
};

const EMPTY_SYSTEM: SystemMetrics = {
  otp: EMPTY_OTP,
  totalRidership: 0,
  totalBoardings: 0,
  totalAlightings: 0,
  vehicleCount: 0,
  tripCount: 0,
  wheelchairTrips: 0,
  avgSystemLoad: 0,
  peakLoad: 0,
};

function toPeakTrip(trip: TripMetrics): LoadProfilePeakTrip {
  return {
    routeId: trip.routeId,
    routeName: trip.routeName,
    direction: trip.direction,
    block: trip.block,
    terminalDepartureTime: trip.terminalDepartureTime,
    tripName: trip.tripName,
    maxLoad: trip.maxLoad,
  };
}

/**
 * Keep enough candidates to calculate the top five for any later date, route,
 * and direction filter without retaining the full by-trip metrics payload.
 */
export function buildLoadProfilePeakTrips(trips: TripMetrics[]): LoadProfilePeakTrip[] {
  return trips
    .filter(trip => Number.isFinite(trip.maxLoad) && trip.maxLoad > 0)
    .map(toPeakTrip);
}

export function buildLoadProfileViewDay(day: PerformanceDataSummary['dailySummaries'][number]): LoadProfileDailyView {
  return {
    date: day.date,
    dayType: day.dayType,
    loadProfiles: day.loadProfiles,
    loadProfilePeakTrips: buildLoadProfilePeakTrips(day.byTrip || []),
    dataQuality: day.dataQuality,
    schemaVersion: day.schemaVersion,
  };
}

export function buildLoadProfileMonthlyView(
  summary: PerformanceDataSummary,
): LoadProfileMonthlyView {
  const dailySummaries = summary.dailySummaries.map(buildLoadProfileViewDay);
  const month = dailySummaries[0]?.date.slice(0, 7) || '';
  return {
    dailySummaries,
    metadata: summary.metadata,
    schemaVersion: summary.schemaVersion,
    viewSchemaVersion: LOAD_PROFILE_VIEW_SCHEMA_VERSION,
    month,
  };
}

export function isLoadProfileMonthlyView(value: unknown): value is LoadProfileMonthlyView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<LoadProfileMonthlyView>;
  return candidate.viewSchemaVersion === LOAD_PROFILE_VIEW_SCHEMA_VERSION
    && typeof candidate.month === 'string'
    && Array.isArray(candidate.dailySummaries)
    && !!candidate.metadata
    && typeof candidate.schemaVersion === 'number';
}

export function hydrateLoadProfileMonthlyViews(
  views: LoadProfileMonthlyView[],
  metadata: PerformanceMetadata,
): PerformanceDataSummary {
  const compactDays = views
    .flatMap(view => view.dailySummaries)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailySummaries: DailySummary[] = compactDays.map((day): DailySummary => ({
    date: day.date,
    dayType: day.dayType,
    system: { ...EMPTY_SYSTEM, otp: { ...EMPTY_OTP } },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfilePeakTrips: day.loadProfilePeakTrips,
    loadProfiles: day.loadProfiles,
    dataQuality: day.dataQuality,
    schemaVersion: day.schemaVersion,
  }));
  const dates = dailySummaries.map(day => day.date);

  return {
    dailySummaries,
    metadata: {
      ...metadata,
      dateRange: dates.length > 0
        ? { start: dates[0], end: dates[dates.length - 1] }
        : metadata.dateRange,
      dayCount: dailySummaries.length,
      totalRecords: dailySummaries.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0),
    },
    schemaVersion: views.reduce((latest, view) => Math.max(latest, view.schemaVersion), 0),
  };
}
