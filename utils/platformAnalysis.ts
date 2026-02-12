/**
 * Platform Analysis (Orchestrator)
 *
 * Public entry point for platform utilization/conflict analysis.
 * Logic is split into focused modules:
 * - platformAnalysis/platformMatcher.ts
 * - platformAnalysis/dwellEventBuilder.ts
 * - platformAnalysis/conflictEngine.ts
 * - platformAnalysis/time.ts
 */

import type { MasterScheduleContent } from './masterScheduleTypes';
import { HUBS, type HubConfig } from './platformConfig';
import { calculatePlatformMetrics } from './platformAnalysis/conflictEngine';
import { populateDwellEvents } from './platformAnalysis/dwellEventBuilder';
import { formatMinutesToTime } from './platformAnalysis/time';
import type { HubAnalysis, DwellEvent, ConflictWindow } from './platformAnalysis/types';

export type {
    DwellEvent,
    ConflictWindow,
    PlatformAnalysis,
    HubAnalysis
} from './platformAnalysis/types';

export { formatMinutesToTime };

function initializeHubAnalyses(hubList: HubConfig[]): Map<string, HubAnalysis> {
    const hubAnalyses: Map<string, HubAnalysis> = new Map();

    for (const hub of hubList) {
        hubAnalyses.set(hub.name, {
            hubName: hub.name,
            platforms: hub.platforms
                .filter(p => p.routes.length > 0)  // Only platforms with Barrie Transit routes
                .map(p => ({
                    platformId: p.platformId,
                    routes: p.routes,
                    capacity: p.capacity || 1,
                    events: [] as DwellEvent[],
                    peakCount: 0,
                    peakWindows: [] as ConflictWindow[],
                    totalVisits: 0,
                    hasConflict: false,
                    conflictWindows: [] as ConflictWindow[]
                })),
            totalDailyVisits: 0,
            conflictCount: 0,
            totalConflictWindows: 0
        });
    }

    return hubAnalyses;
}

/**
 * Main analysis function.
 * Aggregates all schedule data into platform utilization metrics.
 */
export function aggregatePlatformData(
    scheduleContents: MasterScheduleContent[],
    routeNumbers: string[],
    hubs?: HubConfig[]
): HubAnalysis[] {
    const hubList = hubs || HUBS;
    const hubAnalyses = initializeHubAnalyses(hubList);

    populateDwellEvents(scheduleContents, routeNumbers, hubAnalyses, hubList);

    // Calculate metrics for each platform + aggregate hub totals
    for (const hubAnalysis of hubAnalyses.values()) {
        for (const platform of hubAnalysis.platforms) {
            calculatePlatformMetrics(platform);
        }

        hubAnalysis.totalDailyVisits = hubAnalysis.platforms.reduce((sum, p) => sum + p.totalVisits, 0);
        hubAnalysis.conflictCount = hubAnalysis.platforms.filter(p => p.hasConflict).length;
        hubAnalysis.totalConflictWindows = hubAnalysis.platforms.reduce((sum, p) => sum + p.conflictWindows.length, 0);
    }

    return Array.from(hubAnalyses.values());
}

/**
 * Get a summary of conflicts for display
 */
export function getConflictSummary(analysis: HubAnalysis[]): {
    totalHubsWithConflicts: number;
    totalConflicts: number;
    worstHub: string | null;
    worstPlatform: { hub: string; platform: string; peakCount: number } | null;
} {
    let totalHubsWithConflicts = 0;
    let totalConflicts = 0;
    let worstHub: string | null = null;
    let worstHubConflicts = 0;
    let worstPlatform: { hub: string; platform: string; peakCount: number } | null = null;

    for (const hub of analysis) {
        if (hub.conflictCount > 0) {
            totalHubsWithConflicts++;
            totalConflicts += hub.totalConflictWindows;

            if (hub.totalConflictWindows > worstHubConflicts) {
                worstHubConflicts = hub.totalConflictWindows;
                worstHub = hub.hubName;
            }
        }

        for (const platform of hub.platforms) {
            if (!worstPlatform || platform.peakCount > worstPlatform.peakCount) {
                worstPlatform = {
                    hub: hub.hubName,
                    platform: platform.platformId,
                    peakCount: platform.peakCount
                };
            }
        }
    }

    return { totalHubsWithConflicts, totalConflicts, worstHub, worstPlatform };
}
