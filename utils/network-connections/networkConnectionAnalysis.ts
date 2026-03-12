import { loadGtfsRouteShapes } from '../gtfs/gtfsShapesLoader';
import { getAllStopsWithCoords } from '../gtfs/gtfsStopLookup';
import type { DayType, MasterScheduleEntry } from '../masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type {
    NetworkConnectionAnalysisResult,
    NetworkConnectionClass,
    NetworkConnectionHub,
    NetworkConnectionHubStop,
    NetworkConnectionOpportunity,
    NetworkConnectionPattern,
    NetworkConnectionRecommendation,
    NetworkConnectionScheduleInput,
    NetworkConnectionServiceRef,
    NetworkConnectionSeverity,
    NetworkConnectionThresholds,
    NetworkConnectionTimeBand,
} from './networkConnectionTypes';

export const DEFAULT_NETWORK_CONNECTION_THRESHOLDS: NetworkConnectionThresholds = {
    nearbyRadiusMeters: 120,
    maxWaitMinutes: 20,
    nearbyWalkPenaltyMinutes: 2,
    tightMaxMinutes: 2,
    goodMaxMinutes: 7,
    longMaxMinutes: 12,
};

interface ServiceEvent {
    service: NetworkConnectionServiceRef;
    tripId: string;
    stopId: string;
    stopName: string;
    time: number;
    timeBand: NetworkConnectionTimeBand;
}

interface HubSeed {
    id: string;
    name: string;
    lat: number;
    lon: number;
    hubType: 'shared_stop' | 'nearby_cluster';
    stops: NetworkConnectionHubStop[];
}

interface AnalyzeNetworkConnectionsInput {
    schedules: NetworkConnectionScheduleInput[];
    dayType: DayType;
    timeBand: NetworkConnectionTimeBand;
    thresholds?: Partial<NetworkConnectionThresholds>;
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

function routeColorLookup(): Map<string, string> {
    return new Map(loadGtfsRouteShapes().map((shape) => [shape.routeShortName.trim().toUpperCase(), shape.routeColor]));
}

function stopCoordLookup(): Map<string, { lat: number; lon: number; stopName: string }> {
    return new Map(
        getAllStopsWithCoords().map((stop) => [stop.stop_id, { lat: stop.lat, lon: stop.lon, stopName: stop.stop_name }]),
    );
}

function parseTripStopMinutes(trip: MasterTrip, stopName: string): number | null {
    const fromMinutes = trip.stopMinutes?.[stopName];
    if (typeof fromMinutes === 'number' && Number.isFinite(fromMinutes)) return fromMinutes;

    const raw = trip.stops?.[stopName];
    if (!raw) return null;

    const trimmed = raw.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = match[3]?.toUpperCase();

    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    return (hours * 60) + minutes;
}

function getTimeBand(minutes: number): NetworkConnectionTimeBand {
    const hour = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
    if (hour >= 6 && hour < 9) return 'am_peak';
    if (hour >= 9 && hour < 15) return 'midday';
    if (hour >= 15 && hour < 18) return 'pm_peak';
    return 'evening';
}

function matchesTimeBand(minutes: number, band: NetworkConnectionTimeBand): boolean {
    return band === 'full_day' ? true : getTimeBand(minutes) === band;
}

function normalizeStopName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function parseDirection(table: MasterRouteTable, fallback: 'North' | 'South'): 'North' | 'South' {
    if (table.routeName.includes('(South)')) return 'South';
    if (table.routeName.includes('(North)')) return 'North';
    return fallback;
}

function buildServiceRef(
    entry: MasterScheduleEntry,
    table: MasterRouteTable,
    fallbackDirection: 'North' | 'South',
    colors: Map<string, string>,
): NetworkConnectionServiceRef {
    const direction = parseDirection(table, fallbackDirection);
    const routeNumber = entry.routeNumber;
    const color = colors.get(routeNumber.trim().toUpperCase()) ?? null;

    return {
        key: `${entry.id}-${direction}`,
        routeIdentity: entry.id,
        routeNumber,
        dayType: entry.dayType,
        direction,
        label: `Route ${routeNumber} ${direction}`,
        routeColor: color,
    };
}

function buildServiceEventsForTable(
    service: NetworkConnectionServiceRef,
    table: MasterRouteTable,
): ServiceEvent[] {
    const stopNames = new Set(table.stops.map(normalizeStopName));
    const events: ServiceEvent[] = [];

    for (const trip of table.trips) {
        for (const stopName of stopNames) {
            const stopId = table.stopIds?.[stopName];
            if (!stopId) continue;
            const time = parseTripStopMinutes(trip, stopName);
            if (time == null) continue;
            events.push({
                service,
                tripId: trip.id,
                stopId,
                stopName,
                time,
                timeBand: getTimeBand(time),
            });
        }
    }

    return events;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number): number => deg * Math.PI / 180;
    const earthRadius = 6371_000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function classifySeverity(missRate: number, goodRate: number): NetworkConnectionSeverity {
    if (missRate >= 0.45) return 'weak';
    if (goodRate >= 0.6 && missRate <= 0.15) return 'strong';
    return 'mixed';
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? round((sorted[mid - 1] + sorted[mid]) / 2)
        : round(sorted[mid]);
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildRecommendations(
    hub: HubSeed,
    opportunityCount: number,
    missedCount: number,
    tightCount: number,
    goodCount: number,
    medianWaitMinutes: number | null,
): NetworkConnectionRecommendation[] {
    const recommendations: NetworkConnectionRecommendation[] = [];
    const missRate = opportunityCount > 0 ? missedCount / opportunityCount : 0;
    const tightRate = opportunityCount > 0 ? tightCount / opportunityCount : 0;
    const routeCount = new Set(hub.stops.flatMap((stop) => stop.routeNumbers)).size;

    if (routeCount >= 3 && missRate >= 0.35) {
        recommendations.push({
            id: `${hub.id}-pulse`,
            type: 'pulse',
            title: 'Consider a pulse here',
            summary: `Several routes meet at ${hub.name}; a repeating pulse minute could outperform pairwise retimes.`,
            rationale: 'Multiple routes use this hub and the miss pattern is repeated enough to justify hub-level coordination.',
            confidence: 'medium',
        });
    }

    if (missRate >= 0.55 && (medianWaitMinutes == null || medianWaitMinutes > 12)) {
        recommendations.push({
            id: `${hub.id}-structural`,
            type: 'structural',
            title: 'This looks structural',
            summary: 'The connection gap appears too large or inconsistent for a small retime to fix reliably.',
            rationale: 'High miss rate combined with long or absent next departures usually indicates a frequency or pattern issue.',
            confidence: 'medium',
        });
    } else if (missRate >= 0.35) {
        recommendations.push({
            id: `${hub.id}-retime`,
            type: 'retime',
            title: 'Small retime candidate',
            summary: `A minor schedule shift is likely the first intervention worth testing at ${hub.name}.`,
            rationale: 'Misses are frequent enough to matter, but not so extreme that the pattern looks fundamentally broken.',
            confidence: 'high',
        });
    }

    if (tightRate >= 0.35 && goodCount > 0) {
        recommendations.push({
            id: `${hub.id}-protect`,
            type: 'protect',
            title: 'Protect tight arrivals',
            summary: 'Trips are often close enough to connect, but the buffer is thin and likely vulnerable to delay.',
            rationale: 'A short hold or explicit timed-transfer rule may add reliability without broader retiming.',
            confidence: 'high',
        });
    }

    if (hub.hubType === 'nearby_cluster') {
        recommendations.push({
            id: `${hub.id}-retarget`,
            type: 'retarget',
            title: 'Confirm the transfer stop',
            summary: 'This hub is built from nearby stops rather than one shared platform. Validate the actual passenger transfer path.',
            rationale: 'Nearby-stop clusters can be real transfer points, but they may need walking assumptions or stop-pair refinement.',
            confidence: 'medium',
        });
    }

    return recommendations.slice(0, 3);
}

function buildHubSeeds(
    serviceEvents: ServiceEvent[],
    thresholds: NetworkConnectionThresholds,
): HubSeed[] {
    const stopCoords = stopCoordLookup();
    const exactStopMap = new Map<string, NetworkConnectionHubStop>();

    for (const event of serviceEvents) {
        const coords = stopCoords.get(event.stopId);
        if (!coords) continue;
        const existing = exactStopMap.get(event.stopId);
        if (existing) {
            if (!existing.routeNumbers.includes(event.service.routeNumber)) existing.routeNumbers.push(event.service.routeNumber);
            if (!existing.serviceKeys.includes(event.service.key)) existing.serviceKeys.push(event.service.key);
            continue;
        }

        exactStopMap.set(event.stopId, {
            stopId: event.stopId,
            stopName: coords.stopName || event.stopName,
            lat: coords.lat,
            lon: coords.lon,
            routeNumbers: [event.service.routeNumber],
            serviceKeys: [event.service.key],
        });
    }

    const sharedStops = Array.from(exactStopMap.values()).filter((stop) => new Set(stop.routeNumbers).size >= 2);
    const exactHubStopIds = new Set(sharedStops.map((stop) => stop.stopId));
    const hubs: HubSeed[] = sharedStops.map((stop) => ({
        id: `hub-stop-${stop.stopId}`,
        name: stop.stopName,
        lat: stop.lat,
        lon: stop.lon,
        hubType: 'shared_stop',
        stops: [stop],
    }));

    const remainingStops = Array.from(exactStopMap.values()).filter((stop) => !exactHubStopIds.has(stop.stopId));
    const consumed = new Set<string>();

    for (const stop of remainingStops) {
        if (consumed.has(stop.stopId)) continue;

        const cluster = [stop];
        consumed.add(stop.stopId);

        for (const candidate of remainingStops) {
            if (consumed.has(candidate.stopId) || candidate.stopId === stop.stopId) continue;
            const distanceMeters = haversineMeters(stop.lat, stop.lon, candidate.lat, candidate.lon);
            if (distanceMeters <= thresholds.nearbyRadiusMeters) {
                cluster.push(candidate);
                consumed.add(candidate.stopId);
            }
        }

        const routeNumbers = new Set(cluster.flatMap((item) => item.routeNumbers));
        if (cluster.length < 2 || routeNumbers.size < 2) continue;

        const centroidLat = cluster.reduce((sum, item) => sum + item.lat, 0) / cluster.length;
        const centroidLon = cluster.reduce((sum, item) => sum + item.lon, 0) / cluster.length;
        const sortedNames = cluster.map((item) => item.stopName).sort((left, right) => left.localeCompare(right));

        hubs.push({
            id: `hub-cluster-${cluster.map((item) => item.stopId).sort().join('-')}`,
            name: `${sortedNames[0]} area`,
            lat: centroidLat,
            lon: centroidLon,
            hubType: 'nearby_cluster',
            stops: cluster,
        });
    }

    return hubs.sort((left, right) => left.name.localeCompare(right.name));
}

function classifyOpportunity(waitMinutes: number | null, thresholds: NetworkConnectionThresholds): NetworkConnectionClass {
    if (waitMinutes == null) return 'missed';
    if (waitMinutes <= thresholds.tightMaxMinutes) return 'tight';
    if (waitMinutes <= thresholds.goodMaxMinutes) return 'good';
    return 'long';
}

function findNextDeparture(
    departures: ServiceEvent[],
    minimumDepartureTime: number,
    maxWaitMinutes: number,
): ServiceEvent | null {
    for (const departure of departures) {
        if (departure.time < minimumDepartureTime) continue;
        if ((departure.time - minimumDepartureTime) > maxWaitMinutes) return null;
        return departure;
    }
    return null;
}

function buildPatternForServices(
    hub: HubSeed,
    fromService: NetworkConnectionServiceRef,
    toService: NetworkConnectionServiceRef,
    eventsForHub: ServiceEvent[],
    timeBand: NetworkConnectionTimeBand,
    thresholds: NetworkConnectionThresholds,
): NetworkConnectionPattern | null {
    const fromEvents = eventsForHub
        .filter((event) => event.service.key === fromService.key && matchesTimeBand(event.time, timeBand))
        .sort((left, right) => left.time - right.time);

    const toEvents = eventsForHub
        .filter((event) => event.service.key === toService.key && matchesTimeBand(event.time, timeBand))
        .sort((left, right) => left.time - right.time);

    if (fromEvents.length === 0 || toEvents.length === 0) return null;

    const walkPenalty = hub.hubType === 'nearby_cluster' ? thresholds.nearbyWalkPenaltyMinutes : 0;

    const opportunities: NetworkConnectionOpportunity[] = fromEvents.map((fromEvent) => {
        const nextDeparture = findNextDeparture(
            toEvents,
            fromEvent.time + walkPenalty,
            thresholds.maxWaitMinutes,
        );

        const waitMinutes = nextDeparture
            ? round(nextDeparture.time - fromEvent.time)
            : null;
        const classification = classifyOpportunity(waitMinutes, thresholds);

        return {
            hubId: hub.id,
            fromServiceKey: fromService.key,
            toServiceKey: toService.key,
            fromTripId: fromEvent.tripId,
            toTripId: nextDeparture?.tripId ?? null,
            fromStopId: fromEvent.stopId,
            fromStopName: fromEvent.stopName,
            toStopId: nextDeparture?.stopId ?? null,
            toStopName: nextDeparture?.stopName ?? null,
            fromTime: fromEvent.time,
            toTime: nextDeparture?.time ?? null,
            waitMinutes,
            classification,
            timeBand: fromEvent.timeBand,
        };
    });

    const waitValues = opportunities
        .map((opportunity) => opportunity.waitMinutes)
        .filter((value): value is number => typeof value === 'number');

    const missedCount = opportunities.filter((opportunity) => opportunity.classification === 'missed').length;
    const tightCount = opportunities.filter((opportunity) => opportunity.classification === 'tight').length;
    const goodCount = opportunities.filter((opportunity) => opportunity.classification === 'good').length;
    const longWaitCount = opportunities.filter((opportunity) => opportunity.classification === 'long').length;
    const opportunityCount = opportunities.length;
    const missRate = opportunityCount > 0 ? round(missedCount / opportunityCount) : 0;
    const goodRate = opportunityCount > 0 ? goodCount / opportunityCount : 0;
    const severity = classifySeverity(missRate, goodRate);
    const medianWaitMinutes = median(waitValues);
    const avgWaitMinutes = average(waitValues);
    const score = round((goodCount * 1.2) + (tightCount * 0.6) - (missedCount * 1.8) - (longWaitCount * 0.5));
    const recommendations = buildRecommendations(hub, opportunityCount, missedCount, tightCount, goodCount, medianWaitMinutes);

    return {
        id: `${hub.id}|${fromService.key}|${toService.key}|${timeBand}`,
        hubId: hub.id,
        fromService,
        toService,
        opportunityCount,
        missedCount,
        tightCount,
        goodCount,
        longWaitCount,
        missRate,
        medianWaitMinutes,
        avgWaitMinutes,
        severity,
        score,
        opportunities,
        recommendations,
    };
}

export function analyzeNetworkConnections({
    schedules,
    dayType,
    timeBand,
    thresholds: thresholdOverrides,
}: AnalyzeNetworkConnectionsInput): NetworkConnectionAnalysisResult {
    const thresholds = { ...DEFAULT_NETWORK_CONNECTION_THRESHOLDS, ...thresholdOverrides };
    const colors = routeColorLookup();

    const services: NetworkConnectionServiceRef[] = [];
    const allEvents: ServiceEvent[] = [];

    for (const schedule of schedules) {
        const northService = buildServiceRef(schedule.entry, schedule.content.northTable, 'North', colors);
        const southService = buildServiceRef(schedule.entry, schedule.content.southTable, 'South', colors);
        services.push(northService, southService);
        allEvents.push(
            ...buildServiceEventsForTable(northService, schedule.content.northTable),
            ...buildServiceEventsForTable(southService, schedule.content.southTable),
        );
    }

    const hubs = buildHubSeeds(allEvents, thresholds);
    const patterns: NetworkConnectionPattern[] = [];

    for (const hub of hubs) {
        const hubStopIds = new Set(hub.stops.map((stop) => stop.stopId));
        const hubEvents = allEvents.filter((event) => hubStopIds.has(event.stopId));
        const servicesAtHub = new Map<string, NetworkConnectionServiceRef>();

        for (const event of hubEvents) {
            servicesAtHub.set(event.service.key, event.service);
        }

        const serviceList = Array.from(servicesAtHub.values()).sort((left, right) => left.label.localeCompare(right.label));

        for (const fromService of serviceList) {
            for (const toService of serviceList) {
                if (fromService.key === toService.key) continue;
                if (fromService.routeNumber === toService.routeNumber) continue;
                const pattern = buildPatternForServices(hub, fromService, toService, hubEvents, timeBand, thresholds);
                if (pattern && pattern.opportunityCount > 0) {
                    patterns.push(pattern);
                }
            }
        }
    }

    const patternsByHub = new Map<string, NetworkConnectionPattern[]>();
    for (const pattern of patterns) {
        const existing = patternsByHub.get(pattern.hubId);
        if (existing) existing.push(pattern);
        else patternsByHub.set(pattern.hubId, [pattern]);
    }

    const enrichedHubs: NetworkConnectionHub[] = hubs.map((hub) => {
        const hubPatterns = (patternsByHub.get(hub.id) ?? []).sort((left, right) => {
            if (left.severity !== right.severity) {
                const rank = { weak: 0, mixed: 1, strong: 2 } as const;
                return rank[left.severity] - rank[right.severity];
            }
            return right.opportunityCount - left.opportunityCount;
        });
        const routeNumbers = Array.from(new Set(hub.stops.flatMap((stop) => stop.routeNumbers))).sort((left, right) =>
            left.localeCompare(right, undefined, { numeric: true }),
        );
        const serviceKeys = Array.from(new Set(hub.stops.flatMap((stop) => stop.serviceKeys)));
        const worstSeverity = hubPatterns[0]?.severity ?? 'strong';
        const issueScore = round(hubPatterns.reduce((sum, pattern) => sum + (pattern.severity === 'weak' ? 3 : pattern.severity === 'mixed' ? 2 : 1), 0));
        const topRecommendationSummary = hubPatterns[0]?.recommendations[0]?.summary ?? 'No immediate recommendation';

        return {
            id: hub.id,
            name: hub.name,
            lat: hub.lat,
            lon: hub.lon,
            hubType: hub.hubType,
            routeNumbers,
            serviceKeys,
            stops: hub.stops,
            patternIds: hubPatterns.map((pattern) => pattern.id),
            issueScore,
            severity: worstSeverity,
            topRecommendationSummary,
        };
    }).sort((left, right) => {
        if (left.severity !== right.severity) {
            const rank = { weak: 0, mixed: 1, strong: 2 } as const;
            return rank[left.severity] - rank[right.severity];
        }
        return right.issueScore - left.issueScore;
    });

    const waits = patterns
        .flatMap((pattern) => pattern.opportunities)
        .map((opportunity) => opportunity.waitMinutes)
        .filter((value): value is number => typeof value === 'number');

    return {
        summary: {
            sourceKind: 'published-master',
            sourceLabel: 'Published Master Schedule',
            dayType,
            timeBand,
            hubCount: enrichedHubs.length,
            patternCount: patterns.length,
            weakPatternCount: patterns.filter((pattern) => pattern.severity === 'weak').length,
            avgObservedWaitMinutes: average(waits),
        },
        thresholds,
        hubs: enrichedHubs,
        patterns: patterns.sort((left, right) => {
            if (left.severity !== right.severity) {
                const rank = { weak: 0, mixed: 1, strong: 2 } as const;
                return rank[left.severity] - rank[right.severity];
            }
            if (left.missRate !== right.missRate) return right.missRate - left.missRate;
            return right.opportunityCount - left.opportunityCount;
        }),
        services,
    };
}
