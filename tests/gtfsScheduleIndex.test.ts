import { describe, it, expect } from 'vitest';
import {
    buildObservedKeys,
    hasRouteTimeMatch,
    computeMissedTripsForDay,
    getTripsForDayType,
    isBetterServiceCandidate,
    type ServiceCandidate,
} from '../utils/gtfs/gtfsScheduleIndex';

function makeCandidate(matchRatio: number, matched: number, scheduledCount: number): ServiceCandidate {
    const relevantScheduled = Array.from({ length: scheduledCount }, (_, i) => ({
        tripId: `trip-${i}`,
        routeId: '10',
        headsign: '',
        blockId: '',
        departure: '12:00',
        serviceId: 'svc',
    }));
    return {
        relevantScheduled,
        matched,
        matchRatio,
        routeStats: new Map(),
    };
}

describe('gtfsScheduleIndex', () => {
    const feedSaturday = '2026-02-14';

    it('matches GTFS 24+ hour departures against 00:xx observed times', () => {
        const observedMidnight = buildObservedKeys([{ routeId: '7A', terminalDepartureTime: '00:23' }]);
        expect(hasRouteTimeMatch('7A', '24:23', observedMidnight)).toBe(true);
        expect(hasRouteTimeMatch('7A', '24:21', observedMidnight)).toBe(true);

        const observedGtfsStyle = buildObservedKeys([{ routeId: '7A', terminalDepartureTime: '24:23' }]);
        expect(hasRouteTimeMatch('7A', '00:23', observedGtfsStyle)).toBe(true);
    });

    it('prefers better match ratio over larger raw match count in fallback ranking', () => {
        const current = makeCandidate(0.60, 30, 50);
        const betterRatioLowerCount = makeCandidate(0.75, 28, 37);
        expect(isBetterServiceCandidate(betterRatioLowerCount, current)).toBe(true);
    });

    it('drops unreliable routes with zero route-level matches to reduce false positives', () => {
        const date = feedSaturday;
        const saturday7A = getTripsForDayType(date, 'saturday')
            .filter(t => t.routeId === '7A')
            .map(t => ({ routeId: t.routeId, terminalDepartureTime: t.departure }));

        expect(saturday7A.length).toBeGreaterThan(0);

        const observed = [
            ...saturday7A,
            { routeId: '10', terminalDepartureTime: '03:59' }, // include route with no credible matches
        ];

        const result = computeMissedTripsForDay(date, 'saturday', observed);
        expect(result).not.toBeNull();
        expect(result!.byRoute.some(r => r.routeId === '10')).toBe(false);
    });

    it('classifies >15 minute late departures separately from not-performed trips', () => {
        const date = feedSaturday;
        const toMinutes = (hhmm: string): number => {
            const [h, m] = hhmm.split(':').map(Number);
            return (h * 60) + m;
        };
        const fromMinutes = (mins: number): string => {
            const wrapped = ((mins % 1440) + 1440) % 1440;
            const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
            const m = String(wrapped % 60).padStart(2, '0');
            return `${h}:${m}`;
        };

        const saturdayTrips = getTripsForDayType(date, 'saturday');
        const byRoute = new Map<string, typeof saturdayTrips>();
        for (const t of saturdayTrips) {
            const arr = byRoute.get(t.routeId) || [];
            arr.push(t);
            byRoute.set(t.routeId, arr);
        }

        let candidateRoute: string | null = null;
        let candidateIdx = -1;
        for (const [routeId, trips] of byRoute) {
            if (trips.length < 4) continue;
            const sorted = [...trips].sort((a, b) => a.departure.localeCompare(b.departure));
            const mins = sorted.map(t => toMinutes(t.departure));
            for (let i = 0; i < sorted.length; i++) {
                const prevGap = i === 0 ? 999 : mins[i] - mins[i - 1];
                const nextGap = i === sorted.length - 1 ? 999 : mins[i + 1] - mins[i];
                if (prevGap > 30 && nextGap > 30) {
                    candidateRoute = routeId;
                    candidateIdx = i;
                    break;
                }
            }
            if (candidateRoute) break;
        }

        expect(candidateRoute).not.toBeNull();
        const routeTrips = [...(byRoute.get(candidateRoute!) || [])].sort((a, b) => a.departure.localeCompare(b.departure));

        const base = toMinutes(routeTrips[candidateIdx].departure);
        const moved = fromMinutes(base + 16);
        const observed = routeTrips.map((t, i) => ({
            routeId: t.routeId,
            terminalDepartureTime: i === candidateIdx ? moved : t.departure,
        }));

        const result = computeMissedTripsForDay(date, 'saturday', observed);
        expect(result).not.toBeNull();
        expect(result!.lateOver15Count).toBeGreaterThan(0);
        expect(result!.trips.some(t => t.missType === 'late_over_15')).toBe(true);
    });
});
