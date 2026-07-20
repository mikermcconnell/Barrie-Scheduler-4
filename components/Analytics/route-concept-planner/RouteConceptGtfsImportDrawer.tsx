import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bus, Loader2, RefreshCw, X } from 'lucide-react';

import type { RouteConceptGtfsPatternCandidate } from '../../../utils/route-concept-planner/routeConceptPlannerGtfsAdapter';
import { RouteConceptAccessibleOverlay } from './RouteConceptAccessibleOverlay';

interface RouteConceptGtfsImportDrawerProps {
    open: boolean;
    patterns: RouteConceptGtfsPatternCandidate[];
    loading: boolean;
    error: string | null;
    onClose: () => void;
    onRetry: () => void;
    onImport: (patterns: RouteConceptGtfsPatternCandidate[]) => void;
}

function routeLabel(pattern: RouteConceptGtfsPatternCandidate): string {
    return pattern.routeFamily?.name ?? `Route ${pattern.routeShortName}`;
}

function directionLabel(pattern: RouteConceptGtfsPatternCandidate): string {
    if (pattern.routeFamily) return `${pattern.routeFamily.directionLabel} · ${pattern.routeFamily.memberShortName}`;
    return pattern.tripHeadsign || (pattern.directionId == null ? 'Complete pattern' : `Direction ${pattern.directionId}`);
}

export function RouteConceptGtfsImportDrawer({
    open,
    patterns,
    loading,
    error,
    onClose,
    onRetry,
    onImport,
}: RouteConceptGtfsImportDrawerProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [dayType, setDayType] = useState<'weekday' | 'saturday' | 'sunday'>('weekday');

    useEffect(() => {
        if (!open) setSelectedIds(new Set());
    }, [open]);

    const visiblePatterns = useMemo(() => patterns
        .filter((pattern) => pattern.dayType === dayType)
        .sort((left, right) => routeLabel(left).localeCompare(routeLabel(right), undefined, { numeric: true })
            || directionLabel(left).localeCompare(directionLabel(right))), [dayType, patterns]);

    const grouped = useMemo(() => {
        const groups = new Map<string, RouteConceptGtfsPatternCandidate[]>();
        visiblePatterns.forEach((pattern) => {
            const key = pattern.routeFamily?.key ?? pattern.routeId;
            groups.set(key, [...(groups.get(key) ?? []), pattern]);
        });
        return [...groups.values()];
    }, [visiblePatterns]);

    if (!open) return null;

    const togglePattern = (id: string): void => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleGroup = (group: RouteConceptGtfsPatternCandidate[]): void => {
        setSelectedIds((current) => {
            const next = new Set(current);
            const allSelected = group.every((pattern) => next.has(pattern.id));
            group.forEach((pattern) => allSelected ? next.delete(pattern.id) : next.add(pattern.id));
            return next;
        });
    };

    const selected = patterns.filter((pattern) => selectedIds.has(pattern.id));

    return (
        <RouteConceptAccessibleOverlay
            labelledBy="route-concept-gtfs-title"
            onClose={onClose}
            backdropClassName="justify-end bg-slate-950/20"
            className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
        >
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Route Concept Planner</div>
                    <h2 id="route-concept-gtfs-title" className="mt-1 text-xl font-black text-slate-950">Import complete GTFS route</h2>
                    <p className="mt-1 text-sm text-slate-600">Choose both directions, or one complete loop. The import is an editable planning copy.</p>
                </div>
                <button type="button" data-autofocus onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" aria-label="Close GTFS import"><X size={18} /></button>
            </header>

            <div className="border-b border-slate-200 px-5 py-3">
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="GTFS service day">
                    {(['weekday', 'saturday', 'sunday'] as const).map((day) => (
                        <button key={day} type="button" aria-pressed={dayType === day} onClick={() => setDayType(day)} className={`rounded-xl px-3 py-2 text-xs font-black capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${dayType === day ? 'bg-cyan-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{day}</button>
                    ))}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {loading && <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600"><Loader2 aria-hidden="true" className="animate-spin" size={18} />Loading GTFS route patterns…</div>}
                {!loading && error && (
                    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <div className="flex items-center gap-2 font-black"><AlertCircle size={18} />GTFS routes unavailable</div>
                        <p className="mt-2">{error}</p>
                        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 font-bold text-red-700 shadow-sm"><RefreshCw size={15} />Retry</button>
                    </div>
                )}
                {!loading && !error && grouped.length === 0 && <div role="status" className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">No full-route patterns were found for this service day.</div>}
                <div className="space-y-3">
                    {grouped.map((group) => {
                        const first = group[0]!;
                        const allSelected = group.every((pattern) => selectedIds.has(pattern.id));
                        return (
                            <section key={`${first.routeId}-${first.serviceId}`} className="rounded-2xl border border-slate-200 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="font-black text-slate-900">{routeLabel(first)}</h3>
                                        <p className="text-xs font-semibold text-slate-500">{group.length} full pattern{group.length === 1 ? '' : 's'}</p>
                                    </div>
                                    <button type="button" aria-label={`${allSelected ? 'Clear' : 'Select'} ${routeLabel(first)}`} onClick={() => toggleGroup(group)} className="rounded-xl border border-cyan-300 px-3 py-1.5 text-xs font-black text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600">{allSelected ? 'Clear' : 'Select route'}</button>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {group.map((pattern) => (
                                        <label key={pattern.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3">
                                            <input type="checkbox" checked={selectedIds.has(pattern.id)} onChange={() => togglePattern(pattern.id)} className="mt-1 size-4 accent-cyan-600" />
                                            <span className="min-w-0">
                                                <span className="block text-sm font-black text-slate-800">{directionLabel(pattern)}</span>
                                                <span className="block text-xs text-slate-500">{pattern.stops.length} stops · {pattern.tripCount} trips{pattern.medianHeadwayMinutes ? ` · ${Math.round(pattern.medianHeadwayMinutes)} min` : ''}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </div>

            <footer className="border-t border-slate-200 p-4">
                <button type="button" disabled={selected.length === 0} onClick={() => onImport(selected)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-black text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><Bus size={17} />Import {selected.length || ''} selected pattern{selected.length === 1 ? '' : 's'}</button>
            </footer>
        </RouteConceptAccessibleOverlay>
    );
}
