import { getParkingCodeFamilyKey } from './parkingCodeRules';
import type { ParkingMonthlyDataset, ParkingRawRow, ParkingSettings } from './parkingTypes';

const normalizeText = (value: string | null | undefined) => (value || '').trim().toLowerCase();

export interface ParkingObservationScope {
  year: string;
  month?: string;
  codeFamilyKey?: string;
  department?: string;
  label: string;
}

export interface ParkingObservationDrilldown extends ParkingObservationScope {
  rows: ParkingRawRow[];
  totalValue: number;
}

export function filterParkingObservationRows(
  months: ParkingMonthlyDataset[],
  settings: ParkingSettings,
  scope: ParkingObservationScope,
): ParkingRawRow[] {
  const targetFamily = scope.codeFamilyKey
    ? getParkingCodeFamilyKey(scope.codeFamilyKey).trim().toUpperCase()
    : null;
  const targetDepartment = scope.department ? normalizeText(scope.department) : null;
  const ignoredFamilyKeys = new Set<string>();
  const ignoredDepartments = new Set<string>();
  for (const mapping of settings.codeFamilies) {
    if (mapping.ignoreData !== true) continue;
    ignoredFamilyKeys.add(getParkingCodeFamilyKey(mapping.familyKey).trim().toUpperCase());
    ignoredDepartments.add(normalizeText(mapping.department));
  }

  const rows: ParkingRawRow[] = [];
  for (const month of months) {
    if (!month.month.startsWith(`${scope.year}-`) || (scope.month && month.month !== scope.month)) continue;
    for (const row of month.rows) {
      const familyKey = getParkingCodeFamilyKey(row.codeFamilyKey).trim().toUpperCase();
      const department = normalizeText(row.department);
      if (ignoredFamilyKeys.has(familyKey) || ignoredDepartments.has(department)) continue;
      if (targetFamily && familyKey !== targetFamily) continue;
      if (targetDepartment && department !== targetDepartment) continue;
      rows.push(row);
    }
  }
  return rows;
}

export function buildParkingObservationDrilldown(
  months: ParkingMonthlyDataset[],
  settings: ParkingSettings,
  scope: ParkingObservationScope,
): ParkingObservationDrilldown {
  const rows = filterParkingObservationRows(months, settings, scope).sort((a, b) => (
      b.startDate.localeCompare(a.startDate)
      || b.startMinutes - a.startMinutes
      || a.plate.localeCompare(b.plate)
  ));

  return {
    ...scope,
    rows,
    totalValue: Math.round(rows.reduce((sum, row) => sum + row.discountAmount, 0) * 100) / 100,
  };
}
