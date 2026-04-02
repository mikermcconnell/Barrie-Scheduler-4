import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { TimeUtils } from '../../utils/timeUtils';

export interface MasterCompareReviewCandidateView {
    masterTripId: string;
    blockId?: string;
    startTime: number;
    endTime: number;
    diffMinutes: number;
}

export interface MasterCompareReviewItem {
    currentTripId: string;
    routeName: string;
    direction: 'North' | 'South';
    blockId?: string;
    startTime: number;
    endTime: number;
    reason: string;
    shiftMinutes?: number;
    candidates: MasterCompareReviewCandidateView[];
}

interface MasterCompareReviewPanelProps {
    items: MasterCompareReviewItem[];
    activeTripId: string | null;
    onSelectTrip: (tripId: string) => void;
}

const formatDiff = (diffMinutes: number): string => (
    `${diffMinutes > 0 ? '+' : ''}${diffMinutes}m`
);

export const MasterCompareReviewPanel: React.FC<MasterCompareReviewPanelProps> = ({
    items,
    activeTripId,
    onSelectTrip,
}) => {
    if (items.length === 0) return null;

    return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-amber-900">
                        <AlertTriangle size={16} />
                        <span className="text-sm font-bold uppercase tracking-wide">Compare review needed</span>
                    </div>
                    <p className="mt-1 text-sm text-amber-900">
                        {items.length} trip{items.length === 1 ? '' : 's'} have more than one plausible master match.
                        These rows are flagged as review-needed instead of forcing a confident delta.
                    </p>
                </div>
                <div className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-800">
                    {items.length} review item{items.length === 1 ? '' : 's'}
                </div>
            </div>

            <div className="mt-3 grid gap-3">
                {items.map(item => {
                    const isActive = activeTripId === item.currentTripId;
                    return (
                        <div
                            key={item.currentTripId}
                            className={`rounded-xl border px-3 py-3 ${isActive ? 'border-amber-400 bg-white shadow-sm' : 'border-amber-200 bg-white/80'}`}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-gray-900">{item.routeName}</span>
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                            {item.direction}
                                        </span>
                                        {item.blockId && (
                                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                                                Block {item.blockId}
                                            </span>
                                        )}
                                        {typeof item.shiftMinutes === 'number' && (
                                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                                Auto-align {item.shiftMinutes > 0 ? '+' : ''}{item.shiftMinutes}m
                                            </span>
                                        )}
                                        {isActive && (
                                            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                                                Focused
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-sm text-gray-800">
                                        Current trip {TimeUtils.fromMinutes(item.startTime)} → {TimeUtils.fromMinutes(item.endTime)}
                                    </div>
                                    <div className="mt-1 text-xs text-amber-900">
                                        {item.reason}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => onSelectTrip(item.currentTripId)}
                                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                        isActive
                                            ? 'border-amber-300 bg-amber-100 text-amber-900'
                                            : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100'
                                    }`}
                                >
                                    {isActive ? 'Focused in table' : 'Jump to row'}
                                    <ArrowRight size={12} />
                                </button>
                            </div>

                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                                {item.candidates.map(candidate => (
                                    <div
                                        key={`${item.currentTripId}-${candidate.masterTripId}`}
                                        className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                                    >
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                            Master candidate
                                        </div>
                                        <div className="mt-1 text-sm font-semibold text-gray-900">
                                            {TimeUtils.fromMinutes(candidate.startTime)} → {TimeUtils.fromMinutes(candidate.endTime)}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-700">
                                            {candidate.blockId ? `Block ${candidate.blockId}` : 'No block'}
                                            <span className="mx-1 text-gray-300">•</span>
                                            {formatDiff(candidate.diffMinutes)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
