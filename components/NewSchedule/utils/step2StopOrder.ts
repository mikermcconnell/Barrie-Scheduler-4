import type {
    StopOrderConfidence,
    StopOrderDecision,
    StopOrderResolutionResult,
} from '../../../utils/newSchedule/stopOrderResolver';

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
    directionStats: Partial<Record<'North' | 'South', Step2StopOrderDirectionStats>>;
}

export const extractStopOrderDirectionStops = (
    resolution: StopOrderResolutionResult | null | undefined
): Partial<Record<'North' | 'South', string[]>> | undefined => {
    if (!resolution) return undefined;

    const result: Partial<Record<'North' | 'South', string[]>> = {};
    const northStops = resolution.resolvedDirections.North?.stopNames?.filter(Boolean) ?? [];
    const southStops = resolution.resolvedDirections.South?.stopNames?.filter(Boolean) ?? [];

    if (northStops.length > 0) {
        result.North = northStops;
    }
    if (southStops.length > 0) {
        result.South = southStops;
    }

    return Object.keys(result).length > 0 ? result : undefined;
};

export const buildStep2StopOrderHealth = (
    resolution: StopOrderResolutionResult | null | undefined,
    sourceUsed: Step2StopOrderSource
): Step2StopOrderHealth | null => {
    if (!resolution) return null;

    const usedForPlanning = sourceUsed === 'runtime-derived' && resolution.decision === 'accept';
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

    const summary = usedForPlanning
        ? 'Dynamic stop order was accepted and is now driving the Step 2 route chain.'
        : sourceUsed === 'master-fallback'
            ? `Dynamic stop order returned ${resolution.decision}, so Step 2 kept the master stop chain for planning.`
            : 'Dynamic stop order could not provide a planning stop chain for this Step 2 run.';

    const warnings = usedForPlanning
        ? []
        : [
            `Dynamic stop order is ${resolution.decision} (${resolution.confidence} confidence).`,
            ...resolution.warnings,
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
