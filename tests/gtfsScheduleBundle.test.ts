// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
    buildScheduleFeed,
    flattenScheduleBundle,
    mergeScheduleFeeds,
    type ScheduleFeed,
} from '../utils/gtfs/gtfsScheduleBundle';
import { getTripsForDayType, hasGtfsCoverage } from '../utils/gtfs/gtfsScheduleIndex';
import * as serverIndex from '../functions/src/gtfsScheduleIndex';
import { addArchivedScheduleFeed, ARCHIVED_SCHEDULE_PATH, refreshScheduleFromArchive } from '../functions/src/gtfsScheduleArchive';

function feed(version: string, start: string, end: string, serviceId: string): ScheduleFeed {
    return {
        feedVersion: version,
        feedStartDate: start,
        feedEndDate: end,
        calendar: [[serviceId, '1111100', start, end]],
        calendarDates: [[serviceId, '20261012', 2]],
        trips: [[`${serviceId}-t1`, '8A', serviceId, 'Downtown', 'b1', '06:05']],
    };
}

const GTFS_FILES = {
    'feed_info.txt': 'feed_publisher_name,feed_start_date,feed_end_date,feed_version\nBarrie Transit,20270104,20270430,2027w\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nwk,1,1,1,1,1,0,0,20270104,20270430\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nwk,20270215,2\n',
    'trips.txt': 'route_id,service_id,trip_id,trip_headsign,block_id\n8A,wk,t1,"Georgian College, via Downtown",b1\n8B,wk,t2,Downtown,b2\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,7:05:00,7:05:00,s1,1\nt1,7:20:00,7:20:00,s2,2\nt2,25:10:00,25:10:00,s1,1\n',
};

describe('buildScheduleFeed', () => {
    it('keeps the first departure per trip and reads quoted fields', () => {
        const built = buildScheduleFeed(GTFS_FILES, 'fallback');
        expect(built).toMatchObject({ feedVersion: '2027w', feedStartDate: '20270104', feedEndDate: '20270430' });
        expect(built.trips).toEqual([
            ['t1', '8A', 'wk', 'Georgian College, via Downtown', 'b1', '07:05'],
            ['t2', '8B', 'wk', 'Downtown', 'b2', '25:10'],
        ]);
        expect(built.calendar).toEqual([['wk', '1111100', '20270104', '20270430']]);
        expect(built.calendarDates).toEqual([['wk', '20270215', 2]]);
    });
});

describe('flattenScheduleBundle', () => {
    it('ends each feed the day before the next one starts', () => {
        const flat = flattenScheduleBundle({
            feeds: [feed('fall', '20260920', '20261226', 'new'), feed('vs4', '20260830', '20261031', 'old')],
        });
        expect(flat.calendar.map(c => [c.serviceId, c.startDate, c.endDate])).toEqual([
            ['old', '20260830', '20260919'],
            ['new', '20260920', '20261226'],
        ]);
        // The older feed's Oct 12 exception falls after its window, so only the newer one applies.
        expect(flat.calendarDates.map(c => c.serviceId)).toEqual(['new']);
    });

    it('drops a feed entirely replaced by a later feed with the same start', () => {
        const merged = mergeScheduleFeeds([feed('vs3', '20260830', '20261031', 'a')], [feed('vs4', '20260830', '20261031', 'b')]);
        expect(merged.map(f => f.feedVersion)).toEqual(['vs4']);
    });
});

describe('packaged schedule bundle', () => {
    const servicesOn = (date: string, dayType: 'weekday' | 'saturday' | 'sunday') =>
        [...new Set(getTripsForDayType(date, dayType).map(trip => trip.serviceId))];

    it('covers summer through the fall board with no gap', () => {
        for (const date of ['2026-06-15', '2026-08-29', '2026-08-30', '2026-09-19', '2026-09-20', '2026-10-07', '2026-12-24']) {
            expect(hasGtfsCoverage(date), date).toBe(true);
        }
        expect(hasGtfsCoverage('2026-05-26')).toBe(false);
    });

    it('uses exactly one feed per day where feeds overlap', () => {
        expect(servicesOn('2026-09-15', 'weekday')).toEqual(['5b663066-968d-4dfa-a248-00bf0b9579fb']);
        expect(servicesOn('2026-10-07', 'weekday')).toEqual(['b25cd391-1734-48dc-b428-74ef89e38a2a']);
    });

    it('applies Labour Day holiday service from the feed', () => {
        expect(servicesOn('2026-09-07', 'weekday')).toEqual(['6d401a22-fb9c-477c-accf-7b1543647ca1']);
    });
});

describe('archived schedules', () => {
    function memoryBucket() {
        const files = new Map<string, string>();
        return {
            files,
            file: (path: string) => ({
                exists: async () => [files.has(path)] as [boolean],
                download: async () => [Buffer.from(files.get(path) ?? '')] as [Buffer],
                save: async (data: string) => { files.set(path, data); },
            }),
        };
    }

    it('adds an archived feed and makes its dates matchable without a deploy', async () => {
        const bucket = memoryBucket();
        const zip = Buffer.from(zipSync(Object.fromEntries(Object.entries(GTFS_FILES).map(([name, text]) => [name, strToU8(text)]))));

        expect(await addArchivedScheduleFeed(bucket, zip, '20270101-abcd')).toBe('2027w');
        expect(JSON.parse(bucket.files.get(ARCHIVED_SCHEDULE_PATH)!).feeds).toHaveLength(1);
        expect(serverIndex.hasGtfsCoverage('2027-01-05')).toBe(false);

        await refreshScheduleFromArchive(bucket);
        expect(serverIndex.hasGtfsCoverage('2027-01-05')).toBe(true);
        // Packaged feeds still apply alongside the archived one.
        expect(serverIndex.hasGtfsCoverage('2026-10-07')).toBe(true);
        expect(serverIndex.getTripsForDayType('2027-01-05', 'weekday').map(trip => trip.departure)).toEqual(['07:05', '25:10']);

        serverIndex.setScheduleBundle(serverIndex.getPackagedScheduleBundle());
    });
});
