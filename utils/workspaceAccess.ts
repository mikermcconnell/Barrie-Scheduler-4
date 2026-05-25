import type { FeatureFlags, FeatureKey } from './features';
import { FEATURE_DEFINITIONS, featureFlags, isFeatureEnabled } from './features';
import type { TeamMember, TeamRole } from './masterScheduleTypes';

export type WorkspaceAccessLevel = 'production' | 'planner' | 'external-planner' | 'transit-app-only' | 'admin' | 'internal';

export type WorkspaceAccessFeatureKey =
    | 'workspaceOndemand'
    | 'workspaceFixedRoute'
    | 'workspaceOperations'
    | 'analyticsTransitApp'
    | 'analyticsOdMatrix'
    | 'analyticsCorridorSpeed'
    | 'analyticsCorridorHeadway'
    | 'analyticsStudentPass'
    | 'analyticsFleetPlan'
    | 'analyticsResidentialGrowth'
    | 'analyticsNetworkConnections'
    | 'analyticsRoutePlanner2'
    | 'analyticsShuttlePlanner'
    | 'operationsLoadProfiles'
    | 'operationsOperatorDwell';

export type WorkspaceAccessOverrides = Partial<Record<WorkspaceAccessFeatureKey, boolean>>;

type WorkspaceAccessSubject = Pick<TeamMember, 'role' | 'accessLevel' | 'workspaceOverrides'> | null | undefined;

export const WORKSPACE_ACCESS_LEVELS: WorkspaceAccessLevel[] = [
    'production',
    'planner',
    'external-planner',
    'transit-app-only',
    'admin',
    'internal',
];

export const WORKSPACE_ACCESS_LEVEL_LABELS: Record<WorkspaceAccessLevel, string> = {
    production: 'Production only',
    planner: 'Planner',
    'external-planner': 'External agency planner',
    'transit-app-only': 'Transit App Data only',
    admin: 'Admin access',
    internal: 'Developer/internal',
};

export const WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS: Record<WorkspaceAccessLevel, string> = {
    production: 'Only production-ready workspaces.',
    planner: 'Production workspaces plus selected planning tools.',
    'external-planner': 'Limited non-Barrie planner access for partner agency planning data.',
    'transit-app-only': 'Only the Transit App Data workspace.',
    admin: 'Planner access plus broader operational tools.',
    internal: 'Everything, including unfinished workspaces.',
};

export const WORKSPACE_ACCESS_FEATURES: WorkspaceAccessFeatureKey[] = [
    'workspaceOndemand',
    'workspaceFixedRoute',
    'workspaceOperations',
    'analyticsTransitApp',
    'analyticsOdMatrix',
    'analyticsCorridorSpeed',
    'analyticsCorridorHeadway',
    'analyticsStudentPass',
    'analyticsFleetPlan',
    'analyticsResidentialGrowth',
    'analyticsNetworkConnections',
    'analyticsRoutePlanner2',
    'analyticsShuttlePlanner',
    'operationsLoadProfiles',
    'operationsOperatorDwell',
];

const PRODUCTION_WORKSPACES: WorkspaceAccessFeatureKey[] = [
    'workspaceFixedRoute',
    'workspaceOperations',
];

const PLANNER_WORKSPACES: WorkspaceAccessFeatureKey[] = [
    ...PRODUCTION_WORKSPACES,
    'workspaceOndemand',
    'analyticsTransitApp',
    'analyticsStudentPass',
    'analyticsFleetPlan',
    'analyticsResidentialGrowth',
    'analyticsRoutePlanner2',
];

const EXTERNAL_PLANNER_WORKSPACES: WorkspaceAccessFeatureKey[] = [
    'workspaceFixedRoute',
    'analyticsOdMatrix',
];

const TRANSIT_APP_ONLY_WORKSPACES: WorkspaceAccessFeatureKey[] = [
    'analyticsTransitApp',
];

const ADMIN_WORKSPACES: WorkspaceAccessFeatureKey[] = [
    ...PLANNER_WORKSPACES,
    'analyticsOdMatrix',
    'operationsLoadProfiles',
    'operationsOperatorDwell',
];

const INTERNAL_WORKSPACES: WorkspaceAccessFeatureKey[] = [...WORKSPACE_ACCESS_FEATURES];

const WORKSPACE_ACCESS_BY_LEVEL: Record<WorkspaceAccessLevel, ReadonlySet<WorkspaceAccessFeatureKey>> = {
    production: new Set(PRODUCTION_WORKSPACES),
    planner: new Set(PLANNER_WORKSPACES),
    'external-planner': new Set(EXTERNAL_PLANNER_WORKSPACES),
    'transit-app-only': new Set(TRANSIT_APP_ONLY_WORKSPACES),
    admin: new Set(ADMIN_WORKSPACES),
    internal: new Set(INTERNAL_WORKSPACES),
};

export function isWorkspaceAccessLevel(value: unknown): value is WorkspaceAccessLevel {
    return typeof value === 'string' && WORKSPACE_ACCESS_LEVELS.includes(value as WorkspaceAccessLevel);
}

export function isWorkspaceAccessFeature(feature: FeatureKey): feature is WorkspaceAccessFeatureKey {
    return (WORKSPACE_ACCESS_FEATURES as FeatureKey[]).includes(feature);
}

export function resolveWorkspaceAccessLevel(subject: WorkspaceAccessSubject): WorkspaceAccessLevel {
    if (isWorkspaceAccessLevel(subject?.accessLevel)) {
        return subject.accessLevel;
    }

    // Backward-compatible fallback for existing teams before the field exists.
    if (subject?.role === 'owner' || subject?.role === 'admin') {
        return 'internal';
    }

    return 'planner';
}

export function getDefaultWorkspaceAccessLevelForRole(role: TeamRole): WorkspaceAccessLevel {
    return role === 'owner' || role === 'admin' ? 'internal' : 'planner';
}

export function getAllowedWorkspaceFeatures(
    accessLevel: WorkspaceAccessLevel,
    overrides: WorkspaceAccessOverrides = {},
): WorkspaceAccessFeatureKey[] {
    return WORKSPACE_ACCESS_FEATURES.filter((feature) => {
        const override = overrides[feature];
        if (typeof override === 'boolean') return override;
        return WORKSPACE_ACCESS_BY_LEVEL[accessLevel].has(feature);
    });
}

export function canAccessWorkspaceFeature(
    feature: FeatureKey,
    subject?: WorkspaceAccessSubject,
    flags: FeatureFlags = featureFlags,
): boolean {
    if (!isFeatureEnabled(feature, flags)) return false;

    // Non-workspace feature flags are still controlled by their existing global flags.
    if (!isWorkspaceAccessFeature(feature)) return true;

    const accessLevel = resolveWorkspaceAccessLevel(subject);
    const override = subject?.workspaceOverrides?.[feature];
    if (typeof override === 'boolean') return override;

    return WORKSPACE_ACCESS_BY_LEVEL[accessLevel].has(feature);
}

export function listUnknownWorkspaceAccessKeys(): string[] {
    return WORKSPACE_ACCESS_FEATURES.filter((feature) => !(feature in FEATURE_DEFINITIONS));
}
