import { describe, it, expect } from 'vitest';
import { buildMasterContentFromTables, buildTablesFromContent } from '../utils/schedule/scheduleDraftAdapter';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { MasterScheduleContent } from '../utils/masterScheduleTypes';

const makeTable = (routeName: string, stopCount = 1): MasterRouteTable => ({
    routeName,
    stops: Array.from({ length: stopCount }, (_, i) => `Stop ${i + 1}`),
    stopIds: {},
    trips: []
});

describe('scheduleDraftAdapter', () => {
    describe('buildMasterContentFromTables', () => {
        it('builds content when route and day match', () => {
            const north = makeTable('400 (Weekday) (North)');
            const south = makeTable('400 (Weekday) (South)');

            const result = buildMasterContentFromTables([north, south]);

            expect(result).not.toBeNull();
            expect(result?.routeNumber).toBe('400');
            expect(result?.dayType).toBe('Weekday');
            expect(result?.content.northTable.routeName).toBe(north.routeName);
            expect(result?.content.southTable.routeName).toBe(south.routeName);
        });

        it('returns null for mixed routes', () => {
            const north = makeTable('400 (Weekday) (North)');
            const other = makeTable('8A (Weekday) (North)');

            expect(buildMasterContentFromTables([north, other])).toBeNull();
        });

        it('returns null for mixed day types', () => {
            const north = makeTable('400 (Weekday) (North)');
            const south = makeTable('400 (Saturday) (South)');

            expect(buildMasterContentFromTables([north, south])).toBeNull();
        });

        it('fills missing direction with an empty table', () => {
            const north = makeTable('400 (Saturday) (North)');

            const result = buildMasterContentFromTables([north]);

            expect(result).not.toBeNull();
            expect(result?.content.northTable.routeName).toBe(north.routeName);
            expect(result?.content.southTable.routeName).toBe('400 (Saturday) (South)');
            expect(result?.content.southTable.stops.length).toBe(0);
        });
    });

    describe('buildTablesFromContent', () => {
        it('returns only non-empty tables', () => {
            const northEmpty = makeTable('400 (Weekday) (North)', 0);
            const southFilled = makeTable('400 (Weekday) (South)', 1);

            const content: MasterScheduleContent = {
                northTable: northEmpty,
                southTable: southFilled,
                metadata: {
                    routeNumber: '400',
                    dayType: 'Weekday',
                    uploadedAt: '2024-01-01T00:00:00Z'
                }
            };

            const tables = buildTablesFromContent(content);

            expect(tables).toHaveLength(1);
            expect(tables[0].routeName).toBe(southFilled.routeName);
        });

        it('falls back to a table when both are empty', () => {
            const northEmpty = makeTable('400 (Weekday) (North)', 0);
            const southEmpty = makeTable('400 (Weekday) (South)', 0);

            const content: MasterScheduleContent = {
                northTable: northEmpty,
                southTable: southEmpty,
                metadata: {
                    routeNumber: '400',
                    dayType: 'Weekday',
                    uploadedAt: '2024-01-01T00:00:00Z'
                }
            };

            const tables = buildTablesFromContent(content);

            expect(tables).toHaveLength(1);
            expect(tables[0].routeName).toBe(northEmpty.routeName);
        });
    });
});
