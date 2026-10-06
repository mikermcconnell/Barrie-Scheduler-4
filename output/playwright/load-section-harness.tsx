import React, { useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { RidershipLoadSection } from '../../components/Performance/RidershipLoadSection';
import { buildRouteLoadAnalysis, type LoadTimePeriod } from '../../utils/performanceRouteLoad';
import type { DailySummary, RouteRidershipHeatmap } from '../../utils/performanceDataTypes';

// Deterministic pseudo-random numbers so screenshots are repeatable.
let seed = 42;
function random(): number {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
}

interface RouteFixture {
    routeId: string;
    routeName: string;
    direction: string;
    stopNames: string[];
    timepoints: number[];
    /** Relative boarding weight per stop. */
    boardWeight: (index: number, count: number) => number;
    /** Share of onboard riders leaving at each stop. */
    alightShare: (index: number, count: number) => number;
    /** Average boardings per trip outside peaks. */
    baseRiders: number;
}

const ROUTE_8A: RouteFixture = {
    routeId: '8A', routeName: 'RVH/YONGE', direction: 'N',
    stopNames: [
        'Barrie South GO Station', 'Yonge at Mapleview', 'Goodwin Drive', 'Yonge at Little', 'Yonge at Big Bay Point',
        'Yonge at Hurst', 'Yonge at Johnson', 'Allandale Transit Terminal', 'Essa at Anne', 'Bradford at Tiffin',
        'Downtown Terminal', 'Bayfield at Grove', 'Bayfield at Cundles', 'Georgian Mall', 'Duckworth at Grove',
        'Georgian College', 'RVH Main Entrance', 'Livingstone at Bayfield', 'Cundles at Duckworth', 'Grove at Steel',
        'St Vincent at Grove', 'Penetang at Grove', 'Johnson at Shanty Bay', 'Johnson at Hurst', 'Park Place',
    ],
    timepoints: [0, 7, 10, 13, 15, 16, 24],
    boardWeight: (i, n) => (i < n * 0.45 ? 1.6 : 0.5),
    alightShare: (i, n) => (i === 15 ? 0.55 : i === 16 ? 0.35 : i > n * 0.5 ? 0.12 : 0.04),
    baseRiders: 14,
};

const ROUTE_2B: RouteFixture = {
    routeId: '2B', routeName: 'PARK PLACE', direction: 'S',
    stopNames: [
        'Downtown Terminal', 'Dunlop at Anne', 'Dunlop at Ferndale', 'Ferndale Woods Public School', 'Ardagh at Ferndale',
        'Veterans at Essa', 'Veterans at Mapleton', 'Mapleton Avenue', 'Veterans at Touchette', 'Park Place',
    ],
    timepoints: [0, 5, 9],
    boardWeight: () => 1,
    alightShare: (i, n) => (i > n * 0.5 ? 0.3 : 0.1),
    baseRiders: 4,
};

const ROUTE_1: RouteFixture = {
    routeId: '1', routeName: 'GEORGIAN COLLEGE', direction: 'N',
    stopNames: [
        'Downtown Terminal', 'Dunlop at Clapperton', 'Bayfield at Sophia', 'Bayfield at Grove', 'Bayfield at Cundles',
        'Georgian Mall', 'Grove at Duckworth', 'Georgian College', 'Georgian Drive', 'Royal Victoria Hospital',
    ],
    timepoints: [0, 5, 7, 9],
    boardWeight: (i) => (i < 4 ? 2 : 0.6),
    alightShare: (i) => (i === 7 ? 0.6 : 0.08),
    baseRiders: 10,
};

function peakMultiplier(minutes: number): number {
    if (minutes >= 7 * 60 && minutes < 9 * 60) return 3.2;
    if (minutes >= 15 * 60 && minutes < 18 * 60) return 2.2;
    if (minutes >= 19 * 60) return 0.5;
    return 1;
}

function buildHeatmap(route: RouteFixture, dayIndex: number): RouteRidershipHeatmap {
    const stopCount = route.stopNames.length;
    const departures: number[] = [];
    for (let minutes = 6 * 60; minutes <= 22 * 60; minutes += 30) departures.push(minutes);
    const totalWeight = route.stopNames.reduce((sum, _, i) => sum + route.boardWeight(i, stopCount), 0);

    const cells: ([number, number] | null)[][] = route.stopNames.map(() => departures.map((): [number, number] | null => null));
    departures.forEach((minutes, tripIndex) => {
        const riders = route.baseRiders * peakMultiplier(minutes) * (0.75 + random() * 0.5);
        let onboard = 0;
        for (let i = 0; i < stopCount; i++) {
            const isLast = i === stopCount - 1;
            const boardings = isLast ? 0 : Math.round((riders * route.boardWeight(i, stopCount) / totalWeight) * (0.5 + random()));
            let alightings = isLast ? onboard : Math.min(onboard, Math.round(onboard * route.alightShare(i, stopCount) * (0.6 + random() * 0.8)));
            // A few trips get a miscounting sensor so the diagnostics have something to report.
            if (tripIndex % 13 === dayIndex % 13 && isLast) alightings = Math.round(alightings * 0.4);
            onboard = onboard + boardings - Math.min(alightings, onboard);
            cells[i][tripIndex] = [boardings, alightings];
        }
    });

    return {
        routeId: route.routeId,
        routeName: route.routeName,
        direction: route.direction,
        trips: departures.map((minutes, i) => ({
            tripId: `${route.routeId}-${dayIndex}-${i}`,
            terminalDepartureTime: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
            tripName: `${route.routeId} trip ${i}`,
            block: `${route.routeId}-${(i % 3) + 1}`,
            direction: route.direction,
            vehicleId: `${2100 + ((i + dayIndex) % 9)}`,
        })),
        stops: route.stopNames.map((stopName, i) => ({
            stopName, stopId: `${route.routeId}-S${i}`, routeStopIndex: i, isTimepoint: route.timepoints.includes(i),
        })),
        cells,
    };
}

const days: DailySummary[] = Array.from({ length: 5 }, (_, dayIndex) => ({
    date: `2026-09-${String(28 + dayIndex > 30 ? dayIndex - 2 : 28 + dayIndex).padStart(2, '0')}`,
    loadProfiles: [],
    ridershipHeatmaps: [ROUTE_8A, ROUTE_2B, ROUTE_1].map(route => buildHeatmap(route, dayIndex)),
} as unknown as DailySummary));

function Harness() {
    const analysisForPeriod = useCallback((period: LoadTimePeriod) => buildRouteLoadAnalysis(days, period), []);
    return (
        <div style={{ maxWidth: 1180, margin: '24px auto', padding: '0 16px' }}>
            <RidershipLoadSection analysisForPeriod={analysisForPeriod} />
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<Harness />);
