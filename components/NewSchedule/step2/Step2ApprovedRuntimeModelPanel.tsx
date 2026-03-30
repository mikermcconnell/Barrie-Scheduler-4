import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ApprovedRuntimeModel } from '../utils/wizardState';

interface Step2ApprovedRuntimeModelPanelProps {
    model: ApprovedRuntimeModel;
    isExpanded: boolean;
    onToggleExpanded: () => void;
}

export const Step2ApprovedRuntimeModelPanel: React.FC<Step2ApprovedRuntimeModelPanelProps> = ({
    model,
    isExpanded,
    onToggleExpanded,
}) => {
    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={onToggleExpanded}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2">
                    <CheckCircle2 className="text-blue-600" size={18} />
                    <div>
                        <h3 className="font-bold text-gray-900">Approved Runtime Model</h3>
                        <p className="text-xs text-gray-500">
                            {isExpanded ? 'Hide generation-ready runtime details' : 'Show generation-ready runtime details'}
                        </p>
                    </div>
                </div>
                <span className="text-xs font-semibold text-gray-500">
                    {isExpanded ? 'Hide' : 'Show'}
                </span>
            </button>
            {isExpanded && (
                <div className="border-t border-gray-200 bg-blue-50/50 p-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="mt-0 text-sm text-gray-700">
                                Step 3 and later schedule work should use this model: {model.usableBucketCount} active bucket{model.usableBucketCount === 1 ? '' : 's'} across {model.usableBandCount} active band{model.usableBandCount === 1 ? '' : 's'}, built from {model.chartBasis === 'observed-cycle' ? 'full observed cycle totals' : 'uploaded bucket percentiles'} and direction-specific segment summaries.
                            </p>
                        </div>
                        <div className="text-right text-xs text-gray-600">
                            <div className="font-semibold">Generation basis</div>
                            <div>Direction band summaries</div>
                            <div className="mt-1 font-semibold">Directions</div>
                            <div>{model.directions.join(', ') || 'None'}</div>
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                        <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Active buckets</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{model.usableBucketCount}</div>
                            <div className="text-xs text-gray-600">Band-ready buckets</div>
                        </div>
                        <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Ignored buckets</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{model.ignoredBucketCount}</div>
                            <div className="text-xs text-gray-600">Planner-excluded buckets</div>
                        </div>
                        <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Active bands</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{model.usableBandCount}</div>
                            <div className="text-xs text-gray-600">From the current approval set</div>
                        </div>
                        <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Segment columns</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{model.segmentColumns.length}</div>
                            <div className="text-xs text-gray-600">Full out-and-back chain</div>
                        </div>
                        <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Model status</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900 capitalize">{model.status}</div>
                            <div className="text-xs text-gray-600">{model.importMode === 'performance' ? 'Performance-derived' : 'CSV-derived'}</div>
                        </div>
                    </div>

                    {model.bandPreviews.length > 0 && (
                        <div className="mt-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-blue-800">Direction band previews</p>
                            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {model.bandPreviews.map((preview) => (
                                    <div key={`${preview.direction}-${preview.bandId}`} className="rounded-lg border border-blue-100 bg-white/85 p-3 text-sm">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold text-gray-900">{preview.direction} · Band {preview.bandId}</span>
                                            <span className="text-xs font-semibold text-blue-700">{preview.avgTotal.toFixed(1)} min</span>
                                        </div>
                                        <div className="mt-2 text-xs text-gray-600">
                                            <div>{preview.timeSlotCount} time slot{preview.timeSlotCount === 1 ? '' : 's'}</div>
                                            <div>{preview.segmentCount} segment average{preview.segmentCount === 1 ? '' : 's'} exported</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
