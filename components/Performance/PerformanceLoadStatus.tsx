import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PerformanceDataLoadProgress } from '../../utils/performanceDataTypes';
import { getPerformanceLoadEstimateMs } from '../../utils/performanceLoadTiming';

const LOAD_STATUS_DELAY_MS = 500;

interface PerformanceLoadStatusProps {
    isLoading: boolean;
    profileKey: string;
    label: string;
    description?: string;
    progress?: PerformanceDataLoadProgress | null;
    compact?: boolean;
}

interface ActiveLoadRun {
    profileKey: string;
    startedAt: number;
    now: number;
    visible: boolean;
}

function formatRemainingTime(seconds: number): string {
    return `About ${seconds} second${seconds === 1 ? '' : 's'} remaining`;
}

export const PerformanceLoadStatus: React.FC<PerformanceLoadStatusProps> = ({
    isLoading,
    profileKey,
    label,
    description,
    progress,
    compact = false,
}) => {
    const [run, setRun] = useState<ActiveLoadRun | null>(null);

    useEffect(() => {
        if (!isLoading) {
            setRun(null);
            return;
        }

        const startedAt = Date.now();
        setRun({ profileKey, startedAt, now: startedAt, visible: false });
        const showTimer = window.setTimeout(() => {
            setRun(current => current?.profileKey === profileKey
                ? { ...current, visible: true, now: Date.now() }
                : current);
        }, LOAD_STATUS_DELAY_MS);
        const clock = window.setInterval(() => {
            setRun(current => current?.profileKey === profileKey
                ? { ...current, now: Date.now() }
                : current);
        }, 1000);

        return () => {
            window.clearTimeout(showTimer);
            window.clearInterval(clock);
        };
    }, [isLoading, profileKey]);

    const estimate = useMemo(() => {
        if (!run || run.profileKey !== profileKey) return null;
        const elapsedMs = Math.max(0, run.now - run.startedAt);
        const completedUnits = progress?.completedUnits ?? 0;
        const totalUnits = progress?.totalUnits ?? 0;

        if (totalUnits > 0 && completedUnits >= totalUnits) {
            return { remainingSeconds: null, isOverrun: false, isProcessing: true };
        }

        if (completedUnits > 0 && totalUnits > completedUnits) {
            const remainingMs = (elapsedMs / completedUnits) * (totalUnits - completedUnits);
            return {
                remainingSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
                isOverrun: false,
                isProcessing: false,
            };
        }

        const learnedDurationMs = getPerformanceLoadEstimateMs(profileKey);
        if (learnedDurationMs == null) return null;
        const remainingMs = learnedDurationMs - elapsedMs;
        return {
            remainingSeconds: remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : null,
            isOverrun: remainingMs <= 0,
            isProcessing: false,
        };
    }, [profileKey, progress, run]);

    if (!run?.visible || run.profileKey !== profileKey) return null;

    const totalUnits = progress?.totalUnits ?? 0;
    const completedUnits = Math.min(progress?.completedUnits ?? 0, totalUnits);
    const hasDeterminateProgress = totalUnits > 1;
    const progressPercent = hasDeterminateProgress
        ? Math.round((completedUnits / totalUnits) * 100)
        : 0;
    const progressLabel = progress?.phase === 'processing' || (totalUnits > 0 && completedUnits >= totalUnits)
        ? 'Preparing dashboard'
        : progress?.unitLabel === 'monthly-file' && totalUnits > 1
            ? `${completedUnits} of ${totalUnits} monthly files`
            : 'Downloading dashboard data';
    const estimateLabel = estimate?.isProcessing
        ? 'Preparing the requested view'
        : estimate?.isOverrun
            ? 'Taking longer than usual…'
            : estimate?.remainingSeconds
                ? formatRemainingTime(estimate.remainingSeconds)
                : 'Estimating time…';

    return (
        <div
            data-testid="performance-load-status"
            role="status"
            aria-live="polite"
            className={compact
                ? 'inline-flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600'
                : 'rounded-xl border border-cyan-200 bg-cyan-50/70 px-4 py-3 text-sm text-cyan-900'}
        >
            <span className="sr-only">Loading {label}. Please wait.</span>
            <div aria-hidden="true" className={compact ? 'contents' : 'flex items-start gap-3'}>
                <Loader2 className="shrink-0 animate-spin text-cyan-600" size={compact ? 14 : 17} />
                <div className={compact ? 'min-w-0' : 'min-w-0 flex-1'}>
                    <div className="font-semibold">Loading {label}</div>
                    <div className={compact ? 'text-gray-500' : 'mt-0.5 text-cyan-800'}>
                        {progressLabel} · {estimateLabel}
                    </div>
                    {description && !compact && (
                        <div className="mt-1 text-xs text-cyan-700">{description}</div>
                    )}
                    {hasDeterminateProgress && !compact && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-100">
                            <div
                                className="h-full rounded-full bg-cyan-500 transition-[width] duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>
            {hasDeterminateProgress && (
                <div
                    className="sr-only"
                    role="progressbar"
                    aria-label={`Loading ${label}`}
                    aria-valuemin={0}
                    aria-valuemax={totalUnits}
                    aria-valuenow={completedUnits}
                />
            )}
        </div>
    );
};
