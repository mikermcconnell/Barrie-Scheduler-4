import { buildStep2SourceSnapshot, type Step2ReviewBuilderInput } from '../../NewSchedule/utils/step2ReviewBuilder';
import { canCreateStep2Approval, createStep2ApprovedRuntimeContract } from '../../NewSchedule/utils/step2Approval';
import type {
    ApprovedRuntimeContract,
    Step2ApprovalState,
    Step2ReviewResult,
} from '../../NewSchedule/utils/step2ReviewTypes';

export interface GuidedApprovalArgs {
    reviewInput: Step2ReviewBuilderInput | null;
    reviewResult: Step2ReviewResult | null;
    approvalState: Step2ApprovalState;
    warningsAcknowledged: boolean;
}

/** Warnings the planner must acknowledge before approving. */
export const getApprovalWarnings = (reviewResult: Step2ReviewResult | null): string[] => (
    reviewResult?.health.status === 'warning' ? reviewResult.health.warnings : []
);

export type GuidedApprovalBlocker =
    | 'no-review'
    | 'blocked'
    | 'already-approved'
    | 'needs-acknowledgement'
    | 'contract-invalid';

/**
 * Explicit approval (guided workflow): the planner must press Approve, and a
 * review with warnings needs the warnings acknowledged first. Blocked reviews
 * can never be approved (LOCKED_LOGIC rule 7).
 */
export const getApprovalBlocker = (args: GuidedApprovalArgs): GuidedApprovalBlocker | null => {
    const { reviewInput, reviewResult } = args;
    if (!reviewInput || !reviewResult) return 'no-review';
    if (reviewResult.health.status === 'blocked') return 'blocked';
    if (args.approvalState === 'approved') return 'already-approved';
    const warnings = getApprovalWarnings(reviewResult);
    if (warnings.length > 0 && !args.warningsAcknowledged) return 'needs-acknowledgement';
    const valid = canCreateStep2Approval({
        reviewResult,
        sourceSnapshot: buildStep2SourceSnapshot(reviewInput),
        approvedAt: 'validation-only',
        acknowledgedWarnings: warnings,
    });
    return valid ? null : 'contract-invalid';
};

export const approveGuidedReview = (
    args: GuidedApprovalArgs,
    approvedAt: string = new Date().toISOString()
): ApprovedRuntimeContract | null => {
    if (getApprovalBlocker(args) !== null || !args.reviewInput || !args.reviewResult) return null;
    return createStep2ApprovedRuntimeContract({
        reviewResult: args.reviewResult,
        sourceSnapshot: buildStep2SourceSnapshot(args.reviewInput),
        approvedAt,
        acknowledgedWarnings: getApprovalWarnings(args.reviewResult),
    });
};
