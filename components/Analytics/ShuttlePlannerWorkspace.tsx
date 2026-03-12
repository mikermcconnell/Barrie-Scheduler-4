import React from 'react';
import { ArrowLeft, Clock3, Cloud, Copy, FileDown, FolderOpen, Loader2, MapPinned, Move3D, Plus, Route, Save, Shuffle, TimerReset, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';
import { MapBase } from '../shared';
import { deriveShuttleProject, deriveShuttleScenario } from '../../utils/shuttle/shuttlePlanning';
import { createLocalStarterProject } from '../../utils/shuttle/shuttleSeedData';
import type { GtfsStopWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import type { ShuttleProject, ShuttleScenario, ShuttleStop } from '../../utils/shuttle/shuttleTypes';
import {
    useShuttlePlannerController,
    type MapEditMode,
    type RouteSnapState,
    type ShuttlePlannerController,
    type ShuttlePlannerWorkspaceSnapshot,
} from './useShuttlePlannerController';

interface ShuttlePlannerWorkspaceProps {
    onBack: () => void;
    userId: string | null;
    teamId?: string | null;
    headerTitle?: string;
    headerBadge?: string | null;
    headerDescription?: React.ReactNode;
    headerContent?: React.ReactNode;
    backLabel?: string;
    onPlannerStateChange?: (snapshot: ShuttlePlannerWorkspaceSnapshot) => void;
}

const scenarioAccentClasses = {
    indigo: { tint: 'bg-indigo-50 border-indigo-200 text-indigo-700', pill: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500', route: '#4f46e5' },
    emerald: { tint: 'bg-emerald-50 border-emerald-200 text-emerald-700', pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', route: '#059669' },
    amber: { tint: 'bg-amber-50 border-amber-200 text-amber-700', pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', route: '#d97706' },
    cyan: { tint: 'bg-cyan-50 border-cyan-200 text-cyan-700', pill: 'bg-cyan-100 text-cyan-700', dot: 'bg-cyan-500', route: '#0891b2' },
} as const;

const stopRoleLabel = {
    terminal: 'Terminal',
    timed: 'Timed',
    regular: 'Stop',
} as const;

const lineLayer: LayerProps = {
    id: 'shuttle-line',
    type: 'line' as const,
    paint: { 'line-color': ['get', 'color'] as unknown as string, 'line-width': 5, 'line-opacity': 0.9 },
    layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
};

const selectedLineLayer: LayerProps = {
    id: 'shuttle-line-selected',
    type: 'line' as const,
    paint: { 'line-color': ['get', 'color'] as unknown as string, 'line-width': 8, 'line-opacity': 0.18 },
    layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
};

const barrieStopLayer: LayerProps = {
    id: 'shuttle-barrie-stops',
    type: 'circle',
    paint: {
        'circle-radius': 3.5,
        'circle-color': '#0f766e',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.7,
    },
};

function formatProjectTimestamp(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return 'Unknown error';
}

function createPlannerStarterProject(teamId?: string | null): ShuttleProject {
    return deriveShuttleProject(createLocalStarterProject(teamId ?? null));
}

function buildCustomStopName(stops: ShuttleStop[]): string {
    const customCount = stops.filter((stop) => stop.kind === 'custom').length;
    return `Custom Stop ${customCount + 1}`;
}

const scenarioAccentOrder: ShuttleScenario['accent'][] = ['indigo', 'emerald', 'amber', 'cyan'];

function buildBarrieStopsGeoJson(stops: GtfsStopWithCoords[]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: stops.map((stop) => ({
            type: 'Feature',
            properties: {
                stopId: stop.stop_id,
                stopName: stop.stop_name,
            },
            geometry: {
                type: 'Point',
                coordinates: [stop.lon, stop.lat],
            },
        })),
    };
}

function buildScenarioCopy(scenario: ShuttleScenario, existingCount: number): ShuttleScenario {
    const accentIndex = scenarioAccentOrder.indexOf(scenario.accent);
    const nextAccent = scenarioAccentOrder[(accentIndex + 1 + existingCount) % scenarioAccentOrder.length];
    const suffix = existingCount + 1;

    return deriveShuttleScenario({
        ...scenario,
        id: `${scenario.id}-copy-${Date.now()}`,
        name: `${scenario.name} Option ${suffix}`,
        accent: nextAccent,
        notes: `${scenario.notes} Duplicate for alternative testing.`,
        stops: scenario.stops.map((stop) => ({
            ...stop,
            id: `${stop.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        })),
    });
}

function downloadTextFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function buildProjectExport(project: ShuttleProject, scenarios: ShuttleScenario[]): string {
    const sections = scenarios.map((scenario) => {
        const stops = scenario.stops.map((stop, index) =>
            `${index + 1}. ${stop.name} (${stop.kind}, ${stop.role}) ${stop.timeLabel}`
        ).join('\n');
        const warnings = scenario.warnings.length > 0
            ? scenario.warnings.map((warning) => `- ${warning}`).join('\n')
            : '- No warnings';

        return [
            `## ${scenario.name}`,
            '',
            `- Pattern: ${scenario.pattern}`,
            `- Distance: ${scenario.distanceKm} km`,
            `- Runtime: ${scenario.runtimeMinutes} min`,
            `- Cycle Time: ${scenario.cycleMinutes} min`,
            `- Buses Required: ${scenario.busesRequired}`,
            `- Service Hours: ${scenario.serviceHours}`,
            `- Span: ${scenario.firstDeparture} to ${scenario.lastDeparture}`,
            `- Frequency: Every ${scenario.frequencyMinutes} min`,
            '',
            '### Stops',
            stops,
            '',
            '### Warnings',
            warnings,
            '',
            '### Sample Departures',
            scenario.departures.slice(0, 8).map((departure) => `- ${departure}`).join('\n'),
            '',
        ].join('\n');
    }).join('\n');

    return [
        `# ${project.name}`,
        '',
        project.description ?? 'No description provided.',
        '',
        `Exported: ${new Date().toLocaleString()}`,
        '',
        sections,
    ].join('\n');
}

function getEditableCoordinates(scenario: ShuttleScenario): [number, number][] {
    return scenario.waypoints;
}

interface ShuttlePlannerWorkspaceViewProps extends ShuttlePlannerWorkspaceProps {
    controller: ShuttlePlannerController;
}

export const ShuttlePlannerWorkspaceView: React.FC<ShuttlePlannerWorkspaceViewProps> = ({
    onBack,
    userId,
    controller,
    headerTitle = 'Shuttle Planner',
    headerBadge = null,
    headerDescription = null,
    headerContent = null,
    backLabel = 'Back to Planning Data',
}) => {
    const {
        projects,
        projectError,
        isLoadingProjects,
        isSavingProject,
        isDuplicatingProject,
        isDeletingProject,
        routeSnapState,
        currentProject,
        selectedScenarioId,
        selectedStopId,
        compareMode,
        mapEditMode,
        barrieStopsGeoJson,
        selectedScenario,
        selectedStop,
        visibleScenarios,
        canCompare,
        isLocalDraft,
        setCompareMode,
        setMapEditMode,
        setSelectedScenarioId,
        setSelectedStopId,
        selectProject,
        updateSelectedScenario,
        updateScenarioField,
        updateProjectField,
        handleMapClick,
        handleWaypointDragEnd,
        handleStopDragEnd,
        handleRemoveStop,
        handleUndoWaypoint,
        handleClearRoute,
        handleSaveProject,
        handleDuplicateProject,
        handleDuplicateScenario,
        handleDeleteScenario,
        handleMarkPreferredScenario,
        handleCreateFreshProject,
        handleDeleteCurrentProject,
        handleExport,
    } = controller;

    const accent = selectedScenario ? scenarioAccentClasses[selectedScenario.accent] : scenarioAccentClasses.indigo;

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="mx-auto max-w-[1720px] animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="flex-1">
                        <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
                            <ArrowLeft size={14} /> {backLabel}
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600 shadow-sm"><Route size={24} /></div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-3xl font-extrabold text-gray-800">{headerTitle}</h2>
                                    {headerBadge && (
                                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-700">
                                            {headerBadge}
                                        </span>
                                    )}
                                </div>
                                {headerDescription && (
                                    <p className="mt-2 max-w-3xl text-sm font-semibold text-gray-500">
                                        {headerDescription}
                                    </p>
                                )}
                                {headerContent && (
                                    <div className="mt-3">
                                        {headerContent}
                                    </div>
                                )}
                                <input
                                    type="text"
                                    value={currentProject.name}
                                    onChange={(event) => updateProjectField('name', event.target.value)}
                                    className="mt-2 w-full max-w-xl rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-brand-blue"
                                />
                                <input
                                    type="text"
                                    value={currentProject.description ?? ''}
                                    onChange={(event) => updateProjectField('description', event.target.value)}
                                    placeholder="Add a short project description"
                                    className="mt-2 w-full max-w-2xl rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-500 outline-none focus:border-brand-blue"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 xl:items-end">
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-1">
                                        <button type="button" onClick={() => setCompareMode(false)} className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${!compareMode ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Scenario</button>
                                        <button type="button" onClick={() => setCompareMode(true)} disabled={!canCompare} className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${compareMode ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'} disabled:cursor-not-allowed disabled:opacity-50`}>Compare</button>
                                    </div>
                            <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-1">
                                <button
                                    type="button"
                                    onClick={() => { void handleSaveProject(); }}
                                    disabled={isSavingProject}
                                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSavingProject ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    {isSavingProject ? 'Saving...' : 'Save Draft'}
                                </button>
                                <div className="h-4 w-px bg-gray-200" />
                                <button
                                    type="button"
                                    onClick={() => { void handleDuplicateProject(); }}
                                    disabled={isDuplicatingProject || isSavingProject}
                                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isDuplicatingProject ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                                    {isDuplicatingProject ? 'Duplicating...' : 'Duplicate'}
                                </button>
                                <div className="h-4 w-px bg-gray-200" />
                                <button
                                    type="button"
                                    onClick={handleExport}
                                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm"
                                >
                                    <FileDown size={14} />Export
                                </button>
                            </div>
                        </div>
                        <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${accent.tint}`}>
                            {isLocalDraft ? <FolderOpen size={14} /> : <Cloud size={14} />}
                            {isLocalDraft ? 'Local starter draft' : 'Saved to Firebase'}
                            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider">Planning Data</span>
                        </div>
                    </div>
                </div>

                {projectError && (
                    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                        {projectError}
                    </div>
                )}

                {!userId && (
                    <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
                        Sign in to save shuttle projects. The workspace will stay usable with local starter data until then.
                    </div>
                )}

                {!selectedScenario ? (
                    <div className="rounded-3xl border-2 border-gray-200 bg-white p-8 shadow-sm">
                        <h3 className="text-lg font-extrabold text-gray-900">No scenarios available</h3>
                        <p className="mt-2 text-sm font-semibold text-gray-500">
                            Save a starter draft or load an existing shuttle project to continue.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
                        <aside className="space-y-4">
                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Projects</p>
                                        <h3 className="text-lg font-extrabold text-gray-900">Saved Shuttle Drafts</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="rounded-xl bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">
                                            {isLoadingProjects ? 'Loading...' : `${projects.length} saved`}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleCreateFreshProject}
                                            className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                                        >
                                            <Plus size={11} className="mr-1 inline" />
                                            New
                                        </button>
                                    </div>
                                </div>

                                {isLocalDraft && (
                                    <button
                                        type="button"
                                        className="mb-3 w-full rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/70 p-4 text-left"
                                    >
                                        <div className="mb-2 flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-extrabold text-gray-900">{currentProject.name}</p>
                                                <p className="mt-1 text-xs font-semibold text-gray-500">Unsaved starter project. Save to make it available across sessions.</p>
                                            </div>
                                            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-indigo-700">local</span>
                                        </div>
                                        <div className="flex items-center justify-end">
                                            <button
                                                type="button"
                                                onClick={handleCreateFreshProject}
                                                className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                                            >
                                                Reset Starter
                                            </button>
                                        </div>
                                    </button>
                                )}

                                {isLoadingProjects ? (
                                    <div className="flex items-center justify-center rounded-2xl border-2 border-gray-200 bg-gray-50 px-4 py-8">
                                        <Loader2 size={20} className="animate-spin text-gray-400" />
                                    </div>
                                ) : projects.length === 0 ? (
                                    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                                        <FolderOpen size={24} className="mx-auto mb-2 text-gray-300" />
                                        <p className="text-sm font-bold text-gray-700">No saved shuttle projects yet</p>
                                        <p className="mt-1 text-xs font-semibold text-gray-500">Use Save Draft to create the first persisted project.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {projects.map((project) => {
                                            const isCurrentProject = project.id === currentProject.id;
                                            return (
                                                <button
                                                    key={project.id}
                                                    type="button"
                                                    onClick={() => selectProject(project)}
                                                    className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${isCurrentProject ? 'border-cyan-300 bg-cyan-50' : 'border-gray-200 bg-gray-50/70 hover:border-gray-300 hover:bg-white'}`}
                                                >
                                                    <div className="mb-2 flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-extrabold text-gray-900">{project.name}</p>
                                                            <p className="mt-1 text-xs font-semibold text-gray-500">{project.description ?? 'No description yet.'}</p>
                                                        </div>
                                                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-cyan-700">
                                                            {project.scenarios.length} scenario{project.scenarios.length === 1 ? '' : 's'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                                                        <Cloud size={12} />
                                                        <span>Updated {formatProjectTimestamp(project.updatedAt)}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <div className="mt-3 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => { void handleDeleteCurrentProject(); }}
                                        disabled={isDeletingProject}
                                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isDeletingProject ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : <Trash2 size={12} className="mr-1 inline" />}
                                        {isLocalDraft ? 'Reset Project' : 'Delete Project'}
                                    </button>
                                </div>
                            </section>

                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Scenarios</p>
                                        <h3 className="text-lg font-extrabold text-gray-900">Project Options</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="rounded-xl bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">{currentProject.scenarios.length} active</div>
                                        <button
                                            type="button"
                                            onClick={handleDuplicateScenario}
                                            className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                                        >
                                            <Plus size={11} className="mr-1 inline" />
                                            Add Option
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDeleteScenario}
                                            className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-100"
                                        >
                                            <Trash2 size={11} className="mr-1 inline" />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                                <div className="mb-4 flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Preferred Scenario</p>
                                        <p className="text-sm font-bold text-gray-900">{selectedScenario.name}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleMarkPreferredScenario}
                                        className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                                    >
                                        Make Preferred
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {currentProject.scenarios.map((scenario) => {
                                        const scenarioAccent = scenarioAccentClasses[scenario.accent];
                                        return (
                                            <button
                                                key={scenario.id}
                                                type="button"
                                                onClick={() => { setSelectedScenarioId(scenario.id); setSelectedStopId(scenario.stops[0]?.id ?? null); }}
                                                className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${scenario.id === selectedScenario.id ? scenarioAccent.tint : 'border-gray-200 bg-gray-50/70 hover:border-gray-300 hover:bg-white'}`}
                                            >
                                                <div className="mb-2 flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-extrabold text-gray-900">{scenario.name}</p>
                                                        <p className="mt-1 text-xs font-semibold text-gray-500">{scenario.notes}</p>
                                                    </div>
                                                    <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider ${scenarioAccent.pill}`}>{scenario.pattern}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Stops</p>
                                        <h3 className="text-lg font-extrabold text-gray-900">Ordered Stop List</h3>
                                    </div>
                                    <div className="rounded-xl bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">{selectedScenario.stops.length} stops</div>
                                </div>
                                <div className="space-y-2">
                                    {selectedScenario.stops.map((stop, index) => (
                                        <button key={stop.id} type="button" onClick={() => setSelectedStopId(stop.id)} className={`flex w-full items-start gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-all ${stop.id === selectedStop?.id ? accent.tint : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                                            <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl text-xs font-extrabold text-white ${accent.dot}`}>{index + 1}</div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="truncate text-sm font-bold text-gray-900">{stop.name}</p>
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${stop.kind === 'barrie' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{stop.kind}</span>
                                                </div>
                                                <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-gray-500">
                                                    <span>{stopRoleLabel[stop.role]}</span>
                                                    <span className="text-gray-300">•</span>
                                                    <span>{stop.timeLabel}</span>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </aside>

                        <section className="space-y-4">
                            <div className="rounded-3xl border-2 border-gray-200 bg-white p-3 shadow-sm">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2 pt-2">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Map Workspace</p>
                                        <h3 className="text-lg font-extrabold text-gray-900">Editable shuttle alignment</h3>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
                                            <button
                                                type="button"
                                                onClick={() => setMapEditMode('inspect')}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${mapEditMode === 'inspect' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                            >
                                                <Move3D size={12} className="mr-1 inline" />
                                                Inspect
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setMapEditMode('route')}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${mapEditMode === 'route' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                            >
                                                <Route size={12} className="mr-1 inline" />
                                                Route
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setMapEditMode('stop')}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${mapEditMode === 'stop' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                            >
                                                <Plus size={12} className="mr-1 inline" />
                                                Stop
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleUndoWaypoint}
                                            disabled={getEditableCoordinates(selectedScenario).length === 0}
                                            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-500 transition-all hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Undo2 size={12} className="mr-1 inline" />
                                            Undo Point
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleClearRoute}
                                            disabled={getEditableCoordinates(selectedScenario).length === 0}
                                            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-500 transition-all hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Trash2 size={12} className="mr-1 inline" />
                                            Clear Route
                                        </button>
                                    </div>
                                </div>

                                <div className="mb-3 px-2">
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                                        {mapEditMode === 'route' && 'Route mode: click the map to add ordered route points. Drag square handles to refine the path. The route will snap to the street network automatically.'}
                                        {mapEditMode === 'stop' && 'Stop mode: click teal Barrie stop dots to add existing stops, or click anywhere else to add a custom stop.'}
                                        {mapEditMode === 'inspect' && 'Inspect mode: select stops on the map and review how edits affect metrics and departures.'}
                                    </div>
                                </div>

                                <div className="h-[660px] overflow-hidden rounded-[1.5rem] border-2 border-gray-200">
                                    <MapBase
                                        longitude={-79.683}
                                        latitude={44.376}
                                        zoom={12.4}
                                        showNavigation={true}
                                        showScale={true}
                                        onClick={handleMapClick}
                                        interactiveLayerIds={['shuttle-barrie-stops']}
                                    >
                                        <Source id="shuttle-barrie-stops-source" type="geojson" data={barrieStopsGeoJson}>
                                            <Layer {...barrieStopLayer} />
                                        </Source>

                                        {visibleScenarios.map((scenario) => (
                                            <Source key={scenario.id} id={`shuttle-route-${scenario.id}`} type="geojson" data={{ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color: scenarioAccentClasses[scenario.accent].route }, geometry: scenario.geometry }] }}>
                                                {scenario.id === selectedScenario.id && <Layer {...selectedLineLayer} id={`shuttle-selected-${scenario.id}`} />}
                                                <Layer {...lineLayer} id={`shuttle-line-${scenario.id}`} />
                                            </Source>
                                        ))}

                                        {getEditableCoordinates(selectedScenario).map((coordinate, index) => (
                                            <Marker
                                                key={`waypoint-${selectedScenario.id}-${index}`}
                                                longitude={coordinate[0]}
                                                latitude={coordinate[1]}
                                                anchor="center"
                                                draggable={mapEditMode === 'route'}
                                                onDragEnd={(event) => handleWaypointDragEnd(index, event)}
                                            >
                                                <button
                                                    type="button"
                                                    className={`flex h-6 w-6 items-center justify-center rounded-lg border-2 border-white text-[10px] font-extrabold text-white shadow ${mapEditMode === 'route' ? 'cursor-grab' : 'cursor-default'}`}
                                                    style={{ backgroundColor: accent.route }}
                                                >
                                                    {index + 1}
                                                </button>
                                            </Marker>
                                        ))}

                                        {visibleScenarios.flatMap((scenario) => scenario.stops.map((stop, index) => {
                                            const isSelected = scenario.id === selectedScenario.id && stop.id === selectedStop?.id;
                                            const scenarioAccent = scenarioAccentClasses[scenario.accent];
                                            return (
                                                <Marker
                                                    key={`${scenario.id}-${stop.id}`}
                                                    longitude={stop.longitude}
                                                    latitude={stop.latitude}
                                                    anchor="center"
                                                    draggable={scenario.id === selectedScenario.id && stop.kind === 'custom'}
                                                    onDragEnd={(event) => handleStopDragEnd(stop.id, event)}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => { setSelectedScenarioId(scenario.id); setSelectedStopId(stop.id); }}
                                                        className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-extrabold text-white shadow-lg ${isSelected ? 'border-gray-900 ring-4 ring-white' : 'border-white'} ${compareMode && scenario.id !== selectedScenario.id ? 'scale-90 opacity-80' : ''}`}
                                                        style={{ backgroundColor: scenarioAccent.route }}
                                                    >
                                                        {index + 1}
                                                    </button>
                                                </Marker>
                                            );
                                        }))}
                                    </MapBase>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 px-2">
                                    <span className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-500">Barrie stops + custom stops</span>
                                    <span className="rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">Map + timetable linked</span>
                                    <span className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                                        routeSnapState === 'snapping'
                                            ? 'bg-amber-50 text-amber-700'
                                            : routeSnapState === 'snapped'
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : routeSnapState === 'fallback'
                                                    ? 'bg-slate-100 text-slate-700'
                                                    : 'bg-gray-100 text-gray-500'
                                    }`}>
                                        {routeSnapState === 'snapping' && 'Snapping route...'}
                                        {routeSnapState === 'snapped' && 'Road snapped'}
                                        {routeSnapState === 'fallback' && 'Route sketch only'}
                                        {routeSnapState === 'idle' && 'Add route points'}
                                    </span>
                                </div>
                            </div>

                            {compareMode && canCompare && (
                                <div className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Compare</p>
                                            <h3 className="text-lg font-extrabold text-gray-900">Scenario review table</h3>
                                        </div>
                                        <div className="rounded-xl bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">{visibleScenarios.length} visible</div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-gray-100 text-left text-xs font-extrabold uppercase tracking-wider text-gray-400">
                                                    <th className="px-3 py-2">Metric</th>
                                                    {visibleScenarios.map((scenario) => (
                                                        <th key={scenario.id} className="px-3 py-2 text-gray-700">{scenario.name}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {[
                                                    { label: 'Pattern', values: visibleScenarios.map((scenario) => scenario.pattern) },
                                                    { label: 'Distance', values: visibleScenarios.map((scenario) => `${scenario.distanceKm} km`) },
                                                    { label: 'Runtime', values: visibleScenarios.map((scenario) => `${scenario.runtimeMinutes} min`) },
                                                    { label: 'Cycle Time', values: visibleScenarios.map((scenario) => `${scenario.cycleMinutes} min`) },
                                                    { label: 'Buses', values: visibleScenarios.map((scenario) => `${scenario.busesRequired}`) },
                                                    { label: 'Frequency', values: visibleScenarios.map((scenario) => `Every ${scenario.frequencyMinutes} min`) },
                                                    { label: 'Span', values: visibleScenarios.map((scenario) => `${scenario.firstDeparture} - ${scenario.lastDeparture}`) },
                                                    { label: 'Stops', values: visibleScenarios.map((scenario) => `${scenario.stops.length}`) },
                                                ].map((row) => (
                                                    <tr key={row.label} className="border-b border-gray-100 last:border-b-0">
                                                        <td className="px-3 py-2 font-bold text-gray-600">{row.label}</td>
                                                        {row.values.map((value, index) => (
                                                            <td key={`${row.label}-${visibleScenarios[index].id}`} className="px-3 py-2 font-semibold text-gray-900">{value}</td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </section>

                        <aside className="space-y-4">
                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4">
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Service Inputs</p>
                                    <h3 className="text-lg font-extrabold text-gray-900">Operating assumptions</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Pattern</p>
                                        <select
                                            value={selectedScenario.pattern}
                                            onChange={(event) => updateScenarioField('pattern', event.target.value as ShuttleScenario['pattern'])}
                                            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                        >
                                            <option value="loop">Loop</option>
                                            <option value="out-and-back">Out-and-back</option>
                                        </select>
                                    </label>
                                    <label className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Runtime</p>
                                        <div className="mt-2 flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={1}
                                                value={selectedScenario.runtimeMinutes}
                                                onChange={(event) => updateScenarioField('runtimeMinutes', Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                            <span className="text-xs font-bold text-gray-500">min</span>
                                        </div>
                                    </label>
                                    <label className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">First Trip</p>
                                        <input
                                            type="time"
                                            value={selectedScenario.firstDeparture}
                                            onChange={(event) => updateScenarioField('firstDeparture', event.target.value)}
                                            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                        />
                                    </label>
                                    <label className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Last Trip</p>
                                        <input
                                            type="time"
                                            value={selectedScenario.lastDeparture}
                                            onChange={(event) => updateScenarioField('lastDeparture', event.target.value)}
                                            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                        />
                                    </label>
                                    <label className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Frequency</p>
                                        <div className="mt-2 flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={1}
                                                value={selectedScenario.frequencyMinutes}
                                                onChange={(event) => updateScenarioField('frequencyMinutes', Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                            <span className="text-xs font-bold text-gray-500">min</span>
                                        </div>
                                    </label>
                                    <label className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Recovery</p>
                                        <div className="mt-2 flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={0}
                                                value={selectedScenario.layoverMinutes}
                                                onChange={(event) => updateScenarioField('layoverMinutes', Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                            <span className="text-xs font-bold text-gray-500">min</span>
                                        </div>
                                    </label>
                                </div>
                            </section>

                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Live Metrics</p>
                                        <h3 className="text-lg font-extrabold text-gray-900">Scenario viability</h3>
                                    </div>
                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${accent.pill}`}>{selectedScenario.status}</span>
                                </div>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between rounded-2xl border-2 border-blue-100 bg-blue-50 p-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2.5 text-brand-blue"><Route size={18} /></div><div><p className="text-sm font-bold text-gray-900">Route Distance</p><p className="text-xs font-semibold text-gray-500">Snapped roadway length</p></div></div><div className="text-right text-sm font-extrabold text-brand-blue">{selectedScenario.distanceKm} km</div></div>
                                    <div className="flex items-center justify-between rounded-2xl border-2 border-emerald-100 bg-emerald-50 p-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2.5 text-emerald-600"><Clock3 size={18} /></div><div><p className="text-sm font-bold text-gray-900">One-way Runtime</p><p className="text-xs font-semibold text-gray-500">Current operating assumption</p></div></div><div className="text-right text-sm font-extrabold text-emerald-700">{selectedScenario.runtimeMinutes} min</div></div>
                                    <div className="flex items-center justify-between rounded-2xl border-2 border-violet-100 bg-violet-50 p-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2.5 text-violet-600"><TimerReset size={18} /></div><div><p className="text-sm font-bold text-gray-900">Cycle Time</p><p className="text-xs font-semibold text-gray-500">Runtime plus recovery</p></div></div><div className="text-right text-sm font-extrabold text-violet-700">{selectedScenario.cycleMinutes} min</div></div>
                                    <div className="flex items-center justify-between rounded-2xl border-2 border-amber-100 bg-amber-50 p-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2.5 text-amber-600"><Shuffle size={18} /></div><div><p className="text-sm font-bold text-gray-900">Buses Required</p><p className="text-xs font-semibold text-gray-500">For current headway</p></div></div><div className="text-right text-sm font-extrabold text-amber-700">{selectedScenario.busesRequired}</div></div>
                                </div>
                            </section>

                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4">
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Warnings</p>
                                    <h3 className="text-lg font-extrabold text-gray-900">Planner review</h3>
                                </div>
                                <div className="space-y-3">
                                    {selectedScenario.warnings.map((warning) => (
                                        <div key={warning} className="flex items-start gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
                                            <div className="rounded-xl bg-white p-2.5 text-amber-600"><TriangleAlert size={18} /></div>
                                            <p className="text-sm font-semibold leading-relaxed text-amber-900">{warning}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4">
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Selected Stop</p>
                                    <h3 className="text-lg font-extrabold text-gray-900">{selectedStop?.name ?? 'No stop selected'}</h3>
                                </div>
                                <div className="mb-4 rounded-2xl border-2 border-blue-100 bg-blue-50 p-4">
                                    <div className="mb-2 flex items-center gap-3"><div className="rounded-xl bg-white p-3 text-brand-blue shadow-inner"><MapPinned size={20} /></div><div><p className="text-sm font-extrabold text-gray-900">Stop metadata</p><p className="text-xs font-semibold text-gray-500">Map and stop list stay in sync</p></div></div>
                                    <p className="text-sm font-bold text-gray-900">{selectedStop ? `${stopRoleLabel[selectedStop.role]} • ${selectedStop.kind === 'barrie' ? 'Barrie stop' : 'Custom stop'}` : 'Select a stop to inspect details.'}</p>
                                </div>
                                {selectedStop && (
                                    <div className="mb-4 space-y-3">
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Stop Name</p>
                                            <input
                                                type="text"
                                                value={selectedStop.name}
                                                onChange={(event) => updateSelectedScenario((scenario) => ({
                                                    ...scenario,
                                                    stops: scenario.stops.map((stop) =>
                                                        stop.id === selectedStop.id
                                                            ? { ...stop, name: event.target.value }
                                                            : stop
                                                    ),
                                                }))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Stop Role</p>
                                            <select
                                                value={selectedStop.role}
                                                onChange={(event) => updateSelectedScenario((scenario) => ({
                                                    ...scenario,
                                                    stops: scenario.stops.map((stop) =>
                                                        stop.id === selectedStop.id
                                                            ? { ...stop, role: event.target.value as ShuttleStop['role'] }
                                                            : stop
                                                    ),
                                                }))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            >
                                                <option value="terminal">Terminal</option>
                                                <option value="timed">Timed</option>
                                                <option value="regular">Regular</option>
                                            </select>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={handleRemoveStop}
                                            className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 transition-colors hover:bg-red-100"
                                        >
                                            <Trash2 size={14} className="mr-1 inline" />
                                            Remove Stop
                                        </button>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    {selectedScenario.departures.map((departure, index) => (
                                        <div key={departure} className="flex items-center justify-between rounded-2xl border-2 border-gray-200 bg-gray-50 px-3 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-extrabold text-white ${accent.dot}`}>{index + 1}</div>
                                                <div>
                                                    <p className="text-sm font-bold text-gray-900">{departure}</p>
                                                    <p className="text-xs font-semibold text-gray-500">{selectedScenario.pattern === 'loop' ? 'Loop trip' : 'Outbound departure'}</p>
                                                </div>
                                            </div>
                                            <div className="text-right text-xs font-bold text-gray-500">{selectedScenario.pattern === 'loop' ? `Return ${selectedScenario.cycleMinutes} min` : `Arrive +${selectedScenario.runtimeMinutes} min`}</div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </aside>
                    </div>
                )}
            </div>
        </div>
    );
};

export const ShuttlePlannerWorkspace: React.FC<ShuttlePlannerWorkspaceProps> = (props) => {
    const controller = useShuttlePlannerController({
        userId: props.userId,
        teamId: props.teamId,
        onPlannerStateChange: props.onPlannerStateChange,
    });

    return <ShuttlePlannerWorkspaceView {...props} controller={controller} />;
};
