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
    firstStopId: string;
    lastSequence: number;
    lastArrival: number;
    lastStopId: string;
}

interface FrequencyRun {
    headway: number;
    start: number;
    end: number;
    duration: number;
}

interface HeadwayInterval {
    start: number;
    end: number;
    headway: number;
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

interface TimedTrip {
    trip: TripRecord;
    timing: TripTiming;
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

const MIN_INTERVALS_PER_BAND = 3;
const MAX_BANDS_PER_SEQUENCE = 3;
const MIN_BAND_DIFFERENCE_MINUTES = 10;
const BOUNDARY_OUTLIER_DIFFERENCE_MINUTES = 15;

function meanHeadway(intervals: HeadwayInterval[]): number {
    return intervals.reduce((sum, interval) => sum + interval.headway, 0) / intervals.length;
}

function squaredError(intervals: HeadwayInterval[]): number {
    const mean = meanHeadway(intervals);
    return intervals.reduce((sum, interval) => sum + ((interval.headway - mean) ** 2), 0);
}

function trimBoundaryOutliers(intervals: HeadwayInterval[]): HeadwayInterval[] {
    const trimmed = [...intervals];
    while (trimmed.length >= MIN_INTERVALS_PER_BAND + 1) {
        const comparison = trimmed.slice(1, MIN_INTERVALS_PER_BAND + 1);
        const comparisonRange = Math.max(...comparison.map(interval => interval.headway))
            - Math.min(...comparison.map(interval => interval.headway));
        if (
            comparisonRange > 5
            || Math.abs(trimmed[0].headway - meanHeadway(comparison)) < BOUNDARY_OUTLIER_DIFFERENCE_MINUTES
        ) break;
        trimmed.shift();
    }
    while (trimmed.length >= MIN_INTERVALS_PER_BAND + 1) {
        const comparison = trimmed.slice(-(MIN_INTERVALS_PER_BAND + 1), -1);
        const comparisonRange = Math.max(...comparison.map(interval => interval.headway))
            - Math.min(...comparison.map(interval => interval.headway));
        if (
            comparisonRange > 5
            || Math.abs(trimmed[trimmed.length - 1].headway - meanHeadway(comparison)) < BOUNDARY_OUTLIER_DIFFERENCE_MINUTES
        ) break;
        trimmed.pop();
    }
    return trimmed;
}

function segmentHeadwaySequence(intervals: HeadwayInterval[]): HeadwayInterval[][] {
    const segments: HeadwayInterval[][] = [intervals];

    while (segments.length < MAX_BANDS_PER_SEQUENCE) {
        let best: { segmentIndex: number; splitIndex: number; gain: number } | null = null;

        segments.forEach((segment, segmentIndex) => {
            if (segment.length < MIN_INTERVALS_PER_BAND * 2) return;
            const unsplitError = squaredError(segment);

            for (
                let splitIndex = MIN_INTERVALS_PER_BAND;
                splitIndex <= segment.length - MIN_INTERVALS_PER_BAND;
                splitIndex++
            ) {
                const left = segment.slice(0, splitIndex);
                const right = segment.slice(splitIndex);
                if (Math.abs(meanHeadway(left) - meanHeadway(right)) < MIN_BAND_DIFFERENCE_MINUTES) continue;
                const gain = unsplitError - squaredError(left) - squaredError(right);
                if (gain > 0 && (!best || gain > best.gain)) {
                    best = { segmentIndex, splitIndex, gain };
                }
            }
        });

        if (!best) break;
        const selected = segments[best.segmentIndex];
        segments.splice(
            best.segmentIndex,
            1,
            selected.slice(0, best.splitIndex),
            selected.slice(best.splitIndex),
        );
    }

    return segments;
}

function buildAveragedBands(departures: number[]): FrequencyRun[] {
    const ordered = [...new Set(departures)].sort((a, b) => a - b);
    if (ordered.length < 2) return [];

    const sequences: HeadwayInterval[][] = [];
    let currentSequence: HeadwayInterval[] = [];
    ordered.slice(1).forEach((departure, index) => {
        const interval = {
            start: ordered[index],
            end: departure,
            headway: departure - ordered[index],
        };
        if (interval.headway < 5 || interval.headway > 120) {
            if (currentSequence.length > 0) sequences.push(currentSequence);
            currentSequence = [];
            return;
        }
        currentSequence.push(interval);
    });
    if (currentSequence.length > 0) sequences.push(currentSequence);

    return sequences.flatMap(sequence => {
        const trimmed = trimBoundaryOutliers(sequence);
        if (trimmed.length < 2) return [];
        return segmentHeadwaySequence(trimmed).map(segment => ({
            headway: roundToNearest(meanHeadway(segment), 5),
            start: segment[0].start,
            end: segment[segment.length - 1].end,
            duration: segment[segment.length - 1].end - segment[0].start,
        }));
    });
}

function summarizeRouteFrequency(departureGroups: number[][]): RouteFrequencySummary {
    const groupRuns = departureGroups.map(buildAveragedBands);
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

        // A route may have multiple simultaneous directions or partial
        // patterns. Use the prevailing scheduled headway rather than an
        // arithmetic mean, which can invent values such as 45 minutes from
        // real 30- and 60-minute patterns.
        const headwayCounts = new Map<number, number>();
        activeHeadways.forEach(headway => headwayCounts.set(headway, (headwayCounts.get(headway) || 0) + 1));
        const headway = [...headwayCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
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

    const totalSlowerDuration = slowerRuns.reduce((sum, run) => sum + run.duration, 0);
    const offPeakHeadway = roundToNearest(
        slowerRuns.reduce((sum, run) => sum + (run.headway * run.duration), 0) / totalSlowerDuration,
        5,
    );

    return {
        peakHeadway,
        peakRuns,
        offPeakHeadway,
        offPeakRuns: slowerRuns,
    };
}

/**
 * Apply the small number of service-plan conventions that cannot be inferred
 * from sustained origin headways alone.
 *
 * Route 2 is communicated as 30/60-minute service even though its interlaced
 * 2A/2B departure gaps average to an artificial 45/50-minute value. Routes
 * 10/11 have short trailing 60-minute regimes that the sustained-band filter
 * would otherwise omit. Routes 100/101 use their 41-minute scheduled loop
 * runtime as the simplified off-peak planning value. On Monday-Saturday that
 * period is only the final loop; Sunday retains the sustained off-peak windows
 * found by the headway analysis. Uniform Sunday service at 60-minute or longer
 * headways is classified as off-peak rather than peak.
 */
function applyStrategicFrequencyConventions(
    routeShortName: string,
    dayType: StrategicPlanDayType,
    summary: RouteFrequencySummary,
    timedTrips: TimedTrip[],
): RouteFrequencySummary {
    if (routeShortName === '2') {
        if (dayType === 'Sunday') {
            const allDayRuns = [...summary.peakRuns, ...summary.offPeakRuns];
            return {
                peakHeadway: null,
                peakRuns: [],
                offPeakHeadway: 60,
                offPeakRuns: allDayRuns.map(run => ({ ...run, headway: 60 })),
            };
        }
        if (summary.offPeakRuns.length > 0) {
            return {
                ...summary,
                offPeakHeadway: 60,
                offPeakRuns: summary.offPeakRuns.map(run => ({ ...run, headway: 60 })),
            };
        }
        return summary;
    }

    if (
        dayType === 'Sunday'
        && routeShortName !== '100'
        && routeShortName !== '101'
        && summary.offPeakHeadway === null
        && summary.peakHeadway !== null
        && summary.peakHeadway >= 60
    ) {
        return {
            peakHeadway: null,
            peakRuns: [],
            offPeakHeadway: summary.peakHeadway,
            offPeakRuns: summary.peakRuns,
        };
    }

    if ((routeShortName === '10' || routeShortName === '11') && dayType !== 'Sunday') {
        const departures = [...new Set(timedTrips.map(entry => entry.timing.firstDeparture))]
            .sort((a, b) => a - b);
        let firstOffPeakIndex = departures.length - 1;
        while (
            firstOffPeakIndex > 0
            && Math.abs(departures[firstOffPeakIndex] - departures[firstOffPeakIndex - 1] - 60) <= 5
        ) {
            firstOffPeakIndex--;
        }
        if (firstOffPeakIndex < departures.length - 1) {
            const offPeakRun: FrequencyRun = {
                headway: 60,
                start: departures[firstOffPeakIndex],
                end: departures[departures.length - 1],
                duration: departures[departures.length - 1] - departures[firstOffPeakIndex],
            };
            return {
                ...summary,
                offPeakHeadway: 60,
                offPeakRuns: [offPeakRun],
            };
        }
        return summary;
    }

    if (routeShortName !== '100' && routeShortName !== '101') return summary;

    if (dayType === 'Sunday') {
        return summary.offPeakRuns.length > 0
            ? { ...summary, offPeakHeadway: 41 }
            : summary;
    }

    const finalTrip = timedTrips.reduce<TimedTrip | null>((latest, candidate) => (
        !latest || candidate.timing.firstDeparture > latest.timing.firstDeparture ? candidate : latest
    ), null);
    if (!finalTrip) return summary;

    const finalRun: FrequencyRun = {
        headway: 41,
        start: finalTrip.timing.firstDeparture,
        end: finalTrip.timing.lastArrival,
        duration: finalTrip.timing.lastArrival - finalTrip.timing.firstDeparture,
    };
    return {
        ...summary,
        offPeakHeadway: 41,
        offPeakRuns: [finalRun],
    };
}

function formatFrequencyRuns(runs: FrequencyRun[]): string {
    if (runs.length === 0) return 'N/A';
    const rounded = runs
        .map(run => ({ start: roundToNearest(run.start, 15), end: roundToNearest(run.end, 15) }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Array<{ start: number; end: number }> = [];
    rounded.forEach(span => {
        const previous = merged[merged.length - 1];
        if (previous && span.start <= previous.end + 15) {
            previous.end = Math.max(previous.end, span.end);
        } else {
            merged.push({ ...span });
        }
    });
    return merged.map(span => formatRoundedSpan(span.start, span.end)).join('; ');
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
            firstStopId: row.stop_id,
            lastSequence: Number.NEGATIVE_INFINITY,
            lastArrival: arrival,
            lastStopId: row.stop_id,
        };
        if (sequence < current.firstSequence) {
            current.firstSequence = sequence;
            current.firstDeparture = departure;
            current.firstStopId = row.stop_id;
        }
        if (sequence > current.lastSequence) {
            current.lastSequence = sequence;
            current.lastArrival = arrival;
            current.lastStopId = row.stop_id;
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
                .filter((entry): entry is TimedTrip => Boolean(entry.timing));

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
                const patternKey = `${timing.firstStopId}->${timing.lastStopId}`;
                const frequencyKey = family.memberShortNames.length > 1
                    ? `${route.shortName}:${directionKey}:${patternKey}`
                    : `${family.shortName}:${directionKey}:${patternKey}`;
                const departures = departuresByGroup.get(frequencyKey) || [];
                departures.push(timing.firstDeparture);
                departuresByGroup.set(frequencyKey, departures);
            });

            const frequencySummary = applyStrategicFrequencyConventions(
                family.shortName,
                dayType,
                summarizeRouteFrequency([...departuresByGroup.values()]),
                timedTrips,
            );

            return {
                routeName,
                routeShortName: family.shortName,
                serviceSpan: formatRoundedSpan(firstDeparture, lastArrival),
                peakFrequencyMinutes: frequencySummary.peakHeadway,
                peakFrequencySpan: formatFrequencyRuns(frequencySummary.peakRuns),
                offPeakFrequencyMinutes: frequencySummary.offPeakHeadway,
                offPeakFrequencySpan: formatFrequencyRuns(frequencySummary.offPeakRuns),
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
