import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle,
    Brain,
    Info,
    Loader2,
    Sparkles,
    X,
} from 'lucide-react';
import type {
    DeterministicFinding,
    ScheduleReviewAction,
    ScheduleReviewFinding,
    ScheduleReviewResponse,
    ScheduleReviewSnapshot,
} from '../../utils/ai/scheduleReviewTypes';
import {
    checkLocalAiHealth,
    runScheduleReview,
    type LocalAiHealth,
} from '../../utils/ai/scheduleReviewService';

interface AIReviewPanelProps {
    snapshot: ScheduleReviewSnapshot;
    onClose: () => void;
}

const SEVERITY_STYLES: Record<DeterministicFinding['severity'], string> = {
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
};

const CATEGORY_LABELS: Record<DeterministicFinding['category'], string> = {
    headway: 'Headway',
    recovery: 'Recovery',
    compare: 'Compare',
    'service-pattern': 'Service Pattern',
};

const formatMinutes = (minutes: number | null | undefined): string => (
    typeof minutes === 'number' && Number.isFinite(minutes)
        ? `${minutes.toFixed(Number.isInteger(minutes) ? 0 : 1)}m`
        : '—'
);

const formatGeneratedAt = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

export const AIReviewPanel: React.FC<AIReviewPanelProps> = ({
    snapshot,
    onClose,
}) => {
    const topFindings = snapshot.deterministicFindings.slice(0, 12);
    const flaggedRows = snapshot.rows.filter(row => row.flags.length > 0).length;
    const [health, setHealth] = useState<LocalAiHealth | null>(null);
    const [healthLoading, setHealthLoading] = useState(true);
    const [healthError, setHealthError] = useState<string | null>(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const [review, setReview] = useState<ScheduleReviewResponse | null>(null);
    const [lastAction, setLastAction] = useState<ScheduleReviewAction | null>(null);

    const loadHealth = useCallback(async () => {
        setHealthLoading(true);
        setHealthError(null);
        try {
            const result = await checkLocalAiHealth();
            setHealth(result);
        } catch (error) {
            setHealth(null);
            setHealthError(error instanceof Error ? error.message : 'Could not reach local AI.');
        } finally {
            setHealthLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadHealth();
    }, [loadHealth]);

    const handleRunReview = useCallback(async (action: ScheduleReviewAction) => {
        setReviewLoading(true);
        setReviewError(null);
        setLastAction(action);
        try {
            const result = await runScheduleReview(action, snapshot);
            setReview(result);
        } catch (error) {
            setReview(null);
            setReviewError(error instanceof Error ? error.message : 'AI review failed.');
        } finally {
            setReviewLoading(false);
        }
    }, [snapshot]);

    const renderModelFinding = (finding: ScheduleReviewFinding, index: number) => (
        <div key={`${finding.title}-${index}`} className="rounded-xl border border-violet-100 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                    finding.severity === 'critical'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : finding.severity === 'warning'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                    {finding.severity.toUpperCase()}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {CATEGORY_LABELS[finding.category]}
                </span>
                <span className="text-[11px] font-semibold text-gray-500">
                    {finding.confidence} confidence
                </span>
            </div>
            <h4 className="mt-2 text-sm font-bold text-gray-900">{finding.title}</h4>
            {finding.evidence.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-gray-700 list-disc list-inside">
                    {finding.evidence.map((item, evidenceIndex) => (
                        <li key={`${index}-${evidenceIndex}`}>{item}</li>
                    ))}
                </ul>
            )}
            <p className="mt-3 text-sm text-violet-900 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                {finding.plannerNote}
            </p>
            {finding.affectedRows.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {finding.affectedRows.map((row, rowIndex) => (
                        <span key={`${index}-${row.rowKey}-${rowIndex}`} className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[11px] font-semibold">
                            {row.blockId ? `Block ${row.blockId}` : 'Row'} {row.rowKey}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <aside className="w-full lg:w-[420px] xl:w-[460px] flex-shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col overflow-hidden z-20">
            <div className="px-5 py-4 border-b border-gray-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-violet-700 mb-1">
                            <Brain size={16} />
                            <span className="text-xs font-bold uppercase tracking-[0.16em]">AI Review</span>
                        </div>
                        <h2 className="text-lg font-bold text-gray-900">Local review ready</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            This panel is read-only. Run a grounded local AI review without changing the schedule.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/80 text-gray-500 hover:text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                        title="Close AI Review"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-violet-100 bg-white/90 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Draft</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900 truncate">{snapshot.draftName}</div>
                        <div className="text-xs text-gray-500">{snapshot.routeIdentity}</div>
                    </div>
                    <div className="rounded-xl border border-violet-100 bg-white/90 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Snapshot</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">{snapshot.rows.length} rows</div>
                        <div className="text-xs text-gray-500">Updated {formatGeneratedAt(snapshot.generatedAt)}</div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">
                <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Local model</div>
                            {healthLoading ? (
                                <div className="mt-1 flex items-center gap-2 text-sm text-violet-700">
                                    <Loader2 size={14} className="animate-spin" />
                                    Checking local AI runtime…
                                </div>
                            ) : health ? (
                                <>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                            health.available ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                                        }`}>
                                            {health.available ? 'READY' : 'NOT READY'}
                                        </span>
                                        <span className="text-sm font-semibold text-gray-900">{health.modelName}</span>
                                    </div>
                                    <p className="mt-2 text-sm text-gray-700">{health.message}</p>
                                    {health.baseUrl && (
                                        <p className="mt-1 text-xs text-gray-500">{health.provider} · {health.baseUrl}</p>
                                    )}
                                </>
                            ) : (
                                <p className="mt-1 text-sm text-amber-800">{healthError || 'Could not reach local AI.'}</p>
                            )}
                        </div>
                        <button
                            onClick={() => void loadHealth()}
                            className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-violet-200 bg-white text-violet-700 hover:bg-violet-100 transition-colors"
                        >
                            Refresh
                        </button>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                        <button
                            onClick={() => void handleRunReview('find-anomalies')}
                            disabled={healthLoading || reviewLoading || !health?.available}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {reviewLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                            {reviewLoading && lastAction === 'find-anomalies' ? 'Running review…' : 'Find anomalies'}
                        </button>
                        <button
                            onClick={() => void handleRunReview('summarize-draft-vs-master')}
                            disabled={healthLoading || reviewLoading || !health?.available || !snapshot.compareToMaster}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-violet-200 text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {reviewLoading && lastAction === 'summarize-draft-vs-master'
                                ? <Loader2 size={15} className="animate-spin" />
                                : <Brain size={15} />}
                            Summarize vs master
                        </button>
                        <span className="text-xs text-violet-900">
                            Uses the grounded snapshot shown below. No schedule changes are applied.
                        </span>
                    </div>

                    {reviewError && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {reviewError}
                        </div>
                    )}
                </section>

                <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                        <Sparkles size={15} className="text-violet-600" />
                        Review snapshot
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className="text-gray-500">Trips</div>
                            <div className="font-semibold text-gray-900">{snapshot.summary.tripCount}</div>
                        </div>
                        <div>
                            <div className="text-gray-500">Blocks</div>
                            <div className="font-semibold text-gray-900">{snapshot.summary.blockCount}</div>
                        </div>
                        <div>
                            <div className="text-gray-500">Service span</div>
                            <div className="font-semibold text-gray-900">{snapshot.summary.serviceStart} – {snapshot.summary.serviceEnd}</div>
                        </div>
                        <div>
                            <div className="text-gray-500">Peak vehicles</div>
                            <div className="font-semibold text-gray-900">{snapshot.summary.peakVehicles}</div>
                        </div>
                        <div>
                            <div className="text-gray-500">Avg headway</div>
                            <div className="font-semibold text-gray-900">{formatMinutes(snapshot.summary.avgHeadwayMinutes)}</div>
                        </div>
                        <div>
                            <div className="text-gray-500">Flagged rows</div>
                            <div className="font-semibold text-gray-900">{flaggedRows}</div>
                        </div>
                    </div>
                    {snapshot.compareToMaster && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Compare to master</div>
                            <div className="grid grid-cols-4 gap-2 text-center text-xs">
                                <div className="rounded-lg bg-white border border-gray-200 p-2">
                                    <div className="font-bold text-gray-900">{snapshot.compareToMaster.matchedCount}</div>
                                    <div className="text-gray-500">Matched</div>
                                </div>
                                <div className="rounded-lg bg-white border border-gray-200 p-2">
                                    <div className="font-bold text-gray-900">{snapshot.compareToMaster.newCount}</div>
                                    <div className="text-gray-500">New</div>
                                </div>
                                <div className="rounded-lg bg-white border border-gray-200 p-2">
                                    <div className="font-bold text-gray-900">{snapshot.compareToMaster.ambiguousCount}</div>
                                    <div className="text-gray-500">Review</div>
                                </div>
                                <div className="rounded-lg bg-white border border-gray-200 p-2">
                                    <div className="font-bold text-gray-900">{snapshot.compareToMaster.removedCount}</div>
                                    <div className="text-gray-500">Removed</div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {review && (
                    <section>
                        <div className="flex items-center gap-2 mb-3">
                            <Brain size={15} className="text-violet-600" />
                            <h3 className="text-sm font-bold text-gray-900">
                                {lastAction === 'summarize-draft-vs-master' ? 'Draft vs master summary' : 'Local model review'}
                            </h3>
                        </div>
                        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                    review.overallRisk === 'high'
                                        ? 'bg-red-100 text-red-700'
                                        : review.overallRisk === 'medium'
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                    {review.overallRisk.toUpperCase()} RISK
                                </span>
                                <span className="text-xs text-violet-800 font-semibold">
                                    {review.model.modelName}
                                    {typeof review.model.durationMs === 'number' ? ` · ${(review.model.durationMs / 1000).toFixed(1)}s` : ''}
                                </span>
                            </div>
                            <p className="text-sm text-violet-950 leading-relaxed">{review.summary}</p>
                            {review.cautions.length > 0 && (
                                <ul className="mt-3 space-y-1 text-sm text-violet-900 list-disc list-inside">
                                    {review.cautions.map((caution, index) => (
                                        <li key={`${caution}-${index}`}>{caution}</li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="mt-3 space-y-3">
                            {review.findings.length > 0 ? review.findings.map(renderModelFinding) : (
                                <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
                                    The local model completed a review but did not return any structured findings.
                                </div>
                            )}
                        </div>
                    </section>
                )}

                <section>
                    <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={15} className="text-amber-600" />
                        <h3 className="text-sm font-bold text-gray-900">Deterministic review findings</h3>
                    </div>
                    {topFindings.length === 0 ? (
                        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
                            No deterministic findings are currently flagged for this route/day snapshot.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {topFindings.map((finding) => (
                                <div key={finding.id} className="rounded-xl border border-gray-200 bg-white p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${SEVERITY_STYLES[finding.severity]}`}>
                                                    {finding.severity.toUpperCase()}
                                                </span>
                                                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                    {CATEGORY_LABELS[finding.category]}
                                                </span>
                                                {finding.blockId && (
                                                    <span className="text-[11px] font-semibold text-gray-600">
                                                        Block {finding.blockId}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-2 text-sm text-gray-800 leading-relaxed">{finding.message}</p>
                                        </div>
                                    </div>
                                    {finding.rowKey && (
                                        <div className="mt-3 text-xs text-gray-500">
                                            Row reference: <span className="font-mono text-gray-700">{finding.rowKey}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <div className="flex items-center gap-2 mb-3">
                        <Info size={15} className="text-blue-600" />
                        <h3 className="text-sm font-bold text-gray-900">Planner guardrails</h3>
                    </div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 space-y-2">
                        <p><strong>AI review only.</strong> No schedule changes are applied from this panel.</p>
                        <p>This grounded snapshot is what the local model sees when you run a review.</p>
                        <p>Planner review remains required before any action.</p>
                    </div>
                </section>
            </div>
        </aside>
    );
};
