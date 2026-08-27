import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
    assessOperationsPlanningProposal,
    buildOperationsPlanningInput,
    calculateDailyRunMetrics,
    createOperationsPlanningWorkbook,
    createDefaultBarrieRuleProfile,
    parseOperationsPlanningProposal,
    PROPOSAL_IMPORT_LIMITS,
    splitDailyRun,
    type OperationsPlanningInputV1,
    type OperationsPlanningProposalV1,
    type PinnedMasterSchedule,
    type PlanningTrip,
    type VehicleBlockAudit,
} from '../utils/run-cutting';

const masterTrip = (id: string, overrides: Partial<MasterTrip> = {}): MasterTrip => ({
    id,
    lineageId: id,
    blockId: '1',
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 360,
    endTime: 420,
    recoveryTime: 5,
    travelTime: 60,
    cycleTime: 65,
    stops: { 'Park Place': '7:05 AM' },
    stopMinutes: { 'Park Place': 425 },
    recoveryTimes: { 'Park Place': 5 },
    ...overrides,
});

const table = (routeNumber: string, trips: MasterTrip[]): MasterRouteTable => ({
    routeName: `${routeNumber} (Weekday) (North)`,
    stops: ['Park Place'],
    stopIds: { 'Park Place': 'park' },
    trips,
});

const pinned = (routeNumber: string, trips: MasterTrip[], version = 3): PinnedMasterSchedule => {
    const entry: MasterScheduleEntry = {
        id: `${routeNumber}-Weekday`,
        routeNumber,
        dayType: 'Weekday',
        currentVersion: version,
        storagePath: `masters/${routeNumber}/v${version}.json`,
        tripCount: trips.length,
        northStopCount: 1,
        southStopCount: 1,
        updatedAt: new Date('2026-08-27T12:00:00Z'),
        updatedBy: 'planner',
        uploaderName: 'Planner',
        source: 'draft',
    };
    const content: MasterScheduleContent = {
        northTable: table(routeNumber, trips),
        southTable: { ...table(routeNumber, []), routeName: `${routeNumber} (Weekday) (South)` },
        metadata: { routeNumber, dayType: 'Weekday', uploadedAt: '2026-08-27T12:00:00Z' },
    };
    return { sourceTeamId: 'team-1', entry, content, pinnedAt: '2026-08-27T13:00:00Z' };
};

const planningTrip = (overrides: Partial<PlanningTrip> = {}): PlanningTrip => ({
    id: '10-Weekday@v3:North:t1',
    sourceTripId: 't1',
    routeIdentity: '10-Weekday',
    sourceVersion: 3,
    routeNumber: '10',
    dayType: 'Weekday',
    vehicleBlockKey: 'master:10-Weekday@v3:1',
    blockId: '1',
    direction: 'North',
    tripNumber: 1,
    startTime: 360,
    arrivalTime: 810,
    occupiedEndTime: 810,
    travelTime: 450,
    recoveryTime: 0,
    startStop: 'Park Place',
    endStop: 'Park Place',
    arrivalResolution: 'end-time-is-arrival',
    ...overrides,
});

const auditFor = (trip: PlanningTrip): VehicleBlockAudit => ({
    id: trip.vehicleBlockKey,
    routeIdentity: trip.routeIdentity,
    routeIdentities: [trip.routeIdentity],
    sourceVersion: trip.sourceVersion,
    dayType: trip.dayType,
    vehicleBlockKey: trip.vehicleBlockKey,
    blockId: trip.blockId,
    sourceBlockIds: [trip.blockId],
    tripIds: [trip.id],
    membershipFingerprint: 'member-fingerprint',
    firstDeparture: trip.startTime,
    finalArrival: trip.arrivalTime,
    findings: [],
});

const assessmentFixture = (): { input: OperationsPlanningInputV1; proposal: OperationsPlanningProposalV1 } => {
    const trip = planningTrip();
    const audit = auditFor(trip);
    const input: OperationsPlanningInputV1 = {
        schemaVersion: 1,
        kind: 'operations-planning-input',
        scenarioId: 'scenario-1',
        scenarioName: 'Weekday proof',
        exportedAt: '2026-08-27T13:00:00Z',
        sourceManifest: { items: [], fingerprint: 'manifest-1' },
        ruleProfile: createDefaultBarrieRuleProfile(),
        operationsMatrix: { entries: [] },
        trips: [trip],
        blockAudits: [audit],
    };
    const proposal: OperationsPlanningProposalV1 = {
        schemaVersion: 1,
        kind: 'operations-planning-proposal',
        scenarioId: input.scenarioId,
        sourceManifestFingerprint: input.sourceManifest.fingerprint,
        codex: { generatedAt: '2026-08-27T14:00:00Z' },
        blockAudits: [audit],
        dailyRuns: [{
            id: 'weekday-run-1',
            runNumber: 'W-001',
            dayType: 'Weekday',
            pieces: [{
                id: 'piece-1',
                blockId: trip.vehicleBlockKey,
                routeNumber: trip.routeNumber,
                tripIds: [trip.id],
                startReliefPoint: 'Park Place',
                endReliefPoint: 'Park Place',
            }],
        }],
        weeklyRosters: [{
            id: 'crew-1',
            crewNumber: 'Crew 001',
            assignments: [
                ...(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const).map(day => ({
                    day,
                    runId: 'weekday-run-1',
                })),
                { day: 'Saturday' as const, runId: null },
                { day: 'Sunday' as const, runId: null },
            ],
        }],
        findings: [{
            id: 'codex-1',
            category: 'contractual',
            severity: 'error',
            code: 'codex-opinion',
            message: 'Codex thinks this needs review.',
        }],
        methodNotes: ['Balanced objective order applied.'],
    };
    return { input, proposal };
};

describe('run-cutting master adapter and rules', () => {
    it('labels Park Place as a planner-confirmed override', () => {
        const rules = createDefaultBarrieRuleProfile();
        const parkPlace = rules.reliefPoints.find(point => point.name === 'Park Place');
        const source = rules.sources.find(item => item.id === parkPlace?.sourceId);

        expect(parkPlace?.fullBreakPoint).toBe(true);
        expect(source).toMatchObject({ authority: 'planner-confirmed-override' });
        expect(source?.note).toContain('explicitly confirmed');
    });

    it('blocks unresolved terminal arrival instead of guessing legacy semantics', () => {
        const input = buildOperationsPlanningInput({
            scenarioId: 'scenario-1',
            scenarioName: 'Ambiguous arrival',
            exportedAt: '2026-08-27T13:00:00Z',
            pinnedSchedules: [pinned('10', [masterTrip('ambiguous', {
                recoveryTimes: undefined,
                stopMinutes: undefined,
                endTimeIncludesRecovery: undefined,
            })])],
        });

        expect(input.trips[0]).toMatchObject({ arrivalTime: null, arrivalResolution: 'unresolved' });
        expect(input.blockAudits[0].findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'integrity', code: 'arrival-time-unresolved' }),
        ]));
    });

    it('groups exact GTFS block continuity across 8A and 8B without colliding generic route blocks', () => {
        const shared = { gtfsBlockId: 'gtfs-77', endTimeIncludesRecovery: false };
        const input = buildOperationsPlanningInput({
            scenarioId: 'scenario-gtfs',
            scenarioName: 'Interline audit',
            exportedAt: '2026-08-27T13:00:00Z',
            pinnedSchedules: [
                pinned('8A', [masterTrip('8a-trip', { ...shared, startTime: 1200, endTime: 1260 })]),
                pinned('8B', [masterTrip('8b-trip', { ...shared, startTime: 1270, endTime: 1330 })]),
                pinned('10', [masterTrip('generic', { blockId: '1', endTimeIncludesRecovery: false })]),
            ],
        });

        const gtfsAudit = input.blockAudits.find(audit => audit.vehicleBlockKey === 'gtfs:team-1:Weekday:gtfs-77');
        expect(gtfsAudit?.routeIdentities).toEqual(['8A-Weekday', '8B-Weekday']);
        expect(gtfsAudit?.tripIds).toHaveLength(2);
        expect(input.blockAudits.some(audit => audit.vehicleBlockKey === 'master:10-Weekday@v3:1')).toBe(true);
    });
});

describe('proposal assessment and metrics', () => {
    it('recomputes metrics and treats Codex-authored findings as advisory', () => {
        const { input, proposal } = assessmentFixture();
        const assessment = assessOperationsPlanningProposal(input, proposal);

        expect(assessment.dailyRunMetrics[0]).toMatchObject({ platformMinutes: 450, paidMinutes: 512 });
        expect(assessment.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'informational', code: 'codex-advisory:codex-opinion' }),
            expect.objectContaining({ code: 'batt-park-out-not-evaluated' }),
            expect.objectContaining({ category: 'best-practice', code: 'daily-straight-run-guide-exceeded' }),
            expect.objectContaining({ category: 'informational', code: 'fixed-crew-utilization' }),
        ]));
        expect(assessment.approvalReady).toBe(true);
    });

    it('blocks approval on an app-computed contractual violation', () => {
        const { input, proposal } = assessmentFixture();
        input.trips[0] = { ...input.trips[0], travelTime: 451, arrivalTime: 811, occupiedEndTime: 811 };
        const assessment = assessOperationsPlanningProposal(input, proposal);

        expect(assessment.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'contractual', code: 'straight-driving-exceeded' }),
        ]));
        expect(assessment.approvalReady).toBe(false);
    });

    it('adds paid split shuttle activity and leaves the remaining gap unpaid', () => {
        const { input } = assessmentFixture();
        const first = planningTrip({ id: 'first', startTime: 360, arrivalTime: 480, occupiedEndTime: 480, travelTime: 120 });
        const second = planningTrip({ id: 'second', sourceTripId: 't2', startTime: 600, arrivalTime: 720, occupiedEndTime: 720, travelTime: 120 });
        input.trips = [first, second];
        const metrics = calculateDailyRunMetrics(input, {
            id: 'split', runNumber: 'W-002', dayType: 'Weekday', pieces: [
                { id: 'a', blockId: first.vehicleBlockKey, routeNumber: '10', tripIds: ['first'], startReliefPoint: 'Park Place', endReliefPoint: 'Park Place' },
                { id: 'b', blockId: second.vehicleBlockKey, routeNumber: '10', tripIds: ['second'], startReliefPoint: 'Park Place', endReliefPoint: 'Park Place' },
            ],
        });

        expect(metrics.isSplit).toBe(true);
        expect(metrics.activities.filter(item => item.type === 'shuttle')).toHaveLength(2);
        expect(metrics.unpaidBreakMinutes).toBe(108);
        expect(metrics.paidMinutes).toBe(284);
    });

    it('rejects oversized nested proposal arrays before assessment work', () => {
        const { proposal } = assessmentFixture();
        proposal.methodNotes = Array.from({ length: PROPOSAL_IMPORT_LIMITS.methodNotes + 1 }, () => 'note');
        expect(() => parseOperationsPlanningProposal(proposal)).toThrow(/methodNotes.*maximum/i);
    });

    it('blocks non-anonymous crew labels and requires explicit work or Off for every day', () => {
        const { input, proposal } = assessmentFixture();
        proposal.weeklyRosters[0].crewNumber = 'Jane Smith';
        proposal.weeklyRosters[0].assignments = proposal.weeklyRosters[0].assignments.filter(item => item.day !== 'Sunday');

        const assessment = assessOperationsPlanningProposal(input, proposal);
        expect(assessment.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'integrity', code: 'crew-number-not-anonymous' }),
            expect.objectContaining({ category: 'integrity', code: 'roster-day-missing' }),
        ]));
        expect(assessment.approvalReady).toBe(false);
    });

    it('builds a review workbook and neutralizes formula-like proposal text', () => {
        const { input, proposal } = assessmentFixture();
        proposal.dailyRuns[0].notes = '=HYPERLINK("https://invalid.example")';
        const workbook = createOperationsPlanningWorkbook(input, assessOperationsPlanningProposal(input, proposal));

        expect(workbook.SheetNames).toEqual(expect.arrayContaining([
            'Summary', 'Sources', 'Block Audit', 'Daily Runs', 'Run Pieces',
            'Duty Activities', 'Weekly Rosters', 'Findings', 'Rules',
        ]));
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Daily Runs']);
        expect(rows[0].Notes).toBe("'=HYPERLINK(\"https://invalid.example\")");
    });
});

describe('planner edit helpers', () => {
    it('splits only at a resolved recognized relief endpoint without mutating the source proposal', () => {
        const { input, proposal } = assessmentFixture();
        const second = planningTrip({
            id: 'trip-2', sourceTripId: 't2', tripNumber: 2, startTime: 900, arrivalTime: 960, occupiedEndTime: 960, travelTime: 60,
        });
        input.trips.push(second);
        proposal.dailyRuns[0].pieces[0].tripIds.push(second.id);

        const edited = splitDailyRun(input, proposal, 'weekday-run-1', input.trips[0].id, { id: 'weekday-run-2', runNumber: 'W-002' });

        expect(edited.dailyRuns.map(run => run.pieces.flatMap(piece => piece.tripIds))).toEqual([[input.trips[0].id], [second.id]]);
        expect(proposal.dailyRuns).toHaveLength(1);
    });
});
