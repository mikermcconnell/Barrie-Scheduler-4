import { describe, expect, it } from 'vitest';
import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
    assessDraftFreshness,
    buildMasterDraftBasedOn,
    buildScheduleReview,
} from '../utils/schedule/scheduleReview';

const trip = (id: string, direction: 'North' | 'South', startTime: number, overrides: Partial<MasterTrip> = {}): MasterTrip => ({
    id,
    lineageId: id,
    blockId: '1',
    direction,
    tripNumber: 1,
    rowId: startTime,
    startTime,
    endTime: startTime + 30,
    recoveryTime: 5,
    travelTime: 30,
    cycleTime: 35,
    stops: { Terminal: '6:00 AM' },
    ...overrides,
});

const table = (direction: 'North' | 'South', trips: MasterTrip[]): MasterRouteTable => ({
    routeName: `2 (Weekday) (${direction})`,
    stops: ['Terminal'],
    stopIds: { Terminal: '1' },
    trips,
});

const content = (north: MasterTrip[], south: MasterTrip[]): MasterScheduleContent => ({
    northTable: table('North', north),
    southTable: table('South', south),
    metadata: { routeNumber: '2', dayType: 'Weekday', uploadedAt: '2026-01-01T00:00:00Z' },
});

describe('buildScheduleReview', () => {
    it('returns deterministic trip changes and counts', () => {
        const baseline = content(
            [trip('kept', 'North', 360), trip('removed', 'North', 420)],
            [],
        );
        const current = content(
            [trip('kept', 'North', 365), trip('added', 'North', 480)],
            [],
        );

        const first = buildScheduleReview(current, baseline);
        const second = buildScheduleReview(current, baseline);

        expect(first.changes.map(change => change.kind)).toEqual(['retimed', 'removed', 'new']);
        expect(first.changeCounts).toMatchObject({ retimed: 1, new: 1, removed: 1, totalChanges: 3 });
        expect(second).toEqual(first);
    });

    it('reports a block reassignment independently from timing changes', () => {
        const baseline = content([trip('kept', 'North', 360, { blockId: '1' })], []);
        const current = content([trip('kept', 'North', 365, { blockId: '2' })], []);

        const review = buildScheduleReview(current, baseline);
        expect(review.blockChangedCount).toBe(1);
        expect(review.changes.map(change => change.kind)).toEqual(['block-changed', 'retimed']);
    });

    it('detects cross-direction block overlaps and operational recovery issues', () => {
        const current = content(
            [trip('north', 'North', 360, { endTime: 400, recoveryTime: 1 })],
            [trip('south', 'South', 390, { blockId: '1', recoveryTime: 12 })],
        );

        const review = buildScheduleReview(current);

        expect(review.issues.map(issue => issue.kind)).toEqual(expect.arrayContaining([
            'block-overlap',
            'tight-recovery',
            'excess-recovery',
        ]));
        expect(review.issueCounts.error).toBeGreaterThanOrEqual(1);
        expect(review.publishReady).toBe(false);
    });

    it('blocks publishing when trip or stop timing is impossible', () => {
        const current = content([
            trip('invalid', 'North', 400, {
                endTime: 390,
                stopMinutes: { First: 400, Second: 395 },
            }),
        ], []);

        const review = buildScheduleReview(current);
        expect(review.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'invalid-timing', severity: 'error' }),
        ]));
        expect(review.publishReady).toBe(false);
    });

    it('flags material headway and cycle deviations without changing locked calculations', () => {
        const current = content([
            trip('n1', 'North', 360, { blockId: '1', cycleTime: 35 }),
            trip('n2', 'North', 390, { blockId: '2', cycleTime: 35 }),
            trip('n3', 'North', 420, { blockId: '3', cycleTime: 35 }),
            trip('n4', 'North', 450, { blockId: '4', cycleTime: 35 }),
            trip('n5', 'North', 520, { blockId: '5', cycleTime: 70 }),
        ], []);

        const review = buildScheduleReview(current);
        expect(review.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'headway-variation', severity: 'warning', location: expect.objectContaining({ tripId: 'n5' }) }),
            expect.objectContaining({ kind: 'cycle-deviation', severity: 'warning', location: expect.objectContaining({ tripId: 'n5' }) }),
        ]));
        expect(review.publishReady).toBe(true);
    });
});

describe('master-derived draft freshness', () => {
    const entry: MasterScheduleEntry = {
        id: '2-Weekday', routeNumber: '2', dayType: 'Weekday', currentVersion: 4,
        storagePath: 'master.json', tripCount: 2, northStopCount: 1, southStopCount: 1,
        updatedAt: new Date('2026-01-02T00:00:00Z'), updatedBy: 'u1', uploaderName: 'Planner', source: 'draft',
    };

    it('builds source metadata and reports stale versions', () => {
        const basedOn = buildMasterDraftBasedOn(entry, { sourceTeamId: 'team-1', sourceLabel: 'Published Master' });
        expect(basedOn).toMatchObject({ type: 'master', id: '2-Weekday', sourceVersion: 4, sourceTeamId: 'team-1' });

        expect(assessDraftFreshness({ basedOn }, { id: entry.id, currentVersion: 5 })).toEqual({
            status: 'stale', routeIdentity: '2-Weekday', sourceVersion: 4, currentVersion: 5,
        });
    });

    it('keeps old drafts compatible when source version is absent', () => {
        expect(assessDraftFreshness(
            { basedOn: { type: 'master', id: '2-Weekday' } },
            { id: '2-Weekday', currentVersion: 5 },
        )).toEqual({ status: 'unknown', routeIdentity: '2-Weekday', reason: 'source-version-missing' });
    });

    it('rejects impossible future source versions as unverifiable', () => {
        expect(assessDraftFreshness(
            { basedOn: { type: 'master', id: '2-Weekday', sourceVersion: 6 } },
            { id: '2-Weekday', currentVersion: 5 },
        )).toEqual({ status: 'unknown', routeIdentity: '2-Weekday', reason: 'source-version-ahead' });
    });
});
