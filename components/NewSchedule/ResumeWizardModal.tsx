/**
 * ResumeWizardModal
 *
 * Prompt shown when wizard opens with saved progress.
 * Offers "Resume" or "Start Fresh" options.
 */

import React, { useEffect, useState } from 'react';
import { Clock, RotateCcw, Plus, X, HardDrive, Cloud } from 'lucide-react';
import type { WizardProgress } from '../../hooks/useWizardProgress';

interface Props {
    isOpen: boolean;
    progress: WizardProgress | null;
    onResume: () => boolean | void | Promise<boolean | void>;
    onStartFresh: () => boolean | void | Promise<boolean | void>;
    onClose: () => void;
    isAuthenticated?: boolean;
}

export const ResumeWizardModal: React.FC<Props> = ({
    isOpen,
    progress,
    onResume,
    onStartFresh,
    onClose,
    isAuthenticated
}) => {
    const [pendingDecision, setPendingDecision] = useState<'resume' | 'fresh' | null>(null);
    const [decisionError, setDecisionError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setPendingDecision(null);
            setDecisionError(null);
        }
    }, [isOpen]);

    if (!isOpen || !progress) return null;

    const handleDecision = async (
        decision: 'resume' | 'fresh',
        action: () => boolean | void | Promise<boolean | void>
    ) => {
        setPendingDecision(decision);
        setDecisionError(null);
        try {
            const result = await action();
            if (result === false) {
                setDecisionError(
                    decision === 'resume'
                        ? 'This saved progress could not be restored. You can try again or start fresh.'
                        : 'The saved progress could not be cleared. Please try again.'
                );
            }
        } catch (error) {
            console.error(`Failed to ${decision === 'resume' ? 'resume' : 'clear'} wizard progress:`, error);
            setDecisionError(
                decision === 'resume'
                    ? 'This saved progress could not be restored. You can try again or start fresh.'
                    : 'The saved progress could not be cleared. Please try again.'
            );
        } finally {
            setPendingDecision(null);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    };

    const stepLabels: Record<number, string> = {
        1: 'Upload Data',
        2: 'Runtime Analysis',
        3: 'Build Schedule',
        4: 'Generated Schedule',
        5: 'Connections'
    };

    const hasGeneratedSchedules = progress.generatedSchedules && progress.generatedSchedules.length > 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="resume-wizard-title">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => !pendingDecision && onClose()}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 id="resume-wizard-title" className="text-lg font-bold">Resume Progress?</h2>
                            {progress.projectName && (
                                <p className="text-sm text-emerald-50/90 mt-0.5">{progress.projectName}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={pendingDecision !== null}
                            aria-label="Close resume prompt"
                            className="text-white/70 hover:text-white p-1 rounded transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-gray-600 mb-4">
                        You have locally saved wizard progress. Would you like to continue where you left off?
                    </p>

                    {/* Progress Summary */}
                    <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Clock size={20} className="text-emerald-600" />
                            </div>
                            <div>
                                <div className="font-bold text-gray-900">
                                    Step {progress.step}: {stepLabels[progress.step] || `Step ${progress.step}`}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {formatDate(progress.updatedAt)}
                                </div>
                            </div>
                        </div>

                        <div className="text-sm text-gray-600 space-y-1">
                            <div>Day Type: <strong>{progress.dayType}</strong></div>
                            {progress.fileNames.length > 0 && (
                                <div>{progress.fileNames.length} file(s) uploaded</div>
                            )}
                            {progress.config?.routeNumber && (
                                <div>Route: <strong>{progress.config.routeNumber}</strong></div>
                            )}
                            {hasGeneratedSchedules && (
                                <div>{progress.generatedSchedules!.length} schedule(s) generated</div>
                            )}
                        </div>
                    </div>

                    {/* Save Source Indicator */}
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 mb-6 text-xs text-gray-500">
                        <HardDrive size={14} className="text-gray-400 flex-shrink-0" />
                        <span>Saved to your browser</span>
                        {!isAuthenticated && (
                            <>
                                <span className="text-gray-300">|</span>
                                <Cloud size={14} className="text-gray-300 flex-shrink-0" />
                                <span className="text-gray-400">Sign in to save to cloud</span>
                            </>
                        )}
                    </div>

                    {decisionError && (
                        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {decisionError}
                        </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => handleDecision('fresh', onStartFresh)}
                            disabled={pendingDecision !== null}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {pendingDecision === 'fresh' ? <Clock size={18} className="animate-pulse" /> : <Plus size={18} />}
                            {pendingDecision === 'fresh' ? 'Clearing...' : 'Start Fresh'}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDecision('resume', onResume)}
                            disabled={pendingDecision !== null}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RotateCcw size={18} className={pendingDecision === 'resume' ? 'animate-spin' : ''} />
                            {pendingDecision === 'resume' ? 'Restoring...' : 'Resume'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ResumeWizardModal;
