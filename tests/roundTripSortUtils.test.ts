import { describe, expect, it } from 'vitest';
import type { MasterTrip, RoundTripRow } from '../utils/parsers/masterScheduleParser';
import {
    compareRoundTripBlockFlowRows,
    getRoundTripDisplayedCycleTime,
    getRoundTripBlockFlowSortTime,
    getRoundTripDisplayedHeadways,
    getRoundTripLastDepartureTime,
    getRoundTripRowSignature,
    getRoundTripSortTimeForColumn,
    getRoundTripRowKey,
    getRoundTripStartSortTime
} from '../utils/schedule/roundTripSortUtils';
import { compareBlockIds } from '../utils/schedule/scheduleEditorUtils';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    stops: Record<string, string>,
    stopMinutes: Record<string, number> = {}
): MasterTrip => ({
    id,
    blockId: '12-1',
    direction,
    tripNumber: 1,
    rowId: 1,
    startTime,
    endTime: startTime + 30,
    recoveryTime: 0,
    travelTime: 30,
    cycleTime: 30,
    stops,
    stopMinutes,
});

const makeRow = (trips: MasterTrip[]): RoundTripRow => ({
    blockId: '12-1',
    trips,
    northStops: ['North Terminal'],
    southStops: ['South Terminal'],
    totalTravelTime: trips.reduce((sum, trip) => sum + trip.travelTime, 0),
    totalRecoveryTime: 0,
    totalCycleTime: trips.reduce((sum, trip) => sum + trip.cycleTime, 0),
    pairIndex: 0,
});

describe('getRoundTripStartSortTime', () => {
    it('uses the left-side first departure for routes where suffixes represent direction', () => {
        const northTrip = makeTrip('north-1', 'North', 420, { 'North Terminal': '07:00' });
        const southTrip = makeTrip('south-1', 'South', 510, { 'South Terminal': '08:30' });
        const row = makeRow([northTrip, southTrip]);

        const sortTime = getRoundTripStartSortTime(row, {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal'],
            southStops: ['South Terminal'],
        });

        expect(sortTime).toBe(420);
    });

    it('falls back to the opposite side when the left-side first cell is blank', () => {
        const northTrip = makeTrip('north-1', 'North', 420, {});
        const southTrip = makeTrip('south-1', 'South', 510, { 'South Terminal': '08:30' });
        const row = makeRow([northTrip, southTrip]);

        const sortTime = getRoundTripStartSortTime(row, {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal'],
            southStops: ['South Terminal'],
        });

        expect(sortTime).toBe(510);
    });

    it('keeps north-first sorting for routes where A/B is part of the route name', () => {
        const northTrip = makeTrip('north-1', 'North', 420, { Allandale: '07:00' });
        const southTrip = makeTrip('south-1', 'South', 510, { 'Park Place': '08:30' });
        const row = makeRow([northTrip, southTrip]);

        const sortTime = getRoundTripStartSortTime(row, {
            routeName: '8A (Weekday)',
            northStops: ['Allandale'],
            southStops: ['Park Place'],
        });

        expect(sortTime).toBe(420);
    });
});

describe('getRoundTripSortTimeForColumn', () => {
    it('uses operational ordering for post-midnight first departures', () => {
        const lateNightNorth = makeTrip('north-1', 'North', 1430, { 'North Terminal': '11:50 PM' }, { 'North Terminal': 1430 });
        const afterMidnightNorth = makeTrip('north-2', 'North', 5, { 'North Terminal': '12:05 AM' }, { 'North Terminal': 1445 });
        const lateNightRow = makeRow([lateNightNorth]);
        const afterMidnightRow = makeRow([afterMidnightNorth]);

        const combined = {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal'],
            southStops: ['South Terminal'],
        };

        expect(getRoundTripSortTimeForColumn(lateNightRow, combined, 'startTime')).toBe(1430);
        expect(getRoundTripSortTimeForColumn(afterMidnightRow, combined, 'startTime')).toBe(1445);
    });

    it('uses operational ordering for post-midnight stop-column values', () => {
        const lateNightNorth = makeTrip('north-1', 'North', 1430, { 'North Terminal': '11:50 PM' }, { 'North Terminal': 1430 });
        const afterMidnightNorth = makeTrip('north-2', 'North', 5, { 'North Terminal': '12:05 AM' }, { 'North Terminal': 1445 });
        const lateNightRow = makeRow([lateNightNorth]);
        const afterMidnightRow = makeRow([afterMidnightNorth]);

        const combined = {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal'],
            southStops: ['South Terminal'],
        };

        expect(getRoundTripSortTimeForColumn(lateNightRow, combined, 'north:North Terminal')).toBe(1430);
        expect(getRoundTripSortTimeForColumn(afterMidnightRow, combined, 'north:North Terminal')).toBe(1445);
    });
});

describe('getRoundTripBlockFlowSortTime', () => {
    it('uses the A-side end arrival for A/B direction routes in Block Flow', () => {
        const northTrip = makeTrip('north-1', 'North', 420, { 'North Terminal': '07:00', 'South Terminal': '07:25' });
        const southTrip = makeTrip('south-1', 'South', 509, { 'South Terminal': '08:29' });
        const row = makeRow([northTrip, southTrip]);

        const sortTime = getRoundTripBlockFlowSortTime(row, {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal', 'South Terminal'],
            southStops: ['South Terminal'],
        });

        expect(sortTime).toBe(445);
    });

    it('falls back to the B-side first departure when the A-side end arrival is blank', () => {
        const northTrip = makeTrip('north-1', 'North', 420, { 'North Terminal': '07:00' });
        const southTrip = makeTrip('south-1', 'South', 509, { 'South Terminal': '08:29' });
        const row = makeRow([northTrip, southTrip]);

        const sortTime = getRoundTripBlockFlowSortTime(row, {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal', 'South Terminal'],
            southStops: ['South Terminal'],
        });

        expect(sortTime).toBe(509);
    });

    it('keeps existing Block Flow behavior for routes like 8A', () => {
        const northTrip = makeTrip('north-1', 'North', 420, { Allandale: '07:00' });
        const southTrip = makeTrip('south-1', 'South', 510, { 'Park Place': '08:30' });
        const row = makeRow([northTrip, southTrip]);

        const sortTime = getRoundTripBlockFlowSortTime(row, {
            routeName: '8A (Weekday)',
            northStops: ['Allandale'],
            southStops: ['Park Place'],
        });

        expect(sortTime).toBeNull();
    });
});

describe('compareRoundTripBlockFlowRows', () => {
    it('orders route 12 rows by A-side end arrival, with fallback to B-side first departure when needed', () => {
        const row709 = {
            ...makeRow([makeTrip('north-709', 'North', 429, { 'North Terminal': '07:09', 'South Terminal': '07:34' })]),
            blockId: '12-4',
        };
        const row759 = {
            ...makeRow([makeTrip('north-759', 'North', 479, { 'North Terminal': '07:59', 'South Terminal': '08:24' })]),
            blockId: '12-3',
        };
        const row941Fallback = {
            ...makeRow([
                makeTrip('north-fallback', 'North', 549, {}),
                makeTrip('south-fallback', 'South', 581, { 'South Terminal': '09:41' }),
            ]),
            blockId: '12-2',
        };

        const combined = {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal', 'South Terminal'],
            southStops: ['South Terminal'],
        };

        const ordered = [row941Fallback, row759, row709].sort((a, b) =>
            compareRoundTripBlockFlowRows(a, b, combined, compareBlockIds) ?? 0
        );

        expect(ordered.map(row => row.blockId)).toEqual(['12-4', '12-3', '12-2']);
    });

    it.each(['10', '11', '100', '101'])(
        'sorts route %s Block Flow by initial departure time',
        (routeName) => {
            const loopRowEarlyInSecondBlock: RoundTripRow = {
                ...makeRow([makeTrip('loop-2-early', 'North', 390, { Loop: '06:30' })]),
                blockId: `${routeName}-2`,
                pairIndex: 0,
            };
            const loopRowFirstBlockFirstTrip: RoundTripRow = {
                ...makeRow([makeTrip('loop-1-early', 'North', 300, { Loop: '05:00' })]),
                blockId: `${routeName}-1`,
                pairIndex: 0,
            };
            const loopRowFirstBlockSecondTrip: RoundTripRow = {
                ...makeRow([makeTrip('loop-1-late', 'North', 360, { Loop: '06:00' })]),
                blockId: `${routeName}-1`,
                pairIndex: 1,
            };

            const combined = {
                routeName: `${routeName} (Weekday)`,
                northStops: ['Loop'],
                southStops: [] as string[],
            };

            const ordered = [loopRowEarlyInSecondBlock, loopRowFirstBlockSecondTrip, loopRowFirstBlockFirstTrip].sort((a, b) =>
                compareRoundTripBlockFlowRows(a, b, combined, compareBlockIds) ?? 0
            );

            expect(ordered.map(row => `${row.blockId}:${row.trips[0]?.startTime}`)).toEqual([
                `${routeName}-1:300`,
                `${routeName}-1:360`,
                `${routeName}-2:390`,
            ]);
        }
    );
});

describe('getRoundTripLastDepartureTime', () => {
    it('uses the right-side last departure cell for the displayed round-trip headway anchor', () => {
        const row = makeRow([
            makeTrip('north-1', 'North', 340, { 'North Terminal': '05:40', 'South Terminal': '06:09' }),
            makeTrip('south-1', 'South', 382, { 'South Terminal': '06:22', 'Outer Terminal': '06:39' }),
        ]);

        const anchor = getRoundTripLastDepartureTime(row, {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal', 'South Terminal'],
            southStops: ['South Terminal', 'Outer Terminal'],
        });

        expect(anchor).toBe(399);
    });
});

describe('getRoundTripDisplayedHeadways', () => {
    it('leaves the first displayed row blank and uses last departure to last departure after that', () => {
        const firstRow = {
            ...makeRow([
                makeTrip('north-first', 'North', 340, { 'North Terminal': '05:40', 'South Terminal': '06:09' }),
                makeTrip('south-first', 'South', 382, { 'South Terminal': '06:22', 'Outer Terminal': '06:39' }),
            ]),
            blockId: '12-4',
        };
        const secondRow = {
            ...makeRow([
                makeTrip('north-second', 'North', 370, { 'North Terminal': '06:10', 'South Terminal': '06:40' }),
                makeTrip('south-second', 'South', 414, { 'South Terminal': '06:54', 'Outer Terminal': '07:09' }),
            ]),
            blockId: '12-1',
        };

        const combined = {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal', 'South Terminal'],
            southStops: ['South Terminal', 'Outer Terminal'],
        };

        const headways = getRoundTripDisplayedHeadways([firstRow, secondRow], combined);

        expect(headways[getRoundTripRowKey(firstRow)]).toBeUndefined();
        expect(headways[getRoundTripRowKey(secondRow)]).toBe(30);
    });

    it('preserves late-night ordering when the next displayed trip departs after midnight', () => {
        const lateNight = {
            ...makeRow([
                makeTrip('north-late', 'North', 1400, { 'North Terminal': '11:20 PM', 'South Terminal': '11:45 PM' }),
                makeTrip('south-late', 'South', 1410, { 'South Terminal': '11:50 PM', 'Outer Terminal': '11:50 PM' }),
            ]),
            blockId: '12-8',
        };
        const afterMidnight = {
            ...makeRow([
                makeTrip('north-next', 'North', 5, { 'North Terminal': '12:05 AM', 'South Terminal': '12:15 AM' }),
                makeTrip('south-next', 'South', 10, { 'South Terminal': '12:15 AM', 'Outer Terminal': '12:15 AM' }),
            ]),
            blockId: '12-9',
        };

        const combined = {
            routeName: '12 (Weekday)',
            northStops: ['North Terminal', 'South Terminal'],
            southStops: ['South Terminal', 'Outer Terminal'],
        };

        const headways = getRoundTripDisplayedHeadways([lateNight, afterMidnight], combined);

        expect(headways[getRoundTripRowKey(afterMidnight)]).toBe(25);
    });
});

describe('getRoundTripDisplayedCycleTime', () => {
    it('uses the paired-row cycle/span value instead of travel plus recovery totals', () => {
        const row = {
            ...makeRow([
                makeTrip('north-1', 'North', 420, { 'North Terminal': '07:00' }),
                makeTrip('south-1', 'South', 510, { 'South Terminal': '08:30' }),
            ]),
            totalTravelTime: 60,
            totalRecoveryTime: 15,
            totalCycleTime: 92,
        };

        expect(getRoundTripDisplayedCycleTime(row)).toBe(92);
    });
});

describe('getRoundTripRowSignature', () => {
    it('changes when a row time changes so cached ordering can refresh', () => {
        const originalRow = makeRow([
            makeTrip('north-1', 'North', 420, { 'North Terminal': '07:00' }, { 'North Terminal': 420 }),
            makeTrip('south-1', 'South', 510, { 'South Terminal': '08:30' }, { 'South Terminal': 510 }),
        ]);
        const editedRow = makeRow([
            makeTrip('north-1', 'North', 430, { 'North Terminal': '07:10' }, { 'North Terminal': 430 }),
            makeTrip('south-1', 'South', 510, { 'South Terminal': '08:30' }, { 'South Terminal': 510 }),
        ]);

        expect(getRoundTripRowSignature(editedRow)).not.toBe(getRoundTripRowSignature(originalRow));
    });
});
