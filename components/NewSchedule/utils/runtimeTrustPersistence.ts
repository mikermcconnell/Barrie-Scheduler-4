import type { ApprovedRuntimeContract } from './step2ReviewTypes';
import {
    evaluateRuntimeBucketEligibility,
    type RuntimeEvidenceEligibilityBucket,
} from '../../../utils/ai/runtimeEvidenceEligibility';

export const RUNTIME_TRUST_SCHEMA_VERSION = 2;

export const LEGACY_RUNTIME_KEYS = [
    'analysis',
    'bands',
    'parsedData',
    'approvedRuntimeContract',
    'approvedRuntimeModel',
    'generatedSchedules',
    'originalGeneratedSchedules',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const isStringArray = (value: unknown): value is string[] => (
    Array.isArray(value) && value.every(item => typeof item === 'string')
);

const isNonNegativeInteger = (value: unknown): value is number => (
    Number.isInteger(value) && (value as number) >= 0
);

const isOptionalNonEmptyString = (value: unknown): boolean => (
    value === undefined || (typeof value === 'string' && value.trim().length > 0)
);

const hasValidSourceSnapshotShape = (value: unknown): boolean => {
    if (!isRecord(value)) return false;
    const dateRange = value.performanceDateRange;
    if (
        dateRange !== undefined
        && dateRange !== null
        && (!isRecord(dateRange)
            || typeof dateRange.start !== 'string'
            || !dateRange.start.trim()
            || typeof dateRange.end !== 'string'
            || !dateRange.end.trim())
    ) return false;
    return isOptionalNonEmptyString(value.performanceRouteId)
        && (value.runtimeLogicVersion === undefined || isNonNegativeInteger(value.runtimeLogicVersion))
        && isOptionalNonEmptyString(value.importedAt)
        && isOptionalNonEmptyString(value.cleanHistoryStartDate)
        && (value.stopOrderDecision === undefined || ['accept', 'review', 'blocked'].includes(String(value.stopOrderDecision)))
        && (value.stopOrderConfidence === undefined || ['high', 'medium', 'low'].includes(String(value.stopOrderConfidence)))
        && (value.stopOrderSource === undefined || ['runtime-derived', 'master-fallback', 'none'].includes(String(value.stopOrderSource)));
};

const hasValidStopOrderShape = (value: unknown): boolean => {
    if (value === undefined || value === null) return true;
    if (!isRecord(value)) return false;
    if (
        !['accept', 'review', 'blocked'].includes(String(value.decision))
        || !['high', 'medium', 'low'].includes(String(value.confidence))
        || !['runtime-derived', 'master-fallback', 'none'].includes(String(value.sourceUsed))
        || typeof value.usedForPlanning !== 'boolean'
        || typeof value.summary !== 'string'
        || !isStringArray(value.warnings)
        || !isRecord(value.directionStats)
    ) return false;
    return Object.entries(value.directionStats).every(([direction, stats]) => (
        ['North', 'South', 'Loop'].includes(direction)
        && isRecord(stats)
        && isNonNegativeInteger(stats.tripCountUsed)
        && isNonNegativeInteger(stats.dayCountUsed)
        && isNonNegativeInteger(stats.middayTripCount)
    ));
};

const hasValidHealthSnapshotShape = (
    value: unknown,
    readinessStatus: unknown,
    reviewBucketCount: number,
    approvedBucketCount: number,
    segmentColumnCount: number
): boolean => {
    if (!isRecord(value)) return false;
    const requiredCounts = [
        value.expectedDirections,
        value.expectedSegmentCount,
        value.matchedSegmentCount,
        value.availableBucketCount,
        value.completeBucketCount,
        value.incompleteBucketCount,
        value.lowConfidenceBucketCount,
    ];
    if (requiredCounts.some(count => !isNonNegativeInteger(count))) return false;
    if (
        value.status !== readinessStatus
        || !['ready', 'warning'].includes(String(value.status))
        || !isStringArray(value.blockers)
        || !isStringArray(value.warnings)
        || !isStringArray(value.matchedDirections)
        || !isStringArray(value.missingSegments)
        || typeof value.runtimeSourceSummary !== 'string'
        || !value.runtimeSourceSummary.trim()
        || !Number.isFinite(value.confidenceThreshold)
        || (value.confidenceThreshold as number) <= 0
        || typeof value.usesLegacyRuntimeLogic !== 'boolean'
    ) return false;
    if (
        value.expectedSegmentCount !== segmentColumnCount
        || (value.matchedSegmentCount as number) > segmentColumnCount
        || value.availableBucketCount !== reviewBucketCount
        || (value.coverageCompleteBucketCount !== undefined
            && (!isNonNegativeInteger(value.coverageCompleteBucketCount)
                || value.completeBucketCount !== value.coverageCompleteBucketCount))
        || (value.trustedReadyBucketCount !== undefined
            && (!isNonNegativeInteger(value.trustedReadyBucketCount)
                || value.trustedReadyBucketCount !== approvedBucketCount))
        || (value.incompleteBucketCount as number) > reviewBucketCount
        || (value.lowConfidenceBucketCount as number) > reviewBucketCount
    ) return false;
    if (value.sampleCountMode !== undefined && !['days', 'observations'].includes(String(value.sampleCountMode))) {
        return false;
    }
    const optionalCounts = [
        'repairedBucketCount', 'boundaryBucketCount', 'singleGapBucketCount',
        'internalGapBucketCount', 'fragmentedGapBucketCount', 'excludedLegacyDayCount',
    ];
    if (optionalCounts.some(key => value[key] !== undefined && !isNonNegativeInteger(value[key]))) return false;
    return isOptionalNonEmptyString(value.importedAt)
        && (value.runtimeLogicVersion === undefined || isNonNegativeInteger(value.runtimeLogicVersion))
        && isOptionalNonEmptyString(value.cleanHistoryStartDate)
        && (value.usesCleanHistoryCutoff === undefined || typeof value.usesCleanHistoryCutoff === 'boolean')
        && hasValidStopOrderShape(value.stopOrder);
};

export const isStructurallyValidRuntimeTrustContract = (
    value: unknown
): value is ApprovedRuntimeContract => {
    if (!value || typeof value !== 'object') return false;
    const contract = value as Record<string, unknown>;
    if (
        contract.schemaVersion !== RUNTIME_TRUST_SCHEMA_VERSION
        || contract.approvalState !== 'approved'
        || typeof contract.inputFingerprint !== 'string'
        || contract.inputFingerprint.trim().length === 0
        || typeof contract.routeIdentity !== 'string'
        || typeof contract.routeNumber !== 'string'
        || !['Weekday', 'Saturday', 'Sunday'].includes(String(contract.dayType))
        || !['csv', 'performance'].includes(String(contract.importMode))
    ) {
        return false;
    }
    if (!hasValidSourceSnapshotShape(contract.sourceSnapshot)) return false;
    if (contract.plannerOverrides !== undefined) {
        if (!isRecord(contract.plannerOverrides)) return false;
        const overrides = contract.plannerOverrides;
        if (
            !Array.isArray(overrides.excludedBuckets)
            || overrides.excludedBuckets.some(bucket => typeof bucket !== 'string' || !bucket.trim())
        ) return false;
        const cycleOverrides = overrides.excludedCycleBucketsByStartDirection;
        if (cycleOverrides !== undefined) {
            if (!isRecord(cycleOverrides)) return false;
            if (Object.entries(cycleOverrides).some(([direction, buckets]) => (
                !['North', 'South'].includes(direction)
                || !Array.isArray(buckets)
                || buckets.some(bucket => typeof bucket !== 'string' || !bucket.trim())
            ))) return false;
        }
    }

    const planning = contract.planning;
    if (!planning || typeof planning !== 'object') return false;
    const planningRecord = planning as Record<string, unknown>;
    const reviewBuckets = planningRecord.reviewBuckets;
    const approvedBuckets = planningRecord.approvedBuckets;
    const compatibilityBuckets = planningRecord.buckets;
    const bands = planningRecord.bands;
    const directions = planningRecord.directions;
    const canonicalStops = planningRecord.canonicalDirectionStops;
    const segmentColumns = planningRecord.segmentColumns;
    if (
        !Array.isArray(reviewBuckets)
        || !Array.isArray(approvedBuckets)
        || approvedBuckets.length === 0
        || !Array.isArray(compatibilityBuckets)
        || compatibilityBuckets.length !== reviewBuckets.length
        || !Array.isArray(bands)
        || bands.length === 0
        || !Array.isArray(directions)
        || directions.length === 0
        || !Array.isArray(segmentColumns)
        || segmentColumns.length === 0
        || segmentColumns.some(column => (
            !isRecord(column)
            || typeof column.segmentName !== 'string'
            || !column.segmentName.trim()
            || (column.direction !== undefined && typeof column.direction !== 'string')
            || (column.groupLabel !== undefined && typeof column.groupLabel !== 'string')
        ))
        || !canonicalStops
        || typeof canonicalStops !== 'object'
        || Array.isArray(canonicalStops)
        || !planningRecord.directionBandSummary
        || typeof planningRecord.directionBandSummary !== 'object'
        || Array.isArray(planningRecord.directionBandSummary)
    ) {
        return false;
    }

    const validDirections = new Set(['North', 'South', 'Loop']);
    const normalizedDirections = directions.map(direction => (
        typeof direction === 'string' ? direction.trim() : ''
    ));
    if (
        normalizedDirections.some(direction => !validDirections.has(direction))
        || new Set(normalizedDirections).size !== normalizedDirections.length
    ) {
        return false;
    }

    const canonicalStopRecord = canonicalStops as Record<string, unknown>;
    const directionSummary = planningRecord.directionBandSummary as Record<string, unknown>;
    const hasValidStops = normalizedDirections.every(direction => {
        const stops = canonicalStopRecord[direction];
        if (!Array.isArray(stops) || stops.length < 2) return false;
        const normalizedStops = stops.map(stop => typeof stop === 'string' ? stop.trim() : '');
        if (normalizedStops.some(stop => !stop)) return false;
        return normalizedStops.some((stop, index) => index > 0 && stop !== normalizedStops[index - 1]);
    });
    if (
        !hasValidStops
        || normalizedDirections.some(direction => (
            !Array.isArray(directionSummary[direction])
            || directionSummary[direction].length === 0
        ))
    ) return false;

    const approvedBucketRecords = approvedBuckets as Array<Record<string, unknown>>;
    if (approvedBucketRecords.some(bucket => (
        bucket.ignored !== false
        || bucket.isOutlier !== false
        || typeof bucket.assignedBand !== 'string'
        || !bucket.assignedBand.trim()
        || !evaluateRuntimeBucketEligibility(
            bucket as unknown as RuntimeEvidenceEligibilityBucket,
            { requireAssignedBand: true }
        ).eligible
    ))) {
        return false;
    }

    const approvedBucketKeys = approvedBucketRecords.map(bucket => bucket.timeBucket);
    if (
        approvedBucketKeys.some(key => typeof key !== 'string' || !key.trim())
        || new Set(approvedBucketKeys).size !== approvedBucketKeys.length
    ) {
        return false;
    }
    const cycleBucketsByStartDirection = planningRecord.approvedCycleBucketsByStartDirection;
    if (cycleBucketsByStartDirection !== undefined) {
        if (!isRecord(cycleBucketsByStartDirection)) return false;
        const entries = Object.entries(cycleBucketsByStartDirection);
        if (
            entries.length === 0
            || entries.some(([direction, buckets]) => (
                !['North', 'South'].includes(direction)
                || !Array.isArray(buckets)
                || buckets.length === 0
                || buckets.some(bucket => (
                    !isRecord(bucket)
                    || bucket.ignored !== false
                    || bucket.isOutlier !== false
                    || typeof bucket.assignedBand !== 'string'
                    || !bucket.assignedBand.trim()
                    || !evaluateRuntimeBucketEligibility(
                        bucket as unknown as RuntimeEvidenceEligibilityBucket,
                        { requireAssignedBand: true }
                    ).eligible
                ))
                || new Set(buckets.map(bucket => (bucket as Record<string, unknown>).timeBucket)).size !== buckets.length
            ))
        ) return false;
    }
    const orderedReviewBucketKeys = (reviewBuckets as Array<Record<string, unknown>>)
        .map(bucket => bucket?.timeBucket);
    const orderedCompatibilityBucketKeys = (compatibilityBuckets as Array<Record<string, unknown>>)
        .map(bucket => bucket?.timeBucket);
    if (orderedReviewBucketKeys.some((key, index) => key !== orderedCompatibilityBucketKeys[index])) {
        return false;
    }
    const reviewBucketKeys = new Set(orderedReviewBucketKeys);
    if (approvedBucketKeys.some(key => !reviewBucketKeys.has(key))) return false;

    const assignedBandIds = new Set(approvedBucketRecords.map(bucket => bucket.assignedBand));
    const definedBandIds = new Set(
        (bands as Array<Record<string, unknown>>).map(band => band?.id)
    );
    const usableBucketCount = planningRecord.usableBucketCount;
    const ignoredBucketCount = planningRecord.ignoredBucketCount;
    const usableBandCount = planningRecord.usableBandCount;
    return hasValidHealthSnapshotShape(
        contract.healthSnapshot,
        contract.readinessStatus,
        reviewBuckets.length,
        approvedBuckets.length,
        segmentColumns.length
    )
        && Number.isInteger(usableBucketCount)
        && usableBucketCount === approvedBuckets.length
        && Number.isInteger(ignoredBucketCount)
        && ignoredBucketCount === reviewBuckets.filter(bucket => (
            !!bucket && typeof bucket === 'object' && (bucket as Record<string, unknown>).ignored === true
        )).length
        && Number.isInteger(usableBandCount)
        && usableBandCount === assignedBandIds.size
        && usableBandCount > 0
        && definedBandIds.size === bands.length
        && Array.from(definedBandIds).every(id => typeof id === 'string' && !!id.trim())
        && Array.from(assignedBandIds).every(id => definedBandIds.has(id));
};

export const sanitizeLegacyRuntimeStorageContent = (
    value: unknown
): Record<string, unknown> => {
    const next = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    LEGACY_RUNTIME_KEYS.forEach(key => delete next[key]);
    return next;
};
