import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ScheduleConfig } from '../../NewSchedule/steps/Step3Build';
import { createDefaultScheduleConfig } from '../../NewSchedule/utils/wizardState';
import { buildGeneratedScheduleInputFingerprint } from '../../NewSchedule/utils/generatedScheduleLineage';
import type { ApprovedRuntimeContract } from '../../NewSchedule/utils/step2ReviewTypes';
import type { RouteConnectionConfig } from '../../../utils/connections/connectionTypes';

export type GuidedBuildStage = 'generate' | 'connections' | 'tweaks';

export interface GuidedBuildState {
    config: ScheduleConfig;
    autofillFromMaster: boolean;
    /** The current schedule: generated, then optimized and tweaked. */
    schedules: MasterRouteTable[];
    /** The schedule exactly as generated; the "show changes" baseline. */
    generated: MasterRouteTable[];
    fingerprint: string | null;
    /** Schedule just before the current run of optimizer passes. Reset restores it. */
    preOptimization: MasterRouteTable[] | null;
    /** Optimizer output, used to tell whether the planner edited after optimizing. */
    lastOptimized: MasterRouteTable[] | null;
    /** Bumped whenever the schedule is replaced from outside the editor. */
    editorSessionKey: number;
    editCount: number;
    stage: GuidedBuildStage;
    routeConnectionConfig: RouteConnectionConfig | null;
}

export const createGuidedBuildState = (routeNumber: string): GuidedBuildState => ({
    config: {
        ...createDefaultScheduleConfig(),
        routeNumber,
        blocks: [{ id: `${routeNumber}-1`, startTime: '06:00', endTime: '22:00' }],
    },
    autofillFromMaster: true,
    schedules: [],
    generated: [],
    fingerprint: null,
    preOptimization: null,
    lastOptimized: null,
    editorSessionKey: 0,
    editCount: 0,
    stage: 'generate',
    routeConnectionConfig: null,
});

/** Generated output is current only while the approved runtimes and Step 3 settings match what generated it. */
export const isGeneratedCurrent = (state: GuidedBuildState, contract: ApprovedRuntimeContract | null): boolean => (
    !!contract
    && state.schedules.length > 0
    && state.fingerprint === buildGeneratedScheduleInputFingerprint({
        approvedRuntimeFingerprint: contract.inputFingerprint,
        dayType: contract.dayType,
        autofillFromMaster: state.autofillFromMaster,
        config: state.config,
    })
);

export const applyGenerated = (
    state: GuidedBuildState,
    tables: MasterRouteTable[],
    config: ScheduleConfig,
    fingerprint: string
): GuidedBuildState => ({
    ...state,
    config,
    schedules: tables,
    generated: tables,
    fingerprint,
    preOptimization: null,
    lastOptimized: null,
    editorSessionKey: state.editorSessionKey + 1,
    editCount: 0,
    stage: 'generate',
    routeConnectionConfig: null,
});

/**
 * Applies an optimizer run. The snapshot is the schedule just before the
 * first of consecutive runs; any manual edit since the last run starts a new
 * snapshot, so a reset never discards manual edits. The optimizer always
 * starts from the current (possibly tweaked) schedule.
 */
export const applyOptimization = (state: GuidedBuildState, optimized: MasterRouteTable[]): GuidedBuildState => {
    const continuesPreviousRun = state.preOptimization !== null && state.lastOptimized === state.schedules;
    return {
        ...state,
        preOptimization: continuesPreviousRun ? state.preOptimization : state.schedules,
        schedules: optimized,
        lastOptimized: optimized,
        editorSessionKey: state.editorSessionKey + 1,
    };
};

export const resetOptimization = (state: GuidedBuildState): GuidedBuildState => (
    state.preOptimization
        ? {
            ...state,
            schedules: state.preOptimization,
            preOptimization: null,
            lastOptimized: null,
            editorSessionKey: state.editorSessionKey + 1,
        }
        : state
);

export const applyManualEdit = (state: GuidedBuildState, tables: MasterRouteTable[]): GuidedBuildState => (
    tables === state.schedules ? state : { ...state, schedules: tables, editCount: state.editCount + 1 }
);

export const countTrips = (tables: MasterRouteTable[]): number => tables.reduce((sum, table) => sum + table.trips.length, 0);

export const countBlocks = (tables: MasterRouteTable[]): number => (
    new Set(tables.flatMap(table => table.trips.map(trip => trip.blockId))).size
);
