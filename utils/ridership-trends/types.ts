export const RIDERSHIP_TREND_METRIC = 'fixed_route_boardings' as const;
export const RIDERSHIP_TREND_CUTOVER_DATE = '2026-08-01';
export const RIDERSHIP_TREND_BASELINE_HASH =
    'f43696aab18337c5a8a4f43db447568545c30b343e3639190f9078a2538facc2';

export type RidershipTrendMetric = typeof RIDERSHIP_TREND_METRIC;
export type RidershipTrendSource = 'workbook' | 'live' | 'mixed';
export type RidershipTrendCoverageStatus = 'complete' | 'partial' | 'missing';

export interface RidershipTrendBaselineV1 {
    schemaVersion: 1;
    metric: RidershipTrendMetric;
    source: {
        fileName: string;
        sheetName: string;
        sha256: string;
        extractedRange: string;
        finalMonth: string;
    };
    monthlyTotals: Record<string, number>;
}

export interface RidershipTrendDailyValue {
    boardings: number;
    performanceSchemaVersion: number;
}

export interface RidershipTrendProjectionV1 {
    schemaVersion: 1;
    metric: RidershipTrendMetric;
    cutoverDate: string;
    baselineHash: string;
    dailyTotals: Record<string, RidershipTrendDailyValue>;
    latestServiceDate: string | null;
    updatedAt: string;
}

export interface RidershipTrendDailyInput extends RidershipTrendDailyValue {
    date: string;
}

export interface RidershipTrendMonth {
    year: number;
    month: number;
    monthKey: string;
    total: number | null;
    source: RidershipTrendSource;
    coverageStatus: RidershipTrendCoverageStatus;
    observedDays: number | null;
    expectedDays: number | null;
    missingDates: string[];
}

export interface RidershipTrendYear {
    year: number;
    months: Array<number | null>;
    total: number | null;
    source: RidershipTrendSource;
    coverageStatus: RidershipTrendCoverageStatus;
}

export interface RidershipTrendAnnualChange {
    year: number;
    previousYear: number;
    currentTotal: number;
    previousTotal: number;
    change: number | null;
    suppressedReason: 'incomplete_coverage' | null;
}

export interface RidershipTrendYtdComparison {
    throughMonth: number;
    currentTotal: number | null;
    previousTotal: number | null;
    change: number | null;
    coverageComplete: boolean;
}

export interface RidershipTrendView {
    referenceDate: string;
    activeYear: number;
    latestServiceDate: string | null;
    monthly: RidershipTrendMonth[];
    years: RidershipTrendYear[];
    annualSeries: RidershipTrendYear[];
    annualChanges: RidershipTrendAnnualChange[];
    currentYtd: {
        total: number | null;
        coverageComplete: boolean;
    };
    completedMonthComparison: RidershipTrendYtdComparison;
    activePartialMonth: RidershipTrendMonth | null;
    liveCoverage: {
        observedDays: number;
        expectedDays: number;
        missingDates: string[];
        complete: boolean;
    };
}
