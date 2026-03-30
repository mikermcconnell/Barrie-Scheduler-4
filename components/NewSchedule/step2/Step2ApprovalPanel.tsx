import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Step2ApprovalState, Step2ReviewHealth } from '../utils/step2ReviewTypes';

interface Step2ApprovalPanelProps {
    approvalState: Step2ApprovalState;
    healthReport: Step2ReviewHealth;
    approvedAtLabel: string | null;
    approvalRequiresAcknowledgement: boolean;
    resolvedWarningAcknowledged: boolean;
    onResolvedWarningAcknowledgedChange: (value: boolean) => void;
    approvalWarningList: string[];
    approvalActionDisabled: boolean;
    onApproveRuntimeContract?: (acknowledgedWarnings: string[]) => void;
    showAction?: boolean;
}

export const Step2ApprovalPanel: React.FC<Step2ApprovalPanelProps> = ({
    approvalState,
    healthReport,
    approvedAtLabel,
    approvalRequiresAcknowledgement,
    resolvedWarningAcknowledged,
    onResolvedWarningAcknowledgedChange,
    approvalWarningList,
    approvalActionDisabled,
    onApproveRuntimeContract,
    showAction = true,
}) => (
    <div
        data-testid="step2-approval-panel"
        className={`rounded-xl border shadow-sm overflow-hidden ${
            approvalState === 'approved'
                ? 'border-emerald-200 bg-emerald-50/70'
                : healthReport.status === 'blocked'
                    ? 'border-red-200 bg-red-50/70'
                    : healthReport.status === 'warning'
                        ? 'border-amber-200 bg-amber-50/70'
                        : 'border-blue-200 bg-blue-50/70'
        }`}
    >
        <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    {approvalState === 'approved' ? (
                        <CheckCircle2 className="text-emerald-600" size={18} />
                    ) : healthReport.status === 'blocked' ? (
                        <AlertTriangle className="text-red-600" size={18} />
                    ) : healthReport.status === 'warning' ? (
                        <AlertTriangle className="text-amber-600" size={18} />
                    ) : (
                        <CheckCircle2 className="text-blue-600" size={18} />
                    )}
                    <h3 className="font-bold text-gray-900">Step 2 approval</h3>
                    <span
                        data-testid="step2-approval-state"
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                            approvalState === 'approved'
                                ? 'bg-emerald-100 text-emerald-700'
                                : approvalState === 'stale'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-gray-100 text-gray-700'
                        }`}
                    >
                        {approvalState}
                    </span>
                </div>
                <p className="text-sm text-gray-700">
                    {approvalState === 'approved'
                        ? 'This runtime review is approved and can be used to continue into schedule building.'
                        : approvalState === 'stale'
                            ? 'The previous approval is no longer current because the Step 2 review changed. Re-approve this runtime model before continuing.'
                            : healthReport.status === 'blocked'
                                ? 'This review cannot be approved yet. Resolve the blockers in Data Health first.'
                                : healthReport.status === 'warning'
                                    ? 'This review can be approved, but the warnings must be acknowledged first.'
                                    : 'Approve this reviewed runtime model to lock it in for downstream schedule building.'}
                </p>
                {approvedAtLabel && approvalState === 'approved' && (
                    <p className="text-xs font-medium text-emerald-800">
                        Approved {approvedAtLabel}
                    </p>
                )}
                {approvalRequiresAcknowledgement && (
                    <label className="mt-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-sm text-amber-900">
                        <input
                            data-testid="step2-approval-warning-toggle"
                            type="checkbox"
                            className="mt-1"
                            checked={resolvedWarningAcknowledged}
                            onChange={(event) => onResolvedWarningAcknowledgedChange(event.target.checked)}
                        />
                        <span>
                            I understand the current warnings and want to use this runtime model for schedule building.
                        </span>
                    </label>
                )}
            </div>
            {showAction && onApproveRuntimeContract ? (
                <div className="flex flex-col items-start gap-2 md:items-end">
                    <button
                        type="button"
                        data-testid="step2-approval-action"
                        disabled={approvalActionDisabled}
                        onClick={() => onApproveRuntimeContract(approvalWarningList)}
                        className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                            approvalActionDisabled
                                ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                                : 'bg-brand-blue text-white hover:brightness-110'
                        }`}
                    >
                        {approvalState === 'approved'
                            ? 'Approved'
                            : approvalState === 'stale'
                                ? 'Re-approve runtime model'
                                : approvalRequiresAcknowledgement
                                    ? 'Acknowledge warnings and approve'
                                    : 'Approve runtime model'}
                    </button>
                    {healthReport.status === 'blocked' && (
                        <p className="text-xs text-red-700">
                            Approval is blocked until Step 2 blockers are cleared.
                        </p>
                    )}
                </div>
            ) : (
                <div className="text-xs text-gray-600 md:text-right">
                    Use the footer to approve this runtime model and continue to Step 3.
                </div>
            )}
        </div>
    </div>
);
