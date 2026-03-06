import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    Bot,
    CheckCircle2,
    Clock3,
    Copy,
    Link2,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
    AgentSession,
    AgentSessionDraft,
    AgentSessionFilter,
    AgentSessionPriority,
    AgentSessionStatus,
    buildAgentSessionRollupText,
    createEmptyAgentSessionDraft,
    filterAgentSessions,
    getAgentSessionAgeHours,
    getAgentSessionDisplayTitle,
    getAgentSessionPromptPreview,
    getAgentSessionRollup,
    isAgentSessionCriticallyStale,
    isAgentSessionStale,
    sortAgentSessions,
} from '../../utils/agentSessions';
import {
    createAgentSessionId,
    loadAgentSessions,
    saveAgentSessions,
} from '../../utils/services/agentSessionService';
import {
    deleteAgentSessionFromCloud,
    hydrateLocalAgentSessionsToCloud,
    saveAgentSessionToCloud,
    subscribeToAgentSessions,
} from '../../utils/services/agentSessionFirestoreService';

const STATUS_LABELS: Record<AgentSessionStatus, string> = {
    active: 'Active',
    waiting: 'Waiting',
    blocked: 'Blocked',
    review: 'Needs Input',
    done: 'Done',
};

const PRIORITY_LABELS: Record<AgentSessionPriority, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
};

const FILTER_LABELS: Record<AgentSessionFilter, string> = {
    all: 'All',
    active: 'Active',
    waiting: 'Waiting',
    blocked: 'Blocked',
    review: 'Needs Input',
    done: 'Done',
    stale: 'Stale',
};

const FILTER_ORDER: AgentSessionFilter[] = ['all', 'active', 'blocked', 'review', 'waiting', 'stale', 'done'];

function formatRelativeUpdate(ageHours: number): string {
    if (!Number.isFinite(ageHours) || ageHours < 1) {
        return 'Updated just now';
    }
    if (ageHours < 24) {
        return `Updated ${Math.floor(ageHours)}h ago`;
    }
    const days = Math.floor(ageHours / 24);
    return `Updated ${days}d ago`;
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'Unknown';
    }
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

function getStatusClasses(status: AgentSessionStatus): string {
    switch (status) {
        case 'active':
            return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'waiting':
            return 'bg-sky-50 text-sky-700 border-sky-200';
        case 'blocked':
            return 'bg-rose-50 text-rose-700 border-rose-200';
        case 'review':
            return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'done':
            return 'bg-gray-100 text-gray-600 border-gray-200';
    }
}

function getPriorityClasses(priority: AgentSessionPriority): string {
    switch (priority) {
        case 'critical':
            return 'bg-rose-600 text-white';
        case 'high':
            return 'bg-orange-100 text-orange-700';
        case 'medium':
            return 'bg-gray-100 text-gray-700';
        case 'low':
            return 'bg-slate-100 text-slate-600';
    }
}

function getCardTone(session: AgentSession, now: number): string {
    if (session.status === 'blocked' || isAgentSessionCriticallyStale(session, now)) {
        return 'border-rose-200 bg-rose-50/40';
    }
    if (session.status === 'review' || isAgentSessionStale(session, now)) {
        return 'border-amber-200 bg-amber-50/40';
    }
    if (session.status === 'done') {
        return 'border-gray-200 bg-gray-50/70';
    }
    return 'border-gray-200 bg-white';
}

function getFilterCount(filter: AgentSessionFilter, sessions: AgentSession[], now: number): number {
    if (filter === 'all') {
        return sessions.length;
    }
    return filterAgentSessions(sessions, filter, '', now).length;
}

export const AgentWorkspace: React.FC = () => {
    const { user } = useAuth();
    const { error: showError, success: showSuccess, warning: showWarning } = useToast();
    const [sessions, setSessions] = useState<AgentSession[]>(() => loadAgentSessions());
    const [activeFilter, setActiveFilter] = useState<AgentSessionFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [draft, setDraft] = useState<AgentSessionDraft>(() => createEmptyAgentSessionDraft());
    const [storageMode, setStorageMode] = useState<'local' | 'cloud'>('local');
    const [isSyncing, setIsSyncing] = useState(false);

    const deferredQuery = useDeferredValue(searchQuery);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentTime(Date.now());
        }, 60_000);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!user) {
            const localSessions = loadAgentSessions();
            setSessions(localSessions);
            setStorageMode('local');
            setIsSyncing(false);
            return;
        }

        setStorageMode('cloud');
        setIsSyncing(true);

        const unsubscribe = subscribeToAgentSessions(
            user.uid,
            (cloudSessions) => {
                setSessions(cloudSessions);
                saveAgentSessions(cloudSessions);
                setIsSyncing(false);
            },
            (syncError) => {
                console.error('Agent session sync failed:', syncError);
                showError('Sync Error', 'Agent sessions could not be synced right now.');
                setIsSyncing(false);
            }
        );

        void hydrateLocalAgentSessionsToCloud(user.uid)
            .then((importedCount) => {
                if (importedCount > 0) {
                    showSuccess('Sessions Synced', `Imported ${importedCount} local sessions into your account.`);
                }
            })
            .catch((syncError) => {
                console.error('Agent session hydration failed:', syncError);
                showWarning('Local Backup Kept', 'Cloud sync did not import your local sessions.');
            });

        return unsubscribe;
    }, [showError, showSuccess, showWarning, user]);

    const visibleSessions = useMemo(() => {
        const filtered = filterAgentSessions(sessions, activeFilter, deferredQuery, currentTime);
        return sortAgentSessions(filtered, currentTime);
    }, [activeFilter, currentTime, deferredQuery, sessions]);

    const rollup = useMemo(() => getAgentSessionRollup(sessions, currentTime), [currentTime, sessions]);
    const rollupText = useMemo(() => buildAgentSessionRollupText(sessions, currentTime), [currentTime, sessions]);

    const activeCount = sessions.filter((session) => session.status !== 'done').length;
    const blockedCount = sessions.filter((session) => session.status === 'blocked').length;
    const needsInputCount = sessions.filter((session) => session.status === 'review').length;
    const staleCount = sessions.filter((session) => session.status !== 'done' && isAgentSessionStale(session, currentTime)).length;

    const commitSessions = (nextSessions: AgentSession[]): void => {
        const sortedSessions = sortAgentSessions(nextSessions, Date.now());
        setSessions(sortedSessions);
        saveAgentSessions(sortedSessions);
    };

    const persistSession = async (session: AgentSession): Promise<void> => {
        if (!user) {
            const existing = sessions.find((entry) => entry.id === session.id);
            const nextSessions = existing
                ? sessions.map((entry) => entry.id === session.id ? session : entry)
                : [session, ...sessions];
            commitSessions(nextSessions);
            return;
        }

        setIsSyncing(true);
        try {
            await saveAgentSessionToCloud(user.uid, session);
        } catch (saveError) {
            console.error('Failed to save agent session:', saveError);
            showWarning('Saved Locally Only', 'The change could not be synced to Firebase.');
            const existing = sessions.find((entry) => entry.id === session.id);
            const nextSessions = existing
                ? sessions.map((entry) => entry.id === session.id ? session : entry)
                : [session, ...sessions];
            commitSessions(nextSessions);
            setIsSyncing(false);
        }
    };

    const removeSession = async (sessionId: string): Promise<void> => {
        if (!user) {
            commitSessions(sessions.filter((session) => session.id !== sessionId));
            return;
        }

        setIsSyncing(true);
        try {
            await deleteAgentSessionFromCloud(user.uid, sessionId);
        } catch (deleteError) {
            console.error('Failed to delete agent session:', deleteError);
            showWarning('Delete Failed', 'The session could not be deleted from Firebase.');
            setIsSyncing(false);
        }
    };

    const openCreateModal = (): void => {
        setEditingSessionId(null);
        setDraft(createEmptyAgentSessionDraft());
        setIsEditorOpen(true);
    };

    const openEditModal = (session: AgentSession): void => {
        setEditingSessionId(session.id);
        setDraft({
            title: session.title,
            purpose: session.purpose,
            currentTask: session.currentTask,
            lastPrompt: session.lastPrompt,
            status: session.status,
            priority: session.priority,
            lastSummary: session.lastSummary,
            nextAction: session.nextAction,
            blockedBy: session.blockedBy,
            chatReference: session.chatReference,
        });
        setIsEditorOpen(true);
    };

    const closeEditor = (): void => {
        setIsEditorOpen(false);
        setEditingSessionId(null);
        setDraft(createEmptyAgentSessionDraft());
    };

    const updateDraft = <K extends keyof AgentSessionDraft>(field: K, value: AgentSessionDraft[K]): void => {
        setDraft((currentDraft) => ({
            ...currentDraft,
            [field]: value,
        }));
    };

    const handleSave = async (): Promise<void> => {
        const trimmedTitle = draft.title.trim();
        const trimmedPurpose = draft.purpose.trim();
        const trimmedTask = draft.currentTask.trim();
        const trimmedPrompt = draft.lastPrompt.trim();
        const trimmedNextAction = draft.nextAction.trim();

        if (!trimmedPurpose || !trimmedTask || !trimmedNextAction) {
            return;
        }

        const timestamp = new Date().toISOString();
        const existingSession = editingSessionId
            ? sessions.find((session) => session.id === editingSessionId) ?? null
            : null;

        const nextSession: AgentSession = {
            id: existingSession?.id ?? createAgentSessionId(),
            createdAt: existingSession?.createdAt ?? timestamp,
            lastUpdatedAt: timestamp,
            title: trimmedTitle,
            purpose: trimmedPurpose,
            currentTask: trimmedTask,
            lastPrompt: trimmedPrompt,
            status: draft.status,
            priority: draft.priority,
            lastSummary: draft.lastSummary.trim(),
            nextAction: trimmedNextAction,
            blockedBy: draft.blockedBy.trim(),
            chatReference: draft.chatReference.trim(),
        };

        await persistSession(nextSession);
        closeEditor();
    };

    const handleQuickStatusChange = async (sessionId: string, status: AgentSessionStatus): Promise<void> => {
        const session = sessions.find((entry) => entry.id === sessionId);
        if (!session) {
            return;
        }

        await persistSession({
            ...session,
            status,
            lastUpdatedAt: new Date().toISOString(),
        });
    };

    const handleTouchSession = async (sessionId: string): Promise<void> => {
        const session = sessions.find((entry) => entry.id === sessionId);
        if (!session) {
            return;
        }

        await persistSession({
            ...session,
            lastUpdatedAt: new Date().toISOString(),
        });
    };

    const handleDeleteSession = async (sessionId: string): Promise<void> => {
        if (!confirm('Delete this session from the dashboard?')) {
            return;
        }
        await removeSession(sessionId);
        if (editingSessionId === sessionId) {
            closeEditor();
        }
    };

    const handleCopyRollup = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(rollupText);
            showSuccess('Rollup Copied', 'The daily summary was copied to your clipboard.');
        } catch (copyError) {
            console.error('Failed to copy rollup:', copyError);
            showError('Copy Failed', 'Clipboard access was not available.');
        }
    };

    const isSaveDisabled = (
        draft.purpose.trim() === ''
        || draft.currentTask.trim() === ''
        || draft.nextAction.trim() === ''
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto pt-8 h-full overflow-auto px-4 pb-10">
            <div className="mb-8">
                <button
                    onClick={() => { window.location.hash = ''; }}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors mb-3"
                >
                    <ArrowLeft size={14} /> Back to Main
                </button>

                <div className="rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_38%),linear-gradient(135deg,_#ffffff,_#f8fafc)] p-8 shadow-sm">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div className="max-w-3xl">
                            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white">
                                <Bot size={14} />
                                Agent Sessions
                            </div>
                            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Keep every chat session visible in one place.</h2>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                                Track what each agent is doing, what needs your input, and which sessions have gone stale before context falls apart.
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
                                <span className={`rounded-full px-3 py-1 ${
                                    storageMode === 'cloud'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-slate-200 text-slate-700'
                                }`}>
                                    {storageMode === 'cloud' ? 'Cloud Sync Enabled' : 'Local Mode'}
                                </span>
                                {isSyncing && (
                                    <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-700">
                                        Syncing
                                    </span>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={openCreateModal}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                        >
                            <Plus size={16} />
                            New Session
                        </button>
                    </div>

                    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-gray-200 bg-white/80 p-4">
                            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Active Sessions</div>
                            <div className="mt-2 text-3xl font-bold text-slate-900">{activeCount}</div>
                            <p className="mt-1 text-sm text-gray-500">Everything not marked done.</p>
                        </div>
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4">
                            <div className="text-xs font-bold uppercase tracking-wider text-rose-500">Blocked</div>
                            <div className="mt-2 text-3xl font-bold text-rose-700">{blockedCount}</div>
                            <p className="mt-1 text-sm text-rose-600">Sessions waiting on a dependency.</p>
                        </div>
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                            <div className="text-xs font-bold uppercase tracking-wider text-amber-500">Needs Input</div>
                            <div className="mt-2 text-3xl font-bold text-amber-700">{needsInputCount}</div>
                            <p className="mt-1 text-sm text-amber-700">Chats that need a decision or review from you.</p>
                        </div>
                        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
                            <div className="text-xs font-bold uppercase tracking-wider text-sky-500">Stale</div>
                            <div className="mt-2 text-3xl font-bold text-sky-700">{staleCount}</div>
                            <p className="mt-1 text-sm text-sky-700">No meaningful update for at least 24 hours.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full xl:max-w-md">
                        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search title, prompt, task, next action, blocker, or chat ref"
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400 focus:bg-white"
                        />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {FILTER_ORDER.map((filter) => {
                            const count = getFilterCount(filter, sessions, currentTime);
                            const isActive = activeFilter === filter;
                            return (
                                <button
                                    key={filter}
                                    onClick={() => setActiveFilter(filter)}
                                    className={`rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
                                        isActive
                                            ? 'border-slate-900 bg-slate-900 text-white'
                                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                    }`}
                                >
                                    {FILTER_LABELS[filter]} <span className="ml-1 opacity-80">{count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 text-xs font-medium text-gray-500">
                    <span>Workflow: `Active` for work in progress, `Needs Input` when you owe the next move, `Waiting` when the session is parked, `Blocked` when it cannot proceed.</span>
                    <span>Stale threshold: 24h warning, 48h critical.</span>
                </div>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-widest text-gray-400">Daily Rollup</div>
                            <h3 className="mt-2 text-xl font-bold text-slate-900">What needs attention today</h3>
                            <p className="mt-2 text-sm leading-6 text-gray-500">
                                This is generated from your current session registry and updates automatically as statuses change.
                            </p>
                        </div>
                        <button
                            onClick={() => { void handleCopyRollup(); }}
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-600 transition-colors hover:border-gray-300 hover:text-slate-900"
                        >
                            <Copy size={14} />
                            Copy
                        </button>
                    </div>

                    <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                        {rollupText}
                    </pre>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-400">Priority Focus</div>
                    <div className="mt-4 space-y-3">
                        {rollup.priorityFocus.length === 0 ? (
                            <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
                                No active sessions yet.
                            </div>
                        ) : (
                            rollup.priorityFocus.map((session) => (
                                <div key={session.id} className="rounded-2xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="font-bold text-slate-900">{getAgentSessionDisplayTitle(session)}</div>
                                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${getStatusClasses(session.status)}`}>
                                            {STATUS_LABELS[session.status]}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-gray-600">{session.nextAction}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {visibleSessions.length === 0 ? (
                <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white px-6 py-16 text-center shadow-sm">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                        <Bot size={28} />
                    </div>
                    <h3 className="mt-5 text-2xl font-bold text-slate-900">No sessions in this view.</h3>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-gray-500">
                        Start by adding each active chat session with the latest prompt, a clear purpose, the current task, and the next action you expect.
                    </p>
                    <button
                        onClick={openCreateModal}
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
                    >
                        <Plus size={16} />
                        Add First Session
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {visibleSessions.map((session) => {
                        const ageHours = getAgentSessionAgeHours(session, currentTime);
                        const stale = session.status !== 'done' && isAgentSessionStale(session, currentTime);
                        const criticallyStale = session.status !== 'done' && isAgentSessionCriticallyStale(session, currentTime);
                        const displayTitle = getAgentSessionDisplayTitle(session);
                        const promptPreview = getAgentSessionPromptPreview(session);
                        const hasManualTitle = session.title.trim().length > 0;

                        return (
                            <div
                                key={session.id}
                                className={`rounded-3xl border p-5 shadow-sm transition-shadow hover:shadow-md ${getCardTone(session, currentTime)}`}
                            >
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-xl font-bold text-slate-900">{displayTitle}</h3>
                                                {!hasManualTitle && (
                                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                                                        Auto title
                                                    </span>
                                                )}
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${getStatusClasses(session.status)}`}>
                                                    {STATUS_LABELS[session.status]}
                                                </span>
                                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${getPriorityClasses(session.priority)}`}>
                                                    {PRIORITY_LABELS[session.priority]}
                                                </span>
                                                {criticallyStale && (
                                                    <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                                                        48h stale
                                                    </span>
                                                )}
                                                {!criticallyStale && stale && (
                                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                                                        24h stale
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-2 text-sm leading-6 text-gray-600">{session.purpose}</p>
                                        </div>

                                        <div className="flex flex-wrap gap-2 lg:justify-end">
                                            <button
                                                onClick={() => { void handleTouchSession(session.id); }}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                                            >
                                                <RefreshCw size={13} />
                                                Touch
                                            </button>
                                            <button
                                                onClick={() => openEditModal(session)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                                            >
                                                <Pencil size={13} />
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => { void handleDeleteSession(session.id); }}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50"
                                            >
                                                <Trash2 size={13} />
                                                Delete
                                            </button>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-slate-100">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Latest Prompt</div>
                                        <p className="mt-2 text-sm leading-6 text-slate-100">{promptPreview}</p>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <div className="rounded-2xl bg-white/80 p-4">
                                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Current Task</div>
                                            <p className="mt-2 text-sm text-slate-700">{session.currentTask}</p>
                                        </div>
                                        <div className="rounded-2xl bg-white/80 p-4">
                                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Next Action</div>
                                            <p className="mt-2 text-sm text-slate-700">{session.nextAction}</p>
                                        </div>
                                    </div>

                                    {session.lastSummary && (
                                        <div className="rounded-2xl bg-white/80 p-4">
                                            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Latest Summary</div>
                                            <p className="mt-2 text-sm leading-6 text-slate-700">{session.lastSummary}</p>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                                        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                            <span className="inline-flex items-center gap-1.5">
                                                <Clock3 size={13} />
                                                {formatRelativeUpdate(ageHours)} ({formatTimestamp(session.lastUpdatedAt)})
                                            </span>
                                            {session.chatReference && (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <Link2 size={13} />
                                                    {session.chatReference}
                                                </span>
                                            )}
                                            {session.blockedBy && (
                                                <span className={`inline-flex items-center gap-1.5 ${
                                                    session.status === 'blocked' ? 'text-rose-600' : 'text-gray-500'
                                                }`}>
                                                    <AlertTriangle size={13} />
                                                    {session.blockedBy}
                                                </span>
                                            )}
                                        </div>

                                        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                                            Status
                                            <select
                                                value={session.status}
                                                onChange={(event) => { void handleQuickStatusChange(session.id, event.target.value as AgentSessionStatus); }}
                                                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 outline-none focus:border-slate-400"
                                            >
                                                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                                    <option key={value} value={value}>{label}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Modal isOpen={isEditorOpen} onClose={closeEditor} size="xl" zIndex="high">
                <Modal.Header>{editingSessionId ? 'Edit Session' : 'New Session'}</Modal.Header>
                <Modal.Body className="bg-gray-50">
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Session Title (Optional)</span>
                            <input
                                value={draft.title}
                                onChange={(event) => updateDraft('title', event.target.value)}
                                placeholder="Leave blank to auto-name from the latest prompt"
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                            <span className="mt-2 block text-xs leading-5 text-gray-500">
                                If you leave this empty, the session card title is generated automatically from the latest prompt or task.
                            </span>
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Chat Link or Session ID</span>
                            <input
                                value={draft.chatReference}
                                onChange={(event) => updateDraft('chatReference', event.target.value)}
                                placeholder="paste URL or internal session reference"
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>

                        <label className="block md:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Latest Prompt</span>
                            <textarea
                                value={draft.lastPrompt}
                                onChange={(event) => updateDraft('lastPrompt', event.target.value)}
                                rows={3}
                                placeholder="Paste the latest request you sent to that chat."
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>

                        <label className="block md:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Purpose</span>
                            <textarea
                                value={draft.purpose}
                                onChange={(event) => updateDraft('purpose', event.target.value)}
                                rows={3}
                                placeholder="Why this session exists and what outcome it owns."
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>

                        <label className="block md:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Current Task</span>
                            <textarea
                                value={draft.currentTask}
                                onChange={(event) => updateDraft('currentTask', event.target.value)}
                                rows={3}
                                placeholder="What the agent is working on right now."
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Status</span>
                            <select
                                value={draft.status}
                                onChange={(event) => updateDraft('status', event.target.value as AgentSessionStatus)}
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            >
                                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Priority</span>
                            <select
                                value={draft.priority}
                                onChange={(event) => updateDraft('priority', event.target.value as AgentSessionPriority)}
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            >
                                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="block md:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Latest Summary</span>
                            <textarea
                                value={draft.lastSummary}
                                onChange={(event) => updateDraft('lastSummary', event.target.value)}
                                rows={3}
                                placeholder="Short note about the latest meaningful update."
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>

                        <label className="block md:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Next Action</span>
                            <textarea
                                value={draft.nextAction}
                                onChange={(event) => updateDraft('nextAction', event.target.value)}
                                rows={3}
                                placeholder="What should happen next."
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>

                        <label className="block md:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-gray-700">Blocked By</span>
                            <input
                                value={draft.blockedBy}
                                onChange={(event) => updateDraft('blockedBy', event.target.value)}
                                placeholder="Optional dependency, decision, or missing input"
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400"
                            />
                        </label>
                    </div>
                </Modal.Body>
                <Modal.Footer className="bg-white">
                    <button
                        onClick={closeEditor}
                        className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => { void handleSave(); }}
                        disabled={isSaveDisabled}
                        className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                            isSaveDisabled
                                ? 'cursor-not-allowed bg-gray-200 text-gray-400'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                    >
                        {editingSessionId ? 'Save Changes' : 'Create Session'}
                    </button>
                </Modal.Footer>
            </Modal>

            {sessions.length > 0 && (
                <div className="mt-6 flex items-center gap-2 text-xs text-gray-400">
                    <CheckCircle2 size={13} />
                    {storageMode === 'cloud'
                        ? 'Signed-in mode is syncing this dashboard with Firebase and keeping a local browser backup.'
                        : 'Guest mode is storing this dashboard in local browser storage only.'}
                </div>
            )}
        </div>
    );
};
