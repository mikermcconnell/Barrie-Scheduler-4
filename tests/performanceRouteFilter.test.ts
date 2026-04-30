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
        ],
        byHour: [],
        byStop: [],
        byTrip: [
            { tripId: 'trip-7', tripName: '7A 06:30', block: '7-1', routeId: '7A', routeName: 'Route Seven A', direction: 'N', terminalDepartureTime: '06:30', otp: { total: 1, onTime: 1, early: 0, late: 0, onTimePercent: 100, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 }, boardings: 10, maxLoad: 12 },
            { tripId: 'trip-8', tripName: '8A 06:30', block: '8-1', routeId: '8A', routeName: 'Route Eight A', direction: 'N', terminalDepartureTime: '06:30', otp: { total: 1, onTime: 0, early: 0, late: 1, onTimePercent: 0, earlyPercent: 0, latePercent: 100, avgDeviationSeconds: 400 }, boardings: 20, maxLoad: 25 },
        ],
        loadProfiles: [
            { routeId: '7A', routeName: 'Route Seven A', direction: 'N', tripCount: 10, stops: [] },
            { routeId: '8A', routeName: 'Route Eight A', direction: 'N', tripCount: 20, stops: [] },
        ],
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
            { routeId: '7A', routeName: 'Route Seven A' },
            { routeId: '8A', routeName: 'Route Eight A' },
        ]);
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
