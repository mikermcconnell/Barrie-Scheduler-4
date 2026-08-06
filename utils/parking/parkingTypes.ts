export const PARKING_SCHEMA_VERSION = 1;
export const PARKING_REVENUE_SCHEMA_VERSION = 2;

export type ParkingYearCodeFormat = 'yyyy' | 'yy';
export type ParkingDepartmentLegendSortKey = 'color' | 'code' | 'department' | 'ignoreData' | 'ignoreFlags';
export type ParkingSortDirection = 'asc' | 'desc';
export type ParkingRevenueSource = 'hotspot' | 'qr';
export type ParkingRevenueCategoryFilter = 'all' | 'uncategorized' | string;
export type ParkingRevenueLocationKind = 'physical' | 'non_spatial';
export type ParkingRevenueMapStatus = 'mapped' | 'unmapped' | 'not_applicable';

export interface ParkingRevenueLocationCategory {
  id: string;
  label: string;
  colorHex?: string;
  archived?: boolean;
}

export interface ParkingRevenueLocationRef {
  source: ParkingRevenueSource;
  sourceId: string;
  label?: string;
}

export interface ParkingRevenueLocationMapping {
  id: string;
  displayName: string;
  locationKind?: ParkingRevenueLocationKind;
  latitude: number | null;
  longitude: number | null;
  capacitySpaces?: number | null;
  categoryId?: string | null;
  sourceRefs: ParkingRevenueLocationRef[];
}

export interface ParkingDepartmentLegendSortSetting {
  key: ParkingDepartmentLegendSortKey;
  direction: ParkingSortDirection;
}

export type ParkingFlagCode =
  | 'missing_plate'
  | 'high_frequency'
  | 'high_value'
  | 'long_duration'
  | 'same_location'
  | 'consecutive_weekdays'
  | 'unusual_timing'
  | 'multiple_daily_sessions';

export interface ParkingCodeFamilyMapping {
  familyKey: string;
  department: string;
  codes: string[];
  activeYears?: number[];
  yearCodeFormat?: ParkingYearCodeFormat;
  codeOverrides?: Record<string, string[]>;
  colorHex?: string;
  archived?: boolean;
  ignoreData?: boolean;
  ignoreFlags?: boolean;
  description?: string;
}

export interface ParkingSpotLocationMapping {
  spotId: string;
  locationName: string;
  concernArea?: boolean;
}

export interface ParkingFlagRuleSettings {
  plateMonthlyValueDollars: number;
  plateActiveDaysPerMonth: number;
  longSessionHours: number;
  longSessionCount: number;
  sameLocationDays: number;
  consecutiveWeekdays: number;
  workdayStartHour: number;
  workdayEndHour: number;
  multipleDailySessions: number;
  departmentMonthlyValueDollars: number;
  departmentIncreasePercent: number;
}

export interface ParkingSettings {
  codeFamilies: ParkingCodeFamilyMapping[];
  spotLocations: ParkingSpotLocationMapping[];
  revenueLocations?: ParkingRevenueLocationMapping[];
  revenueLocationCategories?: ParkingRevenueLocationCategory[];
  flagRules: ParkingFlagRuleSettings;
  departmentLegendSort?: ParkingDepartmentLegendSortSetting;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ParkingRawRow {
  id: string;
  plate: string;
  hasMissingPlate: boolean;
  startRaw: string;
  startDate: string;
  startMonth: string;
  startMinutes: number;
  endMinutes: number;
  weekday: number;
  isWeekend: boolean;
  spotId: string;
  locationName: string;
  durationMinutes: number;
  tapType: string;
  discountCode: string;
  codeFamilyKey: string;
  department: string;
  description: string;
  discountAmount: number;
}

export interface ParkingDepartmentMonthlySummary {
  month: string;
  department: string;
  codeFamilyKey: string;
  totalValue: number;
  sessionCount: number;
  uniquePlateCount: number;
  previousValue: number | null;
  changeValue: number | null;
  changePercent: number | null;
  isHighUsage: boolean;
}

export interface ParkingPlatePattern {
  month: string;
  plate: string;
  displayPlate: string;
  department: string;
  totalValue: number;
  sessionCount: number;
  activeDays: number;
  longSessionCount: number;
  topSpotId: string;
  topLocationName: string;
  topLocationDays: number;
  maxConsecutiveWeekdays: number;
  unusualTimingCount: number;
  multipleDailySessionDays: number;
  flags: ParkingFlagCode[];
}

export interface ParkingMonthlyDataset {
  month: string;
  importedAt: string;
  importedBy: string;
  sourceFileName: string;
  rowCount: number;
  skippedRows: number;
  totalValue: number;
  rows: ParkingRawRow[];
  departmentSummaries: ParkingDepartmentMonthlySummary[];
  platePatterns: ParkingPlatePattern[];
}

export interface ParkingSummaryMetadata {
  importedAt: string;
  importedBy: string;
  monthCount: number;
  totalRows: number;
  totalValue: number;
  storagePath?: string;
}

export interface ParkingSummary {
  schemaVersion: number;
  months: ParkingMonthlyDataset[];
  departmentSummaries: ParkingDepartmentMonthlySummary[];
  platePatterns: ParkingPlatePattern[];
  metadata: ParkingSummaryMetadata;
}

export interface ParkingUnmappedCodeFamily {
  familyKey: string;
  codes: string[];
  descriptions: string[];
  rowCount: number;
}

export interface ParkingParseResult {
  dataset: ParkingMonthlyDataset;
  warnings: string[];
  unmappedCodeFamilies: ParkingUnmappedCodeFamily[];
}

export interface ParkingRevenueRawRow {
  id: string;
  source: ParkingRevenueSource;
  sourceId: string;
  sourceLabel: string;
  physicalLocationId: string | null;
  physicalLocationName: string;
  plate: string;
  hasMissingPlate: boolean;
  startRaw: string;
  startDate: string;
  startMonth: string;
  startMinutes: number;
  endMinutes: number;
  weekday: number;
  isWeekend: boolean;
  durationMinutes: number;
  amount: number;
  tax: number;
  /** Canonical revenue value used by analytics. Derived as Amount + Tax. */
  taxInclusiveAmount?: number;
  total: number;
  paymentType: string;
}

export interface ParkingRevenueDataset {
  month: string;
  source: ParkingRevenueSource;
  importedAt: string;
  importedBy: string;
  sourceFileName: string;
  rowCount: number;
  skippedRows: number;
  totalRevenue: number;
  totalTax: number;
  totalPaid: number;
  rows: ParkingRevenueRawRow[];
}

export interface ParkingRevenueSummaryMetadata {
  importedAt: string;
  importedBy: string;
  datasetCount: number;
  monthCount: number;
  totalRows: number;
  totalRevenue: number;
  storagePath?: string;
}

export interface ParkingRevenueSummary {
  schemaVersion: number;
  datasets: ParkingRevenueDataset[];
  metadata: ParkingRevenueSummaryMetadata;
}

export interface ParkingRevenueParseResult {
  dataset: ParkingRevenueDataset;
  warnings: string[];
}

export interface ParkingRevenueFilters {
  months?: string[];
  source?: ParkingRevenueSource | 'all';
  importedBy?: string | 'all';
  dayType?: 'all' | 'weekday' | 'weekend' | 'saturday' | 'sunday';
  categoryId?: ParkingRevenueCategoryFilter;
  hourStart?: number;
  hourEnd?: number;
}

export interface ParkingRevenueLocationSummary {
  key: string;
  displayName: string;
  locationKind: ParkingRevenueLocationKind;
  mapStatus: ParkingRevenueMapStatus;
  sourceIds: ParkingRevenueLocationRef[];
  latitude: number | null;
  longitude: number | null;
  categoryId?: string | null;
  categoryLabel?: string;
  categoryColorHex?: string;
  isMapped: boolean;
  rowCount: number;
  totalRevenue: number;
  totalPaid: number;
  paidMinutes?: number;
  averageStayMinutes: number;
  uniquePlateCount: number;
  hotspotRevenue: number;
  qrRevenue: number;
  peakHour: number | null;
  peakDay: string;
}

export interface ParkingRevenueTrendPoint {
  key: string;
  label: string;
  rowCount: number;
  totalRevenue: number;
  averageStayMinutes: number;
}

export interface ParkingRevenueAnalytics {
  rows: ParkingRevenueRawRow[];
  locationSummaries: ParkingRevenueLocationSummary[];
  mappedLocationSummaries: ParkingRevenueLocationSummary[];
  unmappedLocationSummaries: ParkingRevenueLocationSummary[];
  nonSpatialLocationSummaries: ParkingRevenueLocationSummary[];
  totalRevenue: number;
  totalPaid: number;
  rowCount: number;
  paidMinutes?: number;
  activeDayCount?: number;
  hourWindowMinutes?: number;
  averageStayMinutes: number;
  uniquePlateCount: number;
  peakHour: number | null;
  peakDay: string;
  revenueByDay: ParkingRevenueTrendPoint[];
  revenueByHour: ParkingRevenueTrendPoint[];
  revenueByMonth: ParkingRevenueTrendPoint[];
}

export const DEFAULT_PARKING_FLAG_RULES: ParkingFlagRuleSettings = {
  plateMonthlyValueDollars: 50,
  plateActiveDaysPerMonth: 6,
  longSessionHours: 6,
  longSessionCount: 2,
  sameLocationDays: 5,
  consecutiveWeekdays: 3,
  workdayStartHour: 7,
  workdayEndHour: 18,
  multipleDailySessions: 2,
  departmentMonthlyValueDollars: 250,
  departmentIncreasePercent: 50,
};

export const DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES: ParkingRevenueLocationCategory[] = [
  { id: 'downtown', label: 'Downtown', colorHex: '#2563EB' },
  { id: 'waterfront', label: 'Waterfront', colorHex: '#059669' },
  { id: 'hybrid', label: 'Hybrid', colorHex: '#7C3AED' },
  { id: 'marina', label: 'Marina', colorHex: '#0EA5E9' },
  { id: 'hospital', label: 'Hospital', colorHex: '#EA580C' },
  { id: 'allandale-go', label: 'Allandale GO', colorHex: '#475569' },
  { id: 'special-events', label: 'Special Events', colorHex: '#B45309' },
];

export const DEFAULT_PARKING_SETTINGS: ParkingSettings = {
  codeFamilies: [
    { familyKey: 'AB', codes: ['AB2025'], department: 'Access Barrie' },
    { familyKey: 'BFES', codes: ['BFES25'], department: 'Barrie Fire and Emergency Services' },
    { familyKey: 'BS', codes: ['BS2025', 'BS2026'], department: 'Building Services' },
    { familyKey: 'CA', codes: ['CA2025'], department: 'Corporate Asset Management' },
    { familyKey: 'CBC', codes: ['CBC26'], department: 'Carefree Boat Club' },
    { familyKey: 'CF', codes: ['CF2025', 'CF2026'], department: 'Corporate Facilities' },
    { familyKey: 'CUPE', codes: ['CUPE25'], department: 'CUPE' },
    { familyKey: 'DS', codes: ['DS2025'], department: 'Development Services' },
    { familyKey: 'ECD', codes: ['ECD25', 'EC2025'], department: 'Economic and Creative Development' },
    { familyKey: 'IF', codes: ['IF2025', 'IF2026'], department: 'Infrastructure' },
    { familyKey: 'IGM', codes: ['IGM25'], department: 'IGM Office' },
    { familyKey: 'IT', codes: ['IT2025', 'IT2026'], department: 'Information Technology' },
    { familyKey: 'LC', codes: ['LC25'], department: 'Legislative and Court Services' },
    { familyKey: 'OP', codes: ['OP2025'], department: 'Operations' },
    { familyKey: 'P1', codes: ['P12026'], department: 'City Staff Underground Parking', colorHex: '#6B7280', ignoreData: true },
    { familyKey: 'RS', codes: ['RS2025', 'RS2026'], department: 'Recreation Services' },
    { familyKey: 'TP', codes: ['TP2025'], department: 'Transit' },
    { familyKey: 'WM', codes: ['WM2025'], department: 'Waste Management and Environmental Sustainability' },
    { familyKey: 'WO', codes: ['WO2025'], department: 'Water Operations' },
    { familyKey: 'WW', codes: ['WW2025'], department: 'Waste Water Operations' },
  ],
  spotLocations: [],
  revenueLocations: [],
  revenueLocationCategories: DEFAULT_PARKING_REVENUE_LOCATION_CATEGORIES,
  flagRules: DEFAULT_PARKING_FLAG_RULES,
  departmentLegendSort: { key: 'color', direction: 'asc' },
};
