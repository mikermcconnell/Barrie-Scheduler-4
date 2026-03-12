import { describe, expect, it } from 'vitest';
import { matchSegmentStopsInTrip, tripsPerHourToHeadway } from '../utils/gtfs/corridorHeadway';

describe('corridorHeadway helpers', () => {
    it('matches trips that follow the segment stop order', () => {
        const match = matchSegmentStopsInTrip(
            ['A', 'B', 'C'],
            ['X', 'A', 'B', 'C', 'D'],
        );

        expect(match).toEqual({ startIndex: 1, endIndex: 3 });
    });

    it('rejects trips that traverse the same stops in the opposite order', () => {
        const match = matchSegmentStopsInTrip(
            ['A', 'B', 'C'],
            ['X', 'C', 'B', 'A', 'D'],
        );

        expect(match).toBeNull();
    });

    it('converts trips per hour into rounded headways', () => {
        expect(tripsPerHourToHeadway(4)).toBe(15);
        expect(tripsPerHourToHeadway(0)).toBeNull();
    });
});
