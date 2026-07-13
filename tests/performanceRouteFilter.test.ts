import { describe, expect, it } from 'vitest';
import type { DailySummary, PerformanceDataSummary } from '../utils/performanceDataTypes';
import {
    filterPerformanceSummaryByRoute,
    getAvailablePerformanceRoutes,
} from '../utils/performanceRouteFilter';

function makeDay(): DailySummary {
    return {
        date: '2026-04-28',
        dayType: 'weekday',
        system: {
            otp: { total: 30, onTime: 24, early: 2, late: 4, onTimePercent: 80, earlyPercent: 6.7, latePercent: 13.3, avgDeviationSeconds: 60 },
            totalRidership: 300,
            totalBoardings: 300,
            totalAlightings: 280,
            vehicleCount: 10,
            tripCount: 30,
            wheelchairTrips: 3,
            avgSystemLoad: 12,
            peakLoad: 40,
        },
        byRoute: [
            {
                routeId: '7A',
                routeName: 'Route Seven A',
                otp: { total: 10, onTime: 8, early: 1, late: 1, onTimePercent: 80, earlyPercent: 10, latePercent: 10, avgDeviationSeconds: 30 },
                ridership: 100,
                alightings: 90,
                tripCount: 10,
                serviceHours: 8,
                avgLoad: 11,
                maxLoad: 25,
                avgDeviationSeconds: 30,
                wheelchairTrips: 1,
            },
            {
                routeId: '8A',
                routeName: 'Route Eight A',
                otp: { total: 20, onTime: 16, early: 1, late: 3, onTimePercent: 80, earlyPercent: 5, latePercent: 15, avgDeviationSeconds: 75 },
                ridership: 200,
                alightings: 190,
                tripCount: 20,
                serviceHours: 12,
                avgLoad: 13,
                maxLoad: 40,
                avgDeviationSeconds: 75,
                wheelchairTrips: 2,
            },
            {
                routeId: '7B',
                routeName: 'Route Seven B',
                otp: { total: 5, onTime: 3, early: 1, late: 1, onTimePercent: 60, earlyPercent: 20, latePercent: 20, avgDeviationSeconds: 90 },
                ridership: 50,
                alightings: 45,
                tripCount: 5,
                serviceHours: 4,
                avgLoad: 7,
                maxLoad: 18,
                avgDeviationSeconds: 90,
                wheelchairTrips: 0,
            },
        ],
        byHour: [{ hour: 8, otp: { total: 30, onTime: 24, early: 2, late: 4, onTimePercent: 80, earlyPercent: 6.7, latePercent: 13.3, avgDeviationSeconds: 60 }, boardings: 300, alightings: 280, avgLoad: 12 }],
        byRouteHour: [
            { routeId: '7A', hour: 8, avgLoad: 10, boardings: 20, alightings: 15, otp: { total: 10, onTime: 8, early: 1, late: 1, onTimePercent: 80, earlyPercent: 10, latePercent: 10, avgDeviationSeconds: 30 } },
            { routeId: '7B', hour: 8, avgLoad: 20, boardings: 5, alightings: 4, otp: { total: 5, onTime: 3, early: 1, late: 1, onTimePercent: 60, earlyPercent: 20, latePercent: 20, avgDeviationSeconds: 90 } },
            { routeId: '8A', hour: 8, avgLoad: 12, boardings: 200, alightings: 190, otp: { total: 20, onTime: 16, early: 1, late: 3, onTimePercent: 80, earlyPercent: 5, latePercent: 15, avgDeviationSeconds: 75 } },
        ],
        byStop: [{
            stopName: 'Terminal', stopId: 'stop-1', lat: 0, lon: 0, isTimepoint: true,
            otp: { total: 1, onTime: 1, early: 0, late: 0, onTimePercent: 100, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 },
            boardings: 125, alightings: 110, avgLoad: 10, routeCount: 3, routes: ['7A', '7B', '8A'],
            routeBreakdown: [
                { routeId: '7A', boardings: 20, alightings: 15, hourlyBoardings: [1, 2], hourlyAlightings: [3, 4] },
                { routeId: '7B', boardings: 5, alightings: 4, hourlyBoardings: [5, 6], hourlyAlightings: [7, 8] },
                { routeId: '8A', boardings: 100, alightings: 91, hourlyBoardings: [9, 9], hourlyAlightings: [9, 9] },
            ],
        }],
        byTrip: [
            { tripId: 'trip-7', tripName: '7A 06:30', block: '7-1', routeId: '7A', routeName: 'Route Seven A', direction: 'N', terminalDepartureTime: '06:30', otp: { total: 1, onTime: 1, early: 0, late: 0, onTimePercent: 100, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 }, boardings: 10, maxLoad: 12 },
            { tripId: 'trip-8', tripName: '8A 06:30', block: '8-1', routeId: '8A', routeName: 'Route Eight A', direction: 'N', terminalDepartureTime: '06:30', otp: { total: 1, onTime: 0, early: 0, late: 1, onTimePercent: 0, earlyPercent: 0, latePercent: 100, avgDeviationSeconds: 400 }, boardings: 20, maxLoad: 25 },
        ],
        loadProfiles: [
            { routeId: '7A', routeName: 'Route Seven A', direction: 'N', tripCount: 10, stops: [] },
            { routeId: '8A', routeName: 'Route Eight A', direction: 'N', tripCount: 20, stops: [] },
        ],
        missedTrips: {
            totalScheduled: 40, totalMatched: 36, totalMissed: 4, missedPct: 10,
            notPerformedCount: 3, lateOver15Count: 1,
            byRoute: [
                { routeId: '7A', count: 1, earliestDep: '06:00' },
                { routeId: '7B', count: 1, earliestDep: '07:00' },
                { routeId: '8A', count: 2, earliestDep: '08:00' },
            ],
            trips: [
                { tripId: 'm1', routeId: '7A', departure: '06:00', headsign: 'A', blockId: '1', serviceId: 'WKD', missType: 'not_performed' },
                { tripId: 'm2', routeId: '7B', departure: '07:00', headsign: 'B', blockId: '2', serviceId: 'WKD', missType: 'late_over_15', lateByMinutes: 20 },
                { tripId: 'm3', routeId: '8A', departure: '08:00', headsign: 'C', blockId: '3', serviceId: 'WKD', missType: 'not_performed' },
                { tripId: 'm4', routeId: '8A', departure: '09:00', headsign: 'D', blockId: '4', serviceId: 'WKD', missType: 'not_performed' },
            ],
        },
        byOperatorDwell: {
            incidents: [
                { operatorId: 'op-1', date: '2026-04-28', routeId: '7A', routeName: '7A', stopName: 'A', stopId: 'a', tripName: 't1', block: '1', observedArrivalTime: '08:00', observedDepartureTime: '08:05', rawDwellSeconds: 300, trackedDwellSeconds: 240, severity: 'moderate' },
                { operatorId: 'op-1', date: '2026-04-28', routeId: '7B', routeName: '7B', stopName: 'B', stopId: 'b', tripName: 't2', block: '2', observedArrivalTime: '09:00', observedDepartureTime: '09:10', rawDwellSeconds: 600, trackedDwellSeconds: 540, severity: 'high' },
                { operatorId: 'op-2', date: '2026-04-28', routeId: '8A', routeName: '8A', stopName: 'C', stopId: 'c', tripName: 't3', block: '3', observedArrivalTime: '10:00', observedDepartureTime: '10:05', rawDwellSeconds: 300, trackedDwellSeconds: 240, severity: 'moderate' },
            ],
            byOperator: [
                { operatorId: 'op-1', moderateCount: 1, highCount: 1, totalIncidents: 2, totalTrackedDwellSeconds: 780, avgTrackedDwellSeconds: 390, stopVisitCount: 500, serviceHours: 20, incidentsPer1kVisits: 4, incidentsPer100ServiceHours: 10 },
                { operatorId: 'op-2', moderateCount: 1, highCount: 0, totalIncidents: 1, totalTrackedDwellSeconds: 240, avgTrackedDwellSeconds: 240, stopVisitCount: 250, serviceHours: 10, incidentsPer1kVisits: 4, incidentsPer100ServiceHours: 10 },
            ],
            totalIncidents: 3, totalTrackedDwellMinutes: 17, totalStopVisits: 750, totalServiceHours: 30, incidentsPer1kVisits: 4, incidentsPer100ServiceHours: 10,
        },
        dataQuality: {
            totalRecords: 1000,
            inBetweenFiltered: 0,
            missingAVL: 0,
            missingAPC: 0,
            detourRecords: 0,
            tripperRecords: 0,
            loadCapped: 0,
            apcExcludedFromLoad: 0,
        },
        schemaVersion: 8,
    };
}

function makeSummary(): PerformanceDataSummary {
    return {
        dailySummaries: [makeDay()],
        metadata: {
            importedAt: '2026-04-29T00:00:00Z',
            importedBy: 'test',
            dateRange: { start: '2026-04-28', end: '2026-04-28' },
            dayCount: 1,
            totalRecords: 1000,
        },
        schemaVersion: 8,
    };
}

describe('performance route filtering', () => {
    it('lists available route choices from performance summaries', () => {
        expect(getAvailablePerformanceRoutes(makeSummary())).toEqual([
            { routeId: '7', routeName: 'Route 7' },
            { routeId: '7A', routeName: 'Route Seven A' },
            { routeId: '7B', routeName: 'Route Seven B' },
            { routeId: '8A', routeName: 'Route Eight A' },
        ]);
    });

    it('supports canonical merged route scopes for route-scoped files', () => {
        const scoped = filterPerformanceSummaryByRoute(makeSummary(), '7')!;
        const day = scoped.dailySummaries[0];

        expect(day.byRoute.map(route => route.routeId)).toEqual(['7A', '7B']);
        expect(day.byTrip.map(trip => trip.routeId)).toEqual(['7A']);
        expect(day.loadProfiles.map(profile => profile.routeId)).toEqual(['7A']);
        expect(day.system.totalRidership).toBe(150);
    });

    it('merges A/B route-hour and stop breakdowns for canonical route scopes', () => {
        const day = filterPerformanceSummaryByRoute(makeSummary(), '7')!.dailySummaries[0];

        expect(day.byHour).toHaveLength(1);
        expect(day.byHour[0]).toMatchObject({ hour: 8, boardings: 25, alightings: 19 });
        expect(day.byHour[0].otp).toMatchObject({ total: 15, onTime: 11, onTimePercent: 11 / 15 * 100 });
        expect(day.byHour[0].avgLoad).toBeCloseTo((10 * 10 + 20 * 5) / 15);
        expect(day.byStop[0]).toMatchObject({ boardings: 25, alightings: 19, routeCount: 1 });
        expect(day.byStop[0].hourlyBoardings).toEqual([6, 8]);
        expect(day.byStop[0].hourlyAlightings).toEqual([10, 12]);
        expect(day.byStop[0].routeBreakdown).toEqual([{
            routeId: '7', boardings: 25, alightings: 19,
            hourlyBoardings: [6, 8], hourlyAlightings: [10, 12],
        }]);
    });

    it('does not expose system-wide missed-trip denominators in route scopes', () => {
        const missed = filterPerformanceSummaryByRoute(makeSummary(), '7')!.dailySummaries[0].missedTrips!;

        expect(missed).toMatchObject({ totalScheduled: 0, totalMatched: 0, totalMissed: 2, missedPct: 0, notPerformedCount: 1, lateOver15Count: 1 });
        expect(missed.byRoute.map(row => row.routeId)).toEqual(['7A', '7B']);
    });

    it('rebuilds route dwell incident totals and omits unavailable global denominators', () => {
        const dwell = filterPerformanceSummaryByRoute(makeSummary(), '7')!.dailySummaries[0].byOperatorDwell!;

        expect(dwell.incidents).toHaveLength(2);
        expect(dwell.byOperator).toEqual([expect.objectContaining({ operatorId: 'op-1', totalIncidents: 2, totalTrackedDwellSeconds: 780 })]);
        expect(dwell.totalIncidents).toBe(2);
        expect(dwell.totalTrackedDwellMinutes).toBe(13);
        expect(dwell.totalStopVisits).toBeUndefined();
        expect(dwell.totalServiceHours).toBeUndefined();
        expect(dwell.incidentsPer100ServiceHours).toBeUndefined();
    });

    it('does not fall back to system hours when route-hour detail is unavailable', () => {
        const summary = makeSummary();
        summary.dailySummaries[0].byRouteHour = undefined;
        expect(filterPerformanceSummaryByRoute(summary, '7')!.dailySummaries[0].byHour).toEqual([]);
    });

    it('keeps only the selected route in route-scoped summaries', () => {
        const scoped = filterPerformanceSummaryByRoute(makeSummary(), '7A')!;
        const day = scoped.dailySummaries[0];

        expect(day.byRoute.map(route => route.routeId)).toEqual(['7A']);
        expect(day.byTrip.map(trip => trip.routeId)).toEqual(['7A']);
        expect(day.loadProfiles.map(profile => profile.routeId)).toEqual(['7A']);
        expect(day.system.totalRidership).toBe(100);
        expect(day.system.tripCount).toBe(10);
        expect(day.system.peakLoad).toBe(25);
    });

    it('returns all data when route scope is all', () => {
        const summary = makeSummary();
        expect(filterPerformanceSummaryByRoute(summary, 'all')).toBe(summary);
    });
});
