import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShuttlePlannerWorkspaceView } from './ShuttlePlannerWorkspace';
import { ArrowLeft, Cloud, Copy, FileDown, Loader2, Maximize2, Minimize2, Plus, RotateCcw, Route, Save, Star, Trash2, Undo2 } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import { ROUTE_DIRECTIONS } from '../../utils/config/routeDirectionConfig';
import { buildCorridorSpeedIndex } from '../../utils/gtfs/corridorSpeed';
import { DAY_TYPES, TIME_PERIODS, type DayType, type TimePeriod } from '../../utils/gtfs/corridorHeadway';
import {
    buildRouteScenarioImpactSummary,
    getExistingRouteBaselineScenario,
} from '../../utils/route-planner/routePlannerComparison';
import { deriveRouteProject } from '../../utils/route-planner/routePlannerPlanning';
import { compareRouteCoverageMetrics } from '../../utils/route-planner/routePlannerCoverage';
import {
    applyObservedRuntimeToScenario,
    estimateObservedRuntimeForScenario,
    type RouteObservedRuntimeSummary,
} from '../../utils/route-planner/routePlannerObservedRuntime';
import {
    buildRouteScenarioHandoff,
    buildRouteStudyExport,
} from '../../utils/route-planner/routePlannerOutputs';
import { buildRouteTimetablePreview } from '../../utils/route-planner/routePlannerTimetable';
import { MapBase } from '../shared';
import {
    useRoutePlannerController,
    type RoutePlannerMode,
} from './useRoutePlannerController';
import type { RoutePlannerProjectController } from './useRoutePlannerProjectController';

interface RoutePlannerWorkspaceProps {
    onBack: () => void;
    userId: string | null;
    teamId?: string | null;
}

interface ModeOption {
    id: RoutePlannerMode;
    label: string;
    status: 'Live' | 'Planned';
    summary: string;
}

const MODE_OPTIONS: ModeOption[] = [
    {
        id: 'shuttle-concept',
        label: 'Shuttle Concept',
        status: 'Live',
        summary: 'Temporary services, event shuttles, GO connectors, and short concept testing.',
    },
    {
        id: 'existing-route-tweak',
        label: 'Existing Route Tweak',
        status: 'Planned',
        summary: 'Load an existing Barrie route, adjust alignment or stops, and compare before vs after impacts.',
    },
    {
        id: 'route-concept',
        label: 'Route Concept',
        status: 'Planned',
        summary: 'Create broader route options from a blank concept with shared runtime and coverage logic.',
    },
];

const ROUTE_OPTIONS = Object.keys(ROUTE_DIRECTIONS).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const routeAccentStyles = {
    indigo: { route: '#4f46e5', pill: 'bg-indigo-100 text-indigo-700' },
    emerald: { route: '#059669', pill: 'bg-emerald-100 text-emerald-700' },
    amber: { route: '#d97706', pill: 'bg-amber-100 text-amber-700' },
    cyan: { route: '#0891b2', pill: 'bg-cyan-100 text-cyan-700' },
} as const;

const lineLayer: LayerProps = {
    id: 'route-planner-line',
    type: 'line',
    paint: { 'line-color': ['get', 'color'] as unknown as string, 'line-width': 5, 'line-opacity': 0.92 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
};

const selectedLineLayer: LayerProps = {
    id: 'route-planner-selected-line',
    type: 'line',
    paint: { 'line-color': ['get', 'color'] as unknown as string, 'line-width': 9, 'line-opacity': 0.18 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
};

const barrieStopLayer: LayerProps = {
    id: 'route-planner-barrie-stops',
    type: 'circle',
    paint: {
        'circle-radius': 3.5,
        'circle-color': '#0f766e',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.72,
    },
};

const stopRoleLabel = {
    terminal: 'Terminal',
    timed: 'Timed',
    regular: 'Stop',
} as const;

const timingProfileLabel = {
    balanced: 'Balanced',
    front_loaded: 'Front-loaded',
    back_loaded: 'Back-loaded',
} as const;

function downloadMarkdownFile(filename: string, content: string): void {
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

function formatSignedDelta(value: number): string {
    if (value > 0) return `+${value}`;
    return `${value}`;
}

function PlannerModeStrip({
    selectedMode,
    onSelect,
}: {
    selectedMode: RoutePlannerMode;
    onSelect: (mode: RoutePlannerMode) => void;
}): React.ReactElement {
    return (
        <div className="rounded-3xl border-2 border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Planner Modes</p>
                    <h3 className="text-base font-extrabold text-gray-900">Route Planner Modes</h3>
                </div>
                <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.18em] text-gray-500">
                    Shared Workspace
                </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
                {MODE_OPTIONS.map((mode) => {
                    const isSelected = selectedMode === mode.id;
                    const isLive = mode.status === 'Live';

                    return (
                        <button
                            key={mode.id}
                            type="button"
                            onClick={() => onSelect(mode.id)}
                            className={`rounded-2xl border-2 p-4 text-left transition-all ${
                                isSelected
                                    ? 'border-brand-blue bg-cyan-50 shadow-sm'
                                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white'
                            }`}
                        >
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${
                                    isLive
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {mode.status}
                                </span>
                                {isSelected && (
                                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-brand-blue">
                                        Active
                                    </span>
                                )}
                            </div>
                            <div className="text-sm font-extrabold text-gray-900">{mode.label}</div>
                            <p className="mt-1 text-xs font-semibold leading-relaxed text-gray-500">{mode.summary}</p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function PlannedModePanel({
    title,
    summary,
    onBack,
    selectedMode,
    onSelectMode,
    plannerSnapshot,
    projectController,
    isSignedIn,
    teamId,
}: {
    title: string;
    summary: string;
    onBack: () => void;
    selectedMode: RoutePlannerMode;
    onSelectMode: (mode: RoutePlannerMode) => void;
    plannerSnapshot: ReturnType<typeof useRoutePlannerController>['plannerSnapshot'];
    projectController: RoutePlannerProjectController;
    isSignedIn: boolean;
    teamId?: string | null;
}): React.ReactElement {
    const requiresExistingRoute = selectedMode === 'existing-route-tweak';
    const mapRef = useRef<MapRef | null>(null);
    const {
        projects,
        localDraftProject,
        projectError,
        project: draftProject,
        draftState,
        selectedScenarioId,
        selectedStopId,
        selectedScenario,
        selectedStop,
        compareMode,
        canCompare,
        visibleScenarios,
        isLoadingProjects,
        isSavingProject,
        isDuplicatingProject,
        isDeletingProject,
        isLocalDraft,
        setCompareMode,
        mapEditMode,
        setMapEditMode,
        setSelectedScenarioId,
        setSelectedStopId,
        updateDraftState,
        selectProject,
        updateProjectName,
        updateProjectDescription,
        updateSelectedScenarioName,
        updateSelectedScenarioPattern,
        updateSelectedScenarioStatus,
        updateSelectedScenarioFirstDeparture,
        updateSelectedScenarioLastDeparture,
        updateSelectedScenarioFrequencyMinutes,
        updateSelectedScenarioLayoverMinutes,
        updateSelectedScenarioTimingProfile,
        updateSelectedScenarioStartTerminalHoldMinutes,
        updateSelectedScenarioEndTerminalHoldMinutes,
        updateSelectedScenarioCoverageWalkshedMeters,
        updateSelectedScenarioNotes,
        updateSelectedStopName,
        updateSelectedStopRole,
        updateSelectedStopPlannedOffsetMinutes,
        duplicateSelectedScenario,
        deleteSelectedScenario,
        markSelectedScenarioPreferred,
        barrieStopsGeoJson,
        handleMapClick,
        handleWaypointDragEnd,
        handleStopDragEnd,
        handleRemoveStop,
        handleUndoWaypoint,
        handleClearRoute,
        handleResetRouteToGtfs,
        handleSaveProject,
        handleDuplicateProject,
        handleCreateFreshProject,
        handleDeleteCurrentProject,
    } = projectController;
    const [analysisDayType, setAnalysisDayType] = useState<DayType>('weekday');
    const [analysisPeriod, setAnalysisPeriod] = useState<TimePeriod>('full-day');
    const [isMapFullscreen, setIsMapFullscreen] = useState(false);
    const metadataQuery = usePerformanceMetadataQuery(teamId ?? undefined);
    const hasPerformanceData = Boolean(metadataQuery.data);
    const dataQuery = usePerformanceDataQuery(teamId ?? undefined, hasPerformanceData);
    const hasStopSegmentRuntimeData = useMemo(
        () => dataQuery.data?.dailySummaries.some((day) => (day.stopSegmentRuntimes?.entries.length ?? 0) > 0) ?? false,
        [dataQuery.data],
    );
    const speedIndex = useMemo(() => {
        if (!dataQuery.data || !hasStopSegmentRuntimeData) return null;
        return buildCorridorSpeedIndex(dataQuery.data.dailySummaries);
    }, [dataQuery.data, hasStopSegmentRuntimeData]);
    const observedSummaryByScenarioId = useMemo(() => {
        const summaries = new Map<string, RouteObservedRuntimeSummary>();
        if (!speedIndex) return summaries;

        for (const scenario of draftProject.scenarios) {
            if (scenario.stops.length < 2) continue;
            summaries.set(
                scenario.id,
                estimateObservedRuntimeForScenario(scenario, speedIndex, analysisDayType, analysisPeriod),
            );
        }

        return summaries;
    }, [analysisDayType, analysisPeriod, draftProject.scenarios, speedIndex]);
    const displayProject = useMemo(() => {
        if (!speedIndex) return draftProject;

        return deriveRouteProject({
            ...draftProject,
            scenarios: draftProject.scenarios.map((scenario) =>
                applyObservedRuntimeToScenario(
                    scenario,
                    observedSummaryByScenarioId.get(scenario.id) ?? null,
                )
            ),
        });
    }, [draftProject, observedSummaryByScenarioId, speedIndex]);
    const displayScenarioById = useMemo(
        () => new Map(displayProject.scenarios.map((scenario) => [scenario.id, scenario])),
        [displayProject.scenarios],
    );
    const displaySelectedScenario = useMemo(
        () => (selectedScenario ? displayScenarioById.get(selectedScenario.id) ?? selectedScenario : null),
        [displayScenarioById, selectedScenario],
    );
    const displayVisibleScenarios = useMemo(
        () => visibleScenarios.map((scenario) => displayScenarioById.get(scenario.id) ?? scenario),
        [displayScenarioById, visibleScenarios],
    );
    const preferredDisplayScenario = useMemo(
        () => displayProject.scenarios.find((scenario) => scenario.id === displayProject.preferredScenarioId)
            ?? displaySelectedScenario
            ?? displayProject.scenarios[0]
            ?? null,
        [displayProject.preferredScenarioId, displayProject.scenarios, displaySelectedScenario],
    );
    const selectedObservedSummary = displaySelectedScenario
        ? observedSummaryByScenarioId.get(displaySelectedScenario.id) ?? null
        : null;
    const preferredObservedSummary = preferredDisplayScenario
        ? observedSummaryByScenarioId.get(preferredDisplayScenario.id) ?? null
        : null;
    const preferredTimetablePreview = useMemo(
        () => (preferredDisplayScenario ? buildRouteTimetablePreview(preferredDisplayScenario, 5) : null),
        [preferredDisplayScenario],
    );
    const selectedBaselineScenario = useMemo(
        () => (displaySelectedScenario ? getExistingRouteBaselineScenario(displayProject, displaySelectedScenario) : null),
        [displayProject, displaySelectedScenario],
    );
    const selectedImpactSummary = useMemo(
        () => (
            selectedBaselineScenario && displaySelectedScenario
                ? buildRouteScenarioImpactSummary(selectedBaselineScenario, displaySelectedScenario)
                : null
        ),
        [displaySelectedScenario, selectedBaselineScenario],
    );
    const coverageComparisonDelta = useMemo(
        () => compareRouteCoverageMetrics(displayVisibleScenarios[0]?.coverage, displayVisibleScenarios[1]?.coverage),
        [displayVisibleScenarios],
    );
    const selectedAccent = selectedScenario ? routeAccentStyles[selectedScenario.accent] : routeAccentStyles.indigo;
    const observedRuntimeStatus = (() => {
        if (!teamId) {
            return {
                tone: 'blue' as const,
                title: 'Team connection required',
                body: 'Open this workspace with a team context to load STREETS stop-to-stop runtime evidence.',
            };
        }
        if (metadataQuery.isLoading || dataQuery.isLoading) {
            return {
                tone: 'gray' as const,
                title: 'Loading runtime evidence',
                body: 'Checking STREETS performance summaries for stop-to-stop runtime coverage.',
            };
        }
        if (!metadataQuery.data) {
            return {
                tone: 'amber' as const,
                title: 'No performance summary found',
                body: 'STREETS performance metadata is not available for this team yet, so planned route studies stay on fallback estimates.',
            };
        }
        if (!hasStopSegmentRuntimeData) {
            return {
                tone: 'amber' as const,
                title: 'No stop-segment runtime data',
                body: 'Performance summaries exist, but they do not include stop-to-stop runtime entries yet.',
            };
        }
        return {
            tone: 'emerald' as const,
            title: 'Observed runtime proxy active',
            body: 'Route Planner is using Corridor Speed stop-to-stop proxy data where matching Barrie stop pairs exist.',
        };
    })();
    const observedStatusToneClass = {
        blue: 'border-blue-200 bg-blue-50 text-blue-900',
        gray: 'border-gray-200 bg-gray-50 text-gray-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-900',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    }[observedRuntimeStatus.tone];
    const selectedTimingPlan = displaySelectedScenario?.stops.map((stop, index) => ({
        stop,
        index,
        isInteriorStop: Boolean(displaySelectedScenario && index > 0 && index < displaySelectedScenario.stops.length - 1),
        isTimingAnchor: stop.plannedOffsetMinutes !== null && stop.plannedOffsetMinutes !== undefined,
        usesInterpolatedTiming: stop.role === 'timed' && (stop.plannedOffsetMinutes === null || stop.plannedOffsetMinutes === undefined),
    })) ?? [];
    const selectedStopIndex = selectedScenario?.stops.findIndex((stop) => stop.id === selectedStop?.id) ?? -1;
    const selectedStopSupportsTimingAnchor = Boolean(
        selectedScenario
        && selectedStop
        && selectedStopIndex > 0
        && selectedStopIndex < selectedScenario.stops.length - 1
    );
    const handleExportStudy = (): void => {
        downloadMarkdownFile(
            `${draftProject.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'route-study'}-summary.md`,
            buildRouteStudyExport(displayProject, displayProject.scenarios, observedSummaryByScenarioId),
        );
    };
    const handleExportHandoff = (): void => {
        if (!preferredDisplayScenario) return;
        downloadMarkdownFile(
            `${preferredDisplayScenario.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'route-scenario'}-handoff.md`,
            buildRouteScenarioHandoff(displayProject, preferredDisplayScenario, preferredObservedSummary),
        );
    };

    useEffect(() => {
        if (!isMapFullscreen) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isMapFullscreen]);

    useEffect(() => {
        if (!isMapFullscreen) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsMapFullscreen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMapFullscreen]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return undefined;

        const frame = requestAnimationFrame(() => map.resize());
        const timer = window.setTimeout(() => map.resize(), 120);

        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(timer);
        };
    }, [isMapFullscreen]);

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="mx-auto max-w-[1720px] animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="mb-6 flex flex-col gap-4">
                    <div>
                        <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
                            <ArrowLeft size={14} /> Back to Planning Data
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600 shadow-sm"><Route size={24} /></div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-3xl font-extrabold text-gray-800">Route Planner</h2>
                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-amber-700">
                                        Planned Mode
                                    </span>
                                </div>
                                <p className="mt-2 max-w-3xl text-sm font-semibold text-gray-500">
                                    {summary}
                                </p>
                            </div>
                        </div>
                    </div>
                    <PlannerModeStrip selectedMode={selectedMode} onSelect={onSelectMode} />
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm">
                        <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
                            isLocalDraft
                                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}>
                            {isLocalDraft ? <Route size={14} /> : <Cloud size={14} />}
                            {isLocalDraft ? 'Local route study draft' : 'Saved route study'}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-1">
                            <button
                                type="button"
                                onClick={handleCreateFreshProject}
                                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm"
                            >
                                <Plus size={14} />
                                New
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleSaveProject(); }}
                                disabled={isSavingProject}
                                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSavingProject ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                {isSavingProject ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleDuplicateProject(); }}
                                disabled={isDuplicatingProject}
                                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isDuplicatingProject ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                                {isDuplicatingProject ? 'Duplicating...' : 'Duplicate Project'}
                            </button>
                            <button
                                type="button"
                                onClick={handleExportStudy}
                                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm"
                            >
                                <FileDown size={14} />
                                Export Summary
                            </button>
                            <button
                                type="button"
                                onClick={handleExportHandoff}
                                disabled={!preferredDisplayScenario}
                                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <FileDown size={14} />
                                Handoff Brief
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleDeleteCurrentProject(); }}
                                disabled={isDeletingProject}
                                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-red-600 transition-all hover:bg-white hover:text-red-700 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isDeletingProject ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                {isDeletingProject ? 'Deleting...' : 'Delete Project'}
                            </button>
                        </div>
                    </div>
                    {!isSignedIn && (
                        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
                            Sign in to save route studies to Firebase. Local draft persistence stays available until then.
                        </div>
                    )}
                    {projectError && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                            {projectError}
                        </div>
                    )}
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
                    <section className="rounded-3xl border-2 border-gray-200 bg-white p-6 shadow-sm">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">{title}</p>
                                <h3 className="text-xl font-extrabold text-gray-900">Route alignment draft</h3>
                                <p className="mt-1 max-w-3xl text-sm font-semibold leading-relaxed text-gray-500">
                                    Keep this screen focused on map editing. Service assumptions, comparisons, and exports stay in the side panels.
                                </p>
                            </div>
                            <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                {selectedScenario ? `${selectedScenario.name} active` : 'No scenario selected'}
                            </div>
                        </div>
                        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-3">
                            {!requiresExistingRoute && (
                                <label className="block min-w-[180px]">
                                    <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Base Source</p>
                                    <select
                                        value={draftState.baseSource}
                                        onChange={(event) => updateDraftState({ ...draftState, baseSource: event.target.value as typeof draftState.baseSource })}
                                        className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-brand-blue"
                                    >
                                        <option value="blank">Blank concept</option>
                                        <option value="existing-route">Existing route</option>
                                    </select>
                                </label>
                            )}
                            {draftState.baseSource === 'existing-route' && (
                                <label className="block min-w-[180px]">
                                    <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Route Template</p>
                                    <select
                                        value={draftState.routeId}
                                        onChange={(event) => updateDraftState({ ...draftState, routeId: event.target.value })}
                                        className="mt-2 w-full rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-brand-blue"
                                    >
                                        {ROUTE_OPTIONS.map((routeId) => (
                                            <option key={routeId} value={routeId}>Route {routeId}</option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            <div className="min-w-[220px] flex-1 rounded-xl border border-white/80 bg-white px-3 py-2">
                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Current Scenario</div>
                                <div className="mt-1 text-sm font-extrabold text-gray-900">{selectedScenario?.name ?? 'No scenario selected'}</div>
                                <div className="mt-1 text-xs font-semibold text-gray-500">
                                    {selectedScenario
                                        ? `${selectedScenario.status} · ${selectedScenario.pattern}`
                                        : 'Choose or create a scenario to start editing the route.'}
                                </div>
                            </div>
                        </div>
                        <div className={isMapFullscreen ? 'fixed inset-0 z-50 flex flex-col bg-white p-5' : 'mt-4 rounded-2xl border-2 border-gray-200 bg-white p-4'}>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Map Authoring</p>
                                    <h4 className="mt-1 text-base font-extrabold text-gray-900">Route alignment draft</h4>
                                    <p className="mt-1 text-xs font-semibold text-gray-500">
                                        Mapping is the primary planning surface for these modes. Build the geometry here first, then refine stops, timing, and scenario comparison around it.
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-1">
                                        <button
                                            type="button"
                                            onClick={() => setMapEditMode('inspect')}
                                            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                                mapEditMode === 'inspect' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                        >
                                            Inspect
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMapEditMode('route')}
                                            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                                mapEditMode === 'route' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                        >
                                            Edit Alignment
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMapEditMode('stop')}
                                            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                                mapEditMode === 'stop' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                        >
                                            Edit Stops
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsMapFullscreen((current) => !current)}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900"
                                        title={isMapFullscreen ? 'Exit fullscreen (Esc)' : 'Open fullscreen map'}
                                    >
                                        {isMapFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                        {isMapFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                                    </button>
                                </div>
                            </div>
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleUndoWaypoint}
                                    disabled={!selectedScenario || selectedScenario.waypoints.length === 0}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Undo2 size={13} />
                                    Undo Point
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearRoute}
                                    disabled={!selectedScenario || selectedScenario.waypoints.length === 0}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Trash2 size={13} />
                                    Clear Route
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetRouteToGtfs}
                                    disabled={selectedScenario?.baseSource.kind !== 'existing_route'}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={selectedScenario?.baseSource.kind === 'existing_route' ? 'Restore the selected route to its GTFS starting shape' : 'Only existing Barrie route templates can be reset to GTFS'}
                                >
                                    <RotateCcw size={13} />
                                    Reset To GTFS
                                </button>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${selectedAccent.pill}`}>
                                    {selectedScenario?.waypoints.length ?? 0} route points
                                </span>
                                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-600">
                                    {selectedScenario?.stops.length ?? 0} stops
                                </span>
                                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-600">
                                    {displaySelectedScenario ? `${displaySelectedScenario.runtimeMinutes} min runtime` : 'runtime pending'}
                                </span>
                            </div>
                            <p className="mb-4 text-sm font-semibold leading-relaxed text-gray-500">
                                {mapEditMode === 'route' && 'Edit Alignment mode: click the map to add ordered route points, then drag the numbered handles to refine the concept.'}
                                {mapEditMode === 'stop' && 'Edit Stops mode: click teal Barrie stop dots to add existing stops, or click anywhere else to add a custom stop. Drag stop markers to refine placement.'}
                                {mapEditMode === 'inspect' && 'Inspect mode: review the current route geometry, stop pattern, and compare scenario alignments before switching back into edit mode.'}
                            </p>
                            {isMapFullscreen && (
                                <div className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                                    Press `Esc` to exit fullscreen.
                                </div>
                            )}
                            <div className={isMapFullscreen ? 'min-h-0 flex-1 overflow-hidden rounded-3xl border-2 border-gray-200 bg-gray-50' : 'h-[520px] overflow-hidden rounded-3xl border-2 border-gray-200 bg-gray-50 xl:h-[620px]'}>
                                <MapBase
                                    longitude={-79.69}
                                    latitude={44.38}
                                    zoom={12}
                                    className="h-full"
                                    mapRef={mapRef}
                                    showNavigation
                                    showScale
                                    interactiveLayerIds={['route-planner-barrie-stops']}
                                    onClick={handleMapClick}
                                >
                                    <Source id="route-planner-barrie-stops-source" type="geojson" data={barrieStopsGeoJson}>
                                        <Layer {...barrieStopLayer} />
                                    </Source>
                                    {displayVisibleScenarios.map((scenario) => {
                                        const sourceRevision = [
                                            scenario.baseSource.kind,
                                            scenario.baseSource.sourceId ?? 'none',
                                            scenario.pattern,
                                            scenario.geometry.coordinates.length,
                                        ].join('-');

                                        return (
                                            <Source
                                                key={`${scenario.id}-${sourceRevision}`}
                                                id={`route-planner-${scenario.id}-${sourceRevision}`}
                                                type="geojson"
                                                data={{
                                                    type: 'FeatureCollection',
                                                    features: [{
                                                        type: 'Feature',
                                                        properties: { color: routeAccentStyles[scenario.accent].route },
                                                        geometry: scenario.geometry,
                                                    }],
                                                }}
                                            >
                                                {selectedScenario?.id === scenario.id && (
                                                    <Layer {...selectedLineLayer} id={`route-planner-selected-${scenario.id}-${sourceRevision}`} />
                                                )}
                                                <Layer {...lineLayer} id={`route-planner-line-${scenario.id}-${sourceRevision}`} />
                                            </Source>
                                        );
                                    })}
                                    {selectedScenario?.stops.map((stop, index) => (
                                        <Marker
                                            key={stop.id}
                                            longitude={stop.longitude}
                                            latitude={stop.latitude}
                                            draggable={mapEditMode === 'stop'}
                                            onDragEnd={(event) => handleStopDragEnd(stop.id, event)}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setSelectedStopId(stop.id)}
                                                className={`flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-2 text-[10px] font-extrabold text-white shadow transition-all ${
                                                    selectedStopId === stop.id ? 'scale-110 border-gray-900' : 'border-white'
                                                }`}
                                                style={{ backgroundColor: stop.kind === 'existing' ? '#059669' : '#0891b2' }}
                                            >
                                                {index + 1}
                                            </button>
                                        </Marker>
                                    ))}
                                    {selectedScenario?.waypoints.map((coordinate, index) => (
                                        <Marker
                                            key={`${selectedScenario.id}-waypoint-${index}`}
                                            longitude={coordinate[0]}
                                            latitude={coordinate[1]}
                                            draggable={mapEditMode === 'route'}
                                            onDragEnd={(event) => handleWaypointDragEnd(index, event)}
                                        >
                                            <button
                                                type="button"
                                                className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white text-[10px] font-extrabold text-white shadow ${
                                                    mapEditMode === 'route' ? 'cursor-grab' : 'cursor-default'
                                                }`}
                                                style={{ backgroundColor: selectedAccent.route }}
                                            >
                                                {index + 1}
                                            </button>
                                        </Marker>
                                    ))}
                                </MapBase>
                            </div>
                        </div>
                        <div className="mt-4 rounded-2xl border-2 border-gray-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Project Controller</p>
                                    <h4 className="mt-1 text-base font-extrabold text-gray-900">Route project state</h4>
                                </div>
                                <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                    Neutral Controller
                                </div>
                            </div>
                            <div className="grid gap-3">
                                <div>
                                    <label className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Project Name</label>
                                    <input
                                        type="text"
                                        value={draftProject.name}
                                        onChange={(event) => updateProjectName(event.target.value)}
                                        className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-brand-blue"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Project Description</label>
                                    <input
                                        type="text"
                                        value={draftProject.description ?? ''}
                                        onChange={(event) => updateProjectDescription(event.target.value)}
                                        className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-brand-blue"
                                    />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Scenario</div>
                                        <div className="mt-1 text-sm font-extrabold text-gray-900">{selectedScenario?.name ?? 'No scenario'}</div>
                                        <div className="mt-1 text-xs text-gray-500">{selectedScenario?.scenarioType ?? 'Unknown type'}</div>
                                    </div>
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Pattern</div>
                                        <div className="mt-1 text-sm font-extrabold text-gray-900">{selectedScenario?.pattern ?? 'Unknown'}</div>
                                        <div className="mt-1 text-xs text-gray-500">{selectedScenario?.baseSource.label ?? 'No base source'}</div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={duplicateSelectedScenario}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900"
                                    >
                                        <Copy size={13} />
                                        Duplicate Scenario
                                    </button>
                                    <button
                                        type="button"
                                        onClick={markSelectedScenarioPreferred}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-amber-800 transition-colors hover:bg-amber-100"
                                    >
                                        <Star size={13} />
                                        Mark Preferred
                                    </button>
                                    <button
                                        type="button"
                                        onClick={deleteSelectedScenario}
                                        disabled={draftProject.scenarios.length <= 1}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <Trash2 size={13} />
                                        Delete Scenario
                                    </button>
                                </div>
                                <div>
                                    <label className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Scenario Notes</label>
                                    <textarea
                                        value={selectedScenario?.notes ?? ''}
                                        onChange={(event) => updateSelectedScenarioNotes(event.target.value)}
                                        rows={4}
                                        className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-brand-blue"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <aside className="space-y-4">
                        {selectedStop && (
                            <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Selected Stop</p>
                                        <h3 className="mt-2 text-lg font-extrabold text-gray-900">{selectedStop.name}</h3>
                                        <p className="mt-1 text-xs font-semibold text-gray-500">
                                            {stopRoleLabel[selectedStop.role]} · {selectedStop.kind === 'existing' ? 'Existing Barrie stop' : 'Custom stop'}
                                        </p>
                                    </div>
                                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-blue-700">
                                        Stop editor
                                    </span>
                                </div>
                                <div className="space-y-3">
                                    <label className="block">
                                        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Stop Name</p>
                                        <input
                                            type="text"
                                            value={selectedStop.name}
                                            onChange={(event) => updateSelectedStopName(event.target.value)}
                                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                        />
                                    </label>
                                    <label className="block">
                                        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Stop Role</p>
                                        <select
                                            value={selectedStop.role}
                                            onChange={(event) => updateSelectedStopRole(event.target.value as keyof typeof stopRoleLabel)}
                                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                        >
                                            <option value="terminal">Terminal</option>
                                            <option value="timed">Timed</option>
                                            <option value="regular">Regular</option>
                                        </select>
                                    </label>
                                    <label className="block">
                                        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Derived First Trip Time</p>
                                        <input
                                            type="text"
                                            value={selectedStop.timeLabel}
                                            readOnly
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-500 outline-none"
                                        />
                                    </label>
                                    {selectedStopSupportsTimingAnchor ? (
                                        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3">
                                            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-indigo-700">Timing Anchor</p>
                                            <p className="mt-1 text-xs font-semibold leading-relaxed text-indigo-900">
                                                Set a manual offset from the first departure for this stop. Route Planner will interpolate the stops between timing anchors.
                                            </p>
                                            <div className="mt-3 flex items-end gap-2">
                                                <label className="block flex-1">
                                                    <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-indigo-700">Offset (min from first departure)</p>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={selectedStop.plannedOffsetMinutes ?? ''}
                                                        onChange={(event) => {
                                                            const nextValue = event.target.value.trim();
                                                            updateSelectedStopPlannedOffsetMinutes(nextValue === '' ? null : Number(nextValue));
                                                        }}
                                                        className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                                    />
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => updateSelectedStopPlannedOffsetMinutes(null)}
                                                    className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-indigo-700 transition-colors hover:bg-indigo-100"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold leading-relaxed text-gray-500">
                                            First-stop timing comes from the first departure. Last-stop timing comes from total runtime. Use interior stops as timing anchors when you need route-specific schedule structure.
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleRemoveStop}
                                        className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 transition-colors hover:bg-red-100"
                                    >
                                        <Trash2 size={14} className="mr-1 inline" />
                                        Remove Stop
                                    </button>
                                </div>
                            </section>
                        )}

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className="mb-4">
                                <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Service</p>
                                <h3 className="mt-2 text-lg font-extrabold text-gray-900">Service definition</h3>
                            </div>
                            {selectedScenario ? (
                                <div className="space-y-3">
                                    <label className="block">
                                        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Scenario Name</p>
                                        <input
                                            type="text"
                                            value={selectedScenario.name}
                                            onChange={(event) => updateSelectedScenarioName(event.target.value)}
                                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                        />
                                    </label>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Pattern</p>
                                            <select
                                                value={selectedScenario.pattern}
                                                onChange={(event) => updateSelectedScenarioPattern(event.target.value as typeof selectedScenario.pattern)}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            >
                                                <option value="out-and-back">Out-and-back</option>
                                                <option value="loop">Loop</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Status</p>
                                            <select
                                                value={selectedScenario.status}
                                                onChange={(event) => updateSelectedScenarioStatus(event.target.value as typeof selectedScenario.status)}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            >
                                                <option value="draft">Draft</option>
                                                <option value="ready_for_review">Ready for Review</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">First Departure</p>
                                            <input
                                                type="time"
                                                value={selectedScenario.firstDeparture}
                                                onChange={(event) => updateSelectedScenarioFirstDeparture(event.target.value)}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Last Departure</p>
                                            <input
                                                type="time"
                                                value={selectedScenario.lastDeparture}
                                                onChange={(event) => updateSelectedScenarioLastDeparture(event.target.value)}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Frequency (min)</p>
                                            <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={selectedScenario.frequencyMinutes}
                                                onChange={(event) => updateSelectedScenarioFrequencyMinutes(Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Layover (min)</p>
                                            <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={selectedScenario.layoverMinutes}
                                                onChange={(event) => updateSelectedScenarioLayoverMinutes(Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Timing Profile</p>
                                            <select
                                                value={selectedScenario.timingProfile}
                                                onChange={(event) => updateSelectedScenarioTimingProfile(event.target.value as typeof selectedScenario.timingProfile)}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            >
                                                <option value="balanced">Balanced</option>
                                                <option value="front_loaded">Front-loaded</option>
                                                <option value="back_loaded">Back-loaded</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Start Terminal Hold (min)</p>
                                            <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={selectedScenario.startTerminalHoldMinutes}
                                                onChange={(event) => updateSelectedScenarioStartTerminalHoldMinutes(Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">End Terminal Hold (min)</p>
                                            <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={selectedScenario.endTerminalHoldMinutes}
                                                onChange={(event) => updateSelectedScenarioEndTerminalHoldMinutes(Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                        <label className="block">
                                            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Walkshed (m)</p>
                                            <input
                                                type="number"
                                                min={200}
                                                max={1000}
                                                step={50}
                                                value={selectedScenario.coverageWalkshedMeters}
                                                onChange={(event) => updateSelectedScenarioCoverageWalkshedMeters(Number(event.target.value))}
                                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                            />
                                        </label>
                                    </div>
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Live Output</div>
                                        <div className="mt-2 text-sm font-semibold leading-relaxed text-gray-600">
                                            Service edits now recalculate runtime-aware departures, timing structure, coverage reach, cycle, buses required, and handoff exports for the selected scenario.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm font-semibold leading-relaxed text-gray-500">
                                    Select a scenario to edit service assumptions.
                                </p>
                            )}
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Timing Structure</p>
                                    <h3 className="mt-2 text-lg font-extrabold text-gray-900">Anchor plan</h3>
                                </div>
                                <div className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                    {selectedTimingPlan.filter((row) => row.isTimingAnchor).length} anchors
                                </div>
                            </div>
                            {displaySelectedScenario ? (
                                <div className="space-y-3">
                                    <p className="text-sm font-semibold leading-relaxed text-gray-600">
                                        Timed interior stops should usually carry anchors. Terminal holds and the selected timing profile shape the default interpolation between anchors.
                                    </p>
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Timing Profile</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {timingProfileLabel[displaySelectedScenario.timingProfile]}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Start Hold</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.startTerminalHoldMinutes} min
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">End Hold</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.endTerminalHoldMinutes} min
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        {selectedTimingPlan.map((row) => (
                                            <button
                                                key={row.stop.id}
                                                type="button"
                                                onClick={() => setSelectedStopId(row.stop.id)}
                                                className={`w-full rounded-2xl border p-3 text-left transition-all ${
                                                    selectedStopId === row.stop.id
                                                        ? 'border-brand-blue bg-cyan-50 shadow-sm'
                                                        : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-extrabold text-gray-900">{row.index + 1}. {row.stop.name}</div>
                                                        <div className="mt-1 text-xs font-semibold text-gray-500">
                                                            {stopRoleLabel[row.stop.role]} · first trip {row.stop.timeLabel}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1">
                                                        {row.isTimingAnchor ? (
                                                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-indigo-700">
                                                                Anchor +{row.stop.plannedOffsetMinutes}
                                                            </span>
                                                        ) : row.usesInterpolatedTiming ? (
                                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-700">
                                                                Timed but interpolated
                                                            </span>
                                                        ) : (
                                                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-gray-500">
                                                                {row.isInteriorStop ? 'Interpolated' : 'Terminal'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm font-semibold leading-relaxed text-gray-500">
                                    Select a scenario to review its timing anchors.
                                </p>
                            )}
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className={`rounded-2xl border p-4 ${observedStatusToneClass}`}>
                                <p className="text-xs font-extrabold uppercase tracking-[0.2em] opacity-75">Observed Runtime Proxy</p>
                                <h3 className="mt-2 text-lg font-extrabold">{observedRuntimeStatus.title}</h3>
                                <p className="mt-2 text-sm font-semibold leading-relaxed">{observedRuntimeStatus.body}</p>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <label className="block">
                                    <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Day Type</p>
                                    <select
                                        value={analysisDayType}
                                        onChange={(event) => setAnalysisDayType(event.target.value as DayType)}
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                    >
                                        {DAY_TYPES.map((dayType) => (
                                            <option key={dayType.id} value={dayType.id}>{dayType.label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Time Period</p>
                                    <select
                                        value={analysisPeriod}
                                        onChange={(event) => setAnalysisPeriod(event.target.value as TimePeriod)}
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-brand-blue"
                                    >
                                        {TIME_PERIODS.map((period) => (
                                            <option key={period.id} value={period.id}>{period.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {displaySelectedScenario && (
                                <div className="mt-4 space-y-3">
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Matched Segments</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {selectedObservedSummary ? `${selectedObservedSummary.matchedSegmentCount} / ${selectedObservedSummary.totalSegmentCount}` : '0 / 0'}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Minimum Samples</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {selectedObservedSummary?.matchedSegmentCount ? selectedObservedSummary.minimumSampleCount : 'None'}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Runtime Source</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.runtimeSourceMode === 'observed_proxy'
                                                    ? 'Observed + fallback mix'
                                                    : displaySelectedScenario.runtimeSourceMode === 'manual_override'
                                                        ? 'Manual override'
                                                        : 'Fallback estimate'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Segment Evidence</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">{displaySelectedScenario.name}</div>
                                            </div>
                                            <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                                {TIME_PERIODS.find((period) => period.id === analysisPeriod)?.label} · {DAY_TYPES.find((dayType) => dayType.id === analysisDayType)?.label}
                                            </div>
                                        </div>
                                        {selectedObservedSummary && selectedObservedSummary.segments.length > 0 ? (
                                            <div className="mt-3 space-y-2">
                                                {selectedObservedSummary.segments.map((segment) => (
                                                    <div key={segment.key} className="rounded-xl border border-gray-200 bg-white p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-extrabold text-gray-900">
                                                                    {segment.fromStopName} to {segment.toStopName}
                                                                </div>
                                                                <div className="mt-1 text-xs font-semibold text-gray-500">
                                                                    {segment.source === 'observed'
                                                                        ? `${segment.sampleCount} samples${segment.directionId ? ` · ${segment.directionId}` : ''}`
                                                                        : 'Fallback segment estimate'}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col items-end gap-1">
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] ${
                                                                    segment.source === 'observed'
                                                                        ? 'bg-emerald-100 text-emerald-700'
                                                                        : 'bg-gray-100 text-gray-500'
                                                                }`}>
                                                                    {segment.source === 'observed' ? 'Observed' : 'Fallback'}
                                                                </span>
                                                                <div className="text-sm font-extrabold text-gray-900">{segment.runtimeMinutes} min</div>
                                                            </div>
                                                        </div>
                                                        {segment.lowConfidence && (
                                                            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                                                                Low-confidence observed segment. Confirm with manual review before relying on this timing.
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-3 text-sm font-semibold leading-relaxed text-gray-500">
                                                Add at least two stops with matching Barrie stop IDs to use the observed stop-to-stop proxy layer.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Coverage</p>
                                    <h3 className="mt-2 text-lg font-extrabold text-gray-900">Strategic market reach</h3>
                                </div>
                                <div className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                    Starter Layer
                                </div>
                            </div>
                            {displaySelectedScenario ? (
                                <div className="space-y-3">
                                    <p className="text-sm font-semibold leading-relaxed text-gray-600">
                                        This first-pass coverage layer checks whether the scenario serves Barrie strategic hubs and schools inside the selected walkshed. Population and employment layers can replace this later without changing the scenario model.
                                    </p>
                                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Served Points</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.coverage.servedMarketPoints ?? 0} / {displaySelectedScenario.coverage.totalMarketPoints ?? 0}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Schools</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.coverage.servedSchools ?? 0} / {displaySelectedScenario.coverage.totalSchools ?? 0}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Hubs</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.coverage.servedHubs ?? 0} / {displaySelectedScenario.coverage.totalHubs ?? 0}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Walkshed</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                {displaySelectedScenario.coverage.walkshedRadiusMeters ?? displaySelectedScenario.coverageWalkshedMeters} m
                                            </div>
                                        </div>
                                    </div>
                                    {compareMode && displayVisibleScenarios.length > 1 && (
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Point Delta</div>
                                                <div className={`mt-1 text-sm font-extrabold ${
                                                    coverageComparisonDelta.servedMarketPointsDelta > 0
                                                        ? 'text-emerald-700'
                                                        : coverageComparisonDelta.servedMarketPointsDelta < 0
                                                            ? 'text-rose-700'
                                                            : 'text-gray-900'
                                                }`}>
                                                    {formatSignedDelta(coverageComparisonDelta.servedMarketPointsDelta)}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">School Delta</div>
                                                <div className={`mt-1 text-sm font-extrabold ${
                                                    coverageComparisonDelta.servedSchoolsDelta > 0
                                                        ? 'text-emerald-700'
                                                        : coverageComparisonDelta.servedSchoolsDelta < 0
                                                            ? 'text-rose-700'
                                                            : 'text-gray-900'
                                                }`}>
                                                    {formatSignedDelta(coverageComparisonDelta.servedSchoolsDelta)}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Hub Delta</div>
                                                <div className={`mt-1 text-sm font-extrabold ${
                                                    coverageComparisonDelta.servedHubsDelta > 0
                                                        ? 'text-emerald-700'
                                                        : coverageComparisonDelta.servedHubsDelta < 0
                                                            ? 'text-rose-700'
                                                            : 'text-gray-900'
                                                }`}>
                                                    {formatSignedDelta(coverageComparisonDelta.servedHubsDelta)}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Served Strategic Points</div>
                                        {displaySelectedScenario.coverage.servedPointLabels && displaySelectedScenario.coverage.servedPointLabels.length > 0 ? (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {displaySelectedScenario.coverage.servedPointLabels.map((label) => (
                                                    <span
                                                        key={label}
                                                        className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-gray-600"
                                                    >
                                                        {label}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-500">
                                                Add stops near a strategic hub or school to begin coverage comparison.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm font-semibold leading-relaxed text-gray-500">
                                    Select a scenario to review coverage reach.
                                </p>
                            )}
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Projects</p>
                                    <h3 className="text-lg font-extrabold text-gray-900">Saved route studies</h3>
                                </div>
                                <div className="rounded-xl bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">
                                    {isLoadingProjects ? 'Loading...' : `${projects.length} saved`}
                                </div>
                            </div>
                            <div className="space-y-3">
                                {localDraftProject && (
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => selectProject(localDraftProject)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                selectProject(localDraftProject);
                                            }
                                        }}
                                        className={`w-full cursor-pointer rounded-2xl border-2 border-dashed p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-brand-blue/40 ${
                                            draftProject.id === localDraftProject.id
                                                ? 'border-indigo-300 bg-indigo-50/70 shadow-sm'
                                                : 'border-indigo-200 bg-indigo-50/50 hover:border-indigo-300 hover:bg-indigo-50'
                                        }`}
                                    >
                                        <p className="text-sm font-extrabold text-gray-900">{localDraftProject.name}</p>
                                        <p className="mt-1 text-xs font-semibold text-gray-500">Current local route study. Save it to make it available across sessions and devices.</p>
                                    </div>
                                )}
                                {projects.map((project) => {
                                    const isSelectedProject = project.id === draftProject.id;

                                    return (
                                        <div
                                            key={project.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => selectProject(project)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    selectProject(project);
                                                }
                                            }}
                                            className={`w-full cursor-pointer rounded-2xl border-2 p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-brand-blue/40 ${
                                                isSelectedProject
                                                    ? 'border-brand-blue bg-cyan-50 shadow-sm'
                                                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white'
                                            }`}
                                        >
                                            <div className="text-sm font-extrabold text-gray-900">{project.name}</div>
                                            <div className="mt-1 text-xs font-semibold text-gray-500">
                                                {project.scenarios.length} scenarios · {project.description ?? 'No description yet.'}
                                            </div>
                                        </div>
                                    );
                                })}
                                {!isLocalDraft && projects.length === 0 && (
                                    <p className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
                                        No saved route studies yet. Save the current draft to start building a library.
                                    </p>
                                )}
                            </div>
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Scenario Workflow</p>
                                    <h3 className="mt-2 text-lg font-extrabold text-gray-900">Draft scenarios</h3>
                                </div>
                                <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-1">
                                    <button
                                        type="button"
                                        onClick={() => setCompareMode(false)}
                                        className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                            !compareMode ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        Scenario
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCompareMode(true)}
                                        disabled={!canCompare}
                                        className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                            compareMode ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                        } disabled:cursor-not-allowed disabled:opacity-50`}
                                    >
                                        Compare
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {draftProject.scenarios.map((scenario) => {
                                    const displayScenario = displayScenarioById.get(scenario.id) ?? scenario;
                                    const isSelected = scenario.id === selectedScenarioId;
                                    const isPreferred = draftProject.preferredScenarioId === scenario.id;

                                    return (
                                        <button
                                            key={scenario.id}
                                            type="button"
                                            onClick={() => setSelectedScenarioId(scenario.id)}
                                            className={`w-full rounded-2xl border-2 p-3 text-left transition-all ${
                                                isSelected
                                                    ? 'border-brand-blue bg-cyan-50 shadow-sm'
                                                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-extrabold text-gray-900">{scenario.name}</div>
                                                        <div className="mt-1 text-xs font-semibold text-gray-500">
                                                        {displayScenario.pattern} · {displayScenario.runtimeMinutes} min runtime · {displayScenario.busesRequired} buses · {scenario.waypoints.length} points · {scenario.stops.length} stops
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    {isPreferred && (
                                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-700">
                                                            Preferred
                                                        </span>
                                                    )}
                                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-gray-500">
                                                        {scenario.status}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Shared Planner State</p>
                            <h3 className="mt-2 text-lg font-extrabold text-gray-900">Current project snapshot</h3>
                            {plannerSnapshot ? (
                                <div className="mt-3 space-y-3 text-sm font-semibold text-gray-700">
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Project</div>
                                        <div className="mt-1 text-sm font-extrabold text-gray-900">{plannerSnapshot.projectName}</div>
                                        <div className="mt-1 text-xs text-gray-500">{plannerSnapshot.projectDescription ?? 'No description yet.'}</div>
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Selected Scenario</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">{plannerSnapshot.selectedScenarioName ?? 'None selected'}</div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Scenario Count</div>
                                            <div className="mt-1 text-sm font-extrabold text-gray-900">{plannerSnapshot.scenarioCount}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-3 text-sm font-semibold leading-relaxed text-gray-500">
                                    Open Shuttle Concept first to populate the shared Route Planner project and scenario snapshot.
                                </p>
                            )}
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Draft Outputs</p>
                            <h3 className="mt-2 text-lg font-extrabold text-gray-900">Scenario metrics</h3>
                            <div className="mt-3 space-y-3 text-sm font-semibold text-gray-700">
                                {selectedImpactSummary && displaySelectedScenario && selectedBaselineScenario && (
                                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-700">Schedule Impact</div>
                                                <div className="mt-1 text-sm font-extrabold text-emerald-950">
                                                    {selectedBaselineScenario.name} vs {displaySelectedScenario.name}
                                                </div>
                                                <p className="mt-2 max-w-xl text-xs font-semibold leading-relaxed text-emerald-900/80">
                                                    The GTFS baseline stays intact. These deltas show what the selected roadway and stop changes would mean before schedule editing starts.
                                                </p>
                                            </div>
                                            <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
                                                Before / After
                                            </div>
                                        </div>
                                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                            {[
                                                {
                                                    label: 'Runtime',
                                                    before: `${selectedBaselineScenario.runtimeMinutes} min`,
                                                    after: `${displaySelectedScenario.runtimeMinutes} min`,
                                                    delta: `${formatSignedDelta(selectedImpactSummary.runtimeDeltaMinutes)} min`,
                                                },
                                                {
                                                    label: 'Cycle',
                                                    before: `${selectedBaselineScenario.cycleMinutes} min`,
                                                    after: `${displaySelectedScenario.cycleMinutes} min`,
                                                    delta: `${formatSignedDelta(selectedImpactSummary.cycleDeltaMinutes)} min`,
                                                },
                                                {
                                                    label: 'Buses',
                                                    before: `${selectedBaselineScenario.busesRequired}`,
                                                    after: `${displaySelectedScenario.busesRequired}`,
                                                    delta: formatSignedDelta(selectedImpactSummary.busesDelta),
                                                },
                                                {
                                                    label: 'Distance',
                                                    before: `${selectedBaselineScenario.distanceKm} km`,
                                                    after: `${displaySelectedScenario.distanceKm} km`,
                                                    delta: `${formatSignedDelta(selectedImpactSummary.distanceDeltaKm)} km`,
                                                },
                                                {
                                                    label: 'Stops',
                                                    before: `${selectedBaselineScenario.stops.length}`,
                                                    after: `${displaySelectedScenario.stops.length}`,
                                                    delta: formatSignedDelta(selectedImpactSummary.stopDelta),
                                                },
                                                {
                                                    label: 'Coverage',
                                                    before: `${selectedBaselineScenario.coverage.servedMarketPoints ?? 0}/${selectedBaselineScenario.coverage.totalMarketPoints ?? 0}`,
                                                    after: `${displaySelectedScenario.coverage.servedMarketPoints ?? 0}/${displaySelectedScenario.coverage.totalMarketPoints ?? 0}`,
                                                    delta: formatSignedDelta(selectedImpactSummary.coverageDelta.servedMarketPointsDelta),
                                                },
                                                {
                                                    label: 'Warnings',
                                                    before: `${selectedBaselineScenario.warnings.length}`,
                                                    after: `${displaySelectedScenario.warnings.length}`,
                                                    delta: formatSignedDelta(selectedImpactSummary.warningDelta),
                                                },
                                                {
                                                    label: 'Service Hours',
                                                    before: `${selectedBaselineScenario.serviceHours}`,
                                                    after: `${displaySelectedScenario.serviceHours}`,
                                                    delta: formatSignedDelta(selectedImpactSummary.serviceHoursDelta),
                                                },
                                            ].map((metric) => (
                                                <div key={metric.label} className="rounded-2xl border border-emerald-200 bg-white p-3">
                                                    <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-700">{metric.label}</div>
                                                    <div className="mt-2 grid gap-1 text-xs font-bold text-gray-500">
                                                        <div>Before: <span className="text-sm font-extrabold text-gray-900">{metric.before}</span></div>
                                                        <div>After: <span className="text-sm font-extrabold text-gray-900">{metric.after}</span></div>
                                                        <div>Delta: <span className={`text-sm font-extrabold ${
                                                            metric.delta.startsWith('+')
                                                                ? 'text-emerald-700'
                                                                : metric.delta.startsWith('-')
                                                                    ? 'text-rose-700'
                                                                    : 'text-gray-900'
                                                        }`}>{metric.delta}</span></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {displayVisibleScenarios.length > 1 && (
                                    <div
                                        className="grid gap-2"
                                        style={{ gridTemplateColumns: `repeat(${displayVisibleScenarios.length}, minmax(0, 1fr))` }}
                                    >
                                        {displayVisibleScenarios.map((scenario) => (
                                            <div key={`metric-label-${scenario.id}`} className="rounded-2xl border border-gray-200 bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">
                                                    {scenario.id === selectedScenarioId ? 'Selected' : 'Compare'}
                                                </div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">{scenario.name}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {[
                                    { label: 'Runtime', values: displayVisibleScenarios.map((scenario) => `${scenario.runtimeMinutes} min`) },
                                    { label: 'Cycle', values: displayVisibleScenarios.map((scenario) => `${scenario.cycleMinutes} min`) },
                                    { label: 'Buses', values: displayVisibleScenarios.map((scenario) => `${scenario.busesRequired}`) },
                                    { label: 'Distance', values: displayVisibleScenarios.map((scenario) => `${scenario.distanceKm} km`) },
                                    { label: 'Stops', values: displayVisibleScenarios.map((scenario) => `${scenario.stops.length}`) },
                                    { label: 'Coverage', values: displayVisibleScenarios.map((scenario) => `${scenario.coverage.servedMarketPoints ?? 0}/${scenario.coverage.totalMarketPoints ?? 0}`) },
                                    { label: 'Warnings', values: displayVisibleScenarios.map((scenario) => `${scenario.warnings.length}`) },
                                ].map((row) => (
                                    <div key={row.label} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">{row.label}</div>
                                        <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${row.values.length}, minmax(0, 1fr))` }}>
                                            {row.values.map((value, index) => (
                                                <div key={`${row.label}-${displayVisibleScenarios[index]?.id ?? index}`} className="rounded-xl bg-white px-3 py-2 text-sm font-extrabold text-gray-900">
                                                    {value}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-400">Output</p>
                            <h3 className="mt-2 text-lg font-extrabold text-gray-900">Scheduling handoff</h3>
                            {preferredDisplayScenario ? (
                                <div className="mt-3 space-y-3 text-sm font-semibold text-gray-700">
                                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-700">Preferred Scenario</div>
                                                <div className="mt-1 text-sm font-extrabold text-emerald-950">{preferredDisplayScenario.name}</div>
                                            </div>
                                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
                                                {preferredDisplayScenario.status}
                                            </span>
                                        </div>
                                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                                            <div className="rounded-xl bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Runtime</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">{preferredDisplayScenario.runtimeMinutes} min</div>
                                            </div>
                                            <div className="rounded-xl bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Cycle / Buses</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">{preferredDisplayScenario.cycleMinutes} min · {preferredDisplayScenario.busesRequired} buses</div>
                                            </div>
                                            <div className="rounded-xl bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Span / Frequency</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">{preferredDisplayScenario.firstDeparture} to {preferredDisplayScenario.lastDeparture} · every {preferredDisplayScenario.frequencyMinutes} min</div>
                                            </div>
                                            <div className="rounded-xl bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Timing Structure</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                    {timingProfileLabel[preferredDisplayScenario.timingProfile]} · {preferredDisplayScenario.startTerminalHoldMinutes}/{preferredDisplayScenario.endTerminalHoldMinutes} min holds
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Runtime Source</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                    {preferredDisplayScenario.runtimeSourceMode === 'observed_proxy'
                                                        ? `Observed proxy ${preferredObservedSummary ? `(${preferredObservedSummary.matchedSegmentCount}/${preferredObservedSummary.totalSegmentCount})` : ''}`
                                                        : preferredDisplayScenario.runtimeSourceMode === 'manual_override'
                                                            ? 'Manual override'
                                                            : 'Fallback estimate'}
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-white px-3 py-2">
                                                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Coverage Reach</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">
                                                    {preferredDisplayScenario.coverage.servedMarketPoints ?? 0}/{preferredDisplayScenario.coverage.totalMarketPoints ?? 0} strategic points
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Downstream Package</div>
                                        <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-600">
                                            Export the full project summary for planning review, or export the preferred-scenario handoff brief for downstream scheduling work.
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={handleExportStudy}
                                                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900"
                                            >
                                                <FileDown size={13} />
                                                Export Study Summary
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleExportHandoff}
                                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-800 transition-colors hover:bg-emerald-100"
                                            >
                                                <FileDown size={13} />
                                                Export Handoff Brief
                                            </button>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Scheduling Notes</div>
                                        <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-600">
                                            {preferredDisplayScenario.notes.trim() || 'No scenario notes provided yet.'}
                                        </p>
                                        <div className="mt-3 text-xs font-bold text-gray-500">
                                            First departures: {preferredDisplayScenario.departures.slice(0, 5).join(', ') || 'None yet'}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Timetable Preview</div>
                                                <div className="mt-1 text-sm font-extrabold text-gray-900">First departures by stop</div>
                                            </div>
                                            <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                                Schedule-ready preview
                                            </div>
                                        </div>
                                        {preferredTimetablePreview && preferredTimetablePreview.departures.length > 0 && preferredTimetablePreview.rows.length > 0 ? (
                                            <div className="mt-3 overflow-x-auto">
                                                <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-gray-200 bg-white text-sm">
                                                    <thead>
                                                        <tr className="bg-gray-50">
                                                            <th className="border-b border-gray-200 px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Stop</th>
                                                            <th className="border-b border-gray-200 px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Role</th>
                                                            {preferredTimetablePreview.departures.map((departure) => (
                                                                <th key={departure} className="border-b border-gray-200 px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-[0.14em] text-gray-400">
                                                                    {departure}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {preferredTimetablePreview.rows.map((row) => (
                                                            <tr key={row.stopId}>
                                                                <td className="border-b border-gray-100 px-3 py-2 font-bold text-gray-900">{row.stopName}</td>
                                                                <td className="border-b border-gray-100 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-500">{stopRoleLabel[row.role]}</td>
                                                                {row.times.map((time, index) => (
                                                                    <td key={`${row.stopId}-${preferredTimetablePreview.departures[index] ?? index}`} className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">
                                                                        {time}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <p className="mt-3 text-sm font-semibold leading-relaxed text-gray-500">
                                                Enter a valid span and add stops to generate a timing preview for downstream scheduling.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-3 text-sm font-semibold leading-relaxed text-gray-500">
                                    Select or create a scenario to generate a route-study summary and scheduling handoff.
                                </p>
                            )}
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}

export const RoutePlannerWorkspace: React.FC<RoutePlannerWorkspaceProps> = ({ onBack, userId, teamId }) => {
    const controller = useRoutePlannerController({
        userId,
        teamId,
    });
    const modeStrip = <PlannerModeStrip selectedMode={controller.selectedMode} onSelect={controller.setSelectedMode} />;

    if (controller.selectedMode === 'existing-route-tweak') {
        return (
            <PlannedModePanel
                title="Existing Route Tweak"
                summary="Load an existing Barrie route, adjust roadway choice or stop pattern, and compare operational and rider-facing impacts before moving into schedule work."
                onBack={onBack}
                selectedMode={controller.selectedMode}
                onSelectMode={controller.setSelectedMode}
                plannerSnapshot={controller.plannerSnapshot}
                projectController={controller.existingRouteProjectController}
                isSignedIn={Boolean(userId)}
                teamId={teamId}
            />
        );
    }

    if (controller.selectedMode === 'route-concept') {
        return (
            <PlannedModePanel
                title="Route Concept"
                summary="Create broader route options from a blank concept using the same Friendly planning workspace, shared runtime engine, and later coverage analysis layers."
                onBack={onBack}
                selectedMode={controller.selectedMode}
                onSelectMode={controller.setSelectedMode}
                plannerSnapshot={controller.plannerSnapshot}
                projectController={controller.routeConceptProjectController}
                isSignedIn={Boolean(userId)}
                teamId={teamId}
            />
        );
    }

    return (
        <ShuttlePlannerWorkspaceView
            onBack={onBack}
            userId={userId}
            teamId={teamId}
            controller={controller.shuttleController}
            headerTitle="Route Planner"
            headerBadge="Shuttle Concept"
            headerDescription="Shuttle Concept is the first live Route Planner mode. Existing Route Tweak and Route Concept are now visible in the shared shell and will be added onto the same planning engine."
            headerContent={modeStrip}
            backLabel="Back to Planning Data"
        />
    );
};
