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

export interface TodPickupMetadata {
  importedAt: string;
  importedBy: string;
  monthCount: number;
  totalRows: number;
  totalPickups: number;
  storagePath?: string;
}

export interface TodPickupSummary {
  months: TodPickupMonthlyDataset[];
  metadata: TodPickupMetadata;
  schemaVersion: number;
}

export interface TodPickupParseResult {
  dataset: TodPickupMonthlyDataset;
  warnings: string[];
}

export const TOD_PICKUP_SCHEMA_VERSION = 1;
