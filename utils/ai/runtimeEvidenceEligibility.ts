export const MIN_RELIABLE_OBSERVATIONS = 10;
export const MIN_RELIABLE_DAYS = 5;

export type RuntimeEvidenceKind =
    | 'paired-cycle'
    | 'uploaded-percentiles'
    | 'segment-only'
    | 'estimated';

export interface RuntimeEvidenceEligibilityBucket {
    totalP50: number;
    observedCycleP50?: number;
    assignedBand?: string;
    ignored: boolean;
    isOutlier: boolean;
    expectedSegmentCount?: number;
    observedSegmentCount?: number;
    sampleCountMode?: 'observations' | 'days';
    runtimePatternKind?: 'normal' | 'detour';
    coverageCause?: string;
    missingSegmentNames?: string[];
    details?: Array<{ n?: number }>;
    contributingDays?: Array<{ date: string }>;
    evidence?: {
        kind: RuntimeEvidenceKind;
        qualifyingCount: number;
        requiredCount: number;
        planningEligible: boolean;
        exclusionReasons: string[];
    };
}

export interface RuntimeEvidenceEligibilityOptions {
    fallbackExpectedSegmentCount?: number;
    requireAssignedBand?: boolean;
}

export interface RuntimeEvidenceEligibilityResult {
    eligible: boolean;
    reasons: string[];
}

const addReason = (reasons: string[], reason: string): void => {
    if (!reasons.includes(reason)) reasons.push(reason);
};
/**
 * Recomputes scheduling eligibility from the underlying bucket evidence.
 * The persisted planningEligible flag is intentionally not trusted.
 */
export const evaluateRuntimeBucketEligibility = (
    bucket: RuntimeEvidenceEligibilityBucket,
    options: RuntimeEvidenceEligibilityOptions = {}
): RuntimeEvidenceEligibilityResult => {
    const reasons: string[] = [];
    const evidence = bucket.evidence;
    const observedSegmentCount = bucket.observedSegmentCount ?? bucket.details?.length ?? 0;
    const expectedSegmentCount = bucket.expectedSegmentCount ?? options.fallbackExpectedSegmentCount ?? 0;
    const bandingTotal = bucket.observedCycleP50 ?? bucket.totalP50;

    if (!Number.isFinite(bandingTotal) || bandingTotal <= 0) {
        addReason(reasons, 'No positive runtime total');
    }
    if (bucket.ignored) addReason(reasons, 'Bucket is excluded');
    if (bucket.isOutlier) addReason(reasons, 'Statistical outlier');
    if (options.requireAssignedBand && !bucket.assignedBand) {
        addReason(reasons, 'No runtime band assigned');
    }
    if (expectedSegmentCount <= 0 || observedSegmentCount < expectedSegmentCount) {
        addReason(reasons, 'Incomplete segment coverage');
    }
    if ((bucket.missingSegmentNames?.length ?? 0) > 0) {
        addReason(reasons, 'Incomplete segment coverage');
    }
    if (bucket.coverageCause && bucket.coverageCause !== 'complete') {
        addReason(
            reasons,
            bucket.coverageCause === 'repaired-single-gap'
                ? 'Estimated segment repair'
                : 'Incomplete segment coverage'
        );
    }
    if (bucket.runtimePatternKind === 'detour') {
        addReason(reasons, 'Detour evidence is troubleshooting-only');
    }

    if (!evidence) {
        addReason(reasons, 'Scheduling evidence is missing');
        return { eligible: false, reasons };
    }

    if (!Number.isInteger(evidence.qualifyingCount) || evidence.qualifyingCount < 0) {
        addReason(reasons, 'Invalid qualifying sample count');
    }

    if (evidence.kind === 'paired-cycle') {
        if (bucket.sampleCountMode !== 'days') {
            addReason(reasons, 'Paired-cycle evidence must be counted by day');
        }
        if (evidence.requiredCount !== MIN_RELIABLE_DAYS) {
            addReason(reasons, `Paired-cycle evidence must require ${MIN_RELIABLE_DAYS} days`);
        }
        if (evidence.qualifyingCount < MIN_RELIABLE_DAYS) {
            addReason(reasons, `Only ${evidence.qualifyingCount} of ${MIN_RELIABLE_DAYS} required days`);
        }

        const distinctContributionDays = new Set(
            (bucket.contributingDays ?? []).map(contribution => contribution.date.trim()).filter(Boolean)
        ).size;
        if (distinctContributionDays < MIN_RELIABLE_DAYS) {
            addReason(reasons, `Only ${distinctContributionDays} complete paired-cycle days are recorded`);
        }
    } else if (evidence.kind === 'uploaded-percentiles') {
        if (bucket.sampleCountMode !== 'observations') {
            addReason(reasons, 'Observation counts are missing from the uploaded percentile CSV');
        }
        if (evidence.requiredCount !== MIN_RELIABLE_OBSERVATIONS) {
            addReason(reasons, `Uploaded evidence must require ${MIN_RELIABLE_OBSERVATIONS} observations`);
        }
        if (evidence.qualifyingCount < MIN_RELIABLE_OBSERVATIONS) {
            addReason(reasons, `Only ${evidence.qualifyingCount} of ${MIN_RELIABLE_OBSERVATIONS} required observations`);
        }

        const segmentCounts = bucket.details?.map(detail => detail.n ?? 0) ?? [];
        if (
            segmentCounts.length === 0
            || segmentCounts.some(count => !Number.isInteger(count) || count < MIN_RELIABLE_OBSERVATIONS)
        ) {
            addReason(reasons, `Every segment needs at least ${MIN_RELIABLE_OBSERVATIONS} verified observations`);
        }
    } else if (evidence.kind === 'segment-only') {
        addReason(reasons, 'No complete paired cycle day');
    } else if (evidence.kind === 'estimated') {
        addReason(reasons, 'Estimated evidence is review-only');
    } else {
        addReason(reasons, 'Unsupported scheduling evidence');
    }

    return { eligible: reasons.length === 0, reasons };
};
