import { describe, expect, it } from 'vitest';
import { calculatePieceTransition, resolvePieceBoardingTime } from '../utils/run-cutting/dutyTransitions';
import { calculateDailyRunMetrics } from '../utils/run-cutting/metrics';
import { createDefaultBarrieRuleProfile } from '../utils/run-cutting/rules';
import { assessOperationsPlanningProposal } from '../utils/run-cutting/validation';
import type { DailyRun, OperationsPlanningInputV1, OperationsPlanningProposalV1, PlanningTrip, RunPiece, VehicleBlockAudit } from '../utils/run-cutting/types';

const trip = (id: string, startTime: number, arrivalTime: number, overrides: Partial<PlanningTrip> = {}): PlanningTrip => ({
    id, sourceTripId: id, routeIdentity: '10-Weekday', sourceVersion: 1, routeNumber: '10', dayType: 'Weekday',
    vehicleBlockKey: id, blockId: id, direction: 'North', tripNumber: 1, startTime, arrivalTime,
    occupiedEndTime: arrivalTime, travelTime: arrivalTime - startTime, recoveryTime: 0,
    startStop: 'Park Place', endStop: 'Park Place', arrivalResolution: 'explicit-arrival', ...overrides,
});
const piece = (...trips: PlanningTrip[]): RunPiece => ({
    id: `piece-${trips[0].id}`, blockId: trips[0].vehicleBlockKey, routeNumber: trips[0].routeNumber,
    tripIds: trips.map(item => item.id), startReliefPoint: trips[0].startStop, endReliefPoint: trips.at(-1)!.endStop,
});
const fixture = (trips: PlanningTrip[], pieces: RunPiece[]) => {
    const input: OperationsPlanningInputV1 = {
        schemaVersion: 1, kind: 'operations-planning-input', scenarioId: 'duty', scenarioName: 'Duty transitions',
        exportedAt: '2026-09-21T12:00:00Z', sourceManifest: { items: [], fingerprint: 'duty' },
        ruleProfile: createDefaultBarrieRuleProfile(), operationsMatrix: { entries: [] }, trips,
        blockAudits: [...new Set(trips.map(item => item.vehicleBlockKey))].map((key): VehicleBlockAudit => {
            const source = trips.filter(item => item.vehicleBlockKey === key).sort((a, b) => a.startTime - b.startTime);
            return {
                id: key, vehicleBlockKey: key, blockId: key, routeIdentity: source[0].routeIdentity,
                routeIdentities: [source[0].routeIdentity], sourceBlockIds: [key], sourceVersion: 1, dayType: 'Weekday' as const,
                tripIds: source.map(item => item.id), membershipFingerprint: key, firstDeparture: source[0].startTime,
                finalArrival: source.at(-1)!.arrivalTime, findings: [],
            };
        }),
    };
    const run: DailyRun = { id: 'run', runNumber: 'W-001', dayType: 'Weekday', pieces };
    const proposal: OperationsPlanningProposalV1 = {
        schemaVersion: 1, kind: 'operations-planning-proposal', scenarioId: 'duty', sourceManifestFingerprint: 'duty',
        codex: { generatedAt: input.exportedAt }, blockAudits: input.blockAudits, dailyRuns: [run], weeklyRosters: [], findings: [], methodNotes: [],
    };
    const tripById = new Map(trips.map(item => [item.id, item]));
    return { input, run, proposal, tripById };
};

describe('source-derived relief and transfer activities', () => {
    it('reproduces the weekday paddle meal, transfer and boarding interval', () => {
        const first = trip('first', 900, 1027, { endStop: 'B.A.T.T.' });
        const continuing = trip('continuing', 1032, 1092, { vehicleBlockKey: first.vehicleBlockKey, startStop: 'B.A.T.T.' });
        const arriving = trip('arriving', 1050, 1085, { vehicleBlockKey: 'next-block', endStop: 'Downtown Hub' });
        const next = trip('next', 1090, 1150, { vehicleBlockKey: 'next-block', startStop: 'Downtown Hub' });
        const { input, run, tripById } = fixture([first, continuing, arriving, next], [piece(first), piece(next)]);
        expect(resolvePieceBoardingTime(input, run.pieces[1], tripById)).toBe(1085);
        expect(calculatePieceTransition(input, run.pieces[0], run.pieces[1], tripById)).toMatchObject({
            startTime: 1027, boardingTime: 1085, departureTime: 1090, availableBreakMinutes: 47,
            breakStartTime: 1027, breakEndTime: 1074, travelAfterBreak: 11, qualifyingBreakMinutes: 47,
        });
        const metrics = calculateDailyRunMetrics(input, run);
        expect(metrics.unpaidBreakMinutes).toBe(47);
        expect(metrics.activities).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'break', startTime: 1027, endTime: 1074, paid: false }),
            expect.objectContaining({ type: 'shuttle', startTime: 1074, endTime: 1085, paid: true }),
            expect.objectContaining({ type: 'paid-gap', startTime: 1085, endTime: 1090, paid: true }),
        ]));
    });

    it('blocks unresolved incoming source arrival instead of treating departure as confirmed boarding', () => {
        const previous = trip('previous', 400, 460, { vehicleBlockKey: 'shared', arrivalTime: null });
        const next = trip('next', 465, 525, { vehicleBlockKey: 'shared' });
        const { input, run, proposal, tripById } = fixture([previous, next], [piece(next)]);
        expect(resolvePieceBoardingTime(input, run.pieces[0], tripById)).toBeNull();
        expect(assessOperationsPlanningProposal(input, proposal).findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'piece-boarding-arrival-unresolved', category: 'integrity' }),
        ]));
    });

    it('does not invent a same-route transfer between different locations', () => {
        const first = trip('first', 400, 460, { endStop: 'Park Place' });
        const next = trip('next', 520, 580, { startStop: 'B.A.T.T.' });
        const continuing = trip('continuing', 465, 525, { vehicleBlockKey: first.vehicleBlockKey });
        const arriving = trip('arriving', 450, 520, { vehicleBlockKey: next.vehicleBlockKey, endStop: 'B.A.T.T.' });
        const { input, run, proposal, tripById } = fixture([first, continuing, arriving, next], [piece(first), piece(next)]);
        expect(calculatePieceTransition(input, run.pieces[0], run.pieces[1], tripById)).toMatchObject({ travelResolved: false, qualifyingBreakMinutes: 0 });
        expect(assessOperationsPlanningProposal(input, proposal).findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'integrity', code: 'piece-transfer-time-missing' }),
        ]));
    });

    it('does not grant a qualifying meal at Downtown, which is relief-only', () => {
        const first = trip('first', 400, 460, { endStop: 'Downtown Hub' });
        const next = trip('next', 520, 580, { startStop: 'Downtown Hub' });
        const continuing = trip('continuing', 465, 525, { vehicleBlockKey: first.vehicleBlockKey, startStop: 'Downtown Hub' });
        const arriving = trip('arriving', 450, 520, { vehicleBlockKey: next.vehicleBlockKey, endStop: 'Downtown Hub' });
        const { input, run, proposal, tripById } = fixture([first, continuing, arriving, next], [piece(first), piece(next)]);
        expect(calculatePieceTransition(input, run.pieces[0], run.pieces[1], tripById)).toMatchObject({ breakLocationAllowed: false, qualifyingBreakMinutes: 0 });
        expect(assessOperationsPlanningProposal(input, proposal).findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'contractual', code: 'break-location-not-allowed' }),
        ]));
    });
});

describe('driving and continuous-work accounting', () => {
    it.each([
        { gap: 89, isSplit: false, usable: 62 },
        { gap: 90, isSplit: true, usable: 63 },
    ])('classifies a $gap-minute whole gap before deducting travel and checks', ({ gap, isSplit, usable }) => {
        const first = trip('first', 420, 600);
        const next = trip('next', 600 + gap, 780 + gap);
        const { input, run, tripById } = fixture([first, next], [piece(first), piece(next)]);
        expect(calculatePieceTransition(input, run.pieces[0], run.pieces[1], tripById)).toMatchObject({
            gapMinutes: gap, isSplit, availableBreakMinutes: usable,
            travelBeforeBreak: 6, travelAfterBreak: 6,
        });
        expect(calculateDailyRunMetrics(input, run).isSplit).toBe(isSplit);
    });

    it.each([
        { gap: 69, expectedViolation: false }, // 42 usable minutes: qualifying meal.
        { gap: 56, expectedViolation: true }, // 29 usable minutes: no reset.
    ])('uses the physical meal, not total non-split driving, for the cap (gap $gap)', ({ gap, expectedViolation }) => {
        const first = trip('first', 360, 600);
        const next = trip('next', 600 + gap, 840 + gap);
        const { input, run, proposal } = fixture([first, next], [piece(first), piece(next)]);
        const metrics = calculateDailyRunMetrics(input, run);
        expect(metrics.isSplit).toBe(false);
        expect(metrics.platformMinutes).toBe(504);
        expect(assessOperationsPlanningProposal(input, proposal).findings.some(item => item.code === 'straight-driving-exceeded')).toBe(expectedViolation);
    });

    it('does not let a later meal excuse an excessive uninterrupted driving stretch', () => {
        const first = trip('first', 360, 810);
        const next = trip('next', 879, 909);
        const { input, proposal } = fixture([first, next], [piece(first), piece(next)]);
        expect(assessOperationsPlanningProposal(input, proposal).findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'straight-driving-exceeded', category: 'contractual' }),
        ]));
    });

    it('deducts bus return, checks and pull-out from a 42-minute gap between whole blocks', () => {
        const first = trip('first', 420, 600);
        const next = trip('next', 642, 822);
        const { input, run, tripById } = fixture([first, next], [piece(first), piece(next)]);
        expect(calculatePieceTransition(input, run.pieces[0], run.pieces[1], tripById)).toMatchObject({
            gapMinutes: 42, travelBeforeBreak: 6, travelAfterBreak: 6,
            postTripMinutes: 5, circleCheckMinutes: 10,
            availableBreakMinutes: 15, qualifyingBreakMinutes: 0,
        });
        const metrics = calculateDailyRunMetrics(input, run);
        expect(metrics.platformMinutes).toBe(384);
        expect(metrics.longestContinuousPlatformMinutes).toBe(384);
        expect(metrics.activities.filter(item => item.type === 'deadhead')).toHaveLength(4);
        expect(metrics.activities.filter(item => item.type === 'circle-check')).toHaveLength(2);
        expect(metrics.activities.filter(item => item.type === 'post-trip')).toHaveLength(2);
    });

    it('keeps a long source-block recovery paid without resetting driving', () => {
        const first = trip('first', 400, 580, { vehicleBlockKey: 'shared' });
        const next = trip('next', 640, 760, { vehicleBlockKey: 'shared' });
        const { input, run } = fixture([first, next], [piece(first, next)]);
        const metrics = calculateDailyRunMetrics(input, run);
        expect(metrics.longestContinuousPlatformMinutes).toBe(312);
        expect(metrics.unpaidBreakMinutes).toBe(0);
        expect(metrics.activities).toContainEqual(expect.objectContaining({ type: 'paid-gap', startTime: 580, endTime: 640, paid: true }));
    });

    it('counts bus deadhead as driving but excludes internal relief shuttle and bus checks', () => {
        const first = trip('first', 400, 460, { vehicleBlockKey: 'shared' });
        const middle = trip('middle', 465, 525, { vehicleBlockKey: 'shared' });
        const last = trip('last', 530, 590, { vehicleBlockKey: 'shared' });
        const full = fixture([first, middle, last], [piece(first, middle, last)]);
        const relief = fixture([first, middle, last], [piece(middle)]);
        expect(calculateDailyRunMetrics(full.input, full.run).platformMinutes).toBe(192);
        const metrics = calculateDailyRunMetrics(relief.input, relief.run);
        expect(metrics.platformMinutes).toBe(60);
        expect(metrics.reportTime).toBe(449);
        expect(metrics.activities.filter(item => item.type === 'shuttle')).toHaveLength(2);
        expect(metrics.activities.some(item => item.type === 'circle-check' || item.type === 'post-trip' || item.type === 'deadhead')).toBe(false);
    });

    it('rejects six continuous hours divided into pieces before a later split', () => {
        const first = trip('first', 360, 540, { vehicleBlockKey: 'shared' });
        const second = trip('second', 545, 725, { vehicleBlockKey: 'shared' });
        const third = trip('third', 845, 905);
        const continuing = trip('continuing', 730, 790, { vehicleBlockKey: 'shared' });
        const arriving = trip('arriving', 785, 845, { vehicleBlockKey: third.vehicleBlockKey });
        const { input, proposal } = fixture([first, second, continuing, arriving, third], [piece(first), piece(second), piece(third)]);
        expect(assessOperationsPlanningProposal(input, proposal).findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'split-continuous-driving-exceeded', category: 'contractual' }),
        ]));
    });
});
