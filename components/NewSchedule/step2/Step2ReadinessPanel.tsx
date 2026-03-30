import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Step2DataHealthReport } from '../utils/wizardState';

interface Step2ReadinessPanelProps {
    healthReport: Step2DataHealthReport;
    showDataHealth: boolean;
    onToggleShowDataHealth: () => void;
}

const formatImportedAt = (value?: string): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(parsed);
};

export const Step2ReadinessPanel: React.FC<Step2ReadinessPanelProps> = ({
    healthReport,
    showDataHealth,
    onToggleShowDataHealth,
}) => {
    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={onToggleShowDataHealth}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                aria-expanded={showDataHealth}
            >
                <div className="flex items-center gap-2">
                    {healthReport.status === 'blocked' ? (
                        <AlertTriangle className="text-red-600" size={18} />
                    ) : healthReport.status === 'warning' ? (
                        <AlertTriangle className="text-amber-600" size={18} />
                    ) : (
                        <CheckCircle2 className="text-emerald-600" size={18} />
                    )}
                    <div>
                        <h3 className="font-bold text-gray-900">Data Health</h3>
                        <p className="text-xs text-gray-500">
                            {showDataHealth ? 'Hide route readiness details' : 'Show route readiness details'}
                        </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                        healthReport.status === 'blocked'
                            ? 'bg-red-100 text-red-700'
                            : healthReport.status === 'warning'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                    }`}>
                        {healthReport.status}
                    </span>
                </div>
                <span className="text-xs font-semibold text-gray-500">
                    {showDataHealth ? 'Hide' : 'Show'}
                </span>
            </button>
            {showDataHealth && (
                <div className="border-t border-gray-200 bg-gray-50/60 p-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="mt-0 text-sm text-gray-700">
                                {healthReport.expectedSegmentCount > 0
                                    ? `${healthReport.matchedSegmentCount}/${healthReport.expectedSegmentCount} route-chain segments matched, with ${healthReport.completeBucketCount}/${healthReport.availableBucketCount} complete 30-minute buckets ready for scheduling.`
                                    : 'Review route readiness and bucket coverage before using these runtimes for schedule generation.'}
                            </p>
                        </div>
                        <div className="text-right text-xs text-gray-600">
                            <div className="font-semibold">Runtime source</div>
                            <div>{healthReport.runtimeSourceSummary}</div>
                            {formatImportedAt(healthReport.importedAt) && (
                                <>
                                    <div className="mt-2 font-semibold">Imported</div>
                                    <div>{formatImportedAt(healthReport.importedAt)}</div>
                                </>
                            )}
                            {healthReport.runtimeLogicVersion !== undefined && (
                                <div className="mt-1">Logic v{healthReport.runtimeLogicVersion}</div>
                            )}
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                        <div className="rounded-lg bg-white/80 p-3 border border-white/70">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Directions</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">
                                {healthReport.matchedDirections.length}/{healthReport.expectedDirections}
                            </div>
                            <div className="text-xs text-gray-600">
                                {healthReport.matchedDirections.join(', ') || 'None'}
                            </div>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 border border-white/70">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Segment coverage</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">
                                {healthReport.matchedSegmentCount}/{healthReport.expectedSegmentCount}
                            </div>
                            <div className="text-xs text-gray-600">
                                {healthReport.missingSegments.length === 0 ? 'Full route chain matched' : `${healthReport.missingSegments.length} missing`}
                            </div>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 border border-white/70">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Complete buckets</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{healthReport.completeBucketCount}</div>
                            <div className="text-xs text-gray-600">of {healthReport.availableBucketCount} buckets</div>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 border border-white/70">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Incomplete buckets</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{healthReport.incompleteBucketCount}</div>
                            <div className="text-xs text-gray-600">Missing at least 1 segment</div>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 border border-white/70">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Low confidence</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{healthReport.lowConfidenceBucketCount}</div>
                            <div className="text-xs text-gray-600">
                                Threshold {healthReport.confidenceThreshold} {healthReport.sampleCountMode === 'days' ? 'days' : 'samples'}
                            </div>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 border border-white/70">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Coverage hardening</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">
                                {healthReport.repairedBucketCount ?? 0} repaired
                            </div>
                            <div className="text-xs text-gray-600">
                                {healthReport.boundaryBucketCount ?? 0} boundary • {healthReport.singleGapBucketCount ?? 0} single-gap
                            </div>
                        </div>
                        {healthReport.stopOrder && (
                            <div className="rounded-lg bg-white/80 p-3 border border-white/70 col-span-2 md:col-span-1">
                                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Stop order</div>
                                <div className="mt-1 flex items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                        healthReport.stopOrder.usedForPlanning
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : healthReport.stopOrder.decision === 'blocked'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        {healthReport.stopOrder.decision}
                                    </span>
                                    <span className="text-sm font-semibold text-gray-900">
                                        {healthReport.stopOrder.usedForPlanning ? 'Driving Step 2' : 'Fallback in use'}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                    {healthReport.stopOrder.sourceUsed === 'runtime-derived'
                                        ? `Observed trips • ${healthReport.stopOrder.confidence} confidence`
                                        : healthReport.stopOrder.sourceUsed === 'master-fallback'
                                            ? `Master fallback • ${healthReport.stopOrder.confidence} confidence`
                                            : `No fallback • ${healthReport.stopOrder.confidence} confidence`}
                                </div>
                            </div>
                        )}
                    </div>

                    {healthReport.stopOrder && (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white/80 p-3 text-sm text-slate-700">
                            <div className="font-semibold text-slate-900">Stop-order decision</div>
                            <div className="mt-1">{healthReport.stopOrder.summary}</div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                                {healthReport.stopOrder.directionStats.North && (
                                    <span>
                                        North: {healthReport.stopOrder.directionStats.North.tripCountUsed} trips, {healthReport.stopOrder.directionStats.North.dayCountUsed} day{healthReport.stopOrder.directionStats.North.dayCountUsed === 1 ? '' : 's'}
                                    </span>
                                )}
                                {healthReport.stopOrder.directionStats.South && (
                                    <span>
                                        South: {healthReport.stopOrder.directionStats.South.tripCountUsed} trips, {healthReport.stopOrder.directionStats.South.dayCountUsed} day{healthReport.stopOrder.directionStats.South.dayCountUsed === 1 ? '' : 's'}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {((healthReport.repairedBucketCount ?? 0) > 0
                        || (healthReport.boundaryBucketCount ?? 0) > 0
                        || (healthReport.singleGapBucketCount ?? 0) > 0
                        || (healthReport.internalGapBucketCount ?? 0) > 0
                        || (healthReport.fragmentedGapBucketCount ?? 0) > 0) && (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white/80 p-3 text-sm text-slate-700">
                            <div className="font-semibold text-slate-900">Incomplete bucket diagnosis</div>
                            <div className="mt-1 text-xs text-slate-600">
                                Step 2 now separates boundary-service buckets from isolated internal gaps and marks any single-gap estimated repairs explicitly.
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                {(healthReport.repairedBucketCount ?? 0) > 0 && (
                                    <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">
                                        {healthReport.repairedBucketCount} repaired from adjacent buckets
                                    </span>
                                )}
                                {(healthReport.boundaryBucketCount ?? 0) > 0 && (
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                                        {healthReport.boundaryBucketCount} boundary / short-turn buckets
                                    </span>
                                )}
                                {(healthReport.singleGapBucketCount ?? 0) > 0 && (
                                    <span className="rounded-full bg-orange-50 px-2.5 py-1 font-semibold text-orange-700">
                                        {healthReport.singleGapBucketCount} single-gap buckets still missing one segment
                                    </span>
                                )}
                                {(healthReport.internalGapBucketCount ?? 0) > 0 && (
                                    <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                                        {healthReport.internalGapBucketCount} internal-gap buckets
                                    </span>
                                )}
                                {(healthReport.fragmentedGapBucketCount ?? 0) > 0 && (
                                    <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
                                        {healthReport.fragmentedGapBucketCount} fragmented buckets
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {healthReport.usesLegacyRuntimeLogic && (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-white/80 p-3 text-sm text-amber-800">
                            This performance import was built with older runtime logic. Re-importing the STREETS data is recommended before trusting these schedule inputs.
                        </div>
                    )}

                    {healthReport.blockers.length > 0 && (
                        <div className="mt-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-red-700">Blocking issues</p>
                            <ul className="mt-2 space-y-1 text-sm text-red-800">
                                {healthReport.blockers.map((issue) => (
                                    <li key={issue} className="flex items-start gap-2">
                                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                                        <span>{issue}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {healthReport.warnings.length > 0 && (
                        <div className="mt-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Warnings</p>
                            <ul className="mt-2 space-y-1 text-sm text-amber-800">
                                {healthReport.warnings.map((issue) => (
                                    <li key={issue} className="flex items-start gap-2">
                                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                                        <span>{issue}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {healthReport.missingSegments.length > 0 && (
                        <div className="mt-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Unmatched segments</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {healthReport.missingSegments.map((segment) => (
                                    <span
                                        key={segment}
                                        className="rounded-full border border-orange-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-orange-700"
                                    >
                                        {segment}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
