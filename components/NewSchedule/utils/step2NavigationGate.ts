import type { Step2ApprovalState } from './step2ReviewTypes';

export type Step2GatedWizardStep = 1 | 2 | 3 | 4;

export interface Step2NavigationGateInput {
    requestedStep: Step2GatedWizardStep;
    approvalState: Step2ApprovalState;
    hasReviewResult: boolean;
}

export const getBlockedStep2FallbackStep = (
    hasReviewResult: boolean
): 1 | 2 => (hasReviewResult ? 2 : 1);

export const resolveWizardStepWithStep2Gate = ({
    requestedStep,
    approvalState,
    hasReviewResult,
}: Step2NavigationGateInput): Step2GatedWizardStep => {
    if (requestedStep <= 2) return requestedStep;
    if (approvalState === 'approved') return requestedStep;
    return getBlockedStep2FallbackStep(hasReviewResult);
};

export const isStep2NavigationBlocked = (
    input: Step2NavigationGateInput
): boolean => resolveWizardStepWithStep2Gate(input) !== input.requestedStep;
