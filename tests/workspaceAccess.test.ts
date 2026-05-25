import { describe, expect, it } from 'vitest';
import type { TeamMember } from '../utils/masterScheduleTypes';
import {
    canAccessWorkspaceFeature,
    getAllowedWorkspaceFeatures,
    listUnknownWorkspaceAccessKeys,
    resolveWorkspaceAccessLevel,
} from '../utils/workspaceAccess';

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
        expect(allowed).not.toContain('operationsLoadProfiles');
        expect(allowed).not.toContain('operationsOperatorDwell');
        expect(allowed).not.toContain('analyticsCorridorSpeed');
        expect(allowed).not.toContain('analyticsCorridorHeadway');
        expect(allowed).not.toContain('analyticsNetworkConnections');
    });

    it('gives external agency planners only the scheduled transit shell and partner planning data', () => {
        const allowed = getAllowedWorkspaceFeatures('external-planner');

        expect(allowed).toContain('workspaceFixedRoute');
        expect(allowed).toContain('analyticsOdMatrix');
        expect(allowed).not.toContain('workspaceOndemand');
        expect(allowed).not.toContain('workspaceOperations');
        expect(allowed).not.toContain('analyticsTransitApp');
        expect(allowed).not.toContain('analyticsStudentPass');
        expect(allowed).not.toContain('analyticsFleetPlan');
        expect(allowed).not.toContain('operationsLoadProfiles');
        expect(allowed).not.toContain('operationsOperatorDwell');
    });

    it('supports a Transit App Data only access profile', () => {
        const allowed = getAllowedWorkspaceFeatures('transit-app-only');

        expect(allowed).toEqual(['analyticsTransitApp']);
    });

    it('uses agency-neutral language for external planner access', async () => {
        const labels = await import('../utils/workspaceAccess');

        expect(labels.WORKSPACE_ACCESS_LEVEL_LABELS['external-planner']).toBe('External agency planner');
        expect(labels.WORKSPACE_ACCESS_LEVEL_DESCRIPTIONS['external-planner']).not.toMatch(/Ontario Northland/i);
        expect(labels.WORKSPACE_ACCESS_LEVEL_LABELS['transit-app-only']).toBe('Transit App Data only');
    });

    it('keeps developer-only workspaces out of admin access', () => {
        const allowed = getAllowedWorkspaceFeatures('admin');

        expect(allowed).toContain('analyticsRoutePlanner2');
        expect(allowed).toContain('operationsLoadProfiles');
        expect(allowed).toContain('operationsOperatorDwell');
        expect(allowed).not.toContain('analyticsCorridorSpeed');
        expect(allowed).not.toContain('analyticsCorridorHeadway');
        expect(allowed).not.toContain('analyticsNetworkConnections');
        expect(allowed).not.toContain('analyticsShuttlePlanner');
    });

    it('lets internal users access unfinished workspaces when globally enabled', () => {
        const internal = member({ accessLevel: 'internal' });

        expect(canAccessWorkspaceFeature('workspaceOndemand', internal)).toBe(true);
        expect(canAccessWorkspaceFeature('analyticsRoutePlanner2', internal)).toBe(true);
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
