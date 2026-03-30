import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Step2ApprovalState, Step2ReadinessStatus } from '../utils/step2ReviewTypes';

export interface Step2ApprovalFooterProps {
    approvalState: Step2ApprovalState;
    readinessStatus: Step2ReadinessStatus;
    primaryActionVariant: 'approve' | 'continue';
    approvalRequiresAcknowledgement?: boolean;
    warningAcknowledged?: boolean;
    approvedAtLabel?: string | null;
    statusLabel?: string;
    statusMessage?: string;
    blockedMessage?: string;
    warningMessage?: string;
    approvedMessage?: string;
    staleMessage?: string;
    approvalActionDisabled?: boolean;
    continueActionDisabled?: boolean;
    onApproveRuntimeContract?: () => void;
    onContinueToStep3?: () => void;
}

const getStatusToneClasses = (
    approvalState: Step2ApprovalState,
    readinessStatus: Step2ReadinessStatus
): string => {
    if (approvalState === 'approved') return 'border-emerald-200 bg-emerald-50/80';
    if (approvalState === 'stale') return 'border-amber-200 bg-amber-50/80';
    if (readinessStatus === 'blocked') return 'border-red-200 bg-red-50/80';
    if (readinessStatus === 'warning') return 'border-amber-200 bg-amber-50/80';
    return 'border-blue-200 bg-blue-50/80';
};

const getStatusIcon = (
    approvalState: Step2ApprovalState,
    readinessStatus: Step2ReadinessStatus
): React.ReactNode => {
    if (approvalState === 'approved') {
        return <CheckCircle2 className="text-emerald-600" size={18} />;
    }

    if (approvalState === 'stale' || readinessStatus === 'warning') {
        return <AlertTriangle className="text-amber-600" size={18} />;
    }

    if (readinessStatus === 'blocked') {
        return <AlertTriangle className="text-red-600" size={18} />;
    }

    return <CheckCircle2 className="text-blue-600" size={18} />;
};

const getStatusMessage = (
    approvalState: Step2ApprovalState,
    readinessStatus: Step2ReadinessStatus,
    props: Pick<
        Step2ApprovalFooterProps,
        'blockedMessage' | 'warningMessage' | 'approvedMessage' | 'staleMessage' | 'statusMessage' | 'approvalRequiresAcknowledgement' | 'warningAcknowledged'
    >
): string => {
    if (props.statusMessage?.trim()) return props.statusMessage.trim();

    if (approvalState === 'approved') {
        return props.approvedMessage?.trim()
            || 'This runtime review is approved and can be used for the next wizard step.';
    }

    if (approvalState === 'stale') {
        return props.staleMessage?.trim()
            || 'The previous approval is no longer current. Re-approve this runtime model before continuing.';
    }

    if (readinessStatus === 'blocked') {
        return props.blockedMessage?.trim()
            || 'This review cannot be approved yet. Resolve the blockers first.';
    }

    if (readinessStatus === 'warning') {
        if (props.approvalRequiresAcknowledgement && !props.warningAcknowledged) {
            return props.warningMessage?.trim()
                || 'This review can be approved, but the warnings must be acknowledged first.';
        }

        return props.warningMessage?.trim()
            || 'This review is usable, but it still has warnings that should be reviewed before continuing.';
    }

    return 'Review the runtime model before continuing to schedule building.';
};

const getPrimaryActionLabel = (
    approvalState: Step2ApprovalState,
    readinessStatus: Step2ReadinessStatus,
    primaryActionVariant: 'approve' | 'continue',
    approvalRequiresAcknowledgement?: boolean,
    warningAcknowledged?: boolean
): string => {
    if (primaryActionVariant === 'continue') {
        return 'Continue to Step 3';
    }

    if (approvalState === 'approved') return 'Approved';
    if (approvalState === 'stale') return 'Re-approve runtime model';
    if (readinessStatus === 'blocked') return 'Approve runtime model';
    if (approvalRequiresAcknowledgement && !warningAcknowledged) {
        return 'Acknowledge warnings and approve';
    }

    return 'Approve runtime model';
};

export const Step2ApprovalFooter: React.FC<Step2ApprovalFooterProps> = ({
    approvalState,
    readinessStatus,
    primaryActionVariant,
    approvalRequiresAcknowledgement = false,
    warningAcknowledged = false,
    approvedAtLabel,
    statusLabel,
    statusMessage,
    blockedMessage,
    warningMessage,
    approvedMessage,
    staleMessage,
    approvalActionDisabled = false,
    continueActionDisabled = false,
    onApproveRuntimeContract,
    onContinueToStep3,
}) => {
    const primaryLabel = getPrimaryActionLabel(
        approvalState,
        readinessStatus,
        primaryActionVariant,
        approvalRequiresAcknowledgement,
        warningAcknowledged
    );

    const primaryDisabled = primaryActionVariant === 'continue'
        ? continueActionDisabled || approvalState !== 'approved' || readinessStatus === 'blocked'
        : approvalActionDisabled
            || readinessStatus === 'blocked'
            || (approvalRequiresAcknowledgement && !warningAcknowledged)
            || approvalState === 'approved' && !onApproveRuntimeContract;

    const handlePrimaryAction = () => {
        if (primaryDisabled) return;

        if (primaryActionVariant === 'continue') {
            onContinueToStep3?.();
            return;
        }

        onApproveRuntimeContract?.();
    };

    const resolvedStatusLabel = statusLabel?.trim()
        || (approvalState === 'approved'
            ? 'Approved'
            : approvalState === 'stale'
                ? 'Stale'
                : readinessStatus);

    const resolvedMessage = getStatusMessage(approvalState, readinessStatus, {
        blockedMessage,
        warningMessage,
        approvedMessage,
        staleMessage,
        statusMessage,
        approvalRequiresAcknowledgement,
        warningAcknowledged,
    });

    return (
        <div
            data-testid="step2-approval-footer"
            className={`rounded-xl border shadow-sm overflow-hidden ${getStatusToneClasses(approvalState, readinessStatus)}`}
        >
            <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        {getStatusIcon(approvalState, readinessStatus)}
                        <h3 className="font-bold text-gray-900">Step 2 approval</h3>
                        <span
                            data-testid="step2-approval-footer-status"
                            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                                approvalState === 'approved'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : approvalState === 'stale'
                                        ? 'bg-amber-100 text-amber-700'
                                        : readinessStatus === 'blocked'
                                            ? 'bg-red-100 text-red-700'
                                            : readinessStatus === 'warning'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-blue-100 text-blue-700'
                            }`}
                        >
                            {resolvedStatusLabel}
                        </span>
                    </div>
                    <p
                        data-testid="step2-approval-footer-message"
                        className="text-sm text-gray-700"
                    >
                        {resolvedMessage}
                    </p>
                    {approvedAtLabel && approvalState === 'approved' && (
                        <p className="text-xs font-medium text-emerald-800">
                            Approved {approvedAtLabel}
                        </p>
                    )}
                    {primaryActionVariant === 'approve' && approvalRequiresAcknowledgement && !warningAcknowledged && (
                        <p className="text-xs font-medium text-amber-800">
                            Acknowledgement is required before approving this runtime model.
                        </p>
                    )}
                </div>

                <div className="flex flex-col items-start gap-2 md:items-end">
                    <button
                        type="button"
                        data-testid="step2-approval-footer-primary"
                        disabled={primaryDisabled}
                        onClick={handlePrimaryAction}
                        className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                            primaryDisabled
                                ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                                : primaryActionVariant === 'continue'
                                    ? 'bg-brand-blue text-white hover:brightness-110'
                                    : 'bg-brand-blue text-white hover:brightness-110'
                        }`}
                    >
                        {primaryLabel}
                    </button>
                    {primaryActionVariant === 'continue' && approvalState !== 'approved' && (
                        <p className="text-xs text-gray-600">
                            Approval must be current before continuing to the next step.
                        </p>
                    )}
                    {primaryActionVariant === 'approve' && readinessStatus === 'blocked' && (
                        <p className="text-xs text-red-700">
                            Approval is blocked until the Step 2 issues are resolved.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

