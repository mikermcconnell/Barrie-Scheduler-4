// Performance Snapshot Types — compact monthly rollups for historical archive
// Stored at Firestore: teams/{teamId}/performanceSnapshots/{YYYY-MM}

import type { DayType, OTPBreakdown } from './performanceDataTypes';

export const SNAPSHOT_VERSION = 1;

export interface MonthlyRouteSnapshot {
  routeId: string;
  routeName: string;
  ridership: number;
  otp: OTPBreakdown;
  tripCount: number;
  serviceHours: number;
}

export interface MonthlyDayTypeSnapshot {
  dayType: DayType;
  ridership: number;
  otp: OTPBreakdown;
  tripCount: number;
}

export interface MonthlySnapshot {
  month: string;                // "YYYY-MM"
  snapshotVersion: number;
  createdAt: string;            // ISO timestamp
  dayCount: number;             // days with data (flags partial months)
  dayTypes: {
    weekday: number;
    saturday: number;
    sunday: number;
  };
  system: {
    totalRidership: number;
    totalBoardings: number;
    totalAlightings: number;
    otp: OTPBreakdown;
    tripCount: number;
    vehicleCount: number;
    serviceHours: number;
    wheelchairTrips: number;
    avgSystemLoad: number;
    peakLoad: number;
  };
  byRoute: MonthlyRouteSnapshot[];
  byDayType: MonthlyDayTypeSnapshot[];
  dataQuality: {
    totalRecords: number;
    missingAVL: number;
    missingAPC: number;
  };
}
