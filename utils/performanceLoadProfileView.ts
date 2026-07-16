import {
  LOAD_PROFILE_VIEW_SCHEMA_VERSION,
  type DailySummary,
  type LoadProfileDailyView,
  type LoadProfileMonthlyView,
  type LoadProfilePeakTrip,
  type OTPBreakdown,
  type PerformanceDataSummary,
  type PerformanceMetadata,
  type SystemMetrics,
} from './performanceDataTypes';

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

function getMonth(date: string): string {
  return date.slice(0, 7);
}

function buildViewMetadata(
  source: PerformanceMetadata,
  days: LoadProfileDailyView[],
): PerformanceMetadata {
  const dates = days.map(day => day.date).sort();
  return {
    importedAt: source.importedAt,
    importedBy: source.importedBy,
    dateRange: dates.length > 0
      ? { start: dates[0], end: dates[dates.length - 1] }
      : source.dateRange,
    dayCount: days.length,
    totalRecords: days.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0),
    runtimeLogicVersion: source.runtimeLogicVersion,
    cleanHistoryStartDate: source.cleanHistoryStartDate,
  };
}

/** Keep only fields needed to rank peak-load trips in the Load Profiles UI. */
export function buildLoadProfilePeakTrips(day: DailySummary): LoadProfilePeakTrip[] {
  return day.byTrip
    .filter(trip => Number.isFinite(trip.maxLoad) && trip.maxLoad > 0)
    .map(trip => ({
      routeId: trip.routeId,
      routeName: trip.routeName,
      direction: trip.direction,
      block: trip.block,
      terminalDepartureTime: trip.terminalDepartureTime,
      tripName: trip.tripName,
      maxLoad: trip.maxLoad,
    }));
}

/** Project a full performance day into the compact Load Profiles read model. */
export function projectLoadProfileDay(day: DailySummary): LoadProfileDailyView {
  return {
    date: day.date,
    dayType: day.dayType,
    loadProfiles: day.loadProfiles.map(profile => ({
      ...profile,
      stops: profile.stops.map(stop => ({ ...stop })),
    })),
    loadProfilePeakTrips: buildLoadProfilePeakTrips(day),
    dataQuality: { ...day.dataQuality },
    schemaVersion: day.schemaVersion,
  };
}

/** Build one independently downloadable, versioned Load Profiles view per month. */
export function buildMonthlyLoadProfileViews(
  summary: PerformanceDataSummary,
): Map<string, LoadProfileMonthlyView> {
  const daysByMonth = new Map<string, LoadProfileDailyView[]>();
  for (const day of summary.dailySummaries) {
    const projected = projectLoadProfileDay(day);
    const month = getMonth(projected.date);
    daysByMonth.set(month, [...(daysByMonth.get(month) ?? []), projected]);
  }

  const result = new Map<string, LoadProfileMonthlyView>();
  for (const [month, unsortedDays] of daysByMonth) {
    const dailySummaries = [...unsortedDays].sort((a, b) => a.date.localeCompare(b.date));
    result.set(month, {
      viewSchemaVersion: LOAD_PROFILE_VIEW_SCHEMA_VERSION,
      month,
      dailySummaries,
      metadata: buildViewMetadata(summary.metadata, dailySummaries),
      schemaVersion: summary.schemaVersion,
    });
  }
  return result;
}

export function isLoadProfileMonthlyView(value: unknown): value is LoadProfileMonthlyView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LoadProfileMonthlyView>;
  return candidate.viewSchemaVersion === LOAD_PROFILE_VIEW_SCHEMA_VERSION
    && typeof candidate.month === 'string'
    && Array.isArray(candidate.dailySummaries)
    && !!candidate.metadata
    && typeof candidate.schemaVersion === 'number';
}

/** Convert compact monthly views back to the established dashboard summary contract. */
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
    loadProfilePeakTrips: day.loadProfilePeakTrips.map(trip => ({ ...trip })),
    loadProfiles: day.loadProfiles.map(profile => ({
      ...profile,
      stops: profile.stops.map(stop => ({ ...stop })),
    })),
    dataQuality: { ...day.dataQuality },
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
      totalRecords: dailySummaries.reduce(
        (sum, day) => sum + day.dataQuality.totalRecords,
        0,
      ),
    },
    schemaVersion: views.reduce(
      (latest, view) => Math.max(latest, view.schemaVersion),
      0,
    ),
  };
}
