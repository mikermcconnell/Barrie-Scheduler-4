import {
    ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
    type RouteConceptAlternative,
    type RouteConceptPattern,
    type RouteConceptPatternRole,
    type RouteConceptProject,
    type RouteConceptServiceAssumptions,
    type RouteConceptStructure,
} from './routeConceptPlannerTypes';

export const DEFAULT_ROUTE_CONCEPT_SERVICE: RouteConceptServiceAssumptions = {
    firstDepartureMinutes: 6 * 60,
    lastDepartureMinutes: 22 * 60,
    frequencyMinutes: 30,
    startTerminalLayoverMinutes: 5,
    endTerminalLayoverMinutes: 5,
    intermediateStopDwellSeconds: 0,
    dayType: 'weekday',
    planningPeriod: 'all-day',
};

export function createRouteConceptId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rolesForStructure(structure: RouteConceptStructure): RouteConceptPatternRole[] {
    if (structure === 'bidirectional') return ['outbound', 'inbound'];
    if (structure === 'loop') return ['loop'];
    return ['outbound', 'inbound'];
}

function labelForRole(role: RouteConceptPatternRole): string {
    if (role === 'outbound') return 'Outbound';
    if (role === 'inbound') return 'Inbound';
    if (role === 'loop') return 'Loop';
    return 'Out and back';
}

export function createRouteConceptPattern(options: {
    id?: string;
    name?: string;
    role?: RouteConceptPatternRole;
    now?: string;
} = {}): RouteConceptPattern {
    const now = options.now ?? new Date().toISOString();
    const role = options.role ?? 'outbound';
    return {
        id: options.id ?? createRouteConceptId('pattern'),
        name: options.name ?? labelForRole(role),
        role,
        alignment: [],
        stops: [],
        runtimeEvidence: [],
        runtimeOverrides: {},
        source: { type: 'blank' },
        notes: '',
        createdAt: now,
        updatedAt: now,
    };
}

export function createRouteConceptAlternative(options: {
    id?: string;
    name?: string;
    structure?: RouteConceptStructure;
    now?: string;
    patternIds?: Partial<Record<RouteConceptPatternRole, string>>;
} = {}): RouteConceptAlternative {
    const now = options.now ?? new Date().toISOString();
    const structure = options.structure ?? 'bidirectional';
    const patterns = rolesForStructure(structure).map((role) => createRouteConceptPattern({
        id: options.patternIds?.[role],
        role,
        name: structure === 'out-and-back' ? (role === 'outbound' ? 'Outbound' : 'Return') : undefined,
        now,
    }));
    return {
        id: options.id ?? createRouteConceptId('alternative'),
        name: options.name ?? 'Option 1',
        status: 'draft',
        structure,
        patternOrder: patterns.map((pattern) => pattern.id),
        patterns,
        service: { ...DEFAULT_ROUTE_CONCEPT_SERVICE },
        notes: '',
        createdAt: now,
        updatedAt: now,
    };
}

export function createRouteConceptProject(options: {
    id?: string;
    name?: string;
    now?: string;
    alternativeId?: string;
    structure?: RouteConceptStructure;
} = {}): RouteConceptProject {
    const now = options.now ?? new Date().toISOString();
    const alternative = createRouteConceptAlternative({
        id: options.alternativeId,
        structure: options.structure,
        now,
    });
    return {
        id: options.id ?? createRouteConceptId('route-concept-project'),
        name: options.name ?? 'Untitled Route Concept Study',
        status: 'local-draft',
        schemaVersion: ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
        revision: 0,
        selectedAlternativeId: alternative.id,
        alternativeOrder: [alternative.id],
        alternatives: [alternative],
        createdAt: now,
        updatedAt: now,
    };
}
