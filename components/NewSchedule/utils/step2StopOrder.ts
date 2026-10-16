import type {
    StopOrderConfidence,
    StopOrderDecision,
    StopOrderResolutionResult,
} from '../../../utils/newSchedule/stopOrderResolver';
import { normalizeSegmentStopKey } from '../../../utils/runtimeSegmentMatching';

export type Step2StopOrderSource = 'runtime-derived' | 'master-fallback' | 'none';

export interface Step2StopOrderDirectionStats {
    tripCountUsed: number;
    dayCountUsed: number;
    middayTripCount: number;
}

export interface Step2StopOrderHealth {
    decision: StopOrderDecision;
    confidence: StopOrderConfidence;
    sourceUsed: Step2StopOrderSource;
    usedForPlanning: boolean;
    summary: string;
    warnings: string[];
    directionStats: Partial<Record<'North' | 'South' | 'Loop', Step2StopOrderDirectionStats>>;
}

export const extractStopOrderDirectionStops = (
    resolution: StopOrderResolutionResult | null | undefined
): Partial<Record<'North' | 'South' | 'Loop', string[]>> | undefined => {
    if (!resolution) return undefined;

    const result: Partial<Record<'North' | 'South' | 'Loop', string[]>> = {};
    const northStops = resolution.resolvedDirections.North?.stopNames?.filter(Boolean) ?? [];
    const southStops = resolution.resolvedDirections.South?.stopNames?.filter(Boolean) ?? [];
    const loopStops = resolution.resolvedDirections.Loop?.stopNames?.filter(Boolean) ?? [];

    if (northStops.length > 0) {
        result.North = northStops;
    }
    if (southStops.length > 0) {
        result.South = southStops;
    }
    if (loopStops.length > 0) {
        result.Loop = loopStops;
    }

    return Object.keys(result).length > 0 ? result : undefined;
};

type DirectionStops = Record<string, string[]>;

const stopKeysLikelyMatch = (observed: string, master: string): boolean => {
    const observedKey = normalizeSegmentStopKey(observed);
    const masterKey = normalizeSegmentStopKey(master);
    return !!observedKey && !!masterKey
        && (observedKey === masterKey || observedKey.includes(masterKey) || masterKey.includes(observedKey));
};

/** Warnings for master timepoints that the observed trips do not pass in order. */
export const checkMasterStopsAgainstObserved = (
    masterStops: DirectionStops,
    observedStops: DirectionStops | undefined
): string[] => {
    if (!observedStops) return [];
    const warnings: string[] = [];
    Object.entries(masterStops).forEach(([direction, stops]) => {
        const observed = observedStops[direction];
        if (!observed || observed.length === 0) return;
        let cursor = 0;
        for (const stop of stops) {
            const found = observed.findIndex((name, index) => index >= cursor && stopKeysLikelyMatch(name, stop));
            if (found < 0) {
                warnings.push(`Observed ${direction} trips do not pass master timepoint "${stop}" in order. Check that the published master matches current service.`);
                return;
            }
            cursor = found + 1;
        }
    });
    return warnings;
};

export interface PlanningStopChainSelection {
    canonicalStops: DirectionStops | undefined;
    sourceUsed: Step2StopOrderSource;
    checkWarnings: string[];
}

/**
 * Planning stop chain: the published master timepoints when usable, checked
 * against the observed stop order; otherwise an accepted observed order;
 * otherwise none. An accepted observed order lists every stop, and many
 * stop-to-stop hops round to zero minutes, so it is not preferred.
 */
export const selectPlanningStopChain = (
    masterStops: DirectionStops | undefined,
    acceptedObservedStops: DirectionStops | undefined,
    observedStops: DirectionStops | undefined
): PlanningStopChainSelection => {
    if (masterStops) {
        return {
            canonicalStops: masterStops,
            sourceUsed: 'master-fallback',
            checkWarnings: checkMasterStopsAgainstObserved(masterStops, observedStops),
        };
    }
    if (acceptedObservedStops) {
        return { canonicalStops: acceptedObservedStops, sourceUsed: 'runtime-derived', checkWarnings: [] };
    }
    return { canonicalStops: undefined, sourceUsed: 'none', checkWarnings: [] };
};

/** Master timepoints in use and the accepted observed order confirms them: nothing for the planner to acknowledge. */
export const isMasterChainConfirmed = (health: Pick<Step2StopOrderHealth, 'sourceUsed' | 'decision' | 'warnings'>): boolean => (
    health.sourceUsed === 'master-fallback' && health.decision === 'accept' && health.warnings.length === 0
);

export const buildStep2StopOrderHealth = (
    resolution: StopOrderResolutionResult | null | undefined,
    sourceUsed: Step2StopOrderSource,
    checkWarnings: string[] = []
): Step2StopOrderHealth | null => {
    if (!resolution) return null;

    const usedForPlanning = sourceUsed === 'runtime-derived' && resolution.decision === 'accept';
    const masterConfirmed = sourceUsed === 'master-fallback' && resolution.decision === 'accept' && checkWarnings.length === 0;
    const directionStats: Step2StopOrderHealth['directionStats'] = {};

    if (resolution.resolvedDirections.North) {
        directionStats.North = {
            tripCountUsed: resolution.resolvedDirections.North.tripCountUsed,
            dayCountUsed: resolution.resolvedDirections.North.dayCountUsed,
            middayTripCount: resolution.resolvedDirections.North.middayTripCount,
        };
    }
    if (resolution.resolvedDirections.South) {
        directionStats.South = {
            tripCountUsed: resolution.resolvedDirections.South.tripCountUsed,
            dayCountUsed: resolution.resolvedDirections.South.dayCountUsed,
            middayTripCount: resolution.resolvedDirections.South.middayTripCount,
        };
    }
    if (resolution.resolvedDirections.Loop) {
        directionStats.Loop = {
            tripCountUsed: resolution.resolvedDirections.Loop.tripCountUsed,
            dayCountUsed: resolution.resolvedDirections.Loop.dayCountUsed,
            middayTripCount: resolution.resolvedDirections.Loop.middayTripCount,
        };
    }

    const summary = usedForPlanning
        ? 'Dynamic stop order was accepted and is now driving the Step 2 route chain.'
        : masterConfirmed
            ? 'Step 2 plans on the master timepoints; the observed stop order confirms them.'
            : sourceUsed === 'master-fallback'
                ? `Step 2 plans on the master timepoints. Dynamic stop order returned ${resolution.decision}.`
                : 'Dynamic stop order could not provide a planning stop chain for this Step 2 run.';

    const warnings = usedForPlanning || masterConfirmed
        ? []
        : [
            `Dynamic stop order is ${resolution.decision} (${resolution.confidence} confidence).`,
            ...resolution.warnings,
            ...checkWarnings,
        ];

    return {
        decision: resolution.decision,
        confidence: resolution.confidence,
        sourceUsed,
        usedForPlanning,
        summary,
        warnings,
        directionStats,
    };
};
