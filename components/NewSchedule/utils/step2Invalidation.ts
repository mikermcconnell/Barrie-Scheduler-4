import type {
    ApprovedRuntimeContract,
    Step2ApprovalState,
    Step2ReviewResult,
} from './step2ReviewTypes';

const hasMatchingFingerprint = (
    reviewResult: Step2ReviewResult,
    approvedContract: ApprovedRuntimeContract
): boolean => reviewResult.inputFingerprint === approvedContract.inputFingerprint;

export const isStep2ApprovalStale = (
    reviewResult: Step2ReviewResult,
    approvedContract: ApprovedRuntimeContract | null | undefined
): boolean => {
    if (!approvedContract) return false;
    if (approvedContract.schemaVersion !== 1) return true;
    if (approvedContract.approvalState !== 'approved') return true;
    if (reviewResult.lifecycle === 'stale' || reviewResult.lifecycle === 'error') return true;
    return !hasMatchingFingerprint(reviewResult, approvedContract);
};

export const isStep2ApprovalCurrent = (
    reviewResult: Step2ReviewResult,
    approvedContract: ApprovedRuntimeContract | null | undefined
): boolean => (
    !!approvedContract
    && !isStep2ApprovalStale(reviewResult, approvedContract)
    && reviewResult.lifecycle === 'reviewable'
);

export const resolveStep2ApprovalState = (
    reviewResult: Step2ReviewResult,
    approvedContract: ApprovedRuntimeContract | null | undefined
): Step2ApprovalState => {
    if (!approvedContract) return 'unapproved';
    return isStep2ApprovalCurrent(reviewResult, approvedContract) ? 'approved' : 'stale';
};

