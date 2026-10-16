/** A calendar month as `YYYY-MM`. */
export type MonthKey = string;

/** One row of the "System Monthly" sheet: raw system totals for one month. */
export interface SystemMonth {
  month: MonthKey;
  boardings: number | null;
  revenueHours: number | null;
  scheduledTrips: number | null;
  tripsOperated: number | null;
  /** Percent, 0–100. */
  onTimePct: number | null;
  fareRevenue: number | null;
  operatingCost: number | null;
  complaints: number | null;
}

/** One row of the "Routes" sheet: one route in one month. */
export interface RouteMonth {
  month: MonthKey;
  route: string;
  routeName: string;
  boardings: number | null;
  revenueHours: number | null;
  /** Percent, 0–100. */
  onTimePct: number | null;
}

/** Targets from the "Targets" sheet. Monthly unless prefixed `annual`. */
export interface Targets {
  boardings?: number;
  boardingsPerRevenueHour?: number;
  onTimePct?: number;
  serviceDeliveredPct?: number;
  fareboxRecoveryPct?: number;
  costPerBoarding?: number;
  revenueHours?: number;
  complaintsPer100k?: number;
  annualBoardings?: number;
  annualRevenueHours?: number;
  annualFareRevenue?: number;
  annualOperatingBudget?: number;
}

export type TargetKey = keyof Targets;

/** A manager-written note from the "Notes" sheet. A blank month applies to every month. */
export interface Note {
  month: MonthKey | null;
  title: string;
  detail: string;
}

export interface ReportData {
  system: SystemMonth[];
  routes: RouteMonth[];
  targets: Targets;
  notes: Note[];
  sourceFile: string;
  importedAt: string;
  isSample: boolean;
}

export interface ImportResult {
  data: ReportData | null;
  errors: string[];
  warnings: string[];
}
