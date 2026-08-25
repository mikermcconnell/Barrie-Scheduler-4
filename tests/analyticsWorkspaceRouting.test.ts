import { describe, expect, it } from 'vitest';
import {
    buildAnalyticsWorkspaceHash,
    getAnalyticsWorkspaceViewLabel,
    parseAnalyticsWorkspaceViewFromHash,
} from '../utils/workspaces/analyticsWorkspaceRouting';

describe('analytics workspace routing', () => {
    it('deep-links to Fare Programs from both analytics shells', () => {
        expect(buildAnalyticsWorkspaceHash('planning', 'fare-programs')).toBe('#planning/fare-programs');
        expect(parseAnalyticsWorkspaceViewFromHash('#planning/fare-programs', 'planning')).toBe('fare-programs');
        expect(buildAnalyticsWorkspaceHash('fixed/analytics', 'fare-programs')).toBe('#fixed/analytics/fare-programs');
        expect(getAnalyticsWorkspaceViewLabel('fare-programs')).toBe('Fare Programs');
    });

    it('deep-links to the 5-Year Strategic Plan workspace', () => {
        expect(buildAnalyticsWorkspaceHash('planning', 'strategic-plan')).toBe('#planning/strategic-plan');
        expect(parseAnalyticsWorkspaceViewFromHash('#planning/strategic-plan', 'planning')).toBe('strategic-plan');
        expect(getAnalyticsWorkspaceViewLabel('strategic-plan')).toBe('5-Year Strategic Plan');
    });

    it('falls back to Planning Data for a retired Council Intelligence deep link', () => {
        expect(parseAnalyticsWorkspaceViewFromHash('#planning/council-intelligence', 'planning'))
            .toBe('dashboard');
        expect(parseAnalyticsWorkspaceViewFromHash('#fixed/analytics/council-intelligence', 'fixed/analytics'))
            .toBe('dashboard');
    });
});
