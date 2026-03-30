import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { TripBucketAnalysis, TimeBand } from '../../../utils/ai/runtimeAnalysis';
import type { ScheduleConfig } from '../steps/Step3Build';
import type { ImportMode, PerformanceConfig } from '../steps/Step1Upload';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { WizardProgress } from '../../../hooks/useWizardProgress';
import type { ApprovedRuntimeModel } from './wizardState';
import type { ApprovedRuntimeContract } from './step2ReviewTypes';
import { resolveWizardPersistenceStep } from './wizardPersistence';
import {
    buildSegmentsMapFromParsedData,
    createDefaultPerformanceConfig,
    createDefaultScheduleConfig,
    getOrderedSegmentNames,
} from './wizardState';

type WizardStep = 1 | 2 | 3 | 4;

type WizardDayType = 'Weekday' | 'Saturday' | 'Sunday';

export interface WizardPersistenceState {
    step: WizardStep;
    dayType: WizardDayType;
    importMode: ImportMode;
    performanceConfig: PerformanceConfig;
    autofillFromMaster: boolean;
    projectName: string;
    fileNames: string[];
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    config: ScheduleConfig;
    generatedSchedules: MasterRouteTable[];
    originalGeneratedSchedules: MasterRouteTable[];
    parsedData: RuntimeData[];
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
    projectId?: string;
}

export interface WizardPersistenceOverrides {
    id?: string;
    name?: string;
    generatedSchedules?: MasterRouteTable[];
    originalGeneratedSchedules?: MasterRouteTable[];
    isGenerated?: boolean;
}

export interface ResolvedScheduleBaselines {
    generatedSchedules: MasterRouteTable[];
    originalGeneratedSchedules: MasterRouteTable[];
}

export interface WizardFirebaseSaveData {
    id?: string;
    name: string;
    dayType: WizardDayType;
    importMode: ImportMode;
    autofillFromMaster: boolean;
    performanceConfig: PerformanceConfig;
    routeNumber: string;
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    config?: ScheduleConfig;
    generatedSchedules?: MasterRouteTable[];
    originalGeneratedSchedules?: MasterRouteTable[];
    parsedData?: RuntimeData[];
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
    isGenerated: boolean;
}

export interface WizardRestorableStateInput {
    dayType?: WizardDayType;
    importMode?: ImportMode;
    performanceConfig?: PerformanceConfig;
    autofillFromMaster?: boolean;
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    config?: ScheduleConfig;
    generatedSchedules?: MasterRouteTable[];
    originalGeneratedSchedules?: MasterRouteTable[];
    parsedData?: RuntimeData[];
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
}

export interface NormalizedRestoredWizardState {
    dayType: WizardDayType;
    importMode: ImportMode;
    performanceConfig: PerformanceConfig;
    autofillFromMaster: boolean;
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    config: ScheduleConfig;
    generatedSchedules: MasterRouteTable[];
    originalGeneratedSchedules: MasterRouteTable[];
    parsedData: RuntimeData[];
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
    segmentsMap: Record<string, SegmentRawData[]>;
    segmentNames: string[];
}

export const resolveGeneratedScheduleBaselines = (
    generatedSchedules?: MasterRouteTable[],
    originalGeneratedSchedules?: MasterRouteTable[]
): ResolvedScheduleBaselines => {
    const resolvedGeneratedSchedules = generatedSchedules && generatedSchedules.length > 0
        ? generatedSchedules
        : [];

    const resolvedOriginalGeneratedSchedules = originalGeneratedSchedules && originalGeneratedSchedules.length > 0
        ? originalGeneratedSchedules
        : resolvedGeneratedSchedules;

    return {
        generatedSchedules: resolvedGeneratedSchedules,
        originalGeneratedSchedules: resolvedOriginalGeneratedSchedules,
    };
};

export const buildLocalWizardProgress = (
    state: WizardPersistenceState,
    overrides?: WizardPersistenceOverrides
): WizardProgress => {
    const persistenceStep = resolveWizardPersistenceStep(state.step, overrides);
    const baselines = resolveGeneratedScheduleBaselines(
        overrides?.generatedSchedules ?? state.generatedSchedules,
        overrides?.originalGeneratedSchedules ?? state.originalGeneratedSchedules
    );

    return {
        step: persistenceStep,
        dayType: state.dayType,
        importMode: state.importMode,
        performanceConfig: state.performanceConfig,
        autofillFromMaster: state.autofillFromMaster,
        projectName: state.projectName,
        fileNames: state.fileNames,
        analysis: persistenceStep >= 2 ? state.analysis : undefined,
        bands: persistenceStep >= 2 ? state.bands : undefined,
        config: persistenceStep >= 3 ? state.config : undefined,
        generatedSchedules: persistenceStep >= 4 ? baselines.generatedSchedules : undefined,
        originalGeneratedSchedules: persistenceStep >= 4 ? baselines.originalGeneratedSchedules : undefined,
        parsedData: persistenceStep >= 1 ? state.parsedData : undefined,
        approvedRuntimeContract: persistenceStep >= 2 ? state.approvedRuntimeContract : undefined,
        approvedRuntimeModel: persistenceStep >= 2 ? state.approvedRuntimeModel : undefined,
        updatedAt: new Date().toISOString()
    };
};

export const buildFirebaseWizardSaveData = (
    state: WizardPersistenceState,
    overrides?: WizardPersistenceOverrides
): WizardFirebaseSaveData => {
    const effectiveProjectId = overrides?.id ?? state.projectId;
    const persistenceStep = resolveWizardPersistenceStep(state.step, overrides);
    const baselines = resolveGeneratedScheduleBaselines(
        overrides?.generatedSchedules ?? state.generatedSchedules,
        overrides?.originalGeneratedSchedules ?? state.originalGeneratedSchedules
    );

    return {
        name: overrides?.name || state.projectName,
        dayType: state.dayType,
        importMode: state.importMode,
        autofillFromMaster: state.autofillFromMaster,
        performanceConfig: state.performanceConfig,
        routeNumber: state.config.routeNumber,
        analysis: persistenceStep >= 2 ? state.analysis : undefined,
        bands: persistenceStep >= 2 ? state.bands : undefined,
        config: persistenceStep >= 3 ? state.config : undefined,
        generatedSchedules: persistenceStep >= 4 ? baselines.generatedSchedules : undefined,
        originalGeneratedSchedules: persistenceStep >= 4 ? baselines.originalGeneratedSchedules : undefined,
        parsedData: persistenceStep >= 1 ? state.parsedData : undefined,
        approvedRuntimeContract: persistenceStep >= 2 ? state.approvedRuntimeContract : undefined,
        approvedRuntimeModel: persistenceStep >= 2 ? state.approvedRuntimeModel : undefined,
        isGenerated: overrides?.isGenerated ?? (persistenceStep >= 4),
        ...(effectiveProjectId ? { id: effectiveProjectId } : {})
    };
};

export const normalizeRestoredWizardState = (
    input: WizardRestorableStateInput
): NormalizedRestoredWizardState => {
    const parsedData = input.parsedData && input.parsedData.length > 0
        ? input.parsedData
        : [];
    const segmentsMap = parsedData.length > 0
        ? buildSegmentsMapFromParsedData(parsedData)
        : {};
    const analysis = input.analysis && input.analysis.length > 0
        ? input.analysis
        : [];
    const baselines = resolveGeneratedScheduleBaselines(
        input.generatedSchedules,
        input.originalGeneratedSchedules
    );

    return {
        dayType: input.dayType || 'Weekday',
        importMode: input.importMode || 'csv',
        performanceConfig: input.performanceConfig || createDefaultPerformanceConfig(),
        autofillFromMaster: input.autofillFromMaster ?? true,
        analysis,
        bands: input.bands && input.bands.length > 0 ? input.bands : [],
        config: input.config || createDefaultScheduleConfig(),
        generatedSchedules: baselines.generatedSchedules,
        originalGeneratedSchedules: baselines.originalGeneratedSchedules,
        parsedData,
        approvedRuntimeContract: input.approvedRuntimeContract,
        approvedRuntimeModel: input.approvedRuntimeModel,
        segmentsMap,
        segmentNames: parsedData.length > 0
            ? getOrderedSegmentNames(segmentsMap, analysis)
            : getOrderedSegmentNames({}, analysis),
    };
};
