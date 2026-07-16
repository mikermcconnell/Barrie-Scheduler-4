// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
    buildRoundTripView,
    parseMasterSchedule,
    type MasterRouteTable,
    type MasterTrip,
} from '../utils/parsers/masterScheduleParser';

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
});
