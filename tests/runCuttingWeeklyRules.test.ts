import { describe, expect, it } from 'vitest';
import { calculateWeeklyRosterMetrics } from '../utils/run-cutting/metrics';
import { assessOperationsPlanningProposal } from '../utils/run-cutting/validation';
import { createDefaultBarrieRuleProfile } from '../utils/run-cutting/rules';
import type { OperationsPlanningInputV1, OperationsPlanningProposalV1, PlanningTrip, RosterDay, VehicleBlockAudit } from '../utils/run-cutting/types';

const days: RosterDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Report/off times include the default Park Place garage journeys and duties.
const fixture = (duties: Array<{ day: RosterDay; report: number; off: number }>) => {
    const trips: PlanningTrip[] = duties.map(({ day, report, off }, index) => ({
        id: `trip-${index}`, sourceTripId: `source-${index}`, routeIdentity: '10-Weekday',
        sourceVersion: 1, routeNumber: '10', dayType: day === 'Saturday' ? 'Saturday' : day === 'Sunday' ? 'Sunday' : 'Weekday',
        vehicleBlockKey: `block-${index}`, blockId: `block-${index}`, direction: 'North', tripNumber: index + 1,
        startTime: report + 21, arrivalTime: off - 11, occupiedEndTime: off - 11,
        travelTime: off - report - 32, recoveryTime: 0,
        startStop: 'Park Place', endStop: 'Park Place', arrivalResolution: 'explicit-arrival',
    }));
    const input: OperationsPlanningInputV1 = {
        schemaVersion: 1, kind: 'operations-planning-input', scenarioId: 'weekly', scenarioName: 'Weekly rules',
        exportedAt: '2026-09-21T12:00:00Z', sourceManifest: { items: [], fingerprint: 'weekly' },
        ruleProfile: createDefaultBarrieRuleProfile(), operationsMatrix: { entries: [] }, trips,
        blockAudits: trips.map((trip): VehicleBlockAudit => ({
            id: trip.vehicleBlockKey, routeIdentity: trip.routeIdentity, routeIdentities: [trip.routeIdentity], sourceVersion: 1, dayType: trip.dayType,
            vehicleBlockKey: trip.vehicleBlockKey, blockId: trip.blockId, sourceBlockIds: [trip.blockId], tripIds: [trip.id],
            membershipFingerprint: trip.id, firstDeparture: trip.startTime, finalArrival: trip.arrivalTime, findings: [],
        })),
    };
    const proposal: OperationsPlanningProposalV1 = {
        schemaVersion: 1, kind: 'operations-planning-proposal', scenarioId: 'weekly', sourceManifestFingerprint: 'weekly',
        codex: { generatedAt: '2026-09-21T12:00:00Z' }, blockAudits: input.blockAudits, findings: [], methodNotes: [],
        dailyRuns: trips.map((trip, index) => ({
            id: `run-${index}`, runNumber: String(index + 1), dayType: trip.dayType,
            pieces: [{ id: `piece-${index}`, blockId: trip.vehicleBlockKey, routeNumber: '10', tripIds: [trip.id], startReliefPoint: 'Park Place', endReliefPoint: 'Park Place' }],
        })),
        weeklyRosters: [{ id: 'crew-1', crewNumber: 'Crew 001', assignments: days.map(day => {
            const index = duties.findIndex(duty => duty.day === day);
            return { day, runId: index < 0 ? null : `run-${index}` };
        }) }],
    };
    return { input, proposal };
};

const restCount = (duties: Parameters<typeof fixture>[0]) => {
    const { input, proposal } = fixture(duties);
    return calculateWeeklyRosterMetrics(input, proposal, proposal.weeklyRosters[0]).restViolations;
};

describe('recurring weekly rest', () => {
    it('rejects a Sunday late finish followed by Monday with less than ten hours rest', () => {
        expect(restCount([{ day: 'Monday', report: 360, off: 840 }, { day: 'Sunday', report: 900, off: 1320 }])).toBe(1);
    });

    it('accepts exactly ten hours across the Sunday-to-Monday boundary', () => {
        expect(restCount([{ day: 'Monday', report: 360, off: 840 }, { day: 'Sunday', report: 840, off: 1200 }])).toBe(0);
    });

    it('preserves off days across the repeating-week boundary', () => {
        expect(restCount([{ day: 'Tuesday', report: 360, off: 840 }, { day: 'Sunday', report: 900, off: 1320 }])).toBe(0);
    });

    it('preserves off days within the week and handles a single duty or an empty week', () => {
        expect(restCount([{ day: 'Monday', report: 900, off: 1500 }, { day: 'Wednesday', report: 360, off: 840 }])).toBe(0);
        expect(restCount([{ day: 'Sunday', report: 900, off: 1500 }])).toBe(0);
        expect(restCount([])).toBe(0);
    });

    it('retains rest violations between adjacent duties within the week', () => {
        expect(restCount([{ day: 'Monday', report: 900, off: 1500 }, { day: 'Tuesday', report: 360, off: 840 }])).toBe(1);
    });
});

describe('four-day roster days off', () => {
    const offDayFindings = (worked: RosterDay[]) => {
        const { input, proposal } = fixture(worked.map(day => ({ day, report: 480, off: 960 })));
        return assessOperationsPlanningProposal(input, proposal).findings.filter(finding =>
            ['consecutive-days-off-not-met', 'four-day-total-days-off-not-met'].includes(finding.code));
    };

    it('allows a consecutive pair plus one separate day off', () => {
        expect(offDayFindings(['Wednesday', 'Thursday', 'Saturday', 'Sunday'])).toEqual([]);
    });

    it('allows the consecutive pair to cross Sunday and Monday', () => {
        expect(offDayFindings(['Tuesday', 'Wednesday', 'Friday', 'Saturday'])).toEqual([]);
    });

    it('rejects three isolated days off', () => {
        expect(offDayFindings(['Tuesday', 'Thursday', 'Saturday', 'Sunday'])).toEqual([
            expect.objectContaining({ category: 'contractual', code: 'consecutive-days-off-not-met' }),
        ]);
    });
});
