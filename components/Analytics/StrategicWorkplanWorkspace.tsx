import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CalendarClock,
    CalendarDays,
    Check,
    ChevronRight,
    CircleHelp,
    FileText,
    Filter,
    GanttChartSquare,
    History,
    LayoutDashboard,
    Loader2,
    Plus,
    RefreshCw,
    Save,
    Search,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import {
    addStrategicWorkplanDays,
    createStrategicWorkplanBaseline,
} from '../../utils/strategic-plan/workplanBaseline';
import {
    listStrategicWorkplanVersions,
    loadStrategicWorkplan,
    saveStrategicWorkplan,
    type StrategicWorkplanError,
} from '../../utils/strategic-plan/workplanService';
import {
    STRATEGIC_WORKPLAN_STATUSES,
    type StrategicWorkplanDocument,
    type StrategicWorkplanOwnership,
    type StrategicWorkplanSegment,
    type StrategicWorkplanSegmentType,
    type StrategicWorkplanStatus,
    type StrategicWorkplanTask,
    type StrategicWorkplanVersion,
} from '../../utils/strategic-plan/workplanTypes';

type WorkplanView = 'update-desk' | 'full-schedule' | 'timeline';
type TimelineZoom = 'compact' | 'standard' | 'detailed';

interface StrategicWorkplanWorkspaceProps {
    teamId: string;
    userId?: string;
    userLabel?: string;
    onBack: () => void;
    services?: StrategicWorkplanWorkspaceServices;
}

export interface StrategicWorkplanWorkspaceServices {
    load: typeof loadStrategicWorkplan;
    save: typeof saveStrategicWorkplan;
    listVersions: typeof listStrategicWorkplanVersions;
}

const DEFAULT_SERVICES: StrategicWorkplanWorkspaceServices = {
    load: loadStrategicWorkplan,
    save: saveStrategicWorkplan,
    listVersions: listStrategicWorkplanVersions,
};

const STATUS_STYLES: Record<StrategicWorkplanStatus, string> = {
    unconfirmed: 'bg-slate-100 text-slate-700 ring-slate-200',
    'not-started': 'bg-blue-50 text-blue-800 ring-blue-200',
    'in-progress': 'bg-cyan-50 text-cyan-800 ring-cyan-200',
    'at-risk': 'bg-amber-50 text-amber-800 ring-amber-200',
    blocked: 'bg-red-50 text-red-800 ring-red-200',
    complete: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};

const SEGMENT_LABELS: Record<StrategicWorkplanSegmentType, string> = {
    task: 'Task',
    'draft-deliverable': 'Draft deliverable',
    review: 'Review',
    'final-deliverable': 'Final deliverable',
    'project-initiation': 'Project initiation',
    'project-team-meeting': 'Project team meeting',
    'working-session': 'Working session',
    'council-presentation': 'Council presentation',
    'engagement-event': 'Engagement event',
};

const MILESTONE_STYLES: Record<StrategicWorkplanSegmentType, string> = {
    task: 'bg-sky-300',
    'draft-deliverable': 'bg-blue-600',
    review: 'bg-violet-300',
    'final-deliverable': 'bg-blue-700',
    'project-initiation': 'bg-red-600',
    'project-team-meeting': 'bg-red-600',
    'working-session': 'bg-indigo-900',
    'council-presentation': 'bg-violet-700',
    'engagement-event': 'bg-amber-500',
};

function isoToday(): string {
    return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string | null): string {
    if (!value) return 'Unscheduled';
    return new Intl.DateTimeFormat('en-CA', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));
}

function dateDifference(start: string, end: string): number {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function positionForDate(date: string, scheduleStart: string, scheduleEnd: string): number {
    const total = Math.max(1, dateDifference(scheduleStart, scheduleEnd));
    return Math.min(100, Math.max(0, (dateDifference(scheduleStart, date) / total) * 100));
}

function widthForRange(start: string, end: string, scheduleStart: string, scheduleEnd: string): number {
    const startPosition = positionForDate(start, scheduleStart, scheduleEnd);
    const endPosition = positionForDate(addStrategicWorkplanDays(end, 1), scheduleStart, scheduleEnd);
    return Math.max(0.45, endPosition - startPosition);
}

function statusLabel(status: StrategicWorkplanStatus): string {
    return STRATEGIC_WORKPLAN_STATUSES.find(option => option.value === status)?.label ?? status;
}

function newTaskId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `custom-${Date.now()}`;
}

function segmentIsMilestone(segment: StrategicWorkplanSegment): boolean {
    return segment.type !== 'task' && segment.type !== 'review';
}

const StatusBadge: React.FC<{ status: StrategicWorkplanStatus }> = ({ status }) => (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${STATUS_STYLES[status]}`}>
        {statusLabel(status)}
    </span>
);

const WorkplanTaskEditor: React.FC<{
    task: StrategicWorkplanTask;
    allTasks: StrategicWorkplanTask[];
    onChange: (task: StrategicWorkplanTask) => void;
    onDelete: () => void;
    onClose: () => void;
}> = ({ task, allTasks, onChange, onDelete, onClose }) => {
    const update = <K extends keyof StrategicWorkplanTask>(key: K, value: StrategicWorkplanTask[K]) => {
        onChange({ ...task, [key]: value });
    };
    const updateSegment = (segmentId: string, changes: Partial<StrategicWorkplanSegment>) => {
        update('segments', task.segments.map(segment => segment.id === segmentId ? { ...segment, ...changes } : segment));
    };
    const milestones = task.segments.filter(segment => segment.type !== 'task');

    return (
        <aside className="h-full overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={`Edit task ${task.wbs}`}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.14em] text-[#001C80]">Edit task {task.wbs}</div>
                    <h3 className="mt-1 text-lg font-black text-slate-900">Project-control details</h3>
                </div>
                <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close task editor">
                    <X size={18} />
                </button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
                <label className="text-sm font-bold text-slate-700">
                    WBS
                    <input value={task.wbs} onChange={event => update('wbs', event.target.value)} maxLength={30} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" />
                </label>
                <label className="text-sm font-bold text-slate-700">
                    Ownership
                    <select value={task.ownership} onChange={event => update('ownership', event.target.value as StrategicWorkplanOwnership)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900">
                        {(['Staff', 'Consultant', 'Joint', 'Unassigned'] as StrategicWorkplanOwnership[]).map(owner => <option key={owner}>{owner}</option>)}
                    </select>
                </label>
                <label className="text-sm font-bold text-slate-700 md:col-span-2">
                    Task name
                    <input value={task.title} onChange={event => update('title', event.target.value)} maxLength={240} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" />
                </label>
                <label className="text-sm font-bold text-slate-700">
                    Phase
                    <input value={task.phaseName} onChange={event => update('phaseName', event.target.value)} maxLength={160} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" />
                </label>
                <label className="text-sm font-bold text-slate-700">
                    Chapter
                    <input value={task.chapter ?? ''} onChange={event => update('chapter', event.target.value || null)} maxLength={200} placeholder="Optional" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" />
                </label>
                <label className="text-sm font-bold text-slate-700">
                    Start date
                    <input type="date" value={task.startDate ?? ''} onChange={event => update('startDate', event.target.value || null)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" />
                </label>
                <label className="text-sm font-bold text-slate-700">
                    End date
                    <input type="date" value={task.endDate ?? ''} onChange={event => update('endDate', event.target.value || null)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" />
                </label>
                <label className="text-sm font-bold text-slate-700">
                    Status
                    <select value={task.status} onChange={event => update('status', event.target.value as StrategicWorkplanStatus)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900">
                        {STRATEGIC_WORKPLAN_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className="text-sm font-bold text-slate-700">
                    Progress ({task.progress}%)
                    <input type="range" min="0" max="100" step="5" value={task.progress} onChange={event => update('progress', Number(event.target.value))} className="mt-3 w-full accent-[#001C80]" />
                </label>
                <label className="text-sm font-bold text-slate-700 md:col-span-2">
                    Dependencies
                    <input
                        value={task.dependencies.join(', ')}
                        onChange={event => update('dependencies', event.target.value.split(',').map(value => value.trim()).filter(Boolean))}
                        placeholder={allTasks.filter(candidate => candidate.id !== task.id).slice(0, 3).map(candidate => candidate.wbs).join(', ')}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900"
                    />
                    <span className="mt-1 block text-xs font-medium text-slate-500">Enter WBS numbers separated by commas.</span>
                </label>
                <label className="text-sm font-bold text-slate-700 md:col-span-2">
                    Update note
                    <textarea value={task.notes} onChange={event => update('notes', event.target.value)} maxLength={4000} rows={3} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-900" placeholder="Decision, blocker, next action, or evidence gap" />
                </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Milestones and review windows</h4>
                        <p className="mt-0.5 text-xs text-slate-500">Source markers retain week-level precision.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const date = task.endDate ?? task.startDate ?? isoToday();
                            update('segments', [...task.segments, {
                                id: `${task.id}-segment-${Date.now()}`,
                                type: 'final-deliverable',
                                label: 'New milestone',
                                startDate: date,
                                endDate: date,
                                datePrecision: 'week',
                            }]);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                        <Plus size={14} /> Add milestone
                    </button>
                </div>
                <div className="mt-3 space-y-2">
                    {milestones.length === 0 && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">No milestones recorded.</div>}
                    {milestones.map(segment => (
                        <div key={segment.id} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
                            <select value={segment.type} onChange={event => updateSegment(segment.id, { type: event.target.value as StrategicWorkplanSegmentType })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm font-semibold">
                                {Object.entries(SEGMENT_LABELS).filter(([type]) => type !== 'task').map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                            </select>
                            <input value={segment.label} onChange={event => updateSegment(segment.id, { label: event.target.value })} maxLength={120} className="rounded-lg border border-slate-300 px-2 py-2 text-sm font-semibold" aria-label="Milestone label" />
                            <input type="date" value={segment.startDate} onChange={event => updateSegment(segment.id, { startDate: event.target.value, endDate: event.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm font-semibold" aria-label={`${segment.label} week`} />
                            <button type="button" onClick={() => update('segments', task.segments.filter(candidate => candidate.id !== segment.id))} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Remove ${segment.label}`}><Trash2 size={16} /></button>
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
                <button type="button" onClick={onDelete} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"><Trash2 size={16} /> Delete task</button>
            </div>
        </aside>
    );
};

export const StrategicWorkplanWorkspace: React.FC<StrategicWorkplanWorkspaceProps> = ({
    teamId,
    userId,
    userLabel = 'Project team member',
    onBack,
    services = DEFAULT_SERVICES,
}) => {
    const [workplan, setWorkplan] = useState<StrategicWorkplanDocument | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [view, setView] = useState<WorkplanView>('full-schedule');
    const [zoom, setZoom] = useState<TimelineZoom>('standard');
    const [search, setSearch] = useState('');
    const [phaseFilter, setPhaseFilter] = useState('all');
    const [ownerFilter, setOwnerFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [versions, setVersions] = useState<StrategicWorkplanVersion[]>([]);

    const load = async (confirmDiscard = false) => {
        if (confirmDiscard && dirty && !window.confirm('Discard your unsaved work-plan changes and reload the shared version?')) return;
        setLoading(true);
        setError(null);
        setNotice(null);
        try {
            const persisted = await services.load(teamId);
            setWorkplan(persisted ?? createStrategicWorkplanBaseline(teamId, userId ?? 'unpublished-baseline'));
            setDirty(false);
            setSelectedTaskId(null);
            setVersions([]);
            if (!persisted) setNotice('The Dillon proposal baseline is ready. Save it to publish the first shared team revision.');
        } catch (loadError) {
            setError((loadError as Error).message);
            setWorkplan(createStrategicWorkplanBaseline(teamId, userId ?? 'unpublished-baseline'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        setLoading(true);
        services.load(teamId)
            .then(persisted => {
                if (!active) return;
                setWorkplan(persisted ?? createStrategicWorkplanBaseline(teamId, userId ?? 'unpublished-baseline'));
                if (!persisted) setNotice('The Dillon proposal baseline is ready. Save it to publish the first shared team revision.');
            })
            .catch(loadError => {
                if (!active) return;
                setError((loadError as Error).message);
                setWorkplan(createStrategicWorkplanBaseline(teamId, userId ?? 'unpublished-baseline'));
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [teamId, userId, services]);

    const changeWorkplan = (next: StrategicWorkplanDocument) => {
        setWorkplan(next);
        setDirty(true);
        setNotice(null);
        setError(null);
    };

    const updateTask = (nextTask: StrategicWorkplanTask) => {
        if (!workplan) return;
        changeWorkplan({ ...workplan, tasks: workplan.tasks.map(task => task.id === nextTask.id ? nextTask : task) });
    };

    const save = async () => {
        if (!workplan || !userId) {
            setError('Sign in with Strategic Plan access before saving the shared work plan.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const saved = await services.save(teamId, workplan, userId, userLabel);
            setWorkplan(saved);
            setDirty(false);
            setVersions([]);
            setNotice(`Shared revision ${saved.revision} saved by ${userLabel}.`);
        } catch (saveError) {
            const typedError = saveError as StrategicWorkplanError;
            setError(typedError.message);
        } finally {
            setSaving(false);
        }
    };

    const openHistory = async () => {
        const nextOpen = !historyOpen;
        setHistoryOpen(nextOpen);
        if (!nextOpen || workplan.revision === 0 || versions.length > 0) return;
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            setVersions(await services.listVersions(teamId));
        } catch (historyLoadError) {
            setHistoryError((historyLoadError as Error).message);
        } finally {
            setHistoryLoading(false);
        }
    };

    const phaseOptions = useMemo(() => {
        const values = new Map<string, string>();
        workplan?.tasks.forEach(task => values.set(task.phaseId, task.phaseName));
        return [...values.entries()];
    }, [workplan]);

    const filteredTasks = useMemo(() => {
        if (!workplan) return [];
        const needle = search.trim().toLowerCase();
        return workplan.tasks.filter(task => (
            (!needle || `${task.wbs} ${task.title} ${task.chapter ?? ''} ${task.notes}`.toLowerCase().includes(needle))
            && (phaseFilter === 'all' || task.phaseId === phaseFilter)
            && (ownerFilter === 'all' || task.ownership === ownerFilter)
            && (statusFilter === 'all' || task.status === statusFilter)
        ));
    }, [workplan, search, phaseFilter, ownerFilter, statusFilter]);

    const summary = useMemo(() => {
        const tasks = workplan?.tasks ?? [];
        const today = isoToday();
        const nextMonth = addStrategicWorkplanDays(today, 30);
        return {
            total: tasks.length,
            unconfirmed: tasks.filter(task => task.status === 'unconfirmed').length,
            active: tasks.filter(task => task.status === 'in-progress').length,
            attention: tasks.filter(task => task.status === 'blocked' || task.status === 'at-risk').length,
            complete: tasks.filter(task => task.status === 'complete').length,
            dueSoon: tasks.filter(task => task.endDate && task.endDate >= today && task.endDate <= nextMonth && task.status !== 'complete').length,
            pastBaseline: tasks.filter(task => task.endDate && task.endDate < today && task.status !== 'complete').length,
        };
    }, [workplan]);

    const selectedTask = workplan?.tasks.find(task => task.id === selectedTaskId) ?? null;

    useEffect(() => {
        if (!selectedTaskId) return;
        const previousOverflow = document.body.style.overflow;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setSelectedTaskId(null);
        };
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [selectedTaskId]);

    const addTask = () => {
        if (!workplan) return;
        const id = newTaskId();
        const phase = phaseOptions[0] ?? ['custom', 'Project Work Plan'];
        const task: StrategicWorkplanTask = {
            id,
            wbs: `NEW-${workplan.tasks.filter(candidate => candidate.wbs.startsWith('NEW-')).length + 1}`,
            phaseId: phase[0],
            phaseName: phase[1],
            chapter: null,
            title: 'New work-plan task',
            ownership: 'Unassigned',
            startDate: null,
            endDate: null,
            status: 'unconfirmed',
            progress: 0,
            dependencies: [],
            notes: '',
            segments: [],
        };
        changeWorkplan({ ...workplan, tasks: [...workplan.tasks, task] });
        setSelectedTaskId(id);
    };

    const deleteSelectedTask = () => {
        if (!workplan || !selectedTask) return;
        if (!window.confirm(`Delete ${selectedTask.wbs} ${selectedTask.title}? This will take effect when you save.`)) return;
        changeWorkplan({ ...workplan, tasks: workplan.tasks.filter(task => task.id !== selectedTask.id) });
        setSelectedTaskId(null);
    };

    const monthBuckets = useMemo(() => {
        if (!workplan) return [];
        const buckets: Array<{ key: string; label: string; start: string; end: string }> = [];
        const start = new Date(`${workplan.scheduleStart}T00:00:00Z`);
        const end = new Date(`${workplan.scheduleEnd}T00:00:00Z`);
        let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        while (cursor <= end) {
            const monthStart = cursor.toISOString().slice(0, 10);
            const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
            const monthEnd = addStrategicWorkplanDays(nextMonth.toISOString().slice(0, 10), -1);
            buckets.push({
                key: monthStart.slice(0, 7),
                label: new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(cursor),
                start: monthStart < workplan.scheduleStart ? workplan.scheduleStart : monthStart,
                end: monthEnd > workplan.scheduleEnd ? workplan.scheduleEnd : monthEnd,
            });
            cursor = nextMonth;
        }
        return buckets;
    }, [workplan]);

    if (loading || !workplan) {
        return (
            <div className="flex min-h-[32rem] items-center justify-center gap-3 text-slate-600" role="status">
                <Loader2 className="animate-spin text-[#001C80]" size={26} />
                <span className="font-bold">Loading the shared project work plan...</span>
            </div>
        );
    }

    const timelineWidth = zoom === 'compact' ? 900 : zoom === 'standard' ? 1400 : 2100;
    const today = isoToday();
    const todayPosition = today >= workplan.scheduleStart && today <= workplan.scheduleEnd
        ? positionForDate(today, workplan.scheduleStart, workplan.scheduleEnd)
        : null;
    const phaseGroups = phaseOptions.map(([phaseId, phaseName]) => ({
        phaseId,
        phaseName,
        tasks: filteredTasks.filter(task => task.phaseId === phaseId),
    })).filter(group => group.tasks.length > 0);

    return (
        <div className="min-h-full bg-slate-50">
            <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
                <div className="mx-auto flex max-w-[1800px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-start gap-3">
                        <button type="button" onClick={onBack} className="mt-0.5 rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Back to Strategic Plan workspaces">
                            <ChevronRight size={19} className="rotate-180" />
                        </button>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-xl font-black text-slate-950 sm:text-2xl">Project Work Plan</h1>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${dirty ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{dirty ? 'Unsaved changes' : workplan.revision ? `Shared revision ${workplan.revision}` : 'Baseline not published'}</span>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">Maintain tasks, ownership, status, dependencies, deliverables, and the proposal timeline in one shared workspace.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={addTask} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"><Plus size={16} /> Add task</button>
                        <button type="button" onClick={() => void openHistory()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"><History size={16} /> History</button>
                        <button type="button" onClick={() => void load(true)} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} /> Reload</button>
                        <button type="button" onClick={() => void save()} disabled={saving || (!dirty && workplan.revision > 0)} className="inline-flex items-center gap-2 rounded-lg bg-[#001C80] px-4 py-2 text-sm font-black text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50">
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {workplan.revision === 0 ? 'Publish baseline' : 'Save changes'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1800px] space-y-4 px-4 py-5 sm:px-6">
                <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <div className="flex items-start gap-3">
                        <FileText className="mt-0.5 shrink-0 text-[#001C80]" size={20} />
                        <div className="min-w-0">
                            <div className="font-black text-blue-950">Source baseline: {workplan.source.organization}, {formatDate(workplan.source.proposalDate)}</div>
                            <p className="mt-1 text-sm leading-relaxed text-blue-900">{workplan.source.note}</p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-blue-800">
                                <span>{workplan.source.fileName}</span>
                                <span>{workplan.source.schedulePages}</span>
                                <span>{formatDate(workplan.scheduleStart)} to {formatDate(workplan.scheduleEnd)}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {(error || notice) && (
                    <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role={error ? 'alert' : 'status'}>
                        {error ?? notice}
                    </div>
                )}

                {historyOpen && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Work-plan version history">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-base font-black text-slate-900">Shared version history</h2>
                                <p className="mt-1 text-xs font-semibold text-slate-500">Restoring stages an earlier snapshot as unsaved changes; it never overwrites history.</p>
                            </div>
                            <button type="button" onClick={() => setHistoryOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close version history"><X size={16} /></button>
                        </div>
                        {historyLoading && <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600"><Loader2 size={16} className="animate-spin" />Loading versions...</div>}
                        {historyError && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{historyError}</div>}
                        {!historyLoading && !historyError && versions.length === 0 && <div className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500">{workplan.revision === 0 ? 'Publish the baseline to create the first version.' : 'No saved versions were returned.'}</div>}
                        {versions.length > 0 && (
                            <div className="mt-4 space-y-2">
                                {versions.map(version => (
                                    <article key={version.revision} className="rounded-xl border border-slate-200 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">Revision {version.revision} · {version.audit.editedByName}</div>
                                                <div className="mt-0.5 text-xs font-semibold text-slate-500">{formatDate(version.audit.editedAt.slice(0, 10))} · {version.audit.summary}</div>
                                                <div className="mt-1 text-[11px] font-semibold text-slate-400">Authenticated user: {version.audit.editedByUid}</div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={version.revision === workplan.revision && !dirty}
                                                onClick={() => {
                                                    const { audit: _audit, ...snapshot } = version;
                                                    changeWorkplan({
                                                        ...snapshot,
                                                        revision: workplan.revision,
                                                        createdAt: workplan.createdAt,
                                                        createdBy: workplan.createdBy,
                                                        updatedAt: workplan.updatedAt,
                                                        updatedBy: workplan.updatedBy,
                                                    });
                                                    setHistoryOpen(false);
                                                    setNotice(`Revision ${version.revision} is staged. Save to create a new shared revision.`);
                                                }}
                                                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-black text-[#001C80] hover:bg-blue-50 disabled:opacity-40"
                                            >
                                                Restore
                                            </button>
                                        </div>
                                        {version.audit.changes.length > 0 && (
                                            <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
                                                <summary className="cursor-pointer text-xs font-black text-slate-700">Who changed what ({version.audit.changes.length} tasks)</summary>
                                                <div className="mt-2 space-y-2">
                                                    {version.audit.changes.map(change => (
                                                        <div key={`${change.kind}-${change.taskId}`} className="border-t border-slate-200 pt-2 text-xs">
                                                            <div className="font-black text-slate-800">{change.kind.toUpperCase()} · {change.wbs} · {change.title}</div>
                                                            <ul className="mt-1 space-y-1 text-slate-600">
                                                                {change.fields.map(field => (
                                                                    <li key={field.field}><span className="font-bold">{field.field}:</span> {field.before} → {field.after}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
                    {[
                        { label: 'Tasks', value: summary.total, icon: <GanttChartSquare size={18} />, style: 'text-slate-700 bg-slate-100' },
                        { label: 'Needs status', value: summary.unconfirmed, icon: <CircleHelp size={18} />, style: 'text-slate-700 bg-slate-100' },
                        { label: 'In progress', value: summary.active, icon: <CalendarClock size={18} />, style: 'text-cyan-800 bg-cyan-50' },
                        { label: 'Needs attention', value: summary.attention, icon: <AlertTriangle size={18} />, style: 'text-amber-800 bg-amber-50' },
                        { label: 'Due in 30 days', value: summary.dueSoon, icon: <CalendarDays size={18} />, style: 'text-blue-800 bg-blue-50' },
                        { label: 'Complete', value: summary.complete, icon: <Check size={18} />, style: 'text-emerald-800 bg-emerald-50' },
                    ].map(card => (
                        <article key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className={`inline-flex rounded-lg p-2 ${card.style}`}>{card.icon}</div>
                            <div className="mt-3 text-2xl font-black text-slate-950">{card.value}</div>
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{card.label}</div>
                        </article>
                    ))}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 sm:w-auto" role="tablist" aria-label="Work-plan views">
                            {([
                                ['update-desk', 'Update Desk', LayoutDashboard],
                                ['full-schedule', 'Full Schedule', GanttChartSquare],
                                ['timeline', 'Timeline', CalendarDays],
                            ] as const).map(([value, label, Icon]) => (
                                <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition sm:flex-none ${view === value ? 'bg-white text-[#001C80] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                                    <Icon size={16} /> {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="relative min-w-60 flex-1 xl:flex-none">
                                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search task, WBS, chapter..." className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm font-semibold text-slate-900" />
                            </label>
                            <Filter size={16} className="text-slate-400" />
                            <select value={phaseFilter} onChange={event => setPhaseFilter(event.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold"><option value="all">All phases</option>{phaseOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                            <select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold"><option value="all">All owners</option>{['Staff', 'Consultant', 'Joint', 'Unassigned'].map(owner => <option key={owner}>{owner}</option>)}</select>
                            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold"><option value="all">All statuses</option>{STRATEGIC_WORKPLAN_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                            {view === 'full-schedule' && <select value={zoom} onChange={event => setZoom(event.target.value as TimelineZoom)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold"><option value="compact">Compact</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select>}
                        </div>
                    </div>

                    {view === 'update-desk' && (
                        <div>
                            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                <span className="font-black text-slate-900">{summary.pastBaseline} past baseline end date</span> and not marked complete. Confirm actual status before treating these as overdue.
                            </div>
                            <div className="space-y-3 p-3 md:hidden">
                                {filteredTasks.map(task => (
                                    <article key={task.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-xs font-black uppercase tracking-wide text-[#001C80]">{task.wbs} · {task.ownership}</div>
                                                <h3 className="mt-1 text-sm font-black text-slate-900">{task.title}</h3>
                                                <p className="mt-1 truncate text-xs font-semibold text-slate-500">{task.chapter ?? task.phaseName}</p>
                                            </div>
                                            <button type="button" onClick={() => setSelectedTaskId(task.id)} className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-black text-[#001C80]">Edit</button>
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                                            <label className="text-[0.65rem] font-black uppercase tracking-wide text-slate-500">
                                                Status
                                                <select value={task.status} onChange={event => updateTask({ ...task, status: event.target.value as StrategicWorkplanStatus })} className={`mt-1 block w-full rounded-lg border-0 px-2 py-2 text-xs font-black ring-1 ring-inset ${STATUS_STYLES[task.status]}`} aria-label={`${task.wbs} mobile status`}>
                                                    {STRATEGIC_WORKPLAN_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </label>
                                            <label className="text-[0.65rem] font-black uppercase tracking-wide text-slate-500">
                                                Progress · {task.progress}%
                                                <input type="range" min="0" max="100" step="5" value={task.progress} onChange={event => updateTask({ ...task, progress: Number(event.target.value) })} className="mt-3 w-full accent-[#001C80]" aria-label={`${task.wbs} mobile progress`} />
                                            </label>
                                        </div>
                                        <div className="mt-3 text-xs font-semibold text-slate-600">{task.startDate ? `${formatDate(task.startDate)} - ${formatDate(task.endDate)}` : 'Unscheduled in source'}</div>
                                    </article>
                                ))}
                                {filteredTasks.length === 0 && <div className="px-4 py-12 text-center text-sm font-semibold text-slate-500">No tasks match these filters.</div>}
                            </div>
                            <div className="hidden overflow-x-auto md:block">
                                <table className="w-full min-w-[1100px] border-collapse text-sm">
                                    <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Task</th>
                                            <th className="px-3 py-3 text-left">Owner</th>
                                            <th className="px-3 py-3 text-left">Baseline window</th>
                                            <th className="px-3 py-3 text-left">Status</th>
                                            <th className="px-3 py-3 text-left">Progress</th>
                                            <th className="px-3 py-3 text-left">Dependencies</th>
                                            <th className="px-3 py-3 text-right">Details</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {filteredTasks.map(task => (
                                            <tr key={task.id} className="hover:bg-slate-50/70">
                                                <td className="px-4 py-3">
                                                    <div className="font-black text-slate-900">{task.wbs} · {task.title}</div>
                                                    <div className="mt-1 max-w-xl truncate text-xs font-medium text-slate-500">{task.chapter ?? task.phaseName}</div>
                                                </td>
                                                <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 font-bold text-slate-700"><Users size={14} className="text-slate-400" />{task.ownership}</span></td>
                                                <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600">{task.startDate ? `${formatDate(task.startDate)} - ${formatDate(task.endDate)}` : 'Unscheduled in source'}</td>
                                                <td className="px-3 py-3">
                                                    <select value={task.status} onChange={event => updateTask({ ...task, status: event.target.value as StrategicWorkplanStatus })} className={`rounded-lg border-0 px-2.5 py-2 text-xs font-black ring-1 ring-inset ${STATUS_STYLES[task.status]}`} aria-label={`${task.wbs} status`}>
                                                        {STRATEGIC_WORKPLAN_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                    </select>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <input type="range" min="0" max="100" step="5" value={task.progress} onChange={event => updateTask({ ...task, progress: Number(event.target.value) })} className="w-24 accent-[#001C80]" aria-label={`${task.wbs} progress`} />
                                                        <span className="w-9 text-right text-xs font-black text-slate-700">{task.progress}%</span>
                                                    </div>
                                                </td>
                                                <td className="max-w-44 truncate px-3 py-3 text-xs font-semibold text-slate-600">{task.dependencies.join(', ') || 'None recorded'}</td>
                                                <td className="px-3 py-3 text-right"><button type="button" onClick={() => setSelectedTaskId(task.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-[#001C80] hover:bg-blue-50">Edit</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredTasks.length === 0 && <div className="px-4 py-12 text-center text-sm font-semibold text-slate-500">No tasks match these filters.</div>}
                            </div>
                        </div>
                    )}

                    {view === 'full-schedule' && (
                        <div className="overflow-auto">
                            <div style={{ minWidth: 390 + timelineWidth }}>
                                <div className="sticky top-0 z-20 grid border-b border-slate-300 bg-white" style={{ gridTemplateColumns: `390px ${timelineWidth}px` }}>
                                    <div className="sticky left-0 z-30 flex items-end border-r border-slate-300 bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-600">Task / milestone</div>
                                    <div className="relative flex h-14 bg-slate-100">
                                        {monthBuckets.map(month => (
                                            <div key={month.key} className="flex shrink-0 items-end border-r border-slate-300 px-2 pb-2 text-xs font-black text-slate-600" style={{ width: `${widthForRange(month.start, month.end, workplan.scheduleStart, workplan.scheduleEnd)}%` }}>{month.label}</div>
                                        ))}
                                    </div>
                                </div>
                                {filteredTasks.map(task => (
                                    <div key={task.id} className="grid border-b border-slate-200" style={{ gridTemplateColumns: `390px ${timelineWidth}px` }}>
                                        <button type="button" onClick={() => setSelectedTaskId(task.id)} className="sticky left-0 z-10 flex min-h-14 items-center justify-between gap-3 border-r border-slate-300 bg-white px-4 py-2 text-left hover:bg-slate-50" aria-label={`Edit ${task.wbs} ${task.title}`}>
                                            <span className="min-w-0"><span className="block truncate text-sm font-black text-slate-900">{task.wbs} · {task.title}</span><span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{task.ownership} · {task.chapter ?? task.phaseName}</span></span>
                                            <StatusBadge status={task.status} />
                                        </button>
                                        <div className="relative min-h-14 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(1.666%-1px),#e2e8f0_calc(1.666%-1px),#e2e8f0_1.666%)]">
                                            {todayPosition !== null && <div className="absolute inset-y-0 z-[2] w-px bg-red-500" style={{ left: `${todayPosition}%` }} title={`Today: ${formatDate(today)}`} />}
                                            {task.startDate && task.endDate && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedTaskId(task.id)}
                                                    className={`absolute top-4 h-5 rounded-md shadow-sm ${task.status === 'complete' ? 'bg-emerald-500' : task.status === 'blocked' ? 'bg-red-500' : task.status === 'at-risk' ? 'bg-amber-500' : 'bg-sky-500'}`}
                                                    style={{ left: `${positionForDate(task.startDate, workplan.scheduleStart, workplan.scheduleEnd)}%`, width: `${widthForRange(task.startDate, task.endDate, workplan.scheduleStart, workplan.scheduleEnd)}%` }}
                                                    title={`${task.wbs}: ${formatDate(task.startDate)} to ${formatDate(task.endDate)}`}
                                                />
                                            )}
                                            {task.segments.filter(segment => segment.type === 'review').map(segment => (
                                                <div key={segment.id} className="absolute top-4 z-[3] h-5 bg-violet-300/90" style={{ left: `${positionForDate(segment.startDate, workplan.scheduleStart, workplan.scheduleEnd)}%`, width: `${widthForRange(segment.startDate, segment.endDate, workplan.scheduleStart, workplan.scheduleEnd)}%` }} title={`${segment.label}: week of ${formatDate(segment.startDate)}`} />
                                            ))}
                                            {task.segments.filter(segmentIsMilestone).map(segment => (
                                                <div key={segment.id} className={`absolute top-3 z-[4] h-7 w-2 -translate-x-1 rounded-sm ring-2 ring-white ${MILESTONE_STYLES[segment.type]}`} style={{ left: `${positionForDate(segment.startDate, workplan.scheduleStart, workplan.scheduleEnd)}%` }} title={`${segment.label}: week of ${formatDate(segment.startDate)}`} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                {filteredTasks.length === 0 && <div className="px-4 py-12 text-center text-sm font-semibold text-slate-500">No tasks match these filters.</div>}
                            </div>
                        </div>
                    )}

                    {view === 'timeline' && (
                        <div className="space-y-4 bg-slate-50 p-4 sm:p-5">
                            {phaseGroups.map(group => {
                                const scheduled = group.tasks.filter(task => task.startDate && task.endDate);
                                const start = scheduled.map(task => task.startDate as string).sort()[0] ?? null;
                                const end = scheduled.map(task => task.endDate as string).sort().at(-1) ?? null;
                                const milestones = group.tasks.flatMap(task => task.segments.filter(segmentIsMilestone).map(segment => ({ ...segment, task })));
                                const chapters = [...new Set(group.tasks.map(task => task.chapter).filter(Boolean))];
                                return (
                                    <article key={group.phaseId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div>
                                                <div className="text-xs font-black uppercase tracking-[0.14em] text-[#001C80]">{group.phaseId.replace('-', ' ')}</div>
                                                <h3 className="mt-1 text-xl font-black text-slate-950">{group.phaseName}</h3>
                                                <p className="mt-1 text-sm font-semibold text-slate-500">{group.tasks.length} tasks · {chapters.length || 'No'} chapter{chapters.length === 1 ? '' : 's'} · {start && end ? `${formatDate(start)} to ${formatDate(end)}` : 'Dates need confirmation'}</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">{STRATEGIC_WORKPLAN_STATUSES.filter(status => group.tasks.some(task => task.status === status.value)).map(status => <span key={status.value} className="text-xs font-bold text-slate-600">{group.tasks.filter(task => task.status === status.value).length} {status.label.toLowerCase()}</span>)}</div>
                                        </div>
                                        <div className="relative mt-5 h-10 overflow-hidden rounded-xl border border-slate-200 bg-[repeating-linear-gradient(to_right,#f8fafc_0,#f8fafc_calc(8.333%-1px),#e2e8f0_calc(8.333%-1px),#e2e8f0_8.333%)]">
                                            {start && end && <div className="absolute top-2 h-6 rounded-lg bg-[#001C80]" style={{ left: `${positionForDate(start, workplan.scheduleStart, workplan.scheduleEnd)}%`, width: `${widthForRange(start, end, workplan.scheduleStart, workplan.scheduleEnd)}%` }} />}
                                            {todayPosition !== null && <div className="absolute inset-y-0 z-10 w-0.5 bg-red-500" style={{ left: `${todayPosition}%` }} />}
                                        </div>
                                        {chapters.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{chapters.map(chapter => <span key={chapter} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700">{chapter}</span>)}</div>}
                                        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                            {milestones.slice(0, 12).map(milestone => (
                                                <button key={`${milestone.task.id}-${milestone.id}`} type="button" onClick={() => setSelectedTaskId(milestone.task.id)} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-slate-300 hover:bg-slate-50">
                                                    <span className={`mt-1 h-3 w-3 shrink-0 rounded-sm ${MILESTONE_STYLES[milestone.type]}`} />
                                                    <span className="min-w-0"><span className="block truncate text-sm font-black text-slate-900">{milestone.label}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{milestone.task.wbs} · week of {formatDate(milestone.startDate)}</span></span>
                                                </button>
                                            ))}
                                        </div>
                                    </article>
                                );
                            })}
                            {phaseGroups.length === 0 && <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm font-semibold text-slate-500">No phases match these filters.</div>}
                        </div>
                    )}
                </section>

                <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
                    <span><History size={14} className="mr-1.5 inline" />Each shared save records the authenticated editor and task-field changes in an immutable Firestore version.</span>
                    <span>Current status is project-control information, not approval of Strategic Plan recommendations.</span>
                </footer>
            </main>

            {selectedTask && (
                <div className="fixed inset-0 z-50 flex justify-end" aria-label="Task editing drawer">
                    <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" onClick={() => setSelectedTaskId(null)} aria-label="Close task editor" />
                    <div className="relative h-full w-full max-w-2xl">
                        <WorkplanTaskEditor
                            task={selectedTask}
                            allTasks={workplan.tasks}
                            onChange={updateTask}
                            onDelete={deleteSelectedTask}
                            onClose={() => setSelectedTaskId(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
