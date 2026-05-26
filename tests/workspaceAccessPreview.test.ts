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
});
