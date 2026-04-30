import type {
    RoutePlanner2Project,
    RoutePlanner2RoutePoint,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2Stop,
    RoutePlanner2StopRole,
    RoutePlanner2Warning,
} from './routePlanner2Types';

function createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    const stops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
    const validAlignment = alignment.filter((point) =>
        !point.afterStopId
        || !point.beforeStopId
        || stops.some((stop, index) => stop.id === point.afterStopId && stops[index + 1]?.id === point.beforeStopId),
    );
    const orderedPoints: RoutePlanner2RoutePoint[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < stops.length - 1; index += 1) {
        const fromStop = stops[index];
        const toStop = stops[index + 1];
        if (!fromStop || !toStop) continue;

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
    const stops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
    return stops.some((stop, index) => stop.id === afterStopId && stops[index + 1]?.id === beforeStopId);
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
            lat: options.lat,
            lng: options.lng,
            sequence: scenario.stops.length + 1,
            role: options.role ?? 'regular',
            source: options.source ?? 'custom',
            stopCode: options.stopCode,
            notes: options.notes,
        };

        return {
            ...scenario,
            stops: [...scenario.stops, stop],
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

export function updateRoutePlanner2StopRole(
    project: RoutePlanner2Project,
    scenarioId: string,
    stopId: string,
    role: RoutePlanner2StopRole,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return updateScenario(project, scenarioId, (scenario) => {
        if (!scenario.stops.some((stop) => stop.id === stopId)) return scenario;

        return {
            ...scenario,
            stops: scenario.stops.map((stop) => stop.id === stopId ? { ...stop, role } : stop),
            feasibility: undefined,
        };
    }, now);
}

function segmentRuntimeChanged(
    current: RoutePlanner2SegmentRuntime | undefined,
    next: RoutePlanner2SegmentRuntime,
): boolean {
    if (!current) return true;
    return current.runtimeMinutes !== next.runtimeMinutes
        || current.source !== next.source
        || current.confidence !== next.confidence
        || current.distanceKm !== next.distanceKm
        || current.durationSeconds !== next.durationSeconds
        || current.pathFingerprint !== next.pathFingerprint
        || current.fallbackReason !== next.fallbackReason;
}

export function updateRoutePlanner2SegmentRuntimeEstimates(
    project: RoutePlanner2Project,
    scenarioId: string,
    estimates: RoutePlanner2SegmentRuntime[],
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (estimates.length === 0) return project;

    return updateScenario(project, scenarioId, (scenario) => {
        const currentEstimates = scenario.runtimeEstimates ?? [];
        const estimateIds = new Set(estimates.map((estimate) => estimate.id));
        const retainedEstimates = currentEstimates.filter((estimate) => !estimateIds.has(estimate.id));
        let changed = false;

        estimates.forEach((estimate) => {
            const existing = currentEstimates.find((item) => item.id === estimate.id);
            if (segmentRuntimeChanged(existing, estimate)) changed = true;
        });

        if (!changed) return scenario;

        return {
            ...scenario,
            runtimeEstimates: [
                ...retainedEstimates,
                ...estimates.map((estimate) => ({ ...estimate, updatedAt: estimate.updatedAt ?? now })),
            ],
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

        return {
            ...updatedScenario,
            alignment: resequenceScenarioAlignment(updatedScenario, scenario.alignment.filter((point) =>
                point.afterStopId !== stopId && point.beforeStopId !== stopId,
            )),
            feasibility: undefined,
        };
    }, now);
}

export function validateRoutePlanner2Terminals(scenario: RoutePlanner2Scenario): RoutePlanner2Warning[] {
    const startTerminals = scenario.stops.filter((stop) => stop.role === 'start-terminal');
    const endTerminals = scenario.stops.filter((stop) => stop.role === 'end-terminal');
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

    if (endTerminals.length === 0) {
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

    if (endTerminals.length > 1) {
        warnings.push({
            id: 'multiple-end-terminals',
            severity: 'warning',
            message: 'More than one end terminal is marked.',
            action: 'Keep one end terminal for this one-way concept.',
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
