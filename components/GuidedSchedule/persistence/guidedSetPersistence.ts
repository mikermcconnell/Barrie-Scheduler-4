import type { NewScheduleProject } from '../../../utils/services/newScheduleProjectService';
import { isStructurallyValidRuntimeTrustContract } from '../../NewSchedule/utils/runtimeTrustPersistence';
import type { ApprovedRuntimeContract } from '../../NewSchedule/utils/step2ReviewTypes';
import type { GuidedBuildState } from '../build/guidedBuildState';
import type { GuidedPackageEntry } from '../package/guidedPackageState';
import { GUIDED_DAY_TYPES } from '../guidedSelection';
import type { GuidedStep } from '../guidedSteps';
import { buildRuntimeReviewModel } from '../runtimeReview/buildRuntimeReviewModel';
import type { LoadedRuntimeReview } from '../runtimeReview/useGuidedRuntimeReview';
import type {
    CycleStartDirection,
    GuidedDateRange,
    GuidedDayType,
    RuntimeReviewModel,
} from '../runtimeReview/guidedRuntimeReviewTypes';
import { GUIDED_DAY_SNAPSHOT_VERSION, type GuidedDaySnapshot, type GuidedSetMetadata } from './guidedSetTypes';

export type GuidedDayProject = Omit<NewScheduleProject, 'id' | 'createdAt' | 'updatedAt'> & { id: string };

/** Everything the workspace holds for one day type that a save needs. */
export interface GuidedDaySaveInput {
    scheduleSetId: string;
    dayType: GuidedDayType;
    step: GuidedStep;
    set: GuidedSetMetadata;
    loaded: LoadedRuntimeReview;
    model: RuntimeReviewModel;
    cycleExclusions: Partial<Record<CycleStartDirection, string[]>>;
    selectedDirection: CycleStartDirection;
    contract: ApprovedRuntimeContract | null;
    build: GuidedBuildState | null;
    pkg: GuidedPackageEntry;
}

export interface RestoredGuidedDay {
    dayType: GuidedDayType;
    step: GuidedStep;
    revision: number;
    set: GuidedSetMetadata | null;
    review: {
        loaded: LoadedRuntimeReview;
        model: RuntimeReviewModel;
        cycleExclusions: Partial<Record<CycleStartDirection, string[]>>;
        selectedDirection: CycleStartDirection;
        contract: ApprovedRuntimeContract | null;
    };
    build: GuidedBuildState | null;
    pkg: GuidedPackageEntry;
}

export interface GuidedSetSummary {
    scheduleSetId: string;
    routeNumber: string;
    dayTypes: GuidedDayType[];
    dateRange: GuidedDateRange | null;
    step: number;
    updatedAt: Date;
    projectIds: string[];
}

export const createScheduleSetId = (): string => (
    `guided-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

/** One project per day type, with an id derived from the set so saves and resumes need no lookup. */
export const guidedDayProjectId = (scheduleSetId: string, dayType: GuidedDayType): string => `${scheduleSetId}_${dayType}`;

const isGuidedDayType = (value: unknown): value is GuidedDayType => (
    typeof value === 'string' && (GUIDED_DAY_TYPES as string[]).includes(value)
);

const toGuidedStep = (value: unknown): GuidedStep => (
    typeof value === 'number' && value >= 1 && value <= 5 ? value as GuidedStep : 2
);

export const buildGuidedDayProject = (input: GuidedDaySaveInput): GuidedDayProject => {
    const { loaded, model, build, pkg } = input;
    const { results: _results, ...prepared } = loaded.prepared;
    const schedules = build?.schedules ?? [];
    const snapshot: GuidedDaySnapshot = {
        version: GUIDED_DAY_SNAPSHOT_VERSION,
        review: {
            prepared,
            diagnostics: loaded.diagnostics,
            dateRange: loaded.dateRange,
            cycleExclusions: input.cycleExclusions,
            selectedDirection: input.selectedDirection,
        },
        build: build
            ? {
                preOptimization: build.preOptimization,
                lastOptimizedIsCurrent: build.lastOptimized !== null && build.lastOptimized === build.schedules,
                editCount: build.editCount,
                stage: build.stage,
                routeConnectionConfig: build.routeConnectionConfig,
                headwayTargets: build.headwayTargets ?? {},
            }
            : null,
        package: {
            draftId: pkg.draftId,
            draftSourceIsCurrent: pkg.draftSource !== null && pkg.draftSource === schedules,
            hasDraftSource: pkg.draftSource !== null,
            published: pkg.published,
        },
    };

    return {
        id: guidedDayProjectId(input.scheduleSetId, input.dayType),
        name: `Route ${loaded.prepared.routeNumber} ${input.dayType} (guided)`,
        dayType: input.dayType,
        importMode: 'performance',
        autofillFromMaster: build?.autofillFromMaster ?? true,
        performanceConfig: { routeId: loaded.prepared.routeNumber, dateRange: loaded.dateRange },
        routeNumber: loaded.prepared.routeNumber,
        wizardStep: input.step,
        parsedData: model.parsedData,
        analysis: model.analysis,
        bands: model.bands,
        approvedRuntimeContract: input.contract ?? undefined,
        config: build?.config,
        generatedSchedules: schedules,
        originalGeneratedSchedules: build?.generated ?? [],
        generatedScheduleInputFingerprint: build?.fingerprint ?? undefined,
        isGenerated: schedules.length > 0,
        scheduleSetId: input.scheduleSetId,
        guidedSet: input.set,
        guidedDay: snapshot,
    };
};

/**
 * Rebuilds one day type from its saved project. The runtime model is
 * recomputed from the saved runtimes, then the planner's edited analysis is
 * laid over it; the approval check later confirms the approval still holds.
 * Returns null when the project is not a restorable guided day.
 */
export const restoreGuidedDay = (project: NewScheduleProject): RestoredGuidedDay | null => {
    const snapshot = project.guidedDay;
    if (!snapshot || snapshot.version !== GUIDED_DAY_SNAPSHOT_VERSION) return null;
    if (!isGuidedDayType(project.dayType)) return null;
    const parsedData = project.parsedData ?? [];
    if (parsedData.length === 0) return null;

    const prepared = { ...snapshot.review.prepared, results: parsedData };
    const baseModel = buildRuntimeReviewModel(parsedData, prepared.displayResults);
    const model: RuntimeReviewModel = project.analysis && project.analysis.length > 0
        ? { ...baseModel, analysis: project.analysis, bands: project.bands ?? baseModel.bands }
        : baseModel;
    const contract = isStructurallyValidRuntimeTrustContract(project.approvedRuntimeContract)
        ? project.approvedRuntimeContract as ApprovedRuntimeContract
        : null;

    const schedules = project.generatedSchedules ?? [];
    const savedBuild = snapshot.build;
    const build: GuidedBuildState | null = savedBuild && project.config
        ? {
            config: project.config,
            autofillFromMaster: project.autofillFromMaster ?? true,
            schedules,
            generated: project.originalGeneratedSchedules ?? [],
            fingerprint: project.generatedScheduleInputFingerprint ?? null,
            preOptimization: savedBuild.preOptimization,
            // Re-link by reference so "continue the previous optimizer run" still works.
            lastOptimized: savedBuild.lastOptimizedIsCurrent && schedules.length > 0 ? schedules : null,
            editorSessionKey: 0,
            editCount: savedBuild.editCount,
            stage: savedBuild.stage,
            routeConnectionConfig: savedBuild.routeConnectionConfig,
            headwayTargets: savedBuild.headwayTargets ?? {},
        }
        : null;

    const savedPackage = snapshot.package;
    const pkg: GuidedPackageEntry = {
        draftId: savedPackage.draftId,
        // A fresh array never equals the schedule, so an older draft stays "out of date".
        draftSource: savedPackage.draftSourceIsCurrent && build
            ? build.schedules
            : savedPackage.hasDraftSource ? [] : null,
        published: savedPackage.published,
    };

    return {
        dayType: project.dayType,
        step: toGuidedStep(project.wizardStep),
        revision: project.projectRevision ?? 0,
        set: project.guidedSet ?? null,
        review: {
            loaded: {
                prepared,
                model: baseModel,
                diagnostics: snapshot.review.diagnostics,
                dayType: project.dayType,
                dateRange: snapshot.review.dateRange,
            },
            model,
            cycleExclusions: snapshot.review.cycleExclusions ?? {},
            selectedDirection: snapshot.review.selectedDirection ?? model.initialCycleStartDirection,
            contract,
        },
        build,
        pkg,
    };
};

/** Groups listed projects into guided sets, newest first. Projects without a set id are ignored. */
export const summarizeGuidedSets = (projects: NewScheduleProject[]): GuidedSetSummary[] => {
    const sets = new Map<string, GuidedSetSummary>();
    projects.forEach(project => {
        const setId = project.scheduleSetId;
        if (!setId || !isGuidedDayType(project.dayType)) return;
        const existing = sets.get(setId);
        const updatedAt = project.updatedAt instanceof Date ? project.updatedAt : new Date(0);
        if (!existing) {
            sets.set(setId, {
                scheduleSetId: setId,
                routeNumber: project.routeNumber ?? project.performanceConfig?.routeId ?? '',
                dayTypes: [project.dayType],
                dateRange: project.performanceConfig?.dateRange ?? null,
                step: project.wizardStep ?? 1,
                updatedAt,
                projectIds: [project.id],
            });
            return;
        }
        existing.dayTypes = GUIDED_DAY_TYPES.filter(dayType => dayType === project.dayType || existing.dayTypes.includes(dayType));
        existing.step = Math.max(existing.step, project.wizardStep ?? 1);
        if (updatedAt > existing.updatedAt) existing.updatedAt = updatedAt;
        existing.projectIds.push(project.id);
    });
    return [...sets.values()].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
};
