import { describe, it, expect } from 'vitest';
import {
    buildObservedKeys,
    hasRouteTimeMatch,
    hasGtfsCoverage,
    computeMissedTripsForDay,
    getTripsForDayType,
    getScheduledTrips,
    getOntarioHolidayName,
    resolveServiceType,
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
    const feedSaturday = '2026-05-30';

    it('covers June 2026 service days for daily missed-trip reporting', () => {
        expect(hasGtfsCoverage('2026-06-01')).toBe(true);
        expect(getTripsForDayType('2026-06-01', 'weekday').length).toBeGreaterThan(0);
    });

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

    it('computes Ontario statutory holidays by rule', () => {
        expect(getOntarioHolidayName('2026-01-01')).toBe("New Year's Day");
        expect(getOntarioHolidayName('2026-02-16')).toBe('Family Day');
        expect(getOntarioHolidayName('2026-04-03')).toBe('Good Friday');
        expect(getOntarioHolidayName('2027-03-26')).toBe('Good Friday');
        expect(getOntarioHolidayName('2026-05-18')).toBe('Victoria Day');
        expect(getOntarioHolidayName('2027-05-24')).toBe('Victoria Day');
        expect(getOntarioHolidayName('2026-08-03')).toBe('Civic Holiday');
        expect(getOntarioHolidayName('2026-09-07')).toBe('Labour Day');
        expect(getOntarioHolidayName('2026-10-12')).toBe('Thanksgiving');
        expect(getOntarioHolidayName('2026-12-26')).toBe('Boxing Day');
        expect(getOntarioHolidayName('2026-08-04')).toBeNull();
    });

    it('runs Sunday service on holidays the feed does not cover', () => {
        // Civic Holiday: the feed has no exception, so STREETS reports a weekday.
        expect(resolveServiceType('2026-08-03', 'weekday')).toBe('sunday');
        // Thanksgiving: the feed removes weekday service and adds nothing.
        expect(resolveServiceType('2026-10-12', 'weekday')).toBe('sunday');
        expect(getScheduledTrips('2026-10-12', 'weekday').length).toBeGreaterThan(0);
    });

    it('trusts the feed when it adds its own holiday service', () => {
        // Labour Day 2026: the feed swaps weekday service for a holiday service.
        expect(resolveServiceType('2026-09-07', 'weekday')).toBe('weekday');
        const labourDay = getScheduledTrips('2026-09-07', 'weekday').length;
        expect(labourDay).toBeGreaterThan(0);
        expect(labourDay).toBeLessThan(getTripsForDayType('2026-09-08', 'weekday').length);
    });

    it('charges a miss to the direction that had no bus when both directions share a minute', () => {
        const date = '2026-09-05';
        const route400 = getTripsForDayType(date, 'saturday').filter(t => t.routeId === '400');
        const directionOf = (headsign: string) => (headsign.includes('Park Place') ? 'S' : 'N');
        const pairedRvh = route400.find(t =>
            !t.headsign.includes('Park Place')
            && route400.some(o => o.headsign.includes('Park Place') && o.departure === t.departure));
        expect(pairedRvh).toBeDefined();

        const observed = route400
            .filter(t => t.tripId !== pairedRvh!.tripId)
            .map(t => ({ routeId: t.routeId, terminalDepartureTime: t.departure, direction: directionOf(t.headsign) }));

        const result = computeMissedTripsForDay(date, 'saturday', observed);
        expect(result).not.toBeNull();
        expect(result!.trips.map(t => t.tripId)).toEqual([pairedRvh!.tripId]);
    });

    it('credits an on-the-minute bus to its own trip, not an earlier trip checked first', () => {
        const date = '2026-09-08';
        const weekday = getTripsForDayType(date, 'weekday');
        const toMinutes = (hhmm: string) => {
            const [h, m] = hhmm.split(':').map(Number);
            return (h * 60) + m;
        };
        let pair: [typeof weekday[number], typeof weekday[number]] | null = null;
        for (const routeId of new Set(weekday.map(t => t.routeId))) {
            const trips = weekday.filter(t => t.routeId === routeId).sort((a, b) => toMinutes(a.departure) - toMinutes(b.departure));
            for (let i = 1; i < trips.length - 1 && !pair; i++) {
                const gap = toMinutes(trips[i].departure) - toMinutes(trips[i - 1].departure);
                const isolatedBefore = i < 2 || toMinutes(trips[i - 1].departure) - toMinutes(trips[i - 2].departure) > 15;
                const isolatedAfter = toMinutes(trips[i + 1].departure) - toMinutes(trips[i].departure) > 15;
                if (gap > 0 && gap <= 10 && isolatedBefore && isolatedAfter) pair = [trips[i - 1], trips[i]];
            }
            if (pair) break;
        }
        expect(pair).not.toBeNull();
        const [earlier, later] = pair!;

        const observed = weekday
            .filter(t => t.routeId === earlier.routeId && t.tripId !== earlier.tripId)
            .map(t => ({ routeId: t.routeId, terminalDepartureTime: t.departure }));

        const result = computeMissedTripsForDay(date, 'weekday', observed);
        expect(result).not.toBeNull();
        expect(result!.trips.map(t => t.tripId)).toEqual([earlier.tripId]);
        expect(result!.trips.map(t => t.tripId)).not.toContain(later.tripId);
    });
});
