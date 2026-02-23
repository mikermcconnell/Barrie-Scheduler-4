import routesRaw from '../../gtfs/routes.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import calendarRaw from '../../gtfs/calendar.txt?raw';
import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import type { RouteSupplyProfile, TransferDayType } from './transitAppTypes';

type DayTypeBucket = 'weekday' | 'saturday' | 'sunday';

export interface RouteServiceLevel {
    route: string;
    weekday: number;
    saturday: number;
    sunday: number;
}

export interface ServiceFlags {
    weekday: boolean;
    saturday: boolean;
    sunday: boolean;
}

interface RouteServiceAccumulator {
    route: string;
    dayType: TransferDayType;
    departuresByHour: number[];
    departureTimes: number[];
}

let cachedServiceLevels: Map<string, RouteServiceLevel> | null = null;
let cachedSupplyProfiles: Map<string, RouteSupplyProfile> | null = null;

export function parseCsvRow(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    values.push(current.trim());
    return values;
}

export function buildHeaderIndex(headerLine: string): Map<string, number> {
    const headers = parseCsvRow(headerLine).map(h => h.replace(/^\uFEFF/, '').trim());
    const index = new Map<string, number>();
    headers.forEach((h, i) => index.set(h, i));
    return index;
}

function parseBit(value: string | undefined): number {
    const parsed = Number.parseInt(value || '0', 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRoute(route: string): string {
    return route.trim().toUpperCase();
}

export function parseGtfsTimeToMinutes(value: string | undefined): number | null {
    if (!value) return null;
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;

    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (minute < 0 || minute >= 60) return null;
    return (hour * 60) + minute;
}

export function getRouteIdToShortName(): Map<string, string> {
    const routeMap = new Map<string, string>();
    const routeLines = routesRaw.trim().split(/\r?\n/);
    if (routeLines.length <= 1) return routeMap;

    const idx = buildHeaderIndex(routeLines[0]);
    const routeIdIdx = idx.get('route_id') ?? -1;
    const shortNameIdx = idx.get('route_short_name') ?? -1;

    for (let i = 1; i < routeLines.length; i++) {
        const line = routeLines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const routeId = routeIdIdx >= 0 ? (values[routeIdIdx] || '') : '';
        const shortName = shortNameIdx >= 0 ? (values[shortNameIdx] || '') : '';
        if (!routeId || !shortName) continue;
        routeMap.set(routeId, normalizeRoute(shortName));
    }

    return routeMap;
}

export function getServiceFlagsById(): Map<string, ServiceFlags> {
    const serviceMap = new Map<string, ServiceFlags>();
    const calendarLines = calendarRaw.trim().split(/\r?\n/);
    if (calendarLines.length <= 1) return serviceMap;

    const idx = buildHeaderIndex(calendarLines[0]);
    const sidIdx = idx.get('service_id') ?? -1;

    for (let i = 1; i < calendarLines.length; i++) {
        const line = calendarLines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const serviceId = sidIdx >= 0 ? (values[sidIdx] || '') : '';
        if (!serviceId) continue;

        const weekday = (
            parseBit(values[idx.get('monday') ?? -1])
            + parseBit(values[idx.get('tuesday') ?? -1])
            + parseBit(values[idx.get('wednesday') ?? -1])
            + parseBit(values[idx.get('thursday') ?? -1])
            + parseBit(values[idx.get('friday') ?? -1])
        ) > 0;

        serviceMap.set(serviceId, {
            weekday,
            saturday: parseBit(values[idx.get('saturday') ?? -1]) > 0,
            sunday: parseBit(values[idx.get('sunday') ?? -1]) > 0,
        });
    }

    return serviceMap;
}

export function getTripToRouteAndService(routeMap: Map<string, string>): Map<string, { route: string; serviceId: string }> {
    const tripMap = new Map<string, { route: string; serviceId: string }>();
    const tripLines = tripsRaw.trim().split(/\r?\n/);
    if (tripLines.length <= 1) return tripMap;

    const idx = buildHeaderIndex(tripLines[0]);
    const routeIdIdx = idx.get('route_id') ?? -1;
    const serviceIdIdx = idx.get('service_id') ?? -1;
    const tripIdIdx = idx.get('trip_id') ?? -1;

    for (let i = 1; i < tripLines.length; i++) {
        const line = tripLines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const routeId = routeIdIdx >= 0 ? (values[routeIdIdx] || '') : '';
        const serviceId = serviceIdIdx >= 0 ? (values[serviceIdIdx] || '') : '';
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        if (!tripId || !routeId || !serviceId) continue;

        const routeShortName = routeMap.get(routeId);
        if (!routeShortName) continue;

        tripMap.set(tripId, {
            route: routeShortName,
            serviceId,
        });
    }

    return tripMap;
}

function getFirstDepartureMinutesByTrip(): Map<string, number> {
    const firstByTrip = new Map<string, { stopSequence: number; depMin: number }>();
    const stopTimeLines = stopTimesRaw.trim().split(/\r?\n/);
    if (stopTimeLines.length <= 1) return new Map<string, number>();

    const idx = buildHeaderIndex(stopTimeLines[0]);
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const depIdx = idx.get('departure_time') ?? -1;
    const arrIdx = idx.get('arrival_time') ?? -1;
    const seqIdx = idx.get('stop_sequence') ?? -1;

    for (let i = 1; i < stopTimeLines.length; i++) {
        const line = stopTimeLines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        if (!tripId) continue;

        const depMin = parseGtfsTimeToMinutes(depIdx >= 0 ? values[depIdx] : undefined)
            ?? parseGtfsTimeToMinutes(arrIdx >= 0 ? values[arrIdx] : undefined);
        if (depMin === null) continue;

        const seqRaw = seqIdx >= 0 ? values[seqIdx] : '';
        const stopSequence = Number.parseInt(seqRaw || '999999', 10);
        const sequence = Number.isFinite(stopSequence) ? stopSequence : 999999;

        const existing = firstByTrip.get(tripId);
        if (!existing || sequence < existing.stopSequence || (sequence === existing.stopSequence && depMin < existing.depMin)) {
            firstByTrip.set(tripId, { stopSequence: sequence, depMin });
        }
    }

    const flattened = new Map<string, number>();
    for (const [tripId, value] of firstByTrip.entries()) {
        flattened.set(tripId, value.depMin);
    }
    return flattened;
}

function computeAverageHeadwayMinutes(sortedDepartureMins: number[]): number | null {
    if (sortedDepartureMins.length < 2) return null;
    let sum = 0;
    let count = 0;
    for (let i = 1; i < sortedDepartureMins.length; i++) {
        const diff = sortedDepartureMins[i] - sortedDepartureMins[i - 1];
        if (diff > 0 && Number.isFinite(diff)) {
            sum += diff;
            count++;
        }
    }
    if (count === 0) return null;
    return Math.round(sum / count);
}

function buildRouteSupplyProfiles(): Map<string, RouteSupplyProfile> {
    const routeMap = getRouteIdToShortName();
    const serviceFlagsById = getServiceFlagsById();
    const tripMap = getTripToRouteAndService(routeMap);
    const firstDepartureByTrip = getFirstDepartureMinutesByTrip();

    const accumulators = new Map<string, RouteServiceAccumulator>();

    const addDeparture = (route: string, dayType: TransferDayType, depMin: number) => {
        const key = `${route}|${dayType}`;
        let acc = accumulators.get(key);
        if (!acc) {
            acc = {
                route,
                dayType,
                departuresByHour: new Array(24).fill(0),
                departureTimes: [],
            };
            accumulators.set(key, acc);
        }
        const hour = Math.floor(depMin / 60) % 24;
        const normalizedHour = hour < 0 ? hour + 24 : hour;
        acc.departuresByHour[normalizedHour]++;
        acc.departureTimes.push(depMin);
    };

    for (const [tripId, depMin] of firstDepartureByTrip.entries()) {
        const trip = tripMap.get(tripId);
        if (!trip) continue;
        const serviceFlags = serviceFlagsById.get(trip.serviceId);
        if (!serviceFlags) continue;

        if (serviceFlags.weekday) addDeparture(trip.route, 'weekday', depMin);
        if (serviceFlags.saturday) addDeparture(trip.route, 'saturday', depMin);
        if (serviceFlags.sunday) addDeparture(trip.route, 'sunday', depMin);
    }

    const profiles = new Map<string, RouteSupplyProfile>();
    for (const [key, acc] of accumulators.entries()) {
        const sortedDepartureMins = [...acc.departureTimes].sort((a, b) => a - b);
        const firstDepartureMin = sortedDepartureMins.length > 0 ? sortedDepartureMins[0] : null;
        const lastDepartureMin = sortedDepartureMins.length > 0 ? sortedDepartureMins[sortedDepartureMins.length - 1] : null;

        profiles.set(key, {
            route: acc.route,
            dayType: acc.dayType,
            firstDepartureMin,
            lastDepartureMin,
            avgHeadwayMinutes: computeAverageHeadwayMinutes(sortedDepartureMins),
            departuresByHour: acc.departuresByHour,
            totalDepartures: sortedDepartureMins.length,
        });
    }

    return profiles;
}

function getSupplyProfiles(): Map<string, RouteSupplyProfile> {
    if (!cachedSupplyProfiles) {
        cachedSupplyProfiles = buildRouteSupplyProfiles();
    }
    return cachedSupplyProfiles;
}

function buildRouteServiceLevels(): Map<string, RouteServiceLevel> {
    const routeMap = getRouteIdToShortName();
    const serviceMap = getServiceFlagsById();
    const serviceLevels = new Map<string, RouteServiceLevel>();

    const tripLines = tripsRaw.trim().split(/\r?\n/);
    if (tripLines.length <= 1) return serviceLevels;

    const idx = buildHeaderIndex(tripLines[0]);
    const routeIdIdx = idx.get('route_id') ?? -1;
    const serviceIdIdx = idx.get('service_id') ?? -1;

    for (let i = 1; i < tripLines.length; i++) {
        const line = tripLines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const routeId = routeIdIdx >= 0 ? (values[routeIdIdx] || '') : '';
        const serviceId = serviceIdIdx >= 0 ? (values[serviceIdIdx] || '') : '';
        if (!routeId || !serviceId) continue;

        const routeShortName = routeMap.get(routeId);
        const service = serviceMap.get(serviceId);
        if (!routeShortName || !service) continue;

        const existing = serviceLevels.get(routeShortName) || {
            route: routeShortName,
            weekday: 0,
            saturday: 0,
            sunday: 0,
        };

        if (service.weekday) existing.weekday += 1;
        if (service.saturday) existing.saturday += 1;
        if (service.sunday) existing.sunday += 1;

        serviceLevels.set(routeShortName, existing);
    }

    return serviceLevels;
}

function getServiceLevels(): Map<string, RouteServiceLevel> {
    if (!cachedServiceLevels) {
        cachedServiceLevels = buildRouteServiceLevels();
    }
    return cachedServiceLevels;
}

function getDayTypeBucket(date: string): DayTypeBucket | null {
    const dt = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return null;
    const day = dt.getUTCDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

export function getScheduledTripsForRouteOnDate(route: string, date: string): number | null {
    const dayType = getDayTypeBucket(date);
    if (!dayType) return null;

    const service = getServiceLevels().get(normalizeRoute(route));
    if (!service) return null;

    const value = service[dayType];
    return Number.isFinite(value) ? value : null;
}

export function getRouteServiceLevels(): RouteServiceLevel[] {
    return Array.from(getServiceLevels().values()).sort((a, b) => a.route.localeCompare(b.route));
}

export function hasGtfsNormalizationData(): boolean {
    return getServiceLevels().size > 0;
}

export function getRouteSupplyProfile(route: string, dayType: TransferDayType): RouteSupplyProfile | null {
    const key = `${normalizeRoute(route)}|${dayType}`;
    return getSupplyProfiles().get(key) || null;
}

export function getRouteSupplyProfiles(dayType?: TransferDayType): RouteSupplyProfile[] {
    const rows = Array.from(getSupplyProfiles().values());
    const filtered = dayType ? rows.filter(row => row.dayType === dayType) : rows;
    return filtered.sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }) || a.dayType.localeCompare(b.dayType));
}

export function hasGtfsSupplyProfiles(): boolean {
    return getSupplyProfiles().size > 0;
}
