import type {
    RoutePlanner2Project,
    RoutePlanner2RouteShape,
    RoutePlanner2RoutePoint,
    RoutePlanner2RuntimeSourceMode,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2Stop,
    RoutePlanner2StopRole,
    RoutePlanner2Warning,
} from './routePlanner2Types';
import { buildRoutePlanner2StopSegmentPairs, buildRoutePlanner2StopVisitSequence, getRoutePlanner2SegmentId, getRoutePlanner2TurnaroundStop, sortRoutePlanner2Stops } from './routePlanner2Segments';

const GTFS_RUNTIME_EVIDENCE_SOURCES = new Set<RoutePlanner2SegmentRuntime['source']>([
    'observed-proxy',
    'observed-scheduled-blend',
    'partial-scheduled-proxy',
    'scheduled-proxy',
]);

function createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createStableIdPart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'stop';
}

function markChanged(project: RoutePlanner2Project, now: string): RoutePlanner2Project {
    return {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        updatedAt: now,
    };
}

function resequenceStops(stops: RoutePlanner2Stop[]): RoutePlanner2Stop[] {
    return stops.map((stop, index) => ({ ...stop, sequence: index + 1 }));
}

function resequenceRoutePoints(points: RoutePlanner2RoutePoint[]): RoutePlanner2RoutePoint[] {
    return points.map((point, index) => ({ ...point, sequence: index + 1 }));
}

function getSegmentKey(afterStopId: string, beforeStopId: string): string {
    return `${afterStopId}::${beforeStopId}`;
}

function getPointSegmentKey(point: RoutePlanner2RoutePoint): string | null {
    return point.afterStopId && point.beforeStopId ? getSegmentKey(point.afterStopId, point.beforeStopId) : null;
}

function sortSegmentWaypoints(points: RoutePlanner2RoutePoint[]): RoutePlanner2RoutePoint[] {
    return [...points].sort((a, b) => (a.segmentSequence ?? a.sequence) - (b.segmentSequence ?? b.sequence));
}

function normalizeSegmentWaypoints(
    points: RoutePlanner2RoutePoint[],
    afterStopId: string,
    beforeStopId: string,
): RoutePlanner2RoutePoint[] {
    return points.map((point, index) => ({
        ...point,
        afterStopId,
        beforeStopId,
        segmentSequence: index + 1,
    }));
}

function resequenceScenarioAlignment(
    scenario: RoutePlanner2Scenario,
    alignment: RoutePlanner2RoutePoint[],
): RoutePlanner2RoutePoint[] {
    const validSegmentKeys = new Set(buildRoutePlanner2StopSegmentPairs(scenario).map(({ fromStop, toStop }) =>
        getSegmentKey(fromStop.id, toStop.id),
    ));
    const validAlignment = alignment.filter((point) =>
        !point.afterStopId
        || !point.beforeStopId
        || validSegmentKeys.has(getSegmentKey(point.afterStopId, point.beforeStopId)),
    );
    const orderedPoints: RoutePlanner2RoutePoint[] = [];
    const usedIds = new Set<string>();

    for (const { fromStop, toStop } of buildRoutePlanner2StopSegmentPairs(scenario)) {

        const segmentPoints = sortSegmentWaypoints(validAlignment.filter((point) =>
            point.afterStopId === fromStop.id && point.beforeStopId === toStop.id,
        ));

        normalizeSegmentWaypoints(segmentPoints, fromStop.id, toStop.id).forEach((point) => {
            orderedPoints.push(point);
            usedIds.add(point.id);
        });
    }

    validAlignment
        .filter((point) => !usedIds.has(point.id))
        .sort((a, b) => a.sequence - b.sequence)
        .forEach((point) => orderedPoints.push(point));

    return resequenceRoutePoints(orderedPoints);
}

function isValidCoordinate(coordinate: { lat: number; lng: number }): boolean {
    return Number.isFinite(coordinate.lat)
        && Number.isFinite(coordinate.lng)
        && coordinate.lat >= -90
        && coordinate.lat <= 90
        && coordinate.lng >= -180
        && coordinate.lng <= 180;
}

function validateLineWaypointSegment(
    scenario: RoutePlanner2Scenario,
    afterStopId: string,
    beforeStopId: string,
): boolean {
    if (afterStopId === beforeStopId) return false;
    return buildRoutePlanner2StopSegmentPairs(scenario).some(({ fromStop, toStop }) =>
        fromStop.id === afterStopId && toStop.id === beforeStopId,
    );
}

type RoutePlanner2LineOrderItem =
    | { type: 'stop'; stopId: string }
    | { type: 'bend'; waypoint: RoutePlanner2RoutePoint; afterStopId: string; beforeStopId: string };

function buildLineWaypointOrderItems(scenario: RoutePlanner2Scenario): RoutePlanner2LineOrderItem[] {
    const visits = buildRoutePlanner2StopVisitSequence(scenario);
    if (visits.length === 0) return [];

    const items: RoutePlanner2LineOrderItem[] = [{ type: 'stop', stopId: visits[0]!.id }];
    for (let index = 0; index < visits.length - 1; index += 1) {
        const fromStop = visits[index]!;
        const toStop = visits[index + 1]!;
        sortSegmentWaypoints(scenario.alignment.filter((point) =>
            point.afterStopId === fromStop.id && point.beforeStopId === toStop.id,
        )).forEach((waypoint) => {
            items.push({ type: 'bend', waypoint, afterStopId: fromStop.id, beforeStopId: toStop.id });
        });
        items.push({ type: 'stop', stopId: toStop.id });
    }

    return items;
}

function findStopBefore(items: RoutePlanner2LineOrderItem[], index: number): string | null {
    for (let itemIndex = index; itemIndex >= 0; itemIndex -= 1) {
        const item = items[itemIndex];
        if (item?.type === 'stop') return item.stopId;
    }
    return null;
}

function findStopAfter(items: RoutePlanner2LineOrderItem[], index: number): string | null {
    for (let itemIndex = index; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        if (item?.type === 'stop') return item.stopId;
    }
    return null;
}

function updateScenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    updater: (scenario: RoutePlanner2Scenario) => RoutePlanner2Scenario,
    now: string,
): RoutePlanner2Project {
    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId) return scenario;
        const updated = updater(scenario);
        if (updated === scenario) return scenario;
        changed = true;
        return { ...updated, updatedAt: now };
    });

    return changed ? markChanged({ ...project, scenarios }, now) : project;
}

function cleanRuntimeForCurrentSegments(scenario: RoutePlanner2Scenario): RoutePlanner2Scenario {
    const validSegmentIds = new Set(buildRoutePlanner2StopSegmentPairs(scenario).map(({ fromStop, toStop }) =>
        getRoutePlanner2SegmentId(fromStop.id, toStop.id),
    ));
    const runtimeEstimates = scenario.runtimeEstimates?.filter((estimate) => validSegmentIds.has(estimate.id));
    const runtimeOverrides = scenario.runtimeOverrides
        ? Object.fromEntries(Object.entries(scenario.runtimeOverrides).filter(([segmentId]) => validSegmentIds.has(segmentId)))
        : undefined;

    return {
        ...scenario,
        runtimeEstimates: runtimeEstimates && runtimeEstimates.length > 0 ? runtimeEstimates : undefined,
        runtimeOverrides: runtimeOverrides && Object.keys(runtimeOverrides).length > 0 ? runtimeOverrides : undefined,
        feasibility: undefined,
    };
}

function createUniqueTransferredStopId(
    sourceStopId: string,
    now: string,
    index: number,
    usedIds: Set<string>,
): string {
    const base = `transfer-${createStableIdPart(sourceStopId)}-${createStableIdPart(now)}-${index + 1}`;
    let candidate = base;
    let suffix = 2;

    while (usedIds.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function createUniqueTransferredWaypointId(
    sourcePointId: string,
    now: string,
    index: number,
    usedIds: Set<string>,
): string {
    const base = `transfer-bend-${createStableIdPart(sourcePointId)}-${createStableIdPart(now)}-${index + 1}`;
    let candidate = base;
    let suffix = 2;

    while (usedIds.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

export function addRoutePlanner2RoutePoint(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: { id?: string; lat: number; lng: number; now?: string },
): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        const point: RoutePlanner2RoutePoint = {
            id: options.id ?? createId('point'),
            lat: options.lat,
            lng: options.lng,
            sequence: scenario.alignment.length + 1,
        };

        return {
            ...scenario,
            alignment: [...scenario.alignment, point],
            feasibility: undefined,
        };
    }, now);
}

export function addRoutePlanner2Stop(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: {
        id?: string;
        name?: string;
        address?: string;
        riderCount?: number;
        sourceRows?: number[];
        lat: number;
        lng: number;
        role?: RoutePlanner2StopRole;
        source?: RoutePlanner2Stop['source'];
        stopCode?: string;
        notes?: string;
        now?: string;
    },
): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        const stop: RoutePlanner2Stop = {
            id: options.id ?? createId('stop'),
            name: options.name ?? `Stop ${scenario.stops.length + 1}`,
            address: options.address,
            riderCount: options.riderCount,
            sourceRows: options.sourceRows,
            lat: options.lat,
            lng: options.lng,
            sequence: scenario.stops.length + 1,
            role: options.role ?? 'regular',
            source: options.source ?? 'custom',
            stopCode: options.stopCode,
            notes: options.notes,
        };

        if (scenario.routeShape === 'out-and-back' && scenario.stops.length >= 1) {
            const stops = [
                ...scenario.stops.map((existingStop) =>
                    existingStop.role === 'turnaround' ? { ...existingStop, role: 'regular' as const } : existingStop,
                ),
                { ...stop, role: 'turnaround' as const },
            ];

            return {
                ...scenario,
                stops,
                turnaroundStopId: stop.id,
                alignment: resequenceScenarioAlignment({ ...scenario, stops, turnaroundStopId: stop.id }, scenario.alignment),
                feasibility: undefined,
            };
        }

        return {
            ...scenario,
            stops: [...scenario.stops, stop],
            feasibility: undefined,
        };
    }, now);
}

export function addRoutePlanner2Stops(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: {
        stops: Array<{
            id?: string;
            name?: string;
            address?: string;
            riderCount?: number;
            sourceRows?: number[];
            lat: number;
            lng: number;
            notes?: string;
            source?: RoutePlanner2Stop['source'];
            stopCode?: string;
        }>;
        now?: string;
    },
): RoutePlanner2Project {
    const validStops = options.stops.filter(isValidCoordinate);
    if (validStops.length === 0) return project;

    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        const existingStops = sortRoutePlanner2Stops(scenario.stops);
        const importedStops = validStops.map((stop, index): RoutePlanner2Stop => ({
            id: stop.id ?? createId('stop'),
            name: stop.name ?? `Stop ${existingStops.length + index + 1}`,
            address: stop.address,
            riderCount: stop.riderCount,
            sourceRows: stop.sourceRows,
            lat: stop.lat,
            lng: stop.lng,
            sequence: existingStops.length + index + 1,
            role: 'regular',
            source: stop.source ?? 'custom',
            stopCode: stop.stopCode,
            notes: stop.notes,
        }));
        const updatedScenario: RoutePlanner2Scenario = {
            ...scenario,
            stops: resequenceStops([...existingStops, ...importedStops]),
            feasibility: undefined,
        };

        return cleanRuntimeForCurrentSegments(updatedScenario);
    }, now);
}

export function insertRoutePlanner2StopBetween(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: {
        id?: string;
        name?: string;
        afterStopId: string;
        beforeStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        lat: number;
        lng: number;
        now?: string;
    },
): RoutePlanner2Project {
    if (!isValidCoordinate(options)) return project;
    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        if (!validateLineWaypointSegment(scenario, options.afterStopId, options.beforeStopId)) return scenario;

        const stops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
        const afterStopIndex = stops.findIndex((stop) => stop.id === options.afterStopId);
        const beforeStop = stops.find((stop) => stop.id === options.beforeStopId);
        if (afterStopIndex < 0 || !beforeStop) return scenario;

        const stop: RoutePlanner2Stop = {
            id: options.id ?? createId('stop'),
            name: options.name ?? `Stop ${scenario.stops.length + 1}`,
            lat: options.lat,
            lng: options.lng,
            sequence: afterStopIndex + 2,
            role: 'regular',
            source: 'custom',
        };

        const segmentKey = getSegmentKey(options.afterStopId, options.beforeStopId);
        const segmentWaypoints = sortSegmentWaypoints(scenario.alignment.filter((point) => getPointSegmentKey(point) === segmentKey));
        const otherWaypoints = scenario.alignment.filter((point) => getPointSegmentKey(point) !== segmentKey);
        let splitIndex = segmentWaypoints.length;

        if (options.insertAfterWaypointId) {
            const afterIndex = segmentWaypoints.findIndex((point) => point.id === options.insertAfterWaypointId);
            if (afterIndex >= 0) splitIndex = afterIndex + 1;
        } else if (options.insertBeforeWaypointId) {
            const beforeIndex = segmentWaypoints.findIndex((point) => point.id === options.insertBeforeWaypointId);
            if (beforeIndex >= 0) splitIndex = beforeIndex;
        }

        const beforeInsertedStopWaypoints = normalizeSegmentWaypoints(
            segmentWaypoints.slice(0, splitIndex),
            options.afterStopId,
            stop.id,
        );
        const afterInsertedStopWaypoints = normalizeSegmentWaypoints(
            segmentWaypoints.slice(splitIndex),
            stop.id,
            options.beforeStopId,
        );
        const updatedStops = resequenceStops([
            ...stops.slice(0, afterStopIndex + 1),
            stop,
            ...stops.slice(afterStopIndex + 1),
        ]);
        const updatedScenario = {
            ...scenario,
            stops: updatedStops,
        };

        return {
            ...updatedScenario,
            alignment: resequenceScenarioAlignment(updatedScenario, [
                ...otherWaypoints,
                ...beforeInsertedStopWaypoints,
                ...afterInsertedStopWaypoints,
            ]),
            feasibility: undefined,
        };
    }, now);
}

export function renameRoutePlanner2Stop(
    project: RoutePlanner2Project,
    scenarioId: string,
    stopId: string,
    name: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    const trimmedName = name.trim();
    if (!trimmedName) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.stops.some((stop) => stop.id === stopId)) return scenario;

        return {
            ...scenario,
            stops: scenario.stops.map((stop) => stop.id === stopId ? { ...stop, name: trimmedName } : stop),
            feasibility: undefined,
        };
    }, now);
}

export function updateRoutePlanner2RuntimeSourceMode(
    project: RoutePlanner2Project,
    scenarioId: string,
    runtimeSourceMode: RoutePlanner2RuntimeSourceMode,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        const currentMode = scenario.runtimeSourceMode ?? 'gtfs';
        const currentEstimates = scenario.runtimeEstimates ?? [];
        const nextRuntimeEstimates = runtimeSourceMode === 'mapbox'
            ? currentEstimates.filter((estimate) => !GTFS_RUNTIME_EVIDENCE_SOURCES.has(estimate.source))
            : currentEstimates;
        const runtimeEstimatesChanged = nextRuntimeEstimates.length !== currentEstimates.length;

        if (currentMode === runtimeSourceMode && !runtimeEstimatesChanged) return scenario;

        return {
            ...scenario,
            runtimeSourceMode,
            runtimeEstimates: nextRuntimeEstimates.length > 0 ? nextRuntimeEstimates : undefined,
            feasibility: undefined,
        };
    }, now);
}

export function updateRoutePlanner2StopCoordinate(
    project: RoutePlanner2Project,
    scenarioId: string,
    stopId: string,
    coordinate: { lat: number; lng: number },
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!isValidCoordinate(coordinate)) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.stops.some((stop) => stop.id === stopId)) return scenario;

        return {
            ...scenario,
            stops: scenario.stops.map((stop) => stop.id === stopId
                ? { ...stop, lat: coordinate.lat, lng: coordinate.lng }
                : stop),
            feasibility: undefined,
        };
    }, now);
}

export function upsertRoutePlanner2LineAnchor(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: {
        id?: string;
        afterStopId: string;
        beforeStopId: string;
        lat: number;
        lng: number;
        now?: string;
    },
): RoutePlanner2Project {
    if (!isValidCoordinate(options)) return project;
    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        if (!validateLineWaypointSegment(scenario, options.afterStopId, options.beforeStopId)) return scenario;

        const existingIndex = scenario.alignment.findIndex((point) =>
            point.afterStopId === options.afterStopId && point.beforeStopId === options.beforeStopId,
        );
        const existingAnchor = existingIndex >= 0 ? scenario.alignment[existingIndex] : null;
        const anchor: RoutePlanner2RoutePoint = {
            id: existingAnchor?.id ?? options.id ?? createId('anchor'),
            lat: options.lat,
            lng: options.lng,
            sequence: existingAnchor?.sequence ?? scenario.alignment.length + 1,
            afterStopId: options.afterStopId,
            beforeStopId: options.beforeStopId,
            segmentSequence: existingAnchor?.segmentSequence ?? 1,
        };
        const alignment = existingIndex >= 0
            ? scenario.alignment.map((point, index) => index === existingIndex ? anchor : point)
            : [...scenario.alignment, anchor];

        return {
            ...scenario,
            alignment: resequenceScenarioAlignment(scenario, alignment),
            feasibility: undefined,
        };
    }, now);
}

export function addRoutePlanner2LineWaypoint(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: {
        id?: string;
        afterStopId: string;
        beforeStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        lat: number;
        lng: number;
        now?: string;
    },
): RoutePlanner2Project {
    if (!isValidCoordinate(options)) return project;
    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        if (!validateLineWaypointSegment(scenario, options.afterStopId, options.beforeStopId)) return scenario;

        const segmentKey = getSegmentKey(options.afterStopId, options.beforeStopId);
        const segmentWaypoints = sortSegmentWaypoints(scenario.alignment.filter((point) => getPointSegmentKey(point) === segmentKey));
        const otherWaypoints = scenario.alignment.filter((point) => getPointSegmentKey(point) !== segmentKey);
        let insertIndex = segmentWaypoints.length;

        if (options.insertAfterWaypointId) {
            const afterIndex = segmentWaypoints.findIndex((point) => point.id === options.insertAfterWaypointId);
            if (afterIndex >= 0) insertIndex = afterIndex + 1;
        } else if (options.insertBeforeWaypointId) {
            const beforeIndex = segmentWaypoints.findIndex((point) => point.id === options.insertBeforeWaypointId);
            if (beforeIndex >= 0) insertIndex = beforeIndex;
        }

        const waypoint: RoutePlanner2RoutePoint = {
            id: options.id ?? createId('waypoint'),
            lat: options.lat,
            lng: options.lng,
            sequence: scenario.alignment.length + 1,
            afterStopId: options.afterStopId,
            beforeStopId: options.beforeStopId,
        };
        const updatedSegmentWaypoints = [
            ...segmentWaypoints.slice(0, insertIndex),
            waypoint,
            ...segmentWaypoints.slice(insertIndex),
        ];
        const alignment = [
            ...otherWaypoints,
            ...normalizeSegmentWaypoints(updatedSegmentWaypoints, options.afterStopId, options.beforeStopId),
        ];

        return {
            ...scenario,
            alignment: resequenceScenarioAlignment(scenario, alignment),
            feasibility: undefined,
        };
    }, now);
}

export function updateRoutePlanner2LineWaypointCoordinate(
    project: RoutePlanner2Project,
    scenarioId: string,
    waypointId: string,
    coordinate: { lat: number; lng: number },
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!isValidCoordinate(coordinate)) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.alignment.some((point) => point.id === waypointId && point.afterStopId && point.beforeStopId)) return scenario;

        const alignment = scenario.alignment.map((point) => point.id === waypointId
            ? { ...point, lat: coordinate.lat, lng: coordinate.lng }
            : point);

        return {
            ...scenario,
            alignment: resequenceScenarioAlignment(scenario, alignment),
            feasibility: undefined,
        };
    }, now);
}

export function deleteRoutePlanner2LineWaypoint(
    project: RoutePlanner2Project,
    scenarioId: string,
    waypointId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!waypointId) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.alignment.some((point) => point.id === waypointId && point.afterStopId && point.beforeStopId)) return scenario;

        return {
            ...scenario,
            alignment: resequenceScenarioAlignment(scenario, scenario.alignment.filter((point) => point.id !== waypointId)),
            feasibility: undefined,
        };
    }, now);
}

export function updateRoutePlanner2StopRole(
    project: RoutePlanner2Project,
    scenarioId: string,
    stopId: string,
    role: RoutePlanner2StopRole,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.stops.some((stop) => stop.id === stopId)) return scenario;
        const nextRouteShape = role === 'turnaround' ? 'out-and-back' : scenario.routeShape;
        const nextTurnaroundStopId = role === 'turnaround'
            ? stopId
            : scenario.turnaroundStopId === stopId
                ? undefined
                : scenario.turnaroundStopId;

        return {
            ...scenario,
            routeShape: nextRouteShape,
            turnaroundStopId: nextTurnaroundStopId,
            stops: scenario.stops.map((stop) => {
                if (stop.id === stopId) return { ...stop, role };
                if (role === 'turnaround' && stop.role === 'turnaround') return { ...stop, role: 'regular' };
                return stop;
            }),
            feasibility: undefined,
        };
    }, now);
}

export function updateRoutePlanner2RouteShape(
    project: RoutePlanner2Project,
    scenarioId: string,
    routeShape: RoutePlanner2RouteShape,
    options: { turnaroundStopId?: string; now?: string } = {},
): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();

    return updateScenario(project, scenarioId, (scenario) => {
        const stops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
        const requestedTurnaround = options.turnaroundStopId
            ? stops.find((stop) => stop.id === options.turnaroundStopId)
            : undefined;
        const currentTurnaround = scenario.turnaroundStopId
            ? stops.find((stop) => stop.id === scenario.turnaroundStopId)
            : undefined;
        const farEndTurnaround = stops.length > 1 ? stops[stops.length - 1] : undefined;
        const turnaroundStop = routeShape === 'out-and-back'
            ? requestedTurnaround ?? currentTurnaround ?? farEndTurnaround
            : undefined;

        const shapedStops = stops.map((stop, index) => {
            if (routeShape === 'closed-loop') {
                if (index === 0) return { ...stop, role: 'start-terminal' as const };
                return stop.role === 'end-terminal' || stop.role === 'turnaround' ? { ...stop, role: 'regular' as const } : stop;
            }

            if (routeShape === 'out-and-back') {
                if (index === 0) return { ...stop, role: 'start-terminal' as const };
                if (turnaroundStop && stop.id === turnaroundStop.id) return { ...stop, role: 'turnaround' as const };
                return stop.role === 'end-terminal' || stop.role === 'turnaround' ? { ...stop, role: 'regular' as const } : stop;
            }

            if (index === 0 && stop.role !== 'start-terminal') return { ...stop, role: 'start-terminal' as const };
            if (index === stops.length - 1 && stop.role !== 'end-terminal') return { ...stop, role: 'end-terminal' as const };
            if (stop.role === 'turnaround') return { ...stop, role: 'regular' as const };
            return stop;
        });

        const updatedScenario = {
            ...scenario,
            routeShape,
            stops: resequenceStops(shapedStops),
            turnaroundStopId: turnaroundStop?.id,
        };

        return {
            ...updatedScenario,
            alignment: resequenceScenarioAlignment(updatedScenario, scenario.alignment),
            feasibility: undefined,
        };
    }, now);
}

function arraysMatch<T>(current: T[] | undefined, next: T[] | undefined): boolean {
    const currentItems = current ?? [];
    const nextItems = next ?? [];
    return currentItems.length === nextItems.length
        && currentItems.every((item, index) => item === nextItems[index]);
}

function segmentRuntimeChanged(
    current: RoutePlanner2SegmentRuntime | undefined,
    next: RoutePlanner2SegmentRuntime,
): boolean {
    if (!current) return true;
    return current.id !== next.id
        || current.fromStopId !== next.fromStopId
        || current.toStopId !== next.toStopId
        || current.runtimeMinutes !== next.runtimeMinutes
        || current.source !== next.source
        || current.sampleSize !== next.sampleSize
        || current.scheduledRuntimeMinutes !== next.scheduledRuntimeMinutes
        || current.scheduledCoverageRatio !== next.scheduledCoverageRatio
        || current.scheduledCoverageDistanceKm !== next.scheduledCoverageDistanceKm
        || current.estimatedUncoveredDistanceKm !== next.estimatedUncoveredDistanceKm
        || current.observedRuntimeMinutes !== next.observedRuntimeMinutes
        || current.matchQuality !== next.matchQuality
        || current.matchedFromStopId !== next.matchedFromStopId
        || current.matchedToStopId !== next.matchedToStopId
        || !arraysMatch(current.matchedRoutes, next.matchedRoutes)
        || current.evidenceMethod !== next.evidenceMethod
        || !arraysMatch(current.matchedGtfsPathStopIds, next.matchedGtfsPathStopIds)
        || current.evidenceDayType !== next.evidenceDayType
        || current.evidencePeriod !== next.evidencePeriod
        || current.confidence !== next.confidence
        || current.distanceKm !== next.distanceKm
        || current.durationSeconds !== next.durationSeconds
        || current.pathFingerprint !== next.pathFingerprint
        || current.fallbackReason !== next.fallbackReason;
}

const RUNTIME_SOURCE_PRIORITY: Record<RoutePlanner2SegmentRuntime['source'], number> = {
    missing: 0,
    fallback: 1,
    mapbox: 2,
    'scheduled-proxy': 3,
    'partial-scheduled-proxy': 3,
    'observed-scheduled-blend': 4,
    'observed-proxy': 5,
    manual: 6,
};

function shouldReplaceRuntimeEstimate(
    current: RoutePlanner2SegmentRuntime | undefined,
    next: RoutePlanner2SegmentRuntime,
): boolean {
    if (!current) return true;
    if (current.pathFingerprint && next.pathFingerprint && current.pathFingerprint !== next.pathFingerprint) return true;
    return RUNTIME_SOURCE_PRIORITY[next.source] >= RUNTIME_SOURCE_PRIORITY[current.source];
}

export function updateRoutePlanner2SegmentRuntimeEstimates(
    project: RoutePlanner2Project,
    scenarioId: string,
    estimates: RoutePlanner2SegmentRuntime[],
    now = new Date().toISOString(),
    options: {
        replaceForSegmentIds?: string[];
        replaceSources?: RoutePlanner2SegmentRuntime['source'][];
    } = {},
): RoutePlanner2Project {
    if (estimates.length === 0 && !options.replaceForSegmentIds?.length) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        const currentEstimates = scenario.runtimeEstimates ?? [];
        const replacementSegmentIds = new Set(options.replaceForSegmentIds ?? []);
        const replacementSources = new Set(options.replaceSources ?? []);
        const estimatesToApply = estimates.filter((estimate) =>
            shouldReplaceRuntimeEstimate(currentEstimates.find((item) => item.id === estimate.id), estimate),
        );

        const estimateIds = new Set(estimatesToApply.map((estimate) => estimate.id));
        const retainedEstimates = currentEstimates.filter((estimate) => {
            if (estimateIds.has(estimate.id)) return false;
            if (
                replacementSegmentIds.has(estimate.id)
                && (replacementSources.size === 0 || replacementSources.has(estimate.source))
            ) {
                return false;
            }
            return true;
        });
        let changed = retainedEstimates.length !== currentEstimates.length;

        estimatesToApply.forEach((estimate) => {
            const existing = currentEstimates.find((item) => item.id === estimate.id);
            if (segmentRuntimeChanged(existing, estimate)) changed = true;
        });

        if (!changed) return scenario;

        const nextRuntimeEstimates = [
            ...retainedEstimates,
            ...estimatesToApply.map((estimate) => ({ ...estimate, updatedAt: estimate.updatedAt ?? now })),
        ];

        return {
            ...scenario,
            runtimeEstimates: nextRuntimeEstimates.length > 0 ? nextRuntimeEstimates : undefined,
            feasibility: undefined,
        };
    }, now);
}

export function setRoutePlanner2SegmentRuntimeOverride(
    project: RoutePlanner2Project,
    scenarioId: string,
    segmentId: string,
    runtimeMinutes: number,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!segmentId || !Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0) return project;
    const roundedRuntimeMinutes = Math.max(1, Math.round(runtimeMinutes));

    return updateScenario(project, scenarioId, (scenario) => {
        const currentOverride = scenario.runtimeOverrides?.[segmentId];
        if (currentOverride?.runtimeMinutes === roundedRuntimeMinutes) return scenario;

        return {
            ...scenario,
            runtimeOverrides: {
                ...(scenario.runtimeOverrides ?? {}),
                [segmentId]: {
                    runtimeMinutes: roundedRuntimeMinutes,
                    updatedAt: now,
                },
            },
            feasibility: undefined,
        };
    }, now);
}

export function clearRoutePlanner2SegmentRuntimeOverride(
    project: RoutePlanner2Project,
    scenarioId: string,
    segmentId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!segmentId) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.runtimeOverrides?.[segmentId]) return scenario;
        const remainingOverrides = { ...scenario.runtimeOverrides };
        delete remainingOverrides[segmentId];

        return {
            ...scenario,
            runtimeOverrides: Object.keys(remainingOverrides).length > 0 ? remainingOverrides : undefined,
            feasibility: undefined,
        };
    }, now);
}

export function moveRoutePlanner2Stop(
    project: RoutePlanner2Project,
    scenarioId: string,
    stopId: string,
    direction: 'up' | 'down',
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        const currentIndex = scenario.stops.findIndex((stop) => stop.id === stopId);
        if (currentIndex < 0) return scenario;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= scenario.stops.length) return scenario;

        const stops = [...scenario.stops];
        const [stop] = stops.splice(currentIndex, 1);
        if (!stop) return scenario;
        stops.splice(targetIndex, 0, stop);
        const updatedScenario = {
            ...scenario,
            stops: resequenceStops(stops),
        };

        return {
            ...updatedScenario,
            alignment: resequenceScenarioAlignment(updatedScenario, scenario.alignment),
            feasibility: undefined,
        };
    }, now);
}

export function moveRoutePlanner2LineWaypointInOrder(
    project: RoutePlanner2Project,
    scenarioId: string,
    waypointId: string,
    direction: 'up' | 'down',
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        const waypoint = scenario.alignment.find((point) =>
            point.id === waypointId && point.afterStopId && point.beforeStopId,
        );
        if (!waypoint?.afterStopId || !waypoint.beforeStopId) return scenario;

        const items = buildLineWaypointOrderItems(scenario);
        const currentIndex = items.findIndex((item) => item.type === 'bend' && item.waypoint.id === waypointId);
        if (currentIndex < 0) return scenario;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        const targetItem = items[targetIndex];
        if (!targetItem) return scenario;

        let targetAfterStopId = waypoint.afterStopId;
        let targetBeforeStopId = waypoint.beforeStopId;
        let insertIndex = 0;

        if (targetItem.type === 'bend') {
            targetAfterStopId = targetItem.afterStopId;
            targetBeforeStopId = targetItem.beforeStopId;
            const targetSegmentWaypoints = sortSegmentWaypoints(scenario.alignment.filter((point) =>
                point.id !== waypointId
                && point.afterStopId === targetAfterStopId
                && point.beforeStopId === targetBeforeStopId,
            ));
            const neighborIndex = targetSegmentWaypoints.findIndex((point) => point.id === targetItem.waypoint.id);
            insertIndex = direction === 'up' ? Math.max(0, neighborIndex) : neighborIndex + 1;
        } else if (direction === 'up') {
            const previousStopId = findStopBefore(items, targetIndex - 1);
            if (!previousStopId) return scenario;
            targetAfterStopId = previousStopId;
            targetBeforeStopId = targetItem.stopId;
            insertIndex = Number.POSITIVE_INFINITY;
        } else {
            const nextStopId = findStopAfter(items, targetIndex + 1);
            if (!nextStopId) return scenario;
            targetAfterStopId = targetItem.stopId;
            targetBeforeStopId = nextStopId;
            insertIndex = 0;
        }

        if (!validateLineWaypointSegment(scenario, targetAfterStopId, targetBeforeStopId)) return scenario;

        const targetSegmentKey = getSegmentKey(targetAfterStopId, targetBeforeStopId);
        const alignmentWithoutMovedWaypoint = scenario.alignment.filter((point) => point.id !== waypointId);
        const targetSegmentWaypoints = sortSegmentWaypoints(alignmentWithoutMovedWaypoint.filter((point) =>
            getPointSegmentKey(point) === targetSegmentKey,
        ));
        const otherWaypoints = alignmentWithoutMovedWaypoint.filter((point) =>
            getPointSegmentKey(point) !== targetSegmentKey,
        );
        const boundedInsertIndex = Number.isFinite(insertIndex)
            ? Math.max(0, Math.min(insertIndex, targetSegmentWaypoints.length))
            : targetSegmentWaypoints.length;
        const movedWaypoint = {
            ...waypoint,
            afterStopId: targetAfterStopId,
            beforeStopId: targetBeforeStopId,
        };
        const updatedSegmentWaypoints = [
            ...targetSegmentWaypoints.slice(0, boundedInsertIndex),
            movedWaypoint,
            ...targetSegmentWaypoints.slice(boundedInsertIndex),
        ];
        const alignment = [
            ...otherWaypoints,
            ...normalizeSegmentWaypoints(updatedSegmentWaypoints, targetAfterStopId, targetBeforeStopId),
        ];

        return {
            ...scenario,
            alignment: resequenceScenarioAlignment(scenario, alignment),
            feasibility: undefined,
        };
    }, now);
}

export function deleteRoutePlanner2Stop(
    project: RoutePlanner2Project,
    scenarioId: string,
    stopId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.stops.some((stop) => stop.id === stopId)) return scenario;
        const updatedScenario = {
            ...scenario,
            stops: resequenceStops(scenario.stops.filter((stop) => stop.id !== stopId)),
        };
        const validTurnaround = updatedScenario.routeShape === 'out-and-back'
            && updatedScenario.stops.some((stop) => stop.id === updatedScenario.turnaroundStopId);
        const normalizedScenario = updatedScenario.routeShape !== 'out-and-back' || validTurnaround
            ? updatedScenario
            : { ...updatedScenario, turnaroundStopId: undefined };

        return {
            ...normalizedScenario,
            alignment: resequenceScenarioAlignment(normalizedScenario, scenario.alignment.filter((point) =>
                point.afterStopId !== stopId && point.beforeStopId !== stopId,
            )),
            feasibility: undefined,
        };
    }, now);
}

export function clearRoutePlanner2Stops(
    project: RoutePlanner2Project,
    scenarioId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        if (
            scenario.stops.length === 0
            && scenario.alignment.length === 0
            && scenario.routeShape === 'one-way'
            && !scenario.turnaroundStopId
            && !scenario.runtimeEstimates
            && !scenario.runtimeOverrides
            && !scenario.feasibility
        ) {
            return scenario;
        }

        return {
            ...scenario,
            routeShape: 'one-way',
            stops: [],
            alignment: [],
            turnaroundStopId: undefined,
            runtimeEstimates: undefined,
            runtimeOverrides: undefined,
            feasibility: undefined,
        };
    }, now);
}

export function reassignRoutePlanner2StopRange(
    project: RoutePlanner2Project,
    options: {
        sourceScenarioId: string;
        targetScenarioId: string;
        fromSequence: number;
        toSequence: number;
        insertAfterStopId?: string | null;
        mode: 'copy' | 'move';
        now?: string;
    },
): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();
    if (options.sourceScenarioId === options.targetScenarioId) return project;
    if (!Number.isFinite(options.fromSequence) || !Number.isFinite(options.toSequence)) return project;

    const sourceScenario = project.scenarios.find((scenario) => scenario.id === options.sourceScenarioId);
    const targetScenario = project.scenarios.find((scenario) => scenario.id === options.targetScenarioId);
    if (!sourceScenario || !targetScenario) return project;

    const rangeStart = Math.min(options.fromSequence, options.toSequence);
    const rangeEnd = Math.max(options.fromSequence, options.toSequence);
    const sourceStops = sortRoutePlanner2Stops(sourceScenario.stops);
    const targetStops = sortRoutePlanner2Stops(targetScenario.stops);
    const stopsToTransfer = sourceStops.filter((stop) => stop.sequence >= rangeStart && stop.sequence <= rangeEnd);
    if (stopsToTransfer.length === 0) return project;

    const removedStopIds = new Set(stopsToTransfer.map((stop) => stop.id));
    const targetUsedStopIds = new Set(targetStops.map((stop) => stop.id));
    const requestedInsertIndex = options.insertAfterStopId
        ? targetStops.findIndex((stop) => stop.id === options.insertAfterStopId)
        : -1;
    const normalizedInsertIndex = options.insertAfterStopId
        ? requestedInsertIndex >= 0 ? requestedInsertIndex + 1 : targetStops.length
        : 0;
    const targetWasEmpty = targetStops.length === 0;
    const transferredStops = stopsToTransfer.map((stop, index): RoutePlanner2Stop => ({
        ...stop,
        id: createUniqueTransferredStopId(stop.id, now, index, targetUsedStopIds),
        sequence: normalizedInsertIndex + index + 1,
        role: targetWasEmpty
            ? index === 0
                ? 'start-terminal'
                : index === stopsToTransfer.length - 1
                    ? 'end-terminal'
                    : 'regular'
            : 'regular',
    }));
    const transferredStopIdBySourceId = new Map(stopsToTransfer.map((stop, index) => [
        stop.id,
        transferredStops[index]!.id,
    ]));
    const targetUsedPointIds = new Set(targetScenario.alignment.map((point) => point.id));
    const transferredAlignment = sourceScenario.alignment
        .filter((point) =>
            Boolean(point.afterStopId)
            && Boolean(point.beforeStopId)
            && transferredStopIdBySourceId.has(point.afterStopId!)
            && transferredStopIdBySourceId.has(point.beforeStopId!),
        )
        .map((point, index): RoutePlanner2RoutePoint => ({
            ...point,
            id: createUniqueTransferredWaypointId(point.id, now, index, targetUsedPointIds),
            afterStopId: transferredStopIdBySourceId.get(point.afterStopId!)!,
            beforeStopId: transferredStopIdBySourceId.get(point.beforeStopId!)!,
        }));
    const transferredRuntimeEstimates = (sourceScenario.runtimeEstimates ?? [])
        .filter((estimate) =>
            transferredStopIdBySourceId.has(estimate.fromStopId)
            && transferredStopIdBySourceId.has(estimate.toStopId),
        )
        .map((estimate): RoutePlanner2SegmentRuntime => {
            const fromStopId = transferredStopIdBySourceId.get(estimate.fromStopId)!;
            const toStopId = transferredStopIdBySourceId.get(estimate.toStopId)!;
            return {
                ...estimate,
                id: getRoutePlanner2SegmentId(fromStopId, toStopId),
                fromStopId,
                toStopId,
                updatedAt: now,
            };
        });

    const targetScenarioWithStops = {
        ...targetScenario,
        stops: resequenceStops([
            ...targetStops.slice(0, normalizedInsertIndex),
            ...transferredStops,
            ...targetStops.slice(normalizedInsertIndex),
        ]),
        runtimeEstimates: [
            ...(targetScenario.runtimeEstimates ?? []),
            ...transferredRuntimeEstimates,
        ],
    };
    const updatedTargetScenario = cleanRuntimeForCurrentSegments({
        ...targetScenarioWithStops,
        alignment: resequenceScenarioAlignment(targetScenarioWithStops, [
            ...targetScenario.alignment,
            ...transferredAlignment,
        ]),
    });

    const sourceScenarioWithStops = {
        ...sourceScenario,
        stops: resequenceStops(sourceStops.filter((stop) => !removedStopIds.has(stop.id))),
    };
    const updatedSourceScenario = options.mode === 'move'
        ? cleanRuntimeForCurrentSegments({
            ...sourceScenarioWithStops,
            alignment: resequenceScenarioAlignment(sourceScenarioWithStops, sourceScenario.alignment.filter((point) =>
                !point.afterStopId
                || !point.beforeStopId
                || (!removedStopIds.has(point.afterStopId) && !removedStopIds.has(point.beforeStopId)),
            )),
        })
        : sourceScenario;

    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id === options.sourceScenarioId) return { ...updatedSourceScenario, updatedAt: now };
        if (scenario.id === options.targetScenarioId) return { ...updatedTargetScenario, updatedAt: now };
        return scenario;
    });

    return markChanged({ ...project, scenarios }, now);
}

export function validateRoutePlanner2Terminals(scenario: RoutePlanner2Scenario): RoutePlanner2Warning[] {
    const startTerminals = scenario.stops.filter((stop) => stop.role === 'start-terminal');
    const endTerminals = scenario.stops.filter((stop) => stop.role === 'end-terminal');
    const turnaroundStops = scenario.stops.filter((stop) => stop.role === 'turnaround');
    const sortedStops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
    const turnaroundStop = getRoutePlanner2TurnaroundStop(scenario);
    const warnings: RoutePlanner2Warning[] = [];

    if (scenario.stops.length === 0) {
        warnings.push({
            id: 'no-stops',
            severity: 'blocking',
            message: 'Add stops before checking route feasibility.',
            action: 'Add at least a start terminal, one stop, and an end terminal.',
        });
    }

    if (startTerminals.length === 0) {
        warnings.push({
            id: 'missing-start-terminal',
            severity: 'blocking',
            message: 'Add a start terminal before estimating cycle time.',
            action: 'Mark the first stop as the start terminal.',
        });
    }

    if (scenario.routeShape === 'closed-loop') {
        if (scenario.stops.length > 0 && startTerminals.length === 0) {
            warnings.push({
                id: 'missing-loop-layover',
                severity: 'blocking',
                message: 'Choose a layover point before estimating the loop cycle.',
                action: 'Use Stop 1 as the loop layover point or mark another stop as the start terminal.',
            });
        }
    } else if (scenario.routeShape === 'out-and-back') {
        if (!turnaroundStop || !sortedStops.some((stop) => stop.id === turnaroundStop.id) || turnaroundStop.id === sortedStops[0]?.id) {
            warnings.push({
                id: 'missing-turnaround-stop',
                severity: 'blocking',
                message: 'Choose a bus-safe turnaround before estimating the out-and-back cycle.',
                action: 'Choose Out and back again to use the far end stop, or add a stop that can safely turn a bus.',
            });
        } else if (turnaroundStop.role !== 'turnaround') {
            warnings.push({
                id: 'turnaround-not-bus-safe',
                severity: 'blocking',
                message: 'The out-and-back route needs an explicit bus turnaround, not an implied U-turn.',
                action: 'Choose Out and back to mark the far end automatically, or draw a closed loop instead.',
            });
        }
    } else if (endTerminals.length === 0) {
        warnings.push({
            id: 'missing-end-terminal',
            severity: 'blocking',
            message: 'End terminal is missing.',
            action: 'Mark the final stop as the end terminal.',
        });
    }

    if (startTerminals.length > 1) {
        warnings.push({
            id: 'multiple-start-terminals',
            severity: 'warning',
            message: 'More than one start terminal is marked.',
            action: 'Keep one start terminal for this one-way concept.',
        });
    }

    if (scenario.routeShape === 'one-way' && endTerminals.length > 1) {
        warnings.push({
            id: 'multiple-end-terminals',
            severity: 'warning',
            message: 'More than one end terminal is marked.',
            action: 'Keep one end terminal for this one-way concept.',
        });
    }

    if (turnaroundStops.length > 1) {
        warnings.push({
            id: 'multiple-turnaround-stops',
            severity: 'warning',
            message: 'More than one bus turnaround is marked.',
            action: 'Keep one bus turnaround for this out-and-back route.',
        });
    }

    const startTerminal = startTerminals[0];
    const endTerminal = endTerminals[0];
    if (startTerminal && endTerminal && startTerminal.sequence >= endTerminal.sequence) {
        warnings.push({
            id: 'terminal-order',
            severity: 'blocking',
            message: 'Start terminal must come before the end terminal.',
            action: 'Reorder stops or change terminal roles.',
        });
    }

    return warnings;
}
