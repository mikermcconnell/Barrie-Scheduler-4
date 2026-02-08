import { describe, it, expect } from 'vitest';
import { applyExplicitInterlineLinks } from '../utils/gtfsImportService';
import type { MasterTrip } from '../utils/masterScheduleParser';
import type { SystemDraftRoute } from '../utils/scheduleTypes';

const makeTrip = (
    id: string,
    allandaleArrival: string,
    recovery: number,
    gtfsBlockId: string
): MasterTrip => ({
    id,
    blockId: `${id}-block`,
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 1200,
    endTime: 1260,
    recoveryTime: recovery,
    travelTime: 30,
    cycleTime: 35,
    stops: {
        'Barrie Allandale Transit Terminal': allandaleArrival,
    },
    arrivalTimes: {
        'Barrie Allandale Transit Terminal': allandaleArrival,
    },
    recoveryTimes: {
        'Barrie Allandale Transit Terminal': recovery,
    },
    gtfsBlockId,
});

const makeRoute = (routeNumber: string, northTrips: MasterTrip[]): SystemDraftRoute => ({
    routeNumber,
    northTable: {
        routeName: `${routeNumber} (Weekday) (North)`,
        stops: ['Barrie Allandale Transit Terminal'],
        stopIds: {},
        trips: northTrips,
    },
    southTable: {
        routeName: `${routeNumber} (Weekday) (South)`,
        stops: [],
        stopIds: {},
        trips: [],
    },
});

describe('applyExplicitInterlineLinks', () => {
    it('links 8A to nearest 8B trip in same GTFS block during interline window', () => {
        const trip8A = makeTrip('8A-N-1', '8:07 PM', 5, 'blk-1');
        const trip8BEarlier = makeTrip('8B-N-1', '8:10 PM', 0, 'blk-1');
        const trip8BLater = makeTrip('8B-N-2', '8:20 PM', 0, 'blk-1');

        const routes: SystemDraftRoute[] = [
            makeRoute('8A', [trip8A]),
            makeRoute('8B', [trip8BEarlier, trip8BLater]),
        ];

        applyExplicitInterlineLinks(routes, 'Weekday');

        expect(trip8A.interlineNext).toEqual({ route: '8B', tripId: '8B-N-1' });
        expect(trip8BEarlier.interlinePrev).toEqual({ route: '8A', tripId: '8A-N-1' });
        expect(trip8BLater.interlinePrev).toBeUndefined();
    });

    it('does not link weekday midday trips outside the interline window', () => {
        const trip8A = makeTrip('8A-N-1', '1:00 PM', 5, 'blk-1');
        const trip8B = makeTrip('8B-N-1', '1:10 PM', 0, 'blk-1');
        const routes: SystemDraftRoute[] = [
            makeRoute('8A', [trip8A]),
            makeRoute('8B', [trip8B]),
        ];

        applyExplicitInterlineLinks(routes, 'Weekday');

        expect(trip8A.interlineNext).toBeUndefined();
        expect(trip8B.interlinePrev).toBeUndefined();
    });

    it('links Sunday trips all day', () => {
        const trip8A = makeTrip('8A-N-1', '1:00 PM', 5, 'blk-1');
        const trip8B = makeTrip('8B-N-1', '1:08 PM', 0, 'blk-1');
        const routes: SystemDraftRoute[] = [
            makeRoute('8A', [trip8A]),
            makeRoute('8B', [trip8B]),
        ];

        applyExplicitInterlineLinks(routes, 'Sunday');

        expect(trip8A.interlineNext).toEqual({ route: '8B', tripId: '8B-N-1' });
        expect(trip8B.interlinePrev).toEqual({ route: '8A', tripId: '8A-N-1' });
    });
});

