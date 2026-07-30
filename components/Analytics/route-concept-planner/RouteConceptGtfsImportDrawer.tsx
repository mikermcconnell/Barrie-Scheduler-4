import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bus, Loader2, RefreshCw, X } from 'lucide-react';

import {
    buildRouteConceptGtfsImportOptions,
    type RouteConceptGtfsImportDirectionOption,
    type RouteConceptGtfsImportOption,
    type RouteConceptGtfsPatternCandidate,
} from '../../../utils/route-concept-planner/routeConceptPlannerGtfsAdapter';
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

function directionName(direction: RouteConceptGtfsImportDirectionOption): string {
    if (direction.role === 'loop') return 'Loop';
    return direction.role === 'outbound' ? 'Outbound' : 'Return';
}

function directionRouteName(pattern: RouteConceptGtfsPatternCandidate): string {
    return pattern.routeFamily?.memberShortName
        ?? pattern.tripHeadsign
        ?? `Route ${pattern.routeShortName}`;
}

function patternEndpoints(pattern: RouteConceptGtfsPatternCandidate): string {
    const first = pattern.stops[0]?.name;
    const last = pattern.stops[pattern.stops.length - 1]?.name;
    return first && last ? `${first} to ${last}` : directionRouteName(pattern);
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
    const [selectedVariantIds, setSelectedVariantIds] = useState<Record<string, string>>({});
    const [dayType, setDayType] = useState<'weekday' | 'saturday' | 'sunday'>('weekday');

    useEffect(() => {
        if (!open) setSelectedVariantIds({});
    }, [open]);

    const routeOptions = useMemo(
        () => buildRouteConceptGtfsImportOptions(patterns, dayType),
        [dayType, patterns],
    );

    if (!open) return null;

    const selectedPattern = (
        route: RouteConceptGtfsImportOption,
        direction: RouteConceptGtfsImportDirectionOption,
    ): RouteConceptGtfsPatternCandidate => {
        const selectionKey = `${route.id}|${direction.role}`;
        const selectedId = selectedVariantIds[selectionKey] ?? direction.recommendedPatternId;
        return direction.variants.find((variant) => variant.id === selectedId) ?? direction.variants[0]!;
    };

    const importRoute = (route: RouteConceptGtfsImportOption): void => {
        onImport(route.directions.map((direction) => selectedPattern(route, direction)));
    };

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
                    <h2 id="route-concept-gtfs-title" className="mt-1 text-xl font-black text-slate-950">Import a GTFS route</h2>
                    <p className="mt-1 text-sm text-slate-600">Choose a route. We will automatically use the most representative service in each direction.</p>
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
                {loading && <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600"><Loader2 aria-hidden="true" className="animate-spin" size={18} />Loading GTFS routes…</div>}
                {!loading && error && (
                    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <div className="flex items-center gap-2 font-black"><AlertCircle size={18} />GTFS routes unavailable</div>
                        <p className="mt-2">{error}</p>
                        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 font-bold text-red-700 shadow-sm"><RefreshCw size={15} />Retry</button>
                    </div>
                )}
                {!loading && !error && routeOptions.length === 0 && <div role="status" className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">No complete routes were found for this service day.</div>}
                <div className="space-y-3">
                    {routeOptions.map((route) => {
                        const selectedPatterns = route.directions.map((direction) => selectedPattern(route, direction));
                        const variantCount = route.directions.reduce(
                            (count, direction) => count + Math.max(0, direction.variants.length - 1),
                            0,
                        );
                        const scheduledTrips = selectedPatterns.reduce((sum, pattern) => sum + pattern.tripCount, 0);
                        return (
                            <section key={route.id} className="rounded-2xl border border-slate-200 p-4">
                                <div>
                                    <h3 className="text-base font-black text-slate-900">{route.routeLabel}</h3>
                                    <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                        {route.complete ? 'Complete route' : 'Route draft'} · {scheduledTrips} scheduled trips
                                    </p>
                                </div>
                                <div className="mt-3 space-y-2" aria-label={`${route.routeLabel} directions`}>
                                    {route.directions.map((direction) => {
                                        const pattern = selectedPattern(route, direction);
                                        return (
                                            <div key={direction.role} className="rounded-xl bg-slate-50 px-3 py-2.5">
                                                <div className="text-sm font-black text-slate-800">
                                                    {directionName(direction)} · {directionRouteName(pattern)}
                                                </div>
                                                <div className="mt-0.5 text-xs text-slate-500">
                                                    {pattern.stops.length} stops · {pattern.tripCount} scheduled trips
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {!route.complete && (
                                    <p role="note" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                        Only one direction was found. You can import it as a draft and add the return direction later.
                                    </p>
                                )}
                                {variantCount > 0 && (
                                    <details className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                        <summary className="cursor-pointer text-xs font-black text-cyan-800">
                                            Review {variantCount} other route variant{variantCount === 1 ? '' : 's'}
                                        </summary>
                                        <div className="mt-3 space-y-3">
                                            {route.directions.filter((direction) => direction.variants.length > 1).map((direction) => {
                                                const selectionKey = `${route.id}|${direction.role}`;
                                                return (
                                                    <label key={direction.role} className="block text-xs font-bold text-slate-700">
                                                        {directionName(direction)} route
                                                        <select
                                                            value={selectedPattern(route, direction).id}
                                                            onChange={(event) => setSelectedVariantIds((current) => ({
                                                                ...current,
                                                                [selectionKey]: event.target.value,
                                                            }))}
                                                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
                                                        >
                                                            {direction.variants.map((variant, index) => (
                                                                <option key={variant.id} value={variant.id}>
                                                                    {index === 0 ? 'Recommended · ' : ''}{patternEndpoints(variant)} · {variant.stops.length} stops
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </details>
                                )}
                                <button
                                    type="button"
                                    onClick={() => importRoute(route)}
                                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-black text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2"
                                >
                                    <Bus size={17} />Import {route.routeLabel}
                                </button>
                            </section>
                        );
                    })}
                </div>
            </div>
        </RouteConceptAccessibleOverlay>
    );
}
