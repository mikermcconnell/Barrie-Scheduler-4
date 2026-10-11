import type { WorkspaceAccessFeatureKey } from '../../utils/workspaceAccess';

// `operationsLoadProfiles` is a legacy key that is never assignable, so it has no label.
export const WORKSPACE_FEATURE_LABELS: Record<Exclude<WorkspaceAccessFeatureKey, 'operationsLoadProfiles'>, string> = {
    workspaceOndemand: 'On Demand',
    workspaceFixedRoute: 'Scheduled Transit',
    workspaceOperations: 'Operations',
    workspaceParking: 'Parking',
    analyticsTransitApp: 'Transit App Data',
    analyticsOdMatrix: 'OD Matrix',
    analyticsCorridorSpeed: 'Corridor Speed',
    analyticsCorridorHeadway: 'Corridor Headway',
    analyticsStudentPass: 'Student Pass',
    analyticsFleetPlan: 'Fleet Plan',
    analyticsResidentialGrowth: 'Residential Growth',
    analyticsNetworkConnections: 'Network Connections',
    analyticsRoutePlanner2: 'Route Planner',
    analyticsRouteConceptPlanner: 'Route Concept Planner',
    analyticsStreetDesignStudio: 'Street Design Studio',
    analyticsShuttlePlanner: 'Shuttle Planner',
    analyticsFarePrograms: 'Fare Programs',
    analyticsCouncilIntelligence: 'Council Intelligence',
    operationsOperatorDwell: 'Dwell Incident Review',
};
