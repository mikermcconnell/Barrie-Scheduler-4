import { FLEET_PLAN_SHEET_CONFIG_BY_KEY } from './fleetPlanConfig';
import { fleetRowHasContent } from './fleetPlanModel';
import type { FleetPlanRow, FleetPlanSheetKey, FleetPlanWorkbook } from './types';

export type FleetPlanValidationSeverity = 'error' | 'warning';

export interface FleetPlanValidationIssue {
    severity: FleetPlanValidationSeverity;
    code:
        | 'missing-unit'
        | 'duplicate-unit'
        | 'invalid-year'
        | 'year-range'
        | 'missing-lifecycle-start'
        | 'missing-retirement-warning'
        | 'multiple-retirements'
        | 'retirement-before-start'
        | 'activity-after-retirement'
        | 'purchase-after-retirement'
        | 'unknown-timeline-status';
    message: string;
    sheetKey?: FleetPlanSheetKey;
    rowId?: string;
    unitNumber?: string;
}

export interface FleetPlanValidationResult {
    issues: FleetPlanValidationIssue[];
    errors: FleetPlanValidationIssue[];
    warnings: FleetPlanValidationIssue[];
    canSave: boolean;
}

const KNOWN_STATUS_VALUES = new Set([
    'RETIRE',
    'PURCHASE',
    'GROWTH',
    'TRADED',
    'TRADE',
    'TRAINING',
]);

function normalize(value: string | undefined): string {
    return (value || '').trim();
}

function normalizeStatus(value: string | undefined): string {
    return normalize(value).toUpperCase();
}

function describeRow(sheetKey: FleetPlanSheetKey, row: FleetPlanRow): string {
    return `${row.unitNumber.trim() || row.makeModel.trim() || 'Unnamed row'} (${FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey].title})`;
}

function isActiveTimelineValue(row: FleetPlanRow, value: string): boolean {
    const trimmed = normalize(value);
    if (!trimmed) return false;
    const status = normalizeStatus(trimmed);
    if (KNOWN_STATUS_VALUES.has(status) || status.startsWith('PURCHASE') || status.includes('RETIRED') || status.includes('GOVDEALS')) {
        return false;
    }

    const unitNumber = row.unitNumber.trim();
    if (unitNumber && status === unitNumber.toUpperCase()) return true;
    return /^\d+(\.\d+)?$/.test(trimmed) || /-E$/i.test(trimmed);
}

function isKnownPlanningStatus(value: string): boolean {
    const status = normalizeStatus(value);
    return KNOWN_STATUS_VALUES.has(status)
        || status.startsWith('PURCHASE')
        || status.includes('RETIRED')
        || status.includes('GOVDEALS');
}

function getFirstYear(years: string[]): string | null {
    return years.sort((left, right) => Number(left) - Number(right))[0] ?? null;
}

function addIssue(issues: FleetPlanValidationIssue[], issue: FleetPlanValidationIssue): void {
    issues.push(issue);
}

export function validateFleetPlanWorkbook(
    workbook: FleetPlanWorkbook,
    currentYear = new Date().getFullYear(),
): FleetPlanValidationResult {
    const issues: FleetPlanValidationIssue[] = [];
    const unitRows = new Map<string, Array<{ sheetKey: FleetPlanSheetKey; row: FleetPlanRow }>>();

    workbook.sheets.forEach((sheet) => {
        const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheet.key];
        const timelineYears = config.timelineColumns.map((column) => column.key);

        sheet.rows.forEach((row) => {
            if (!fleetRowHasContent(row)) return;

            const rowLabel = describeRow(sheet.key, row);
            const unitNumber = row.unitNumber.trim();
            if (!unitNumber) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'missing-unit',
                    message: `${rowLabel} is missing a unit number.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                });
            } else {
                const key = unitNumber.toUpperCase();
                unitRows.set(key, [...(unitRows.get(key) || []), { sheetKey: sheet.key, row }]);
            }

            const modelYear = row.year.trim();
            if (modelYear && !/^\d{4}$/.test(modelYear)) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'invalid-year',
                    message: `${rowLabel} has an invalid year "${modelYear}". Use a four-digit year.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            } else if (modelYear) {
                const yearNumber = Number(modelYear);
                if (yearNumber < 1990 || yearNumber > currentYear + 20) {
                    addIssue(issues, {
                        severity: 'warning',
                        code: 'year-range',
                        message: `${rowLabel} has an unusual year "${modelYear}". Confirm it is intentional.`,
                        sheetKey: sheet.key,
                        rowId: row.id,
                        unitNumber,
                    });
                }
            }

            const activeYears = timelineYears.filter((year) => isActiveTimelineValue(row, row.timeline[year] || ''));
            const purchaseYears = timelineYears.filter((year) => ['PURCHASE', 'GROWTH'].includes(normalizeStatus(row.timeline[year])));
            const retirementYears = timelineYears.filter((year) => normalizeStatus(row.timeline[year]) === 'RETIRE');
            const lifecycleStartYear = getFirstYear([...activeYears, ...purchaseYears]);
            const retirementYear = getFirstYear(retirementYears);

            if (!lifecycleStartYear) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'missing-lifecycle-start',
                    message: `${rowLabel} is missing an in-service, purchase, or growth marker in the timeline.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            }

            const isCurrentlyInService = activeYears.some((year) => Number(year) <= currentYear);
            if (retirementYears.length === 0 && isCurrentlyInService) {
                addIssue(issues, {
                    severity: 'warning',
                    code: 'missing-retirement-warning',
                    message: `${rowLabel} is in service and has no RETIRE marker.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            }

            if (retirementYears.length > 1) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'multiple-retirements',
                    message: `${rowLabel} has multiple RETIRE markers. Keep one retirement year.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            }

            if (lifecycleStartYear && retirementYear && Number(retirementYear) < Number(lifecycleStartYear)) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'retirement-before-start',
                    message: `${rowLabel} retires before its first service/purchase marker.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            }

            if (retirementYear && activeYears.some((year) => Number(year) > Number(retirementYear))) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'activity-after-retirement',
                    message: `${rowLabel} has active service after its retirement year.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            }

            if (retirementYear && purchaseYears.some((year) => Number(year) > Number(retirementYear))) {
                addIssue(issues, {
                    severity: 'error',
                    code: 'purchase-after-retirement',
                    message: `${rowLabel} has a purchase/growth marker after retirement.`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            }

            timelineYears.forEach((year) => {
                const value = normalize(row.timeline[year]);
                if (!value || isActiveTimelineValue(row, value) || isKnownPlanningStatus(value)) return;
                addIssue(issues, {
                    severity: 'warning',
                    code: 'unknown-timeline-status',
                    message: `${rowLabel} has a non-standard ${year} timeline value "${value}".`,
                    sheetKey: sheet.key,
                    rowId: row.id,
                    unitNumber,
                });
            });
        });
    });

    unitRows.forEach((rows, normalizedUnit) => {
        if (rows.length < 2) return;
        addIssue(issues, {
            severity: 'error',
            code: 'duplicate-unit',
            message: `Unit ${normalizedUnit} appears ${rows.length} times. Unit numbers must be unique across the Fleet Plan.`,
            sheetKey: rows[0]?.sheetKey,
            rowId: rows[0]?.row.id,
            unitNumber: normalizedUnit,
        });
    });

    const errors = issues.filter((issue) => issue.severity === 'error');
    const warnings = issues.filter((issue) => issue.severity === 'warning');

    return {
        issues,
        errors,
        warnings,
        canSave: errors.length === 0,
    };
}
