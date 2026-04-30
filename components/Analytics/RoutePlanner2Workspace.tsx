import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Download, Plus, Route, Save, Star, Trash2 } from 'lucide-react';

import {
    addRoutePlanner2LineWaypoint,
    addRoutePlanner2Stop,
    clearRoutePlanner2SegmentRuntimeOverride,
    deleteRoutePlanner2Stop,
    moveRoutePlanner2Stop,
    renameRoutePlanner2Stop,
    setRoutePlanner2SegmentRuntimeOverride,
    updateRoutePlanner2LineWaypointCoordinate,
    updateRoutePlanner2SegmentRuntimeEstimates,
    updateRoutePlanner2StopCoordinate,
    updateRoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Authoring';
import { updateRoutePlanner2Service } from '../../utils/route-planner-2/routePlanner2Feasibility';
import {
    addRoutePlanner2Scenario,
    deleteRoutePlanner2Scenario,
    duplicateRoutePlanner2Scenario,
    markRoutePlanner2PreferredScenario,
    renameRoutePlanner2Project,
    renameRoutePlanner2Scenario,
    selectRoutePlanner2Scenario,
} from '../../utils/route-planner-2/routePlanner2ProjectController';
import { createRoutePlanner2Project } from '../../utils/route-planner-2/routePlanner2ProjectFactory';
import { summarizeRoutePlanner2Project } from '../../utils/route-planner-2/routePlanner2Summary';
import { RoutePlanner2MapCanvas } from './route-planner-2/RoutePlanner2MapCanvas';
import type {
    RoutePlanner2Project,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2ServiceAssumptions,
    RoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Types';

interface RoutePlanner2WorkspaceProps {
    onBack: () => void;
    userId?: string | null;
    teamId?: string | null;
}

function formatRuntime(minutes: number | null | undefined): string {
    return minutes != null ? `${minutes} min` : 'Not estimated';
}

function formatBuses(value: number | null | undefined): string {
    return value != null ? String(value) : '-';
}

function confidenceClass(confidence: string): string {
    if (confidence === 'low') return 'bg-amber-100 text-amber-700';
    if (confidence === 'not-ready') return 'bg-slate-100 text-slate-600';
    return 'bg-emerald-100 text-emerald-700';
}

function readinessClass(readiness: string): string {
    if (readiness === 'needs-review') return 'border-amber-200 bg-amber-50 text-amber-900';
    if (readiness === 'ready-for-review') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    return 'border-slate-200 bg-slate-50 text-slate-800';
}

function updateScenarioNotes(
    project: RoutePlanner2Project,
    scenarioId: string,
    notes: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId || scenario.notes === notes) return scenario;
        changed = true;
        return { ...scenario, notes, updatedAt: now };
    });

    return changed ? {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        scenarios,
        updatedAt: now,
    } : project;
}

export const RoutePlanner2Workspace: React.FC<RoutePlanner2WorkspaceProps> = ({ onBack, teamId }) => {
    const [project, setProject] = useState<RoutePlanner2Project>(() => createRoutePlanner2Project());
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

    const projectSummary = useMemo(() => summarizeRoutePlanner2Project(project), [project]);
    const selectedScenario = useMemo(
        () => project.scenarios.find((scenario) => scenario.id === project.selectedScenarioId) ?? project.scenarios[0],
        [project.scenarios, project.selectedScenarioId],
    );
    const selectedScenarioSummary = projectSummary.selectedScenarioSummary;
    const selectedFeasibility = selectedScenarioSummary?.feasibility ?? null;
    const selectedStop = useMemo(
        () => selectedScenario?.stops.find((stop) => stop.id === selectedStopId) ?? null,
        [selectedScenario?.stops, selectedStopId],
    );

    useEffect(() => {
        if (!selectedScenario) {
            setSelectedStopId(null);
            return;
        }
        if (selectedStopId && selectedScenario.stops.some((stop) => stop.id === selectedStopId)) return;
        setSelectedStopId(selectedScenario.stops[0]?.id ?? null);
    }, [selectedScenario, selectedStopId]);

    function getNextAuthoringCoordinate() {
        const pointCount = selectedScenario?.alignment.length ?? 0;
        const stopCount = selectedScenario?.stops.length ?? 0;
        const index = Math.max(pointCount, stopCount) + 1;
        return {
            lat: Number((44.379 + (index * 0.006)).toFixed(6)),
            lng: Number((-79.701 + (index * 0.007)).toFixed(6)),
        };
    }

    function addStop(coordinate = getNextAuthoringCoordinate()) {
        if (!selectedScenario) return;
        const stopNumber = selectedScenario.stops.length + 1;
        const stopId = `stop-${Date.now()}-${stopNumber}`;
        setProject((current) => addRoutePlanner2Stop(current, selectedScenario.id, {
            id: stopId,
            name: `Stop ${stopNumber}`,
            ...coordinate,
        }));
        setSelectedStopId(stopId);
    }

    function updateService(patch: Partial<RoutePlanner2ServiceAssumptions>) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2Service(current, selectedScenario.id, patch));
    }

    function updateNumericServiceField(
        key: 'frequencyMinutes' | 'startTerminalLayoverMinutes' | 'endTerminalLayoverMinutes' | 'intermediateStopDwellSeconds',
        value: string,
    ) {
        updateService({ [key]: Number(value) } as Partial<RoutePlanner2ServiceAssumptions>);
    }

    function updateSelectedStopRole(role: RoutePlanner2StopRole) {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => updateRoutePlanner2StopRole(current, selectedScenario.id, selectedStop.id, role));
    }

    function renameSelectedStop(name: string) {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => renameRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, name));
    }

    function deleteStop(stopId: string) {
        if (!selectedScenario) return;
        const remainingStops = selectedScenario.stops.filter((stop) => stop.id !== stopId);

        setProject((current) => deleteRoutePlanner2Stop(current, selectedScenario.id, stopId));

        if (selectedStopId === stopId) {
            setSelectedStopId(remainingStops[0]?.id ?? null);
        }
    }

    function deleteSelectedStop() {
        if (!selectedStop) return;
        deleteStop(selectedStop.id);
    }

    function moveStop(stopId: string, coordinate: { lat: number; lng: number }) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2StopCoordinate(current, selectedScenario.id, stopId, coordinate));
        setSelectedStopId(stopId);
    }

    function addLineWaypoint(placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        coordinate: { lat: number; lng: number };
    }) {
        if (!selectedScenario) return;
        setProject((current) => addRoutePlanner2LineWaypoint(current, selectedScenario.id, {
            afterStopId: placement.fromStopId,
            beforeStopId: placement.toStopId,
            insertAfterWaypointId: placement.insertAfterWaypointId,
            insertBeforeWaypointId: placement.insertBeforeWaypointId,
            ...placement.coordinate,
        }));
    }

    function moveLineWaypoint(waypointId: string, coordinate: { lat: number; lng: number }) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2LineWaypointCoordinate(current, selectedScenario.id, waypointId, coordinate));
    }

    function updateSegmentRuntimeOverride(segmentId: string, value: string) {
        if (!selectedScenario) return;
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            setProject((current) => clearRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId));
            return;
        }
        const runtimeMinutes = Number(trimmedValue);
        setProject((current) => setRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId, runtimeMinutes));
    }

    function clearSegmentRuntimeOverride(segmentId: string) {
        if (!selectedScenario) return;
        setProject((current) => clearRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId));
    }

    const selectedScenarioId = selectedScenario?.id;
    const updateSegmentRuntimeEstimates = useCallback((estimates: RoutePlanner2SegmentRuntime[]) => {
        if (!selectedScenarioId || estimates.length === 0) return;
        setProject((current) => updateRoutePlanner2SegmentRuntimeEstimates(current, selectedScenarioId, estimates));
    }, [selectedScenarioId]);

    return (
        <div className="h-full overflow-hidden bg-slate-100">
            <div className="flex h-full flex-col">
                <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={onBack} aria-label="Back to Planning Data" className="rounded-xl border border-slate-200 p-2">
                                <ArrowLeft size={18} />
                            </button>
                            <div>
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">
                                    <Route size={20} />
                                    Route Planner 2
                                </div>
                                <input
                                    value={project.name}
                                    onChange={(event) => setProject((current) => renameRoutePlanner2Project(current, event.target.value))}
                                    aria-label="Project name"
                                    className="mt-1 w-full max-w-xl rounded-xl border border-transparent bg-transparent text-2xl font-black text-slate-900"
                                />
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-700">Fresh workspace</span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Local draft</span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Team: {teamId ?? 'not set'}</span>
                            <button type="button" disabled className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold opacity-60"><Save size={16} />Save later</button>
                            <button type="button" onClick={() => selectedScenario && setProject((current) => duplicateRoutePlanner2Scenario(current, selectedScenario.id))} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold"><Copy size={16} />Duplicate</button>
                            <button type="button" disabled className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white opacity-60"><Download size={16} />Export later</button>
                        </div>
                    </div>
                </header>

                <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[320px_minmax(420px,1fr)_390px]">
                    <aside className="space-y-4">
                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-black text-slate-900">Project foundation</h2>
                                <span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-bold uppercase text-cyan-700">MVP</span>
                            </div>
                            <p className="text-sm leading-6 text-slate-600">
                                Local-first route concepts with stop authoring, feasibility estimates, comparison, and summary review.
                                Firebase persistence and schedule handoff stay future work.
                            </p>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <div className="text-xs font-bold uppercase text-slate-500">Routes</div>
                                    <div className="mt-1 text-lg font-black">{projectSummary.totalScenarios}</div>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <div className="text-xs font-bold uppercase text-slate-500">Comparable</div>
                                    <div className="mt-1 text-lg font-black">{projectSummary.comparableScenarioCount}</div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-black text-slate-900">Routes</h2>
                                <button type="button" onClick={() => setProject((current) => addRoutePlanner2Scenario(current))} className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700">
                                    <Plus size={12} /> Add route
                                </button>
                            </div>
                            <div className="space-y-2">
                                {project.scenarios.map((scenario) => {
                                    const summary = projectSummary.scenarioSummaries.find((item) => item.scenarioId === scenario.id);
                                    const isSelected = selectedScenario?.id === scenario.id;
                                    return (
                                        <button
                                            key={scenario.id}
                                            type="button"
                                            onClick={() => setProject((current) => selectRoutePlanner2Scenario(current, scenario.id))}
                                            className={`w-full rounded-2xl border p-3 text-left ${isSelected ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-white'}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-bold text-slate-900">{scenario.name}</span>
                                                <span className="flex gap-1">
                                                    {summary?.isPreferred && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Preferred</span>}
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{scenario.status}</span>
                                                </span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                                                <span>{scenario.stops.length} stops</span>
                                                <span>{summary?.oneWayRuntimeLabel ?? 'Not ready'}</span>
                                                <span>{summary?.readinessLabel ?? 'Not ready'}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    </aside>

                    <RoutePlanner2MapCanvas
                        scenario={selectedScenario}
                        selectedStopId={selectedStopId}
                        onSelectStop={setSelectedStopId}
                        onAddStop={addStop}
                        onDeleteStop={deleteStop}
                        onMoveStop={moveStop}
                        onAddLineWaypoint={addLineWaypoint}
                        onMoveLineWaypoint={moveLineWaypoint}
                        onSegmentRuntimeEstimates={updateSegmentRuntimeEstimates}
                        onAddNextStop={() => addStop()}
                    />

                    <aside className="space-y-4">
                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-black text-slate-900">Selected route</h2>
                                {selectedScenarioSummary?.isPreferred && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Preferred</span>}
                            </div>

                            {selectedScenario && selectedScenarioSummary ? (
                                <div className="mt-4 space-y-4">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-scenario-name">
                                        Route name
                                        <input id="rp2-scenario-name" value={selectedScenario.name} onChange={(event) => setProject((current) => renameRoutePlanner2Scenario(current, selectedScenario.id, event.target.value))} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900" />
                                    </label>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">Runtime</div><div className="mt-1 text-lg font-black">{formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes)}</div></div>
                                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">Cycle</div><div className="mt-1 text-lg font-black">{formatRuntime(selectedFeasibility?.cycleTimeMinutes)}</div></div>
                                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">Buses</div><div className="mt-1 text-lg font-black">{formatBuses(selectedFeasibility?.busesRequired)}</div></div>
                                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">Dwell</div><div className="mt-1 text-lg font-black">{formatRuntime(selectedFeasibility?.dwellTimeMinutes ?? 0)}</div></div>
                                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">Confidence</div><div className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-black uppercase ${confidenceClass(selectedFeasibility?.confidence ?? 'not-ready')}`}>{selectedFeasibility?.confidence ?? 'not-ready'}</div></div>
                                    </div>

                                    <div className={`rounded-2xl border p-3 ${readinessClass(selectedScenarioSummary.readiness)}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="text-sm font-black">Planning summary</h3>
                                            <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-black uppercase">{selectedScenarioSummary.readinessLabel}</span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6">{selectedScenarioSummary.summaryText}</p>
                                        <p className="mt-2 text-xs font-bold">Next: {selectedScenarioSummary.nextAction}</p>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                        <h3 className="text-sm font-black text-slate-900">Service assumptions</h3>
                                        <div className="mt-3 grid grid-cols-2 gap-3">
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">First trip<input type="time" value={selectedScenario.service.firstTripTime} onChange={(event) => updateService({ firstTripTime: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Last trip<input type="time" value={selectedScenario.service.lastTripTime} onChange={(event) => updateService({ lastTripTime: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Frequency<input type="number" min="0" value={selectedScenario.service.frequencyMinutes} onChange={(event) => updateNumericServiceField('frequencyMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Start layover<input type="number" value={selectedScenario.service.startTerminalLayoverMinutes} onChange={(event) => updateNumericServiceField('startTerminalLayoverMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">End layover<input type="number" value={selectedScenario.service.endTerminalLayoverMinutes} onChange={(event) => updateNumericServiceField('endTerminalLayoverMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Dwell / stop sec<input type="number" min="0" value={selectedScenario.service.intermediateStopDwellSeconds ?? 0} onChange={(event) => updateNumericServiceField('intermediateStopDwellSeconds', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                        </div>
                                        <p className="mt-2 text-xs leading-5 text-slate-500">
                                            Dwell is added for intermediate stops only. Terminal layover stays separate.
                                        </p>
                                    </div>

                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-notes">
                                        Planner notes
                                        <textarea id="rp2-notes" value={selectedScenario.notes} onChange={(event) => setProject((current) => updateScenarioNotes(current, selectedScenario.id, event.target.value))} rows={5} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700" />
                                    </label>

                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">Selected stop</h3><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-500">{selectedScenario.stops.length} stops</span></div>
                                        {selectedStop ? (
                                            <div className="space-y-3">
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-name">Stop name<input id="rp2-stop-name" value={selectedStop.name} onChange={(event) => renameSelectedStop(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold" /></label>
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-role">Stop role<select id="rp2-stop-role" value={selectedStop.role} onChange={(event) => updateSelectedStopRole(event.target.value as RoutePlanner2StopRole)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"><option value="regular">Regular stop</option><option value="timed">Timed stop</option><option value="start-terminal">Start terminal</option><option value="end-terminal">End terminal</option></select></label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <button type="button" onClick={() => selectedScenario && selectedStop && setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, 'up'))} className="rounded-xl border bg-white px-2 py-2 text-xs font-bold">Up</button>
                                                    <button type="button" onClick={() => selectedScenario && selectedStop && setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, 'down'))} className="rounded-xl border bg-white px-2 py-2 text-xs font-bold">Down</button>
                                                    <button type="button" onClick={deleteSelectedStop} className="rounded-xl border border-red-200 bg-white px-2 py-2 text-xs font-bold text-red-700">Remove</button>
                                                </div>
                                            </div>
                                        ) : <p className="text-sm leading-6 text-slate-500">Add a stop from the map canvas, then mark terminal roles here.</p>}
                                    </div>

                                    <div className={`rounded-2xl border p-3 ${(selectedFeasibility?.warnings.length ?? 0) > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                                        <h3 className="text-sm font-black text-amber-900">Feasibility warnings</h3>
                                        {(selectedFeasibility?.warnings.length ?? 0) > 0 ? (
                                            <ul className="mt-2 space-y-2">
                                                {selectedFeasibility?.warnings.map((warning) => (
                                                    <li key={warning.id} className="text-sm leading-5 text-amber-800">
                                                        {warning.message}
                                                        {warning.action && <span className="block text-xs font-semibold text-amber-700">{warning.action}</span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : <p className="mt-2 text-sm text-emerald-800">Route has enough inputs for a segment travel-time estimate.</p>}
                                    </div>

                                    {selectedFeasibility && selectedFeasibility.segmentSummaries.length > 0 && (
                                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                            <h3 className="text-sm font-black text-slate-900">Segment runtimes</h3>
                                            <div className="mt-2 space-y-2">
                                                {selectedFeasibility.segmentSummaries.map((segment) => {
                                                    const fromStop = selectedScenario.stops.find((stop) => stop.id === segment.fromStopId);
                                                    const toStop = selectedScenario.stops.find((stop) => stop.id === segment.toStopId);
                                                    return (
                                                        <div key={segment.id} className="rounded-xl bg-slate-50 p-2 text-xs text-slate-600">
                                                            <div className="font-bold text-slate-800">{fromStop?.name ?? 'Unknown'} to {toStop?.name ?? 'Unknown'}: {formatRuntime(segment.runtimeMinutes)}</div>
                                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                                <span>{segment.source} / {segment.confidence}</span>
                                                                {segment.distanceKm != null && <span>{segment.distanceKm.toFixed(2)} km</span>}
                                                            </div>
                                                            <div className="mt-2 flex items-end gap-2">
                                                                <label className="min-w-0 flex-1 font-bold uppercase tracking-wide text-slate-500">
                                                                    Override min
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        step="1"
                                                                        value={segment.source === 'manual' ? segment.runtimeMinutes ?? '' : ''}
                                                                        placeholder={segment.runtimeMinutes != null ? String(segment.runtimeMinutes) : 'Min'}
                                                                        onChange={(event) => updateSegmentRuntimeOverride(segment.id, event.target.value)}
                                                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-900"
                                                                        aria-label={`Override runtime for ${fromStop?.name ?? 'segment'} to ${toStop?.name ?? 'segment'}`}
                                                                    />
                                                                </label>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => clearSegmentRuntimeOverride(segment.id)}
                                                                    disabled={segment.source !== 'manual'}
                                                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 disabled:opacity-40"
                                                                >
                                                                    Clear
                                                                </button>
                                                            </div>
                                                            {segment.source === 'mapbox' && (
                                                                <div className="mt-1 text-[11px] font-semibold text-cyan-700">Mapbox planning estimate</div>
                                                            )}
                                                            {segment.source === 'manual' && (
                                                                <div className="mt-1 text-[11px] font-semibold text-emerald-700">Planner override</div>
                                                            )}
                                                            {segment.fallbackReason && (
                                                                <div className="mt-1 text-[11px] font-semibold text-amber-700">{segment.fallbackReason}</div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setProject((current) => markRoutePlanner2PreferredScenario(current, selectedScenario.id))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"><Star size={16} />Mark preferred</button>
                                        <button type="button" onClick={() => setProject((current) => deleteRoutePlanner2Scenario(current, selectedScenario.id))} disabled={project.scenarios.length <= 1} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50"><Trash2 size={16} />Delete</button>
                                    </div>
                                </div>
                            ) : <p className="mt-3 text-sm text-slate-500">Select a route to edit details.</p>}
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-black text-slate-900">Route comparison</h2>
                            <div className={`mt-3 rounded-2xl border p-3 ${readinessClass(projectSummary.preferredScenarioSummary?.readiness ?? 'not-ready')}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-black">Preferred route summary</h3>
                                    {projectSummary.preferredScenarioSummary && <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-black uppercase">{projectSummary.preferredScenarioSummary.readinessLabel}</span>}
                                </div>
                                {projectSummary.preferredScenarioSummary ? (
                                    <div>
                                        <p className="mt-2 text-sm leading-6">{projectSummary.preferredScenarioSummary.summaryText}</p>
                                        <p className="mt-2 text-xs font-bold">Next: {projectSummary.preferredScenarioSummary.nextAction}</p>
                                    </div>
                                ) : <p className="mt-2 text-sm leading-6">No preferred route yet. Build a route with terminals and feasibility outputs, then mark it preferred.</p>}
                            </div>
                            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                                <table className="w-full min-w-[520px] text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr><th className="px-3 py-2 font-bold">Route</th><th className="px-3 py-2 font-bold">Stops</th><th className="px-3 py-2 font-bold">Runtime</th><th className="px-3 py-2 font-bold">Cycle</th><th className="px-3 py-2 font-bold">Buses</th><th className="px-3 py-2 font-bold">State</th><th className="px-3 py-2 font-bold">Warnings</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {projectSummary.scenarioSummaries.map((summary) => (
                                            <tr key={summary.scenarioId} className={summary.scenarioId === project.selectedScenarioId ? 'bg-cyan-50/50' : undefined}>
                                                <td className="px-3 py-2 font-semibold text-slate-800">{summary.scenarioName}{summary.isPreferred ? ' (preferred)' : ''}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.stopsLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.oneWayRuntimeLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.cycleTimeLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.busesRequiredLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.readinessLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.warningCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </aside>
                </main>
            </div>
        </div>
    );
};
