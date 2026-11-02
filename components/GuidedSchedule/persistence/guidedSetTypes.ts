import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { RouteConnectionConfig } from '../../../utils/connections/connectionTypes';
import type { GuidedSelection } from '../guidedSelection';
import type { GuidedBuildStage } from '../build/guidedBuildState';
import type { GuidedPublishedVersion } from '../package/guidedPackageState';
import type { PreparedRuntimeReview } from '../runtimeReview/prepareRuntimeReview';
import type { CycleStartDirection, GuidedDateRange, GuidedDayType } from '../runtimeReview/guidedRuntimeReviewTypes';

export const GUIDED_DAY_SNAPSHOT_VERSION = 1;

export interface GuidedSkippedDayType {
    dayType: GuidedDayType;
    reason: string;
}

/** Small set-level fields, stored in Firestore on every day-type project of the set. */
export interface GuidedSetMetadata {
    selection: GuidedSelection;
    skippedDayTypes: GuidedSkippedDayType[];
}

/**
 * Guided-only state for one day type, stored in the project's Storage blob.
 * Schedule-driving runtimes travel in the project's `parsedData`, the edited
 * primary analysis in `analysis`/`bands`, and the approval in
 * `approvedRuntimeContract`; this snapshot holds everything else.
 */
export interface GuidedDaySnapshot {
    version: typeof GUIDED_DAY_SNAPSHOT_VERSION;
    review: {
        prepared: Omit<PreparedRuntimeReview, 'results'>;
        diagnostics: PerformanceRuntimeDiagnostics | null;
        dateRange: GuidedDateRange | null;
        cycleExclusions: Partial<Record<CycleStartDirection, string[]>>;
        selectedDirection: CycleStartDirection;
    };
    build: {
        preOptimization: MasterRouteTable[] | null;
        /** True when the current schedule is the optimizer's last output (no edits since). */
        lastOptimizedIsCurrent: boolean;
        editCount: number;
        stage: GuidedBuildStage;
        routeConnectionConfig: RouteConnectionConfig | null;
        /** Optional: saves made before Step 4 target headways have none. */
        headwayTargets?: Record<string, number>;
    } | null;
    package: {
        draftId: string | null;
        /** True when the draft was opened from the current schedule. */
        draftSourceIsCurrent: boolean;
        /** True when the editor was opened but the draft is from an older schedule. */
        hasDraftSource: boolean;
        published: GuidedPublishedVersion | null;
    };
}
