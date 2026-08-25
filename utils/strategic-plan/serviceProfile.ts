export type StrategicPlanDayType = 'Weekday' | 'Saturday' | 'Sunday';

export interface StrategicPlanServiceProfileRow {
    routeName: string;
    routeShortName: string;
    serviceSpan: string;
    peakFrequencyMinutes: number | null;
    peakFrequencySpan: string;
    offPeakFrequencyMinutes: number | null;
    offPeakFrequencySpan: string;
    revenueHours: number;
}

export interface StrategicPlanServiceProfile {
    feedPublisherName: string;
    feedVersion: string;
    feedStartDate: string;
    feedEndDate: string;
    rowsByDayType: Record<StrategicPlanDayType, StrategicPlanServiceProfileRow[]>;
}

export interface StrategicPlanGtfsSource {
    routes: string;
    trips: string;
    stopTimes: string;
    calendar: string;
    feedInfo: string;
}

interface RouteRecord {
    routeId: string;
    shortName: string;
    longName: string;
}

interface TripRecord {
    routeId: string;
    serviceId: string;
    tripId: string;
    directionId: string;
    headsign: string;
}

interface CalendarRecord {
    serviceId: string;
    dayFlags: Record<StrategicPlanDayType, boolean>;
}

interface TripTiming {
    firstSequence: number;
    firstDeparture: number;
    lastSequence: number;
    lastArrival: number;
}

interface FrequencyRun {
    headway: number;
    start: number;
    end: number;
    duration: number;
}

interface RouteFrequencySummary {
    peakHeadway: number | null;
    peakRuns: FrequencyRun[];
    offPeakHeadway: number | null;
    offPeakRuns: FrequencyRun[];
}

interface RouteFamilyDefinition {
    shortName: string;
    memberShortNames: string[];
}

const DAY_TYPES: StrategicPlanDayType[] = ['Weekday', 'Saturday', 'Sunday'];

const ROUTE_FAMILIES: RouteFamilyDefinition[] = [
    { shortName: '400', memberShortNames: ['400'] },
    { shortName: '100', memberShortNames: ['100'] },
    { shortName: '101', memberShortNames: ['101'] },
    { shortName: '2', memberShortNames: ['2A', '2B'] },
    { shortName: '7', memberShortNames: ['7A', '7B'] },
    { shortName: '8A', memberShortNames: ['8A'] },
    { shortName: '8B', memberShortNames: ['8B'] },
    { shortName: '10', memberShortNames: ['10'] },
    { shortName: '11', memberShortNames: ['11'] },
    { shortName: '12', memberShortNames: ['12A', '12B'] },
];

function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index++;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    cells.push(current);
    return cells;
}

function visitCsvRows(raw: string, visitor: (row: Record<string, string>) => void): void {
    const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
    const headers = parseCsvLine(lines[0] || '').map(header => header.trim());

    for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        if (!line?.trim()) continue;
        const cells = parseCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, cellIndex) => {
            row[header] = (cells[cellIndex] || '').trim();
        });
        visitor(row);
    }
}

function parseGtfsTime(raw: string): number | null {
    const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
    return (hours * 60) + minutes;
}

function formatDate(raw: string): string {
    if (!/^\d{8}$/.test(raw)) return raw || 'Unknown';
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function roundToNearest(value: number, interval: number): number {
    return Math.round(value / interval) * interval;
}

function formatClock(totalMinutes: number): string {
    const rounded = Math.max(0, totalMinutes);
    const dayOffset = Math.floor(rounded / 1440);
    const minuteOfDay = rounded % 1440;
    const hours24 = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    const suffix = dayOffset > 0 ? ` (+${dayOffset})` : '';
    return `${hours12}:${String(minutes).padStart(2, '0')} ${period}${suffix}`;
}

function formatRoundedSpan(start: number, end: number): string {
    return `${formatClock(roundToNearest(start, 15))}–${formatClock(roundToNearest(end, 15))}`;
}

function buildStableRuns(departures: number[]): FrequencyRun[] {
    const ordered = [...new Set(departures)].sort((a, b) => a - b);
    if (ordered.length < 2) return [];

    const intervals = ordered.slice(1).map((departure, index) => ({
        start: ordered[index],
        end: departure,
        headway: departure - ordered[index],
    })).filter(interval => interval.headway >= 5 && interval.headway <= 120);

    if (intervals.length === 0) return [];

    const runs: FrequencyRun[] = [];
    let runStart = 0;

    const flushRun = (runEnd: number) => {
        const slice = intervals.slice(runStart, runEnd + 1);
        if (slice.length < 2) return;
        const headway = roundToNearest(slice.reduce((sum, interval) => sum + interval.headway, 0) / slice.length, 5);
        runs.push({
            headway,
            start: slice[0].start,
            end: slice[slice.length - 1].end,
            duration: slice.reduce((sum, interval) => sum + interval.headway, 0),
        });
    };

    for (let index = 1; index <= intervals.length; index++) {
        const previousRounded = roundToNearest(intervals[index - 1]?.headway || 0, 5);
        const currentRounded = index < intervals.length ? roundToNearest(intervals[index].headway, 5) : null;
        if (currentRounded !== previousRounded) {
            flushRun(index - 1);
            runStart = index;
        }
    }

    if (runs.length > 0) return runs;

    const byHeadway = new Map<number, { count: number; duration: number }>();
    intervals.forEach(interval => {
        const rounded = roundToNearest(interval.headway, 5);
        const existing = byHeadway.get(rounded) || { count: 0, duration: 0 };
        existing.count++;
        existing.duration += interval.headway;
        byHeadway.set(rounded, existing);
    });
    const fallbackHeadway = [...byHeadway.entries()]
        .sort((a, b) => b[1].count - a[1].count || b[1].duration - a[1].duration || a[0] - b[0])[0]?.[0];
    if (fallbackHeadway === undefined) return [];

    return intervals
        .filter(interval => roundToNearest(interval.headway, 5) === fallbackHeadway)
        .map(interval => ({
            headway: fallbackHeadway,
            start: interval.start,
            end: interval.end,
            duration: interval.headway,
        }));
}

function summarizeRouteFrequency(departureGroups: number[][]): RouteFrequencySummary {
    const groupRuns = departureGroups.map(buildStableRuns);
    const boundaries = [...new Set(groupRuns.flatMap(runs => runs.flatMap(run => [run.start, run.end])))]
        .sort((a, b) => a - b);
    const routeRuns: FrequencyRun[] = [];

    for (let index = 1; index < boundaries.length; index++) {
        const start = boundaries[index - 1];
        const end = boundaries[index];
        if (end <= start) continue;
        const midpoint = start + ((end - start) / 2);
        const activeHeadways = groupRuns
            .map(runs => runs.find(run => midpoint >= run.start && midpoint < run.end)?.headway)
            .filter((headway): headway is number => headway !== undefined);
        if (activeHeadways.length === 0) continue;

        const headway = roundToNearest(
            activeHeadways.reduce((sum, value) => sum + value, 0) / activeHeadways.length,
            5,
        );
        const previous = routeRuns[routeRuns.length - 1];
        if (previous && previous.headway === headway && previous.end === start) {
            previous.end = end;
            previous.duration += end - start;
        } else {
            routeRuns.push({ headway, start, end, duration: end - start });
        }
    }

    const runs = routeRuns.filter(run => run.duration >= 30);
    if (runs.length === 0) {
        return { peakHeadway: null, peakRuns: [], offPeakHeadway: null, offPeakRuns: [] };
    }

    const peakHeadway = Math.min(...runs.map(run => run.headway));
    const peakRuns = runs.filter(run => run.headway === peakHeadway);
    const slowerRuns = runs.filter(run => run.headway > peakHeadway);
    if (slowerRuns.length === 0) {
        return { peakHeadway, peakRuns, offPeakHeadway: null, offPeakRuns: [] };
    }

    const durationByHeadway = new Map<number, number>();
    slowerRuns.forEach(run => durationByHeadway.set(
        run.headway,
        (durationByHeadway.get(run.headway) || 0) + run.duration,
    ));
    const offPeakHeadway = [...durationByHeadway.entries()]
        .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];

    return {
        peakHeadway,
        peakRuns,
        offPeakHeadway,
        offPeakRuns: slowerRuns.filter(run => run.headway === offPeakHeadway),
    };
}

function mergeAndFormatRuns(runs: FrequencyRun[]): string {
    if (runs.length === 0) return 'N/A';
    const rounded = runs
        .map(run => ({ start: roundToNearest(run.start, 15), end: roundToNearest(run.end, 15) }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const firstStart = rounded[0].start;
    const lastEnd = Math.max(...rounded.map(span => span.end));

    // This is a planning-level summary rather than a published timetable.
    // Intermittent appearances of the selected regime are intentionally shown
    // as one approximate first-to-last window so the table remains scannable.
    return `${formatClock(firstStart)}–${formatClock(lastEnd)}`;
}

function parseSource(source: StrategicPlanGtfsSource) {
    const routes: RouteRecord[] = [];
    visitCsvRows(source.routes, row => routes.push({
        routeId: row.route_id,
        shortName: row.route_short_name,
        longName: row.route_long_name,
    }));

    const trips: TripRecord[] = [];
    visitCsvRows(source.trips, row => trips.push({
        routeId: row.route_id,
        serviceId: row.service_id,
        tripId: row.trip_id,
        directionId: row.direction_id,
        headsign: row.trip_headsign,
    }));

    const calendars: CalendarRecord[] = [];
    visitCsvRows(source.calendar, row => calendars.push({
        serviceId: row.service_id,
        dayFlags: {
            Weekday: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].some(day => row[day] === '1'),
            Saturday: row.saturday === '1',
            Sunday: row.sunday === '1',
        },
    }));

    const relevantTripIds = new Set(trips.map(trip => trip.tripId));
    const timings = new Map<string, TripTiming>();
    visitCsvRows(source.stopTimes, row => {
        if (!relevantTripIds.has(row.trip_id)) return;
        const sequence = Number(row.stop_sequence);
        const departure = parseGtfsTime(row.departure_time || row.arrival_time);
        const arrival = parseGtfsTime(row.arrival_time || row.departure_time);
        if (!Number.isFinite(sequence) || departure === null || arrival === null) return;

        const current = timings.get(row.trip_id) || {
            firstSequence: Number.POSITIVE_INFINITY,
            firstDeparture: departure,
            lastSequence: Number.NEGATIVE_INFINITY,
            lastArrival: arrival,
        };
        if (sequence < current.firstSequence) {
            current.firstSequence = sequence;
            current.firstDeparture = departure;
        }
        if (sequence > current.lastSequence) {
            current.lastSequence = sequence;
            current.lastArrival = arrival;
        }
        timings.set(row.trip_id, current);
    });

    let feedPublisherName = 'Barrie Transit';
    let feedVersion = 'Unknown';
    let feedStartDate = 'Unknown';
    let feedEndDate = 'Unknown';
    visitCsvRows(source.feedInfo, row => {
        feedPublisherName = row.feed_publisher_name || feedPublisherName;
        feedVersion = row.feed_version || feedVersion;
        feedStartDate = formatDate(row.feed_start_date);
        feedEndDate = formatDate(row.feed_end_date);
    });

    return { routes, trips, calendars, timings, feedPublisherName, feedVersion, feedStartDate, feedEndDate };
}

export function buildStrategicPlanServiceProfile(source: StrategicPlanGtfsSource): StrategicPlanServiceProfile {
    const parsed = parseSource(source);
    const routeById = new Map(parsed.routes.map(route => [route.routeId, route]));
    const familyByMemberShortName = new Map<string, RouteFamilyDefinition>();
    ROUTE_FAMILIES.forEach(family => family.memberShortNames.forEach(member => familyByMemberShortName.set(member, family)));

    const rowsByDayType = {} as Record<StrategicPlanDayType, StrategicPlanServiceProfileRow[]>;

    DAY_TYPES.forEach(dayType => {
        const activeServices = new Set(parsed.calendars
            .filter(calendar => calendar.dayFlags[dayType])
            .map(calendar => calendar.serviceId));

        rowsByDayType[dayType] = ROUTE_FAMILIES.map(family => {
            const memberRoutes = parsed.routes.filter(route => family.memberShortNames.includes(route.shortName));
            const memberRouteIds = new Set(memberRoutes.map(route => route.routeId));
            const familyTrips = parsed.trips.filter(trip => activeServices.has(trip.serviceId) && memberRouteIds.has(trip.routeId));
            const timedTrips = familyTrips
                .map(trip => ({ trip, timing: parsed.timings.get(trip.tripId) }))
                .filter((entry): entry is { trip: TripRecord; timing: TripTiming } => Boolean(entry.timing));

            const longNames = family.memberShortNames
                .map(member => memberRoutes.find(route => route.shortName === member)?.longName)
                .filter((name): name is string => Boolean(name));
            const routeName = [...new Set(longNames)].join(' / ') || `Route ${family.shortName}`;

            if (timedTrips.length === 0) {
                return {
                    routeName,
                    routeShortName: family.shortName,
                    serviceSpan: 'N/A',
                    peakFrequencyMinutes: null,
                    peakFrequencySpan: 'N/A',
                    offPeakFrequencyMinutes: null,
                    offPeakFrequencySpan: 'N/A',
                    revenueHours: 0,
                };
            }

            const firstDeparture = Math.min(...timedTrips.map(entry => entry.timing.firstDeparture));
            const lastArrival = Math.max(...timedTrips.map(entry => entry.timing.lastArrival));
            const revenueMinutes = timedTrips.reduce((sum, entry) => (
                sum + Math.max(0, entry.timing.lastArrival - entry.timing.firstDeparture)
            ), 0);

            const departuresByGroup = new Map<string, number[]>();
            timedTrips.forEach(({ trip, timing }) => {
                const route = routeById.get(trip.routeId);
                if (!route) return;
                const directionKey = trip.directionId || trip.headsign || 'service';
                const frequencyKey = family.memberShortNames.length > 1
                    ? `${route.shortName}:${directionKey}`
                    : `${family.shortName}:${directionKey}`;
                const departures = departuresByGroup.get(frequencyKey) || [];
                departures.push(timing.firstDeparture);
                departuresByGroup.set(frequencyKey, departures);
            });

            const frequencySummary = summarizeRouteFrequency([...departuresByGroup.values()]);

            return {
                routeName,
                routeShortName: family.shortName,
                serviceSpan: formatRoundedSpan(firstDeparture, lastArrival),
                peakFrequencyMinutes: frequencySummary.peakHeadway,
                peakFrequencySpan: mergeAndFormatRuns(frequencySummary.peakRuns),
                offPeakFrequencyMinutes: frequencySummary.offPeakHeadway,
                offPeakFrequencySpan: mergeAndFormatRuns(frequencySummary.offPeakRuns),
                revenueHours: Math.round((revenueMinutes / 60) * 10) / 10,
            };
        });
    });

    return {
        feedPublisherName: parsed.feedPublisherName,
        feedVersion: parsed.feedVersion,
        feedStartDate: parsed.feedStartDate,
        feedEndDate: parsed.feedEndDate,
        rowsByDayType,
    };
}
