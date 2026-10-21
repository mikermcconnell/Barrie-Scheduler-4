import React from 'react';
import { FolderOpen, Loader2, Trash2 } from 'lucide-react';
import { getContrastingTextColor, getRouteColor } from '../../../utils/config/routeColors';
import { GUIDED_STEPS } from '../guidedSteps';
import type { GuidedSetSummary } from './guidedSetPersistence';

interface GuidedSavedSetsProps {
    sets: GuidedSetSummary[];
    loading: boolean;
    openSetId: string | null;
    busySetId: string | null;
    onOpen: (set: GuidedSetSummary) => void;
    onDelete: (set: GuidedSetSummary) => void;
}

const stepLabel = (step: number): string => {
    const definition = GUIDED_STEPS.find(entry => entry.step === step);
    return definition ? `Step ${step} · ${definition.label}` : `Step ${step}`;
};

const formatSavedAt = (date: Date): string => date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

/** Step 1 list of saved guided schedule sets, newest first. */
export const GuidedSavedSets: React.FC<GuidedSavedSetsProps> = ({ sets, loading, openSetId, busySetId, onOpen, onDelete }) => {
    if (!loading && sets.length === 0) return null;
    return (
        <section aria-labelledby="guided-saved-sets-heading" className="mx-auto mb-5 max-w-5xl">
            <h3 id="guided-saved-sets-heading" className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Saved schedule sets</h3>
            {loading && sets.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading saved sets…</div>
            ) : (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {sets.map(set => {
                        const color = getRouteColor(set.routeNumber);
                        const busy = busySetId === set.scheduleSetId;
                        const isOpen = openSetId === set.scheduleSetId;
                        return (
                            <li key={set.scheduleSetId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                                <span
                                    className="min-w-[3rem] rounded-md px-2 py-1 text-center text-sm font-bold"
                                    style={{ backgroundColor: color, color: getContrastingTextColor(color) }}
                                >
                                    {set.routeNumber}
                                </span>
                                <div className="min-w-[12rem]">
                                    <div className="text-sm font-semibold text-gray-900">
                                        {set.dayTypes.join(', ')}
                                        {isOpen && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">open</span>}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {stepLabel(set.step)}
                                        {set.dateRange ? ` · ${set.dateRange.start} to ${set.dateRange.end}` : ' · all data'}
                                    </div>
                                </div>
                                <span className="text-xs text-gray-500">Saved {formatSavedAt(set.updatedAt)}</span>
                                <div className="ml-auto flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onOpen(set)}
                                        disabled={busy}
                                        className="flex items-center gap-1 rounded-lg border border-gray-900 px-3 py-1.5 text-xs font-bold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {busy ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />} Open
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDelete(set)}
                                        disabled={busy}
                                        aria-label={`Delete saved set for route ${set.routeNumber}`}
                                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
};
