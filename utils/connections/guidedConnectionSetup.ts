/**
 * Setup helpers for Guided Schedule connections: matching saved services to
 * this route's stops (by code or by hub name), day-correct times for
 * route-to-route targets, and default rules.
 */

import type { DayType, MasterRouteTable } from '../parsers/masterScheduleParser';
import type { ConnectionLibrary, ConnectionTarget, ConnectionTime, ConnectionType, RouteConnection, StopInfo } from './connectionTypes';
import { generateConnectionId, parseConnectionTime } from './connectionTypes';

export type ConnectionSourceKind = 'route' | 'go' | 'linx' | 'other';

/** "Downtown Hub Platform 5", "Downtown Hub (2)" and "Downtown Hub" all match. */
export const normalizeStopForMatch = (name?: string): string => (
    (name || '')
        .toLowerCase()
        .replace(/\(\d+\)/g, ' ')
        .replace(/\b(platform|bay|stop|plat\.?)\s*[a-z0-9]+\b/g, ' ')
        .replace(/\bgo( station)?\b/g, ' go ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
);

/** The stop on this route a saved service meets at: same code, same hub name, or a single name containing the location. */
export const findRouteStopForTarget = (
    target: Pick<ConnectionTarget, 'stopCode' | 'stopCodes' | 'stopName' | 'location'>,
    routeStops: StopInfo[]
): StopInfo | null => {
    const codes = [target.stopCode, ...(target.stopCodes || [])].map(code => (code || '').trim()).filter(Boolean);
    const byCode = routeStops.find(stop => codes.includes(stop.code.trim()));
    if (byCode) return byCode;

    for (const raw of [target.stopName, target.location]) {
        const name = normalizeStopForMatch(raw);
        if (!name) continue;
        const exact = routeStops.find(stop => normalizeStopForMatch(stop.name) === name);
        if (exact) return exact;
        const contains = routeStops.filter(stop => {
            const stopName = normalizeStopForMatch(stop.name);
            return stopName.length > 3 && (name.includes(stopName) || stopName.includes(name));
        });
        if (contains.length === 1) return contains[0];
    }
    return null;
};

export const getTargetSourceKind = (target: Pick<ConnectionTarget, 'type' | 'icon' | 'name' | 'source'>): ConnectionSourceKind => {
    if (target.source === 'linx-gtfs' || /\blinx\b/i.test(target.name)) return 'linx';
    if (target.source === 'go-gtfs' || target.icon === 'train' || /\bgo\b/i.test(target.name)) return 'go';
    if (target.type === 'route') return 'route';
    return 'other';
};

/** Default rule for a new connection: rail gets a wider window than a bus-to-bus transfer. */
export const defaultRuleForTarget = (
    target: Pick<ConnectionTarget, 'type' | 'icon' | 'name' | 'source' | 'defaultEventType'>
): { connectionType: ConnectionType; bufferMinutes: number; maxWaitMinutes: number } => {
    const connectionType: ConnectionType = target.defaultEventType === 'arrival' ? 'feed_arriving' : 'meet_departing';
    const kind = getTargetSourceKind(target);
    if (kind === 'go') return { connectionType, bufferMinutes: 5, maxWaitMinutes: 15 };
    if (kind === 'route') return { connectionType, bufferMinutes: 2, maxWaitMinutes: 8 };
    return { connectionType, bufferMinutes: 3, maxWaitMinutes: 12 };
};

export const buildConnectionForTarget = (
    target: ConnectionTarget,
    stop: StopInfo,
    priority: number
): RouteConnection => ({
    id: generateConnectionId(),
    targetId: target.id,
    stopCode: stop.code,
    stopName: stop.name,
    priority,
    enabled: true,
    ...defaultRuleForTarget(target),
});

export interface ConnectionSuggestion {
    target: ConnectionTarget;
    stop: StopInfo;
    reason: 'same-stop' | 'same-hub';
}

/** Saved services that meet this route at one of its stops and are not set up yet. */
export const suggestConnections = (
    library: Pick<ConnectionLibrary, 'targets'> | null,
    connections: RouteConnection[],
    routeStops: StopInfo[],
    currentRouteNumber?: string
): ConnectionSuggestion[] => {
    if (!library) return [];
    const used = new Set(connections.map(connection => connection.targetId));
    const ownRoute = currentRouteNumber?.trim().toUpperCase();
    return library.targets.flatMap(target => {
        if (used.has(target.id)) return [];
        if (ownRoute && target.routeIdentity && target.routeIdentity.split('-')[0].toUpperCase() === ownRoute) return [];
        const stop = findRouteStopForTarget(target, routeStops);
        if (!stop) return [];
        const sameCode = [target.stopCode, ...(target.stopCodes || [])].some(code => (code || '').trim() === stop.code.trim());
        return [{ target, stop, reason: sameCode ? 'same-stop' as const : 'same-hub' as const }];
    });
};

// ---------- route-to-route targets ----------

/** "8A-Weekday" for Saturday → "8A-Saturday". */
export const toDayRouteIdentity = (routeIdentity: string, dayType: DayType): string => (
    `${routeIdentity.replace(/-(Weekday|Saturday|Sunday)$/i, '')}-${dayType}`
);

const OPERATIONAL_DAY_START = 210;

/** Times another route serves a stop on one day type, from its master table. */
export const deriveRouteTargetTimes = (
    table: Pick<MasterRouteTable, 'trips' | 'stopIds'>,
    stopName: string,
    dayType: DayType
): ConnectionTime[] => {
    const times = new Set<number>();
    for (const trip of table.trips) {
        const minutes = trip.stopMinutes?.[stopName];
        if (typeof minutes === 'number') {
            times.add(minutes);
            continue;
        }
        const value = trip.stops?.[stopName];
        if (!value) continue;
        const parsed = parseConnectionTime(value);
        if (parsed === 0 && !/^12:00/i.test(value) && !/^0?0:00/i.test(value)) continue;
        const afterMidnightTrip = trip.startTime >= 1440 || trip.startTime < OPERATIONAL_DAY_START;
        times.add(parsed < 1440 && afterMidnightTrip ? parsed + 1440 : parsed);
    }
    return [...times].sort((a, b) => a - b).map(time => ({
        id: generateConnectionId(),
        time,
        daysActive: [dayType],
        enabled: true,
    }));
};

/** Stop on another route's table that matches a target (by code, then by hub name). */
export const findStopNameInTable = (
    table: Pick<MasterRouteTable, 'stops' | 'stopIds'>,
    target: Pick<ConnectionTarget, 'stopCode' | 'stopName'>
): string | null => {
    const byCode = Object.entries(table.stopIds || {}).find(([, code]) => code === target.stopCode)?.[0];
    if (byCode) return byCode;
    const wanted = normalizeStopForMatch(target.stopName);
    if (!wanted) return null;
    return table.stops.find(stop => normalizeStopForMatch(stop) === wanted) ?? null;
};

/**
 * Library for one day type: route-to-route targets get that day's times from
 * the matching master (e.g. 8A-Saturday), so a Weekday-built target still
 * works on Saturday. Targets with no master for the day keep only times that
 * already run that day.
 */
export const buildDayLibrary = (
    library: ConnectionLibrary,
    dayType: DayType,
    dayTimesByTargetId: Record<string, ConnectionTime[] | undefined>
): ConnectionLibrary => ({
    ...library,
    targets: library.targets.map(target => {
        const dayTimes = dayTimesByTargetId[target.id];
        if (target.type !== 'route' || !dayTimes) return target;
        const otherDays = (target.times || []).filter(time => !time.daysActive?.includes(dayType));
        return { ...target, times: [...otherDays, ...dayTimes] };
    }),
});

/** Adds a target, or replaces one day's times on an existing target with the same name. */
export const upsertTargetForDay = (
    library: ConnectionLibrary,
    incoming: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>,
    dayType: DayType,
    userId: string
): { library: ConnectionLibrary; target: ConnectionTarget } => {
    const now = new Date().toISOString();
    const existing = library.targets.find(target => target.name.trim().toLowerCase() === incoming.name.trim().toLowerCase());
    const dayTimes = (incoming.times || []).map(time => ({ ...time, daysActive: [dayType] }));
    if (existing) {
        const keep = (existing.times || [])
            .map(time => ({ ...time, daysActive: (time.daysActive || []).filter(day => day !== dayType) }))
            .filter(time => time.daysActive.length > 0);
        const target: ConnectionTarget = { ...existing, ...incoming, id: existing.id, createdAt: existing.createdAt, updatedAt: now, times: [...keep, ...dayTimes] };
        return {
            library: { ...library, targets: library.targets.map(item => item.id === existing.id ? target : item), updatedAt: now, updatedBy: userId },
            target,
        };
    }
    const target: ConnectionTarget = {
        ...incoming,
        id: `target_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
        times: dayTimes,
    };
    return { library: { ...library, targets: [...library.targets, target], updatedAt: now, updatedBy: userId }, target };
};

/** Reads times typed or pasted in any common format ("7:15 AM", "7:15a", "19:15"). */
export const parsePastedTimes = (text: string): number[] => {
    const found = text.match(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m?\.?)?/gi) || [];
    const times = found
        .map(value => parseConnectionTime(value.replace(/\./g, '').replace(/\s+/g, ' ').trim()))
        .filter(minutes => minutes > 0);
    return [...new Set(times)].sort((a, b) => a - b);
};
