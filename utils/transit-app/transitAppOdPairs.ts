import type {
    ODPair,
    ODPairData,
    TransitAppTripRow,
    TransferDayType,
    TransferSeason,
} from './transitAppTypes';

export type TransitAppODTimePeriod = 'all' | 'am' | 'midday' | 'pm' | 'evening' | 'overnight';
export type TransitAppODDayFilter = 'all' | 'weekday' | 'weekend';
export type TransitAppODSeasonFilter = 'all' | TransferSeason;

export interface TransitAppODTimeFilterDefinition {
    key: TransitAppODTimePeriod;
    label: string;
    shortLabel: string;
    hours: string;
}

export interface MergedTransitAppODPair extends ODPair {
    forwardCount: number;
    reverseCount: number;
    netDirection: 'AB' | 'BA' | 'balanced';
    isMerged: boolean;
}

const RESOLUTION = 0.005;
const CANADA_BOUNDS = {
    minLat: 41.0,
    maxLat: 84.0,
    minLon: -141.5,
    maxLon: -52.0,
};

const TORONTO_TIME_ZONE = 'America/Toronto';

const TORONTO_PART_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
});

export const TRANSIT_APP_OD_TIME_FILTERS: TransitAppODTimeFilterDefinition[] = [
    { key: 'all', label: 'All Day', shortLabel: 'All', hours: '0-23' },
    { key: 'am', label: 'AM Peak', shortLabel: 'AM', hours: '6-9' },
    { key: 'midday', label: 'Midday', shortLabel: 'Mid', hours: '9-15' },
    { key: 'pm', label: 'PM Peak', shortLabel: 'PM', hours: '15-18' },
    { key: 'evening', label: 'Evening', shortLabel: 'Eve', hours: '18-22' },
    { key: 'overnight', label: 'Overnight', shortLabel: 'Night', hours: '22-6' },
];

const TIME_PERIOD_HOURS: Record<TransitAppODTimePeriod, number[]> = {
    all: Array.from({ length: 24 }, (_, hour) => hour),
    am: [6, 7, 8],
    midday: [9, 10, 11, 12, 13, 14],
    pm: [15, 16, 17],
    evening: [18, 19, 20, 21],
    overnight: [22, 23, 0, 1, 2, 3, 4, 5],
};

interface PairAccumulator {
    count: number;
    hourlyBins: number[];
    weekdayCount: number;
    weekendCount: number;
    seasonBins: { jan: number; jul: number; sep: number; other: number };
    odFilterBins: Record<string, number>;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
}

interface PairEntry {
    pair: ODPair;
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

function isValidTransitAppCoordinate(lat: number, lon: number): boolean {
    return Number.isFinite(lat)
        && Number.isFinite(lon)
        && !(lat === 0 && lon === 0)
        && lat >= CANADA_BOUNDS.minLat
        && lat <= CANADA_BOUNDS.maxLat
        && lon >= CANADA_BOUNDS.minLon
        && lon <= CANADA_BOUNDS.maxLon;
}

function parseUtcDateTime(value: string): Date | null {
    if (!value) return null;
    const dt = new Date(value.replace(' UTC', 'Z'));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function getTorontoParts(dt: Date): { year: number; month: number; day: number; hour: number } {
    const parts = TORONTO_PART_FORMATTER.formatToParts(dt);
    const lookup: Record<string, string> = {};
    parts.forEach(part => {
        if (part.type !== 'literal') lookup[part.type] = part.value;
    });

    return {
        year: Number(lookup.year),
        month: Number(lookup.month),
        day: Number(lookup.day),
        hour: Number(lookup.hour),
    };
}

function classifyTripTimestamp(timestamp: string): {
    hour: number;
    dayType: TransferDayType;
    season: TransferSeason | null;
} {
    const dt = parseUtcDateTime(timestamp);
    if (!dt) return { hour: -1, dayType: 'weekday', season: null };

    const local = getTorontoParts(dt);
    const localDay = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const dayType: TransferDayType = localDay === 0
        ? 'sunday'
        : localDay === 6
            ? 'saturday'
            : 'weekday';
    const season: TransferSeason = local.month === 1
        ? 'jan'
        : local.month === 7
            ? 'jul'
            : local.month === 9
                ? 'sep'
                : 'other';

    return { hour: local.hour, dayType, season };
}

function seasonBinTotal(pair: ODPair): number {
    return (pair.seasonBins?.jan ?? 0)
        + (pair.seasonBins?.jul ?? 0)
        + (pair.seasonBins?.sep ?? 0)
        + (pair.seasonBins?.other ?? 0);
}

function sumHourlyBins(pair: ODPair): number {
    return pair.hourlyBins?.reduce((sum, count) => sum + count, 0) ?? 0;
}

function addPairToAccumulator(
    accumulator: PairAccumulator,
    trip: TransitAppTripRow,
    hour: number,
    dayType: TransferDayType,
    season: TransferSeason | null,
): void {
    accumulator.count++;
    if (hour >= 0 && hour < 24) accumulator.hourlyBins[hour]++;
    if (dayType === 'saturday' || dayType === 'sunday') accumulator.weekendCount++;
    else accumulator.weekdayCount++;
    if (season) accumulator.seasonBins[season]++;
    if (hour >= 0 && hour < 24 && season) {
        const filterKey = `${dayType}|${season}|${hour}`;
        accumulator.odFilterBins[filterKey] = (accumulator.odFilterBins[filterKey] || 0) + 1;
    }
    accumulator.minLat = Math.min(accumulator.minLat, trip.start_latitude, trip.end_latitude);
    accumulator.maxLat = Math.max(accumulator.maxLat, trip.start_latitude, trip.end_latitude);
    accumulator.minLon = Math.min(accumulator.minLon, trip.start_longitude, trip.end_longitude);
    accumulator.maxLon = Math.max(accumulator.maxLon, trip.start_longitude, trip.end_longitude);
}

export function aggregateTransitAppODPairs(
    trips: TransitAppTripRow[],
    options: { maxPairs?: number } = {},
): ODPairData {
    const pairMap = new Map<string, PairAccumulator>();
    let skipped = 0;

    for (const trip of trips) {
        const oLat = trip.start_latitude;
        const oLon = trip.start_longitude;
        const dLat = trip.end_latitude;
        const dLon = trip.end_longitude;

        if (!isValidTransitAppCoordinate(oLat, oLon) || !isValidTransitAppCoordinate(dLat, dLon)) {
            skipped++;
            continue;
        }

        const oLatBin = Math.round(oLat / RESOLUTION) * RESOLUTION;
        const oLonBin = Math.round(oLon / RESOLUTION) * RESOLUTION;
        const dLatBin = Math.round(dLat / RESOLUTION) * RESOLUTION;
        const dLonBin = Math.round(dLon / RESOLUTION) * RESOLUTION;

        if (oLatBin === dLatBin && oLonBin === dLonBin) {
            skipped++;
            continue;
        }

        const { hour, dayType, season } = classifyTripTimestamp(trip.timestamp);
        const key = `${oLatBin.toFixed(4)}_${oLonBin.toFixed(4)}|${dLatBin.toFixed(4)}_${dLonBin.toFixed(4)}`;
        let accumulator = pairMap.get(key);
        if (!accumulator) {
            accumulator = {
                count: 0,
                hourlyBins: new Array(24).fill(0),
                weekdayCount: 0,
                weekendCount: 0,
                seasonBins: { jan: 0, jul: 0, sep: 0, other: 0 },
                odFilterBins: {},
                minLat: 90,
                maxLat: -90,
                minLon: 180,
                maxLon: -180,
            };
            pairMap.set(key, accumulator);
        }

        addPairToAccumulator(accumulator, trip, hour, dayType, season);
    }

    const allEntries: PairEntry[] = Array.from(pairMap.entries())
        .map(([key, data]) => {
            const [originPart, destPart] = key.split('|');
            const [originLat, originLon] = originPart.split('_').map(Number);
            const [destLat, destLon] = destPart.split('_').map(Number);
            return {
                pair: {
                    originLat,
                    originLon,
                    destLat,
                    destLon,
                    count: data.count,
                    hourlyBins: data.hourlyBins,
                    weekdayCount: data.weekdayCount,
                    weekendCount: data.weekendCount,
                    seasonBins: data.seasonBins,
                    odFilterBins: data.odFilterBins,
                },
                bounds: {
                    minLat: data.minLat,
                    maxLat: data.maxLat,
                    minLon: data.minLon,
                    maxLon: data.maxLon,
                },
            };
        })
        .sort((a, b) => b.pair.count - a.pair.count);

    const retainedEntries = typeof options.maxPairs === 'number'
        ? allEntries.slice(0, Math.max(0, options.maxPairs))
        : allEntries;
    const pairs = retainedEntries.map(entry => entry.pair);
    const retainedTrips = pairs.reduce((sum, pair) => sum + pair.count, 0);
    const processed = trips.length - skipped;
    const seasonTotals = { jan: 0, jul: 0, sep: 0, other: 0 };
    pairs.forEach(pair => {
        seasonTotals.jan += pair.seasonBins?.jan ?? 0;
        seasonTotals.jul += pair.seasonBins?.jul ?? 0;
        seasonTotals.sep += pair.seasonBins?.sep ?? 0;
        seasonTotals.other += pair.seasonBins?.other ?? 0;
    });

    const bounds = retainedEntries.length > 0
        ? retainedEntries.reduce((acc, entry) => ({
            minLat: Math.min(acc.minLat, entry.bounds.minLat),
            maxLat: Math.max(acc.maxLat, entry.bounds.maxLat),
            minLon: Math.min(acc.minLon, entry.bounds.minLon),
            maxLon: Math.max(acc.maxLon, entry.bounds.maxLon),
        }), { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 })
        : { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

    return {
        pairs,
        resolution: RESOLUTION,
        totalTripsProcessed: processed,
        totalTripsSkipped: skipped,
        bounds,
        seasonTotals,
        totalPairsGenerated: allEntries.length,
        totalTripsRetained: retainedTrips,
        totalTripsDroppedByPairLimit: Math.max(0, processed - retainedTrips),
    };
}

export function getHoursForODTimePeriod(period: TransitAppODTimePeriod): number[] {
    return TIME_PERIOD_HOURS[period];
}

export function getODPairCountForFilters(
    pair: ODPair,
    timePeriod: TransitAppODTimePeriod,
    dayFilter: TransitAppODDayFilter,
    seasonFilter: TransitAppODSeasonFilter,
): number {
    if (pair.odFilterBins && (timePeriod !== 'all' || dayFilter !== 'all' || seasonFilter !== 'all')) {
        const days: TransferDayType[] = dayFilter === 'weekday'
            ? ['weekday']
            : dayFilter === 'weekend'
                ? ['saturday', 'sunday']
                : ['weekday', 'saturday', 'sunday'];
        const seasons: TransferSeason[] = seasonFilter === 'all'
            ? ['jan', 'jul', 'sep', 'other']
            : [seasonFilter];
        const hours = getHoursForODTimePeriod(timePeriod);

        let exact = 0;
        for (const day of days) {
            for (const season of seasons) {
                for (const hour of hours) {
                    exact += pair.odFilterBins[`${day}|${season}|${hour}`] || 0;
                }
            }
        }
        return exact;
    }

    const activeCounts: number[] = [];
    if (timePeriod !== 'all') {
        activeCounts.push(getHoursForODTimePeriod(timePeriod).reduce(
            (sum, hour) => sum + (pair.hourlyBins?.[hour] ?? 0),
            0,
        ));
    }
    if (dayFilter !== 'all') {
        activeCounts.push(dayFilter === 'weekday' ? pair.weekdayCount ?? 0 : pair.weekendCount ?? 0);
    }
    if (seasonFilter !== 'all') {
        activeCounts.push(pair.seasonBins?.[seasonFilter] ?? 0);
    }

    return activeCounts.length === 0 ? pair.count : Math.min(pair.count, ...activeCounts);
}

function coordKey(lat: number, lon: number): string {
    return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

function addHourlyBins(target: number[] | undefined, source: number[] | undefined): number[] | undefined {
    if (!target && !source) return undefined;
    const next = target ? [...target] : new Array(24).fill(0);
    source?.forEach((count, index) => {
        next[index] = (next[index] || 0) + count;
    });
    return next;
}

function addSeasonBins(target: ODPair['seasonBins'], source: ODPair['seasonBins']): ODPair['seasonBins'] {
    if (!target && !source) return undefined;
    return {
        jan: (target?.jan ?? 0) + (source?.jan ?? 0),
        jul: (target?.jul ?? 0) + (source?.jul ?? 0),
        sep: (target?.sep ?? 0) + (source?.sep ?? 0),
        other: (target?.other ?? 0) + (source?.other ?? 0),
    };
}

function addFilterBins(
    target: ODPair['odFilterBins'],
    source: ODPair['odFilterBins'],
): ODPair['odFilterBins'] {
    if (!target && !source) return undefined;
    const next: Record<string, number> = { ...(target || {}) };
    Object.entries(source || {}).forEach(([key, count]) => {
        next[key] = (next[key] || 0) + count;
    });
    return next;
}

function recalculateNetDirection(pair: MergedTransitAppODPair): void {
    const diff = pair.forwardCount - pair.reverseCount;
    const maxDirectional = Math.max(pair.forwardCount, pair.reverseCount);
    pair.netDirection = Math.abs(diff) < maxDirectional * 0.2
        ? 'balanced'
        : diff > 0
            ? 'AB'
            : 'BA';
}

export function mergeBidirectionalODPairs(pairs: ODPair[]): MergedTransitAppODPair[] {
    const mergeMap = new Map<string, MergedTransitAppODPair>();

    for (const pair of pairs) {
        const keyAB = `${coordKey(pair.originLat, pair.originLon)}|${coordKey(pair.destLat, pair.destLon)}`;
        const keyBA = `${coordKey(pair.destLat, pair.destLon)}|${coordKey(pair.originLat, pair.originLon)}`;
        const canonical = keyAB < keyBA ? keyAB : keyBA;
        const isForward = keyAB <= keyBA;

        let merged = mergeMap.get(canonical);
        if (!merged) {
            merged = {
                originLat: isForward ? pair.originLat : pair.destLat,
                originLon: isForward ? pair.originLon : pair.destLon,
                destLat: isForward ? pair.destLat : pair.originLat,
                destLon: isForward ? pair.destLon : pair.originLon,
                count: 0,
                forwardCount: 0,
                reverseCount: 0,
                netDirection: 'balanced',
                isMerged: true,
                hourlyBins: undefined,
                weekdayCount: 0,
                weekendCount: 0,
                seasonBins: undefined,
                odFilterBins: undefined,
            };
            mergeMap.set(canonical, merged);
        }

        if (isForward) merged.forwardCount += pair.count;
        else merged.reverseCount += pair.count;
        merged.count += pair.count;
        merged.hourlyBins = addHourlyBins(merged.hourlyBins, pair.hourlyBins);
        merged.weekdayCount = (merged.weekdayCount ?? 0) + (pair.weekdayCount ?? 0);
        merged.weekendCount = (merged.weekendCount ?? 0) + (pair.weekendCount ?? 0);
        merged.seasonBins = addSeasonBins(merged.seasonBins, pair.seasonBins);
        merged.odFilterBins = addFilterBins(merged.odFilterBins, pair.odFilterBins);
        recalculateNetDirection(merged);
    }

    return Array.from(mergeMap.values()).sort((a, b) => b.count - a.count);
}

export function toUnmergedODPair(pair: ODPair): MergedTransitAppODPair {
    return {
        ...pair,
        forwardCount: pair.count,
        reverseCount: 0,
        netDirection: 'AB',
        isMerged: false,
    };
}

export function getDirectionalCountsForZone(
    pair: MergedTransitAppODPair,
    zoneKey: string,
): { outbound: number; inbound: number } | null {
    const originKey = coordKey(pair.originLat, pair.originLon);
    const destKey = coordKey(pair.destLat, pair.destLon);

    if (zoneKey === originKey) {
        return { outbound: pair.forwardCount, inbound: pair.reverseCount };
    }
    if (zoneKey === destKey) {
        return { outbound: pair.reverseCount, inbound: pair.forwardCount };
    }
    return null;
}

export function validateODPairTotals(pair: ODPair): boolean {
    const dayTotal = (pair.weekdayCount ?? 0) + (pair.weekendCount ?? 0);
    const seasonTotal = seasonBinTotal(pair);
    const hourlyTotal = sumHourlyBins(pair);
    return dayTotal === pair.count && seasonTotal === pair.count && hourlyTotal === pair.count;
}
