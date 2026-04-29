import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    CircleDot,
    Copy,
    Download,
    Layers3,
    MapPinned,
    Plus,
    Route,
    Save,
    Star,
    Trash2,
    TriangleAlert,
} from 'lucide-react';

import { createRoutePlanner2Project } from '../../utils/route-planner-2/routePlanner2ProjectFactory';
import {
    addRoutePlanner2Scenario,
    deleteRoutePlanner2Scenario,
    duplicateRoutePlanner2Scenario,
    markRoutePlanner2PreferredScenario,
    renameRoutePlanner2Project,
    renameRoutePlanner2Scenario,
    selectRoutePlanner2Scenario,
} from '../../utils/route-planner-2/routePlanner2ProjectController';
import {
    addRoutePlanner2RoutePoint,
    addRoutePlanner2Stop,
    deleteRoutePlanner2Stop,
    moveRoutePlanner2Stop,
    renameRoutePlanner2Stop,
    updateRoutePlanner2StopRole,
    validateRoutePlanner2Terminals,
} from '../../utils/route-planner-2/routePlanner2Authoring';
import type {
    RoutePlanner2Project,
    RoutePlanner2Scenario,
    RoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Types';

interface RoutePlanner2WorkspaceProps {
    onBack: () => void;
    userId?: string | null;
    teamId?: string | null;
}

const STATUS_STYLES = {
    draft: 'bg-slate-100 text-slate-700',
    review: 'bg-amber-100 text-amber-700',
} as const;

function formatRuntime(minutes: number | null | undefined): string {
    return minutes != null ? `${minutes} min` : 'Not estimated';
}

function formatBuses(value: number | null | undefined): string {
    return value != null ? String(value) : '—';
}

function getScenarioWarningCount(scenario: RoutePlanner2Scenario): number {
    return (scenario.feasibility?.warnings.length ?? 0) + validateRoutePlanner2Terminals(scenario).length;
}

function formatStopRole(role: RoutePlanner2StopRole): string {
    if (role === 'start-terminal') return 'Start terminal';
    if (role === 'end-terminal') return 'End terminal';
    if (role === 'timed') return 'Timed stop';
    return 'Regular stop';
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

    return changed
        ? {
            ...project,
            status: project.status === 'archived' ? 'archived' : 'local-draft',
            scenarios,
            updatedAt: now,
        }
        : project;
}

export const RoutePlanner2Workspace: React.FC<RoutePlanner2WorkspaceProps> = ({ onBack, teamId }) => {
    const [project, setProject] = useState<RoutePlanner2Project>(() => createRoutePlanner2Project());
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

    const selectedScenario = useMemo(
        () => project.scenarios.find((scenario) => scenario.id === project.selectedScenarioId) ?? project.scenarios[0],
        [project.scenarios, project.selectedScenarioId],
    );
    const selectedStop = useMemo(
        () => selectedScenario?.stops.find((stop) => stop.id === selectedStopId) ?? null,
        [selectedScenario?.stops, selectedStopId],
    );
    const terminalWarnings = useMemo(
        () => selectedScenario ? validateRoutePlanner2Terminals(selectedScenario) : [],
        [selectedScenario],
    );

    useEffect(() => {
        if (!selectedScenario) {
            setSelectedStopId(null);
            return;
        }

        if (selectedStopId && selectedScenario.stops.some((stop) => stop.id === selectedStopId)) return;
        setSelectedStopId(selectedScenario.stops[0]?.id ?? null);
    }, [selectedScenario, selectedStopId]);

    function addScenario() {
        setProject((current) => addRoutePlanner2Scenario(current));
    }

    function duplicateSelectedScenario() {
        if (!selectedScenario) return;
        setProject((current) => duplicateRoutePlanner2Scenario(current, selectedScenario.id));
    }

    function deleteSelectedScenario() {
        if (!selectedScenario) return;
        setProject((current) => deleteRoutePlanner2Scenario(current, selectedScenario.id));
    }

    function markSelectedPreferred() {
        if (!selectedScenario) return;
        setProject((current) => markRoutePlanner2PreferredScenario(current, selectedScenario.id));
    }

    function getNextAuthoringCoordinate() {
        const pointCount = selectedScenario?.alignment.length ?? 0;
        const stopCount = selectedScenario?.stops.length ?? 0;
        const index = Math.max(pointCount, stopCount) + 1;

        return {
            lat: Number((44.379 + (index * 0.006)).toFixed(6)),
            lng: Number((-79.701 + (index * 0.007)).toFixed(6)),
        };
    }

    function addAlignmentPoint() {
        if (!selectedScenario) return;
        const coordinate = getNextAuthoringCoordinate();
        const pointNumber = selectedScenario.alignment.length + 1;
        setProject((current) => addRoutePlanner2RoutePoint(current, selectedScenario.id, {
            id: `point-${Date.now()}-${pointNumber}`,
            ...coordinate,
        }));
    }

    function addStop() {
        if (!selectedScenario) return;
        const coordinate = getNextAuthoringCoordinate();
        const stopNumber = selectedScenario.stops.length + 1;
        const stopId = `stop-${Date.now()}-${stopNumber}`;

        setProject((current) => addRoutePlanner2Stop(current, selectedScenario.id, {
            id: stopId,
            name: `Stop ${stopNumber}`,
            ...coordinate,
        }));
        setSelectedStopId(stopId);
    }

    function updateSelectedStopRole(role: RoutePlanner2StopRole) {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => updateRoutePlanner2StopRole(current, selectedScenario.id, selectedStop.id, role));
    }

    function renameSelectedStop(name: string) {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => renameRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, name));
    }

    function moveSelectedStop(direction: 'up' | 'down') {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, direction));
    }

    function deleteSelectedStop() {
        if (!selectedScenario || !selectedStop) return;
        const deletedStopId = selectedStop.id;
        setProject((current) => deleteRoutePlanner2Stop(current, selectedScenario.id, deletedStopId));
        const remainingStops = selectedScenario.stops.filter((stop) => stop.id !== deletedStopId);
        setSelectedStopId(remainingStops[0]?.id ?? null);
    }

    return (
        <div className="h-full overflow-hidden bg-slate-100">
            <div className="flex h-full flex-col">
                <header className="shrink-0 border-b border-slate-200 bg-white/95 px-6 py-4 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <button
                                type="button"
                                onClick={onBack}
                                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700"
                                aria-label="Back to Planning Data"
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <Route size={20} className="text-cyan-600" />
                                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">
                                        Route Planner 2
                                    </span>
                                </div>
                                <input
                                    value={project.name}
                                    onChange={(event) => setProject((current) => renameRoutePlanner2Project(current, event.target.value))}
                                    className="mt-1 w-full max-w-xl truncate rounded-xl border border-transparent bg-transparent px-0 text-2xl font-black text-slate-900 outline-none focus:border-cyan-200 focus:bg-cyan-50/40 focus:px-3"
                                    aria-label="Project name"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-700">
                                Fresh workspace
                            </span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                Local draft
                            </span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                Team: {teamId ?? 'not set'}
                            </span>
                            <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 opacity-60"
                                disabled
                            >
                                <Save size={16} />
                                Save later
                            </button>
                            <button
                                type="button"
                                onClick={duplicateSelectedScenario}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-cyan-300 hover:text-cyan-700"
                            >
                                <Copy size={16} />
                                Duplicate
                            </button>
                            <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white opacity-60"
                                disabled
                            >
                                <Download size={16} />
                                Export later
                            </button>
                        </div>
                    </div>
                </header>

                <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[320px_minmax(420px,1fr)_380px]">
                    <aside className="space-y-4">
                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-black text-slate-900">Project foundation</h2>
                                <span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-bold uppercase text-cyan-700">
                                    MVP
                                </span>
                            </div>
                            <p className="text-sm leading-6 text-slate-600">
                                Blank route concepts only. This local-first workspace proves project and scenario flow before map authoring,
                                runtime intelligence, Firebase persistence, or schedule handoff.
                            </p>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <div className="text-xs font-bold uppercase text-slate-500">Scenarios</div>
                                    <div className="mt-1 text-lg font-black text-slate-900">{project.scenarios.length}</div>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <div className="text-xs font-bold uppercase text-slate-500">Chosen</div>
                                    <div className="mt-1 text-lg font-black text-slate-900">
                                        {project.preferredScenarioId ? '1' : '0'}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-black text-slate-900">Scenarios</h2>
                                <button
                                    type="button"
                                    onClick={addScenario}
                                    className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700 hover:bg-cyan-100"
                                >
                                    <Plus size={12} />
                                    Add scenario
                                </button>
                            </div>
                            <div className="space-y-2">
                                {project.scenarios.map((scenario) => {
                                    const isSelected = selectedScenario?.id === scenario.id;
                                    const isPreferred = project.preferredScenarioId === scenario.id;

                                    return (
                                        <button
                                            key={scenario.id}
                                            type="button"
                                            onClick={() => setProject((current) => selectRoutePlanner2Scenario(current, scenario.id))}
                                            className={`w-full rounded-2xl border p-3 text-left transition ${
                                                isSelected
                                                    ? 'border-cyan-300 bg-cyan-50'
                                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-bold text-slate-900">{scenario.name}</span>
                                                <span className="flex items-center gap-1">
                                                    {isPreferred && (
                                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                                                            Preferred
                                                        </span>
                                                    )}
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLES[scenario.status]}`}>
                                                        {scenario.status}
                                                    </span>
                                                </span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                                                <span>{scenario.stops.length} stops</span>
                                                <span>{formatRuntime(scenario.feasibility?.oneWayRuntimeMinutes)}</span>
                                                <span>{scenario.service.frequencyMinutes} min</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    </aside>

                    <section className="min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h2 className="text-sm font-black text-slate-900">Map canvas</h2>
                                <p className="text-xs text-slate-500">Stop-aware authoring is local-only for this MVP.</p>
                            </div>
                            <div className="flex gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                                    <Layers3 size={12} />
                                    Base map
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                                    <MapPinned size={12} />
                                    Stops
                                </span>
                            </div>
                        </div>

                        <div className="relative h-[calc(100%-57px)] min-h-[460px] bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.18),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#e2e8f0_100%)]">
                            <div className="absolute inset-6 rounded-[2rem] border border-white/70 bg-white/35 shadow-inner" />
                            <div className="absolute left-[18%] top-[22%] h-3 w-3 rounded-full bg-cyan-600 shadow-lg shadow-cyan-400/40" />
                            <div className="absolute left-[34%] top-[40%] h-3 w-3 rounded-full bg-cyan-600 shadow-lg shadow-cyan-400/40" />
                            <div className="absolute left-[58%] top-[48%] h-3 w-3 rounded-full bg-cyan-600 shadow-lg shadow-cyan-400/40" />
                            <div className="absolute left-[72%] top-[67%] h-3 w-3 rounded-full bg-cyan-600 shadow-lg shadow-cyan-400/40" />
                            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                <path
                                    d="M 18 22 C 28 24, 26 39, 34 40 S 51 43, 58 48 S 67 62, 72 67"
                                    fill="none"
                                    stroke="#0891b2"
                                    strokeWidth="5"
                                    strokeLinecap="round"
                                    strokeDasharray="12 12"
                                />
                            </svg>
                            <div className="absolute left-6 top-6 max-w-md rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={addAlignmentPoint}
                                        className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-700"
                                    >
                                        <Plus size={15} />
                                        Add route point
                                    </button>
                                    <button
                                        type="button"
                                        onClick={addStop}
                                        className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-bold text-cyan-700 hover:bg-cyan-100"
                                    >
                                        <MapPinned size={15} />
                                        Add stop
                                    </button>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-2xl bg-slate-50 p-3">
                                        <div className="font-bold uppercase text-slate-500">Route points</div>
                                        <div className="mt-1 text-lg font-black text-slate-900">
                                            {selectedScenario?.alignment.length ?? 0}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 p-3">
                                        <div className="font-bold uppercase text-slate-500">Stops</div>
                                        <div className="mt-1 text-lg font-black text-slate-900">
                                            {selectedScenario?.stops.length ?? 0}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {selectedScenario && selectedScenario.stops.length > 0 && (
                                <div className="absolute right-6 top-6 max-h-[360px] w-72 overflow-auto rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg">
                                    <h3 className="text-sm font-black text-slate-900">Stop order</h3>
                                    <div className="mt-3 space-y-2">
                                        {selectedScenario.stops.map((stop) => (
                                            <button
                                                key={stop.id}
                                                type="button"
                                                onClick={() => setSelectedStopId(stop.id)}
                                                className={`w-full rounded-2xl border p-3 text-left text-sm transition ${
                                                    selectedStop?.id === stop.id
                                                        ? 'border-cyan-300 bg-cyan-50'
                                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-bold text-slate-900">
                                                        {stop.sequence}. {stop.name}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs font-semibold text-slate-500">
                                                    {formatStopRole(stop.role)}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="absolute bottom-6 left-6 max-w-sm rounded-3xl border border-cyan-200 bg-white/95 p-4 shadow-lg">
                                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                                    <CircleDot size={16} className="text-cyan-600" />
                                    Alignment and stop editing are now local state
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-600">
                                    Use the authoring buttons to create an ordered concept, then mark start and end terminals in
                                    the stop editor. A full map click/drag surface can replace these controls later.
                                </p>
                            </div>
                        </div>
                    </section>

                    <aside className="space-y-4">
                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-black text-slate-900">Selected scenario</h2>
                                {selectedScenario && project.preferredScenarioId === selectedScenario.id && (
                                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                                        Preferred
                                    </span>
                                )}
                            </div>
                            {selectedScenario ? (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-scenario-name">
                                            Scenario name
                                        </label>
                                        <input
                                            id="rp2-scenario-name"
                                            value={selectedScenario.name}
                                            onChange={(event) => {
                                                const name = event.target.value;
                                                setProject((current) => renameRoutePlanner2Scenario(current, selectedScenario.id, name));
                                            }}
                                            className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl bg-slate-50 p-3">
                                            <div className="text-xs font-bold uppercase text-slate-500">Runtime</div>
                                            <div className="mt-1 text-lg font-black text-slate-900">
                                                {formatRuntime(selectedScenario.feasibility?.oneWayRuntimeMinutes)}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl bg-slate-50 p-3">
                                            <div className="text-xs font-bold uppercase text-slate-500">Buses</div>
                                            <div className="mt-1 text-lg font-black text-slate-900">
                                                {formatBuses(selectedScenario.feasibility?.busesRequired)}
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-notes">
                                            Planner notes
                                        </label>
                                        <textarea
                                            id="rp2-notes"
                                            value={selectedScenario.notes}
                                            onChange={(event) => {
                                                const notes = event.target.value;
                                                setProject((current) => updateScenarioNotes(current, selectedScenario.id, notes));
                                            }}
                                            rows={5}
                                            className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                        />
                                    </div>

                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="mb-3 flex items-center justify-between">
                                            <h3 className="text-sm font-black text-slate-900">Selected stop</h3>
                                            <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-500">
                                                {selectedScenario.stops.length} stops
                                            </span>
                                        </div>
                                        {selectedStop ? (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-name">
                                                        Stop name
                                                    </label>
                                                    <input
                                                        id="rp2-stop-name"
                                                        value={selectedStop.name}
                                                        onChange={(event) => renameSelectedStop(event.target.value)}
                                                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-role">
                                                        Stop role
                                                    </label>
                                                    <select
                                                        id="rp2-stop-role"
                                                        value={selectedStop.role}
                                                        onChange={(event) => updateSelectedStopRole(event.target.value as RoutePlanner2StopRole)}
                                                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                                    >
                                                        <option value="regular">Regular stop</option>
                                                        <option value="timed">Timed stop</option>
                                                        <option value="start-terminal">Start terminal</option>
                                                        <option value="end-terminal">End terminal</option>
                                                    </select>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveSelectedStop('up')}
                                                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 hover:border-cyan-300"
                                                    >
                                                        <ArrowUp size={14} />
                                                        Up
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveSelectedStop('down')}
                                                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 hover:border-cyan-300"
                                                    >
                                                        <ArrowDown size={14} />
                                                        Down
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={deleteSelectedStop}
                                                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-white px-2 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                                <div className="text-xs leading-5 text-slate-500">
                                                    Lat {selectedStop.lat.toFixed(4)}, Lng {selectedStop.lng.toFixed(4)}
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm leading-6 text-slate-500">
                                                Add a stop from the map canvas, then mark terminal roles here.
                                            </p>
                                        )}
                                    </div>

                                    <div className={`rounded-2xl border p-3 ${
                                        terminalWarnings.length > 0
                                            ? 'border-amber-200 bg-amber-50'
                                            : 'border-emerald-200 bg-emerald-50'
                                    }`}>
                                        <h3 className={`text-sm font-black ${
                                            terminalWarnings.length > 0 ? 'text-amber-900' : 'text-emerald-900'
                                        }`}>
                                            Terminal validation
                                        </h3>
                                        {terminalWarnings.length > 0 ? (
                                            <ul className="mt-2 space-y-2">
                                                {terminalWarnings.map((warning) => (
                                                    <li key={warning.id} className="text-sm leading-5 text-amber-800">
                                                        {warning.message}
                                                        {warning.action && (
                                                            <span className="block text-xs font-semibold text-amber-700">
                                                                {warning.action}
                                                            </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="mt-2 text-sm text-emerald-800">
                                                Start and end terminals are valid.
                                            </p>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={markSelectedPreferred}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
                                        >
                                            <Star size={16} />
                                            Mark preferred
                                        </button>
                                        <button
                                            type="button"
                                            onClick={deleteSelectedScenario}
                                            disabled={project.scenarios.length <= 1}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Trash2 size={16} />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-slate-500">Select a scenario to edit details.</p>
                            )}
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-black text-slate-900">Scenario comparison</h2>
                            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                            <th className="px-3 py-2 font-bold">Scenario</th>
                                            <th className="px-3 py-2 font-bold">Stops</th>
                                            <th className="px-3 py-2 font-bold">Runtime</th>
                                            <th className="px-3 py-2 font-bold">Buses</th>
                                            <th className="px-3 py-2 font-bold">Warnings</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {project.scenarios.map((scenario) => (
                                            <tr key={scenario.id}>
                                                <td className="px-3 py-2 font-semibold text-slate-800">
                                                    {scenario.name}
                                                    {project.preferredScenarioId === scenario.id ? ' ★' : ''}
                                                </td>
                                                <td className="px-3 py-2 text-slate-600">{scenario.stops.length}</td>
                                                <td className="px-3 py-2 text-slate-600">{formatRuntime(scenario.feasibility?.oneWayRuntimeMinutes)}</td>
                                                <td className="px-3 py-2 text-slate-600">{formatBuses(scenario.feasibility?.busesRequired)}</td>
                                                <td className="px-3 py-2 text-slate-600">{getScenarioWarningCount(scenario)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-start gap-3">
                                <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
                                <div>
                                    <h2 className="text-sm font-black text-amber-900">Restart boundary</h2>
                                    <p className="mt-1 text-sm leading-6 text-amber-800">
                                        Route Planner 2 is a clean module. It does not import old Route Planner controllers,
                                        draft storage, project services, or map editing logic.
                                    </p>
                                </div>
                            </div>
                        </section>
                    </aside>
                </main>
            </div>
        </div>
    );
};
