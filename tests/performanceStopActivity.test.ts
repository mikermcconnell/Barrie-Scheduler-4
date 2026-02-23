import { describe, expect, it } from 'vitest';
import {
    aggregateStopActivity,
    getStopActivityBreakdown,
    getStopRouteActivityBreakdown,
    getStopActivityValue,
    hasHourlyDataForStops,
    matchesStopSearch,
} from '../utils/performanceStopActivity';
import type { DailySummary, StopMetrics } from '../utils/performanceDataTypes';

function makeStop(overrides: Partial<StopMetrics> = {}): StopMetrics {
    return {
        stopName: 'Test Stop',
        stopId: 'STOP-1',
        lat: 44.38,
        lon: -79.69,
        isTimepoint: true,
        otp: {
            total: 1,
            onTime: 1,
            early: 0,
            late: 0,
            onTimePercent: 100,
            earlyPercent: 0,
            latePercent: 0,
            avgDeviationSeconds: 0,
        },
        boardings: 0,
        alightings: 0,
        avgLoad: 0,
        routeCount: 1,
        routes: ['10'],
        ...overrides,
    };
}

function makeDay(byStop: StopMetrics[]): DailySummary {
    return {
        date: '2026-01-07',
        dayType: 'weekday',
        system: {
            otp: {
                total: 0,
                onTime: 0,
                early: 0,
                late: 0,
                onTimePercent: 0,
                earlyPercent: 0,
                latePercent: 0,
                avgDeviationSeconds: 0,
            },
            totalRidership: 0,
            totalBoardings: 0,
            totalAlightings: 0,
            vehicleCount: 0,
            tripCount: 0,
            wheelchairTrips: 0,
            avgSystemLoad: 0,
            peakLoad: 0,
        },
        byRoute: [],
        byHour: [],
        byStop,
        byTrip: [],
        loadProfiles: [],
        dataQuality: {
            totalRecords: 0,
            inBetweenFiltered: 0,
            missingAVL: 0,
            missingAPC: 0,
            detourRecords: 0,
            tripperRecords: 0,
            loadCapped: 0,
            apcExcludedFromLoad: 0,
        },
        schemaVersion: 1,
    };
}

function empty24(): number[] {
    return new Array(24).fill(0);
}

describe('performanceStopActivity', () => {
    it('adopts hourly arrays when they appear on later days', () => {
        const hBoard = empty24();
        const hAlight = empty24();
        hBoard[7] = 4;
        hAlight[7] = 2;

        const day1 = makeDay([
            makeStop({
                stopId: 'S1',
                stopName: 'Central',
                boardings: 10,
                alightings: 6,
                routes: ['10'],
            }),
        ]);
        const day2 = makeDay([
            makeStop({
                stopId: 'S1',
                stopName: 'Central',
                boardings: 5,
                alightings: 3,
                routes: ['8A'],
                hourlyBoardings: hBoard,
                hourlyAlightings: hAlight,
            }),
        ]);

        const [aggregated] = aggregateStopActivity([day1, day2]);
        expect(aggregated.boardings).toBe(15);
        expect(aggregated.alightings).toBe(9);
        expect(aggregated.hourlyBoardings?.[7]).toBe(4);
        expect(aggregated.hourlyAlightings?.[7]).toBe(2);
        expect(aggregated.routes).toEqual(['8A', '10']);
    });

    it('merges when hourly alightings are missing without throwing', () => {
        const hBoard1 = empty24();
        hBoard1[8] = 1;
        const hBoard2 = empty24();
        hBoard2[8] = 2;
        const hAlight2 = empty24();
        hAlight2[8] = 3;

        const day1 = makeDay([
            makeStop({
                stopId: 'S2',
                stopName: 'South Terminal',
                boardings: 3,
                alightings: 1,
                hourlyBoardings: hBoard1,
            }),
        ]);
        const day2 = makeDay([
            makeStop({
                stopId: 'S2',
                stopName: 'South Terminal',
                boardings: 4,
                alightings: 2,
                hourlyBoardings: hBoard2,
                hourlyAlightings: hAlight2,
            }),
        ]);

        const [aggregated] = aggregateStopActivity([day1, day2]);
        expect(aggregated.hourlyBoardings?.[8]).toBe(3);
        expect(aggregated.hourlyAlightings?.[8]).toBe(3);
    });

    it('computes filtered activity breakdown from selected hours', () => {
        const hourlyBoardings = empty24();
        hourlyBoardings[7] = 5;
        const stop = makeStop({
            boardings: 100,
            alightings: 40,
            hourlyBoardings,
        });

        expect(getStopActivityBreakdown(stop, [7])).toEqual({ boardings: 5, alightings: 0 });
        expect(getStopActivityValue(stop, 'boardings', [7])).toBe(5);
        expect(getStopActivityValue(stop, 'alightings', [7])).toBe(0);
        expect(getStopActivityValue(stop, 'total', [7])).toBe(5);
        expect(getStopActivityValue(stop, 'total', null)).toBe(140);
    });

    it('matches stop search case-insensitively for stop IDs', () => {
        const stop = makeStop({ stopId: 'S40', stopName: 'Maple View Terminal' });
        expect(matchesStopSearch(stop, 's40')).toBe(true);
        expect(matchesStopSearch(stop, 'S40')).toBe(true);
        expect(matchesStopSearch(stop, 'maple')).toBe(true);
        expect(matchesStopSearch(stop, 'unknown')).toBe(false);
    });

    it('detects hourly data from either boardings or alightings arrays', () => {
        const hAlight = empty24();
        hAlight[12] = 6;
        expect(hasHourlyDataForStops([makeStop({ hourlyAlightings: hAlight })])).toBe(true);
        expect(hasHourlyDataForStops([makeStop()])).toBe(false);
    });

    it('aggregates stop route breakdown and supports hour filtering', () => {
        const route10Day1B = empty24();
        const route10Day1A = empty24();
        route10Day1B[7] = 3;
        route10Day1A[7] = 1;

        const route10Day2B = empty24();
        const route10Day2A = empty24();
        route10Day2B[7] = 1;
        route10Day2A[7] = 1;

        const route8Day1B = empty24();
        const route8Day1A = empty24();
        route8Day1B[7] = 2;
        route8Day1A[7] = 1;

        const day1 = makeDay([
            makeStop({
                stopId: 'S3',
                stopName: 'Downtown',
                boardings: 5,
                alightings: 2,
                routes: ['10', '8A'],
                routeBreakdown: [
                    {
                        routeId: '10',
                        boardings: 3,
                        alightings: 1,
                        hourlyBoardings: route10Day1B,
                        hourlyAlightings: route10Day1A,
                    },
                    {
                        routeId: '8A',
                        boardings: 2,
                        alightings: 1,
                        hourlyBoardings: route8Day1B,
                        hourlyAlightings: route8Day1A,
                    },
                ],
            }),
        ]);

        const day2 = makeDay([
            makeStop({
                stopId: 'S3',
                stopName: 'Downtown',
                boardings: 4,
                alightings: 2,
                routes: ['10'],
                routeBreakdown: [
                    {
                        routeId: '10',
                        boardings: 4,
                        alightings: 2,
                        hourlyBoardings: route10Day2B,
                        hourlyAlightings: route10Day2A,
                    },
                ],
            }),
        ]);

        const [aggregated] = aggregateStopActivity([day1, day2]);
        const allDay = getStopRouteActivityBreakdown(aggregated, null);
        const hour7 = getStopRouteActivityBreakdown(aggregated, [7]);

        expect(allDay).toEqual([
            { routeId: '10', boardings: 7, alightings: 3, total: 10 },
            { routeId: '8A', boardings: 2, alightings: 1, total: 3 },
        ]);
        expect(hour7).toEqual([
            { routeId: '10', boardings: 4, alightings: 2, total: 6 },
            { routeId: '8A', boardings: 2, alightings: 1, total: 3 },
        ]);
    });
});
