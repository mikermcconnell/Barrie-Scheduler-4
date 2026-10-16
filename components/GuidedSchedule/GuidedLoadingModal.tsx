import React from 'react';
import { Loader2 } from 'lucide-react';
import type { PerformanceDataLoadProgress } from '../../utils/performanceDataTypes';

interface GuidedLoadingModalProps {
    title: string;
    message: string;
    progress?: PerformanceDataLoadProgress | null;
}

export const describeLoadProgress = (progress: PerformanceDataLoadProgress | null | undefined): string | null => {
    if (!progress || progress.totalUnits <= 0) return null;
    const unit = progress.unitLabel === 'monthly-file' ? 'monthly file' : 'file';
    const verb = progress.phase === 'processing' ? 'Processing' : 'Downloading';
    return `${verb} ${Math.min(progress.completedUnits, progress.totalUnits)} of ${progress.totalUnits} ${unit}${progress.totalUnits === 1 ? '' : 's'}`;
};

/** Blocking loading modal so a disabled button never looks like a broken one. */
export const GuidedLoadingModal: React.FC<GuidedLoadingModalProps> = ({ title, message, progress }) => {
    const progressLabel = describeLoadProgress(progress);
    const percent = progress && progress.totalUnits > 0
        ? Math.round((100 * Math.min(progress.completedUnits, progress.totalUnits)) / progress.totalUnits)
        : null;

    return (
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/35 px-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-busy="true"
            aria-labelledby="guided-loading-title"
        >
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
                <Loader2 size={28} className="mx-auto animate-spin text-brand-blue" />
                <h3 id="guided-loading-title" className="mt-3 text-lg font-bold text-gray-900">{title}</h3>
                <p className="mt-1 text-sm text-gray-500">{message}</p>
                {percent !== null && (
                    <div className="mt-4">
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-brand-blue transition-all" style={{ width: `${percent}%` }} />
                        </div>
                        <p className="mt-1.5 text-xs text-gray-500">{progressLabel}</p>
                    </div>
                )}
            </div>
        </div>
    );
};
