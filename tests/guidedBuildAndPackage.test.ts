import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import type { MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2ReviewTypes';
import {
    applyGenerated,
    applyManualEdit,
    applyOptimization,
    canAutoGenerate,
    createGuidedBuildState,
    isGeneratedCurrent,
    resetOptimization,
    resolveBuildStage,
    setHeadwayTargets,
} from '../components/GuidedSchedule/build/guidedBuildState';
import { syncBlocksWithTables } from '../components/GuidedSchedule/build/generateGuidedSchedule';
import { buildBlockLanes } from '../components/GuidedSchedule/build/GuidedBuildSummary';
import {
    EMPTY_PACKAGE_ENTRY,
    canExportPackage,
    confirmPublishedVersion,
    getPackageStatus,
} from '../components/GuidedSchedule/package/guidedPackageState';
import { buildGeneratedScheduleInputFingerprint } from '../components/NewSchedule/utils/generatedScheduleLineage';

const trip = (blockId: string, startTime: number, endTime: number, direction: 'North' | 'South' = 'North'): MasterTrip => ({
    id: `${blockId}-${startTime}`,
    blockId,
    direction,
    tripNumber: 1,
    rowId: 0,
    startTime,
    endTime,
    recoveryTime: 5,
    travelTime: endTime - startTime,
    cycleTime: endTime - startTime + 5,
    stops: direction === 'North' ? { Downtown: '', 'Georgian College': '' } : { 'Georgian College': '', Downtown: '' },
} as MasterTrip);

const table = (trips: MasterTrip[], name = '10 (Weekday) (North)'): MasterRouteTable => ({ routeName: name, stops: [], stopIds: {}, trips });

const contract = { inputFingerprint: 'runtime-fp', dayType: 'Weekday' } as ApprovedRuntimeContract;

const generatedState = () => {
    const state = createGuidedBuildState('10');
    const tables = [table([trip('10-1', 360, 390)])];
    const fingerprint = buildGeneratedScheduleInputFingerprint({
        approvedRuntimeFingerprint: contract.inputFingerprint,
        dayType: 'Weekday',
        autofillFromMaster: state.autofillFromMaster,
        config: state.config,
    });
    return applyGenerated(state, tables, state.config, fingerprint);
};

describe('guided build state', () => {
    it('starts with one block for the route and no schedule', () => {
        const state = createGuidedBuildState('10');
        expect(state.config.routeNumber).toBe('10');
        expect(state.config.blocks).toHaveLength(1);
        expect(isGeneratedCurrent(state, contract)).toBe(false);
    });

    it('is current only while the approved runtimes and settings match', () => {
        const state = generatedState();
        expect(isGeneratedCurrent(state, contract)).toBe(true);
        expect(isGeneratedCurrent({ ...state, config: { ...state.config, cycleTime: 75 } }, contract)).toBe(false);
        expect(isGeneratedCurrent(state, { ...contract, inputFingerprint: 'other' } as ApprovedRuntimeContract)).toBe(false);
        expect(isGeneratedCurrent(state, null)).toBe(false);
    });

    it('reset after optimizing restores the tweaked schedule, not the generated one', () => {
        const tweaked = [table([trip('10-1', 362, 392)])];
        const optimized = [table([trip('10-1', 365, 395)])];
        const afterEdit = applyManualEdit(generatedState(), tweaked);
        expect(afterEdit.editCount).toBe(1);

        const afterOptimize = applyOptimization(afterEdit, optimized);
        expect(afterOptimize.schedules).toBe(optimized);
        expect(afterOptimize.preOptimization).toBe(tweaked);

        const afterReset = resetOptimization(afterOptimize);
        expect(afterReset.schedules).toBe(tweaked);
        expect(afterReset.generated).not.toBe(tweaked);
        expect(afterReset.editorSessionKey).toBeGreaterThan(afterOptimize.editorSessionKey);
    });

    it('back-to-back optimizer runs reset to before the first run; an edit in between starts a new snapshot', () => {
        const base = generatedState();
        const first = [table([trip('10-1', 365, 395)])];
        const second = [table([trip('10-1', 367, 397)])];
        const consecutive = applyOptimization(applyOptimization(base, first), second);
        expect(resetOptimization(consecutive).schedules).toBe(base.schedules);

        const edited = [table([trip('10-1', 366, 396)])];
        const withEdit = applyOptimization(applyManualEdit(applyOptimization(base, first), edited), second);
        expect(resetOptimization(withEdit).schedules).toBe(edited);
    });

    it('generating again clears optimizer snapshots and edits', () => {
        const optimized = applyOptimization(generatedState(), [table([trip('10-1', 365, 395)])]);
        const regenerated = applyGenerated(optimized, [table([trip('10-1', 360, 390)])], optimized.config, 'fp');
        expect(regenerated.preOptimization).toBeNull();
        expect(regenerated.editCount).toBe(0);
        expect(regenerated.stage).toBe('tweaks');
    });

    it('keeps typed target headways through edits, and clears them when generating again', () => {
        const withTargets = setHeadwayTargets(generatedState(), { 'row-a': 45 });
        expect(withTargets.editCount).toBe(0);
        const edited = applyManualEdit(withTargets, [table([trip('10-1', 362, 392)])]);
        expect(edited.headwayTargets).toEqual({ 'row-a': 45 });
        const regenerated = applyGenerated(edited, [table([trip('10-1', 360, 390)])], edited.config, 'fp');
        expect(regenerated.headwayTargets).toEqual({});
    });
});

describe('guided Step 4 order', () => {
    it('opens new and old saved builds on Manual tweaks', () => {
        expect(createGuidedBuildState('10').stage).toBe('tweaks');
        expect(resolveBuildStage('generate')).toBe('tweaks');
        expect(resolveBuildStage('connections')).toBe('connections');
    });

    it('auto-builds only when no planner work would be lost', () => {
        expect(canAutoGenerate(createGuidedBuildState('10'))).toBe(true);
        expect(canAutoGenerate(generatedState())).toBe(true);
        expect(canAutoGenerate(applyManualEdit(generatedState(), [table([trip('10-1', 365, 395)])]))).toBe(false);
        expect(canAutoGenerate(applyOptimization(generatedState(), [table([trip('10-1', 365, 395)])]))).toBe(false);
    });
});

describe('guided generation helpers', () => {
    it('syncs block end stop and direction with the generated trips', () => {
        const config = { ...createGuidedBuildState('10').config, blocks: [{ id: '10-1', startTime: '06:00', endTime: '22:00' }] };
        const synced = syncBlocksWithTables(config, [
            table([trip('10-1', 360, 390, 'North')]),
            table([trip('10-1', 395, 425, 'South')], '10 (Weekday) (South)'),
        ]);
        expect(synced.blocks[0]).toMatchObject({ startStop: 'Downtown', endStop: 'Downtown', startDirection: 'North' });
    });

    it('builds one lane per block in operating-day order, after midnight last', () => {
        const lanes = buildBlockLanes([table([trip('10-2', 30, 60), trip('10-1', 360, 390), trip('10-1', 400, 430)])]);
        expect(lanes.map(lane => lane.blockId)).toEqual(['10-1', '10-2']);
        expect(lanes[0]).toMatchObject({ pullOut: 360, pullIn: 430, trips: 2 });
    });
});

describe('guided package gate', () => {
    const schedules = [table([trip('10-1', 360, 390)])];
    const entry = (overrides: Partial<MasterScheduleEntry>): MasterScheduleEntry => ({
        id: '10-Weekday', routeNumber: '10', dayType: 'Weekday', currentVersion: 4, publishedFromDraft: 'draft-1', ...overrides,
    } as MasterScheduleEntry);

    it('confirms a publish only when Master was published from this draft', () => {
        expect(confirmPublishedVersion(entry({}), 'draft-1')).toEqual({ version: 4, publishedAt: null });
        expect(confirmPublishedVersion(entry({ publishedFromDraft: 'other' }), 'draft-1')).toBeNull();
        expect(confirmPublishedVersion(null, 'draft-1')).toBeNull();
        expect(confirmPublishedVersion(entry({}), null)).toBeNull();
    });

    it('marks a draft out of date when the Step 4 schedule changed after it was opened', () => {
        expect(getPackageStatus(EMPTY_PACKAGE_ENTRY, schedules)).toBe('no-draft');
        const published = { draftId: 'draft-1', draftSource: schedules, published: { version: 4, publishedAt: null as string | null } };
        expect(getPackageStatus(published, schedules)).toBe('published');
        expect(getPackageStatus(published, [table([trip('10-1', 361, 391)])])).toBe('draft-outdated');
        expect(getPackageStatus({ ...published, published: null }, schedules)).toBe('draft');
    });

    it('unlocks exports only when every day type is published', () => {
        expect(canExportPackage(['published', 'published'])).toBe(true);
        expect(canExportPackage(['published', 'draft'])).toBe(false);
        expect(canExportPackage([])).toBe(false);
    });
});
