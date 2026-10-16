import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { Step2ApprovalState, Step2ReadinessStatus } from '../NewSchedule/utils/step2ReviewTypes';
import type { GuidedApprovalBlocker } from './runtimeReview/guidedApproval';

export interface GuidedApprovalBarProps {
    readinessStatus: Step2ReadinessStatus;
    approvalState: Step2ApprovalState;
    warnings: string[];
    blockers: string[];
    warningsAcknowledged: boolean;
    onWarningsAcknowledgedChange: (value: boolean) => void;
    approvalBlocker: GuidedApprovalBlocker | null;
    approvedAt?: string;
    onApprove: () => void;
}

const formatTimestamp = (value?: string): string | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/**
 * Explicit Step 2 approval. The planner approves the runtime contract as a
 * separate action; a review with warnings needs the warnings acknowledged
 * first, and a blocked review cannot be approved.
 */
export const GuidedApprovalBar: React.FC<GuidedApprovalBarProps> = ({
    readinessStatus,
    approvalState,
    warnings,
    blockers,
    warningsAcknowledged,
    onWarningsAcknowledgedChange,
    approvalBlocker,
    approvedAt,
    onApprove,
}) => {
    if (approvalState === 'approved') {
        return (
            <div data-testid="guided-approval-bar" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                <div>
                    <b>Runtimes approved</b>
                    {formatTimestamp(approvedAt) && <span className="text-emerald-700"> · {formatTimestamp(approvedAt)}</span>}
                    <div className="text-xs text-emerald-700">Changing an exclusion makes this approval stale; you will need to approve again.</div>
                </div>
            </div>
        );
    }

    if (readinessStatus === 'blocked') {
        return (
            <div data-testid="guided-approval-bar" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <div className="flex items-center gap-2 font-bold"><AlertTriangle size={16} className="text-red-600" /> These runtimes cannot be approved yet</div>
                {blockers.length > 0 && (
                    <ul className="mt-1 list-disc pl-6 text-xs">{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
                )}
            </div>
        );
    }

    const needsAcknowledgement = warnings.length > 0;
    return (
        <div
            data-testid="guided-approval-bar"
            className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm md:flex-row md:items-center md:justify-between ${
                needsAcknowledgement ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-950'
            }`}
        >
            <div className="min-w-0">
                <div className="font-bold">
                    {approvalState === 'stale'
                        ? 'The earlier approval is out of date. Review and approve again.'
                        : needsAcknowledgement
                            ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''} need your decision before approval`
                            : 'Review the buckets above, then approve these runtimes.'}
                </div>
                {needsAcknowledgement && (
                    <>
                        <ul className="mt-1 list-disc pl-5 text-xs">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-bold">
                            <input
                                type="checkbox"
                                checked={warningsAcknowledged}
                                onChange={event => onWarningsAcknowledgedChange(event.target.checked)}
                            />
                            I have reviewed these warnings
                        </label>
                    </>
                )}
            </div>
            <button
                type="button"
                onClick={onApprove}
                disabled={approvalBlocker !== null}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <ShieldCheck size={16} /> Approve runtimes
            </button>
        </div>
    );
};
