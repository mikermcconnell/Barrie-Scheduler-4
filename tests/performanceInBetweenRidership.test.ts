import { describe, expect, it } from 'vitest';
import { aggregateDailySummaries as aggregateFrontend } from '../utils/performanceDataAggregator';
import { aggregateDailySummaries as aggregateBackend } from '../functions/src/aggregator';
import { buildReportHtml } from '../functions/src/reportHtml';
import { filterPerformanceSummaryByRoute } from '../utils/performanceRouteFilter';
import type { STREETSRecord } from '../utils/performanceDataTypes';

function record(overrides: Partial<STREETSRecord> = {}): STREETSRecord {
    return {
        vehicleLocationTPKey: 1, vehicleId: '2302', inBetween: false, isTripper: false,
        date: '2026-10-01', month: '2026-10', day: 'THURSDAY',
        arrivalTime: '12:00', stopTime: '12:00', observedArrivalTime: '12:00:10',
        observedDepartureTime: '12:00:30', wheelchairUsageCount: 0, departureLoad: 7,
        boardings: 2, alightings: 1, apcSource: 1, block: '400-01', operatorId: 'operator-1',
        tripName: '400 - 12:00', routeName: 'Route 400', branch: '400 FULL', routeId: '400',
        stopName: 'Georgian College', stopId: '330', routeStopIndex: 0, direction: 'S',
        isDetour: false, stopLat: 44.41, stopLon: -79.67, timePoint: true, distance: 0,
        previousStopName: null, tripId: 'observed-trip', internalTripId: 1,
        terminalDepartureTime: '12:00', ...overrides,
    };
}

function ordinaryVisits(): STREETSRecord[] {
    return [
        record(),
        record({ stopId: '62', stopName: 'Bayfield', routeStopIndex: 1,
            arrivalTime: '12:10', stopTime: '12:10', observedArrivalTime: '12:10:10',
            observedDepartureTime: '12:10:30', boardings: 3, departureLoad: 9 }),
        record({ stopId: 'end', stopName: 'End', routeStopIndex: 2,
            arrivalTime: '12:20', stopTime: '12:20', observedArrivalTime: '12:20:10',
            observedDepartureTime: '12:20:30', boardings: 0, alightings: 2 }),
    ];
}

const aggregators = [
    ['frontend', aggregateFrontend],
    ['backend', aggregateBackend],
] as const;

describe.each(aggregators)('%s InBetween passenger counting', (_name, aggregate) => {
    it('includes passenger movements everywhere without changing operational evidence', () => {
        const base = ordinaryVisits();
        const baseline = aggregate(structuredClone(base))[0];
        const day = aggregate([
            ...structuredClone(base),
            record({ inBetween: true, boardings: 3, alightings: 2, departureLoad: 120,
                observedArrivalTime: '12:01:00', observedDepartureTime: '12:01:00' }),
            record({ inBetween: true, boardings: 5, alightings: 1, departureLoad: 120,
                routeId: '99', routeName: 'Passenger-only route', stopId: 'extra', stopName: 'Extra stop',
                tripId: 'passenger-only-trip', vehicleId: 'extra-vehicle', block: '99-01',
                internalTripId: 2, arrivalTime: '15:00', stopTime: '15:00', terminalDepartureTime: '15:00',
                observedArrivalTime: '15:01:00', observedDepartureTime: '15:01:00', wheelchairUsageCount: 9 }),
        ])[0];

        expect(day.system.totalRidership).toBe(13);
        expect(day.system.totalBoardings).toBe(13);
        expect(day.system.totalAlightings).toBe(7);
        for (const key of ['otp', 'vehicleCount', 'tripCount', 'wheelchairTrips', 'avgSystemLoad', 'peakLoad'] as const) {
            expect(day.system[key]).toEqual(baseline.system[key]);
        }
        for (const key of ['byOperatorDwell', 'byCascade', 'segmentRuntimes', 'stopSegmentRuntimes',
            'tripStopSegmentRuntimes', 'runtimePatterns', 'routeStopDeviations'] as const) {
            expect(day[key]).toEqual(baseline[key]);
        }

        const route = day.byRoute.find(r => r.routeId === '400')!;
        const priorRoute = baseline.byRoute[0];
        expect(route.ridership).toBe(8);
        expect(route.alightings).toBe(6);
        for (const key of ['otp', 'tripCount', 'serviceHours', 'avgLoad', 'maxLoad', 'wheelchairTrips'] as const) {
            expect(route[key]).toEqual(priorRoute[key]);
        }
        const extraRoute = day.byRoute.find(r => r.routeId === '99')!;
        expect(extraRoute).toMatchObject({ ridership: 5, alightings: 1, tripCount: 0, serviceHours: 0 });
        expect(extraRoute.otp.total).toBe(0);

        const stop = day.byStop.find(s => s.stopId === '330')!;
        expect(stop).toMatchObject({ boardings: 5, alightings: 3, avgLoad: baseline.byStop.find(s => s.stopId === '330')!.avgLoad });
        expect(stop.hourlyBoardings![12]).toBe(5);
        expect(stop.hourlyAlightings![12]).toBe(3);
        expect(stop.routeBreakdown![0]).toMatchObject({ routeId: '400', boardings: 5, alightings: 3 });
        expect(stop.routeBreakdown![0].hourlyBoardings![12]).toBe(5);
        expect(day.byStop.find(s => s.stopId === 'extra')).toMatchObject({ boardings: 5, alightings: 1, avgLoad: 0 });

        expect(day.byHour.find(h => h.hour === 12)).toMatchObject({ boardings: 8, alightings: 6 });
        expect(day.byHour.find(h => h.hour === 15)).toMatchObject({ boardings: 5, alightings: 1, avgLoad: 0 });
        expect(day.byRouteHour!.find(h => h.routeId === '400' && h.hour === 12)).toMatchObject({ boardings: 8, alightings: 6 });
        expect(day.byRouteHour!.find(h => h.routeId === '99' && h.hour === 15)).toMatchObject({ boardings: 5, alightings: 1 });
        expect(day.byTrip).toHaveLength(1);
        expect(day.byTrip[0]).toMatchObject({ tripId: 'observed-trip', boardings: 8, maxLoad: baseline.byTrip[0].maxLoad });

        const cells = day.ridershipHeatmaps!.flatMap(h => h.cells.flat()).filter(c => c !== null);
        expect(cells.reduce((s, c) => s + c![0], 0)).toBe(13);
        expect(cells.reduce((s, c) => s + c![1], 0)).toBe(7);
        const profile = day.loadProfiles.find(p => p.routeId === '400')!;
        const priorProfile = baseline.loadProfiles[0];
        expect(profile.tripCount).toBe(priorProfile.tripCount);
        const loadStop = profile.stops.find(s => s.stopId === '330')!;
        expect(loadStop.avgBoardings).toBe(5);
        expect(loadStop.avgAlightings).toBe(3);
        expect(loadStop.avgLoad).toBe(priorProfile.stops.find(s => s.stopId === '330')!.avgLoad);
        expect(loadStop.loadObservationCount).toBe(priorProfile.stops.find(s => s.stopId === '330')!.loadObservationCount);
        expect(day.dataQuality.inBetweenFiltered).toBe(2);
        expect(day.dataQuality.loadCapped).toBe(baseline.dataQuality.loadCapped);
        expect(day.schemaVersion).toBe(15);
    });

    it('attaches intermediate movements to the correct repeated loop-stop occurrence', () => {
        const day = aggregate([
            record({ stopId: 'A', routeStopIndex: 0, boardings: 1, alightings: 0 }),
            record({ stopId: 'B', routeStopIndex: 1, boardings: 0, alightings: 0 }),
            record({ stopId: 'A', routeStopIndex: 2, boardings: 2, alightings: 0 }),
            record({ stopId: 'A', routeStopIndex: 0, inBetween: true, boardings: 3, alightings: 1 }),
            record({ stopId: 'A', routeStopIndex: 2, inBetween: true, boardings: 4, alightings: 2 }),
        ])[0];
        const heatmap = day.ridershipHeatmaps![0];
        const visits = heatmap.stops.flatMap((s, i) => s.stopId === 'A' ? [{ ordinal: s.occurrenceIndex, cell: heatmap.cells[i][0] }] : []);
        expect(visits).toEqual([{ ordinal: 0, cell: [4, 1] }, { ordinal: 1, cell: [6, 2] }]);
    });

    it('does not create passenger-flow opportunities from zero-activity intermediate updates', () => {
        const baseline = aggregate(ordinaryVisits())[0];
        const day = aggregate([
            ...ordinaryVisits(),
            record({ inBetween: true, stopId: 'unused', stopName: 'Intermediate position',
                routeStopIndex: 10, boardings: 0, alightings: 0, departureLoad: 120 }),
        ])[0];
        expect(day.ridershipHeatmaps).toEqual(baseline.ridershipHeatmaps);
        expect(day.system).toEqual(baseline.system);
    });

    it('does not turn intermediate timepoint labels into observed stop metadata', () => {
        const day = aggregate([
            record({ timePoint: false }),
            record({ inBetween: true, timePoint: true, boardings: 3, alightings: 1 }),
        ])[0];
        expect(day.byStop[0].isTimepoint).toBe(false);
        expect(day.ridershipHeatmaps![0].stops[0].isTimepoint).toBe(false);
        expect(day.loadProfiles[0].stops[0].isTimepoint).toBe(false);
        expect(day.ridershipHeatmaps![0].cells[0][0]).toEqual([5, 2]);
    });

    it('does not add another route or direction passenger update to an observed trip', () => {
        const day = aggregate([
            ...ordinaryVisits(),
            record({ inBetween: true, routeId: '99', boardings: 7, alightings: 1 }),
            record({ inBetween: true, direction: 'N', boardings: 11, alightings: 2 }),
        ])[0];
        expect(day.system.totalRidership).toBe(23);
        expect(day.byTrip).toHaveLength(1);
        expect(day.byTrip[0].boardings).toBe(5);
        expect(day.byRoute.find(r => r.routeId === '99')!.ridership).toBe(7);
        expect(day.ridershipHeatmaps!.find(h => h.routeId === '400' && h.direction === 'N')!.cells[0][0]).toEqual([11, 2]);
    });
});

it('passes corrected counts through route-filtered ridership reads and email rendering', () => {
    const day = aggregateFrontend([
        ...ordinaryVisits(), record({ inBetween: true, boardings: 1000, alightings: 200 }),
    ])[0];
    const summary = { dailySummaries: [day], metadata: {
        importedAt: '', importedBy: '', dateRange: { start: day.date, end: day.date },
        dayCount: 1, totalRecords: 4,
    }, schemaVersion: day.schemaVersion };
    const scoped = filterPerformanceSummaryByRoute(summary, '400')!;
    expect(scoped.dailySummaries[0].system.totalRidership).toBe(1005);
    expect(scoped.dailySummaries[0].byStop.find(s => s.stopId === '330')!.boardings).toBe(1002);
    const html = buildReportHtml({ latestDay: day, trendDays: [day], teamName: 'Barrie Transit' });
    expect(html).toContain('Total ridership');
    expect(html).toContain('1,005');
    expect(html).toContain('204 alightings');
});
