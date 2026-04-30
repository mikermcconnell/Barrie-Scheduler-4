import { describe, expect, it } from 'vitest';
import {
    buildDetailedMasterComparison,
    buildMasterComparisonChangeSummary,
    classifyMatchedTripChange,
} from '../utils/schedule/masterComparison';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    endTime: number,
    overrides: Partial<MasterTrip> = {}
): MasterTrip => ({
    id,
    blockId: '10-1',
    direction,
    tripNumber: 1,
    rowId: startTime,
    startTime,
    endTime,
    recoveryTime: 0,
    travelTime: endTime - startTime,
    cycleTime: endTime - startTime,
    stops: { Terminal: '6:00 AM' },
    arrivalTimes: { Terminal: '6:00 AM' },
    recoveryTimes: {},
    ...overrides,
});

const makeTable = (routeName: string, trips: MasterTrip[]): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: { Terminal: 'STOP-1' },
    trips,
});

describe('master comparison summary', () => {
    it('classifies a matched trip with a longer service span as extended', () => {
        const currentTrip = makeTrip('draft-a', 'North', 355, 400);
        const masterTrip = makeTrip('master-a', 'North', 360, 390);

        expect(classifyMatchedTripChange(currentTrip, masterTrip)).toBe('extended');
    });

    it('builds change counts for extended, new, and removed trips', () => {
        const schedules = [
            makeTable('10 (North)', [
                makeTrip('draft-extended', 'North', 355, 400, { lineageId: 'trip-a' }),
                makeTrip('draft-new', 'North', 430, 460),
            ]),
        ];

        const masterBaseline = [
            makeTable('10 (North)', [
                makeTrip('master-a', 'North', 360, 390, { lineageId: 'trip-a' }),
                makeTrip('master-removed', 'North', 500, 530),
            ]),
        ];

        const detailed = buildDetailedMasterComparison(schedules, masterBaseline);
        const summary = buildMasterComparisonChangeSummary(schedules, detailed);

        expect(summary.counts.extended).toBe(1);
        expect(summary.counts.new).toBe(1);
        expect(summary.counts.removed).toBe(1);
        expect(summary.counts.totalChanges).toBe(3);
    });

    it('matches a recreated trip with new lineage to nearby baseline service', () => {
        const schedules = [
            makeTable('10 (North)', [
                makeTrip('draft-recreated', 'North', 431, 461, {
                    lineageId: 'trip-new',
                    stops: { Terminal: '7:11 AM' },
                    arrivalTimes: { Terminal: '7:11 AM' },
                }),
            ]),
        ];

        const masterBaseline = [
            makeTable('10 (North)', [
                makeTrip('master-existing', 'North', 430, 460, {
                    lineageId: 'trip-existing',
                    stops: { Terminal: '7:10 AM' },
                    arrivalTimes: { Terminal: '7:10 AM' },
                }),
            ]),
        ];

        const detailed = buildDetailedMasterComparison(schedules, masterBaseline);
        const summary = buildMasterComparisonChangeSummary(schedules, detailed);
        const entry = detailed.currentTripComparisons.get('North::draft-recreated');

        expect(entry?.status).toBe('matched');
        if (entry?.status !== 'matched') throw new Error('Expected a matched recreated trip');
        expect(entry.matchMethod).toBe('time-shift');
        expect(entry.masterTrip.id).toBe('master-existing');
        expect(summary.counts.new).toBe(0);
        expect(summary.counts.removed).toBe(0);
        expect(summary.counts.retimed).toBe(1);
        expect(summary.currentTripKinds.get('North::draft-recreated')).toBe('retimed');
    });

    it('keeps duplicate added service new after the original baseline trip is already matched', () => {
        const schedules = [
            makeTable('10 (North)', [
                makeTrip('draft-existing', 'North', 430, 460, {
                    lineageId: 'trip-existing',
                    stops: { Terminal: '7:10 AM' },
                    arrivalTimes: { Terminal: '7:10 AM' },
                }),
                makeTrip('draft-added', 'North', 431, 461, {
                    lineageId: 'trip-new',
                    stops: { Terminal: '7:11 AM' },
                    arrivalTimes: { Terminal: '7:11 AM' },
                }),
            ]),
        ];

        const masterBaseline = [
            makeTable('10 (North)', [
                makeTrip('master-existing', 'North', 430, 460, {
                    lineageId: 'trip-existing',
                    stops: { Terminal: '7:10 AM' },
                    arrivalTimes: { Terminal: '7:10 AM' },
                }),
            ]),
        ];

        const detailed = buildDetailedMasterComparison(schedules, masterBaseline);
        const summary = buildMasterComparisonChangeSummary(schedules, detailed);

        expect(detailed.currentTripComparisons.get('North::draft-existing')?.status).toBe('matched');
        expect(detailed.currentTripComparisons.get('North::draft-added')?.status).toBe('new');
        expect(summary.counts.new).toBe(1);
        expect(summary.counts.removed).toBe(0);
    });
});
