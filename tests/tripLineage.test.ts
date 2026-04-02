import { describe, expect, it } from 'vitest';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import {
    buildLegacyTripLineageId,
    createTripLineageId,
    normalizeScheduleBaselinesForLineage,
} from '../utils/schedule/tripLineage';

const buildTable = (
    routeName: string,
    tripIds: string[]
): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: {},
    trips: tripIds.map((tripId, index) => ({
        id: tripId,
        blockId: '10-1',
        direction: routeName.includes('South') ? 'South' : 'North',
        tripNumber: index + 1,
        rowId: index + 1,
        startTime: 360 + (index * 30),
        endTime: 390 + (index * 30),
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: { Terminal: '6:00 AM' },
        arrivalTimes: { Terminal: '6:00 AM' },
        recoveryTimes: {},
    })),
});

describe('trip lineage helpers', () => {
    it('creates unique lineage ids for new editable trips', () => {
        expect(createTripLineageId()).not.toBe(createTripLineageId());
    });

    it('normalizes generated and original schedule baselines with matching legacy lineage ids', () => {
        const generated = [buildTable('10 (Weekday) (North)', ['n-1', 'n-2'])];
        const original = [buildTable('10 (Weekday) (North)', ['n-1', 'n-2'])];

        const normalized = normalizeScheduleBaselinesForLineage(generated, original);

        expect(normalized.generatedSchedules[0].trips[0].lineageId).toBe(
            buildLegacyTripLineageId('10 (Weekday) (North)', 'n-1')
        );
        expect(normalized.generatedSchedules[0].trips[1].lineageId).toBe(
            normalized.originalGeneratedSchedules[0].trips[1].lineageId
        );
    });
});
