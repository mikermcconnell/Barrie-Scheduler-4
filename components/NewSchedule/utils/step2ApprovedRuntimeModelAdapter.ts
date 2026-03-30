import type { DirectionBandSummary, TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import type { ApprovedRuntimeModel } from './wizardState';
import type { ApprovedRuntimeContract } from './step2ReviewTypes';

const cloneValue = <T>(value: T): T => {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
};

export const buildStep2ApprovedRuntimeModelFromContract = (
    contract: ApprovedRuntimeContract | null | undefined
): ApprovedRuntimeModel | null => {
    if (!contract) return null;

    const directionBandSummary = cloneValue(contract.planning.directionBandSummary) as DirectionBandSummary;
    const directions = contract.planning.directions.length > 0
        ? [...contract.planning.directions]
        : Object.keys(directionBandSummary);
    const bandPreviews = directions.flatMap((direction) => (
        (directionBandSummary[direction] || []).map((band) => ({
            direction,
            bandId: band.bandId,
            avgTotal: band.avgTotal,
            timeSlotCount: band.timeSlots.length,
            segmentCount: band.segments.length,
        }))
    ));

    return {
        routeNumber: contract.routeNumber,
        dayType: contract.dayType,
        importMode: contract.importMode,
        status: contract.healthSnapshot.status,
        chartBasis: contract.planning.chartBasis,
        generationBasis: contract.planning.generationBasis,
        buckets: cloneValue(contract.planning.buckets) as TripBucketAnalysis[],
        bands: cloneValue(contract.planning.bands),
        directionBandSummary,
        segmentColumns: cloneValue(contract.planning.segmentColumns),
        healthReport: cloneValue(contract.healthSnapshot),
        usableBucketCount: contract.planning.usableBucketCount,
        ignoredBucketCount: contract.planning.ignoredBucketCount,
        usableBandCount: contract.planning.usableBandCount,
        directions,
        bandPreviews,
    };
};
