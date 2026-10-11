export const SPECIALIZED_TRANSIT_SCHEMA_VERSION = 1 as const;

export type SpecializedTransitReconciliationStatus =
  | 'reconciled'
  | 'partial-common-location'
  | 'inconsistent';

export type SpecializedTransitLocationStatus = 'unmapped' | 'automatic' | 'reviewed';
export type SpecializedTransitCoordinateSource =
  | 'gtfs-stop'
  | 'known-place'
  | 'mapbox'
  | 'mapbox-permanent'
  | 'manual'
  | null;

export interface SpecializedTransitSourceFile {
  sha256: string;
  pageCount: number;
}

export interface SpecializedTransitActivityBucket {
  date: string;
  hour: number;
  locationId: string;
  pickups: number;
  dropoffs: number;
}

export interface SpecializedTransitLocationV1 {
  id: string;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  latitude: number | null;
  longitude: number | null;
  status: SpecializedTransitLocationStatus;
  coordinateSource: SpecializedTransitCoordinateSource;
  relevance: number | null;
}

export interface SpecializedTransitMonthV1 {
  reportMonth: string;
  reportedTrips: number;
  priorYearPercent: number | null;
  commonLocationBookings: number;
  commonLocationCoverage: number;
  reconciliationGap: number;
  reconciliationStatus: SpecializedTransitReconciliationStatus;
  reconciliationNote: string;
  serviceDateRange: { start: string; end: string };
  dailyTotals: Record<string, number>;
  hourlyTotals: Record<string, number>;
  activityBuckets: SpecializedTransitActivityBucket[];
  recurringDemand: {
    distinctClientIds: number;
    medianBookingsPerClient: number;
    thresholds: Array<{ minimumBookings: number; clientCount: number; bookingCount: number; bookingShare: number }>;
  };
  sources: {
    monthlyReport: SpecializedTransitSourceFile;
    commonLocationsReport: SpecializedTransitSourceFile;
  };
  importedAt: string;
  importedBy: string;
}

export interface SpecializedTransitDatasetV1 {
  schemaVersion: typeof SPECIALIZED_TRANSIT_SCHEMA_VERSION;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  months: Record<string, SpecializedTransitMonthV1>;
  locations: Record<string, SpecializedTransitLocationV1>;
}

export interface SpecializedTransitMetadata {
  schemaVersion: typeof SPECIALIZED_TRANSIT_SCHEMA_VERSION;
  activeRevision: number;
  storagePath: string;
  availableMonths: string[];
  latestMonth: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface SpecializedTransitParsedCommonLocations {
  reportMonth: string;
  serviceDateRange: { start: string; end: string };
  commonLocationBookings: number;
  dailyTotals: Record<string, number>;
  hourlyTotals: Record<string, number>;
  activityBuckets: SpecializedTransitActivityBucket[];
  locations: Record<string, SpecializedTransitLocationV1>;
  recurringDemand: SpecializedTransitMonthV1['recurringDemand'];
}
