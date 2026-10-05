import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildStrategicPlanServiceProfile,
    type StrategicPlanDayType,
    type StrategicPlanGtfsSource,
} from '../utils/strategic-plan/serviceProfile';

function buildSyntheticSource(): StrategicPlanGtfsSource {
    const departures = ['05:58:00', '06:28:00', '06:58:00', '07:28:00', '08:28:00', '09:28:00', '10:28:00'];
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

describe('2027–2032 Strategic Plan service profile', () => {
    it('rounds service spans and averages sustained peak and off-peak bands', () => {
        const profile = buildStrategicPlanServiceProfile(buildSyntheticSource());
        const route400 = profile.rowsByDayType.Weekday.find(row => row.routeShortName === '400');

        expect(route400).toMatchObject({
            routeName: 'EXPRESS',
            serviceSpan: '6:00 AM–10:45 AM',
            peakFrequencyMinutes: 30,
            peakFrequencySpan: '6:00 AM–7:30 AM',
            offPeakFrequencyMinutes: 60,
            offPeakFrequencySpan: '7:30 AM–10:30 AM',
            revenueHours: 2.3,
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

        expect(profile.rowsByDayType.Weekday.find(row => row.routeShortName === '8A')).toMatchObject({
            serviceSpan: '4:30 AM–12:45 AM (+1)',
            revenueHours: 76.6,
        });
        expect(profile.rowsByDayType.Saturday.find(row => row.routeShortName === '8A')).toMatchObject({
            serviceSpan: '6:45 AM–12:45 AM (+1)',
            revenueHours: 67.5,
        });
        expect(profile.rowsByDayType.Sunday.find(row => row.routeShortName === '8A')).toMatchObject({
            serviceSpan: '8:30 AM–10:00 PM',
            revenueHours: 29.5,
        });

        type ExpectedFrequency = [number | null, string, number | null, string];
        const expectedFrequencyByDay: Record<StrategicPlanDayType, Record<string, ExpectedFrequency>> = {
            Weekday: {
                '400': [30, '6:45 AM–6:15 PM', null, 'N/A'],
                '100': [25, '7:00 AM–9:45 PM', 41, '10:30 PM–11:00 PM'],
                '101': [25, '7:00 AM–9:15 PM', 41, '10:00 PM–10:45 PM'],
                '2': [30, '5:45 AM–7:45 PM', 60, '7:45 PM–11:00 PM'],
                '7': [30, '5:30 AM–7:30 PM', 60, '7:30 PM–10:30 PM'],
                '8A': [30, '5:00 AM–6:15 PM', 60, '6:15 PM–11:45 PM'],
                '8B': [30, '5:45 AM–6:00 PM', 60, '5:15 AM–5:45 AM; 6:00 PM–12:30 AM (+1)'],
                '10': [30, '5:45 AM–9:15 PM', 60, '9:45 PM–11:45 PM'],
                '11': [30, '6:00 AM–10:00 PM', 60, '10:00 PM–11:00 PM'],
                '12': [35, '5:15 AM–9:00 PM', 50, '9:00 PM–11:30 PM'],
            },
            Saturday: {
                '400': [30, '8:45 AM–6:15 PM', null, 'N/A'],
                '100': [25, '7:45 AM–9:30 PM', 41, '10:15 PM–11:00 PM'],
                '101': [25, '8:00 AM–9:15 PM', 41, '10:00 PM–10:45 PM'],
                '2': [30, '6:45 AM–7:45 PM', 60, '7:45 PM–11:00 PM'],
                '7': [30, '6:30 AM–7:30 PM', 60, '7:30 PM–10:30 PM'],
                '8A': [30, '7:15 AM–6:15 PM', 60, '6:15 PM–11:45 PM'],
                '8B': [30, '6:45 AM–6:00 PM', 60, '6:00 PM–12:30 AM (+1)'],
                '10': [30, '7:15 AM–9:15 PM', 60, '9:45 PM–11:45 PM'],
                '11': [30, '7:30 AM–10:00 PM', 60, '10:00 PM–11:00 PM'],
                '12': [30, '6:15 AM–9:00 PM', 50, '9:00 PM–11:30 PM'],
            },
            Sunday: {
                '400': [null, 'N/A', null, 'N/A'],
                '100': [25, '11:00 AM–6:00 PM', 41, '7:45 AM–11:00 AM; 6:00 PM–10:45 PM'],
                '101': [25, '11:00 AM–5:45 PM', 41, '7:15 AM–11:00 AM; 5:45 PM–10:30 PM'],
                '2': [null, 'N/A', 60, '8:45 AM–9:45 PM'],
                '7': [null, 'N/A', 60, '9:30 AM–8:30 PM'],
                '8A': [null, 'N/A', 60, '8:45 AM–9:15 PM'],
                '8B': [null, 'N/A', 60, '9:15 AM–10:30 PM'],
                '10': [null, 'N/A', 60, '8:15 AM–10:15 PM'],
                '11': [null, 'N/A', 60, '8:30 AM–10:30 PM'],
                '12': [null, 'N/A', 60, '8:00 AM–9:30 PM'],
            },
        };

        for (const dayType of ['Weekday', 'Saturday', 'Sunday'] as const) {
            const routes = profile.rowsByDayType[dayType].map(row => row.routeShortName);
            expect(routes).toEqual(['400', '100', '101', '2', '7', '8A', '8B', '10', '11', '12']);
            Object.entries(expectedFrequencyByDay[dayType]).forEach(([routeShortName, expected]) => {
                expect(profile.rowsByDayType[dayType].find(row => row.routeShortName === routeShortName)).toMatchObject({
                    peakFrequencyMinutes: expected[0],
                    peakFrequencySpan: expected[1],
                    offPeakFrequencyMinutes: expected[2],
                    offPeakFrequencySpan: expected[3],
                });
            });
            const unavailable = profile.rowsByDayType[dayType]
                .filter(row => row.serviceSpan === 'N/A' || row.revenueHours <= 0)
                .map(row => `${dayType}:${row.routeShortName}`);
            expect(unavailable).toEqual(dayType === 'Sunday' ? ['Sunday:400'] : []);
        }
    });
});
