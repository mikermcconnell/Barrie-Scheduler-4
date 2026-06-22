export const PARKING_SCHEMA_VERSION = 1;

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
  colorHex?: string;
  archived?: boolean;
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
  flagRules: ParkingFlagRuleSettings;
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
    { familyKey: 'P1', codes: ['P12026'], department: 'City Staff Underground Parking' },
    { familyKey: 'RS', codes: ['RS2025', 'RS2026'], department: 'Recreation Services' },
    { familyKey: 'TP', codes: ['TP2025'], department: 'Transit' },
    { familyKey: 'WM', codes: ['WM2025'], department: 'Waste Management and Environmental Sustainability' },
    { familyKey: 'WO', codes: ['WO2025'], department: 'Water Operations' },
    { familyKey: 'WW', codes: ['WW2025'], department: 'Waste Water Operations' },
  ],
  spotLocations: [],
  flagRules: DEFAULT_PARKING_FLAG_RULES,
};
