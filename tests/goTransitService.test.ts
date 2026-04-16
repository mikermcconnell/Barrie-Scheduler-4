import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyGeorgianCollegeDefaults,
    clearCache,
    getGoStationTemplateData,
    getGoTrainTimesForStopDetailed,
    isGeorgianCollegeConnectionTarget
} from '../utils/gtfs/goTransitService';

describe('goTransitService data source behavior', () => {
    beforeEach(() => {
        clearCache();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-30T12:00:00'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns fallback source when no GTFS cache is available', () => {
        const result = getGoTrainTimesForStopDetailed('AL', 'Weekday', 'southbound');
        expect(result.source).toBe('fallback');
        expect(result.times.length).toBeGreaterThan(0);
    });

    it('returns gtfs source when valid GTFS cache data exists', () => {
        const cache = {
            fetchedAt: new Date().toISOString(),
            barrieStops: [{ stop_id: 'AL', stop_name: 'Allandale Waterfront GO' }],
            stopTimes: [
                {
                    trip_id: 'trip1',
                    stop_id: 'AL',
                    arrival_time: '08:10:00',
                    departure_time: '08:12:00',
                    stop_sequence: 1
                }
            ],
            trips: [{
                trip_id: 'trip1',
                route_id: 'BR',
                service_id: 'WK',
                trip_headsign: 'Union Station',
                direction_id: '0'
            }],
            calendar: [{
                service_id: 'WK',
                monday: '1',
                tuesday: '1',
                wednesday: '1',
                thursday: '1',
                friday: '1',
                saturday: '0',
                sunday: '0',
                start_date: '20260301',
                end_date: '20260630'
            }]
        };
        localStorage.setItem('goTransitGtfsCache', JSON.stringify(cache));

        const result = getGoTrainTimesForStopDetailed('AL', 'Weekday', 'southbound');
        expect(result.source).toBe('gtfs');
        expect(result.times.length).toBe(1);
    });

    it('creates station template with explicit default event type', () => {
        const departures = getGoStationTemplateData('barrie-south', 'Weekday', 'southbound');
        const arrivals = getGoStationTemplateData('barrie-south', 'Weekday', 'northbound');

        expect(departures.defaultEventType).toBe('departure');
        expect(arrivals.defaultEventType).toBe('arrival');
        expect(departures.name).toContain('To Train');
        expect(arrivals.name).toContain('From Train');
    });

    it('uses calendar_dates when calendar is not present', () => {
        const cache = {
            fetchedAt: new Date().toISOString(),
            barrieStops: [{ stop_id: 'AL', stop_name: 'Allandale Waterfront GO' }],
            stopTimes: [
                {
                    trip_id: 'trip1',
                    stop_id: 'AL',
                    arrival_time: '08:10:00',
                    departure_time: '08:12:00',
                    stop_sequence: 1
                }
            ],
            trips: [{
                trip_id: 'trip1',
                route_id: 'BR',
                service_id: 'SVC1',
                trip_headsign: 'Union Station',
                direction_id: '0'
            }],
            calendar: [] as unknown[],
            calendarDates: [{
                service_id: 'SVC1',
                date: '20260209', // Monday
                exception_type: '1'
            }]
        };
        localStorage.setItem('goTransitGtfsCache', JSON.stringify(cache));

        const weekday = getGoTrainTimesForStopDetailed('AL', 'Weekday', 'southbound');
        const saturday = getGoTrainTimesForStopDetailed('AL', 'Saturday', 'southbound');

        expect(weekday.source).toBe('gtfs');
        expect(weekday.times.length).toBe(1);
        expect(saturday.source).toBe('fallback');
    });

    it('uses the selected service date instead of combining every calendar_dates weekday variant', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-30T12:00:00'));

        const cache = {
            fetchedAt: new Date().toISOString(),
            barrieStops: [{ stop_id: 'AL', stop_name: 'Allandale Waterfront GO' }],
            stopTimes: [
                {
                    trip_id: 'trip-current',
                    stop_id: 'AL',
                    arrival_time: '08:10:00',
                    departure_time: '08:12:00',
                    stop_sequence: 1
                },
                {
                    trip_id: 'trip-future',
                    stop_id: 'AL',
                    arrival_time: '09:10:00',
                    departure_time: '09:12:00',
                    stop_sequence: 1
                }
            ],
            trips: [
                {
                    trip_id: 'trip-current',
                    route_id: 'BR',
                    service_id: 'svc-current',
                    trip_headsign: 'Union Station',
                    direction_id: '0'
                },
                {
                    trip_id: 'trip-future',
                    route_id: 'BR',
                    service_id: 'svc-future',
                    trip_headsign: 'Union Station',
                    direction_id: '0'
                }
            ],
            calendar: [] as unknown[],
            calendarDates: [
                {
                    service_id: 'svc-current',
                    date: '20260330',
                    exception_type: '1'
                },
                {
                    service_id: 'svc-future',
                    date: '20260406',
                    exception_type: '1'
                }
            ]
        };
        localStorage.setItem('goTransitGtfsCache', JSON.stringify(cache));

        const weekday = getGoTrainTimesForStopDetailed('AL', 'Weekday', 'southbound');

        expect(weekday.source).toBe('gtfs');
        expect(weekday.times.map(time => time.time)).toEqual([492]);
    });

    it('uses arrival time for northbound arrival templates', () => {
        const cache = {
            fetchedAt: new Date().toISOString(),
            barrieStops: [{ stop_id: 'AL', stop_name: 'Allandale Waterfront GO' }],
            stopTimes: [
                {
                    trip_id: 'trip1',
                    stop_id: 'AL',
                    arrival_time: '08:10:00',
                    departure_time: '08:12:00',
                    stop_sequence: 35
                }
            ],
            trips: [{
                trip_id: 'trip1',
                route_id: 'BR',
                service_id: 'WK',
                trip_headsign: 'Allandale Waterfront GO',
                direction_id: '1'
            }],
            calendar: [{
                service_id: 'WK',
                monday: '1',
                tuesday: '1',
                wednesday: '1',
                thursday: '1',
                friday: '1',
                saturday: '0',
                sunday: '0',
                start_date: '20260301',
                end_date: '20260630'
            }]
        };
        localStorage.setItem('goTransitGtfsCache', JSON.stringify(cache));

        const result = getGoTrainTimesForStopDetailed('AL', 'Weekday', 'northbound');

        expect(result.source).toBe('gtfs');
        expect(result.times).toHaveLength(1);
        expect(result.times[0]?.time).toBe(490);
        expect(result.times[0]?.eventType).toBe('arrival');
    });

    it('recognizes Georgian College manual connections and fills in default bells when missing', () => {
        const hydrated = applyGeorgianCollegeDefaults({
            id: 'georgian-target',
            name: 'Georgian College Bells',
            type: 'manual',
            location: 'Georgian College',
            stopCode: '330',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        expect(isGeorgianCollegeConnectionTarget(hydrated)).toBe(true);
        expect(hydrated.autoPopulateStops).toBe(true);
        expect(hydrated.stopCodes).toEqual(['327', '328', '329', '330', '331', '335']);
        expect(hydrated.defaultEventType).toBe('departure');
        expect(hydrated.times?.map(time => time.label)).toEqual([
            '8:00a Bell',
            '9:00a Bell',
            '10:00a Bell',
            '11:00a Bell',
            '12:00p Bell',
            '1:00p Bell',
            '2:00p Bell',
        ]);
    });

    it('does not overwrite an existing Georgian College connection time list', () => {
        const hydrated = applyGeorgianCollegeDefaults({
            id: 'georgian-target',
            name: 'Georgian College Bells',
            type: 'manual',
            location: 'Georgian College',
            stopCode: '330',
            times: [{ id: 'custom', time: 915, label: 'Custom Bell', daysActive: ['Weekday'], enabled: true }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        expect(hydrated.times).toHaveLength(1);
        expect(hydrated.times?.[0]?.label).toBe('Custom Bell');
        expect(hydrated.stopCodes).toEqual(['327', '328', '329', '330', '331', '335']);
    });
});
