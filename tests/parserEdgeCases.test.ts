// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseMasterScheduleV2, type ParseResult, type ParsedSection } from '../utils/parsers/masterScheduleParserV2';
import { adaptV2ToV1, smartSortTrips } from '../utils/parsers/parserAdapter';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';

const workbookToArrayBuffer = (sheets: Record<string, any[][]>): ArrayBuffer => {
    const workbook = XLSX.utils.book_new();

    for (const [sheetName, rows] of Object.entries(sheets)) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
    }

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const createSection = (overrides: Partial<ParsedSection> = {}): ParsedSection => ({
    dayType: 'Weekday',
    stops: [
        { name: 'Terminal', id: '100', columnIndex: 2, isRecovery: false },
        { name: 'Mid', id: '101', columnIndex: 3, isRecovery: false },
    ],
    trips: [],
    ...overrides,
});

const createSortTrip = (id: string, startTime: number, stops: Record<string, string>, stopMinutes: Record<string, number>): MasterTrip => ({
    id,
    blockId: 'Unassigned',
    direction: 'North',
    tripNumber: 0,
    rowId: 0,
    startTime,
    endTime: startTime + 10,
    recoveryTime: 0,
    recoveryTimes: {},
    travelTime: 10,
    cycleTime: 10,
    stops,
    stopMinutes,
});

describe('parser and overnight edge cases', () => {
    it('relabels duplicate day sections to Weekday then Saturday when stop sequences match', () => {
        const workbook = workbookToArrayBuffer({
            '22': [
                ['Stop Name', '', 'Terminal', 'Mid'],
                ['Stop ID', '', '100', '101'],
                ['Weekday'],
                ['1', 'AM Peak', '6:00 AM', '6:12 AM'],
                [],
                ['Stop Name', '', 'Terminal', 'Mid'],
                ['Stop ID', '', '100', '101'],
                ['Weekday'],
                ['2', 'Midday', '7:00 AM', '7:12 AM'],
            ],
        });

        const parsed = parseMasterScheduleV2(workbook);

        expect(parsed.errors).toEqual([]);
        expect(parsed.routes).toHaveLength(1);
        expect(parsed.routes[0].sections).toHaveLength(2);
        expect(parsed.routes[0].sections.map((section) => section.dayType)).toEqual(['Weekday', 'Saturday']);
    });

    it('promotes pure after-midnight HH:MM rows into the next service day', () => {
        const workbook = workbookToArrayBuffer({
            '31': [
                ['Stop Name', '', 'Terminal', 'Downtown'],
                ['Stop ID', '', '100', '101'],
                ['Weekday'],
                ['1', 'Night', '0:23', '0:31'],
            ],
        });

        const parsed = parseMasterScheduleV2(workbook);
        const trip = parsed.routes[0]?.sections[0]?.trips[0];

        expect(parsed.errors).toEqual([]);
        expect(trip).toBeDefined();
        expect(trip?.startTime).toBe(1463);
        expect(trip?.endTime).toBe(1471);
        expect(trip?.timesMinutes).toMatchObject({
            Terminal: 1463,
            Downtown: 1471,
        });
        expect(trip?.times).toMatchObject({
            Terminal: '12:23 AM',
            Downtown: '12:31 AM',
        });
    });

    it('keeps only the stronger section when same-day ghost sections have disjoint stops', () => {
        const parseResult: ParseResult = {
            routes: [{
                routeName: '51',
                sections: [
                    createSection({
                        dayType: 'Weekday',
                        stops: [
                            { name: 'Ghost A', id: '900', columnIndex: 2, isRecovery: false },
                            { name: 'Ghost B', id: '901', columnIndex: 3, isRecovery: false },
                        ],
                        trips: [{
                            rowIndex: 1,
                            dayType: 'Weekday',
                            timeBand: 'Ghost',
                            times: { 'Ghost A': '6:00 AM', 'Ghost B': '6:10 AM' },
                            timesMinutes: { 'Ghost A': 360, 'Ghost B': 370 },
                            recoveryTimes: {},
                            startTime: 360,
                            endTime: 370,
                            travelTime: 10,
                            direction: null,
                        }],
                    }),
                    createSection({
                        dayType: 'Weekday',
                        stops: [
                            { name: 'Main Terminal', id: '100', columnIndex: 2, isRecovery: false },
                            { name: 'Cedar', id: '101', columnIndex: 3, isRecovery: false },
                            { name: 'College', id: '102', columnIndex: 4, isRecovery: false },
                        ],
                        trips: [
                            {
                                rowIndex: 2,
                                dayType: 'Weekday',
                                timeBand: 'AM Peak',
                                times: { 'Main Terminal': '6:30 AM', Cedar: '6:42 AM', College: '6:55 AM' },
                                timesMinutes: { 'Main Terminal': 390, Cedar: 402, College: 415 },
                                recoveryTimes: {},
                                startTime: 390,
                                endTime: 415,
                                travelTime: 25,
                                direction: null,
                            },
                            {
                                rowIndex: 3,
                                dayType: 'Weekday',
                                timeBand: 'AM Peak',
                                times: { 'Main Terminal': '7:00 AM', Cedar: '7:12 AM', College: '7:25 AM' },
                                timesMinutes: { 'Main Terminal': 420, Cedar: 432, College: 445 },
                                recoveryTimes: {},
                                startTime: 420,
                                endTime: 445,
                                travelTime: 25,
                                direction: null,
                            },
                        ],
                    }),
                ],
            }],
            errors: [],
            warnings: [],
        };

        const tables = adaptV2ToV1(parseResult);

        expect(tables).toHaveLength(1);
        expect(tables[0].routeName).toBe('51 (Weekday)');
        expect(tables[0].stops).toEqual(['Main Terminal', 'Cedar', 'College']);
        expect(tables[0].trips).toHaveLength(2);
    });

    it('infers ARR/DEP recovery across midnight when paired terminal stops have no explicit recovery column', () => {
        const parseResult: ParseResult = {
            routes: [{
                routeName: '12',
                sections: [
                    createSection({
                        dayType: 'Weekday',
                        stops: [
                            { name: 'Terminal', id: '441', columnIndex: 2, isRecovery: false },
                            { name: 'Terminal (2)', id: '441', columnIndex: 3, isRecovery: false },
                            { name: 'Downtown', id: '500', columnIndex: 4, isRecovery: false },
                        ],
                        trips: [{
                            rowIndex: 7,
                            dayType: 'Weekday',
                            timeBand: 'Night',
                            times: {
                                Terminal: '11:58 PM',
                                'Terminal (2)': '12:07 AM',
                                Downtown: '12:20 AM',
                            },
                            timesMinutes: {
                                Terminal: 1438,
                                'Terminal (2)': 1447,
                                Downtown: 1460,
                            },
                            recoveryTimes: {},
                            startTime: 1438,
                            endTime: 1460,
                            travelTime: 22,
                            direction: null,
                        }],
                    }),
                ],
            }],
            errors: [],
            warnings: [],
        };

        const [table] = adaptV2ToV1(parseResult);
        const trip = table.trips[0];

        expect(trip.recoveryTimes).toEqual({ Terminal: 9 });
        expect(trip.recoveryTime).toBe(9);
        expect(trip.cycleTime).toBe(22);
        expect(trip.travelTime).toBe(13);
    });

    it('sorts after-midnight trips after late-night trips in the same column flow', () => {
        const sorted = smartSortTrips([
            createSortTrip(
                'after-midnight',
                5,
                { Terminal: '12:05 AM', Downtown: '12:15 AM' },
                { Terminal: 5, Downtown: 15 }
            ),
            createSortTrip(
                'late-night',
                1435,
                { Terminal: '11:55 PM', Downtown: '12:05 AM' },
                { Terminal: 1435, Downtown: 1445 }
            ),
            createSortTrip(
                'later-after-midnight',
                25,
                { Terminal: '12:25 AM', Downtown: '12:35 AM' },
                { Terminal: 25, Downtown: 35 }
            ),
        ]);

        expect(sorted.map((trip) => trip.id)).toEqual([
            'late-night',
            'after-midnight',
            'later-after-midnight',
        ]);
    });
});
