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
    approvalState: _approvalState,
    hasReviewResult: _hasReviewResult,
}: Step2NavigationGateInput): Step2GatedWizardStep => {
    return requestedStep;
};

export const isStep2NavigationBlocked = (
    _input: Step2NavigationGateInput
): boolean => false;
