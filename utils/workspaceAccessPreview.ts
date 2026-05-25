import type { FeatureFlags } from './features';
import { featureFlags } from './features';
import {
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
    },
    {
        feature: 'workspaceFixedRoute',
        label: 'Scheduled Transit',
        description: 'Fixed-route schedule planning, editing, and publishing.',
    },
    {
        feature: 'workspaceOperations',
        label: 'Dashboard & Reporting',
        description: 'Operational dashboards, reports, and performance review.',
    },
];

const ANALYTICS_CARDS: WorkspacePreviewItem[] = [
    {
        feature: 'analyticsTransitApp',
        label: 'Transit App Data',
        description: 'Transit App demand, trip patterns, and route engagement.',
    },
    {
        feature: 'analyticsOdMatrix',
        label: 'Agency OD Analysis',
        description: 'Origin-destination ridership and connectivity analysis.',
    },
    {
        feature: 'analyticsCorridorSpeed',
        label: 'Corridor Speed',
        description: 'Observed versus scheduled travel time by corridor.',
    },
    {
        feature: 'analyticsCorridorHeadway',
        label: 'Corridor Headway',
        description: 'Combined service headway on shared corridors.',
    },
    {
        feature: 'analyticsStudentPass',
        label: 'Student Transit Pass',
        description: 'Student travel flyers and school access review.',
    },
    {
        feature: 'analyticsFleetPlan',
        label: 'Fleet Plan',
        description: 'Shared fleet workbook editing and export.',
    },
    {
        feature: 'analyticsResidentialGrowth',
        label: 'Residential Growth',
        description: 'Residential permit and occupancy planning data.',
    },
    {
        feature: 'analyticsNetworkConnections',
        label: 'Network Connections',
        description: 'Transfer hub and route connection analysis.',
    },
    {
        feature: 'analyticsRoutePlanner2',
        label: 'Route Planner',
        description: 'Route concept planning workspace.',
    },
    {
        feature: 'analyticsShuttlePlanner',
        label: 'Shuttle Planner',
        description: 'Shuttle service planning workspace.',
    },
];

const OPERATIONS_TOOLS: WorkspacePreviewItem[] = [
    {
        feature: 'operationsLoadProfiles',
        label: 'Load Profiles',
        description: 'Passenger load profile analysis.',
    },
    {
        feature: 'operationsOperatorDwell',
        label: 'Operator Dwell',
        description: 'Operator dwell reporting and review.',
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
    const homeWorkspaces = filterVisible(HOME_WORKSPACES, input);
    const analyticsCards = filterVisible(ANALYTICS_CARDS, input);
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
