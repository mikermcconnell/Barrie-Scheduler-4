import { describe, expect, it } from 'vitest';

import {
    buildAnalyticsWorkspaceHash,
    getAnalyticsWorkspaceViewLabel,
    parseAnalyticsWorkspaceViewFromHash,
} from '../utils/workspaces/analyticsWorkspaceRouting';

describe('Route Concept Planner analytics routing', () => {
    it('parses the standalone Planning Data route', () => {
        expect(parseAnalyticsWorkspaceViewFromHash('#planning/route-concept-planner', 'planning')).toBe('route-concept-planner');
    });

    it('builds the nested Scheduled Transit route', () => {
        expect(buildAnalyticsWorkspaceHash('fixed/analytics', 'route-concept-planner')).toBe('#fixed/analytics/route-concept-planner');
    });

    it('uses distinct user-facing labels for both planning workspaces', () => {
        expect(getAnalyticsWorkspaceViewLabel('route-concept-planner')).toBe('Route Concept Planner');
        expect(getAnalyticsWorkspaceViewLabel('route-planner-2')).toBe('Camp Shuttle Planner');
    });
});
