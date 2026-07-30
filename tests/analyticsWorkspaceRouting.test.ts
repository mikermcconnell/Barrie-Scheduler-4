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

    it('deep-links to Council Intelligence from Planning Data', () => {
        expect(buildAnalyticsWorkspaceHash('planning', 'council-intelligence'))
            .toBe('#planning/council-intelligence');
        expect(parseAnalyticsWorkspaceViewFromHash('#planning/council-intelligence', 'planning'))
            .toBe('council-intelligence');
        expect(getAnalyticsWorkspaceViewLabel('council-intelligence'))
            .toBe('Council Intelligence');
    });

    it('deep-links to Council Intelligence from the fixed-route analytics shell', () => {
        expect(buildAnalyticsWorkspaceHash('fixed/analytics', 'council-intelligence'))
            .toBe('#fixed/analytics/council-intelligence');
        expect(parseAnalyticsWorkspaceViewFromHash('#fixed/analytics/council-intelligence', 'fixed/analytics'))
            .toBe('council-intelligence');
    });
});
