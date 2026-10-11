import { describe, expect, it } from 'vitest';
import {
    buildWorkspaceSelectionFromPackage,
    findWorkspaceAccessPackage,
    getWorkspaceAccessPackage,
    WORKSPACE_ACCESS_PACKAGES,
} from '../utils/workspaceAccessPackages';

describe('workspace access packages', () => {
    it('includes Council Intelligence in the Barrie planner package', () => {
        const selection = buildWorkspaceSelectionFromPackage('barrie-planner');

        expect(selection.analyticsCouncilIntelligence).toBe(true);
        expect(selection.analyticsFarePrograms).toBe(true);
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
        expect(selection.analyticsCouncilIntelligence).toBe(false);
    });

    it('keeps internal developer access as the only full-access package', () => {
        const developerPackage = getWorkspaceAccessPackage('internal-developer');
        const nonDeveloperPackages = WORKSPACE_ACCESS_PACKAGES.filter(pkg => pkg.id !== 'internal-developer');

        expect(developerPackage.accessLevel).toBe('internal');
        expect(nonDeveloperPackages.every(pkg => pkg.accessLevel !== 'internal')).toBe(true);
    });

    it('identifies a package from stored level and overrides by the workspaces it unlocks', () => {
        expect(findWorkspaceAccessPackage({ accessLevel: 'planner' })?.id).toBe('barrie-planner');
        expect(findWorkspaceAccessPackage({
            accessLevel: 'transit-app-only',
            workspaceOverrides: { workspaceOperations: true },
        })?.id).toBe('transit-app-streets');
        // legacy level with the same unlocked workspaces as Transit App Data only
        expect(findWorkspaceAccessPackage({ accessLevel: 'external-planner' })?.id).toBe('transit-app-only');
    });

    it('represents every stored access level with a package so none shows as custom', () => {
        const levels = ['none', 'production', 'planner', 'external-planner', 'transit-app-only', 'parking', 'admin', 'internal'] as const;
        levels.forEach(accessLevel => {
            expect(findWorkspaceAccessPackage({ accessLevel })).not.toBeNull();
        });
    });

    it('returns null for hand-built combinations no package describes', () => {
        expect(findWorkspaceAccessPackage({
            accessLevel: 'parking',
            workspaceOverrides: { analyticsOdMatrix: true },
        })).toBeNull();
    });
});
