import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';
import { buildStep2ReviewResult } from '../../NewSchedule/utils/step2ReviewBuilder';
import { resolveStep2ApprovalState } from '../../NewSchedule/utils/step2Invalidation';
import { buildStep2ApprovedRuntimeModelFromContract } from '../../NewSchedule/utils/step2ApprovedRuntimeModelAdapter';
import type { ApprovedRuntimeContract, Step2ApprovalState } from '../../NewSchedule/utils/step2ReviewTypes';
import {
    applyAnalysisUpdate,
    buildCycleAnalysisByStartDirection,
    buildGuidedReviewInput,
    buildPlannerOverrides,
    selectOrientationView,
} from './buildGuidedReviewInput';
import { approveGuidedReview, getApprovalBlocker, getApprovalWarnings } from './guidedApproval';
import type { PreparedRuntimeReview } from './prepareRuntimeReview';
import type {
    CycleStartDirection,
    GuidedDateRange,
    GuidedDayType,
    RuntimeReviewModel,
} from './guidedRuntimeReviewTypes';

export interface LoadedRuntimeReview {
    prepared: PreparedRuntimeReview;
    model: RuntimeReviewModel;
    diagnostics: PerformanceRuntimeDiagnostics | null;
    dayType: GuidedDayType;
    dateRange: GuidedDateRange | null;
}

export const useGuidedRuntimeReview = () => {
    const [loaded, setLoaded] = useState<LoadedRuntimeReview | null>(null);
    const [model, setModel] = useState<RuntimeReviewModel | null>(null);
    const [cycleExclusions, setCycleExclusions] = useState<Partial<Record<CycleStartDirection, string[]>>>({});
    const [selectedDirection, setSelectedDirection] = useState<CycleStartDirection>('North');
    const [contract, setContract] = useState<ApprovedRuntimeContract | null>(null);
    const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);

    const load = useCallback((next: LoadedRuntimeReview) => {
        setLoaded(next);
        setModel(next.model);
        setCycleExclusions({});
        setSelectedDirection(next.model.initialCycleStartDirection);
        setContract(null);
        setWarningsAcknowledged(false);
    }, []);

    const reset = useCallback(() => {
        setLoaded(null);
        setModel(null);
        setCycleExclusions({});
        setContract(null);
        setWarningsAcknowledged(false);
    }, []);

    const reviewInput = useMemo(() => (
        loaded && model
            ? buildGuidedReviewInput({
                prepared: loaded.prepared,
                model,
                cycleExclusions,
                dayType: loaded.dayType,
                dateRange: loaded.dateRange,
                diagnostics: loaded.diagnostics,
            })
            : null
    ), [cycleExclusions, loaded, model]);

    const reviewResult = useMemo(() => (reviewInput ? buildStep2ReviewResult(reviewInput) : null), [reviewInput]);

    const approvalState = useMemo<Step2ApprovalState>(() => (
        reviewResult ? resolveStep2ApprovalState(reviewResult, contract) : 'unapproved'
    ), [contract, reviewResult]);

    // A changed review needs a fresh acknowledgement; an approved one keeps it.
    const reviewFingerprint = reviewResult?.inputFingerprint;
    useEffect(() => {
        if (approvalState !== 'approved') setWarningsAcknowledged(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the reviewed inputs change
    }, [reviewFingerprint]);

    const cycleAnalysis = useMemo(() => (
        model ? buildCycleAnalysisByStartDirection(model, buildPlannerOverrides(model, cycleExclusions)) : undefined
    ), [cycleExclusions, model]);

    const orientationView = useMemo(() => (
        model ? selectOrientationView(model, cycleAnalysis, selectedDirection) : null
    ), [cycleAnalysis, model, selectedDirection]);

    // Fall back to an orientation that has buckets.
    useEffect(() => {
        if (!cycleAnalysis || cycleAnalysis[selectedDirection]?.length) return;
        const available = (['North', 'South'] as const).find(direction => (cycleAnalysis[direction]?.length ?? 0) > 0);
        if (available) setSelectedDirection(available);
    }, [cycleAnalysis, selectedDirection]);

    const updateAnalysis = useCallback((updated: TripBucketAnalysis[]) => {
        if (!model) return;
        const next = applyAnalysisUpdate(model, cycleExclusions, selectedDirection, updated);
        setModel(next.model);
        setCycleExclusions(next.cycleExclusions);
    }, [cycleExclusions, model, selectedDirection]);

    const approvalArgs = { reviewInput, reviewResult, approvalState, warningsAcknowledged };
    const approvalBlocker = getApprovalBlocker(approvalArgs);
    const approvalWarnings = getApprovalWarnings(reviewResult);

    const approve = useCallback((): boolean => {
        const created = approveGuidedReview({ reviewInput, reviewResult, approvalState, warningsAcknowledged });
        if (!created) return false;
        setContract(created);
        return true;
    }, [approvalState, reviewInput, reviewResult, warningsAcknowledged]);

    const currentContract = contract?.schemaVersion === 2 && approvalState === 'approved' ? contract : null;
    const approvedModel = useMemo(() => buildStep2ApprovedRuntimeModelFromContract(contract), [contract]);

    return {
        loaded,
        model,
        reviewInput,
        reviewResult,
        approvalState,
        contract,
        currentContract,
        approvedModel,
        cycleAnalysis,
        orientationView,
        selectedDirection,
        setSelectedDirection,
        updateAnalysis,
        warningsAcknowledged,
        setWarningsAcknowledged,
        approvalWarnings,
        approvalBlocker,
        approve,
        load,
        reset,
    };
};

export type GuidedRuntimeReview = ReturnType<typeof useGuidedRuntimeReview>;
