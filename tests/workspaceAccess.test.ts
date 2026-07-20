import { describe, expect, it } from 'vitest';
import type { TeamMember } from '../utils/masterScheduleTypes';
import {
    canAccessWorkspaceFeature,
    getAllowedWorkspaceFeatures,
    listUnknownWorkspaceAccessKeys,
    resolveWorkspaceAccessLevel,
} from '../utils/workspaceAccess';
import { buildFeatureFlags, getFeatureOverrideEnvVar } from '../utils/features';

const member = (overrides: Partial<TeamMember>): TeamMember => ({
    id: 'u1',
    userId: 'u1',
    role: 'member',
    accessLevel: 'production',
    joinedAt: new Date(),
    displayName: 'Test User',
    email: 'test@example.com',
    ...overrides,
});

describe('workspace access', () => {
    it('keeps all workspace access keys aligned with feature definitions', () => {
        expect(listUnknownWorkspaceAccessKeys()).toEqual([]);
    });

    it('gives users without a team member record no workspace access', () => {
        expect(resolveWorkspaceAccessLevel(null)).toBe('none');
        expect(getAllowedWorkspaceFeatures('none')).toEqual([]);
        expect(canAccessWorkspaceFeature('workspaceFixedRoute', null)).toBe(false);
        expect(canAccessWorkspaceFeature('analyticsTransitApp', undefined)).toBe(false);
    });

    it('defaults existing owners and admins to internal access', () => {
        expect(resolveWorkspaceAccessLevel(member({ role: 'owner', accessLevel: undefined }))).toBe('internal');
        expect(resolveWorkspaceAccessLevel(member({ role: 'admin', accessLevel: undefined }))).toBe('internal');
    });

    it('defaults existing regular members to planner access', () => {
        expect(resolveWorkspaceAccessLevel(member({ accessLevel: undefined }))).toBe('planner');
    });

    it('limits production users to production workspaces', () => {
        const allowed = getAllowedWorkspaceFeatures('production');

        expect(allowed).toContain('workspaceFixedRoute');
        expect(allowed).toContain('workspaceOperations');
        expect(allowed).not.toContain('workspaceParking');
        expect(allowed).not.toContain('workspaceOndemand');
        expect(allowed).not.toContain('analyticsRoutePlanner2');
    });

    it('puts planner-approved workspaces in planner access', () => {
        const allowed = getAllowedWorkspaceFeatures('planner');

        expect(allowed).toContain('workspaceOndemand');
        expect(allowed).toContain('analyticsTransitApp');
        expect(allowed).toContain('analyticsStudentPass');
        expect(allowed).toContain('analyticsFleetPlan');
        expect(allowed).toContain('analyticsRoutePlanner2');
        expect(allowed).toContain('analyticsCouncilIntelligence');
        expect(allowed).not.toContain('operationsLoadProfiles');
        expect(allowed).not.toContain('operationsOperatorDwell');
        expect(allowed).not.toContain('workspaceParking');
        expect(allowed).not.toContain('analyticsCorridorSpeed');
        expect(allowed).not.toContain('analyticsCorridorHeadway');
        expect(allowed).not.toContain('analyticsNetworkConnections');
    });

    it('gives External Agency Planners only Transit App Data', () => {
        const allowed = getAllowedWorkspaceFeatures('external-planner');

        expect(allowed).toEqual(['analyticsTransitApp']);
        expect(allowed).not.toContain('workspaceFixedRoute');
        expect(allowed).not.toContain('analyticsOdMatrix');
        expect(allowed).not.toContain('workspaceOndemand');
        expect(allowed).not.toContain('workspaceOperations');
        expect(allowed).not.toContain('analyticsStudentPass');
        expect(allowed).not.toContain('analyticsFleetPlan');
        expect(allowed).not.toContain('analyticsCouncilIntelligence');
        expect(allowed).not.toContain('operationsLoadProfiles');
        expect(allowed).not.toContain('operationsOperatorDwell');
    });

    it('supports a Transit App Data only access profile', () => {
        const allowed = getAllowedWorkspaceFeatures('transit-app-only');

        expect(allowed).toEqual(['analyticsTransitApp']);
    });

    it('gives Parking staff only the Parking workspace by default', () => {
        const allowed = getAllowedWorkspaceFeatures('parking');

        expect(allowed).toEqual(['workspaceParking']);
        expect(allowed).not.toContain('workspaceFixedRoute');
        expect(allowed).not.toContain('workspaceOperations');
        expect(allowed).not.toContain('workspaceOndemand');
        expect(allowed).not.toContain('analyticsTransitApp');
    });

    it('uses agency-neutral language for external planner access', async () => {
        const labels = await import('../utils/workspaceAccess');

        expect(labels.WORKSPACE_ACCESS_LEVEL_LABELS['external-planner']).toBe('External Agency Planner');
        expect(labels.WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS['external-planner']).not.toMatch(/Ontario Northland/i);
        expect(labels.WORKSPACE_ACCESS_LEVEL_LABELS['transit-app-only']).toBe('Transit App Data only');
        expect(labels.WORKSPACE_ACCESS_LEVEL_LABELS.parking).toBe('Parking');
    });

    it('keeps developer-only workspaces out of admin access', () => {
        const allowed = getAllowedWorkspaceFeatures('admin');

        expect(allowed).toContain('analyticsRoutePlanner2');
        expect(allowed).toContain('analyticsCouncilIntelligence');
        expect(allowed).toContain('operationsLoadProfiles');
        expect(allowed).toContain('operationsOperatorDwell');
        expect(allowed).toContain('workspaceParking');
        expect(allowed).not.toContain('analyticsCorridorSpeed');
        expect(allowed).not.toContain('analyticsCorridorHeadway');
        expect(allowed).not.toContain('analyticsNetworkConnections');
        expect(allowed).not.toContain('analyticsShuttlePlanner');
        expect(allowed).not.toContain('analyticsRouteConceptPlanner');
    });

    it('lets internal users access unfinished workspaces when globally enabled', () => {
        const internal = member({ accessLevel: 'internal' });
        const flags = buildFeatureFlags({
            [getFeatureOverrideEnvVar('analyticsRouteConceptPlanner')]: 'true',
        });

        expect(canAccessWorkspaceFeature('workspaceOndemand', internal)).toBe(true);
        expect(canAccessWorkspaceFeature('analyticsRoutePlanner2', internal)).toBe(true);
        expect(canAccessWorkspaceFeature('analyticsCouncilIntelligence', internal)).toBe(true);
        expect(canAccessWorkspaceFeature('workspaceParking', internal)).toBe(true);
        expect(canAccessWorkspaceFeature('analyticsRouteConceptPlanner', internal, flags)).toBe(true);
    });

    it('keeps Route Concept Planner internal-only by profile but allows an explicit pilot override', () => {
        const flags = buildFeatureFlags({
            [getFeatureOverrideEnvVar('analyticsRouteConceptPlanner')]: 'true',
        });
        const planner = member({ accessLevel: 'planner' });
        const pilot = member({
            accessLevel: 'planner',
            workspaceOverrides: { analyticsRouteConceptPlanner: true },
        });

        expect(canAccessWorkspaceFeature('analyticsRouteConceptPlanner', planner, flags)).toBe(false);
        expect(canAccessWorkspaceFeature('analyticsRouteConceptPlanner', pilot, flags)).toBe(true);
    });

    it('applies explicit workspace overrides after profile defaults', () => {
        const productionWithOverride = member({
            accessLevel: 'production',
            workspaceOverrides: { workspaceOndemand: true, workspaceFixedRoute: false },
        });

        expect(canAccessWorkspaceFeature('workspaceOndemand', productionWithOverride)).toBe(true);
        expect(canAccessWorkspaceFeature('workspaceFixedRoute', productionWithOverride)).toBe(false);
    });
});
