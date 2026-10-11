import { describe, expect, it } from 'vitest';

import type { TodDailyKpiDataset } from '../utils/todPickupTypes';
import {
    aggregateClassifiedTodLocations,
    buildTodZonePerformance,
    buildTodZoneTrend,
    classifyTodReports,
} from '../utils/todZones/todZonePerformance';
import type { TodZoneDefinition, TodZoneVersion } from '../utils/todZones/todZoneTypes';

const definitions: TodZoneDefinition[] = [
    { code: 'A', label: 'Zone A', color: '#117db6', kind: 'permanent', active: true },
    { code: 'B', label: 'Zone B', color: '#f58645', kind: 'permanent', active: true },
];

function version(
    id: string,
    effectiveFrom: string,
    stopSnapshot: TodZoneVersion['stopSnapshot'],
): TodZoneVersion {
    return {
        id,
        schemaVersion: 4,
        revision: id === 'v1' ? 1 : 2,
        definitions,
        polygons: [],
        connectionStops: [],
        overrides: [],
        effectiveFrom,
        source: 'test',
        reviewNote: 'reviewed',
        stopSnapshot,
        publishedBy: 'owner',
        publishedAt: `${effectiveFrom}T12:00:00Z`,
    };
}

function report(date: string, locations: TodDailyKpiDataset['locations']): TodDailyKpiDataset {
    return {
        date,
        importedAt: `${date}T12:00:00Z`,
        importedBy: 'test',
        sourceFileName: 'Licensee KPI.xlsx',
        rowCount: locations.length,
        totalCompletedTrips: locations.reduce((sum, location) => sum + location.pickups, 0),
        totalDropoffs: locations.reduce((sum, location) => sum + location.dropoffs, 0),
        locations,
    };
}

const stop = (id: string, pickups: number, dropoffs: number) => ({
    id,
    name: `Stop ${id}`,
    lat: 44.38,
    lon: -79.69,
    pickups,
    dropoffs,
});

describe('TOD zone performance', () => {
    it('classifies every service day with its effective immutable version', () => {
        const versions = [
            version('v1', '2026-08-01', [
                { stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: ['A'], isConnectionStop: true, connectionZoneCodes: ['A'] },
            ]),
            version('v2', '2026-08-03', [
                { stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: ['B'] },
            ]),
        ];
        const classified = classifyTodReports([
            report('2026-07-31', [stop('1', 2, 1)]),
            report('2026-08-02', [stop('1', 10, 5)]),
            report('2026-08-03', [stop('1', 4, 6)]),
        ], versions);

        expect(classified.locations.map(location => location.zoneCodes)).toEqual([[], ['A'], ['B']]);
        expect(classified.locations[1].connectionZoneCodes).toEqual(['A']);
        expect(classified.usedVersionIds).toEqual(new Set(['v1', 'v2']));
        expect(classified.unversionedDates).toEqual(['2026-07-31']);
    });

    it('keeps overlapping zone rows non-additive and calculates per-zone connection share', () => {
        const versions = [version('v1', '2026-08-01', [
            { stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: ['A'], isConnectionStop: true, connectionZoneCodes: ['A'] },
            { stopId: '2', name: 'Stop 2', lat: 44.38, lon: -79.69, zoneCodes: ['A', 'B'], isConnectionStop: true, connectionZoneCodes: ['B'] },
            { stopId: '3', name: 'Stop 3', lat: 44.38, lon: -79.69, zoneCodes: [] },
        ])];
        const classified = classifyTodReports([report('2026-08-02', [
            stop('1', 10, 5),
            stop('2', 4, 6),
            stop('3', 2, 1),
        ])], versions);
        const performance = buildTodZonePerformance(classified.locations, definitions, 'activity');
        const zoneA = performance.rows.find(row => row.code === 'A')!;
        const zoneB = performance.rows.find(row => row.code === 'B')!;

        expect(performance.totalValue).toBe(28);
        expect(zoneA.value).toBe(25);
        expect(zoneB.value).toBe(10);
        expect(zoneA.connectionValue).toBe(15);
        expect(zoneA.connectionShare).toBe(0.6);
        expect(zoneB.connectionShare).toBe(1);
        expect(performance.unassigned.value).toBe(3);
        expect(performance.rows.reduce((sum, row) => sum + row.value, 0)).toBeGreaterThan(performance.totalValue);
    });

    it('aggregates map locations and returns complete daily and weekly trend buckets', () => {
        const versions = [version('v1', '2026-08-01', [
            { stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: ['A'] },
        ])];
        const reports = [
            report('2026-08-03', [stop('1', 10, 5)]),
            report('2026-08-04', [stop('1', 4, 6)]),
            report('2026-08-10', [stop('1', 3, 2)]),
        ];
        const classified = classifyTodReports(reports, versions);

        expect(aggregateClassifiedTodLocations(classified.locations, 'A')[0]).toMatchObject({ pickups: 17, dropoffs: 13, zoneCodes: ['A'] });
        expect(buildTodZoneTrend(classified.locations, reports.map(item => item.date), 'A', 'pickups', 'daily').map(point => point.value)).toEqual([10, 4, 3]);
        expect(buildTodZoneTrend(classified.locations, reports.map(item => item.date), 'A', 'activity', 'weekly').map(point => point.value)).toEqual([25, 5]);
    });
});
