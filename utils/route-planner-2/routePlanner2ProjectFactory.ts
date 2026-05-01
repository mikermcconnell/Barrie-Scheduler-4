import type { RoutePlanner2Project, RoutePlanner2Scenario, RoutePlanner2ServiceAssumptions } from './routePlanner2Types';

const DEFAULT_SERVICE: RoutePlanner2ServiceAssumptions = {
    firstTripTime: '06:00',
    lastTripTime: '22:00',
    frequencyMinutes: 30,
    startTerminalLayoverMinutes: 5,
    endTerminalLayoverMinutes: 5,
    intermediateStopDwellSeconds: 0,
};

function createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRoutePlanner2Scenario(options: {
    id?: string;
    name?: string;
    now?: string;
} = {}): RoutePlanner2Scenario {
    const now = options.now ?? new Date().toISOString();

    return {
        id: options.id ?? createId('scenario'),
        name: options.name ?? 'Clean Concept A',
        status: 'draft',
        routeShape: 'one-way',
        alignment: [],
        stops: [],
        service: { ...DEFAULT_SERVICE },
        notes: 'Blank route concept. Add stops in travel order before running feasibility checks.',
        createdAt: now,
        updatedAt: now,
    };
}

export function createRoutePlanner2Project(options: {
    id?: string;
    now?: string;
    scenarioId?: string;
} = {}): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();
    const scenario = createRoutePlanner2Scenario({
        id: options.scenarioId,
        now,
    });

    return {
        id: options.id ?? createId('project'),
        name: 'Untitled Route Study',
        status: 'local-draft',
        selectedScenarioId: scenario.id,
        scenarios: [scenario],
        createdAt: now,
        updatedAt: now,
    };
}
