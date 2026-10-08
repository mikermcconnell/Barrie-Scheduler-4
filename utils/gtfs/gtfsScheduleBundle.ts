/**
 * Compact Barrie Transit schedules for missed-trip matching, one entry per GTFS feed.
 *
 * Each feed keeps only what matching needs: calendars, calendar exceptions, and trips
 * with their first departure. Feeds are stitched together in time order: a feed applies
 * from its start date until the day before the next feed starts, so an older feed whose
 * calendar still runs past a newer feed's start never double-counts trips.
 */

export interface ScheduleFeed {
    /** feed_info.feed_version, or a content hash when the feed has none. */
    feedVersion: string;
    /** YYYYMMDD */
    feedStartDate: string;
    /** YYYYMMDD */
    feedEndDate: string;
    /** [serviceId, days "MTWTFSS" as 0/1 flags, startDate, endDate] */
    calendar: [string, string, string, string][];
    /** [serviceId, date, exceptionType] */
    calendarDates: [string, string, 1 | 2][];
    /** [tripId, routeId, serviceId, headsign, blockId, firstDeparture "HH:MM"] */
    trips: [string, string, string, string, string, string][];
}

export interface ScheduleBundle {
    feeds: ScheduleFeed[];
}

export interface FlatCalendarEntry {
    serviceId: string;
    days: boolean[];
    startDate: string;
    endDate: string;
}

export interface FlatCalendarDate {
    serviceId: string;
    date: string;
    exceptionType: 1 | 2;
}

export interface FlatTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
    headsign: string;
    blockId: string;
    departure: string;
}

export interface FlatSchedule {
    calendar: FlatCalendarEntry[];
    calendarDates: FlatCalendarDate[];
    trips: FlatTrip[];
}

/** Splits one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
    if (!line.includes('"')) return line.split(',');
    const fields: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { fields.push(field); field = ''; }
        else field += ch;
    }
    fields.push(field);
    return fields;
}

function parseRows(text: string | undefined): Array<Record<string, string>> {
    if (!text) return [];
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]).map(header => header.trim());
    return lines.slice(1).map(line => {
        const values = splitCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, i) => { row[header] = (values[i] ?? '').trim(); });
        return row;
    });
}

/** GTFS time ("7:05:00" or "25:10:00") to minutes after midnight. */
function timeToMinutes(time: string): number | null {
    const match = /^(\d{1,2}):(\d{2})/.exec(time);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minutesToHhMm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Builds a compact feed from GTFS file contents. `files` maps file names
 * (calendar.txt, calendar_dates.txt, trips.txt, stop_times.txt, feed_info.txt) to text.
 */
export function buildScheduleFeed(files: Record<string, string | undefined>, fallbackVersion: string): ScheduleFeed {
    const calendar = parseRows(files['calendar.txt']).map((row): ScheduleFeed['calendar'][number] => [
        row.service_id,
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (row[day] === '1' ? '1' : '0')).join(''),
        row.start_date,
        row.end_date,
    ]);
    const calendarDates = parseRows(files['calendar_dates.txt'])
        .map(row => [row.service_id, row.date, Number(row.exception_type)] as const)
        .filter((row): row is readonly [string, string, 1 | 2] => row[2] === 1 || row[2] === 2)
        .map(row => [...row] as ScheduleFeed['calendarDates'][number]);

    const firstDeparture = new Map<string, number>();
    for (const row of parseRows(files['stop_times.txt'])) {
        const minutes = timeToMinutes(row.departure_time || row.arrival_time || '');
        if (!row.trip_id || minutes === null) continue;
        const existing = firstDeparture.get(row.trip_id);
        if (existing === undefined || minutes < existing) firstDeparture.set(row.trip_id, minutes);
    }
    const trips = parseRows(files['trips.txt'])
        .filter(row => firstDeparture.has(row.trip_id))
        .map((row): ScheduleFeed['trips'][number] => [
            row.trip_id,
            row.route_id,
            row.service_id,
            row.trip_headsign ?? '',
            row.block_id ?? '',
            minutesToHhMm(firstDeparture.get(row.trip_id)!),
        ]);

    const info = parseRows(files['feed_info.txt'])[0] ?? {};
    const calendarStarts = calendar.map(entry => entry[2]).filter(Boolean).sort();
    const calendarEnds = calendar.map(entry => entry[3]).filter(Boolean).sort();
    return {
        feedVersion: info.feed_version || fallbackVersion,
        feedStartDate: info.feed_start_date || calendarStarts[0] || '',
        feedEndDate: info.feed_end_date || calendarEnds[calendarEnds.length - 1] || '',
        calendar,
        calendarDates,
        trips,
    };
}

/**
 * Adds feeds to a bundle. A feed with the same version or the same start date replaces
 * the older entry, since publishers re-issue corrected feeds for the same service period.
 */
export function mergeScheduleFeeds(existing: ScheduleFeed[], incoming: ScheduleFeed[]): ScheduleFeed[] {
    let feeds = [...existing];
    for (const feed of incoming) {
        feeds = feeds.filter(entry => entry.feedVersion !== feed.feedVersion && entry.feedStartDate !== feed.feedStartDate);
        feeds.push(feed);
    }
    return feeds.sort((a, b) => a.feedStartDate.localeCompare(b.feedStartDate));
}

function dayBefore(gtfsDate: string): string {
    const date = new Date(Date.UTC(Number(gtfsDate.slice(0, 4)), Number(gtfsDate.slice(4, 6)) - 1, Number(gtfsDate.slice(6, 8))));
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Flattens the bundle into one schedule, clipping each feed to the days before the next feed starts. */
export function flattenScheduleBundle(bundle: ScheduleBundle): FlatSchedule {
    const feeds = [...bundle.feeds].sort((a, b) => a.feedStartDate.localeCompare(b.feedStartDate));
    const flat: FlatSchedule = { calendar: [], calendarDates: [], trips: [] };

    feeds.forEach((feed, i) => {
        const next = feeds[i + 1];
        const windowEnd = next ? dayBefore(next.feedStartDate) : '99991231';

        for (const [serviceId, days, startDate, endDate] of feed.calendar) {
            const clippedEnd = endDate < windowEnd ? endDate : windowEnd;
            if (startDate > clippedEnd) continue;
            flat.calendar.push({ serviceId, days: days.split('').map(flag => flag === '1'), startDate, endDate: clippedEnd });
        }
        for (const [serviceId, date, exceptionType] of feed.calendarDates) {
            if (date > windowEnd) continue;
            flat.calendarDates.push({ serviceId, date, exceptionType });
        }
        for (const [tripId, routeId, serviceId, headsign, blockId, departure] of feed.trips) {
            flat.trips.push({ tripId, routeId, serviceId, headsign, blockId, departure });
        }
    });
    return flat;
}
