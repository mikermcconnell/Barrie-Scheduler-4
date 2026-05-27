import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bus, RefreshCw, X } from 'lucide-react';

import type { RoutePlanner2GtfsImportPattern } from '../../../utils/route-planner-2/routePlanner2GtfsImport';

interface RoutePlanner2GtfsImportModalProps {
    open: boolean;
    presentation?: 'modal' | 'map-drawer';
    patterns: RoutePlanner2GtfsImportPattern[];
    loading: boolean;
    error: string | null;
    onClose: () => void;
    onImport: (patterns: RoutePlanner2GtfsImportPattern[]) => void;
    onRetry: () => void;
}

function getPatternSubtitle(pattern: RoutePlanner2GtfsImportPattern): string {
    return pattern.tripHeadsign || (pattern.directionId == null ? 'Direction not specified' : `Direction ${pattern.directionId}`);
}

const DAY_GROUPS = ['Weekday', 'Saturday', 'Sunday'] as const;

function getDayGroupLabel(pattern: RoutePlanner2GtfsImportPattern): string {
    const label = `${pattern.dayTypeLabel || ''} ${pattern.serviceId || ''}`.toLowerCase();
    if (label.includes('weekday')) return 'Weekday';
    if (label.includes('saturday')) return 'Saturday';
    if (label.includes('sunday')) return 'Sunday';
    return pattern.dayTypeLabel || 'Other';
}

function compareRoutes(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function comparePatterns(a: RoutePlanner2GtfsImportPattern, b: RoutePlanner2GtfsImportPattern): number {
    const roleCompare = getPatternDirectionOrder(a) - getPatternDirectionOrder(b);
    if (roleCompare !== 0) return roleCompare;
    const headsignCompare = (a.tripHeadsign ?? '').localeCompare(b.tripHeadsign ?? '', undefined, { sensitivity: 'base' });
    if (headsignCompare !== 0) return headsignCompare;
    return a.serviceId.localeCompare(b.serviceId, undefined, { numeric: true, sensitivity: 'base' });
}

function getPatternDirectionOrder(pattern: RoutePlanner2GtfsImportPattern): number {
    if (pattern.routeFamily?.directionRole === 'out') return 0;
    if (pattern.routeFamily?.directionRole === 'back') return 1;
    return 2;
}

function getRouteGroupKey(pattern: RoutePlanner2GtfsImportPattern): string {
    return pattern.routeFamily?.key ?? pattern.routeShortName;
}

function getRouteGroupLabel(pattern: RoutePlanner2GtfsImportPattern): string {
    return pattern.routeFamily?.name ?? `Route ${pattern.routeShortName}`;
}

function getRouteGroupSortName(pattern: RoutePlanner2GtfsImportPattern): string {
    return pattern.routeFamily?.shortName ?? pattern.routeShortName;
}

function getPatternDirectionLabel(pattern: RoutePlanner2GtfsImportPattern): string {
    return pattern.routeFamily
        ? `${pattern.routeFamily.directionLabel} · ${pattern.routeFamily.memberShortName}`
        : getPatternSubtitle(pattern);
}

export function RoutePlanner2GtfsImportModal({
    open,
    presentation = 'modal',
    patterns,
    loading,
    error,
    onClose,
    onImport,
    onRetry,
}: RoutePlanner2GtfsImportModalProps) {
    const [selectedPatternIds, setSelectedPatternIds] = useState<Set<string>>(() => new Set());
    const sortedPatterns = useMemo(() => [...patterns].sort((a, b) => {
        const dayIndexA = DAY_GROUPS.indexOf(getDayGroupLabel(a) as typeof DAY_GROUPS[number]);
        const dayIndexB = DAY_GROUPS.indexOf(getDayGroupLabel(b) as typeof DAY_GROUPS[number]);
        const dayCompare = (dayIndexA === -1 ? Number.MAX_SAFE_INTEGER : dayIndexA) - (dayIndexB === -1 ? Number.MAX_SAFE_INTEGER : dayIndexB);
        if (dayCompare !== 0) return dayCompare;
        const routeCompare = compareRoutes(a.routeShortName, b.routeShortName);
        if (routeCompare !== 0) return routeCompare;
        return comparePatterns(a, b);
    }), [patterns]);
    const groupedPatterns = useMemo(() => {
        const dayOrder = new Map<string, number>(DAY_GROUPS.map((day, index) => [day, index]));
        const dayMap = new Map<string, Map<string, RoutePlanner2GtfsImportPattern[]>>();

        sortedPatterns.forEach((pattern) => {
            const dayLabel = getDayGroupLabel(pattern);
            const routeMap = dayMap.get(dayLabel) ?? new Map<string, RoutePlanner2GtfsImportPattern[]>();
            const routeGroupKey = getRouteGroupKey(pattern);
            const routePatterns = routeMap.get(routeGroupKey) ?? [];
            routePatterns.push(pattern);
            routeMap.set(routeGroupKey, routePatterns);
            dayMap.set(dayLabel, routeMap);
        });

        return Array.from(dayMap.entries())
            .sort(([dayA], [dayB]) => {
                const indexA = dayOrder.get(dayA) ?? Number.MAX_SAFE_INTEGER;
                const indexB = dayOrder.get(dayB) ?? Number.MAX_SAFE_INTEGER;
                if (indexA !== indexB) return indexA - indexB;
                return dayA.localeCompare(dayB, undefined, { sensitivity: 'base' });
            })
            .map(([dayLabel, routeMap]) => ({
                dayLabel,
                routes: Array.from(routeMap.entries())
                    .sort(([, patternsA], [, patternsB]) => compareRoutes(getRouteGroupSortName(patternsA[0]!), getRouteGroupSortName(patternsB[0]!)))
                    .map(([routeKey, routePatterns]) => ({
                        routeKey,
                        routeLabel: getRouteGroupLabel(routePatterns[0]!),
                        patterns: [...routePatterns].sort(comparePatterns),
                    })),
            }));
    }, [sortedPatterns]);
    const selectedPatterns = sortedPatterns.filter((pattern) => selectedPatternIds.has(pattern.id));

    useEffect(() => {
        setSelectedPatternIds((current) => {
            const availablePatternIds = new Set(patterns.map((pattern) => pattern.id));
            const next = new Set([...current].filter((patternId) => availablePatternIds.has(patternId)));
            return next.size === current.size ? current : next;
        });
    }, [patterns]);

    function togglePattern(patternId: string) {
        setSelectedPatternIds((current) => {
            const next = new Set(current);
            if (next.has(patternId)) {
                next.delete(patternId);
            } else {
                next.add(patternId);
            }
            return next;
        });
    }

    function toggleRoutePatterns(routePatterns: RoutePlanner2GtfsImportPattern[]) {
        setSelectedPatternIds((current) => {
            const routePatternIds = routePatterns.map((pattern) => pattern.id);
            const allSelected = routePatternIds.every((patternId) => current.has(patternId));
            const next = new Set(current);
            routePatternIds.forEach((patternId) => {
                if (allSelected) {
                    next.delete(patternId);
                } else {
                    next.add(patternId);
                }
            });
            return next;
        });
    }

    if (!open) return null;

    const isMapDrawer = presentation === 'map-drawer';
    const shellClassName = isMapDrawer
        ? 'fixed inset-y-3 right-3 z-50 flex w-[min(92vw,30rem)] items-stretch'
        : 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6';
    const panelClassName = isMapDrawer
        ? 'flex h-full w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl'
        : 'flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl';

    return (
        <div className={shellClassName} role="dialog" aria-modal={!isMapDrawer} aria-labelledby="rp2-gtfs-import-title">
            <section className={panelClassName}>
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                            <Bus size={18} /> GTFS template
                        </div>
                        <h2 id="rp2-gtfs-import-title" className="mt-1 text-2xl font-black text-slate-900">Import GTFS route</h2>
                        <p className="mt-2 text-sm font-semibold text-slate-600">This creates an editable planning copy. It does not modify GTFS. Select one or more full GTFS routes; each import becomes a route concept in this workspace.</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Close GTFS import">
                        <X size={18} />
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-6">
                    {loading && (
                        <div className="rounded-3xl border border-cyan-100 bg-white p-6 text-sm font-bold text-cyan-800">
                            Loading GTFS routes…
                        </div>
                    )}

                    {!loading && error && (
                        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                            <div className="flex items-center gap-2 text-sm font-black"><AlertCircle size={18} />GTFS routes could not be loaded</div>
                            <p className="mt-2 text-sm font-semibold">{error}</p>
                            <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white">
                                <RefreshCw size={16} /> Retry
                            </button>
                        </div>
                    )}

                    {!loading && !error && sortedPatterns.length === 0 && (
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600">
                            No GTFS route patterns are available.
                        </div>
                    )}

                    {!loading && !error && sortedPatterns.length > 0 && (
                        <div className="space-y-7">
                            {groupedPatterns.map((dayGroup) => (
                                <section key={dayGroup.dayLabel} aria-labelledby={`rp2-gtfs-day-${dayGroup.dayLabel}`}>
                                    <h3 id={`rp2-gtfs-day-${dayGroup.dayLabel}`} className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">
                                        {dayGroup.dayLabel}
                                    </h3>
                                    <div className="mt-3 grid grid-cols-2 gap-3">
                                        {dayGroup.routes.map((routeGroup) => {
                                            const selectedRoutePatternCount = routeGroup.patterns.filter((pattern) => selectedPatternIds.has(pattern.id)).length;
                                            const routeSelected = selectedRoutePatternCount === routeGroup.patterns.length;
                                            return (
                                            <section key={`${dayGroup.dayLabel}-${routeGroup.routeKey}`} aria-labelledby={`rp2-gtfs-route-${dayGroup.dayLabel}-${routeGroup.routeKey}`}>
                                                <button
                                                    id={`rp2-gtfs-route-${dayGroup.dayLabel}-${routeGroup.routeKey}`}
                                                    type="button"
                                                    onClick={() => toggleRoutePatterns(routeGroup.patterns)}
                                                    aria-pressed={routeSelected}
                                                    className={`flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left transition ${routeSelected ? 'border-cyan-300 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white text-slate-900 hover:border-cyan-200'}`}
                                                >
                                                    <span>
                                                        <span className="block text-lg font-black">{routeGroup.routeLabel}</span>
                                                        {routeGroup.patterns.length > 1 && (
                                                            <span className="mt-0.5 block text-xs font-bold text-slate-500">{routeGroup.patterns.length} directions</span>
                                                        )}
                                                    </span>
                                                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${routeSelected ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                                        {routeSelected ? 'Selected' : selectedRoutePatternCount > 0 ? `${selectedRoutePatternCount}/${routeGroup.patterns.length}` : 'Select'}
                                                    </span>
                                                </button>
                                                <div className="mt-2 space-y-3">
                                                    {routeGroup.patterns.map((pattern) => {
                                                        const selected = selectedPatternIds.has(pattern.id);
                                                        return (
                                                            <button
                                                                key={pattern.id}
                                                                type="button"
                                                                onClick={() => togglePattern(pattern.id)}
                                                                className={`rounded-3xl border p-4 text-left shadow-sm transition ${selected ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-white hover:border-cyan-200'}`}
                                                                aria-pressed={selected}
                                                                aria-label={`Route ${pattern.routeShortName} ${getPatternSubtitle(pattern)} ${getDayGroupLabel(pattern)}`}
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div>
                                                                        <div className="text-sm font-bold text-slate-700">{getPatternDirectionLabel(pattern)}</div>
                                                                        {pattern.routeFamily && <div className="mt-1 text-xs font-semibold text-slate-500">{getPatternSubtitle(pattern)}</div>}
                                                                        {pattern.routeLongName && <div className="mt-2 text-xs font-semibold text-slate-500">{pattern.routeLongName}</div>}
                                                                    </div>
                                                                    <div className="flex shrink-0 items-center gap-2">
                                                                        {pattern.routeColor && (
                                                                            <span className="h-5 w-5 rounded-full border border-white shadow" style={{ backgroundColor: `#${pattern.routeColor}` }} aria-label="route color" />
                                                                        )}
                                                                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${selected ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                                                            {selected ? 'Selected' : 'Select'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-600">
                                                                    <span className="rounded-full bg-slate-100 px-2 py-1">{pattern.tripCount} trips</span>
                                                                    <span className="rounded-full bg-slate-100 px-2 py-1">{pattern.stopCount} stops</span>
                                                                    <span className="rounded-full bg-slate-100 px-2 py-1">{pattern.shapePointCount} shape points</span>
                                                                    <span className="rounded-full bg-slate-100 px-2 py-1">Service {pattern.serviceId}</span>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </section>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
                    <div className="text-sm font-semibold text-slate-500">
                        {selectedPatterns.length > 0
                            ? `${selectedPatterns.length} route${selectedPatterns.length === 1 ? '' : 's'} selected · ${selectedPatterns.reduce((sum, pattern) => sum + pattern.stopCount, 0)} total stops`
                            : 'Select one or more GTFS route patterns to import.'}
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
                        <button
                            type="button"
                            onClick={() => selectedPatterns.length > 0 && onImport(selectedPatterns)}
                            disabled={selectedPatterns.length === 0}
                            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {selectedPatterns.length > 1 ? `Import ${selectedPatterns.length} editable routes` : 'Import as editable route'}
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    );
}
