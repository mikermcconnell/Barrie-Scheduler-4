export interface TodPickupStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pickups: number;
}

export interface TodPickupMonthlyDataset {
  month: string; // YYYY-MM
  importedAt: string;
  importedBy: string;
  sourceFileName: string;
  rowCount: number;
  mappableRows: number;
  skippedRows: number;
  totalPickups: number;
  stops: TodPickupStop[];
}

export interface TodDailyKpiLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pickups: number;
  dropoffs: number;
}

export interface TodDailyKpiDataset {
  date: string; // YYYY-MM-DD service date selected during import
  importedAt: string;
  importedBy: string;
  sourceFileName: string;
  rawStoragePath?: string;
  rowCount: number;
  totalCompletedTrips: number;
  totalDropoffs: number;
  locations: TodDailyKpiLocation[];
}

export interface TodPickupMetadata {
  importedAt: string;
  importedBy: string;
  monthCount: number;
  totalRows: number;
  totalPickups: number;
  dailyReportCount?: number;
  dailyDateRange?: { start: string; end: string };
  totalCompletedTrips?: number;
  storagePath?: string;
}

export interface TodPickupSummary {
  months: TodPickupMonthlyDataset[];
  dailyReports?: TodDailyKpiDataset[];
  metadata: TodPickupMetadata;
  schemaVersion: number;
}

export interface TodDailyKpiParseResult {
  dataset: TodDailyKpiDataset;
  warnings: string[];
}

export const TOD_PICKUP_SCHEMA_VERSION = 2;
