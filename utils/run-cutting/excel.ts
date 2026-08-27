import * as XLSX from 'xlsx';
import type { OperationsPlanningInputV1, ProposalAssessment } from './types';

const safeCell = (value: unknown): string | number | boolean | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const formatMinute = (value: number | null | undefined): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    const rounded = Math.round(value);
    const day = Math.floor(rounded / 1440);
    const withinDay = ((rounded % 1440) + 1440) % 1440;
    const time = `${String(Math.floor(withinDay / 60)).padStart(2, '0')}:${String(withinDay % 60).padStart(2, '0')}`;
    return day > 0 ? `${time} +${day}d` : time;
};

const duration = (minutes: number | null | undefined): string => {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '';
    const rounded = Math.round(minutes);
    return `${Math.floor(rounded / 60)}:${String(Math.abs(rounded % 60)).padStart(2, '0')}`;
};

const appendRows = (
    workbook: XLSX.WorkBook,
    name: string,
    rows: Array<Record<string, unknown>>,
): void => {
    const sanitized = rows.map(row => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, safeCell(value)]),
    ));
    const sheet = XLSX.utils.json_to_sheet(sanitized.length > 0 ? sanitized : [{ Status: 'No records' }]);
    const widths = Object.keys(sanitized[0] ?? { Status: '' }).map(key => ({ wch: Math.min(42, Math.max(12, key.length + 2)) }));
    sheet['!cols'] = widths;
    XLSX.utils.book_append_sheet(workbook, sheet, name);
};

export const createOperationsPlanningWorkbook = (
    input: OperationsPlanningInputV1,
    assessment: ProposalAssessment,
): XLSX.WorkBook => {
    const workbook = XLSX.utils.book_new();
    const proposal = assessment.proposal;
    const metricsByRun = new Map(assessment.dailyRunMetrics.map(item => [item.runId, item]));
    const metricsByRoster = new Map(assessment.weeklyRosterMetrics.map(item => [item.rosterId, item]));

    appendRows(workbook, 'Summary', [{
        Scenario: input.scenarioName,
        'Scenario ID': input.scenarioId,
        'Schema version': input.schemaVersion,
        'Exported at': input.exportedAt,
        'Source fingerprint': input.sourceManifest.fingerprint,
        'Pinned schedules': input.sourceManifest.items.length,
        'Vehicle blocks': input.blockAudits.length,
        'Daily runs': proposal?.dailyRuns.length ?? 0,
        'Weekly rosters': proposal?.weeklyRosters.length ?? 0,
        'Integrity blockers': assessment.findings.filter(item => item.category === 'integrity' && item.severity === 'error').length,
        'Contract blockers': assessment.findings.filter(item => item.category === 'contractual' && item.severity === 'error').length,
        Warnings: assessment.findings.filter(item => item.severity === 'warning').length,
        'Approval ready': assessment.approvalReady ? 'Yes' : 'No',
        Boundary: 'Advisory operations-planning scenario; Master Schedule is unchanged.',
    }]);

    appendRows(workbook, 'Sources', input.sourceManifest.items.map(item => ({
        Route: item.routeNumber,
        'Day type': item.dayType,
        'Route identity': item.routeIdentity,
        Version: item.version,
        'Source team': item.sourceTeamId,
        'Storage path': item.storagePath,
        'Content fingerprint': item.contentFingerprint,
        'Block fingerprint': item.blockMembershipFingerprint,
        'Pinned at': item.pinnedAt,
    })));

    appendRows(workbook, 'Block Audit', input.blockAudits.map(audit => ({
        'Vehicle block': audit.vehicleBlockKey,
        'Source block IDs': audit.sourceBlockIds.join(', '),
        Routes: audit.routeIdentities.join(', '),
        'Day type': audit.dayType,
        Trips: audit.tripIds.length,
        'First departure': formatMinute(audit.firstDeparture),
        'Final arrival': formatMinute(audit.finalArrival),
        'Membership fingerprint': audit.membershipFingerprint,
        'Integrity findings': audit.findings.filter(item => item.severity === 'error').length,
    })));

    appendRows(workbook, 'Daily Runs', (proposal?.dailyRuns ?? []).map(run => {
        const metric = metricsByRun.get(run.id);
        return {
            'Run number': run.runNumber,
            'Run ID': run.id,
            'Day type': run.dayType,
            Pieces: run.pieces.length,
            Trips: run.pieces.reduce((total, piece) => total + piece.tripIds.length, 0),
            Report: formatMinute(metric?.reportTime),
            Off: formatMinute(metric?.offTime),
            Platform: duration(metric?.platformMinutes),
            Paid: duration(metric?.paidMinutes),
            Spread: duration(metric?.spreadMinutes),
            'Unpaid break': duration(metric?.unpaidBreakMinutes),
            Split: metric?.isSplit ? 'Yes' : 'No',
            Notes: run.notes ?? '',
        };
    }));

    appendRows(workbook, 'Run Pieces', (proposal?.dailyRuns ?? []).flatMap(run => run.pieces.map((piece, index) => ({
        'Run number': run.runNumber,
        'Day type': run.dayType,
        Piece: index + 1,
        'Piece ID': piece.id,
        'Vehicle block': piece.blockId,
        Route: piece.routeNumber,
        'Start relief': piece.startReliefPoint,
        'End relief': piece.endReliefPoint,
        'Trip count': piece.tripIds.length,
        'Trip IDs': piece.tripIds.join(', '),
    }))));

    appendRows(workbook, 'Duty Activities', (proposal?.dailyRuns ?? []).flatMap(run => (
        metricsByRun.get(run.id)?.activities.map(activity => ({
            'Run number': run.runNumber,
            'Day type': run.dayType,
            Activity: activity.type,
            Start: formatMinute(activity.startTime),
            End: formatMinute(activity.endTime),
            Duration: duration(activity.endTime - activity.startTime),
            Paid: activity.paid ? 'Yes' : 'No',
            'Trip ID': activity.tripId ?? '',
            Note: activity.note ?? '',
        })) ?? []
    )));

    appendRows(workbook, 'Weekly Rosters', (proposal?.weeklyRosters ?? []).map(roster => {
        const metric = metricsByRoster.get(roster.id);
        return {
            Crew: roster.crewNumber,
            'Crew ID': roster.id,
            ...Object.fromEntries(roster.assignments.map(item => [item.day, item.runId ?? 'OFF'])),
            Paid: duration(metric?.paidMinutes),
            Platform: duration(metric?.platformMinutes),
            Combined: duration(metric?.combinedMinutes),
            Overtime: duration(metric?.overtimePlatformMinutes),
            'Days worked': metric?.daysWorked ?? 0,
            'Rest violations': metric?.restViolations ?? 0,
            'All straight': metric?.allStraight ? 'Yes' : 'No',
            Notes: roster.notes ?? '',
        };
    }));

    appendRows(workbook, 'Findings', assessment.findings.map(item => ({
        Category: item.category,
        Severity: item.severity,
        Code: item.code,
        Message: item.message,
        'Day type': item.dayType ?? '',
        Run: item.runId ?? '',
        Crew: item.crewId ?? '',
        Block: item.blockId ?? '',
        Trip: item.tripId ?? '',
    })));

    appendRows(workbook, 'Rules', [
        ...input.ruleProfile.sources.map(source => ({
            Section: 'Source',
            Rule: source.label,
            Value: source.authority,
            Note: source.note ?? '',
        })),
        { Section: 'Daily', Rule: 'Straight driving maximum', Value: duration(input.ruleProfile.straightDrivingMaximumMinutes), Note: '' },
        { Section: 'Daily', Rule: 'Split piece driving maximum', Value: duration(input.ruleProfile.splitPieceDrivingMaximumMinutes), Note: '' },
        { Section: 'Daily', Rule: 'Maximum work', Value: duration(input.ruleProfile.maximumWorkMinutes), Note: '' },
        { Section: 'Daily', Rule: 'Maximum driving', Value: duration(input.ruleProfile.maximumDrivingMinutes), Note: '' },
        { Section: 'Daily', Rule: 'Maximum spread', Value: duration(input.ruleProfile.maximumSpreadMinutes), Note: '' },
        { Section: 'Weekly', Rule: 'Minimum paid', Value: duration(input.ruleProfile.weekly.minimumPaidMinutes), Note: '' },
        { Section: 'Weekly', Rule: 'Maximum platform', Value: duration(input.ruleProfile.weekly.maximumPlatformMinutes), Note: '' },
        { Section: 'Weekly', Rule: 'Maximum combined', Value: duration(input.ruleProfile.weekly.maximumCombinedMinutes), Note: '' },
        { Section: 'Weekly', Rule: 'Minimum rest', Value: duration(input.ruleProfile.weekly.minimumRestMinutes), Note: '' },
    ]);

    return workbook;
};

export const downloadOperationsPlanningWorkbook = (
    input: OperationsPlanningInputV1,
    assessment: ProposalAssessment,
): void => {
    const base = input.scenarioName.trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'operations_planning';
    XLSX.writeFile(createOperationsPlanningWorkbook(input, assessment), `${base}_runcut.xlsx`);
};
