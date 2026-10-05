export const PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION = 1;
export const PARKING_LOCOMOBI_VENDOR = 'locomobi' as const;
export const PARKING_LOCOMOBI_FINANCIAL_BASIS = 'source_reported_amount' as const;

export type ParkingLocoMobiVendor = typeof PARKING_LOCOMOBI_VENDOR;
export type ParkingLocoMobiFinancialBasis = typeof PARKING_LOCOMOBI_FINANCIAL_BASIS;

export type ParkingLocoMobiPaymentChannel =
  | 'cash'
  | 'visa'
  | 'mastercard'
  | 'interac_debit'
  | 'amex'
  | 'discover'
  | 'other'
  | 'unknown';

export type ParkingLocoMobiQualityFlag =
  | 'zero_amount'
  | 'negative_amount'
  | 'missing_payment_channel';

export type ParkingLocoMobiSourceProfile =
  | 'consolidated_all'
  | 'original_raw'
  | 'revenue_details'
  | 'canonical_raw';

/**
 * Privacy-minimized activity row. Source transaction, receipt, ticket, permit,
 * account, card, username, and licence-plate identifiers are intentionally not
 * represented in this contract.
 */
export interface ParkingLocoMobiHistoryRow {
  vendor: ParkingLocoMobiVendor;
  financialBasis: ParkingLocoMobiFinancialBasis;
  domain: string;
  meterId: string;
  locationLabel: string;
  activityDate: string;
  activityMonth: string;
  activityMinutes: number;
  weekday: number;
  isWeekend: boolean;
  reportedAmount: number;
  paymentChannel: ParkingLocoMobiPaymentChannel;
  paymentChannelLabel: string;
  qualityFlags: ParkingLocoMobiQualityFlag[];
}

export interface ParkingLocoMobiWorkbookInput {
  buffer: ArrayBuffer | Uint8Array;
  fileName: string;
}

export interface ParkingLocoMobiSourceTable {
  fileName: string;
  sheetName: string;
  profile: ParkingLocoMobiSourceProfile;
  headerRowNumber: number;
  sourceColumnCount: number;
  sourceRowCount: number;
  acceptedRowCount: number;
  duplicateRowCount: number;
  skippedRowCount: number;
}

export interface ParkingLocoMobiCoverage {
  observedStartDate: string;
  observedEndDate: string;
  observedMonths: string[];
  observedYears: number[];
  activeDateCount: number;
}

export interface ParkingLocoMobiReconciliation {
  sourceRowCount: number;
  acceptedRowCount: number;
  duplicateRowCount: number;
  skippedRowCount: number;
  zeroAmountRowCount: number;
  negativeAmountRowCount: number;
  missingPaymentChannelRowCount: number;
  uniqueMeterCount: number;
  uniqueMeterLocationCount: number;
  totalReportedAmount: number;
}

export interface ParkingLocoMobiParseResult {
  schemaVersion: typeof PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION;
  vendor: ParkingLocoMobiVendor;
  financialBasis: ParkingLocoMobiFinancialBasis;
  rows: ParkingLocoMobiHistoryRow[];
  sourceTables: ParkingLocoMobiSourceTable[];
  ignoredSheets: Array<{ fileName: string; sheetName: string; reason: string }>;
  coverage: ParkingLocoMobiCoverage;
  reconciliation: ParkingLocoMobiReconciliation;
  warnings: string[];
}

export interface ParkingLocoMobiAggregateValues {
  rowCount: number;
  totalReportedAmount: number;
  zeroAmountRowCount: number;
  negativeAmountRowCount: number;
}

export interface ParkingLocoMobiMonthlyAggregate extends ParkingLocoMobiAggregateValues {
  month: string;
  activeDateCount: number;
  activeMeterCount: number;
  activeLocationCount: number;
}

export interface ParkingLocoMobiLocationAggregate extends ParkingLocoMobiAggregateValues {
  key: string;
  meterId: string;
  locationLabel: string;
  domain: string;
  observedStartDate: string;
  observedEndDate: string;
  paymentChannels: ParkingLocoMobiPaymentChannel[];
}

export interface ParkingLocoMobiHourlyAggregate extends ParkingLocoMobiAggregateValues {
  hour: number;
}

/** Compact cross-filter index; never contains transaction-level identifiers. */
export interface ParkingLocoMobiLocationMonthAggregate extends ParkingLocoMobiAggregateValues {
  month: string;
  domain: string;
  meterId: string;
  locationLabel: string;
  hourlyCounts: number[];
}

export interface ParkingLocoMobiWeekdayAggregate extends ParkingLocoMobiAggregateValues {
  weekday: number;
  label: string;
}

export interface ParkingLocoMobiPaymentAggregate extends ParkingLocoMobiAggregateValues {
  paymentChannel: ParkingLocoMobiPaymentChannel;
  label: string;
}

export interface ParkingLocoMobiDomainAggregate extends ParkingLocoMobiAggregateValues {
  domain: string;
  activeMeterCount: number;
  activeLocationCount: number;
}

/** Aggregate-only shape intended for shared storage and strategic reporting. */
export interface ParkingLocoMobiHistorySnapshot {
  schemaVersion: typeof PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION;
  vendor: ParkingLocoMobiVendor;
  financialBasis: ParkingLocoMobiFinancialBasis;
  coverage: ParkingLocoMobiCoverage;
  reconciliation: ParkingLocoMobiReconciliation;
  sourceTables: ParkingLocoMobiSourceTable[];
  ignoredSheets: ParkingLocoMobiParseResult['ignoredSheets'];
  warnings: string[];
  monthly: ParkingLocoMobiMonthlyAggregate[];
  locations: ParkingLocoMobiLocationAggregate[];
  hourly: ParkingLocoMobiHourlyAggregate[];
  weekdays: ParkingLocoMobiWeekdayAggregate[];
  paymentChannels: ParkingLocoMobiPaymentAggregate[];
  domains: ParkingLocoMobiDomainAggregate[];
  /** Missing on older archives: re-import to enable period/location cross-filtering. */
  locationMonths?: ParkingLocoMobiLocationMonthAggregate[];
}
