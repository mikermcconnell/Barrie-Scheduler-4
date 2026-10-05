import { describe, expect, it } from 'vitest';
import { buildFeatureFlags } from '../utils/features';
import { buildWorkspaceAccessPreview } from '../utils/workspaceAccessPreview';

const allFeaturesEnabled = buildFeatureFlags({
    VITE_DEMO_MODE: 'false',
});

describe('workspace access preview', () => {
    it('shows no app surfaces for the no-access profile', () => {
        const preview = buildWorkspaceAccessPreview({
            displayName: 'New user',
            accessLevel: 'none',
            flags: allFeaturesEnabled,
        });

        expect(preview.accessLabel).toBe('No workspace access');
        expect(preview.homeWorkspaces).toEqual([]);
        expect(preview.analyticsCards).toEqual([]);
        expect(preview.operationsTools).toEqual([]);
    });

    it('summarizes exactly what a Transit App only profile will see', () => {
        const preview = buildWorkspaceAccessPreview({
            displayName: 'Lane reviewer',
            accessLevel: 'transit-app-only',
            flags: allFeaturesEnabled,
        });

        expect(preview.profileName).toBe('Lane reviewer');
        expect(preview.accessLabel).toBe('Transit App Data only');
        expect(preview.homeWorkspaces.map(workspace => workspace.label)).toEqual(['Planning Data']);
        expect(preview.analyticsCards.map(card => card.label)).toEqual(['Transit App Data']);
        expect(preview.visibleCount).toBe(2);
        expect(preview.hiddenCount).toBeGreaterThan(1);
    });

    it('applies workspace overrides so admins can preview unsaved wizard choices', () => {
        const preview = buildWorkspaceAccessPreview({
            displayName: 'Partner planner',
            accessLevel: 'external-planner',
            overrides: {
                analyticsOdMatrix: true,
                workspaceFixedRoute: false,
            },
            flags: allFeaturesEnabled,
        });

        expect(preview.homeWorkspaces.map(workspace => workspace.label)).toEqual(['Planning Data']);
        expect(preview.analyticsCards.map(card => card.label)).toEqual([
            'Transit App Data',
            'Agency OD Analysis',
        ]);
        expect(preview.hiddenFeatures).toContain('Scheduled Transit');
    });

    it('shows Parking as the main workspace for the Parking profile', () => {
        const preview = buildWorkspaceAccessPreview({
            displayName: 'Parking reviewer',
            accessLevel: 'parking',
            flags: allFeaturesEnabled,
        });

        expect(preview.accessLabel).toBe('Parking');
        expect(preview.homeWorkspaces.map(workspace => workspace.label)).toEqual(['Parking']);
        expect(preview.homeWorkspaces[0].description).toContain('Parking Lot Data');
        expect(preview.analyticsCards).toEqual([]);
        expect(preview.operationsTools).toEqual([]);
    });

    it('shows Fare Programs to planners but not Transit App-only partners', () => {
        const plannerPreview = buildWorkspaceAccessPreview({
            accessLevel: 'planner',
            flags: allFeaturesEnabled,
        });
        const partnerPreview = buildWorkspaceAccessPreview({
            accessLevel: 'transit-app-only',
            flags: allFeaturesEnabled,
        });

        expect(plannerPreview.analyticsCards.map(card => card.label)).toContain('Fare Programs');
        expect(plannerPreview.analyticsCards.map(card => card.label)).toContain('2027–2032 Strategic Plan');
        expect(plannerPreview.analyticsCards.map(card => card.label)).toContain('Ridership Trends');
        expect(partnerPreview.analyticsCards.map(card => card.label)).not.toContain('Fare Programs');
        expect(partnerPreview.analyticsCards.map(card => card.label)).not.toContain('2027–2032 Strategic Plan');
    });
});
