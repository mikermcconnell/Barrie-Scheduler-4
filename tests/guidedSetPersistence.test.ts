import { describe, expect, it } from 'vitest';
import type { RuntimeData, SegmentRawData } from '../components/NewSchedule/utils/csvParser';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import type { NewScheduleProject } from '../utils/services/newScheduleProjectService';
import { buildStep2ReviewResult } from '../components/NewSchedule/utils/step2ReviewBuilder';
import { resolveStep2ApprovalState } from '../components/NewSchedule/utils/step2Invalidation';
import { buildCanonicalSegmentColumnsFromMasterStops } from '../components/NewSchedule/utils/wizardState';
import { buildGeneratedScheduleInputFingerprint } from '../components/NewSchedule/utils/generatedScheduleLineage';
import { buildRuntimeReviewModel } from '../components/GuidedSchedule/runtimeReview/buildRuntimeReviewModel';
import { applyAnalysisUpdate, buildGuidedReviewInput } from '../components/GuidedSchedule/runtimeReview/buildGuidedReviewInput';
import { approveGuidedReview } from '../components/GuidedSchedule/runtimeReview/guidedApproval';
import type { PreparedRuntimeReview } from '../components/GuidedSchedule/runtimeReview/prepareRuntimeReview';
import type { LoadedRuntimeReview } from '../components/GuidedSchedule/runtimeReview/useGuidedRuntimeReview';
import {
    applyGenerated,
    applyManualEdit,
    applyOptimization,
    createGuidedBuildState,
    isGeneratedCurrent,
    setHeadwayTargets,
} from '../components/GuidedSchedule/build/guidedBuildState';
import { EMPTY_PACKAGE_ENTRY, getPackageStatus } from '../components/GuidedSchedule/package/guidedPackageState';
import {
    buildGuidedDayProject,
    guidedDayProjectId,
    restoreGuidedDay,
    summarizeGuidedSets,
    type GuidedDaySaveInput,
} from '../components/GuidedSchedule/persistence/guidedSetPersistence';

const DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09'];
const BUCKETS = ['06:00 - 06:29', '06:30 - 06:59', '07:00 - 07:29', '07:30 - 07:59'];
const NORTH = ['Downtown Terminal', 'Allandale GO', 'Georgian College'];
const SOUTH = [...NORTH].reverse();
const DATE_RANGE = { start: '2026-09-01', end: '2026-09-30' };

const segment = (from: string, to: string, minutes: number): SegmentRawData => ({
    segmentName: `${from} to ${to}`,
    timeBuckets: Object.fromEntries(BUCKETS.map((bucket, index) => [bucket, {
        p50: minutes + index,
        p80: minutes + index + 2,
        n: DATES.length,
        contributions: DATES.map(date => ({ date, runtime: minutes + index })),
    }])),
});

const runtime = (direction: 'North' | 'South', stops: string[], cycleStartDirection: 'North' | 'South'): RuntimeData => ({
    segments: stops.slice(0, -1).map((stop, index) => segment(stop, stops[index + 1], 9 + index)),
    allTimeBuckets: BUCKETS,
    detectedRouteNumber: '8A',
    detectedDirection: direction,
    cycleStartDirection,
    sampleCountMode: 'days',
});

const results = [
    runtime('North', NORTH, 'North'),
    runtime('South', SOUTH, 'North'),
    runtime('South', SOUTH, 'South'),
    runtime('North', NORTH, 'South'),
];

const prepared: PreparedRuntimeReview = {
    routeNumber: '8A',
    routeIdentity: '8A-Weekday',
    results,
    displayResults: results,
    canonicalDirectionStops: { North: NORTH, South: SOUTH },
    canonicalSegmentColumns: buildCanonicalSegmentColumnsFromMasterStops('8A', NORTH, SOUTH),
    canonicalRouteSource: { type: 'master', routeIdentity: '8A-Weekday', versionHint: 'master-schedule' },
    stopOrderHealth: null,
};

const loaded: LoadedRuntimeReview = {
    prepared,
    model: buildRuntimeReviewModel(results),
    diagnostics: null,
    dayType: 'Weekday',
    dateRange: DATE_RANGE,
};

const reviewInputFor = (review: { loaded: LoadedRuntimeReview; model: LoadedRuntimeReview['model']; cycleExclusions: GuidedDaySaveInput['cycleExclusions'] }) => (
    buildGuidedReviewInput({
        prepared: review.loaded.prepared,
        model: review.model,
        cycleExclusions: review.cycleExclusions,
        dayType: 'Weekday',
        dateRange: review.loaded.dateRange,
        diagnostics: review.loaded.diagnostics,
    })
);

const approve = (model = loaded.model, cycleExclusions: GuidedDaySaveInput['cycleExclusions'] = {}) => {
    const reviewInput = reviewInputFor({ loaded, model, cycleExclusions });
    const reviewResult = reviewInput ? buildStep2ReviewResult(reviewInput) : null;
    return approveGuidedReview({ reviewInput, reviewResult, approvalState: 'unapproved', warningsAcknowledged: true }, '2026-10-16T12:00:00.000Z');
};

const saveInput = (overrides: Partial<GuidedDaySaveInput> = {}): GuidedDaySaveInput => ({
    scheduleSetId: 'guided-set-1',
    dayType: 'Weekday',
    step: 2,
    set: { selection: { routeId: '8A', dayTypes: ['Weekday'], dateRange: DATE_RANGE, timeFrameSet: true }, skippedDayTypes: [] },
    loaded,
    model: loaded.model,
    cycleExclusions: {},
    selectedDirection: 'North',
    contract: null,
    build: null,
    pkg: EMPTY_PACKAGE_ENTRY,
    ...overrides,
});

/** Mirrors the service: Firestore metadata plus a JSON Storage blob. */
const roundTrip = (input: GuidedDaySaveInput, revision = 3): NewScheduleProject => {
    const { id, ...project } = buildGuidedDayProject(input);
    return {
        ...JSON.parse(JSON.stringify(project)),
        id,
        projectRevision: revision,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
};

const trip = (blockId: string, startTime: number, endTime: number): MasterTrip => ({
    id: `${blockId}-${startTime}`,
    blockId,
    direction: 'North',
    tripNumber: 1,
    rowId: 0,
    startTime,
    endTime,
    recoveryTime: 5,
    travelTime: endTime - startTime,
    cycleTime: endTime - startTime + 5,
    stops: { Downtown: '', 'Georgian College': '' },
} as MasterTrip);

const table = (trips: MasterTrip[]): MasterRouteTable => ({ routeName: '8A (Weekday) (North)', stops: [], stopIds: {}, trips });

const generatedBuild = (contractFingerprint: string) => {
    const state = createGuidedBuildState('8A');
    const fingerprint = buildGeneratedScheduleInputFingerprint({
        approvedRuntimeFingerprint: contractFingerprint,
        dayType: 'Weekday',
        autofillFromMaster: state.autofillFromMaster,
        config: state.config,
    });
    return applyGenerated(state, [table([trip('8A-1', 360, 390)])], state.config, fingerprint);
};

describe('guided set persistence', () => {
    it('derives one project id per day type from the set id', () => {
        expect(guidedDayProjectId('guided-set-1', 'Saturday')).toBe('guided-set-1_Saturday');
        expect(buildGuidedDayProject(saveInput()).id).toBe('guided-set-1_Weekday');
    });

    it('keeps an approval approved after a save and restore', () => {
        const contract = approve();
        expect(contract).not.toBeNull();
        const restored = restoreGuidedDay(roundTrip(saveInput({ contract })));
        expect(restored).not.toBeNull();
        expect(restored!.revision).toBe(3);
        expect(restored!.review.contract?.inputFingerprint).toBe(contract!.inputFingerprint);

        const reviewInput = reviewInputFor(restored!.review);
        const reviewResult = buildStep2ReviewResult(reviewInput!);
        expect(resolveStep2ApprovalState(reviewResult, restored!.review.contract)).toBe('approved');
    });

    it('keeps exclusions in both orientations for an unapproved review', () => {
        const primaryEdit = applyAnalysisUpdate(
            loaded.model,
            {},
            'North',
            loaded.model.analysis.map((bucket, index) => (index === 0 ? { ...bucket, ignored: true } : bucket))
        );
        const cycleExclusions = { ...primaryEdit.cycleExclusions, South: [BUCKETS[1]] };
        const restored = restoreGuidedDay(roundTrip(saveInput({
            model: primaryEdit.model,
            cycleExclusions,
            selectedDirection: 'South',
        })));

        expect(restored!.review.contract).toBeNull();
        expect(restored!.review.cycleExclusions).toEqual(cycleExclusions);
        expect(restored!.review.selectedDirection).toBe('South');
        expect(restored!.review.model.analysis.filter(bucket => bucket.ignored).map(bucket => bucket.timeBucket)).toEqual([BUCKETS[0]]);
        expect(restored!.review.model.bands).toEqual(primaryEdit.model.bands);
    });

    it('keeps the generated schedule current and the optimizer run continuable', () => {
        const contract = approve()!;
        const generated = generatedBuild(contract.inputFingerprint);
        const optimized = applyOptimization(generated, [table([trip('8A-1', 365, 395)])]);
        const restored = restoreGuidedDay(roundTrip(saveInput({ step: 4, contract, build: optimized })));
        const build = restored!.build!;

        expect(restored!.step).toBe(4);
        expect(isGeneratedCurrent(build, restored!.review.contract)).toBe(true);
        expect(build.schedules[0].trips[0].startTime).toBe(365);
        expect(build.generated[0].trips[0].startTime).toBe(360);
        expect(build.preOptimization?.[0].trips[0].startTime).toBe(360);
        expect(build.lastOptimized).toBe(build.schedules);
        // A second optimizer run continues the first, so reset still returns to the pre-optimizer schedule.
        expect(applyOptimization(build, build.schedules).preOptimization).toBe(build.preOptimization);
    });

    it('does not continue an optimizer run after a manual edit', () => {
        const contract = approve()!;
        const optimized = applyOptimization(generatedBuild(contract.inputFingerprint), [table([trip('8A-1', 365, 395)])]);
        const edited = applyManualEdit(optimized, [table([trip('8A-1', 370, 400)])]);
        const build = restoreGuidedDay(roundTrip(saveInput({ step: 4, contract, build: edited })))!.build!;

        expect(build.lastOptimized).toBeNull();
        expect(build.editCount).toBe(1);
    });

    it('keeps typed Step 4 target headways, and loads saves made before them', () => {
        const contract = approve()!;
        const withTargets = setHeadwayTargets(generatedBuild(contract.inputFingerprint), { 'row-a': 45 });
        const restored = restoreGuidedDay(roundTrip(saveInput({ step: 4, contract, build: withTargets })))!.build!;
        expect(restored.headwayTargets).toEqual({ 'row-a': 45 });

        const project = roundTrip(saveInput({ step: 4, contract, build: generatedBuild(contract.inputFingerprint) }));
        delete (project as any).guidedDay?.build?.headwayTargets;
        expect(restoreGuidedDay(project)!.build!.headwayTargets).toEqual({});
    });

    it('restores the draft and published status by current schedule', () => {
        const contract = approve()!;
        const build = generatedBuild(contract.inputFingerprint);
        const published = { version: 7, publishedAt: '2026-10-17T10:00:00.000Z' };

        const current = restoreGuidedDay(roundTrip(saveInput({
            step: 5, contract, build, pkg: { draftId: 'draft-1', draftSource: build.schedules, published },
        })))!;
        expect(getPackageStatus(current.pkg, current.build!.schedules)).toBe('published');

        const outdated = restoreGuidedDay(roundTrip(saveInput({
            step: 5, contract, build, pkg: { draftId: 'draft-1', draftSource: [table([])], published: null },
        })))!;
        expect(getPackageStatus(outdated.pkg, outdated.build!.schedules)).toBe('draft-outdated');

        const none = restoreGuidedDay(roundTrip(saveInput({ step: 5, contract, build })))!;
        expect(getPackageStatus(none.pkg, none.build!.schedules)).toBe('no-draft');
    });

    it('returns null for projects that are not guided days', () => {
        const { guidedDay: _guidedDay, ...withoutSnapshot } = roundTrip(saveInput());
        expect(restoreGuidedDay(withoutSnapshot as NewScheduleProject)).toBeNull();
        expect(restoreGuidedDay({ ...roundTrip(saveInput()), parsedData: [] })).toBeNull();
    });

    it('groups listed projects into sets, newest first', () => {
        const meta = (id: string, setId: string | undefined, dayType: 'Weekday' | 'Saturday' | 'Sunday', step: number, updated: string): NewScheduleProject => ({
            id,
            name: id,
            dayType,
            routeNumber: '8A',
            wizardStep: step as NewScheduleProject['wizardStep'],
            performanceConfig: { routeId: '8A', dateRange: DATE_RANGE },
            scheduleSetId: setId,
            isGenerated: false,
            createdAt: new Date(updated),
            updatedAt: new Date(updated),
        });
        const sets = summarizeGuidedSets([
            meta('a_Sunday', 'a', 'Sunday', 3, '2026-10-10'),
            meta('legacy', undefined, 'Weekday', 4, '2026-10-19'),
            meta('b_Weekday', 'b', 'Weekday', 2, '2026-10-18'),
            meta('a_Weekday', 'a', 'Weekday', 4, '2026-10-12'),
        ]);

        expect(sets.map(set => set.scheduleSetId)).toEqual(['b', 'a']);
        expect(sets[1].dayTypes).toEqual(['Weekday', 'Sunday']);
        expect(sets[1].step).toBe(4);
        expect(sets[1].projectIds).toEqual(['a_Sunday', 'a_Weekday']);
        expect(sets[1].updatedAt.toISOString().slice(0, 10)).toBe('2026-10-12');
    });
});
