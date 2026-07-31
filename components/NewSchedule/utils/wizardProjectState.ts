import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { TripBucketAnalysis, TimeBand } from '../../../utils/ai/runtimeAnalysis';
import type { ScheduleConfig } from '../steps/Step3Build';
import type { ImportMode, PerformanceConfig } from '../steps/Step1Upload';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { WizardProgress } from '../../../hooks/useWizardProgress';
import type { ApprovedRuntimeModel } from './wizardState';
import type {
    ApprovedRuntimeContract,
    Step2CanonicalRouteSource,
} from './step2ReviewTypes';
import type { Step2StopOrderHealth } from './step2StopOrder';
import { normalizeScheduleBaselinesForLineage } from '../../../utils/schedule/tripLineage';
import { resolveWizardPersistenceStep } from './wizardPersistence';
import { isStructurallyValidRuntimeTrustContract } from './runtimeTrustPersistence';
import {
    buildSegmentsMapFromParsedData,
    createDefaultPerformanceConfig,
    createDefaultScheduleConfig,
    getOrderedSegmentNames,
    type OrderedSegmentColumn,
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
    matrixAnalysis: TripBucketAnalysis[];
    matrixSegmentsMap: Record<string, SegmentRawData[]>;
    troubleshootingPatternWarning: string | null;
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    canonicalDirectionStops?: Partial<Record<'North' | 'South' | 'Loop', string[]>>;
    canonicalRouteIdentity?: string;
    canonicalRouteSource?: Step2CanonicalRouteSource;
    step2StopOrderHealth: Step2StopOrderHealth | null;
    legacyRuntimeDataReset: boolean;
}

const resolveRestoredCanonicalRouteSource = (
    contract: ApprovedRuntimeContract | undefined
): Step2CanonicalRouteSource | undefined => {
    if (!contract) return undefined;
    if (contract.sourceSnapshot?.canonicalRouteSource) {
        return contract.sourceSnapshot.canonicalRouteSource;
    }

    if (contract.importMode === 'csv') {
        return {
            type: 'runtime-derived',
            routeIdentity: contract.routeIdentity,
            versionHint: 'csv-runtime-segment-chain',
        };
    }

    if (contract.sourceSnapshot?.stopOrderSource === 'runtime-derived') {
        return {
            type: 'runtime-derived',
            routeIdentity: contract.routeIdentity,
            versionHint: `stop-order-${contract.sourceSnapshot.stopOrderDecision ?? 'accept'}`,
        };
    }

    if (contract.sourceSnapshot?.stopOrderSource === 'master-fallback'
        || contract.planning.canonicalDirectionStops) {
        return {
            type: 'master',
            routeIdentity: contract.routeIdentity,
            versionHint: 'master-schedule',
        };
    }

    return undefined;
};

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
    const baselines = resolveGeneratedScheduleBaselines(
        overrides?.generatedSchedules ?? state.generatedSchedules,
        overrides?.originalGeneratedSchedules ?? state.originalGeneratedSchedules
    );
    const persistenceStep = resolveWizardPersistenceStep(state.step, {
        generatedSchedules: overrides?.generatedSchedules !== undefined
            ? overrides.generatedSchedules
            : baselines.generatedSchedules.length > 0
                ? baselines.generatedSchedules
                : undefined,
        originalGeneratedSchedules: overrides?.originalGeneratedSchedules !== undefined
            ? overrides.originalGeneratedSchedules
            : baselines.originalGeneratedSchedules.length > 0
                ? baselines.originalGeneratedSchedules
                : undefined,
        hasStep3Payload: state.config.blocks.length > 0,
    });

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
        approvedRuntimeModel: undefined,
        updatedAt: new Date().toISOString()
    };
};

export const buildFirebaseWizardSaveData = (
    state: WizardPersistenceState,
    overrides?: WizardPersistenceOverrides
): WizardFirebaseSaveData => {
    const effectiveProjectId = overrides?.id ?? state.projectId;
    const baselines = resolveGeneratedScheduleBaselines(
        overrides?.generatedSchedules ?? state.generatedSchedules,
        overrides?.originalGeneratedSchedules ?? state.originalGeneratedSchedules
    );
    const persistenceStep = resolveWizardPersistenceStep(state.step, {
        generatedSchedules: overrides?.generatedSchedules !== undefined
            ? overrides.generatedSchedules
            : baselines.generatedSchedules.length > 0
                ? baselines.generatedSchedules
                : undefined,
        originalGeneratedSchedules: overrides?.originalGeneratedSchedules !== undefined
            ? overrides.originalGeneratedSchedules
            : baselines.originalGeneratedSchedules.length > 0
                ? baselines.originalGeneratedSchedules
                : undefined,
        hasStep3Payload: state.config.blocks.length > 0,
    });

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
        approvedRuntimeModel: undefined,
        isGenerated: overrides?.isGenerated ?? (baselines.generatedSchedules.length > 0),
        ...(effectiveProjectId ? { id: effectiveProjectId } : {})
    };
};

export const normalizeRestoredWizardState = (
    input: WizardRestorableStateInput
): NormalizedRestoredWizardState => {
    const hasValidV2Contract = isStructurallyValidRuntimeTrustContract(input.approvedRuntimeContract);
    const hasLegacyDerivedRuntime = (
        (!!input.approvedRuntimeContract && !hasValidV2Contract)
        || (!!input.approvedRuntimeModel && !hasValidV2Contract)
        || (!input.approvedRuntimeContract && (
            (input.analysis?.length ?? 0) > 0
            || (input.bands?.length ?? 0) > 0
            || (input.generatedSchedules?.length ?? 0) > 0
            || (input.originalGeneratedSchedules?.length ?? 0) > 0
        ))
    );
    const parsedData = !hasLegacyDerivedRuntime && input.parsedData && input.parsedData.length > 0
        ? input.parsedData
        : [];
    const segmentsMap = parsedData.length > 0
        ? buildSegmentsMapFromParsedData(parsedData)
        : {};
    const analysis = !hasLegacyDerivedRuntime && input.analysis && input.analysis.length > 0
        ? input.analysis
        : [];
    const baselines = resolveGeneratedScheduleBaselines(
        hasLegacyDerivedRuntime ? [] : input.generatedSchedules,
        hasLegacyDerivedRuntime ? [] : input.originalGeneratedSchedules
    );
    const normalizedBaselines = normalizeScheduleBaselinesForLineage(
        baselines.generatedSchedules,
        baselines.originalGeneratedSchedules
    );
    const approvedContract = hasValidV2Contract ? input.approvedRuntimeContract : undefined;
    const troubleshooting = approvedContract?.troubleshootingSnapshot;

    return {
        dayType: input.dayType || 'Weekday',
        importMode: input.importMode || 'csv',
        performanceConfig: input.performanceConfig || createDefaultPerformanceConfig(),
        autofillFromMaster: input.autofillFromMaster ?? true,
        analysis,
        bands: !hasLegacyDerivedRuntime && input.bands && input.bands.length > 0 ? input.bands : [],
        config: input.config || createDefaultScheduleConfig(),
        generatedSchedules: normalizedBaselines.generatedSchedules,
        originalGeneratedSchedules: normalizedBaselines.originalGeneratedSchedules,
        parsedData,
        approvedRuntimeContract: approvedContract,
        approvedRuntimeModel: undefined,
        segmentsMap,
        segmentNames: parsedData.length > 0
            ? getOrderedSegmentNames(segmentsMap, analysis)
            : getOrderedSegmentNames({}, analysis),
        matrixAnalysis: troubleshooting?.matrixAnalysis ?? [],
        matrixSegmentsMap: troubleshooting?.matrixSegmentsMap ?? {},
        troubleshootingPatternWarning: troubleshooting?.fallbackWarning ?? null,
        canonicalSegmentColumns: approvedContract?.planning.segmentColumns,
        canonicalDirectionStops: approvedContract?.planning.canonicalDirectionStops,
        canonicalRouteIdentity: approvedContract?.routeIdentity,
        canonicalRouteSource: resolveRestoredCanonicalRouteSource(approvedContract),
        step2StopOrderHealth: approvedContract?.healthSnapshot?.stopOrder ?? null,
        legacyRuntimeDataReset: hasLegacyDerivedRuntime,
    };
};
