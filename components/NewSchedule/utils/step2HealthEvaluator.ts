import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';
import type { TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from './csvParser';
import { buildStep2DataHealthReport, type OrderedSegmentColumn } from './wizardState';
import type { Step2ReviewHealth } from './step2ReviewTypes';
import type { Step2StopOrderHealth } from './step2StopOrder';

export interface Step2HealthEvaluatorInput {
    routeNumber?: string;
    analysis: TripBucketAnalysis[];
    segmentsMap: Record<string, SegmentRawData[]>;
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    performanceDiagnostics?: PerformanceRuntimeDiagnostics | null;
    stopOrder?: Step2StopOrderHealth | null;
}

const cloneValue = <T>(value: T): T => {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
};

export const evaluateStep2ReviewHealth = (
    input: Step2HealthEvaluatorInput
): Step2ReviewHealth => {
    const report = buildStep2DataHealthReport({
        routeNumber: input.routeNumber,
        analysis: input.analysis,
        segmentsMap: input.segmentsMap,
        canonicalSegmentColumns: input.canonicalSegmentColumns,
        performanceDiagnostics: input.performanceDiagnostics,
        stopOrder: input.stopOrder,
    });

    return cloneValue(report);
};
