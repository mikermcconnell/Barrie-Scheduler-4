import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PerformanceDataLoadProgress } from '../../utils/performanceDataTypes';
import { getPerformanceLoadEstimateMs } from '../../utils/performanceLoadTiming';

const LOAD_STATUS_DELAY_MS = 500;

interface PerformanceLoadStatusProps {
    isLoading: boolean;
    profileKey: string;
    requestKey?: string;
    label: string;
    description?: string;
    progress?: PerformanceDataLoadProgress | null;
    compact?: boolean;
}

interface ActiveLoadRun {
    requestKey: string;
    startedAt: number;
    now: number;
    visible: boolean;
    /** When completedUnits last increased, used to extrapolate without history. */
    lastUnitAt: number | null;
    lastUnitCount: number;
}

function formatRemainingTime(seconds: number): string {
    const rounded = seconds > 60
        ? Math.ceil(seconds / 10) * 10
        : seconds > 15
            ? Math.ceil(seconds / 5) * 5
            : seconds;
    if (rounded >= 60) {
        const minutes = Math.floor(rounded / 60);
        const remainder = rounded % 60;
        return `About ${minutes} min${remainder ? ` ${remainder} sec` : ''} remaining`;
    }
    return `About ${rounded} second${rounded === 1 ? '' : 's'} remaining`;
}

export const PerformanceLoadStatus: React.FC<PerformanceLoadStatusProps> = ({
    isLoading,
    profileKey,
    requestKey = profileKey,
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
        setRun({ requestKey, startedAt, now: startedAt, visible: false, lastUnitAt: null, lastUnitCount: 0 });
        const showTimer = window.setTimeout(() => {
            setRun(current => current?.requestKey === requestKey
                ? { ...current, visible: true, now: Date.now() }
                : current);
        }, LOAD_STATUS_DELAY_MS);
        const clock = window.setInterval(() => {
            setRun(current => current?.requestKey === requestKey
                ? { ...current, now: Date.now() }
                : current);
        }, 1000);

        return () => {
            window.clearTimeout(showTimer);
            window.clearInterval(clock);
        };
    }, [isLoading, requestKey]);

    const reportedUnits = progress?.completedUnits ?? 0;
    useEffect(() => {
        setRun(current => current?.requestKey === requestKey && reportedUnits > current.lastUnitCount
            ? { ...current, lastUnitAt: Date.now(), lastUnitCount: reportedUnits }
            : current);
    }, [reportedUnits, requestKey, run?.requestKey]);

    const estimate = useMemo(() => {
        if (!run || run.requestKey !== requestKey) return null;
        const elapsedMs = Math.max(0, run.now - run.startedAt);
        const completedUnits = progress?.completedUnits ?? 0;
        const totalUnits = progress?.totalUnits ?? 0;

        if (totalUnits > 0 && completedUnits >= totalUnits) {
            return { remainingSeconds: null, isOverrun: false, isProcessing: true, source: null };
        }

        // Prefer learned history: file requests run concurrently and vary in
        // size, so a completed-file rate is only a rough first-use fallback.
        const learnedDurationMs = getPerformanceLoadEstimateMs(profileKey);
        if (learnedDurationMs != null) {
            const remainingMs = learnedDurationMs - elapsedMs;
            return {
                remainingSeconds: remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : null,
                isOverrun: remainingMs <= 0,
                isProcessing: false,
                source: 'history' as const,
            };
        }

        if (run.lastUnitAt == null || run.lastUnitCount <= 0 || totalUnits <= run.lastUnitCount) return null;
        const msPerUnit = (run.lastUnitAt - run.startedAt) / run.lastUnitCount;
        if (msPerUnit <= 0) return null;
        const remainingMs = msPerUnit * (totalUnits - run.lastUnitCount) - (run.now - run.lastUnitAt);
        return {
            remainingSeconds: remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : null,
            isOverrun: remainingMs <= 0,
            isProcessing: false,
            source: 'progress' as const,
        };
    }, [profileKey, progress, requestKey, run]);

    if (!run?.visible || run.requestKey !== requestKey) return null;

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
            ? estimate.source === 'progress' ? 'Almost done…' : 'Taking longer than recent loads…'
            : estimate?.remainingSeconds
                ? formatRemainingTime(estimate.remainingSeconds)
                : 'Estimating time…';

    return (
        <div
            data-testid="performance-load-status"
            role="status"
            aria-live="polite"
            className={compact
                ? 'inline-flex min-w-0 items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900'
                : 'rounded-xl border border-cyan-300 border-l-4 border-l-cyan-600 bg-white px-4 py-4 shadow-md shadow-cyan-900/10'}
        >
            <span className="sr-only">Loading {label}. Please wait.</span>
            <div className={compact ? 'flex min-w-0 items-center gap-2' : 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5'}>
                <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden="true" className={compact ? 'contents' : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-100'}>
                        <Loader2 className="shrink-0 animate-spin text-cyan-700" size={compact ? 14 : 19} />
                    </span>
                    <div className="min-w-0">
                        <div className={compact ? 'font-semibold' : 'text-sm font-bold text-gray-900'}>Loading {label}</div>
                        <div className={compact ? 'text-cyan-800' : 'mt-1 text-sm font-medium text-cyan-900'}>{progressLabel}</div>
                        {description && !compact && (
                            <div className="mt-1 text-xs text-gray-600">{description}</div>
                        )}
                    </div>
                </div>
                <div aria-live="off" className={compact
                    ? 'font-bold text-cyan-900'
                    : 'shrink-0 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2.5 sm:min-w-48'}>
                    {!compact && <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-700">Estimated time left</div>}
                    <div className={compact ? '' : 'mt-0.5 text-base font-bold tabular-nums text-cyan-950'}>{estimateLabel}</div>
                    {!compact && estimate?.remainingSeconds && (
                        <div className="mt-0.5 text-[11px] text-cyan-700">
                            {estimate.source === 'progress' ? 'Based on files loaded so far' : 'Based on recent loads'}
                        </div>
                    )}
                </div>
            </div>
            {hasDeterminateProgress && !compact && (
                <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-cyan-100">
                    <div
                        className="h-full rounded-full bg-cyan-600 transition-[width] duration-300"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            )}
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
