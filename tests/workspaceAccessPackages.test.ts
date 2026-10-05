import { describe, expect, it } from 'vitest';
import {
    buildWorkspaceSelectionFromPackage,
    getWorkspaceAccessPackage,
    WORKSPACE_ACCESS_PACKAGES,
} from '../utils/workspaceAccessPackages';

describe('workspace access packages', () => {
    it('includes Fare Programs in the Barrie planner package', () => {
        const selection = buildWorkspaceSelectionFromPackage('barrie-planner');

        expect(selection.analyticsFarePrograms).toBe(true);
        expect(selection).not.toHaveProperty('analyticsCouncilIntelligence');
    });

    it('includes the WATT-style Transit App plus STREETS dashboard package', () => {
        const pkg = getWorkspaceAccessPackage('transit-app-streets');
        const selection = buildWorkspaceSelectionFromPackage('transit-app-streets');

        expect(pkg.label).toBe('Transit App + STREETS Dashboard');
        expect(pkg.accessLevel).toBe('transit-app-only');
        expect(selection.analyticsTransitApp).toBe(true);
        expect(selection.workspaceOperations).toBe(true);
        expect(selection.workspaceFixedRoute).toBe(false);
        expect(selection.workspaceOndemand).toBe(false);
        expect(selection.workspaceParking).toBe(false);
    });

    it('provides a Strategic Plan-only package without standalone Transit App access', () => {
        const pkg = getWorkspaceAccessPackage('strategic-plan-only');
        const selection = buildWorkspaceSelectionFromPackage('strategic-plan-only');

        expect(pkg.label).toBe('2027–2032 Strategic Plan only');
        expect(pkg.accessLevel).toBe('none');
        expect(selection.analyticsStrategicPlan).toBe(true);
        expect(selection.analyticsTransitApp).toBe(false);
        expect(selection.workspaceFixedRoute).toBe(false);
        expect(selection.workspaceOperations).toBe(false);
    });

    it('keeps internal developer access as the only full-access package', () => {
        const developerPackage = getWorkspaceAccessPackage('internal-developer');
        const nonDeveloperPackages = WORKSPACE_ACCESS_PACKAGES.filter(pkg => pkg.id !== 'internal-developer');

        expect(developerPackage.accessLevel).toBe('internal');
        expect(nonDeveloperPackages.every(pkg => pkg.accessLevel !== 'internal')).toBe(true);
    });
});
