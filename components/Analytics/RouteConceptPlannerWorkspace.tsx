import React, { useEffect, useId, useMemo, useState } from 'react';
import {
    AlertTriangle, ArrowLeft, Bus, Check, Copy, FolderOpen,
    GitCompare, Loader2, MapPin, Plus, Route, Save, Search, Star, Trash2, X,
} from 'lucide-react';

import {
    addRouteConceptAlignmentPoint,
    addRouteConceptAlternative,
    addRouteConceptStop,
    clearRouteConceptRuntimeOverride,
    createRouteConceptReversedReturn,
    createRouteConceptProject,
    deleteRouteConceptAlignmentPoint,
    deleteRouteConceptAlternative,
    deleteRouteConceptStop,
    deriveRouteConceptFeasibility,
    duplicateRouteConceptAlternative,
    formatRouteConceptServiceTime,
    markRouteConceptPreferred,
    mergeRouteConceptRuntimeEvidence,
    moveRouteConceptAlignmentPoint,
    moveRouteConceptStop,
    parseRouteConceptServiceTime,
    reorderRouteConceptStop,
    replaceRouteConceptPattern,
    selectRouteConceptAlternative,
    setRouteConceptRuntimeOverride,
    summarizeRouteConceptProject,
    updateRouteConceptService,
    type RouteConceptAlternative,
    type RouteConceptPattern,
    type RouteConceptProject,
    type RouteConceptServiceAssumptions,
    type RouteConceptStructure,
} from '../../utils/route-concept-planner';
import {
    convertRouteConceptGtfsSelections,
    loadRouteConceptGtfsPatterns,
    type RouteConceptGtfsPatternCandidate,
} from '../../utils/route-concept-planner/routeConceptPlannerGtfsAdapter';
import {
    listRouteConceptSavedProjects,
    loadRouteConceptProject,
    RouteConceptPersistenceConflictError,
    saveRouteConceptProject,
    saveRouteConceptProjectAsCopy,
    type RouteConceptSavedProjectSummary,
} from '../../utils/route-concept-planner/routeConceptPlannerPersistence';
import { RouteConceptGtfsImportDrawer } from './route-concept-planner/RouteConceptGtfsImportDrawer';
import { RouteConceptMapBridge } from './route-concept-planner/RouteConceptMapBridge';
import { RouteConceptAccessibleOverlay } from './route-concept-planner/RouteConceptAccessibleOverlay';
import { saveFixedRouteResumeState } from '../../utils/workspaces/fixedRouteResumeState';
import { searchRouteConceptPlaces, type RouteConceptPlaceSuggestion } from '../../utils/route-concept-planner/routeConceptPlannerEngineAdapter';

interface RouteConceptPlannerWorkspaceProps {
    onBack: () => void;
    userId?: string | null;
    teamId?: string | null;
    services?: Partial<RouteConceptPlannerServices>;
}

export interface RouteConceptPlannerServices {
    loadGtfsPatterns: typeof loadRouteConceptGtfsPatterns;
    listSavedProjects: typeof listRouteConceptSavedProjects;
    loadProject: typeof loadRouteConceptProject;
    saveProject: typeof saveRouteConceptProject;
    saveProjectAsCopy: typeof saveRouteConceptProjectAsCopy;
    searchPlaces: typeof searchRouteConceptPlaces;
}

const DEFAULT_SERVICES: RouteConceptPlannerServices = {
    loadGtfsPatterns: loadRouteConceptGtfsPatterns,
    listSavedProjects: listRouteConceptSavedProjects,
    loadProject: loadRouteConceptProject,
    saveProject: saveRouteConceptProject,
    saveProjectAsCopy: saveRouteConceptProjectAsCopy,
    searchPlaces: searchRouteConceptPlaces,
};

type RightTab = 'route' | 'service' | 'review';

const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45';
const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function serviceTime(minutes: number): string {
    return formatRouteConceptServiceTime(minutes)?.label ?? '';
}

function ServiceTimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
    const [draft, setDraft] = useState(serviceTime(value));
    const [error, setError] = useState<string | null>(null);
    const helpId = useId();
    const errorId = useId();
    useEffect(() => { setDraft(serviceTime(value)); setError(null); }, [value]);
    const commit = () => {
        const parsed = parseRouteConceptServiceTime(draft);
        if (parsed == null) {
            setError('Enter a valid service time, such as 06:30, 25:00, or 01:00 + 1 day.');
            return;
        }
        setError(null);
        onCommit(parsed);
    };
    return <label className="block text-xs font-bold text-slate-600">{label}<input aria-label={label} aria-invalid={Boolean(error)} aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} className={`${field} mt-1`} value={draft} onChange={(event) => { setDraft(event.target.value); setError(null); }} onBlur={commit} onKeyDown={(event) => event.key === 'Enter' && commit()} /><span id={helpId} className="mt-1 block font-medium text-slate-500">Use 25:00 or 01:00 + 1 day for next-day service.</span>{error && <span id={errorId} role="alert" className="mt-1 block font-bold text-red-700">{error}</span>}</label>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-black text-slate-950">{value}</div>{detail && <div className="mt-1 text-xs font-semibold text-slate-500">{detail}</div>}</div>;
}

function normalizeExplicitTurnaround(pattern: RouteConceptPattern, alternative: RouteConceptAlternative): RouteConceptPattern {
    if (alternative.structure !== 'out-and-back' || (pattern.role !== 'outbound' && pattern.role !== 'inbound') || pattern.stops.length < 2) return pattern;
    const ordered = [...pattern.stops].sort((left, right) => left.sequence - right.sequence);
    return { ...pattern, stops: pattern.stops.map((stop) => {
        const index = ordered.findIndex((item) => item.id === stop.id);
        if (pattern.role === 'outbound' && index === 0) return { ...stop, role: 'start-terminal' as const };
        if (pattern.role === 'outbound' && index === ordered.length - 1) return { ...stop, role: 'turnaround' as const };
        if (pattern.role === 'inbound' && index === 0) return { ...stop, role: 'turnaround' as const };
        if (pattern.role === 'inbound' && index === ordered.length - 1) return { ...stop, role: 'end-terminal' as const };
        return stop.role === 'start-terminal' || stop.role === 'end-terminal' || stop.role === 'turnaround' ? { ...stop, role: 'regular' as const } : stop;
    }) };
}

function StartScreen({ canSave, error, onBlank, onImport, onLoad }: { canSave: boolean; error?: string; onBlank: (structure: RouteConceptStructure) => void; onImport: () => void; onLoad: () => void }) {
    const [structure, setStructure] = useState<RouteConceptStructure>('bidirectional');
    return <div className="flex h-full items-center justify-center overflow-y-auto bg-slate-50 p-6">
        <div className="w-full max-w-4xl">
            <div className="mb-8 text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-cyan-700 text-white shadow-lg"><Route size={28} /></div><div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-cyan-700">Internal beta</div><h1 className="mt-2 text-3xl font-black text-slate-950">Route Concept Planner</h1><p className="mx-auto mt-2 max-w-2xl text-slate-600">Test complete fixed-route concepts with scheduled GTFS evidence, road travel times, and planner-controlled service assumptions.</p></div>
            {error && <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{error}</div>}
            <div className="grid gap-4 md:grid-cols-3">
                <button onClick={onImport} className="rounded-3xl border border-cyan-200 bg-white p-6 text-left shadow-sm hover:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"><Bus className="text-cyan-700" /><h2 className="mt-4 text-lg font-black text-slate-900">Import GTFS route</h2><p className="mt-2 text-sm text-slate-600">Start with full scheduled patterns and runtime evidence.</p></button>
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><MapPin className="text-cyan-700" /><h2 className="mt-4 text-lg font-black text-slate-900">Start blank</h2><p className="mt-2 text-sm text-slate-600">Draw a new complete route concept.</p><select aria-label="Route structure" className={`${field} mt-4`} value={structure} onChange={(e) => setStructure(e.target.value as RouteConceptStructure)}><option value="bidirectional">Two directions</option><option value="loop">Loop</option><option value="out-and-back">Out and back</option></select><button onClick={() => onBlank(structure)} className="mt-3 w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2">Create concept</button></div>
                <button onClick={onLoad} disabled={!canSave} className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 disabled:opacity-50"><FolderOpen className="text-cyan-700" /><h2 className="mt-4 text-lg font-black text-slate-900">Load team project</h2><p className="mt-2 text-sm text-slate-600">Continue a saved concept study{canSave ? '.' : ' after signing in to a team.'}</p></button>
            </div>
            <p className="mt-6 text-center text-xs font-semibold text-slate-500">Planning estimates only. This workspace does not create schedules or change GTFS.</p>
        </div>
    </div>;
}

export const RouteConceptPlannerWorkspace: React.FC<RouteConceptPlannerWorkspaceProps> = ({ onBack, userId, teamId, services }) => {
    const plannerServices = useMemo(() => ({ ...DEFAULT_SERVICES, ...services }), [services]);
    const [project, setProject] = useState<RouteConceptProject | null>(null);
    const [activePatternId, setActivePatternId] = useState<string | null>(null);
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [tab, setTab] = useState<RightTab>('route');
    const [gtfsOpen, setGtfsOpen] = useState(false);
    const [gtfsPatterns, setGtfsPatterns] = useState<RouteConceptGtfsPatternCandidate[]>([]);
    const [gtfsLoading, setGtfsLoading] = useState(false);
    const [gtfsError, setGtfsError] = useState<string | null>(null);
    const [loadOpen, setLoadOpen] = useState(false);
    const [savedProjects, setSavedProjects] = useState<RouteConceptSavedProjectSummary[]>([]);
    const [loadingSaved, setLoadingSaved] = useState(false);
    const [compareOpen, setCompareOpen] = useState(false);
    const [addAlternativeOpen, setAddAlternativeOpen] = useState(false);
    const [conflictOpen, setConflictOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
    const canPersist = Boolean(teamId && userId);
    const dirty = project?.status === 'local-draft';

    const selectedAlternative = project?.alternatives.find((item) => item.id === project.selectedAlternativeId) ?? null;
    const activePattern = selectedAlternative?.patterns.find((item) => item.id === activePatternId)
        ?? selectedAlternative?.patterns.find((item) => item.id === selectedAlternative.patternOrder[0])
        ?? selectedAlternative?.patterns[0] ?? null;
    const feasibility = useMemo(() => selectedAlternative ? deriveRouteConceptFeasibility(selectedAlternative) : null, [selectedAlternative]);
    const summary = useMemo(() => project ? summarizeRouteConceptProject(project) : null, [project]);
    const resumeProjectName = project?.name;

    useEffect(() => {
        if (!selectedAlternative) return;
        if (!selectedAlternative.patterns.some((item) => item.id === activePatternId)) setActivePatternId(selectedAlternative.patternOrder[0] ?? null);
    }, [activePatternId, selectedAlternative]);
    useEffect(() => {
        if (!dirty) return;
        const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);
    useEffect(() => {
        if (!resumeProjectName) return;
        saveFixedRouteResumeState({
            hash: '#planning/route-concept-planner',
            label: `Planning Data · Route Concept Planner · ${resumeProjectName.trim() || 'Untitled Route Concept Study'}`,
        }, userId);
    }, [resumeProjectName, userId]);

    const updateProject = (next: RouteConceptProject | ((current: RouteConceptProject) => RouteConceptProject)) => {
        setProject((current) => {
            if (!current) return current;
            const value = typeof next === 'function' ? next(current) : next;
            return value === current ? current : { ...value, status: 'local-draft' };
        });
    };
    const updatePattern = (transform: (pattern: RouteConceptPattern) => RouteConceptPattern) => {
        const alternativeId = selectedAlternative?.id;
        const patternId = activePattern?.id;
        if (!alternativeId || !patternId) return;
        setProject((current) => {
            if (!current) return current;
            const alternative = current.alternatives.find((item) => item.id === alternativeId);
            const pattern = alternative?.patterns.find((item) => item.id === patternId);
            if (!alternative || !pattern) return current;
            const next = replaceRouteConceptPattern(current, alternativeId, normalizeExplicitTurnaround(transform(pattern), alternative));
            return {
                ...next,
                status: 'local-draft',
                alternatives: next.alternatives.map((item) => item.id === alternativeId ? { ...item, status: 'draft' } : item),
            };
        });
    };
    const beginBlank = (structure: RouteConceptStructure) => {
        const next = createRouteConceptProject({ structure });
        setProject(next); setActivePatternId(next.alternatives[0]?.patternOrder[0] ?? null); setMessage(null);
    };
    const loadGtfs = async (forceRefresh = false) => {
        setGtfsOpen(true); setGtfsLoading(true); setGtfsError(null);
        try { setGtfsPatterns(await plannerServices.loadGtfsPatterns({ forceRefresh })); }
        catch (error) { setGtfsError(displayError(error)); }
        finally { setGtfsLoading(false); }
    };
    const importGtfs = (patterns: RouteConceptGtfsPatternCandidate[]) => {
        try {
            const alternatives = convertRouteConceptGtfsSelections(patterns);
            if (!alternatives.length) return;
            const base = project ?? createRouteConceptProject({ name: `${alternatives[0]!.name} Study` });
            const existingIds = new Set(base.alternatives.map((item) => item.id));
            const incoming = alternatives.map((alternative) => existingIds.has(alternative.id)
                ? { ...alternative, id: `${alternative.id}-${Date.now()}` }
                : alternative);
            const next: RouteConceptProject = project
                ? { ...base, status: 'local-draft', alternatives: [...base.alternatives, ...incoming], alternativeOrder: [...base.alternativeOrder, ...incoming.map((item) => item.id)], selectedAlternativeId: incoming[0]!.id, updatedAt: new Date().toISOString() }
                : { ...base, alternatives: incoming, alternativeOrder: incoming.map((item) => item.id), selectedAlternativeId: incoming[0]!.id };
            setProject(next); setActivePatternId(alternatives[0]!.patternOrder[0] ?? null); setGtfsOpen(false); setMessage(null);
        } catch (error) { setGtfsError(displayError(error)); }
    };
    const refreshSaved = async () => {
        if (!teamId) return;
        setLoadOpen(true); setLoadingSaved(true); setMessage(null);
        try { setSavedProjects(await plannerServices.listSavedProjects(teamId)); }
        catch (error) { setMessage({ tone: 'error', text: displayError(error) }); setLoadOpen(false); }
        finally { setLoadingSaved(false); }
    };
    const loadSaved = async (id: string) => {
        if (!teamId) return;
        if (dirty && !window.confirm('Discard unsaved local changes and load the team version?')) return;
        setBusy(true);
        try {
            const loaded = await plannerServices.loadProject(teamId, id);
            if (!loaded) throw new Error('This project is no longer available.');
            setProject({ ...loaded, status: 'local-saved' }); setActivePatternId(loaded.alternatives.find((a) => a.id === loaded.selectedAlternativeId)?.patternOrder[0] ?? null); setLoadOpen(false); setConflictOpen(false); setMessage({ tone: 'success', text: 'Team project loaded.' });
        } catch (error) { setMessage({ tone: 'error', text: displayError(error) }); }
        finally { setBusy(false); }
    };
    const save = async () => {
        if (!project || !teamId || !userId) return;
        setBusy(true); setMessage(null);
        try { const saved = await plannerServices.saveProject(teamId, userId, project, project.revision); setProject({ ...saved, status: 'local-saved' }); setMessage({ tone: 'success', text: 'Project saved for the team.' }); }
        catch (error) {
            if (error instanceof RouteConceptPersistenceConflictError || (error as { code?: string })?.code === 'revision-conflict') setConflictOpen(true);
            else setMessage({ tone: 'error', text: displayError(error) });
        } finally { setBusy(false); }
    };
    const saveCopy = async () => {
        if (!project || !teamId || !userId) return;
        setBusy(true);
        try { const saved = await plannerServices.saveProjectAsCopy(teamId, userId, project); setProject({ ...saved, status: 'local-saved' }); setConflictOpen(false); setMessage({ tone: 'success', text: 'Local work saved as a new project.' }); }
        catch (error) { setMessage({ tone: 'error', text: displayError(error) }); }
        finally { setBusy(false); }
    };
    const back = () => { if (!dirty || window.confirm('Leave without saving your local changes?')) onBack(); };

    if (!project) return <div className="relative h-full min-h-[640px]"><StartScreen canSave={canPersist} error={message?.tone === 'error' ? message.text : undefined} onBlank={beginBlank} onImport={() => loadGtfs()} onLoad={refreshSaved} /><RouteConceptGtfsImportDrawer open={gtfsOpen} patterns={gtfsPatterns} loading={gtfsLoading} error={gtfsError} onClose={() => setGtfsOpen(false)} onRetry={() => loadGtfs(true)} onImport={importGtfs} />{loadOpen && <LoadDialog projects={savedProjects} loading={loadingSaved} busy={busy} onClose={() => setLoadOpen(false)} onLoad={loadSaved} />}</div>;

    if (!selectedAlternative || !activePattern || !feasibility || !summary) return null;
    const metricItems = [
        { label: 'Complete runtime', value: feasibility.completeRouteRuntimeMinutes == null ? 'Not ready' : `${feasibility.completeRouteRuntimeMinutes} min` },
        { label: 'Minimum buses', value: feasibility.minimumBusesRequired?.toString() ?? '—' },
        { label: 'Recovery', value: feasibility.recoveryTimeMinutes == null ? '—' : `${feasibility.recoveryTimeMinutes} min` },
    ];
    return <div className="relative flex h-full min-h-[680px] flex-col overflow-hidden bg-slate-100 text-slate-900">
        <h1 className="sr-only">Route Concept Planner</h1>
        <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm">
            <button onClick={back} className={button} aria-label="Back to Planning Data"><ArrowLeft size={17} /></button>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-cyan-700">Internal beta</span>{dirty ? <span className="text-xs font-bold text-amber-700">Unsaved changes</span> : <span className="text-xs font-bold text-emerald-700">Saved · revision {project.revision}</span>}</div><input aria-label="Project name" className="mt-0.5 w-full max-w-xl truncate bg-transparent text-lg font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" value={project.name} onChange={(e) => updateProject({ ...project, name: e.target.value, updatedAt: new Date().toISOString() })} /></div>
            {message && <><div className="sr-only" role={message.tone === 'error' ? 'alert' : 'status'} aria-live={message.tone === 'error' ? 'assertive' : 'polite'}>{message.text}</div><div aria-hidden="true" className={`hidden max-w-xs text-xs font-bold lg:block ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</div></>}
            <button className={button} onClick={refreshSaved} disabled={!canPersist || busy}><FolderOpen size={16} />Load</button>
            <button className={`${button} border-cyan-700 bg-cyan-700 text-white hover:bg-cyan-800`} onClick={save} disabled={!canPersist || busy || !dirty}>{busy ? <Loader2 aria-hidden="true" className="animate-spin" size={16} /> : <Save size={16} />}Save</button>
        </header>
        <div className="flex min-h-0 flex-1">
            <aside aria-label="Complete-route alternatives" className="z-20 flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
                <div className="border-b border-slate-200 p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-black">Complete-route alternatives</h2><button aria-label="Add alternative" className="rounded-lg bg-cyan-50 p-2 text-cyan-700" onClick={() => setAddAlternativeOpen((open) => !open)}><Plus size={16} /></button></div>{addAlternativeOpen && <div className="mt-2 grid gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2" aria-label="Choose alternative structure">{([['bidirectional', 'Two directions'], ['loop', 'Loop'], ['out-and-back', 'Out and back']] as const).map(([structure, label]) => <button key={structure} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-black hover:bg-cyan-50" onClick={() => { updateProject((current) => addRouteConceptAlternative(current, { structure })); setAddAlternativeOpen(false); }}>{label}</button>)}</div>}<button className={`${button} mt-3 w-full`} onClick={() => setCompareOpen(true)}><GitCompare size={15} />Compare {project.alternatives.length}</button></div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">{project.alternativeOrder.map((id) => project.alternatives.find((item) => item.id === id)).filter(Boolean).map((alternative) => {
                    const item = alternative!; const itemSummary = summary.alternatives.find((entry) => entry.alternativeId === item.id)!; const selected = item.id === selectedAlternative.id;
                    return <button key={item.id} aria-pressed={selected} onClick={() => updateProject((current) => selectRouteConceptAlternative(current, item.id))} className={`w-full rounded-2xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${selected ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-2"><span className="font-black text-slate-900">{item.name}</span>{item.id === project.preferredAlternativeId && <><Star aria-hidden="true" size={15} className="fill-amber-400 text-amber-400" /><span className="sr-only">Preferred alternative</span></>}</div><div className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-500"><span className="capitalize">{item.structure.replaceAll('-', ' ')}</span><span>·</span><span>{itemSummary.readiness.replaceAll('-', ' ')}</span></div></button>;
                })}</div>
                <div className="grid grid-cols-3 gap-2 border-t border-slate-200 p-3"><button className={button} title="Duplicate" aria-label="Duplicate alternative" onClick={() => updateProject((current) => duplicateRouteConceptAlternative(current, selectedAlternative.id))}><Copy size={15} /></button><button className={button} title="Preferred" aria-label="Mark preferred" aria-pressed={project.preferredAlternativeId === selectedAlternative.id} onClick={() => updateProject((current) => markRouteConceptPreferred(current, project.preferredAlternativeId === selectedAlternative.id ? undefined : selectedAlternative.id))}><Star size={15} /></button><button className={button} title="Delete" aria-label="Delete alternative" disabled={project.alternatives.length <= 1} onClick={() => updateProject((current) => deleteRouteConceptAlternative(current, selectedAlternative.id))}><Trash2 size={15} /></button></div>
            </aside>
            <main aria-label={`${activePattern.name} route map`} className="relative min-w-0 flex-1">
                <p className="sr-only">Use the Route panel for keyboard-accessible stop coordinates, segment runtimes, and route bends. The map is an optional visual editor.</p>
                <RouteConceptMapBridge alternative={selectedAlternative} pattern={activePattern} backgroundPatterns={selectedAlternative.patterns.filter((item) => item.id !== activePattern.id)} selectedStopId={selectedStopId} metricItems={metricItems} onSelectStop={setSelectedStopId}
                    onAddStop={(coordinate) => updatePattern((pattern) => addRouteConceptStop(pattern, { ...coordinate, name: coordinate.name || `Stop ${pattern.stops.length + 1}` }))}
                    onDeleteStop={(stopId) => updatePattern((pattern) => deleteRouteConceptStop(pattern, stopId))}
                    onMoveStop={(stopId, coordinate) => updatePattern((pattern) => moveRouteConceptStop(pattern, stopId, coordinate))}
                    onAddLineWaypoint={(placement) => updatePattern((pattern) => addRouteConceptAlignmentPoint(pattern, { ...placement.coordinate, afterStopId: placement.fromStopId, beforeStopId: placement.toStopId }))}
                    onInsertStopOnLine={(placement) => updatePattern((pattern) => { const index = [...pattern.stops].sort((a, b) => a.sequence - b.sequence).findIndex((stop) => stop.id === placement.fromStopId); return addRouteConceptStop(pattern, { ...placement.coordinate, name: `Stop ${pattern.stops.length + 1}` }, { index: index + 1 }); })}
                    onMoveLineWaypoint={(id, coordinate) => updatePattern((pattern) => moveRouteConceptAlignmentPoint(pattern, id, coordinate))}
                    onDeleteLineWaypoint={(id) => updatePattern((pattern) => deleteRouteConceptAlignmentPoint(pattern, id))}
                    onRuntimeEstimates={(evidence) => updatePattern((pattern) => mergeRouteConceptRuntimeEvidence(pattern, evidence))}
                    onSetRuntimeOverride={(id, minutes) => updatePattern((pattern) => setRouteConceptRuntimeOverride(pattern, id, minutes))}
                    onClearRuntimeOverride={(id) => updatePattern((pattern) => clearRouteConceptRuntimeOverride(pattern, id))} />
            </main>
            <aside aria-label="Route concept controls" className="z-20 flex w-96 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
                <div role="tablist" aria-label="Planner sections" className="grid grid-cols-3 border-b border-slate-200 bg-white p-2">{(['route', 'service', 'review'] as const).map((item, index, items) => <button id={`route-concept-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`route-concept-panel-${item}`} tabIndex={tab === item ? 0 : -1} key={item} onClick={() => setTab(item)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const current = items.indexOf(item); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowRight' ? (current + 1) % items.length : (current - 1 + items.length) % items.length; setTab(items[next]!); requestAnimationFrame(() => document.getElementById(`route-concept-tab-${items[next]}`)?.focus()); }} className={`rounded-xl px-3 py-2 text-sm font-black capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${tab === item ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{item}</button>)}</div>
                <div id={`route-concept-panel-${tab}`} role="tabpanel" aria-labelledby={`route-concept-tab-${tab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-600">{tab === 'route' && <RoutePanel project={project} alternative={selectedAlternative} pattern={activePattern} selectedStopId={selectedStopId} onPattern={setActivePatternId} onProject={updateProject} onPatternChange={updatePattern} onCreateReturn={() => updateProject((current) => createRouteConceptReversedReturn(current, selectedAlternative.id, activePattern.id))} onImport={() => loadGtfs()} onSelectStop={setSelectedStopId} searchPlaces={plannerServices.searchPlaces} />}{tab === 'service' && <ServicePanel service={selectedAlternative.service} onChange={(patch) => updateProject((current) => { const next = updateRouteConceptService(current, selectedAlternative.id, patch); return { ...next, alternatives: next.alternatives.map((item) => item.id === selectedAlternative.id ? { ...item, status: 'draft' } : item) }; })} />}{tab === 'review' && <ReviewPanel alternative={selectedAlternative} feasibility={feasibility} onMarkReady={() => updateProject((current) => ({ ...current, alternatives: current.alternatives.map((item) => item.id === selectedAlternative.id ? { ...item, status: 'review' } : item) }))} onIssue={(patternId) => { if (patternId) setActivePatternId(patternId); setTab('route'); }} />}</div>
            </aside>
        </div>
        <RouteConceptGtfsImportDrawer open={gtfsOpen} patterns={gtfsPatterns} loading={gtfsLoading} error={gtfsError} onClose={() => setGtfsOpen(false)} onRetry={() => loadGtfs(true)} onImport={importGtfs} />
        {loadOpen && <LoadDialog projects={savedProjects} loading={loadingSaved} busy={busy} onClose={() => setLoadOpen(false)} onLoad={loadSaved} />}
        {compareOpen && <CompareDialog project={project} onClose={() => setCompareOpen(false)} onSelect={(id) => { updateProject((current) => selectRouteConceptAlternative(current, id)); setCompareOpen(false); }} />}
        {conflictOpen && <RouteConceptAccessibleOverlay labelledBy="route-concept-conflict-title" onClose={() => setConflictOpen(false)} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><AlertTriangle aria-hidden="true" className="text-amber-600" /><h2 id="route-concept-conflict-title" className="mt-3 text-xl font-black">A newer team version exists</h2><p className="mt-2 text-sm text-slate-600">Your local changes are safe. Reload the team version or save your work as a separate copy.</p><div className="mt-5 grid gap-2"><button data-autofocus className={button} onClick={() => loadSaved(project.id)}>Reload team version</button><button className={`${button} border-cyan-700 bg-cyan-700 text-white`} onClick={saveCopy}>Save local work as a new copy</button><button className={button} onClick={() => setConflictOpen(false)}>Keep editing</button></div></RouteConceptAccessibleOverlay>}
    </div>;
};

function getPatternSegmentPairs(pattern: RouteConceptPattern): Array<{ key: string; from: RouteConceptPattern['stops'][number]; to: RouteConceptPattern['stops'][number] }> {
    const stops = [...pattern.stops].sort((left, right) => left.sequence - right.sequence);
    const traversal = pattern.role === 'loop' && stops.length > 1
        ? [...stops, stops[0]!]
        : pattern.role === 'out-and-back' && stops.length > 1
            ? [...stops, ...stops.slice(0, -1).reverse()]
            : stops;
    return traversal.slice(0, -1).flatMap((from, index) => {
        const to = traversal[index + 1];
        return to ? [{ key: `${from.id}->${to.id}`, from, to }] : [];
    });
}

function CoordinateInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return <label className="text-[11px] font-bold text-slate-600">{label}<input type="number" step="0.00001" aria-label={label} className={`${field} mt-1 py-1.5`} value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} /></label>;
}

function KeyboardRouteEditor({ pattern, selectedStopId, onPatternChange }: { pattern: RouteConceptPattern; selectedStopId: string | null; onPatternChange: (fn: (pattern: RouteConceptPattern) => RouteConceptPattern) => void }) {
    const selectedStop = pattern.stops.find((stop) => stop.id === selectedStopId);
    const segments = getPatternSegmentPairs(pattern);
    return <details className="rounded-2xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600">Keyboard route editor</summary><p className="mt-2 text-xs font-semibold text-slate-600">Edit coordinates, runtimes, and bends without using the map.</p>{selectedStop && <fieldset className="mt-3 rounded-xl bg-slate-50 p-3"><legend className="px-1 text-xs font-black text-slate-800">Selected stop · {selectedStop.name}</legend><div className="grid grid-cols-2 gap-2"><CoordinateInput label={`Latitude for ${selectedStop.name}`} value={selectedStop.lat} onChange={(lat) => onPatternChange((current) => moveRouteConceptStop(current, selectedStop.id, { lat, lng: selectedStop.lng }))} /><CoordinateInput label={`Longitude for ${selectedStop.name}`} value={selectedStop.lng} onChange={(lng) => onPatternChange((current) => moveRouteConceptStop(current, selectedStop.id, { lat: selectedStop.lat, lng }))} /></div></fieldset>}<div className="mt-3 space-y-2">{segments.map((segment) => {
        const bends = [...pattern.alignment].filter((point) => point.afterStopId === segment.from.id && point.beforeStopId === segment.to.id).sort((left, right) => (left.segmentSequence ?? left.sequence) - (right.segmentSequence ?? right.sequence));
        const override = pattern.runtimeOverrides[segment.key];
        const automatic = pattern.runtimeEvidence.find((item) => item.fromStopId === segment.from.id && item.toStopId === segment.to.id);
        return <section key={segment.key} aria-label={`${segment.from.name} to ${segment.to.name}`} className="rounded-xl border border-slate-200 p-3"><h3 className="text-xs font-black text-slate-800">{segment.from.name} → {segment.to.name}</h3><div className="mt-2 flex items-end gap-2"><label className="min-w-0 flex-1 text-[11px] font-bold text-slate-600">Runtime override minutes<input aria-label={`Runtime override for ${segment.from.name} to ${segment.to.name}`} type="number" min="1" step="1" className={`${field} mt-1 py-1.5`} value={override?.runtimeMinutes ?? ''} placeholder={automatic ? `${automatic.runtimeMinutes} ${automatic.source}` : 'Not set'} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) onPatternChange((current) => setRouteConceptRuntimeOverride(current, segment.key, value)); }} /></label><button type="button" className={button} disabled={!override} aria-label={`Reset runtime override for ${segment.from.name} to ${segment.to.name}`} onClick={() => onPatternChange((current) => clearRouteConceptRuntimeOverride(current, segment.key))}>Reset</button></div><div className="mt-2 space-y-2">{bends.map((bend, index) => <fieldset key={bend.id} className="rounded-lg bg-slate-50 p-2"><legend className="px-1 text-[11px] font-black text-slate-700">Bend {index + 1}</legend><div className="grid grid-cols-2 gap-2"><CoordinateInput label={`Latitude for bend ${index + 1}, ${segment.from.name} to ${segment.to.name}`} value={bend.lat} onChange={(lat) => onPatternChange((current) => moveRouteConceptAlignmentPoint(current, bend.id, { lat, lng: bend.lng }))} /><CoordinateInput label={`Longitude for bend ${index + 1}, ${segment.from.name} to ${segment.to.name}`} value={bend.lng} onChange={(lng) => onPatternChange((current) => moveRouteConceptAlignmentPoint(current, bend.id, { lat: bend.lat, lng }))} /></div><button type="button" className="mt-2 rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600" onClick={() => onPatternChange((current) => deleteRouteConceptAlignmentPoint(current, bend.id))}>Remove bend {index + 1}</button></fieldset>)}</div><button type="button" className={`${button} mt-2 w-full`} onClick={() => onPatternChange((current) => addRouteConceptAlignmentPoint(current, { lat: (segment.from.lat + segment.to.lat) / 2, lng: (segment.from.lng + segment.to.lng) / 2, afterStopId: segment.from.id, beforeStopId: segment.to.id, segmentSequence: bends.length + 1 }))}><Plus size={14} />Add bend at midpoint</button></section>;
    })}{segments.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600">Add at least two stops to edit segments.</p>}</div></details>;
}

function RoutePanel({ project, alternative, pattern, selectedStopId, onPattern, onProject, onPatternChange, onCreateReturn, onImport, onSelectStop, searchPlaces }: { project: RouteConceptProject; alternative: RouteConceptAlternative; pattern: RouteConceptPattern; selectedStopId: string | null; onPattern: (id: string) => void; onProject: (project: RouteConceptProject) => void; onPatternChange: (fn: (pattern: RouteConceptPattern) => RouteConceptPattern) => void; onCreateReturn: () => void; onImport: () => void; onSelectStop: (id: string) => void; searchPlaces: RouteConceptPlannerServices['searchPlaces'] }) {
    const ordered = [...pattern.stops].sort((a, b) => a.sequence - b.sequence);
    const [placeQuery, setPlaceQuery] = useState('');
    const [placeResults, setPlaceResults] = useState<RouteConceptPlaceSuggestion[]>([]);
    const [placeBusy, setPlaceBusy] = useState(false);
    const [placeError, setPlaceError] = useState<string | null>(null);
    const renameAlternative = (name: string) => onProject({ ...project, alternatives: project.alternatives.map((item) => item.id === alternative.id ? { ...item, name, updatedAt: new Date().toISOString() } : item) });
    const findPlaces = async () => {
        if (placeQuery.trim().length < 2) return;
        setPlaceBusy(true); setPlaceError(null);
        try { setPlaceResults(await searchPlaces(placeQuery.trim(), { limit: 5 })); }
        catch (error) { setPlaceError(displayError(error)); setPlaceResults([]); }
        finally { setPlaceBusy(false); }
    };
    const addPlace = (result: RouteConceptPlaceSuggestion) => {
        onPatternChange((current) => addRouteConceptStop(current, { name: result.name, lat: result.lat, lng: result.lng, notes: result.label }));
        setPlaceQuery(''); setPlaceResults([]);
    };
    const canCreateReturn = alternative.structure === 'bidirectional'
        && pattern.role === 'outbound'
        && !alternative.patterns.some((item) => item.role === 'inbound');
    return <div className="space-y-4"><label className="block text-xs font-bold text-slate-600">Alternative name<input aria-label="Alternative name" className={`${field} mt-1`} value={alternative.name} onChange={(e) => renameAlternative(e.target.value)} /></label><div><div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Patterns</div><div className="grid gap-2">{alternative.patternOrder.map((id) => alternative.patterns.find((item) => item.id === id)).filter(Boolean).map((item) => <button key={item!.id} aria-pressed={item!.id === pattern.id} onClick={() => onPattern(item!.id)} className={`rounded-xl border px-3 py-2 text-left text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${item!.id === pattern.id ? 'border-cyan-400 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white'}`}>{item!.name}<span className="ml-2 text-xs font-semibold capitalize text-slate-500">{item!.role.replaceAll('-', ' ')}</span></button>)}</div></div>{canCreateReturn && <button className={`${button} w-full border-cyan-300 text-cyan-800`} onClick={onCreateReturn}><Copy size={15} />Create editable return</button>}<button className={`${button} w-full`} onClick={onImport}><Bus size={15} />Import GTFS alternative</button><section className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-xs font-black uppercase tracking-wider text-slate-500">Add an individual stop</div><div className="mt-2 flex gap-2"><input aria-label="Search places or addresses" className={field} value={placeQuery} placeholder="Place or address" onChange={(e) => setPlaceQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void findPlaces()} /><button aria-label="Search places" className={button} disabled={placeBusy || placeQuery.trim().length < 2} onClick={() => void findPlaces()}>{placeBusy ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}</button></div>{placeError && <div role="alert" className="mt-2 text-xs font-bold text-red-700">{placeError}</div>}<div className="mt-2 space-y-1">{placeResults.map((result) => <button key={result.id} onClick={() => addPlace(result)} className="w-full rounded-xl bg-slate-50 p-2 text-left hover:bg-cyan-50"><span className="block text-sm font-black">{result.name}</span><span className="block truncate text-xs text-slate-500">{result.label}</span></button>)}</div></section><div><div className="mb-2 flex items-center justify-between"><div className="text-xs font-black uppercase tracking-wider text-slate-500">Stops · {ordered.length}</div><span className="text-xs font-semibold text-slate-500">Travel order</span></div><div className="space-y-2">{ordered.map((stop, index) => <div key={stop.id} className={`rounded-xl border bg-white p-2 ${selectedStopId === stop.id ? 'border-cyan-400' : 'border-slate-200'}`}><button className="flex w-full items-center gap-2 text-left" onClick={() => onSelectStop(stop.id)}><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-bold">{stop.name}</span><span className="text-[10px] font-bold uppercase text-slate-600">{stop.role.replaceAll('-', ' ')}</span></button>{selectedStopId === stop.id && <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2"><input aria-label="Stop name" className={field} value={stop.name} onChange={(e) => onPatternChange((p) => ({ ...p, stops: p.stops.map((item) => item.id === stop.id ? { ...item, name: e.target.value } : item) }))} /><select aria-label="Stop role" className={field} value={stop.role} onChange={(e) => onPatternChange((p) => ({ ...p, stops: p.stops.map((item) => item.id === stop.id ? { ...item, role: e.target.value as typeof stop.role } : item) }))}><option value="regular">Regular stop</option><option value="timed">Timed stop</option><option value="start-terminal">Start terminal</option><option value="end-terminal">End terminal</option><option value="turnaround">Turnaround</option></select></div>}<div className="mt-2 flex gap-1"><button aria-label={`Move ${stop.name} up`} disabled={index === 0} className="rounded bg-slate-100 px-2 text-xs" onClick={() => onPatternChange((p) => reorderRouteConceptStop(p, stop.id, index - 1))}>↑</button><button aria-label={`Move ${stop.name} down`} disabled={index === ordered.length - 1} className="rounded bg-slate-100 px-2 text-xs" onClick={() => onPatternChange((p) => reorderRouteConceptStop(p, stop.id, index + 1))}>↓</button><button aria-label={`Delete ${stop.name}`} className="ml-auto rounded bg-red-50 p-1 text-red-600" onClick={() => onPatternChange((p) => deleteRouteConceptStop(p, stop.id))}><Trash2 size={13} /></button></div></div>)}</div>{ordered.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-sm font-semibold text-slate-500">Use the map or place search to add stops in travel order.</div>}</div><KeyboardRouteEditor pattern={pattern} selectedStopId={selectedStopId} onPatternChange={onPatternChange} /></div>;
}

function NumberInput({ label, value, onChange, step = 1, optional = false }: { label: string; value?: number; onChange: (value: number | undefined) => void; step?: number; optional?: boolean }) {
    return <label className="block text-xs font-bold text-slate-600">{label}<input aria-label={label} type="number" min="0" step={step} className={`${field} mt-1`} value={value ?? ''} placeholder={optional ? 'Not set' : undefined} onChange={(e) => onChange(e.target.value === '' && optional ? undefined : Number(e.target.value))} /></label>;
}

function ServicePanel({ service, onChange }: { service: RouteConceptServiceAssumptions; onChange: (patch: Partial<RouteConceptServiceAssumptions>) => void }) {
    return <div className="space-y-4"><div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-xs font-semibold text-cyan-900">These assumptions test operational feasibility. They do not generate a timetable.</div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">Service day<select aria-label="Service day" className={`${field} mt-1`} value={service.dayType} onChange={(e) => onChange({ dayType: e.target.value as RouteConceptServiceAssumptions['dayType'] })}><option value="weekday">Weekday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option></select></label><label className="text-xs font-bold text-slate-600">Runtime period<select aria-label="Runtime period" className={`${field} mt-1`} value={service.planningPeriod} onChange={(e) => onChange({ planningPeriod: e.target.value as RouteConceptServiceAssumptions['planningPeriod'] })}><option value="all-day">All day</option><option value="am-peak">AM peak</option><option value="midday">Midday</option><option value="pm-peak">PM peak</option><option value="evening">Evening</option></select></label></div><ServiceTimeInput label="First departure" value={service.firstDepartureMinutes} onCommit={(value) => onChange({ firstDepartureMinutes: value })} /><ServiceTimeInput label="Last departure" value={service.lastDepartureMinutes} onCommit={(value) => onChange({ lastDepartureMinutes: value })} /><div className="grid grid-cols-2 gap-3"><NumberInput label="Frequency (min)" value={service.frequencyMinutes} onChange={(value) => onChange({ frequencyMinutes: value ?? 0 })} /><NumberInput label="Buses being tested" optional value={service.testedBuses} onChange={(value) => onChange({ testedBuses: value })} /><NumberInput label="Start layover (min)" value={service.startTerminalLayoverMinutes} onChange={(value) => onChange({ startTerminalLayoverMinutes: value ?? 0 })} /><NumberInput label="End layover (min)" value={service.endTerminalLayoverMinutes} onChange={(value) => onChange({ endTerminalLayoverMinutes: value ?? 0 })} /></div><NumberInput label="Intermediate dwell (seconds)" value={service.intermediateStopDwellSeconds} onChange={(value) => onChange({ intermediateStopDwellSeconds: value ?? 0 })} /></div>;
}

function ReviewPanel({ alternative, feasibility, onIssue, onMarkReady }: { alternative: RouteConceptAlternative; feasibility: ReturnType<typeof deriveRouteConceptFeasibility>; onIssue: (patternId?: string) => void; onMarkReady: () => void }) {
    const fmt = (value: number | null, suffix: string) => value == null ? '—' : `${value}${suffix}`;
    const sourceCounts = feasibility.segments.reduce<Record<string, number>>((counts, segment) => ({ ...counts, [segment.source]: (counts[segment.source] ?? 0) + 1 }), {});
    const stops = new Map(alternative.patterns.flatMap((pattern) => pattern.stops.map((stop) => [stop.id, stop.name] as const)));
    const canMarkReady = feasibility.comparisonReady && feasibility.confidence !== 'low' && feasibility.confidence !== 'not-ready';
    return <div className="space-y-4"><div className="flex items-center justify-between"><div><div className="text-xs font-black uppercase tracking-wider text-slate-500">Review readiness</div><div className="mt-1 text-lg font-black capitalize">{feasibility.readiness.replaceAll('-', ' ')}</div></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${feasibility.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : feasibility.confidence === 'not-ready' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{feasibility.confidence} confidence</span></div>{alternative.status === 'review' ? <div className="rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-800"><Check className="mr-2 inline" size={16} />Marked ready for review</div> : <button className={`${button} w-full border-emerald-300 text-emerald-700`} disabled={!canMarkReady} onClick={onMarkReady}><Check size={15} />Mark ready for review</button>}<div className="grid grid-cols-2 gap-2"><Metric label="Complete runtime" value={fmt(feasibility.completeRouteRuntimeMinutes, ' min')} /><Metric label="Cycle requirement" value={fmt(feasibility.cycleRequirementMinutes, ' min')} /><Metric label="Minimum buses" value={fmt(feasibility.minimumBusesRequired, '')} detail={feasibility.testedBuses == null ? 'No tested fleet entered' : `${feasibility.testedBuses} being tested`} /><Metric label="Recovery" value={fmt(feasibility.recoveryTimeMinutes, ' min')} detail={feasibility.recoveryPercent == null ? undefined : `${feasibility.recoveryPercent}% of cycle`} /></div>{feasibility.daily && <section><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Daily planning estimates</h3><div className="grid grid-cols-2 gap-2"><Metric label="Departures" value={String(feasibility.daily.totalDepartures)} /><Metric label="Service span" value={`${Math.round(feasibility.daily.serviceSpanMinutes / 60 * 10) / 10} hr`} /><Metric label="Revenue hours" value={String(feasibility.daily.revenueHours)} /><Metric label="Vehicle hours" value={String(feasibility.daily.vehicleHours)} /></div></section>}<section><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Runtime source mix</h3><div className="flex flex-wrap gap-2">{Object.entries(sourceCounts).map(([source, count]) => <span key={source} className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black capitalize">{source} · {count}</span>)}{feasibility.segments.length === 0 && <span className="text-sm font-semibold text-slate-500">No segments yet.</span>}</div>{feasibility.segments.length > 0 && <details className="mt-2 rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer p-3 text-sm font-black">Segment evidence</summary><div className="divide-y border-t">{feasibility.segments.map((segment) => <div key={`${segment.patternId}-${segment.id}`} className="p-3 text-xs"><div className="font-black text-slate-800">{stops.get(segment.fromStopId) ?? segment.fromStopId} → {stops.get(segment.toStopId) ?? segment.toStopId}</div><div className="mt-1 font-semibold capitalize text-slate-500">{segment.runtimeMinutes == null ? 'Runtime missing' : `${segment.runtimeMinutes} min`} · {segment.source}{segment.evidenceDayType ? ` · ${segment.evidenceDayType}` : ''}{segment.evidencePlanningPeriod ? ` · ${segment.evidencePlanningPeriod.replaceAll('-', ' ')}` : ''}{segment.requiresManualConfirmation ? ' · confirmation required' : ''}</div>{segment.fallbackReason && <div className="mt-1 text-amber-700">{segment.fallbackReason}</div>}</div>)}</div></details>}</section><section><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Actionable issues · {feasibility.issues.length}</h3><div className="space-y-2">{feasibility.issues.map((issue) => <button key={issue.id} onClick={() => onIssue(issue.patternId)} className={`w-full rounded-2xl border p-3 text-left ${issue.severity === 'blocking' ? 'border-red-200 bg-red-50' : issue.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}><div className="flex gap-2"><AlertTriangle size={16} className={issue.severity === 'blocking' ? 'text-red-600' : 'text-amber-600'} /><div><div className="text-sm font-black">{issue.message}</div>{issue.action && <div className="mt-1 text-xs font-semibold opacity-75">{issue.action}</div>}</div></div></button>)}{feasibility.issues.length === 0 && <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><Check className="mr-2 inline" size={16} />No feasibility issues found.</div>}</div></section></div>;
}

function LoadDialog({ projects, loading, busy, onClose, onLoad }: { projects: RouteConceptSavedProjectSummary[]; loading: boolean; busy: boolean; onClose: () => void; onLoad: (id: string) => void }) {
    return <RouteConceptAccessibleOverlay labelledBy="route-concept-load-title" onClose={onClose} className="flex max-h-[75vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-5"><div><h2 id="route-concept-load-title" className="text-xl font-black">Team projects</h2><p className="text-sm text-slate-500">Open a saved route concept study.</p></div><button data-autofocus className={button} onClick={onClose} aria-label="Close team projects"><X /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-4">{loading && <div role="status" aria-live="polite" className="flex items-center gap-2 p-4 text-sm font-bold"><Loader2 aria-hidden="true" className="animate-spin" />Loading projects…</div>}{!loading && projects.length === 0 && <div role="status" className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-600">No saved projects yet.</div>}{projects.map((project) => <button key={project.id} disabled={busy} onClick={() => onLoad(project.id)} className="mb-2 flex w-full items-center justify-between rounded-2xl border border-slate-200 p-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"><div><div className="font-black">{project.name}</div><div className="mt-1 text-xs font-semibold text-slate-500">{project.alternativeCount} alternatives · revision {project.revision}</div></div><FolderOpen aria-hidden="true" size={18} className="text-cyan-700" /></button>)}</div></RouteConceptAccessibleOverlay>;
}

function CompareDialog({ project, onClose, onSelect }: { project: RouteConceptProject; onClose: () => void; onSelect: (id: string) => void }) {
    const summary = summarizeRouteConceptProject(project);
    return <RouteConceptAccessibleOverlay labelledBy="route-concept-compare-title" onClose={onClose} className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-5"><div><h2 id="route-concept-compare-title" className="text-xl font-black">Compare alternatives</h2><p className="text-sm text-slate-500">Complete-route feasibility at a glance.</p></div><button data-autofocus className={button} onClick={onClose} aria-label="Close comparison"><X /></button></header><div className="overflow-x-auto p-4"><table className="w-full text-left text-sm"><caption className="sr-only">Operational comparison of route concept alternatives</caption><thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="p-3">Alternative</th><th scope="col">Runtime</th><th scope="col">Minimum buses</th><th scope="col">Recovery</th><th scope="col">Revenue hours</th><th scope="col">Vehicle hours</th><th scope="col">Confidence</th><th scope="col">Issues</th></tr></thead><tbody>{summary.alternatives.map((item) => <tr key={item.alternativeId} className="border-t"><td className="p-3"><button className="font-black text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" onClick={() => onSelect(item.alternativeId)}>{item.alternativeName}</button>{item.isPreferred && <><Star aria-hidden="true" size={13} className="ml-2 inline fill-amber-400 text-amber-400" /><span className="sr-only">Preferred</span></>}</td><td>{item.completeRouteRuntimeMinutes ?? '—'}</td><td>{item.minimumBusesRequired ?? '—'}</td><td>{item.recoveryTimeMinutes ?? '—'}</td><td>{item.dailyRevenueHours ?? '—'}</td><td>{item.dailyVehicleHours ?? '—'}</td><td className="capitalize">{item.confidence}</td><td>{item.blockingIssueCount} blocking · {item.warningCount} warnings</td></tr>)}</tbody></table></div></RouteConceptAccessibleOverlay>;
}
