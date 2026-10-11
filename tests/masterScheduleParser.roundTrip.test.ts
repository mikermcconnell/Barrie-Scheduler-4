// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
    buildRoundTripView,
    parseMasterSchedule,
    validateRouteTable,
    type MasterRouteTable,
    type MasterTrip,
} from '../utils/parsers/masterScheduleParser';
import { parseMasterScheduleV2 } from '../utils/parsers/masterScheduleParserV2';

const makeTrip = (
    id: string,
    blockId: string,
    direction: 'North' | 'South',
    startTime: number,
): MasterTrip => ({
    id,
    blockId,
    direction,
    tripNumber: startTime,
    rowId: startTime,
    startTime,
    endTime: startTime + 20,
    recoveryTime: 0,
    travelTime: 20,
    cycleTime: 20,
    stops: { Terminal: startTime < 240 ? '12:10 AM' : '11:30 PM' },
    arrivalTimes: { Terminal: startTime < 240 ? '12:10 AM' : '11:30 PM' },
});

const makeTable = (
    direction: 'North' | 'South',
    trips: MasterTrip[],
): MasterRouteTable => ({
    routeName: `400 (Weekday) (${direction})`,
    stops: ['Terminal'],
    stopIds: { Terminal: '612' },
    trips,
});

describe('buildRoundTripView overnight pairing', () => {
    it('does not double-count terminal recovery already included in endTime', () => {
        const base = makeTrip('north', '400-1', 'North', 600);
        const markedDeparture: MasterTrip = {
            ...base,
            endTime: 630,
            recoveryTime: 10,
            recoveryTimes: { Terminal: 10 },
            stopMinutes: { Terminal: 630 },
            endTimeIncludesRecovery: true,
        };
        const explicitArrival: MasterTrip = {
            ...markedDeparture,
            endTimeIncludesRecovery: false,
        };
        const legacyDeparture: MasterTrip = {
            ...markedDeparture,
            endTimeIncludesRecovery: undefined,
            arrivalTimes: undefined,
        };
        const blockEndArrival: MasterTrip = {
            ...explicitArrival,
            isBlockEnd: true,
        };
        const cycleFor = (trip: MasterTrip) => buildRoundTripView(
            makeTable('North', [trip]),
            makeTable('South', []),
        ).rows[0].totalCycleTime;

        expect(cycleFor(markedDeparture)).toBe(30);
        expect(cycleFor(explicitArrival)).toBe(40);
        expect(cycleFor(legacyDeparture)).toBe(30);
        expect(cycleFor(blockEndArrival)).toBe(30);
    });

    it('keeps a north trip before midnight paired with its south trip after midnight', () => {
        const combined = buildRoundTripView(
            makeTable('North', [
                makeTrip('north-early', '400-1', 'North', 1320),
                makeTrip('north-late', '400-1', 'North', 1410),
            ]),
            makeTable('South', [
                makeTrip('south-early', '400-1', 'South', 1360),
                makeTrip('south-after-midnight', '400-1', 'South', 10),
            ]),
        );

        expect(combined.rows).toHaveLength(2);
        expect(combined.rows.map(row => row.trips.map(trip => trip.id))).toEqual([
            ['north-early', 'south-early'],
            ['north-late', 'south-after-midnight'],
        ]);
    });

    it('places post-midnight rows after evening rows across blocks', () => {
        const combined = buildRoundTripView(
            makeTable('North', [
                makeTrip('north-evening', '400-1', 'North', 1380),
                makeTrip('north-after-midnight', '400-2', 'North', 30),
            ]),
            makeTable('South', []),
        );

        expect(combined.rows.map(row => row.trips[0].id)).toEqual([
            'north-evening',
            'north-after-midnight',
        ]);
    });

    it('treats 3:45 AM as post-midnight service before the 4:00 AM boundary', () => {
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([
            ['', '', '', '', '', '', ''],
            ['Block', 'North Start', 'North End', 'R', 'South Start', 'South End', 'R'],
            ['', '101', '102', '', '201', '202', ''],
            ['400-1', 225 / 1440, 235 / 1440, 0, '', '', ''],
            ['', '', '', '', '', '', ''],
        ]);
        XLSX.utils.book_append_sheet(workbook, sheet, '400');
        const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

        const parsed = parseMasterSchedule(bytes, 'fixed');
        const trip = parsed.find(table => table.routeName.includes('(North)'))?.trips[0];

        expect(trip?.startTime).toBe(1665);
        expect(trip?.endTime).toBe(1675);
        expect(trip?.stopMinutes).toEqual({
            'North Start': 1665,
            'North End': 1675,
        });
    });

    it('uses the 4:00 AM service-day boundary in the V2 parser', () => {
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([
            ['Stop Name', '', 'North Start', 'North End'],
            ['Stop ID', '', '101', '102'],
            ['Weekday', '', 225 / 1440, 235 / 1440],
        ]);
        XLSX.utils.book_append_sheet(workbook, sheet, '400');
        const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

        const parsed = parseMasterScheduleV2(bytes);
        const trip = parsed.routes[0]?.sections[0]?.trips[0];

        expect(parsed.errors).toEqual([]);
        expect(trip?.startTime).toBe(1665);
        expect(trip?.endTime).toBe(1675);
        expect(trip?.timesMinutes).toEqual({
            'North Start': 1665,
            'North End': 1675,
        });
    });
});

describe('validateRouteTable block timing', () => {
    it('does not double-count recovery included in endTime or flag a block-end recovery', () => {
        const first: MasterTrip = {
            ...makeTrip('first', '100-1', 'North', 600),
            tripNumber: 1,
            endTime: 630,
            recoveryTime: 5,
            recoveryTimes: { Terminal: 5 },
            stopMinutes: { Terminal: 630 },
            endTimeIncludesRecovery: true,
            isOverlap: true,
        };
        const last: MasterTrip = {
            ...makeTrip('last', '100-1', 'North', 630),
            tripNumber: 2,
            endTime: 660,
            recoveryTime: 1,
            isTightRecovery: true,
        };

        const validated = validateRouteTable({
            ...makeTable('North', [last, first]),
            routeName: '100 (Saturday)',
        });
        const [validatedFirst, validatedLast] = [...validated.trips].sort((a, b) => a.tripNumber - b.tripNumber);

        expect(validatedFirst).toMatchObject({
            isBlockStart: true,
            isBlockEnd: false,
            isOverlap: false,
            isTightRecovery: false,
        });
        expect(validatedLast).toMatchObject({
            isBlockStart: false,
            isBlockEnd: true,
            isOverlap: false,
            isTightRecovery: false,
        });
    });
});
