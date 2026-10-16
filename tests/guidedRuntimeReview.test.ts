import { describe, expect, it } from 'vitest';
import type { RuntimeData, SegmentRawData } from '../components/NewSchedule/utils/csvParser';
import { buildStep2ReviewResult } from '../components/NewSchedule/utils/step2ReviewBuilder';
import { resolveStep2ApprovalState } from '../components/NewSchedule/utils/step2Invalidation';
import { buildCanonicalSegmentColumnsFromMasterStops } from '../components/NewSchedule/utils/wizardState';
import { buildRuntimeReviewModel } from '../components/GuidedSchedule/runtimeReview/buildRuntimeReviewModel';
import {
    applyAnalysisUpdate,
    buildGuidedReviewInput,
} from '../components/GuidedSchedule/runtimeReview/buildGuidedReviewInput';
import {
    approveGuidedReview,
    getApprovalBlocker,
    getApprovalWarnings,
} from '../components/GuidedSchedule/runtimeReview/guidedApproval';
import type { PreparedRuntimeReview } from '../components/GuidedSchedule/runtimeReview/prepareRuntimeReview';

const DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09'];
const BUCKETS = ['06:00 - 06:29', '06:30 - 06:59', '07:00 - 07:29', '07:30 - 07:59'];
const NORTH = ['Downtown Terminal', 'Allandale GO', 'Georgian College'];
const SOUTH = [...NORTH].reverse();

const segment = (from: string, to: string, minutes: number): SegmentRawData => ({
    segmentName: `${from} to ${to}`,
    timeBuckets: Object.fromEntries(BUCKETS.map((bucket, index) => [bucket, {
        p50: minutes + index,
        p80: minutes + index + 2,
        n: DATES.length,
        contributions: DATES.map(date => ({ date, runtime: minutes + index })),
    }])),
});

const runtime = (
    direction: 'North' | 'South',
    stops: string[],
    detectedRouteNumber = '8A',
    cycleStartDirection: 'North' | 'South' = 'North'
): RuntimeData => ({
    segments: stops.slice(0, -1).map((stop, index) => segment(stop, stops[index + 1], 9 + index)),
    allTimeBuckets: BUCKETS,
    detectedRouteNumber,
    detectedDirection: direction,
    cycleStartDirection,
    sampleCountMode: 'days',
});

const prepared = (results: RuntimeData[]): PreparedRuntimeReview => ({
    routeNumber: '8A',
    routeIdentity: '8A-Weekday',
    results,
    displayResults: results,
    canonicalDirectionStops: { North: NORTH, South: SOUTH },
    canonicalSegmentColumns: buildCanonicalSegmentColumnsFromMasterStops('8A', NORTH, SOUTH),
    canonicalRouteSource: { type: 'master', routeIdentity: '8A-Weekday', versionHint: 'master-schedule' },
    stopOrderHealth: null,
});

const setup = (detectedRouteNumber = '8A') => {
    // Each orientation needs its own paired-cycle evidence (LOCKED_LOGIC rule 7).
    const results = [
        runtime('North', NORTH, detectedRouteNumber, 'North'),
        runtime('South', SOUTH, detectedRouteNumber, 'North'),
        runtime('South', SOUTH, detectedRouteNumber, 'South'),
        runtime('North', NORTH, detectedRouteNumber, 'South'),
    ];
    const prep = prepared(results);
    const model = buildRuntimeReviewModel(results);
    const build = (m = model, exclusions = {}) => buildGuidedReviewInput({
        prepared: prep,
        model: m,
        cycleExclusions: exclusions,
        dayType: 'Weekday',
        dateRange: { start: '2026-09-01', end: '2026-09-30' },
        diagnostics: null,
    });
    return { prep, model, build };
};

describe('guided runtime review', () => {
    it('builds a STREETS review keyed by the route chosen in Step 1', () => {
        const { build } = setup('8');
        const input = build();
        expect(input).not.toBeNull();
        expect(input?.routeIdentity).toBe('8A-Weekday');
        expect(input?.routeNumber).toBe('8A');
        expect(input?.importMode).toBe('performance');
        expect(input?.performanceConfig).toEqual({ routeId: '8A', dateRange: { start: '2026-09-01', end: '2026-09-30' } });
        expect(input?.canonicalDirectionStops).toEqual({ North: NORTH, South: SOUTH });
    });

    it('records the detected route so the shell can warn about a mismatch', () => {
        expect(setup('8').model.detectedRouteNumber).toBe('8');
        expect(setup('8A').model.detectedRouteNumber).toBe('8A');
    });

    it('requires an explicit approval and acknowledges warnings first', () => {
        const { build } = setup();
        const reviewInput = build();
        const reviewResult = reviewInput ? buildStep2ReviewResult(reviewInput) : null;
        expect(reviewResult?.health.status, JSON.stringify(reviewResult?.health.blockers)).not.toBe('blocked');

        const base = { reviewInput, reviewResult, approvalState: 'unapproved' as const };
        const warnings = getApprovalWarnings(reviewResult);
        if (warnings.length > 0) {
            expect(getApprovalBlocker({ ...base, warningsAcknowledged: false })).toBe('needs-acknowledgement');
            expect(approveGuidedReview({ ...base, warningsAcknowledged: false })).toBeNull();
        }

        expect(getApprovalBlocker({ ...base, warningsAcknowledged: true })).toBeNull();
        const contract = approveGuidedReview({ ...base, warningsAcknowledged: true }, '2026-10-16T12:00:00.000Z');
        expect(contract?.schemaVersion).toBe(2);
        expect(contract?.acknowledgedWarnings ?? []).toEqual(warnings);
        expect(resolveStep2ApprovalState(reviewResult!, contract)).toBe('approved');
        expect(getApprovalBlocker({ ...base, approvalState: 'approved', warningsAcknowledged: true })).toBe('already-approved');
    });

    it('makes an approval stale when the planner excludes a bucket afterwards', () => {
        const { model, build } = setup();
        const reviewInput = build();
        const reviewResult = buildStep2ReviewResult(reviewInput!);
        const contract = approveGuidedReview({ reviewInput, reviewResult, approvalState: 'unapproved', warningsAcknowledged: true });
        expect(contract).not.toBeNull();

        const excluded = model.analysis.map(bucket => (
            bucket.timeBucket === BUCKETS[1] ? { ...bucket, ignored: true } : bucket
        ));
        const next = applyAnalysisUpdate(model, {}, 'North', excluded);
        const nextInput = build(next.model, next.cycleExclusions);
        expect(nextInput?.plannerOverrides.excludedBuckets).toContain(BUCKETS[1]);
        const nextResult = buildStep2ReviewResult(nextInput!);
        expect(nextResult.inputFingerprint).not.toBe(reviewResult.inputFingerprint);
        expect(resolveStep2ApprovalState(nextResult, contract)).toBe('stale');
    });

    it('blocks approval until warnings are acknowledged', () => {
        const { build } = setup();
        const reviewInput = build();
        const reviewResult = buildStep2ReviewResult(reviewInput!);
        const warned = { ...reviewResult, health: { ...reviewResult.health, status: 'warning' as const, warnings: ['Low evidence at 08:00'] } };
        const args = { reviewInput, reviewResult: warned, approvalState: 'unapproved' as const };
        expect(getApprovalWarnings(warned)).toEqual(['Low evidence at 08:00']);
        expect(getApprovalBlocker({ ...args, warningsAcknowledged: false })).toBe('needs-acknowledgement');
        expect(approveGuidedReview({ ...args, warningsAcknowledged: false })).toBeNull();
    });

    it('keeps South-start exclusions separate from the North-start analysis', () => {
        const { model, build } = setup();
        const southBuckets = build()!.cycleAnalysisByStartDirection!.South!;
        const excluded = southBuckets.map(bucket => (bucket.timeBucket === BUCKETS[0] ? { ...bucket, ignored: true } : bucket));
        const next = applyAnalysisUpdate(model, {}, 'South', excluded);
        expect(next.model).toBe(model);
        expect(next.cycleExclusions.South).toEqual([BUCKETS[0]]);
        const nextInput = build(next.model, next.cycleExclusions)!;
        expect(nextInput.plannerOverrides.excludedBuckets).toEqual([]);
        expect(nextInput.plannerOverrides.excludedCycleBucketsByStartDirection?.South).toEqual([BUCKETS[0]]);
        expect(nextInput.cycleAnalysisByStartDirection?.North?.some(bucket => bucket.ignored)).toBe(false);
    });

    it('never approves a blocked review', () => {
        const { build } = setup();
        const reviewInput = build();
        const reviewResult = buildStep2ReviewResult(reviewInput!);
        const blocked = { ...reviewResult, health: { ...reviewResult.health, status: 'blocked' as const, blockers: ['No approved buckets'] } };
        const args = { reviewInput, reviewResult: blocked, approvalState: 'unapproved' as const, warningsAcknowledged: true };
        expect(getApprovalBlocker(args)).toBe('blocked');
        expect(approveGuidedReview(args)).toBeNull();
    });
});
