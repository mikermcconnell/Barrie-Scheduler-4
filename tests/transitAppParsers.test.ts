import { describe, expect, it } from 'vitest';
import {
    parseLocationsFile,
    parseTripLegsFile,
    parseTripsFile,
} from '../utils/transit-app/transitAppParsers';

describe('transitAppParsers', () => {
    it('parses quoted commas in trip leg stop names', () => {
        const csv = [
            'user_trip_id,start_time,end_time,start_longitude,start_latitude,end_longitude,end_latitude,service_name,route_short_name,mode,start_stop_name,end_stop_name',
            'trip-1,2025-01-01 12:00:00 UTC,2025-01-01 12:25:00 UTC,-79.66,44.41,-79.45,44.59,Simcoe County LINX,3,Transit,"Barrie, Georgian College",Lakehead University',
        ].join('\n');

        const { rows, skipped } = parseTripLegsFile(csv);
        expect(skipped).toBe(0);
        expect(rows).toHaveLength(1);
        expect(rows[0].route_short_name).toBe('3');
        expect(rows[0].start_stop_name).toBe('Barrie, Georgian College');
        expect(rows[0].end_stop_name).toBe('Lakehead University');
    });

    it('skips location rows with incomplete coordinates', () => {
        const csv = [
            'user_id,longitude,latitude,timestamp',
            'u1,-79.69,44.38,2025-01-01 12:00:00 UTC',
            'u2,-79.70,,2025-01-01 12:05:00 UTC',
            'u3,,44.39,2025-01-01 12:10:00 UTC',
            'u4,0,0,2025-01-01 12:15:00 UTC',
        ].join('\n');

        const { rows, skipped } = parseLocationsFile(csv);
        expect(rows).toHaveLength(1);
        expect(skipped).toBe(3);
        expect(rows[0].user_id).toBe('u1');
    });

    it('zeros partial trip endpoint coordinates instead of creating half-valid points', () => {
        const csv = [
            'user_id,start_longitude,start_latitude,end_longitude,end_latitude,timestamp,arrive_by,leave_at',
            'u1,-79.69,44.38,-79.58,,2025-01-01 12:00:00 UTC,,',
            'u2,,44.40,-79.60,44.35,2025-01-01 13:00:00 UTC,,',
        ].join('\n');

        const { rows, skipped } = parseTripsFile(csv);
        expect(skipped).toBe(0);
        expect(rows).toHaveLength(2);
        expect(rows[0].start_longitude).toBe(-79.69);
        expect(rows[0].start_latitude).toBe(44.38);
        expect(rows[0].end_longitude).toBe(0);
        expect(rows[0].end_latitude).toBe(0);
        expect(rows[1].start_longitude).toBe(0);
        expect(rows[1].start_latitude).toBe(0);
        expect(rows[1].end_longitude).toBe(-79.6);
        expect(rows[1].end_latitude).toBe(44.35);
    });
});
