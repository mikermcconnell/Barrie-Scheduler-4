import type {
    RoutePlanner2Project,
    RoutePlanner2RoutePoint,
    RoutePlanner2Scenario,
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

function updateScenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    updater: (scenario: RoutePlanner2Scenario) => RoutePlanner2Scenario,
    now: string,
): RoutePlanner2Project {
    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId) return scenario;
        changed = true;
        return { ...updater(scenario), updatedAt: now };
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

        return {
            ...scenario,
            stops: resequenceStops(stops),
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

        return {
            ...scenario,
            stops: resequenceStops(scenario.stops.filter((stop) => stop.id !== stopId)),
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
