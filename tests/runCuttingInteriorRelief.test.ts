import { describe, expect, it } from 'vitest';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';
import { assessOperationsPlanningProposal, buildOperationsPlanningInput, calculateDailyRunMetrics, mergeDailyRuns, projectOperationsPlanningInput,
    restoreOperationsPlanningProposal, type OperationsPlanningProposalV1, type PinnedMasterSchedule } from '../utils/run-cutting';

const fixture = (legacy = false, overnight = false) => {
    const offset = overnight ? 1080 : 0;
    const stops = legacy ? ['B.A.T.T.', 'Park Place', 'Park Place (3)', 'Downtown Hub'] : ['B.A.T.T.', 'Park Place', 'Downtown Hub'];
    const trip: MasterTrip = { id: 'source', direction: 'North', blockId: '1', tripNumber: 1, rowId: 1,
        startTime: 360 + offset, endTime: 430 + offset, travelTime: 60, recoveryTime: 10, cycleTime: 70,
        stops: legacy ? { 'B.A.T.T.': '6:00 AM', 'Park Place': '6:30 AM', 'Park Place (3)': '6:40 AM', 'Downtown Hub': '7:10 AM' }
            : { 'B.A.T.T.': '6:00 AM', 'Park Place': '6:30 AM', 'Downtown Hub': '7:10 AM' },
        stopMinutes: { 'B.A.T.T.': 360 + offset, 'Park Place': 390 + offset, 'Park Place (3)': 400 + offset, 'Downtown Hub': 430 + offset },
        arrivalTimes: legacy ? undefined : { 'B.A.T.T.': overnight ? '12:00 AM' : '6:00 AM', 'Park Place': overnight ? '12:30 AM' : '6:30 AM', 'Downtown Hub': overnight ? '1:10 AM' : '7:10 AM' },
        recoveryTimes: { 'Park Place': 10 }, endTimeIncludesRecovery: false, isBlockStart: true, isBlockEnd: true };
    const table = { routeName: '10', stops, stopIds: {}, trips: [trip] };
    const pin = { sourceTeamId: 'team', pinnedAt: '2026-09-21',
        entry: { id: '10-Weekday', routeNumber: '10', dayType: 'Weekday', currentVersion: 1, storagePath: 'master.json' },
        content: { northTable: table, southTable: { ...table, trips: [] }, metadata: { routeNumber: '10', dayType: 'Weekday', uploadedAt: '2026-09-21' } },
    } as PinnedMasterSchedule;
    const options = { scenarioId: 'test', scenarioName: 'test', exportedAt: '2026-09-21', pinnedSchedules: [pin] };
    const input = buildOperationsPlanningInput({ ...options, schemaVersion: 2 });
    const atomic = projectOperationsPlanningInput(input);
    const proposal: OperationsPlanningProposalV1 = { schemaVersion: 1, kind: 'operations-planning-proposal', scenarioId: input.scenarioId,
        sourceManifestFingerprint: input.sourceManifest.fingerprint, codex: { generatedAt: '2026-09-21' }, blockAudits: atomic.blockAudits,
        dailyRuns: atomic.trips.map((unit, index) => ({ id: `run${index}`, runNumber: `${index}`, dayType: 'Weekday',
            pieces: [{ id: `p${index}`, blockId: unit.vehicleBlockKey, routeNumber: unit.routeNumber, tripIds: [unit.id],
                startReliefPoint: unit.startStop, endReliefPoint: unit.endStop }] })), weeklyRosters: [], findings: [], methodNotes: [] };
    return { options, input, atomic, proposal: restoreOperationsPlanningProposal(input, proposal) };
};

describe('source-backed interior relief', () => {
    it('preserves legacy v1 trips and source fingerprints while opting into v2', () => {
        const { options, input } = fixture();
        const legacy = buildOperationsPlanningInput(options);
        expect(legacy.schemaVersion).toBe(1);
        expect(legacy.trips[0].stopEvents).toBeUndefined();
        expect(input.sourceManifest).toEqual(legacy.sourceManifest);
    });
    it('conserves source driving and assigns interior dwell to the incoming operator once', () => {
        const { input, atomic, proposal } = fixture();
        expect(atomic.trips.map(t => t.travelTime)).toEqual([30, 30]);
        expect(proposal.dailyRuns.map(run => run.pieces[0].tripIds)).toEqual([[input.trips[0].id], [input.trips[0].id]]);
        const assessment = assessOperationsPlanningProposal(input, proposal);
        expect(assessment.findings.filter(f => f.category === 'integrity' && f.code !== 'run-roster-coverage-invalid')).toEqual([]);
        expect(assessment.dailyRunMetrics[1].activities.filter(a => a.type === 'paid-gap')).toEqual([
            expect.objectContaining({ startTime: 390, endTime: 400 }),
        ]);
        expect(calculateDailyRunMetrics(input, proposal.dailyRuns[1])).toEqual(assessment.dailyRunMetrics[1]);
    });
    it('decodes explicit legacy adjacent arrival/departure columns', () => {
        const { input, atomic } = fixture(true);
        expect(input.trips[0].stopEvents?.[1]).toMatchObject({ arrivalTime: 390, departureTime: 400, arrivalResolution: 'legacy-arrival-column' });
        expect(atomic.trips.reduce((sum, t) => sum + t.travelTime, 0)).toBe(60);
    });
    it('preserves next-day event ordering', () => {
        const { atomic } = fixture(false, true);
        expect(atomic.trips.map(t => t.startTime)).toEqual([1440, 1480]);
        expect(atomic.trips.at(-1)?.arrivalTime).toBe(1510);
    });
    it('rejects event-reference tampering and v1 event smuggling', () => {
        const { input, proposal } = fixture();
        proposal.dailyRuns[0].pieces[0].endEventId = 'invented';
        expect(assessOperationsPlanningProposal(input, proposal).findings[0].code).toBe('interior-relief-invalid');
        proposal.schemaVersion = 1;
        expect(assessOperationsPlanningProposal(input, proposal).proposal).toBeNull();
    });
    it('blocks missing and overlapping source intervals', () => {
        const { input, proposal } = fixture();
        const missing = { ...proposal, dailyRuns: proposal.dailyRuns.slice(0, 1) };
        expect(assessOperationsPlanningProposal(input, missing).findings.some(f => f.code === 'trip-unassigned')).toBe(true);
        proposal.dailyRuns[1].pieces[0].startEventId = input.trips[0].stopEvents![0].id;
        proposal.dailyRuns[1].pieces[0].startReliefPoint = 'B.A.T.T.';
        expect(assessOperationsPlanningProposal(input, proposal).findings.some(f => f.code === 'trip-assigned-multiple-times')).toBe(true);
    });
    it('fails closed on unresolved events and inconsistent driving without prorating', () => {
        const { input } = fixture();
        input.trips[0].travelTime = 59;
        expect(projectOperationsPlanningInput(input).blockAudits[0].findings[0].message).toContain('no prorating');
        input.trips[0].stopEvents![1].arrivalTime = null;
        expect(projectOperationsPlanningInput(input).blockAudits[0].findings[0].message).toContain('unresolved');
    });
    it('rejects changed source block audit and mismatched version', () => {
        const { input, proposal } = fixture();
        const changed = structuredClone(proposal);
        changed.blockAudits[0].firstDeparture++;
        expect(assessOperationsPlanningProposal(input, changed).approvalReady).toBe(false);
        const v1 = buildOperationsPlanningInput(fixture().options);
        expect(assessOperationsPlanningProposal(v1, proposal).findings[0].code).toBe('schema-version-mismatch');
    });
    it('keeps unresolved source whole units visible but blocks approval and every interior cut', () => {
        const { input, proposal } = fixture();
        input.trips[0].travelTime--;
        const projected = projectOperationsPlanningInput(input);
        expect(projected.trips).toHaveLength(1);
        expect(projected.trips[0].id).toContain(':unit:whole');
        expect(assessOperationsPlanningProposal(input, proposal).approvalReady).toBe(false);
        proposal.dailyRuns = [{ ...proposal.dailyRuns[0], pieces: [{ ...proposal.dailyRuns[0].pieces[0],
            endReliefPoint: 'Downtown Hub', endEventId: input.trips[0].stopEvents!.at(-1)!.id }] }];
        const assessed = assessOperationsPlanningProposal(input, proposal);
        expect(assessed.findings.some(f => f.code === 'source-stop-events-unresolved' && f.category === 'integrity')).toBe(true);
        expect(assessed.approvalReady).toBe(false);
    });
    it('does not repair gaps while converting private units back to source references', () => {
        const { input, atomic } = fixture();
        const bad: OperationsPlanningProposalV1 = { schemaVersion: 1, kind: 'operations-planning-proposal', scenarioId: 'test',
            sourceManifestFingerprint: input.sourceManifest.fingerprint, codex: { generatedAt: '2026-09-21' },
            blockAudits: atomic.blockAudits, dailyRuns: [{ id: 'bad', runNumber: 'bad', dayType: 'Weekday', pieces: [{
                id: 'bad', blockId: atomic.trips[0].vehicleBlockKey, routeNumber: '10',
                tripIds: [atomic.trips[1].id, atomic.trips[0].id], startReliefPoint: 'Park Place', endReliefPoint: 'Park Place',
            }] }], weeklyRosters: [], findings: [], methodNotes: [] };
        expect(() => restoreOperationsPlanningProposal(input, bad)).toThrow();
    });
    it('shows source blockers on the exported input audits and does not duplicate them in projection', () => {
        const { options } = fixture();
        options.pinnedSchedules[0].content.northTable.trips[0].travelTime--;
        const input = buildOperationsPlanningInput({ ...options, schemaVersion: 2 });
        expect(input.blockAudits[0].findings.filter(f => f.code === 'source-stop-events-unresolved')).toHaveLength(1);
        expect(projectOperationsPlanningInput(input).blockAudits[0].findings.filter(f => f.code === 'source-stop-events-unresolved')).toHaveLength(1);
    });
    it('explicitly guards whole-trip merge editing for event-boundary proposals', () => {
        const { input, proposal } = fixture();
        expect(() => mergeDailyRuns(input, proposal, 'run0', 'run1')).toThrow('event-aware merge');
    });
});
