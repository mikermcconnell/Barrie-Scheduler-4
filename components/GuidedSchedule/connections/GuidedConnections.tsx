import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, Plus, Save, Sparkles, X } from 'lucide-react';
import type { DayType, MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionLibrary, ConnectionType, RouteConnection, RouteConnectionConfig, StopInfo } from '../../../utils/connections/connectionTypes';
import { formatConnectionTime } from '../../../utils/connections/connectionTypes';
import {
    applyTripShifts,
    buildRankedConnectionModel,
    evaluateRankedConnections,
    optimizeRankedConnections,
    sortByRank,
    sumTotals,
    withRankPriorities,
    type RankedConnectionModel,
    type RankedOptimizeResult,
    type UnfixedEvent,
} from '../../../utils/connections/rankedConnections';
import {
    buildConnectionForTarget,
    suggestConnections,
    upsertTargetForDay,
    type ConnectionSuggestion,
} from '../../../utils/connections/guidedConnectionSetup';
import { buildRouteTimepointStopOptions } from '../../../utils/connections/routeTimepointStops';
import {
    getConnectionLibrary,
    getRouteConnectionConfig,
    saveConnectionLibrary,
    saveRouteConnectionConfig,
} from '../../../utils/connections/connectionLibraryService';
import { ConnectionRankList, type RankedCardData } from './ConnectionRankList';
import { ConnectionTimeline } from './ConnectionTimeline';
import { AddConnectionDialog, type NewTargetInput } from './AddConnectionDialog';
import { useDayConnectionLibrary } from './useDayConnectionLibrary';

export interface ConnectionsApplySummary {
    movedTrips: number;
    met: number;
    total: number;
}

interface GuidedConnectionsProps {
    routeNumber: string;
    dayType: DayType;
    schedules: MasterRouteTable[];
    teamId: string;
    userId: string;
    connectionLibrary: ConnectionLibrary | null;
    setConnectionLibrary: (library: ConnectionLibrary) => void;
    routeConnectionConfig: RouteConnectionConfig | null;
    setRouteConnectionConfig: (config: RouteConnectionConfig) => void;
    /** Applies the optimizer's trip moves as one change (Step 4 keeps a snapshot for Reset). */
    onApply: (schedules: MasterRouteTable[], summary: ConnectionsApplySummary) => void;
}

const DAY_TYPES: DayType[] = ['Weekday', 'Saturday', 'Sunday'];

const emptyLibrary = (userId: string): ConnectionLibrary => ({ targets: [], updatedAt: new Date().toISOString(), updatedBy: userId });

const describeUnfixed = (item: UnfixedEvent, names: Map<string, string>, rankOf: Map<string, number>): React.ReactNode => {
    const name = names.get(item.connectionId) ?? 'Connection';
    const head = <><b>#{item.rank} {name}</b> {formatConnectionTime(item.targetTime)}: </>;
    if (item.reason.kind === 'protected') {
        return <>{head}left as is. Moving block {item.blockId} would break <b>#{rankOf.get(item.reason.blockerConnectionId)} {names.get(item.reason.blockerConnectionId)}</b> at {formatConnectionTime(item.reason.blockerTargetTime)}.</>;
    }
    if (item.reason.kind === 'recovery') {
        return <>{head}needs {Math.abs(item.reason.neededMinutes)} min, which would cut a recovery in block {item.blockId} below the minimum.</>;
    }
    return <>{head}needs {Math.abs(item.reason.neededMinutes)} min, more than the move limit.</>;
};

export const GuidedConnections: React.FC<GuidedConnectionsProps> = ({
    routeNumber,
    dayType,
    schedules,
    teamId,
    userId,
    connectionLibrary,
    setConnectionLibrary,
    routeConnectionConfig,
    setRouteConnectionConfig,
    onApply,
}) => {
    const routeIdentity = `${routeNumber}-${dayType}`;
    const routeLabel = `Route ${routeNumber}`;
    const [startedFrom, setStartedFrom] = useState<string | null>(null);
    const [bannerOpen, setBannerOpen] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [maxShift, setMaxShift] = useState(4);
    const [keepRecovery, setKeepRecovery] = useState(true);
    const [pending, setPending] = useState<{ result: RankedOptimizeResult; model: RankedConnectionModel } | null>(null);
    const [view, setView] = useState<'now' | 'after'>('now');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // Team library: load once; changes made here are saved right away.
    useEffect(() => {
        if (connectionLibrary || !teamId) return;
        let cancelled = false;
        getConnectionLibrary(teamId)
            .then(library => !cancelled && setConnectionLibrary(library ?? emptyLibrary(userId)))
            .catch(() => !cancelled && setConnectionLibrary(emptyLibrary(userId)));
        return () => { cancelled = true; };
    }, [connectionLibrary, teamId, userId, setConnectionLibrary]);

    // Start from this route's saved setup, or another day type's.
    useEffect(() => {
        if (routeConnectionConfig || !teamId) return;
        let cancelled = false;
        (async () => {
            const order = [dayType, ...DAY_TYPES.filter(day => day !== dayType)];
            for (const day of order) {
                try {
                    const saved = await getRouteConnectionConfig(teamId, `${routeNumber}-${day}`);
                    if (cancelled) return;
                    if (saved && saved.connections.length > 0) {
                        setRouteConnectionConfig({
                            routeIdentity,
                            optimizationMode: saved.optimizationMode,
                            connections: withRankPriorities(sortByRank(saved.connections)),
                        });
                        setStartedFrom(day === dayType ? `${routeLabel} ${day}'s saved connections` : `${routeLabel} ${day}'s saved connections (another day type)`);
                        return;
                    }
                } catch {
                    // Try the next day type.
                }
            }
            if (!cancelled) setRouteConnectionConfig({ routeIdentity, connections: [], optimizationMode: 'hybrid' });
        })();
        return () => { cancelled = true; };
    }, [routeConnectionConfig, teamId, routeNumber, dayType, routeIdentity, routeLabel, setRouteConnectionConfig]);

    const dayLibrary = useDayConnectionLibrary(connectionLibrary, teamId, dayType);

    const connections = useMemo(() => sortByRank(routeConnectionConfig?.connections ?? []), [routeConnectionConfig]);

    const routeStops = useMemo<StopInfo[]>(() => {
        const stops = buildRouteTimepointStopOptions(schedules);
        connections.forEach(connection => {
            if (!stops.some(stop => stop.code === connection.stopCode)) stops.push({ code: connection.stopCode, name: connection.stopName || `Stop ${connection.stopCode}` });
        });
        return stops;
    }, [schedules, connections]);

    const model = useMemo(() => (
        dayLibrary ? buildRankedConnectionModel(schedules, connections, dayLibrary, dayType) : null
    ), [schedules, connections, dayLibrary, dayType]);
    const evaluations = useMemo(() => (model ? evaluateRankedConnections(model) : []), [model]);

    // Cards show their numbers even when turned off.
    const allEvaluations = useMemo(() => {
        if (!dayLibrary) return new Map<string, ReturnType<typeof evaluateRankedConnections>[number]>();
        const allOn = connections.map(connection => ({ ...connection, enabled: true }));
        return new Map(evaluateRankedConnections(buildRankedConnectionModel(schedules, allOn, dayLibrary, dayType)).map(item => [item.connection.id, item] as const));
    }, [schedules, connections, dayLibrary, dayType]);

    const afterById = useMemo(() => new Map((pending?.result.after ?? []).map(item => [item.connection.id, item] as const)), [pending]);
    const totals = useMemo(() => sumTotals(evaluations), [evaluations]);

    const cards: RankedCardData[] = connections.map(connection => {
        const evaluation = allEvaluations.get(connection.id);
        return {
            connection,
            target: dayLibrary?.targets.find(target => target.id === connection.targetId) ?? null,
            totals: evaluation?.totals ?? { met: 0, atRisk: 0, tight: 0, long: 0, missed: 0, total: 0, unserved: 0 },
            afterTotals: afterById.get(connection.id)?.totals,
        };
    });

    const suggestions = useMemo(() => suggestConnections(dayLibrary, connections, routeStops, routeNumber), [dayLibrary, connections, routeStops, routeNumber]);

    useEffect(() => {
        if (selectedId && connections.some(connection => connection.id === selectedId)) return;
        setSelectedId(connections[0]?.id ?? null);
    }, [connections, selectedId]);

    const clearPending = useCallback(() => {
        setPending(null);
        setView('now');
    }, []);

    const setConnections = useCallback((next: RouteConnection[]) => {
        setRouteConnectionConfig({
            routeIdentity,
            optimizationMode: routeConnectionConfig?.optimizationMode ?? 'hybrid',
            lastOptimized: routeConnectionConfig?.lastOptimized,
            connections: withRankPriorities(next),
        });
        clearPending();
        setSaveState('idle');
    }, [routeIdentity, routeConnectionConfig, setRouteConnectionConfig, clearPending]);

    const updateConnection = (id: string, patch: Partial<RouteConnection>) => setConnections(connections.map(item => item.id === id ? { ...item, ...patch } : item));
    const removeConnection = (id: string) => setConnections(connections.filter(item => item.id !== id));
    const reorder = (id: string, toIndex: number) => {
        const moving = connections.find(item => item.id === id);
        if (!moving) return;
        const rest = connections.filter(item => item.id !== id);
        rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, moving);
        setConnections(rest);
    };
    const addSuggestion = (suggestion: ConnectionSuggestion, atIndex?: number) => {
        const next = [...connections];
        const connection = buildConnectionForTarget(suggestion.target, suggestion.stop, next.length + 1);
        next.splice(atIndex === undefined ? next.length : Math.max(0, Math.min(atIndex, next.length)), 0, connection);
        setConnections(next);
        setSelectedId(connection.id);
    };

    const addFromDialog = (incoming: NewTargetInput, stop: StopInfo, connectionType: ConnectionType) => {
        const base = connectionLibrary ?? emptyLibrary(userId);
        const { library, target } = upsertTargetForDay(base, incoming, dayType, userId);
        setConnectionLibrary(library);
        saveConnectionLibrary(teamId, library, userId).catch(error => console.error('Could not save the connection library', error));
        const connection = { ...buildConnectionForTarget(target, stop, connections.length + 1), connectionType };
        setConnections([...connections.filter(item => item.targetId !== target.id || item.stopCode !== stop.code), connection]);
        setSelectedId(connection.id);
        setAddOpen(false);
    };

    const runOptimizer = () => {
        if (!model) return;
        const result = optimizeRankedConnections(model, { maxShiftMinutes: maxShift, minRecoveryRatio: keepRecovery ? 0.1 : 0 });
        setPending({ result, model });
        setView('after');
    };

    const applyPending = () => {
        if (!pending) return;
        const next = applyTripShifts(schedules, pending.model, pending.result.shifts);
        const after = sumTotals(pending.result.after);
        onApply(next, { movedTrips: pending.result.movedTripIds.length, met: after.met, total: after.total });
        setRouteConnectionConfig({ ...(routeConnectionConfig ?? { routeIdentity, connections }), lastOptimized: new Date().toISOString() });
        clearPending();
    };

    const saveAsRouteDefault = async () => {
        if (!routeConnectionConfig) return;
        setSaveState('saving');
        try {
            await saveRouteConnectionConfig(teamId, routeIdentity, { ...routeConnectionConfig, connections });
            setSaveState('saved');
        } catch {
            setSaveState('error');
        }
    };

    const showingAfter = view === 'after' && !!pending;
    const timelineEvaluations = showingAfter ? pending!.result.after : evaluations;
    const selectedEvaluation = (showingAfter ? afterById.get(selectedId ?? '') : undefined)
        ?? timelineEvaluations.find(item => item.connection.id === selectedId)
        ?? allEvaluations.get(selectedId ?? '')
        ?? null;
    const names = new Map(connections.map(connection => [connection.id, dayLibrary?.targets.find(target => target.id === connection.targetId)?.name ?? 'Connection']));
    const rankOf = new Map(evaluations.map(item => [item.connection.id, item.rank] as const));

    if (!dayLibrary || !routeConnectionConfig) {
        return <p className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading connections…</p>;
    }

    return (
        <div className="space-y-3" data-testid="guided-connections">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold text-gray-900"><Link2 className="h-4 w-4 text-blue-600" /> Connections · {dayType}</h3>
                <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="connections-score">
                    {evaluations.length === 0 ? (
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">No connections on yet</span>
                    ) : (
                        <>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{totals.met} met</span>
                            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{totals.tight + totals.long} tight or long</span>
                            <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">{totals.missed} missed</span>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={saveAsRouteDefault}
                        disabled={saveState === 'saving'}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        title={`Save these connections and their ranking as ${routeLabel} ${dayType}'s default. The master schedule editor uses it too.`}
                    >
                        <Save className="h-3.5 w-3.5" />
                        {saveState === 'saved' ? 'Saved as route default' : saveState === 'error' ? 'Save failed · retry' : 'Save as route default'}
                    </button>
                </div>
            </div>

            {bannerOpen && (startedFrom || suggestions.length > 0) && (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    <Sparkles className="h-4 w-4 flex-none text-blue-600" />
                    <p className="flex-1">
                        {startedFrom && <><b>Started from {startedFrom}.</b> </>}
                        {suggestions.length > 0 && <>Found {suggestions.length} likely {suggestions.length === 1 ? 'match' : 'matches'} at stops {routeLabel} serves.</>}
                    </p>
                    {suggestions.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setConnections([...connections, ...suggestions.map((item, index) => buildConnectionForTarget(item.target, item.stop, connections.length + index + 1))])}
                            className="rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-bold text-blue-800 hover:bg-blue-100"
                        >
                            Use all suggestions
                        </button>
                    )}
                    <button type="button" aria-label="Dismiss" onClick={() => setBannerOpen(false)} className="text-blue-500 hover:text-blue-800"><X className="h-4 w-4" /></button>
                </div>
            )}

            <div className="grid gap-3 lg:grid-cols-[minmax(360px,420px)_1fr]">
                <div className="rounded-xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-200 px-3 py-2">
                        <p className="text-sm font-bold text-gray-900">Connections</p>
                        <p className="text-xs text-gray-500">#1 is protected first when you optimize.</p>
                    </div>
                    <ConnectionRankList
                        routeLabel={routeLabel}
                        dayType={dayType}
                        cards={cards}
                        suggestions={suggestions}
                        routeStops={routeStops}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onUpdate={updateConnection}
                        onRemove={removeConnection}
                        onReorder={reorder}
                        onAddSuggestion={addSuggestion}
                    />
                    <div className="px-2 pb-3">
                        <button
                            type="button"
                            onClick={() => setAddOpen(true)}
                            className="flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                            <Plus className="h-4 w-4" /> Add connection
                        </button>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="rounded-xl border border-gray-200 bg-white">
                        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2">
                            <p className="text-sm font-bold text-gray-900">
                                {selectedEvaluation ? `${selectedEvaluation.target?.name ?? 'Connection'} at ${selectedEvaluation.connection.stopName ?? routeStops.find(stop => stop.code === selectedEvaluation.connection.stopCode)?.name ?? ''}` : 'Timeline'}
                            </p>
                            {showingAfter && <span className="text-xs text-gray-500">Showing the result before you apply</span>}
                            <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
                                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" />Met</span>
                                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Tight or long</span>
                                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-600" />Missed</span>
                                <div className="inline-flex overflow-hidden rounded-md border border-gray-200" role="group" aria-label="Timeline view">
                                    <button type="button" onClick={() => setView('now')} className={`px-2 py-0.5 text-xs font-bold ${!showingAfter ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>Now</button>
                                    <button type="button" disabled={!pending} onClick={() => setView('after')} className={`px-2 py-0.5 text-xs font-bold disabled:opacity-40 ${showingAfter ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>After optimizing</button>
                                </div>
                            </div>
                        </div>
                        <ConnectionTimeline
                            routeLabel={routeLabel}
                            evaluation={selectedEvaluation}
                            allEvaluations={timelineEvaluations}
                            movedTrips={pending?.result.shifts ?? {}}
                            showingAfter={showingAfter}
                        />
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                        <p className="text-sm font-bold text-gray-900">Optimize by priority</p>
                        <p className="text-xs text-gray-500">Fixes misses in rank order by moving single trips. A move is made only if it keeps every connection of the same or higher rank that is already met. Nothing changes until you apply.</p>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                            <label className="flex items-center gap-2">
                                Move a trip at most
                                <input type="range" min={1} max={10} value={maxShift} onChange={event => { setMaxShift(Number(event.target.value)); clearPending(); }} aria-label="Largest trip move in minutes" />
                                <b>{maxShift} min</b>
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={keepRecovery} onChange={event => { setKeepRecovery(event.target.checked); clearPending(); }} />
                                Keep recovery ≥ 10% of travel time
                            </label>
                            <button
                                type="button"
                                onClick={runOptimizer}
                                disabled={evaluations.length === 0}
                                className="ml-auto rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-40"
                            >
                                Optimize by priority
                            </button>
                        </div>

                        {pending && (
                            <div className="mt-3 border-t border-gray-200 pt-3" data-testid="optimize-result">
                                <div className="mb-2 flex items-center gap-2">
                                    <b className="text-sm">{pending.result.movedTripIds.length} {pending.result.movedTripIds.length === 1 ? 'trip' : 'trips'} would move</b>
                                    <span className="ml-auto flex gap-2">
                                        <button type="button" onClick={clearPending} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50">Discard</button>
                                        <button type="button" onClick={applyPending} disabled={pending.result.movedTripIds.length === 0} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">Apply</button>
                                    </span>
                                </div>
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                                            <th className="py-1 pr-2">Rank</th><th className="py-1 pr-2">Connection</th><th className="py-1 pr-2">Met now</th><th className="py-1 pr-2">Met after</th><th className="py-1">Change</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pending.result.after.map((item, index) => {
                                            const before = pending.result.before[index].totals;
                                            const delta = item.totals.met - before.met;
                                            return (
                                                <tr key={item.connection.id} className="border-t border-gray-100">
                                                    <td className="py-1 pr-2 font-bold">#{item.rank}</td>
                                                    <td className="py-1 pr-2">{item.target?.name}</td>
                                                    <td className="py-1 pr-2">{before.met}/{before.total}</td>
                                                    <td className="py-1 pr-2">{item.totals.met}/{item.totals.total}</td>
                                                    <td className={`py-1 font-bold ${delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-red-600' : 'text-gray-500'}`}>{delta > 0 ? `+${delta}` : delta < 0 ? delta : 'no change'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {pending.result.unfixed.length > 0 && (
                                    <div className="mt-2">
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Not fixed, and why ({pending.result.unfixed.length})</p>
                                        <ul className="ml-5 list-disc text-xs text-gray-700">
                                            {pending.result.unfixed.slice(0, 8).map(item => <li key={`${item.connectionId}|${item.targetTime}`}>{describeUnfixed(item, names, rankOf)}</li>)}
                                            {pending.result.unfixed.length > 8 && <li className="text-gray-500">+ {pending.result.unfixed.length - 8} more</li>}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <AddConnectionDialog
                isOpen={addOpen}
                onClose={() => setAddOpen(false)}
                routeNumber={routeNumber}
                routeLabel={routeLabel}
                dayType={dayType}
                routeStops={routeStops}
                teamId={teamId}
                onAdd={addFromDialog}
            />
        </div>
    );
};
