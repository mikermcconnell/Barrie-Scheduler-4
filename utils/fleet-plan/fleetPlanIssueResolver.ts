import { FLEET_PLAN_SHEET_CONFIG_BY_KEY } from './fleetPlanConfig';
import { cloneFleetPlanWorkbook, fleetRowHasContent } from './fleetPlanModel';
import type { FleetPlanRow, FleetPlanSheetKey, FleetPlanWorkbook } from './types';
import type { FleetPlanValidationIssue, FleetPlanValidationResult } from './fleetPlanValidation';

export type FleetPlanResolutionAction =
    | {
        type: 'set-unit-number';
        sheetKey: FleetPlanSheetKey;
        rowId: string;
        suggestedUnitNumber: string;
    }
    | {
        type: 'keep-retirement-year';
        sheetKey: FleetPlanSheetKey;
        rowId: string;
        suggestedRetirementYear: string;
    };

export interface FleetPlanResolutionSuggestion {
    id: string;
    issueCode: FleetPlanValidationIssue['code'];
    issueSeverity: FleetPlanValidationIssue['severity'];
    issueMessage: string;
    title: string;
    suggestion: string;
    actionLabel: string;
    manualLabel: string;
    action: FleetPlanResolutionAction;
}

function normalizeUnit(value: string | undefined): string {
    return (value || '').trim().toUpperCase();
}

function rowLabel(row: FleetPlanRow): string {
    return row.unitNumber.trim() || row.makeModel.trim() || 'Unnamed row';
}

function getRow(workbook: FleetPlanWorkbook, sheetKey: FleetPlanSheetKey, rowId: string): FleetPlanRow | null {
    return workbook.sheets.find((sheet) => sheet.key === sheetKey)?.rows.find((row) => row.id === rowId) ?? null;
}

function collectUsedUnits(workbook: FleetPlanWorkbook): Set<string> {
    return new Set(workbook.sheets.flatMap((sheet) => sheet.rows.map((row) => normalizeUnit(row.unitNumber)).filter(Boolean)));
}

function findNextAvailableUnit(workbook: FleetPlanWorkbook, sheetKey: FleetPlanSheetKey, preferredStart?: number): string {
    const used = collectUsedUnits(workbook);
    const sheet = workbook.sheets.find((entry) => entry.key === sheetKey);
    const numbers = sheet?.rows
        .map((row) => Number.parseInt(row.unitNumber.trim(), 10))
        .filter((value) => Number.isFinite(value)) ?? [];
    let candidate = Math.max(preferredStart ?? 0, numbers.length > 0 ? Math.max(...numbers) + 1 : 1);

    while (used.has(String(candidate).toUpperCase())) {
        candidate += 1;
    }

    return String(candidate);
}

function timelineRetirementYears(row: FleetPlanRow): string[] {
    return Object.entries(row.timeline)
        .filter(([, value]) => value.trim().toUpperCase() === 'RETIRE')
        .map(([year]) => year)
        .sort((left, right) => Number(left) - Number(right));
}

function normalizeStatus(value: string | undefined): string {
    return (value || '').trim().toUpperCase();
}

function isActiveTimelineValue(row: FleetPlanRow, value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const status = normalizeStatus(trimmed);
    if (
        ['RETIRE', 'PURCHASE', 'GROWTH', 'TRADED', 'TRADE', 'TRAINING'].includes(status)
        || status.startsWith('PURCHASE')
        || status.includes('RETIRED')
        || status.includes('GOVDEALS')
    ) {
        return false;
    }

    const unitNumber = row.unitNumber.trim();
    if (unitNumber && status === unitNumber.toUpperCase()) return true;
    return /^\d+(\.\d+)?$/.test(trimmed) || /-E$/i.test(trimmed);
}

function getFirstInServiceYear(row: FleetPlanRow, sheetKey: FleetPlanSheetKey): string | null {
    const configYears = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey].timelineColumns.map((column) => column.key);
    const years = Array.from(new Set([...configYears, ...Object.keys(row.timeline)]))
        .filter((year) => /^\d{4}$/.test(year))
        .sort((left, right) => Number(left) - Number(right));

    return years.find((year) => isActiveTimelineValue(row, row.timeline[year] || '')) ?? null;
}

function getThirteenthYearAfterInService(row: FleetPlanRow, sheetKey: FleetPlanSheetKey): string | null {
    const startYear = getFirstInServiceYear(row, sheetKey);
    if (!startYear) return null;
    return String(Number(startYear) + 13);
}

function issueKey(issue: FleetPlanValidationIssue): string {
    return `${issue.code}:${issue.sheetKey || 'all'}:${issue.rowId || issue.unitNumber || issue.message}`;
}

export function buildFleetPlanResolutionSuggestions(
    workbook: FleetPlanWorkbook,
    validation: FleetPlanValidationResult,
): FleetPlanResolutionSuggestion[] {
    const suggestions: FleetPlanResolutionSuggestion[] = [];
    const usedSuggestionIds = new Set<string>();

    const addSuggestion = (suggestion: FleetPlanResolutionSuggestion) => {
        if (usedSuggestionIds.has(suggestion.id)) return;
        usedSuggestionIds.add(suggestion.id);
        suggestions.push(suggestion);
    };

    validation.errors.forEach((issue) => {
        if (issue.code === 'missing-unit' && issue.sheetKey && issue.rowId) {
            const suggestedUnitNumber = findNextAvailableUnit(workbook, issue.sheetKey);
            addSuggestion({
                id: issueKey(issue),
                issueCode: issue.code,
                issueSeverity: issue.severity,
                issueMessage: issue.message,
                title: 'Missing unit number',
                suggestion: `Set this row to the next available ${FLEET_PLAN_SHEET_CONFIG_BY_KEY[issue.sheetKey].title} unit number: ${suggestedUnitNumber}.`,
                actionLabel: `Use ${suggestedUnitNumber}`,
                manualLabel: 'Unit number',
                action: {
                    type: 'set-unit-number',
                    sheetKey: issue.sheetKey,
                    rowId: issue.rowId,
                    suggestedUnitNumber,
                },
            });
            return;
        }

        if (issue.code === 'multiple-retirements' && issue.sheetKey && issue.rowId) {
            const row = getRow(workbook, issue.sheetKey, issue.rowId);
            if (!row) return;
            const years = timelineRetirementYears(row);
            const suggestedRetirementYear = years[years.length - 1];
            if (!suggestedRetirementYear) return;
            addSuggestion({
                id: issueKey(issue),
                issueCode: issue.code,
                issueSeverity: issue.severity,
                issueMessage: issue.message,
                title: 'Multiple retirement markers',
                suggestion: `Keep ${suggestedRetirementYear} as the retirement year for ${rowLabel(row)} and clear the other RETIRE markers.`,
                actionLabel: `Keep ${suggestedRetirementYear}`,
                manualLabel: 'Retirement year to keep',
                action: {
                    type: 'keep-retirement-year',
                    sheetKey: issue.sheetKey,
                    rowId: issue.rowId,
                    suggestedRetirementYear,
                },
            });
        }
    });

    validation.warnings.forEach((issue) => {
        if (issue.code !== 'missing-retirement-warning' || !issue.sheetKey || !issue.rowId) return;
        const row = getRow(workbook, issue.sheetKey, issue.rowId);
        if (!row) return;
        const suggestedRetirementYear = getThirteenthYearAfterInService(row, issue.sheetKey);
        if (!suggestedRetirementYear) return;
        addSuggestion({
            id: issueKey(issue),
            issueCode: issue.code,
            issueSeverity: issue.severity,
            issueMessage: issue.message,
            title: 'Missing retirement year',
            suggestion: `Set ${rowLabel(row)} to retire in ${suggestedRetirementYear}, 13 years after its first in-service year.`,
            actionLabel: `Set ${suggestedRetirementYear}`,
            manualLabel: 'Retirement year',
            action: {
                type: 'keep-retirement-year',
                sheetKey: issue.sheetKey,
                rowId: issue.rowId,
                suggestedRetirementYear,
            },
        });
    });

    const duplicateGroups = new Map<string, Array<{ sheetKey: FleetPlanSheetKey; row: FleetPlanRow }>>();
    workbook.sheets.forEach((sheet) => {
        sheet.rows.forEach((row) => {
            if (!fleetRowHasContent(row)) return;
            const unit = normalizeUnit(row.unitNumber);
            if (!unit) return;
            duplicateGroups.set(unit, [...(duplicateGroups.get(unit) || []), { sheetKey: sheet.key, row }]);
        });
    });

    duplicateGroups.forEach((entries, unit) => {
        if (entries.length < 2) return;
        entries.slice(1).forEach((entry, index) => {
            const numericUnit = Number.parseInt(unit, 10);
            const suggestedUnitNumber = findNextAvailableUnit(
                workbook,
                entry.sheetKey,
                Number.isFinite(numericUnit) ? numericUnit + index + 1 : undefined,
            );
            addSuggestion({
                id: `duplicate-unit:${entry.sheetKey}:${entry.row.id}:${unit}`,
                issueCode: 'duplicate-unit',
                issueSeverity: 'error',
                issueMessage: `Unit ${unit} appears more than once.`,
                title: `Duplicate unit ${unit}`,
                suggestion: `Keep the first ${unit} row unchanged and change this duplicate row to ${suggestedUnitNumber}.`,
                actionLabel: `Use ${suggestedUnitNumber}`,
                manualLabel: 'Replacement unit number',
                action: {
                    type: 'set-unit-number',
                    sheetKey: entry.sheetKey,
                    rowId: entry.row.id,
                    suggestedUnitNumber,
                },
            });
        });
    });

    return suggestions;
}

export function applyFleetPlanResolution(
    workbook: FleetPlanWorkbook,
    suggestion: FleetPlanResolutionSuggestion,
    manualValue?: string,
): FleetPlanWorkbook {
    const next = cloneFleetPlanWorkbook(workbook);
    const sheet = next.sheets.find((entry) => entry.key === suggestion.action.sheetKey);
    if (!sheet) return workbook;

    const row = sheet.rows.find((entry) => entry.id === suggestion.action.rowId);
    if (!row) return workbook;

    if (suggestion.action.type === 'set-unit-number') {
        const unitNumber = (manualValue || suggestion.action.suggestedUnitNumber).trim();
        if (!unitNumber) return workbook;
        row.unitNumber = unitNumber;
        return next;
    }

    const retirementYear = (manualValue || suggestion.action.suggestedRetirementYear).trim();
    if (!/^\d{4}$/.test(retirementYear)) return workbook;
    row.timeline = Object.fromEntries(Object.entries(row.timeline).map(([year, value]) => [
        year,
        value.trim().toUpperCase() === 'RETIRE' && year !== retirementYear ? '' : value,
    ]));
    row.timeline[retirementYear] = 'RETIRE';

    return next;
}
