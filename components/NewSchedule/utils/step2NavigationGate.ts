import type { Step2ApprovalState } from './step2ReviewTypes';

export type Step2GatedWizardStep = 1 | 2 | 3 | 4 | 5;

export interface Step2NavigationGateInput {
    requestedStep: Step2GatedWizardStep;
    approvalState: Step2ApprovalState;
    hasReviewResult: boolean;
    /** Required before the schedule editor or connection step can be opened. */
    hasCurrentGeneratedOutput?: boolean;
}

export const getBlockedStep2FallbackStep = (
    hasReviewResult: boolean
): 1 | 2 => (hasReviewResult ? 2 : 1);

export const resolveWizardStepWithStep2Gate = ({
    requestedStep,
    approvalState,
    hasReviewResult,
    hasCurrentGeneratedOutput = true,
}: Step2NavigationGateInput): Step2GatedWizardStep => {
    if (requestedStep <= 2) return requestedStep;
    if (approvalState !== 'approved') return getBlockedStep2FallbackStep(hasReviewResult);
    if (requestedStep >= 4 && !hasCurrentGeneratedOutput) return 3;
    return requestedStep;
};

export const isStep2NavigationBlocked = (input: Step2NavigationGateInput): boolean => (
    input.requestedStep > 2 && input.approvalState !== 'approved'
);
