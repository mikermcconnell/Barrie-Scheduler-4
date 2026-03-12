import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ScheduleConfig } from '../steps/Step3Build';
import type { ImportMode, PerformanceConfig } from '../steps/Step1Upload';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';

export interface WizardProgressLike {
    step: 1 | 2 | 3 | 4;
    fileNames: string[];
    importMode?: ImportMode;
    performanceConfig?: {
        routeId: string;
        dateRange: { start: string; end: string } | null;
    };
}

export interface WizardProjectLike {
    isGenerated?: boolean;
    generatedSchedules?: MasterRouteTable[];
    config?: ScheduleConfig;
    analysis?: TripBucketAnalysis[];
    parsedData?: RuntimeData[];
}

export const createDefaultPerformanceConfig = (): PerformanceConfig => ({
    routeId: '',
    dateRange: null,
});

export const createDefaultScheduleConfig = (): ScheduleConfig => ({
    routeNumber: '10',
    cycleTime: 60,
    recoveryRatio: 15,
    blocks: [],
});

export const buildSegmentsMapFromParsedData = (
    results: RuntimeData[]
): Record<string, SegmentRawData[]> => {
    const groupedSegments: Record<string, SegmentRawData[]> = {};

    results.forEach((runtime) => {
        const direction = runtime.detectedDirection || 'North';
        if (!groupedSegments[direction]) {
            groupedSegments[direction] = [];
        }
        groupedSegments[direction].push(...runtime.segments);
    });

    return groupedSegments;
};

export const deriveWizardStepFromProject = (
    project: WizardProjectLike
): 1 | 2 | 3 | 4 => {
    if (project.isGenerated && project.generatedSchedules?.length) {
        return 4;
    }
    if (project.config?.blocks?.length) {
        return 3;
    }
    if (project.analysis?.length || project.parsedData?.length) {
        return 2;
    }
    return 1;
};

export const hasRestorableWizardProgress = (
    progress: WizardProgressLike | null
): boolean => {
    if (!progress) return false;

    // Step 1 CSV uploads cannot be resumed because File objects are not serializable.
    return progress.step > 1 || !!progress.performanceConfig?.routeId;
};

export const shouldShowNextStepAction = (
    step: number,
    importMode: ImportMode
): boolean => !(step === 4 || (step === 1 && importMode === 'gtfs'));
