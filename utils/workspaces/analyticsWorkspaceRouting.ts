export type AnalyticsWorkspaceView =
    | 'dashboard'
    | 'import'
    | 'transit-data'
    | 'od-import'
    | 'od-fix-coords'
    | 'od-workspace'
    | 'headway-map'
    | 'corridor-speed'
    | 'student-pass'
    | 'fleet-plan-import'
    | 'fleet-plan-workspace'
    | 'residential-growth'
    | 'route-planner-2'
    | 'route-concept-planner'
    | 'network-connections'
    | 'shuttle-planner'
    | 'fare-programs'
    | 'strategic-plan'
    | 'ridership-trends';

const ANALYTICS_WORKSPACE_VIEWS = new Set<AnalyticsWorkspaceView>([
    'dashboard',
    'import',
    'transit-data',
    'od-import',
    'od-fix-coords',
    'od-workspace',
    'headway-map',
    'corridor-speed',
    'student-pass',
    'fleet-plan-import',
    'fleet-plan-workspace',
    'residential-growth',
    'route-planner-2',
    'route-concept-planner',
    'network-connections',
    'shuttle-planner',
    'fare-programs',
    'strategic-plan',
    'ridership-trends',
]);

const ANALYTICS_WORKSPACE_VIEW_LABELS: Record<AnalyticsWorkspaceView, string> = {
    dashboard: 'Planning Data',
    import: 'Transit App Import',
    'transit-data': 'Transit App Data',
    'od-import': 'OD Matrix Import',
    'od-fix-coords': 'OD Coordinate Review',
    'od-workspace': 'Agency OD Analysis',
    'headway-map': 'Corridor Headway',
    'corridor-speed': 'Corridor Performance',
    'student-pass': 'Student Transit Pass',
    'fleet-plan-import': 'Fleet Plan Import',
    'fleet-plan-workspace': 'Fleet Plan',
    'residential-growth': 'Residential Growth',
    'route-planner-2': 'Camp Shuttle Planner',
    'route-concept-planner': 'Route Concept Planner',
    'network-connections': 'Network Connections',
    'shuttle-planner': 'Shuttle Planner',
    'fare-programs': 'Fare Programs',
    'strategic-plan': '2027–2032 Strategic Plan',
    'ridership-trends': 'Ridership Trends',
};

const normalizeHashParts = (value: string): string[] =>
    value
        .trim()
        .replace(/^#/, '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);

export function isAnalyticsWorkspaceView(value: string | undefined): value is AnalyticsWorkspaceView {
    return Boolean(value && ANALYTICS_WORKSPACE_VIEWS.has(value as AnalyticsWorkspaceView));
}

export function parseAnalyticsWorkspaceViewFromHash(
    hash: string,
    routePrefix: string,
): AnalyticsWorkspaceView {
    const hashParts = normalizeHashParts(hash);
    const prefixParts = normalizeHashParts(routePrefix);
    const hasPrefix = prefixParts.every((part, index) => hashParts[index] === part);
    if (!hasPrefix) return 'dashboard';

    const candidate = hashParts[prefixParts.length];
    return isAnalyticsWorkspaceView(candidate) ? candidate : 'dashboard';
}

export function buildAnalyticsWorkspaceHash(
    routePrefix: string,
    view: AnalyticsWorkspaceView,
): string {
    const prefix = normalizeHashParts(routePrefix).join('/');
    return view === 'dashboard' ? `#${prefix}` : `#${prefix}/${view}`;
}

export function getAnalyticsWorkspaceViewLabel(view: AnalyticsWorkspaceView): string {
    return ANALYTICS_WORKSPACE_VIEW_LABELS[view];
}
