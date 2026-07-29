import type { FeatureFlags } from './features';
import { featureFlags } from './features';
import {
    ANALYTICS_WORKSPACE_FEATURES,
    canAccessWorkspaceFeature,
    WORKSPACE_ACCESS_LEVEL_LABELS,
    type WorkspaceAccessFeatureKey,
    type WorkspaceAccessLevel,
    type WorkspaceAccessOverrides,
} from './workspaceAccess';

export type WorkspacePreviewItem = {
    feature: WorkspaceAccessFeatureKey;
    label: string;
    description: string;
    previewKind?: 'workspace' | 'planning-home' | 'analytics-card' | 'operations-tool';
};

type WorkspaceAccessPreviewInput = {
    displayName?: string;
    accessLevel: WorkspaceAccessLevel;
    overrides?: WorkspaceAccessOverrides;
    flags?: FeatureFlags;
};

const HOME_WORKSPACES: WorkspacePreviewItem[] = [
    {
        feature: 'workspaceOndemand',
        label: 'Transit On-Demand',
        description: 'On-demand shift planning and coverage analysis.',
        previewKind: 'workspace',
    },
    {
        feature: 'workspaceFixedRoute',
        label: 'Scheduled Transit',
        description: 'Fixed-route schedule planning, editing, and publishing.',
        previewKind: 'workspace',
    },
    {
        feature: 'workspaceOperations',
        label: 'Dashboard & Reporting',
        description: 'Operational dashboards, reports, and performance review.',
        previewKind: 'workspace',
    },
    {
        feature: 'workspaceParking',
        label: 'Parking',
        description: 'Parking Lot Data, Plate Monitor, revenue imports, and usage review.',
        previewKind: 'workspace',
    },
];

const PLANNING_DATA_WORKSPACE: WorkspacePreviewItem = {
    feature: 'analyticsTransitApp',
    label: 'Planning Data',
    description: 'Analytics and planning-data tools allowed for this profile.',
    previewKind: 'planning-home',
};

const ANALYTICS_CARDS: WorkspacePreviewItem[] = [
    {
        feature: 'analyticsTransitApp',
        label: 'Transit App Data',
        description: 'Transit App demand, trip patterns, and route engagement.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsOdMatrix',
        label: 'Agency OD Analysis',
        description: 'Origin-destination ridership and connectivity analysis.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsCorridorSpeed',
        label: 'Corridor Speed',
        description: 'Observed versus scheduled travel time by corridor.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsCorridorHeadway',
        label: 'Corridor Headway',
        description: 'Combined service headway on shared corridors.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsStudentPass',
        label: 'Student Transit Pass',
        description: 'Student travel flyers and school access review.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsFleetPlan',
        label: 'Fleet Plan',
        description: 'Shared fleet workbook editing and export.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsResidentialGrowth',
        label: 'Residential Growth',
        description: 'Residential permit and occupancy planning data.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsNetworkConnections',
        label: 'Network Connections',
        description: 'Transfer hub and route connection analysis.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsRoutePlanner2',
        label: 'Route Planner',
        description: 'Route concept planning workspace.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsRouteConceptPlanner',
        label: 'Route Concept Planner',
        description: 'Test complete route alternatives with GTFS and road travel times.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsShuttlePlanner',
        label: 'Shuttle Planner',
        description: 'Shuttle service planning workspace.',
        previewKind: 'analytics-card',
    },
    {
        feature: 'analyticsCouncilIntelligence',
        label: 'Council Intelligence',
        description: 'Council and committee meeting records, decisions, votes, and transit-related actions.',
        previewKind: 'analytics-card',
    },
];

const OPERATIONS_TOOLS: WorkspacePreviewItem[] = [
    {
        feature: 'operationsOperatorDwell',
        label: 'Operator Dwell',
        description: 'Operator dwell reporting and review.',
        previewKind: 'operations-tool',
    },
];

const ALL_PREVIEW_ITEMS = [...HOME_WORKSPACES, ...ANALYTICS_CARDS, ...OPERATIONS_TOOLS];

function filterVisible(
    items: WorkspacePreviewItem[],
    input: WorkspaceAccessPreviewInput,
): WorkspacePreviewItem[] {
    const subject = {
        role: 'member' as const,
        accessLevel: input.accessLevel,
        workspaceOverrides: input.overrides,
    };

    return items.filter(item => canAccessWorkspaceFeature(item.feature, subject, input.flags ?? featureFlags));
}

export function buildWorkspaceAccessPreview(input: WorkspaceAccessPreviewInput) {
    const analyticsCards = filterVisible(ANALYTICS_CARDS, input);
    const homeWorkspaces = [
        ...filterVisible(HOME_WORKSPACES, input),
        ...(analyticsCards.some(item => ANALYTICS_WORKSPACE_FEATURES.includes(item.feature))
            ? [PLANNING_DATA_WORKSPACE]
            : []),
    ];
    const operationsTools = filterVisible(OPERATIONS_TOOLS, input);
    const visibleFeatures = [...homeWorkspaces, ...analyticsCards, ...operationsTools];
    const visibleLabels = new Set(visibleFeatures.map(item => item.label));
    const hiddenFeatures = ALL_PREVIEW_ITEMS
        .filter(item => !visibleLabels.has(item.label))
        .map(item => item.label);

    return {
        profileName: input.displayName?.trim() || 'Preview user',
        accessLabel: WORKSPACE_ACCESS_LEVEL_LABELS[input.accessLevel],
        homeWorkspaces,
        analyticsCards,
        operationsTools,
        visibleFeatures,
        hiddenFeatures,
        visibleCount: visibleFeatures.length,
        hiddenCount: hiddenFeatures.length,
    };
}
