import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    ArrowLeft,
    Calendar,
    CheckCircle2,
    Copy,
    GitBranch,
    Layers,
    Loader2,
    RotateCcw,
    Save,
    Shield,
    Trash2,
} from 'lucide-react';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import type { DayType } from '../../utils/masterScheduleTypes';
import { ScheduleEditor } from '../ScheduleEditor';
import { useToast } from '../contexts/ToastContext';
import { deriveRoute8FamilyModel } from '../../utils/route8-sandbox/route8SandboxAdapter';
import { getRoute8BranchSchedules, resetRoute8BranchToSource, updateRoute8BranchSchedules } from '../../utils/route8-sandbox/route8SandboxEditing';
import { buildRoute8SandboxProjectName, loadRoute8SandboxSource } from '../../utils/route8-sandbox/route8SandboxSource';
import type {
    Route8BlockFlowRow,
    Route8Branch,
    Route8DirectionSummary,
    Route8FamilyModel,
    Route8SandboxContent,
    Route8SandboxProject,
    Route8SandboxProjectMetadata,
    Route8TerminalEvent,
    Route8TimepointSummary,
} from '../../utils/route8-sandbox/types';
import {
    deleteRoute8SandboxProject,
    getAllRoute8SandboxProjects,
    getRoute8SandboxProject,
    saveRoute8SandboxProject,
} from '../../utils/services/route8SandboxService';

type Route8SandboxTab = 'family' | Route8Branch;

interface Route8SandboxWorkspaceProps {
    onBack: () => void;
    userId: string | null;
    teamId?: string | null;
}

const DAY_TYPE_OPTIONS: DayType[] = ['Weekday', 'Saturday', 'Sunday'];

const dayTypeDescription: Record<DayType, string> = {
    Weekday: 'Copies the live weekday 8A and 8B schedules into a safe sandbox project.',
    Saturday: 'Seeds the sandbox from the current Saturday 8A and 8B masters.',
    Sunday: 'Seeds the sandbox from the current Sunday 8A and 8B masters.',
};

const tabButtonClass = (active: boolean): string => active
    ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900';

const statusText: Record<AutoSaveStatus, string> = {
    idle: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
};

const formatDateTime = (value?: Date | string | null): string => {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
};

const formatClock = (value: string | null | undefined): string => value?.trim() || '—';

function FamilySummaryCard({ summary }: { summary: Route8DirectionSummary }): React.ReactElement {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gray-400">
                        {summary.branch} · {summary.direction}
                    </div>
                    <h3 className="mt-1 text-base font-bold text-gray-900">{summary.routeName}</h3>
                </div>
                <div className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-700">
                    {summary.tripCount} trips
                </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-gray-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">First</dt>
                    <dd className="mt-1 font-semibold text-gray-900">{formatClock(summary.firstDeparture)}</dd>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Last</dt>
                    <dd className="mt-1 font-semibold text-gray-900">{formatClock(summary.lastDeparture)}</dd>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Start stop</dt>
                    <dd className="mt-1 font-semibold text-gray-900">{summary.startStop || '—'}</dd>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">End stop</dt>
                    <dd className="mt-1 font-semibold text-gray-900">{summary.endStop || '—'}</dd>
                </div>
            </dl>
            <div className="mt-3 rounded-xl border border-dashed border-cyan-200 bg-cyan-50/70 px-3 py-2 text-sm text-cyan-900">
                <span className="font-bold">Allandale:</span> {summary.allandaleStop || 'Not found in current stop list'}
            </div>
        </div>
    );
}

function TimepointTable({ summaries }: { summaries: Route8TimepointSummary[] }): React.ReactElement {
    return (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
                <h3 className="text-sm font-bold text-gray-900">Route 8 timepoint frame</h3>
                <p className="mt-1 text-sm text-gray-500">A simplified view of the main stop sequence for each branch and direction.</p>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Pattern</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Start</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Allandale</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">End</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Span</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {summaries.map((summary) => (
                            <tr key={summary.id}>
                                <td className="px-4 py-3 font-semibold text-gray-900">{summary.branch} {summary.direction}</td>
                                <td className="px-4 py-3 text-gray-700">{summary.startStop || '—'}</td>
                                <td className="px-4 py-3 text-gray-700">{summary.allandaleStop || '—'}</td>
                                <td className="px-4 py-3 text-gray-700">{summary.endStop || '—'}</td>
                                <td className="px-4 py-3 text-gray-700">
                                    {formatClock(summary.firstDeparture)} → {formatClock(summary.lastDeparture)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TerminalEventsTable({ events }: { events: Route8TerminalEvent[] }): React.ReactElement {
    return (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
                <h3 className="text-sm font-bold text-gray-900">Allandale terminal events</h3>
                <p className="mt-1 text-sm text-gray-500">Arrival, departure, and recovery pulled from the copied schedules only.</p>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Time</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Pattern</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Block</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Arrival</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Departure</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Recovery</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-600">Next trip</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {events.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                                    No Allandale events were found in the copied Route 8 schedules.
                                </td>
                            </tr>
                        )}
                        {events.map((event) => (
                            <tr key={event.id}>
                                <td className="px-4 py-3 font-semibold text-gray-900">{formatClock(event.departureTime || event.arrivalTime)}</td>
                                <td className="px-4 py-3 text-gray-700">{event.branch} {event.direction}</td>
                                <td className="px-4 py-3 text-gray-700">{event.blockId}</td>
                                <td className="px-4 py-3 text-gray-700">{formatClock(event.arrivalTime)}</td>
                                <td className="px-4 py-3 text-gray-700">{formatClock(event.departureTime)}</td>
                                <td className="px-4 py-3 text-gray-700">{event.recoveryMinutes} min</td>
                                <td className="px-4 py-3 text-gray-700">{event.nextTripSummary || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function BlockFlowsTable({ rows }: { rows: Route8BlockFlowRow[] }): React.ReactElement {
    return (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
                <h3 className="text-sm font-bold text-gray-900">Block flow view</h3>
                <p className="mt-1 text-sm text-gray-500">Shows how the copied trips string together by block across 8A and 8B.</p>
            </div>
            <div className="divide-y divide-gray-100">
                {rows.length === 0 && (
                    <div className="px-4 py-6 text-sm text-gray-500">No block flows are available yet.</div>
                )}
                {rows.map((row) => (
                    <div key={row.blockId} className="px-4 py-4">
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">Block {row.blockId}</div>
                            <div className="text-sm text-gray-500">
                                {formatClock(row.firstStartTime)} → {formatClock(row.lastEndTime)}
                            </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {row.segments.map((segment) => (
                                <div key={segment.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-sm font-bold text-gray-900">{segment.branch} {segment.direction}</div>
                                        <div className="text-xs font-semibold text-gray-500">{segment.startTime} → {segment.endTime}</div>
                                    </div>
                                    <div className="mt-2 text-sm text-gray-600">
                                        <div>{segment.startStop || '—'} → {segment.endStop || '—'}</div>
                                        <div className="mt-1 text-xs text-gray-500">Allandale: {formatClock(segment.allandaleTime)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SandboxFamilyView({
    content,
    projectName,
    onNotesChange,
}: {
    content: Route8SandboxContent;
    projectName: string;
    onNotesChange: (value: string) => void;
}): React.ReactElement {
    const familyModel = useMemo<Route8FamilyModel>(() => deriveRoute8FamilyModel(content), [content]);

    return (
        <div className="space-y-5">
            <div className="rounded-3xl border border-cyan-200 bg-gradient-to-r from-cyan-50 via-white to-sky-50 p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-cyan-700">Route 8 Sandbox</div>
                        <h2 className="mt-1 text-2xl font-extrabold text-gray-900">{projectName}</h2>
                        <p className="mt-2 max-w-3xl text-sm text-gray-600">
                            This workspace simplifies Route 8 at the family level while keeping the copied 8A and 8B schedules intact underneath.
                            Nothing here publishes back to the live route.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-cyan-200 bg-white/80 px-4 py-3 text-sm text-cyan-900">
                        <div className="font-bold">Pinned source</div>
                        <div className="mt-1">8A v{content.sourceSnapshots['8A'].version} · 8B v{content.sourceSnapshots['8B'].version}</div>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                {familyModel.directionSummaries.map((summary) => (
                    <FamilySummaryCard key={summary.id} summary={summary} />
                ))}
            </div>

            <TimepointTable summaries={familyModel.timepointSummaries} />
            <TerminalEventsTable events={familyModel.terminalEvents} />
            <BlockFlowsTable rows={familyModel.blockRows} />

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-gray-900">Sandbox notes</div>
                <textarea
                    value={content.notes ?? ''}
                    onChange={(event) => onNotesChange(event.target.value)}
                    className="min-h-[120px] w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                    placeholder="Capture what works, what feels simpler, and what still needs to be solved."
                />
            </div>
        </div>
    );
}

function EmptyState({
    onBack,
    userId,
    teamId,
    projects,
    creatingDayType,
    loadingProjectId,
    onCreate,
    onOpen,
    onDelete,
}: {
    onBack: () => void;
    userId: string | null;
    teamId?: string | null;
    projects: Route8SandboxProjectMetadata[];
    creatingDayType: DayType | null;
    loadingProjectId: string | null;
    onCreate: (dayType: DayType) => void;
    onOpen: (projectId: string) => void;
    onDelete: (projectId: string) => void;
}): React.ReactElement {
    return (
        <div className="h-full overflow-auto p-6">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <button
                            type="button"
                            onClick={onBack}
                            className="mb-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                        >
                            <ArrowLeft size={16} />
                            Back to Analytics
                        </button>
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-cyan-700">Standalone workspace</div>
                        <h1 className="mt-1 text-3xl font-extrabold text-gray-900">Route 8 Sandbox</h1>
                        <p className="mt-2 max-w-3xl text-sm text-gray-600">
                            Create a safe duplicate of the current Route 8A and 8B schedules, then test a simplified Route 8 family workspace without touching the live editor path.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        <div className="flex items-center gap-2 font-bold"><Shield size={16} /> Live schedules protected</div>
                        <div className="mt-1">This tool only edits copied sandbox data.</div>
                    </div>
                </div>

                {!userId && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                        Sign in first to create or open Route 8 sandboxes.
                    </div>
                )}

                {userId && !teamId && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                        Join or select a team first. The sandbox seeds itself from your team’s published 8A and 8B schedules.
                    </div>
                )}

                <div className="grid gap-4 lg:grid-cols-3">
                    {DAY_TYPE_OPTIONS.map((dayType) => (
                        <button
                            key={dayType}
                            type="button"
                            onClick={() => onCreate(dayType)}
                            disabled={!userId || !teamId || creatingDayType !== null}
                            className="rounded-3xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-cyan-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
                                    {creatingDayType === dayType ? <Loader2 className="animate-spin" size={20} /> : <Calendar size={20} />}
                                </div>
                                <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">New copy</div>
                            </div>
                            <h2 className="mt-4 text-lg font-bold text-gray-900">{dayType}</h2>
                            <p className="mt-2 text-sm leading-relaxed text-gray-500">{dayTypeDescription[dayType]}</p>
                        </button>
                    ))}
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 px-5 py-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                            <Layers size={16} />
                            Existing sandboxes
                        </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {projects.length === 0 && (
                            <div className="px-5 py-8 text-sm text-gray-500">
                                No Route 8 sandbox projects yet.
                            </div>
                        )}
                        {projects.map((project) => (
                            <div key={project.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                                <div>
                                    <div className="text-sm font-bold text-gray-900">{project.name}</div>
                                    <div className="mt-1 text-sm text-gray-500">
                                        {project.dayType} · updated {formatDateTime(project.updatedAt)}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onOpen(project.id)}
                                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                                    >
                                        {loadingProjectId === project.id ? <Loader2 className="animate-spin" size={16} /> : <Copy size={16} />}
                                        Open
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDelete(project.id)}
                                        className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-100"
                                    >
                                        <Trash2 size={16} />
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export const Route8SandboxWorkspace: React.FC<Route8SandboxWorkspaceProps> = ({ onBack, userId, teamId }) => {
    const toast = useToast();
    const [projects, setProjects] = useState<Route8SandboxProjectMetadata[]>([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(false);
    const [creatingDayType, setCreatingDayType] = useState<DayType | null>(null);
    const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
    const [activeProject, setActiveProject] = useState<Route8SandboxProject | null>(null);
    const [projectName, setProjectName] = useState('');
    const [activeTab, setActiveTab] = useState<Route8SandboxTab>('family');
    const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPersistedSignatureRef = useRef<string | null>(null);
    const projectRef = useRef<Route8SandboxProject | null>(null);
    const contentRef = useRef<Route8SandboxContent | null>(null);
    const projectNameRef = useRef('');

    const {
        state: content,
        set: setContent,
        reset: resetContent,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useUndoRedo<Route8SandboxContent | null>(null);

    useEffect(() => {
        projectRef.current = activeProject;
    }, [activeProject]);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        projectNameRef.current = projectName;
    }, [projectName]);

    const loadProjects = useCallback(async () => {
        if (!userId) {
            setProjects([]);
            return;
        }

        setIsLoadingProjects(true);
        try {
            const loaded = await getAllRoute8SandboxProjects(userId);
            setProjects(teamId ? loaded.filter((project) => (project.teamId ?? null) === (teamId ?? null)) : loaded);
        } catch (error) {
            console.error('Failed to load Route 8 sandbox projects:', error);
            toast?.error('Route 8 Sandbox', 'Failed to load sandbox projects.');
        } finally {
            setIsLoadingProjects(false);
        }
    }, [teamId, toast, userId]);

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    const currentSignature = useMemo(() => {
        if (!activeProject || !content) return null;
        return JSON.stringify({
            name: projectName.trim(),
            content,
        });
    }, [activeProject, content, projectName]);

    const saveNow = useCallback(async (options?: { suppressToast?: boolean; suppressStatus?: boolean }) => {
        if (!userId || !contentRef.current || !projectRef.current) return;

        try {
            if (!options?.suppressStatus) {
                setAutoSaveStatus('saving');
            }

            const persisted = await saveRoute8SandboxProject(userId, {
                id: projectRef.current.id,
                name: projectNameRef.current.trim() || buildRoute8SandboxProjectName(projectRef.current.dayType),
                dayType: projectRef.current.dayType,
                teamId: projectRef.current.teamId ?? teamId ?? null,
                status: 'draft',
                createdBy: projectRef.current.createdBy,
                storagePath: projectRef.current.storagePath,
                content: contentRef.current,
            });

            const savedAt = new Date();
            const signature = JSON.stringify({
                name: projectNameRef.current.trim(),
                content: contentRef.current,
            });

            lastPersistedSignatureRef.current = signature;
            setHasUnsavedChanges(false);
            setLastSaved(savedAt);
            setAutoSaveStatus('saved');

            setActiveProject((current) => current ? {
                ...current,
                name: projectNameRef.current.trim() || current.name,
                teamId: current.teamId ?? teamId ?? null,
                updatedAt: savedAt,
                storagePath: persisted.storagePath,
            } : current);

            setProjects((current) => {
                const updatedProject: Route8SandboxProjectMetadata = {
                    id: persisted.id,
                    name: projectNameRef.current.trim() || projectRef.current?.name || buildRoute8SandboxProjectName(projectRef.current?.dayType ?? 'Weekday'),
                    dayType: projectRef.current?.dayType ?? 'Weekday',
                    teamId: projectRef.current?.teamId ?? teamId ?? null,
                    status: 'draft',
                    createdAt: projectRef.current?.createdAt ?? savedAt,
                    updatedAt: savedAt,
                    createdBy: projectRef.current?.createdBy ?? userId,
                };

                const remaining = current.filter((project) => project.id !== persisted.id);
                return [updatedProject, ...remaining];
            });

            if (!options?.suppressToast) {
                toast?.success('Route 8 Sandbox', 'Sandbox saved.');
            }
        } catch (error) {
            console.error('Failed to save Route 8 sandbox:', error);
            setAutoSaveStatus('error');
            if (!options?.suppressToast) {
                toast?.error('Route 8 Sandbox', 'Failed to save sandbox.');
            }
        }
    }, [teamId, toast, userId]);

    useEffect(() => {
        if (!activeProject || !content || !currentSignature) return;

        if (lastPersistedSignatureRef.current === null) {
            lastPersistedSignatureRef.current = currentSignature;
            setHasUnsavedChanges(false);
            setAutoSaveStatus('saved');
            return;
        }

        const isDirty = currentSignature !== lastPersistedSignatureRef.current;
        setHasUnsavedChanges(isDirty);

        if (!isDirty) return;

        setAutoSaveStatus('idle');
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = setTimeout(() => {
            void saveNow({ suppressToast: true });
        }, 1500);

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, [activeProject, content, currentSignature, saveNow]);

    const openProject = useCallback(async (projectId: string) => {
        if (!userId) return;
        setLoadingProjectId(projectId);
        try {
            const loaded = await getRoute8SandboxProject(userId, projectId);
            if (!loaded?.content) {
                toast?.error('Route 8 Sandbox', 'Could not load sandbox content.');
                return;
            }

            setActiveProject(loaded);
            setProjectName(loaded.name);
            resetContent(loaded.content);
            setLastSaved(loaded.updatedAt);
            setAutoSaveStatus('saved');
            setHasUnsavedChanges(false);
            setActiveTab('family');
            lastPersistedSignatureRef.current = JSON.stringify({
                name: loaded.name.trim(),
                content: loaded.content,
            });
        } catch (error) {
            console.error('Failed to open Route 8 sandbox:', error);
            toast?.error('Route 8 Sandbox', 'Failed to open sandbox.');
        } finally {
            setLoadingProjectId(null);
        }
    }, [resetContent, toast, userId]);

    const handleCreate = useCallback(async (dayType: DayType) => {
        if (!userId || !teamId) return;

        setCreatingDayType(dayType);
        try {
            const sandboxContent = await loadRoute8SandboxSource(teamId, dayType);
            const projectName = buildRoute8SandboxProjectName(dayType);
            const persisted = await saveRoute8SandboxProject(userId, {
                name: projectName,
                dayType,
                teamId,
                status: 'draft',
                createdBy: userId,
                content: sandboxContent,
            });

            await loadProjects();
            await openProject(persisted.id);
            toast?.success('Route 8 Sandbox', `${dayType} sandbox created from live 8A and 8B schedules.`);
        } catch (error) {
            console.error('Failed to create Route 8 sandbox:', error);
            toast?.error(
                'Route 8 Sandbox',
                error instanceof Error ? error.message : 'Failed to create sandbox.'
            );
        } finally {
            setCreatingDayType(null);
        }
    }, [loadProjects, openProject, teamId, toast, userId]);

    const handleDelete = useCallback(async (projectId: string) => {
        if (!userId) return;
        const confirmed = confirm('Delete this Route 8 sandbox? This will not affect the live 8A/8B schedules.');
        if (!confirmed) return;

        try {
            await deleteRoute8SandboxProject(userId, projectId);
            if (activeProject?.id === projectId) {
                setActiveProject(null);
                setProjectName('');
                resetContent(null);
                setLastSaved(null);
                setHasUnsavedChanges(false);
                lastPersistedSignatureRef.current = null;
            }
            await loadProjects();
            toast?.success('Route 8 Sandbox', 'Sandbox deleted.');
        } catch (error) {
            console.error('Failed to delete Route 8 sandbox:', error);
            toast?.error('Route 8 Sandbox', 'Failed to delete sandbox.');
        }
    }, [activeProject?.id, loadProjects, resetContent, toast, userId]);

    const handleCloseProject = useCallback(() => {
        setActiveProject(null);
        setProjectName('');
        resetContent(null);
        setLastSaved(null);
        setAutoSaveStatus('idle');
        setHasUnsavedChanges(false);
        setActiveTab('family');
        lastPersistedSignatureRef.current = null;
    }, [resetContent]);

    const familyModel = useMemo(() => content ? deriveRoute8FamilyModel(content) : null, [content]);

    const branchSchedules = useMemo(() => {
        if (!content || activeTab === 'family') return [];
        return getRoute8BranchSchedules(content, activeTab, 'working');
    }, [activeTab, content]);

    const branchBaseline = useMemo(() => {
        if (!content || activeTab === 'family') return [];
        return getRoute8BranchSchedules(content, activeTab, 'source');
    }, [activeTab, content]);

    const handleBranchScheduleChange = useCallback((schedules: Parameters<typeof updateRoute8BranchSchedules>[2]) => {
        if (!content || activeTab === 'family') return;
        setContent(updateRoute8BranchSchedules(content, activeTab, schedules));
    }, [activeTab, content, setContent]);

    const handleResetBranch = useCallback(() => {
        if (!content || activeTab === 'family') return;
        const confirmed = confirm(`Reset ${activeTab} back to the copied source version?`);
        if (!confirmed) return;
        setContent(resetRoute8BranchToSource(content, activeTab));
        toast?.success('Route 8 Sandbox', `${activeTab} reset to the copied source version.`);
    }, [activeTab, content, setContent, toast]);

    if (isLoadingProjects && !activeProject && projects.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-gray-500">
                    <Loader2 className="animate-spin text-cyan-500" size={30} />
                    <div className="text-sm font-medium">Loading Route 8 sandboxes…</div>
                </div>
            </div>
        );
    }

    if (!activeProject || !content || !familyModel) {
        return (
            <EmptyState
                onBack={onBack}
                userId={userId}
                teamId={teamId}
                projects={projects}
                creatingDayType={creatingDayType}
                loadingProjectId={loadingProjectId}
                onCreate={handleCreate}
                onOpen={openProject}
                onDelete={handleDelete}
            />
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-gray-50">
            <div className="border-b border-gray-200 bg-white px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <button
                            type="button"
                            onClick={handleCloseProject}
                            className="mb-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                        >
                            <ArrowLeft size={16} />
                            All sandboxes
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                value={projectName}
                                onChange={(event) => setProjectName(event.target.value)}
                                className="min-w-[320px] rounded-2xl border border-gray-200 px-4 py-3 text-xl font-extrabold text-gray-900 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                            />
                            <div className="rounded-full bg-cyan-50 px-3 py-1 text-sm font-bold text-cyan-700">
                                {activeProject.dayType}
                            </div>
                            <div className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
                                Live publish disabled
                            </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                            <div>Last saved: {formatDateTime(lastSaved)}</div>
                            <div className="inline-flex items-center gap-2">
                                {autoSaveStatus === 'error' ? <AlertCircle size={14} className="text-red-500" /> : <CheckCircle2 size={14} className="text-emerald-500" />}
                                {statusText[autoSaveStatus]}
                            </div>
                            {hasUnsavedChanges && <div className="font-semibold text-amber-700">Pending sandbox changes</div>}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={undo}
                            disabled={!canUndo}
                            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Undo
                        </button>
                        <button
                            type="button"
                            onClick={redo}
                            disabled={!canRedo}
                            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Redo
                        </button>
                        <button
                            type="button"
                            onClick={() => void saveNow()}
                            className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 shadow-sm hover:bg-cyan-100"
                        >
                            {autoSaveStatus === 'saving' ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                            Save now
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(activeProject.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-100"
                        >
                            <Trash2 size={16} />
                            Delete sandbox
                        </button>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('family')}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold shadow-sm ${tabButtonClass(activeTab === 'family')}`}
                    >
                        <div className="inline-flex items-center gap-2">
                            <GitBranch size={16} />
                            Family view
                        </div>
                    </button>
                    {(['8A', '8B'] as Route8Branch[]).map((branch) => (
                        <button
                            key={branch}
                            type="button"
                            onClick={() => setActiveTab(branch)}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold shadow-sm ${tabButtonClass(activeTab === branch)}`}
                        >
                            <div className="inline-flex items-center gap-2">
                                <Copy size={16} />
                                {branch} copy
                            </div>
                        </button>
                    ))}
                    {activeTab !== 'family' && (
                        <button
                            type="button"
                            onClick={handleResetBranch}
                            className="ml-auto inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-100"
                        >
                            <RotateCcw size={16} />
                            Reset {activeTab} to source copy
                        </button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-6">
                {activeTab === 'family' ? (
                    <SandboxFamilyView
                        content={content}
                        projectName={projectName}
                        onNotesChange={(value) => setContent({ ...content, notes: value })}
                    />
                ) : (
                    <div className="rounded-3xl border border-gray-200 bg-white shadow-sm">
                        <div className="border-b border-gray-200 px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-cyan-700">Copied branch editor</div>
                                    <h2 className="mt-1 text-lg font-bold text-gray-900">{activeTab} sandbox copy</h2>
                                    <p className="mt-1 text-sm text-gray-500">
                                        This reuses the existing schedule editor against the sandbox copy only. The live Route 8A/8B routes stay untouched.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                                    Source version {content.sourceSnapshots[activeTab].version} · pinned {formatDateTime(content.sourceSnapshots[activeTab].updatedAt)}
                                </div>
                            </div>
                        </div>
                        <div className="h-[calc(100vh-280px)] min-h-[720px]">
                            <ScheduleEditor
                                schedules={branchSchedules}
                                originalSchedules={branchBaseline}
                                masterBaseline={branchBaseline}
                                onSchedulesChange={handleBranchScheduleChange}
                                draftName={`${projectName} · ${activeTab}`}
                                onSaveVersion={() => saveNow({ suppressToast: true })}
                                autoSaveStatus={autoSaveStatus}
                                lastSaved={lastSaved}
                                hasUnsavedChanges={hasUnsavedChanges}
                                canUndo={canUndo}
                                canRedo={canRedo}
                                undo={undo}
                                redo={redo}
                                embedded
                                hideSidebar
                                teamId={teamId ?? undefined}
                                userId={userId ?? undefined}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
