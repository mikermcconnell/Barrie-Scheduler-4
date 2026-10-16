import type { RouteMonth, SystemMonth, TargetKey } from './types';

/** Lower-case and strip everything but letters and digits, so `On-Time %` matches `ontime`. */
export const normalizeHeader = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface Column<K extends string> {
  key: K;
  header: string;
  aliases: string[];
  kind: 'month' | 'number' | 'percent' | 'text';
  required?: boolean;
  help: string;
}

export const SYSTEM_SHEET = 'System Monthly';
export const ROUTES_SHEET = 'Routes';
export const TARGETS_SHEET = 'Targets';
export const NOTES_SHEET = 'Notes';

export const SYSTEM_COLUMNS: Column<keyof SystemMonth>[] = [
  { key: 'month', header: 'Month', aliases: ['month', 'period', 'reportmonth'], kind: 'month', required: true, help: 'First day of the month, e.g. 2026-09-01' },
  { key: 'boardings', header: 'Boardings', aliases: ['boardings', 'totalboardings', 'ridership', 'passengers'], kind: 'number', required: true, help: 'Total fixed-route boardings' },
  { key: 'revenueHours', header: 'Revenue Hours', aliases: ['revenuehours', 'revhours', 'revenuehrs', 'servicehours'], kind: 'number', help: 'Vehicle hours in passenger service' },
  { key: 'scheduledTrips', header: 'Scheduled Trips', aliases: ['scheduledtrips', 'tripsscheduled'], kind: 'number', help: 'Trips in the published schedule' },
  { key: 'tripsOperated', header: 'Trips Operated', aliases: ['tripsoperated', 'operatedtrips', 'tripsdelivered'], kind: 'number', help: 'Scheduled trips actually run' },
  { key: 'onTimePct', header: 'On-Time %', aliases: ['ontime', 'ontimepct', 'ontimepercent', 'ontimeperformance', 'otp'], kind: 'percent', help: 'Timepoint departures 1 min early to 5 min late' },
  { key: 'fareRevenue', header: 'Fare Revenue', aliases: ['farerevenue', 'fareboxrevenue', 'fares', 'revenue'], kind: 'number', help: 'Passenger fare revenue ($)' },
  { key: 'operatingCost', header: 'Operating Cost', aliases: ['operatingcost', 'operatingcosts', 'operatingexpense', 'totalcost', 'cost'], kind: 'number', help: 'Fully allocated operating cost ($)' },
  { key: 'complaints', header: 'Complaints', aliases: ['complaints', 'customercomplaints'], kind: 'number', help: 'Valid customer complaints received' },
];

export const ROUTE_COLUMNS: Column<keyof RouteMonth>[] = [
  { key: 'month', header: 'Month', aliases: ['month', 'period', 'reportmonth'], kind: 'month', required: true, help: 'First day of the month' },
  { key: 'route', header: 'Route', aliases: ['route', 'routeid', 'routenumber', 'routeno', 'routeshortname'], kind: 'text', required: true, help: 'Route number, e.g. 8A' },
  { key: 'routeName', header: 'Route Name', aliases: ['routename', 'name', 'description', 'routelongname'], kind: 'text', help: 'Route name' },
  { key: 'boardings', header: 'Boardings', aliases: ['boardings', 'ridership', 'passengers'], kind: 'number', required: true, help: 'Route boardings' },
  { key: 'revenueHours', header: 'Revenue Hours', aliases: ['revenuehours', 'revhours', 'revenuehrs', 'servicehours'], kind: 'number', help: 'Route revenue hours' },
  { key: 'onTimePct', header: 'On-Time %', aliases: ['ontime', 'ontimepct', 'ontimepercent', 'ontimeperformance', 'otp'], kind: 'percent', help: 'Route on-time performance' },
];

export interface TargetDef {
  key: TargetKey;
  label: string;
  aliases: string[];
  percent?: boolean;
}

export const TARGET_DEFS: TargetDef[] = [
  { key: 'boardings', label: 'Monthly Boardings', aliases: ['monthlyboardings', 'boardings', 'ridership'] },
  { key: 'boardingsPerRevenueHour', label: 'Boardings per Revenue Hour', aliases: ['boardingsperrevenuehour', 'boardingsperrevhour', 'boardingsperrevhr', 'bph'] },
  { key: 'onTimePct', label: 'On-Time %', aliases: ['ontime', 'ontimepct', 'ontimeperformance', 'otp'], percent: true },
  { key: 'serviceDeliveredPct', label: 'Service Delivered %', aliases: ['servicedelivered', 'servicedeliveredpct', 'tripsoperatedpct'], percent: true },
  { key: 'fareboxRecoveryPct', label: 'Farebox Recovery %', aliases: ['fareboxrecovery', 'fareboxrecoveryratio', 'fareboxrecoverypct', 'recoveryratio'], percent: true },
  { key: 'costPerBoarding', label: 'Operating Cost per Boarding', aliases: ['operatingcostperboarding', 'costperboarding', 'costperpassenger'] },
  { key: 'revenueHours', label: 'Monthly Revenue Hours', aliases: ['monthlyrevenuehours', 'revenuehours'] },
  { key: 'complaintsPer100k', label: 'Complaints per 100k Boardings', aliases: ['complaintsper100kboardings', 'complaintsper100k', 'complaintsper100000boardings'] },
  { key: 'annualBoardings', label: 'Annual Boardings', aliases: ['annualboardings', 'annualridership'] },
  { key: 'annualRevenueHours', label: 'Annual Revenue Hours', aliases: ['annualrevenuehours'] },
  { key: 'annualFareRevenue', label: 'Annual Fare Revenue', aliases: ['annualfarerevenue', 'annualrevenue'] },
  { key: 'annualOperatingBudget', label: 'Annual Operating Budget', aliases: ['annualoperatingbudget', 'annualbudget', 'annualoperatingcost'] },
];
