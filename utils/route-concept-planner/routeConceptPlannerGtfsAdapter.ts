import {
    createRoutePlanner2ScenarioFromGtfsPattern,
    type RoutePlanner2GtfsImportPattern,
} from '../route-planner-2/routePlanner2GtfsImport';
import {
    loadRoutePlanner2GtfsImportPatterns,
    type LoadRoutePlanner2GtfsPatternsOptions,
} from '../route-planner-2/routePlanner2GtfsClient';
import {
    buildRoutePlanner2StopSegmentPaths,
    getRoutePlanner2SegmentKey,
} from '../route-planner-2/routePlanner2Segments';
import type {
    RoutePlanner2RouteFamilyReference,
    RoutePlanner2Scenario,
} from '../route-planner-2/routePlanner2Types';
import type {
    ConceptStop,
    RouteConceptAlternative,
    RouteConceptDayType,
    RouteConceptPattern,
    RouteConceptPatternRole,
    RouteConceptPlanningPeriod,
    RouteConceptPoint,
    RouteConceptSegmentRuntimeEvidence,
} from './routeConceptPlannerTypes';

/**
 * Neutral GTFS import boundary for Route Concept Planner.
 *
 * Route Planner 2 remains the working Camp tool. Its proven GTFS parser/client is
 * used only inside this adapter; Route Concept Planner UI and domain code should
 * consume the neutral candidates and alternatives exported here.
 */

export interface RouteConceptGtfsStopCandidate {
    id: string;
    gtfsStopId: string;
    stopCode?: string;
    name: string;
    lat: number;
    lng: number;
    sequence: number;
    arrivalMinutes?: number;
    departureMinutes?: number;
}

export interface RouteConceptGtfsShapePointCandidate {
    lat: number;
    lng: number;
    sequence: number;
}

export interface RouteConceptGtfsScheduledRuntimeCandidate {
    planningPeriod: RouteConceptPlanningPeriod;
    sampleSize: number;
    segmentRuntimeMinutes: number[];
    totalRuntimeMinutes: number;
}

export interface RouteConceptGtfsPatternCandidate {
    id: string;
    routeId: string;
    routeShortName: string;
    routeLongName?: string;
    serviceId: string;
    dayType: RouteConceptDayType;
    dayTypeLabel: string;
    directionId?: number;
    tripHeadsign?: string;
    shapeId?: string;
    tripCount: number;
    firstDepartureMinutes?: number;
    lastDepartureMinutes?: number;
    medianHeadwayMinutes?: number;
    blockCount?: number;
    scheduledRuntimes: RouteConceptGtfsScheduledRuntimeCandidate[];
    stops: RouteConceptGtfsStopCandidate[];
    shapePoints: RouteConceptGtfsShapePointCandidate[];
    feedVersion?: string;
    routeFamily?: {
        key: string;
        name: string;
        shortName: string;
        memberShortName: string;
        directionRole?: 'out' | 'back';
        directionLabel: string;
    };
}

export type RouteConceptGtfsImportRole = 'outbound' | 'inbound' | 'loop';

export interface RouteConceptGtfsImportDirectionOption {
    role: RouteConceptGtfsImportRole;
    variants: RouteConceptGtfsPatternCandidate[];
    recommendedPatternId: string;
}

export interface RouteConceptGtfsImportOption {
    id: string;
    routeLabel: string;
    dayType: RouteConceptDayType;
    directions: RouteConceptGtfsImportDirectionOption[];
    complete: boolean;
}

export interface LoadRouteConceptGtfsPatternsOptions {
    feedUrl?: string;
    fetchImpl?: typeof fetch;
    forceRefresh?: boolean;
    cacheStorage?: Storage | null;
    now?: number;
}

export interface ConvertRouteConceptGtfsSelectionsOptions {
    now?: string;
}

function normalizeDayType(dayTypeLabel: string, serviceId: string): RouteConceptDayType {
    const value = `${dayTypeLabel} ${serviceId}`.toLowerCase();
    if (value.includes('saturday') || /(^|[^a-z])sat([^a-z]|$)/.test(value)) return 'saturday';
    if (value.includes('sunday') || /(^|[^a-z])sun([^a-z]|$)/.test(value)) return 'sunday';
    return 'weekday';
}

function hasRecognizedDayType(dayTypeLabel: string, serviceId: string): boolean {
    return /(weekday|saturday|sunday|(^|[^a-z])(mon|tue|wed|thu|fri|sat|sun)([^a-z]|$))/i
        .test(`${dayTypeLabel} ${serviceId}`);
}

function toPlanningPeriod(period: string): RouteConceptPlanningPeriod {
    return period === 'full-day' ? 'all-day' : period as RouteConceptPlanningPeriod;
}

function toRp2Period(period: RouteConceptPlanningPeriod): 'full-day' | Exclude<RouteConceptPlanningPeriod, 'all-day'> {
    return period === 'all-day' ? 'full-day' : period;
}

function cloneRouteFamily(
    family: RoutePlanner2RouteFamilyReference | RouteConceptGtfsPatternCandidate['routeFamily'],
): RouteConceptGtfsPatternCandidate['routeFamily'] {
    return family ? { ...family } : undefined;
}

/** Convert the proven parser's output to a Camp-free import candidate. */
function adaptRouteConceptGtfsPatterns(
    patterns: readonly RoutePlanner2GtfsImportPattern[],
): RouteConceptGtfsPatternCandidate[] {
    return patterns.map((pattern) => ({
        id: pattern.id,
        routeId: pattern.routeId,
        routeShortName: pattern.routeShortName,
        routeLongName: pattern.routeLongName,
        serviceId: pattern.serviceId,
        dayType: normalizeDayType(pattern.dayTypeLabel, pattern.serviceId),
        dayTypeLabel: pattern.dayTypeLabel,
        directionId: pattern.directionId,
        tripHeadsign: pattern.tripHeadsign,
        shapeId: pattern.shapeId,
        tripCount: pattern.tripCount,
        firstDepartureMinutes: pattern.firstDepartureMinutes,
        lastDepartureMinutes: pattern.lastDepartureMinutes,
        medianHeadwayMinutes: pattern.medianHeadwayMinutes,
        blockCount: pattern.blockCount,
        scheduledRuntimes: (pattern.scheduledRuntimes ?? []).map((runtime) => ({
            planningPeriod: toPlanningPeriod(runtime.period),
            sampleSize: runtime.sampleSize,
            segmentRuntimeMinutes: [...runtime.segmentRuntimeMinutes],
            totalRuntimeMinutes: runtime.totalRuntimeMinutes,
        })),
        stops: pattern.stops.map((stop) => ({
            id: stop.stopId,
            gtfsStopId: stop.gtfsStopId,
            stopCode: stop.stopCode,
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
            sequence: stop.sequence,
            arrivalMinutes: stop.arrivalMinutes,
            departureMinutes: stop.departureMinutes,
        })),
        shapePoints: pattern.shapePoints.map((point) => ({ ...point })),
        feedVersion: pattern.feedVersion,
        routeFamily: cloneRouteFamily(pattern.routeFamily),
    }));
}

/** Load full GTFS patterns through the existing cached proxy client. */
export async function loadRouteConceptGtfsPatterns(
    options: LoadRouteConceptGtfsPatternsOptions = {},
): Promise<RouteConceptGtfsPatternCandidate[]> {
    const clientOptions: LoadRoutePlanner2GtfsPatternsOptions = { ...options };
    const patterns = await loadRoutePlanner2GtfsImportPatterns(clientOptions);
    return adaptRouteConceptGtfsPatterns(patterns);
}

function stableHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function asRp2Pattern(pattern: RouteConceptGtfsPatternCandidate): RoutePlanner2GtfsImportPattern {
    return {
        id: pattern.id,
        routeId: pattern.routeId,
        routeShortName: pattern.routeShortName,
        routeLongName: pattern.routeLongName,
        routeFamily: pattern.routeFamily ? { ...pattern.routeFamily } : undefined,
        serviceId: pattern.serviceId,
        dayTypeLabel: pattern.dayTypeLabel,
        directionId: pattern.directionId,
        tripHeadsign: pattern.tripHeadsign,
        shapeId: pattern.shapeId,
        tripCount: pattern.tripCount,
        stopCount: pattern.stops.length,
        shapePointCount: pattern.shapePoints.length,
        firstDepartureMinutes: pattern.firstDepartureMinutes,
        lastDepartureMinutes: pattern.lastDepartureMinutes,
        medianHeadwayMinutes: pattern.medianHeadwayMinutes,
        blockCount: pattern.blockCount,
        scheduledRuntimes: pattern.scheduledRuntimes.map((runtime) => ({
            period: toRp2Period(runtime.planningPeriod),
            sampleSize: runtime.sampleSize,
            segmentRuntimeMinutes: [...runtime.segmentRuntimeMinutes],
            totalRuntimeMinutes: runtime.totalRuntimeMinutes,
        })),
        stops: pattern.stops.map((stop) => ({ ...stop, stopId: stop.id })),
        shapePoints: pattern.shapePoints.map((point) => ({ ...point })),
        feedVersion: pattern.feedVersion,
    };
}

function isClosedPattern(pattern: RouteConceptGtfsPatternCandidate): boolean {
    const first = pattern.stops[0];
    const last = pattern.stops[pattern.stops.length - 1];
    return Boolean(first && last && pattern.stops.length > 2 && first.gtfsStopId === last.gtfsStopId);
}

function getRouteGroupKey(pattern: RouteConceptGtfsPatternCandidate): string {
    return pattern.routeFamily?.key ?? `route:${pattern.routeId}`;
}

function getDayGroupKey(pattern: RouteConceptGtfsPatternCandidate): string {
    return hasRecognizedDayType(pattern.dayTypeLabel, pattern.serviceId)
        ? pattern.dayType
        : `service:${pattern.serviceId}`;
}

function getPatternRole(pattern: RouteConceptGtfsPatternCandidate): RouteConceptGtfsImportRole {
    if (isClosedPattern(pattern)) return 'loop';
    if (pattern.routeFamily?.directionRole === 'back') return 'inbound';
    if (pattern.routeFamily?.directionRole === 'out') return 'outbound';
    return pattern.directionId === 1 ? 'inbound' : 'outbound';
}

function compareImportCandidates(
    left: RouteConceptGtfsPatternCandidate,
    right: RouteConceptGtfsPatternCandidate,
): number {
    const recognizedDayCompare = Number(hasRecognizedDayType(right.dayTypeLabel, right.serviceId))
        - Number(hasRecognizedDayType(left.dayTypeLabel, left.serviceId));
    if (recognizedDayCompare !== 0) return recognizedDayCompare;

    const tripCompare = right.tripCount - left.tripCount;
    if (tripCompare !== 0) return tripCompare;

    const stopCompare = right.stops.length - left.stops.length;
    if (stopCompare !== 0) return stopCompare;

    const leftSpan = (left.lastDepartureMinutes ?? 0) - (left.firstDepartureMinutes ?? 0);
    const rightSpan = (right.lastDepartureMinutes ?? 0) - (right.firstDepartureMinutes ?? 0);
    const spanCompare = rightSpan - leftSpan;
    return spanCompare || left.id.localeCompare(right.id);
}

function getImportVariantKey(pattern: RouteConceptGtfsPatternCandidate): string {
    const stopSequence = pattern.stops.map((stop) => stop.gtfsStopId).join('>');
    const alignment = pattern.shapePoints.length > 0
        ? stableHash(pattern.shapePoints
            .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
            .join('>'))
        : pattern.shapeId ?? 'no-shape';
    return `${pattern.routeShortName}|${getPatternRole(pattern)}|${stopSequence}|${alignment}`;
}

/**
 * Turn technical GTFS patterns into one user-facing complete-route option.
 * Duplicate service IDs with the same stops/alignment collapse to one candidate;
 * genuinely different stop sequences or alignments remain available as variants.
 */
export function buildRouteConceptGtfsImportOptions(
    patterns: readonly RouteConceptGtfsPatternCandidate[],
    dayType: RouteConceptDayType,
): RouteConceptGtfsImportOption[] {
    const groups = new Map<string, RouteConceptGtfsPatternCandidate[]>();
    patterns
        .filter((pattern) => pattern.dayType === dayType)
        .forEach((pattern) => {
            const key = getRouteGroupKey(pattern);
            groups.set(key, [...(groups.get(key) ?? []), pattern]);
        });

    return [...groups.entries()].map(([groupKey, candidates]) => {
        const roleGroups = new Map<RouteConceptGtfsImportRole, RouteConceptGtfsPatternCandidate[]>();
        candidates.forEach((candidate) => {
            const role = getPatternRole(candidate);
            roleGroups.set(role, [...(roleGroups.get(role) ?? []), candidate]);
        });

        const roleOrder: RouteConceptGtfsImportRole[] = ['outbound', 'inbound', 'loop'];
        const directions = roleOrder.flatMap((role): RouteConceptGtfsImportDirectionOption[] => {
            const roleCandidates = roleGroups.get(role) ?? [];
            if (roleCandidates.length === 0) return [];

            const variants = new Map<string, RouteConceptGtfsPatternCandidate[]>();
            roleCandidates.forEach((candidate) => {
                const key = getImportVariantKey(candidate);
                variants.set(key, [...(variants.get(key) ?? []), candidate]);
            });
            const representatives = [...variants.values()]
                .map((matches) => [...matches].sort(compareImportCandidates)[0]!)
                .sort(compareImportCandidates);

            return [{
                role,
                variants: representatives,
                recommendedPatternId: representatives[0]!.id,
            }];
        });
        const first = [...candidates].sort(compareImportCandidates)[0]!;
        const hasLoop = directions.some((direction) => direction.role === 'loop');
        const complete = hasLoop
            ? directions.length === 1
            : directions.some((direction) => direction.role === 'outbound')
                && directions.some((direction) => direction.role === 'inbound');

        return {
            id: `${groupKey}|${dayType}`,
            routeLabel: first.routeFamily?.name ?? `Route ${first.routeShortName}`,
            dayType,
            directions,
            complete,
        };
    }).sort((left, right) => left.routeLabel.localeCompare(right.routeLabel, undefined, { numeric: true }));
}

function remapScenario(
    scenario: RoutePlanner2Scenario,
    candidate: RouteConceptGtfsPatternCandidate,
    role: RouteConceptPatternRole,
    now: string,
): RouteConceptPattern {
    const patternId = `gtfs-pattern-${stableHash(candidate.id)}`;
    const closed = role === 'loop';
    const scenarioStops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
    const retainedStops = closed ? scenarioStops.slice(0, -1) : scenarioStops;
    const oldToNewStopId = new Map<string, string>();

    retainedStops.forEach((stop, index) => {
        oldToNewStopId.set(stop.id, `${patternId}-stop-${index + 1}`);
    });
    if (closed && scenarioStops.length > 1) {
        oldToNewStopId.set(scenarioStops[scenarioStops.length - 1]!.id, oldToNewStopId.get(scenarioStops[0]!.id)!);
    }

    const stops: ConceptStop[] = retainedStops.map((stop, index) => ({
        id: oldToNewStopId.get(stop.id)!,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        sequence: index + 1,
        role: index === 0
            ? 'start-terminal'
            : !closed && index === retainedStops.length - 1
                ? 'end-terminal'
                : 'regular',
        source: 'gtfs',
        stopCode: stop.stopCode,
        notes: stop.notes,
    }));

    const alignment: RouteConceptPoint[] = scenario.alignment.flatMap((point, index) => {
        const afterStopId = point.afterStopId ? oldToNewStopId.get(point.afterStopId) : undefined;
        const beforeStopId = point.beforeStopId ? oldToNewStopId.get(point.beforeStopId) : undefined;
        if (point.afterStopId && !afterStopId) return [];
        if (point.beforeStopId && !beforeStopId) return [];
        return [{
            id: `${patternId}-point-${index + 1}`,
            lat: point.lat,
            lng: point.lng,
            sequence: index + 1,
            afterStopId,
            beforeStopId,
            segmentSequence: point.segmentSequence,
        }];
    });

    const fingerprintScenario: RoutePlanner2Scenario = {
        ...scenario,
        id: patternId,
        routeShape: closed ? 'closed-loop' : 'one-way',
        stops: stops.map((stop) => ({
            ...stop,
            source: 'barrie-stop',
        })),
        alignment,
    };
    const segmentPaths = buildRoutePlanner2StopSegmentPaths(fingerprintScenario);
    const segmentFingerprints = Object.fromEntries(segmentPaths.map((segment) => [
        `${segment.fromStopId}->${segment.toStopId}`,
        segment.pathFingerprint,
    ]));
    const fingerprintBySegmentKey = new Map(segmentPaths.map((segment) => [
        getRoutePlanner2SegmentKey(segment.fromStopId, segment.toStopId),
        segment.pathFingerprint,
    ]));

    const runtimeEvidence: RouteConceptSegmentRuntimeEvidence[] = (scenario.runtimeEstimates ?? []).flatMap((estimate) => {
        const fromStopId = oldToNewStopId.get(estimate.fromStopId);
        const toStopId = oldToNewStopId.get(estimate.toStopId);
        if (!fromStopId || !toStopId || fromStopId === toStopId || estimate.runtimeMinutes == null) return [];
        const planningPeriod = estimate.evidencePeriod
            ? toPlanningPeriod(estimate.evidencePeriod)
            : undefined;
        return [{
            id: `${patternId}-evidence-${stableHash(`${fromStopId}->${toStopId}|${planningPeriod ?? 'any'}`)}`,
            fromStopId,
            toStopId,
            runtimeMinutes: estimate.runtimeMinutes,
            source: 'gtfs',
            pathFingerprint: fingerprintBySegmentKey.get(getRoutePlanner2SegmentKey(fromStopId, toStopId)),
            dayType: estimate.evidenceDayType ?? candidate.dayType,
            planningPeriod,
            sampleSize: estimate.sampleSize,
            distanceKm: estimate.distanceKm,
            updatedAt: estimate.updatedAt ?? now,
        }];
    });

    return {
        id: patternId,
        name: candidate.tripHeadsign || `Route ${candidate.routeShortName}`,
        role,
        alignment,
        stops,
        segmentFingerprints,
        runtimeEvidence,
        runtimeOverrides: {},
        source: {
            type: 'gtfs',
            routeId: candidate.routeId,
            routeShortName: candidate.routeShortName,
            serviceId: candidate.serviceId,
            directionId: candidate.directionId,
            shapeId: candidate.shapeId,
            feedVersion: candidate.feedVersion,
            importedAt: now,
        },
        notes: 'Imported from GTFS as an editable planning copy. Changes do not modify the GTFS feed.',
        createdAt: now,
        updatedAt: now,
    };
}

function median(values: number[]): number | undefined {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) return undefined;
    const midpoint = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[midpoint]
        : ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function finiteMin(values: Array<number | undefined>, fallback: number): number {
    const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
    return finite.length > 0 ? Math.min(...finite) : fallback;
}

function finiteMax(values: Array<number | undefined>, fallback: number): number {
    const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
    return finite.length > 0 ? Math.max(...finite) : fallback;
}

function alternativeName(patterns: RouteConceptGtfsPatternCandidate[]): string {
    const first = patterns[0]!;
    const routeName = first.routeFamily?.name ?? `Route ${first.routeShortName}`;
    const dayLabel = first.dayType === 'weekday'
        ? 'Weekday'
        : first.dayType === 'saturday'
            ? 'Saturday'
            : 'Sunday';
    return `${routeName} — ${dayLabel}`;
}

/**
 * Group selected full GTFS patterns into complete-route alternatives.
 * Selections may contain several independent route/day groups.
 */
export function convertRouteConceptGtfsSelections(
    selections: readonly RouteConceptGtfsPatternCandidate[],
    options: ConvertRouteConceptGtfsSelectionsOptions = {},
): RouteConceptAlternative[] {
    const now = options.now ?? new Date().toISOString();
    const groups = new Map<string, RouteConceptGtfsPatternCandidate[]>();

    selections.forEach((pattern) => {
        const key = `${getRouteGroupKey(pattern)}|${getDayGroupKey(pattern)}`;
        const group = groups.get(key) ?? [];
        group.push(pattern);
        groups.set(key, group);
    });

    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([groupKey, candidates]) => {
            const sortedCandidates = [...candidates].sort((a, b) => {
                const roleOrder = { outbound: 0, inbound: 1, loop: 2, 'out-and-back': 3 } as const;
                const roleCompare = roleOrder[getPatternRole(a)] - roleOrder[getPatternRole(b)];
                return roleCompare || a.id.localeCompare(b.id);
            });
            const roles = sortedCandidates.map(getPatternRole);
            const duplicateRole = roles.find((role, index) => roles.indexOf(role) !== index);
            if (duplicateRole) {
                throw new Error(`Select only one ${duplicateRole} pattern for ${alternativeName(sortedCandidates)}.`);
            }
            if (roles.includes('loop') && roles.length > 1) {
                throw new Error(`A loop alternative must contain one complete loop pattern for ${alternativeName(sortedCandidates)}.`);
            }

            const patterns = sortedCandidates.map((candidate) => {
                const scenario = createRoutePlanner2ScenarioFromGtfsPattern(asRp2Pattern(candidate), {
                    id: `gtfs-adapter-${stableHash(candidate.id)}`,
                    now,
                });
                return remapScenario(scenario, candidate, getPatternRole(candidate), now);
            });
            const isLoop = patterns.length === 1 && patterns[0]?.role === 'loop';
            const firstDepartureMinutes = finiteMin(
                sortedCandidates.map((candidate) => candidate.firstDepartureMinutes),
                360,
            );
            const lastDepartureMinutes = finiteMax(
                sortedCandidates.map((candidate) => candidate.lastDepartureMinutes),
                1320,
            );
            const headways = sortedCandidates
                .map((candidate) => candidate.medianHeadwayMinutes)
                .filter((value): value is number => value != null && Number.isFinite(value));
            const frequencyMinutes = Math.max(1, Math.round(median(headways) ?? 30));
            const testedBuses = finiteMax(
                sortedCandidates.map((candidate) => candidate.blockCount),
                0,
            ) || undefined;
            const alternativeId = `gtfs-alternative-${stableHash(groupKey)}`;

            return {
                id: alternativeId,
                name: alternativeName(sortedCandidates),
                status: 'draft',
                structure: isLoop ? 'loop' : 'bidirectional',
                patternOrder: patterns.map((pattern) => pattern.id),
                patterns,
                service: {
                    firstDepartureMinutes,
                    lastDepartureMinutes: Math.max(firstDepartureMinutes, lastDepartureMinutes),
                    frequencyMinutes,
                    testedBuses,
                    startTerminalLayoverMinutes: 5,
                    endTerminalLayoverMinutes: 5,
                    intermediateStopDwellSeconds: 0,
                    dayType: sortedCandidates[0]!.dayType,
                    planningPeriod: 'all-day',
                },
                notes: 'Imported from scheduled GTFS full-route patterns.',
                createdAt: now,
                updatedAt: now,
            } satisfies RouteConceptAlternative;
        });
}
