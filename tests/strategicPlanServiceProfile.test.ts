import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildStrategicPlanServiceProfile,
    type StrategicPlanGtfsSource,
} from '../utils/strategic-plan/serviceProfile';

function buildSyntheticSource(): StrategicPlanGtfsSource {
    const departures = ['05:58:00', '06:28:00', '06:58:00', '07:58:00', '08:58:00', '09:58:00'];
    const trips = departures.map((_, index) => `400,W,trip-${index},Downtown,0,block-${index}`).join('\n');
    const stopTimes = departures.flatMap((departure, index) => {
        const [hours, minutes] = departure.split(':').map(Number);
        const endTotal = (hours * 60) + minutes + 20;
        const end = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`;
        return [
            `${departure},${departure},trip-${index},stop-a,1`,
            `${end},${end},trip-${index},stop-b,2`,
        ];
    }).join('\n');

    return {
        routes: 'route_id,agency_id,route_short_name,route_long_name\n400,a,400,EXPRESS',
        trips: `route_id,service_id,trip_id,trip_headsign,direction_id,block_id\n${trips}`,
        stopTimes: `arrival_time,departure_time,trip_id,stop_id,stop_sequence\n${stopTimes}`,
        calendar: 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday\nW,1,1,1,1,1,0,0',
        feedInfo: 'feed_publisher_name,feed_start_date,feed_end_date,feed_version\nBarrie Transit,20260527,20260829,test-v1',
    };
}

describe('5-Year Strategic Plan service profile', () => {
    it('rounds service spans and separates sustained peak and off-peak regimes', () => {
        const profile = buildStrategicPlanServiceProfile(buildSyntheticSource());
        const route400 = profile.rowsByDayType.Weekday.find(row => row.routeShortName === '400');

        expect(route400).toMatchObject({
            routeName: 'EXPRESS',
            serviceSpan: '6:00 AM–10:15 AM',
            peakFrequencyMinutes: 30,
            peakFrequencySpan: '6:00 AM–7:00 AM',
            offPeakFrequencyMinutes: 60,
            offPeakFrequencySpan: '7:00 AM–10:00 AM',
            revenueHours: 2,
        });
    });

    it('builds all route/day rows from the bundled static GTFS snapshot', () => {
        const gtfsPath = (name: string) => readFileSync(resolve(process.cwd(), 'gtfs', name), 'utf8');
        const profile = buildStrategicPlanServiceProfile({
            routes: gtfsPath('routes.txt'),
            trips: gtfsPath('trips.txt'),
            stopTimes: gtfsPath('stop_times.txt'),
            calendar: gtfsPath('calendar.txt'),
            feedInfo: gtfsPath('feed_info.txt'),
        });

        expect(profile.feedVersion).toBe('20260503b');
        expect(profile.feedStartDate).toBe('2026-05-27');
        expect(profile.feedEndDate).toBe('2026-08-29');
        expect(profile.rowsByDayType.Weekday).toHaveLength(10);
        expect(profile.rowsByDayType.Saturday).toHaveLength(10);
        expect(profile.rowsByDayType.Sunday).toHaveLength(10);

        for (const dayType of ['Weekday', 'Saturday', 'Sunday'] as const) {
            const routes = profile.rowsByDayType[dayType].map(row => row.routeShortName);
            expect(routes).toEqual(['400', '100', '101', '2', '7', '8A', '8B', '10', '11', '12']);
            profile.rowsByDayType[dayType].forEach(row => {
                expect(row.peakFrequencySpan).not.toContain(';');
                expect(row.offPeakFrequencySpan).not.toContain(';');
            });
            const unavailable = profile.rowsByDayType[dayType]
                .filter(row => row.serviceSpan === 'N/A' || row.revenueHours <= 0)
                .map(row => `${dayType}:${row.routeShortName}`);
            expect(unavailable).toEqual(dayType === 'Sunday' ? ['Sunday:400'] : []);
        }
    });
});
