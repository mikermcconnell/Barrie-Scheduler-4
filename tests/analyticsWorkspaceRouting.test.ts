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

    it('falls back to Planning Data for a retired Council Intelligence deep link', () => {
        expect(parseAnalyticsWorkspaceViewFromHash('#planning/council-intelligence', 'planning'))
            .toBe('dashboard');
        expect(parseAnalyticsWorkspaceViewFromHash('#fixed/analytics/council-intelligence', 'fixed/analytics'))
            .toBe('dashboard');
    });
});
