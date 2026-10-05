import { describe, expect, it } from 'vitest';
import { buildLocalConnectionRows, findConnection, getGoTrainEvents } from '../utils/regional-transit/connectionAnalysis';
import type { PublishedRouteSource, RegionalGoFeed, GoTrainEvent } from '../utils/regional-transit/types';
import type { DayType } from '../utils/masterScheduleTypes';

const days = [['Saturday', '2026-10-17', 465], ['Sunday', '2026-10-18', 495]] as const;
function source(dayType: DayType, routeNumber: string, code: string, arrival: number): PublishedRouteSource {
    const trip = (id: string, minutes: number) => ({ id, blockId: routeNumber + '-1', direction: 'North' as const, tripNumber: 1, rowId: 1,
        startTime: minutes - 10, endTime: minutes + 30, recoveryTime: 5, recoveryTimes: { GO: 5 }, travelTime: 35, cycleTime: 40,
        stops: { Origin: clock(minutes - 10), GO: clock(minutes), End: clock(minutes + 30) }, arrivalTimes: { GO: clock(minutes) } });
    return { entry: { id: `${routeNumber}-${dayType}`, routeNumber, dayType, currentVersion: 10, storagePath: 'fixture', tripCount: 2,
        northStopCount: 3, southStopCount: 0, updatedAt: new Date(), updatedBy: 'fixture', uploaderName: 'Fixture', source: 'draft' },
        content: { metadata: { routeNumber, dayType, uploadedAt: new Date().toISOString() },
            northTable: { routeName: `${routeNumber} (North)`, stops: ['Origin', 'GO', 'End'], stopIds: { Origin: '1', GO: code, End: '2' },
                trips: [trip('day', arrival), { ...trip('overnight', 1450), startTime: 1440, endTime: 1490 }] },
            southTable: { routeName: `${routeNumber} (South)`, stops: [], stopIds: {}, trips: [] } } };
}
function clock(minutes: number) { return `${Math.floor(minutes / 60) % 24}:${String(minutes % 60).padStart(2, '0')}`; }
function train(minutes: number, direction: GoTrainEvent['direction']): GoTrainEvent {
    return { id: 'fixture', tripId: 'fixture', trainNumber: '', headsign: '', stationStopId: 'AD', direction, minutes };
}

describe('weekend calculation audit (fixture masters, not live published verification)', () => {
    for (const [day, date, arrival] of days) for (const [route, allandaleCode] of [['7', '9006'], ['8A', '9005'], ['8B', '9013'], ['12', '14']]) {
        for (const [station, code] of [['allandale', allandaleCode], ['south', '725']] as const) {
            it(`${day} ${route} ${station}: uses only that day's master and separates arrival/departure`, () => {
                const active = source(day, route, code, arrival);
                const other = source(day === 'Saturday' ? 'Sunday' : 'Saturday', route, code, arrival + 9);
                const before = JSON.stringify([active, other]);
                const rows = buildLocalConnectionRows([active, other], station, date, day);
                expect(rows).toHaveLength(1);
                expect(findConnection(rows[0], train(arrival + 15, 'to-go'))).toMatchObject({ busMinutes: arrival, gapMinutes: 15 });
                expect(findConnection(rows[0], train(arrival - 5, 'from-go'))).toMatchObject({ busMinutes: arrival + 5, gapMinutes: 10 });
                expect(findConnection(rows[0], train(1460, 'to-go'))).toMatchObject({ busMinutes: 1450, gapMinutes: 10 });
                expect(findConnection(rows[0], train(1445, 'from-go'))).toMatchObject({ busMinutes: 1455, gapMinutes: 10 });
                expect(JSON.stringify([active, other])).toBe(before);
            });
        }
    }
    it('selects distinct Saturday and Sunday GO calendars rather than applying a weekday override', () => {
        const data: RegionalGoFeed = { fetchedAt: new Date().toISOString(), sourceUrl: 'fixture', timezone: 'America/Toronto',
            stops: [{ stop_id: 'AD', stop_name: 'Allandale Waterfront GO' }], routes: [{ route_id: 'BR', route_type: 2 }],
            trips: ['SAT', 'SUN'].map(service => ({ trip_id: service, service_id: service, route_id: 'BR', direction_id: 1, trip_headsign: 'Union Station' })),
            stopTimes: ['SAT', 'SUN'].map((id, i) => ({ trip_id: id, stop_id: 'AD', arrival_time: i ? '08:30:00' : '08:00:00', departure_time: i ? '08:30:00' : '08:00:00', stop_sequence: 1 })),
            calendar: ['SAT', 'SUN'].map(id => ({ service_id: id, start_date: '20261001', end_date: '20261031', monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: id === 'SAT' ? 1 : 0, sunday: id === 'SUN' ? 1 : 0 })), calendarDates: [] };
        expect(getGoTrainEvents(data, 'allandale', '2026-10-17').events.map(event => [event.tripId, event.minutes])).toEqual([['SAT', 480]]);
        expect(getGoTrainEvents(data, 'allandale', '2026-10-18').events.map(event => [event.tripId, event.minutes])).toEqual([['SUN', 510]]);
        data.calendarDates = [{ service_id: 'SAT', date: '20261017', exception_type: 2 }, { service_id: 'SUN', date: '20261017', exception_type: 1 }];
        expect(getGoTrainEvents(data, 'allandale', '2026-10-17').events.map(event => [event.tripId, event.minutes])).toEqual([['SUN', 510]]);
    });
});
