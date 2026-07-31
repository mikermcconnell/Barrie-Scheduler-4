import { describe, expect, it } from 'vitest';
import {
    buildPerformanceWorkspaceHash,
    isPerformanceWorkspaceTab,
    parsePerformanceWorkspaceTabFromHash,
} from '../utils/workspaces/performanceWorkspaceRouting';

describe('performance workspace routing', () => {
    it('restores a valid dashboard section from the URL hash', () => {
        expect(parsePerformanceWorkspaceTabFromHash('#operations/performance/ridership')).toBe('ridership');
        expect(parsePerformanceWorkspaceTabFromHash('#operations/performance/operator-dwell')).toBe('operator-dwell');
    });

    it('falls back to overview for another workspace or an invalid section', () => {
        expect(parsePerformanceWorkspaceTabFromHash('#operations/performance/not-a-tab')).toBe('overview');
        expect(parsePerformanceWorkspaceTabFromHash('#planning/ridership')).toBe('overview');
    });

    it('builds stable hashes for dashboard sections', () => {
        expect(buildPerformanceWorkspaceHash('overview')).toBe('#operations/performance');
        expect(buildPerformanceWorkspaceHash('otp')).toBe('#operations/performance/otp');
        expect(buildPerformanceWorkspaceHash('ridership')).toBe('#operations/performance/ridership');
    });

    it('only accepts sections exposed by the Operations Dashboard', () => {
        expect(isPerformanceWorkspaceTab('ridership')).toBe(true);
        expect(isPerformanceWorkspaceTab('reports')).toBe(false);
        expect(isPerformanceWorkspaceTab('load-profiles')).toBe(false);
    });
});
