/**
 * ResumeWizardModal
 * 
 * Prompt shown when wizard opens with saved progress.
 * Offers "Resume" or "Start Fresh" options.
 */

import React from 'react';
import { Clock, RotateCcw, Plus, X } from 'lucide-react';
import type { WizardProgress } from '../../hooks/useWizardProgress';

interface Props {
    isOpen: boolean;
    progress: WizardProgress | null;
    onResume: () => void;
    onStartFresh: () => void;
    onClose: () => void;
}

export const ResumeWizardModal: React.FC<Props> = ({
    isOpen,
    progress,
    onResume,
    onStartFresh,
    onClose
}) => {
    if (!isOpen || !progress) return null;

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

    const stepLabels = {
        1: 'Upload Data',
        2: 'Runtime Analysis',
        3: 'Build Schedule'
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold">Resume Progress?</h2>
                            {progress.projectName && (
                                <p className="text-sm text-emerald-50/90 mt-0.5">{progress.projectName}</p>
                            )}
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white/70 hover:text-white p-1 rounded transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-gray-600 mb-4">
                        You have unsaved wizard progress. Would you like to continue where you left off?
                    </p>

                    {/* Progress Summary */}
                    <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-100">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Clock size={20} className="text-emerald-600" />
                            </div>
                            <div>
                                <div className="font-bold text-gray-900">
                                    Step {progress.step}: {stepLabels[progress.step]}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {formatDate(progress.updatedAt)}
                                </div>
                            </div>
                        </div>

                        <div className="text-sm text-gray-600 space-y-1">
                            <div>• Day Type: <strong>{progress.dayType}</strong></div>
                            {progress.fileNames.length > 0 && (
                                <div>• {progress.fileNames.length} file(s) uploaded</div>
                            )}
                            {progress.config?.routeNumber && (
                                <div>• Route: <strong>{progress.config.routeNumber}</strong></div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            onClick={onStartFresh}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition-colors"
                        >
                            <Plus size={18} />
                            Start Fresh
                        </button>
                        <button
                            onClick={onResume}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/25"
                        >
                            <RotateCcw size={18} />
                            Resume
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ResumeWizardModal;
