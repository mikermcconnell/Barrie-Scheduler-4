import { computeRuntimesFromPerformance } from '../../../utils/performanceRuntimeComputer';
import type { DailySummary, DayType as PerfDayType } from '../../../utils/performanceDataTypes';
import { buildRouteIdentity, type RouteIdentity } from '../../../utils/masterScheduleTypes';
import { resolveStopOrderFromPerformance } from '../../../utils/newSchedule/stopOrderResolver';
import type { RuntimeData } from '../../NewSchedule/utils/csvParser';
import {
    buildCanonicalSegmentColumnsFromMasterStops,
    getUsableCanonicalDirectionStops,
    type OrderedSegmentColumn,
} from '../../NewSchedule/utils/wizardState';
import {
    buildStep2StopOrderHealth,
    extractStopOrderDirectionStops,
    type Step2StopOrderHealth,
} from '../../NewSchedule/utils/step2StopOrder';
import type { Step2CanonicalRouteSource } from '../../NewSchedule/utils/step2ReviewTypes';
import type { GuidedDayType, GuidedDateRange } from './guidedRuntimeReviewTypes';

export interface MasterDirectionStops {
    North: string[];
    South: string[];
}

export interface PrepareRuntimeReviewInput {
    dailySummaries: DailySummary[];
    routeId: string;
    dayType: GuidedDayType;
    dateRange: GuidedDateRange | null;
    /** Loads the published Master stop order for a route identity, or null when none is published. */
    loadMasterStops?: (routeIdentity: RouteIdentity) => Promise<MasterDirectionStops | null>;
}

export interface PreparedRuntimeReview {
    routeNumber: string;
    routeIdentity: RouteIdentity;
    /** Schedule-driving runtimes, tied to the canonical route chain. */
    results: RuntimeData[];
    /** Finer stop-to-stop legs for the Step 2 troubleshooting matrix. */
    displayResults: RuntimeData[];
    canonicalDirectionStops: Record<string, string[]> | undefined;
    canonicalSegmentColumns: OrderedSegmentColumn[] | undefined;
    canonicalRouteSource: Step2CanonicalRouteSource | undefined;
    stopOrderHealth: Step2StopOrderHealth | null;
}

/**
 * Computes Step 2 runtime inputs from clean STREETS history for one route and
 * day type. Mirrors the legacy wizard's Step 1 performance path, except that
 * the route chosen in Step 1 is the route identity for the whole review.
 */
export const prepareRuntimeReview = async (
    input: PrepareRuntimeReviewInput
): Promise<PreparedRuntimeReview> => {
    const routeNumber = input.routeId.trim();
    const routeIdentity = buildRouteIdentity(routeNumber, input.dayType);
    const perfDayType = input.dayType.toLowerCase() as PerfDayType;
    const dateRange = input.dateRange ?? undefined;

    const masterStops = input.loadMasterStops
        ? await input.loadMasterStops(routeIdentity)
        : null;
    const masterCanonicalStops = masterStops
        ? getUsableCanonicalDirectionStops(routeNumber, {
            North: masterStops.North,
            South: masterStops.South,
        })
        : undefined;

    const stopOrderResolution = resolveStopOrderFromPerformance(input.dailySummaries, {
        routeId: routeNumber,
        dayType: perfDayType,
        dateRange,
        patternAnchorStops: masterCanonicalStops,
        runtimePatternStrategy: 'detour-fallback',
    });
    const resolvedCanonicalStops = stopOrderResolution.decision === 'accept'
        ? getUsableCanonicalDirectionStops(routeNumber, extractStopOrderDirectionStops(stopOrderResolution))
        : undefined;
    const canonicalDirectionStops = resolvedCanonicalStops ?? masterCanonicalStops;
    const canonicalColumns = canonicalDirectionStops
        ? buildCanonicalSegmentColumnsFromMasterStops(
            routeNumber,
            canonicalDirectionStops.North ?? canonicalDirectionStops.Loop ?? [],
            canonicalDirectionStops.South ?? []
        )
        : [];
    const canonicalRouteSource: Step2CanonicalRouteSource | undefined = resolvedCanonicalStops
        ? { type: 'runtime-derived', routeIdentity, versionHint: `stop-order-${stopOrderResolution.decision}` }
        : masterCanonicalStops
            ? { type: 'master', routeIdentity, versionHint: 'master-schedule' }
            : undefined;
    const stopOrderHealth = buildStep2StopOrderHealth(
        stopOrderResolution,
        resolvedCanonicalStops ? 'runtime-derived' : masterCanonicalStops ? 'master-fallback' : 'none'
    );

    const anchorStops = resolvedCanonicalStops ?? masterCanonicalStops;
    const results = computeRuntimesFromPerformance(input.dailySummaries, {
        routeId: routeNumber,
        dayType: perfDayType,
        dateRange,
        canonicalDirectionStops,
        patternAnchorStops: anchorStops,
        fullPatternOnly: true,
        runtimePatternStrategy: 'detour-fallback',
    });
    const displayResults = canonicalDirectionStops
        ? computeRuntimesFromPerformance(input.dailySummaries, {
            routeId: routeNumber,
            dayType: perfDayType,
            dateRange,
            patternAnchorStops: anchorStops,
            fullPatternOnly: true,
            runtimePatternStrategy: 'detour-fallback',
        })
        : results;

    return {
        routeNumber,
        routeIdentity,
        results,
        displayResults,
        canonicalDirectionStops,
        canonicalSegmentColumns: canonicalColumns.length > 0 ? canonicalColumns : undefined,
        canonicalRouteSource: canonicalDirectionStops ? canonicalRouteSource : undefined,
        stopOrderHealth,
    };
};
