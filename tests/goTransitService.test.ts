import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearCache,
    getGoStationTemplateData,
    getGoTrainTimesForStopDetailed
} from '../utils/goTransitService';

describe('goTransitService data source behavior', () => {
    beforeEach(() => {
        clearCache();
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
                sunday: '0'
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
        expect(departures.name.toLowerCase()).toContain('departures');
        expect(arrivals.name.toLowerCase()).toContain('arrivals');
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
});
