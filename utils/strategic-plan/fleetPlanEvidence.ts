import { FLEET_PLAN_SHEET_CONFIG_BY_KEY } from '../fleet-plan/fleetPlanConfig';
import { isFleetPlanRowCountedInFleetTotal } from '../fleet-plan/fleetPlanEditing';
import { fleetRowHasContent } from '../fleet-plan/fleetPlanModel';
import type { FleetPlanSheetKey, FleetPlanWorkbook } from '../fleet-plan/types';

export const STRATEGIC_FLEET_PLAN_YEARS = ['2027', '2028', '2029', '2030', '2031', '2032'] as const;

export type StrategicFleetPlanYear = typeof STRATEGIC_FLEET_PLAN_YEARS[number];

export interface StrategicFleetPlanYearSummary {
    year: StrategicFleetPlanYear;
    fleetTotal: number;
    retiring: number;
    replacementPurchases: number;
    growthPurchases: number;
    totalPurchases: number;
}

export interface StrategicFleetPlanRow {
    id: string;
    sheetKey: FleetPlanSheetKey;
    busType: string;
    unitNumber: string;
    makeModel: string;
    modelYear: string;
    onOrder: string;
    timeline: Record<StrategicFleetPlanYear, string>;
}

export interface StrategicFleetPlanEvidence {
    years: readonly StrategicFleetPlanYear[];
    summaries: StrategicFleetPlanYearSummary[];
    rows: StrategicFleetPlanRow[];
}

function normalizeStatus(value: string | undefined): string {
    return (value || '').trim().toUpperCase();
}

export function buildStrategicFleetPlanEvidence(workbook: FleetPlanWorkbook): StrategicFleetPlanEvidence {
    const rows = workbook.sheets.flatMap((sheet) => sheet.rows
        .filter(fleetRowHasContent)
        .map((row) => ({
            id: `${sheet.key}-${row.id}`,
            sheetKey: sheet.key,
            busType: FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheet.key].title,
            unitNumber: row.unitNumber.trim(),
            makeModel: row.makeModel.trim(),
            modelYear: row.year.trim(),
            onOrder: (row.onOrder || '').trim(),
            timeline: Object.fromEntries(STRATEGIC_FLEET_PLAN_YEARS.map((year) => [
                year,
                (row.timeline[year] || '').trim(),
            ])) as Record<StrategicFleetPlanYear, string>,
        })));

    const summaries = STRATEGIC_FLEET_PLAN_YEARS.map((year) => {
        let fleetTotal = 0;
        let retiring = 0;
        let replacementPurchases = 0;
        let growthPurchases = 0;

        workbook.sheets.forEach((sheet) => {
            sheet.rows.filter(fleetRowHasContent).forEach((row) => {
                const status = normalizeStatus(row.timeline[year]);
                if (isFleetPlanRowCountedInFleetTotal(row, sheet.key, year)) fleetTotal += 1;
                if (status === 'RETIRE') retiring += 1;
                if (status === 'GROWTH') growthPurchases += 1;
                if (status.startsWith('PURCHASE')) replacementPurchases += 1;
            });
        });

        return {
            year,
            fleetTotal,
            retiring,
            replacementPurchases,
            growthPurchases,
            totalPurchases: replacementPurchases + growthPurchases,
        };
    });

    return { years: STRATEGIC_FLEET_PLAN_YEARS, summaries, rows };
}
