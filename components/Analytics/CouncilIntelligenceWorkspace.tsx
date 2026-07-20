import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    ArrowLeft,
    Banknote,
    CalendarDays,
    CheckCircle2,
    ClipboardList,
    ExternalLink,
    FileSearch,
    Landmark,
    Loader2,
    RefreshCw,
    Search,
    ShieldCheck,
    UserRound,
    UsersRound,
} from 'lucide-react';
import {
    getCouncilIntelligenceWorkspace,
    refreshCouncilIntelligence,
} from '../../utils/council/councilIntelligenceService';
import type {
    CouncilIntelligenceWorkspaceData,
    CouncilEvidenceConfidence,
    CouncilMeetingListItem,
    CouncilProfileListItem,
    CouncilRegisterListItem,
} from '../../utils/council/councilIntelligenceService';

export type {
    CouncilIntelligenceWorkspaceData,
    CouncilEvidenceConfidence,
    CouncilMeetingListItem,
    CouncilProfileListItem,
    CouncilRegisterListItem,
} from '../../utils/council/councilIntelligenceService';

type Confidence = CouncilEvidenceConfidence;
type TabId = 'overview' | 'meetings' | 'councillors' | 'registers';

type CouncilMeetingSummary = CouncilMeetingListItem;
type CouncilCouncillorSummary = CouncilProfileListItem;
type CouncilRegisterEntry = CouncilRegisterListItem;

export interface CouncilIntelligenceWorkspaceProps {
    teamId: string;
    userId: string | null;
    canRefresh: boolean;
    onBack?: () => void;
}

const TABS: Array<{ id: TabId; label: string; icon: React.FC<{ size?: number; className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: Landmark },
    { id: 'meetings', label: 'Meetings', icon: CalendarDays },
    { id: 'councillors', label: 'Councillors', icon: UsersRound },
    { id: 'registers', label: 'Registers', icon: ClipboardList },
];

const CONFIDENCE_STYLES: Record<Confidence, string> = {
    high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    medium: 'border-amber-200 bg-amber-50 text-amber-700',
    low: 'border-orange-200 bg-orange-50 text-orange-700',
    none: 'border-gray-200 bg-gray-50 text-gray-600',
};

const REGISTER_LABELS: Record<CouncilRegisterEntry['type'], string> = {
    action: 'Action',
    decision: 'Decision',
    deadline: 'Deadline',
    funding: 'Funding',
};

const normalizeConfidence = (confidence?: Confidence): Confidence => confidence ?? 'none';

const formatDate = (value?: string, includeTime = false): string => {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'medium',
        ...(includeTime ? { timeStyle: 'short' as const } : {}),
    }).format(date);
};

const safeSourceUrl = (value?: string): string | null => {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (
            url.hostname === 'pub-barrie.escribemeetings.com'
            || url.hostname === 'www.barrie.ca'
        ) ? url.toString() : null;
    } catch {
        return null;
    }
};

const matchesQuery = (values: Array<string | number | undefined>, query: string): boolean => (
    !query || values.some(value => String(value ?? '').toLocaleLowerCase().includes(query))
);

const ConfidenceBadge: React.FC<{ confidence?: Confidence }> = ({ confidence }) => {
    const normalized = normalizeConfidence(confidence);
    const label = normalized === 'none'
        ? 'Insufficient evidence'
        : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} confidence`;
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CONFIDENCE_STYLES[normalized]}`}>
            {label}
        </span>
    );
};

const SourceLink: React.FC<{ url?: string; label?: string }> = ({ url, label = 'Official source' }) => {
    const safeUrl = safeSourceUrl(url);
    if (!safeUrl) return null;
    return (
        <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 hover:text-cyan-900"
        >
            {label}
            <ExternalLink size={12} aria-hidden="true" />
        </a>
    );
};

const EmptyState: React.FC<{ title: string; message: string }> = ({ title, message }) => (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
        <FileSearch className="mx-auto mb-3 text-gray-300" size={36} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="mx-auto mt-1 max-w-lg text-sm text-gray-500">{message}</p>
    </div>
);

const MetricCard: React.FC<{
    label: string;
    value: string | number;
    detail: string;
    icon: React.ReactNode;
}> = ({ label, value, detail, icon }) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-gray-600">{label}</p>
            <span className="rounded-lg bg-gray-100 p-2 text-gray-600">{icon}</span>
        </div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
);

export const CouncilIntelligenceWorkspace: React.FC<CouncilIntelligenceWorkspaceProps> = ({ teamId, userId, canRefresh, onBack }) => {
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [query, setQuery] = useState('');
    const [data, setData] = useState<CouncilIntelligenceWorkspaceData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadWorkspace = useCallback(async () => {
        if (!teamId) {
            setData(null);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const result = await getCouncilIntelligenceWorkspace(teamId);
            setData(result);
        } catch (loadError) {
            console.error('Unable to load Council Intelligence workspace:', loadError);
            setError('Council Intelligence could not be loaded. Check your access and try again.');
        } finally {
            setIsLoading(false);
        }
    }, [teamId]);

    useEffect(() => {
        void loadWorkspace();
    }, [loadWorkspace]);

    const handleRefresh = async () => {
        if (!teamId || !userId || isRefreshing) return;
        setIsRefreshing(true);
        setError(null);
        try {
            const result = await refreshCouncilIntelligence(teamId, userId);
            setData(result);
        } catch (refreshError) {
            console.error('Unable to refresh Council Intelligence:', refreshError);
            setError('The source refresh could not be started. Check your access and try again.');
        } finally {
            setIsRefreshing(false);
        }
    };

    const normalizedQuery = query.trim().toLocaleLowerCase();
    const meetings = useMemo(() => (data?.meetings ?? []).filter(meeting => matchesQuery([
        meeting.title,
        meeting.body,
        meeting.summary,
        meeting.status,
        ...(meeting.topics ?? []),
    ], normalizedQuery)), [data?.meetings, normalizedQuery]);
    const councillors = useMemo(() => (data?.councillors ?? []).filter(councillor => matchesQuery([
        councillor.name,
        councillor.role,
        councillor.ward,
        councillor.latestPosition,
    ], normalizedQuery)), [data?.councillors, normalizedQuery]);
    const registers = useMemo(() => (data?.registers ?? []).filter(entry => matchesQuery([
        entry.title,
        entry.meetingTitle,
        entry.owner,
        entry.status,
        entry.amount,
        REGISTER_LABELS[entry.type],
    ], normalizedQuery)), [data?.registers, normalizedQuery]);

    const latestMeeting = useMemo(() => [...(data?.meetings ?? [])].sort((a, b) => (
        new Date(b.date).getTime() - new Date(a.date).getTime()
    ))[0], [data?.meetings]);
    const openActions = (data?.registers ?? []).filter(entry => (
        (entry.type === 'action' || entry.type === 'deadline') && entry.status?.toLocaleLowerCase() !== 'complete'
    ));
    const fundingEntries = (data?.registers ?? []).filter(entry => entry.type === 'funding');
    const sourceStatus = data?.sourceHealth?.status ?? 'idle';
    const hasAnyData = Boolean(data && (data.meetings.length || data.councillors.length || data.registers.length));

    if (isLoading) {
        return (
            <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-gray-200 bg-white" role="status">
                <div className="text-center">
                    <Loader2 className="mx-auto mb-3 animate-spin text-cyan-600" size={30} aria-hidden="true" />
                    <p className="text-sm font-semibold text-gray-800">Loading Council Intelligence</p>
                    <p className="mt-1 text-xs text-gray-500">Retrieving team-scoped official records</p>
                </div>
            </div>
        );
    }

    if (!teamId) {
        return (
            <EmptyState
                title="No team selected"
                message="Choose a team before opening Council Intelligence. Council records are isolated by team."
            />
        );
    }

    return (
        <div className="space-y-5">
            <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="flex items-start gap-3">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                            aria-label="Back to Planning Data"
                        >
                            <ArrowLeft size={20} aria-hidden="true" />
                        </button>
                    )}
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl font-bold text-gray-900">Council Intelligence</h1>
                            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cyan-700">
                                90-day pilot
                            </span>
                        </div>
                        <p className="mt-1 max-w-3xl text-sm text-gray-500">
                            Searchable, evidence-linked Council and committee records with a transit-first view.
                            Provisional analysis never replaces the official record.
                        </p>
                    </div>
                </div>
                {canRefresh && <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={!userId || isRefreshing}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
                    {isRefreshing ? 'Refreshing…' : 'Refresh sources'}
                </button>}
            </header>

            <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 shrink-0 text-gray-500" size={17} aria-hidden="true" />
                    <p>
                        Pilot source window: <span className="font-semibold text-gray-800">{formatDate(data?.pilot?.windowStart)}</span>
                        {' to '}
                        <span className="font-semibold text-gray-800">{formatDate(data?.pilot?.windowEnd)}</span>.
                        {' '}Only official {data?.pilot?.sourceLabel ?? 'Barrie eScribe'} evidence is represented.
                    </p>
                </div>
                <div className="shrink-0 text-xs text-gray-500">
                    Last sync: {formatDate(data?.pilot.lastSyncedAt ?? undefined, true)}
                </div>
            </div>

            {error && (
                <div className="flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
                    <div className="flex gap-2">
                        <AlertCircle className="mt-0.5 shrink-0 text-red-600" size={18} aria-hidden="true" />
                        <div>
                            <p className="text-sm font-semibold text-red-800">Council data is not current</p>
                            <p className="mt-0.5 text-sm text-red-700">{error}</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => void loadWorkspace()} className="text-xs font-semibold text-red-700 hover:text-red-900">
                        Retry
                    </button>
                </div>
            )}

            <div className="border-b border-gray-200">
                <div className="flex overflow-x-auto" role="tablist" aria-label="Council Intelligence sections">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const selected = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setActiveTab(tab.id)}
                                className={`relative flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-semibold transition-colors ${selected ? 'text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
                            >
                                <Icon size={16} aria-hidden="true" />
                                {tab.label}
                                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-cyan-500" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeTab !== 'overview' && (
                <label className="relative block max-w-xl">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} aria-hidden="true" />
                    <span className="sr-only">Search {activeTab}</span>
                    <input
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={`Search ${activeTab}…`}
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    />
                </label>
            )}

            {!hasAnyData ? (
                <EmptyState
                    title="No Council records have been indexed"
                    message="Run Refresh sources after the pilot ingestion service is configured. This workspace does not substitute sample data for official records."
                />
            ) : activeTab === 'overview' ? (
                <OverviewPanel
                    data={data}
                    latestMeeting={latestMeeting}
                    openActions={openActions}
                    fundingEntries={fundingEntries}
                    sourceStatus={sourceStatus}
                    onNavigate={setActiveTab}
                />
            ) : activeTab === 'meetings' ? (
                <MeetingsPanel meetings={meetings} query={query} />
            ) : activeTab === 'councillors' ? (
                <CouncillorsPanel councillors={councillors} query={query} />
            ) : (
                <RegistersPanel entries={registers} query={query} />
            )}
        </div>
    );
};

const OverviewPanel: React.FC<{
    data: CouncilIntelligenceWorkspaceData;
    latestMeeting?: CouncilMeetingSummary;
    openActions: CouncilRegisterEntry[];
    fundingEntries: CouncilRegisterEntry[];
    sourceStatus: 'idle' | 'healthy' | 'partial' | 'error';
    onNavigate: (tab: TabId) => void;
}> = ({ data, latestMeeting, openActions, fundingEntries, sourceStatus, onNavigate }) => (
    <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Meetings indexed" value={data.meetings.length} detail="Council and committee records" icon={<CalendarDays size={18} />} />
            <MetricCard label="Councillors" value={data.councillors.length} detail="Searchable current-term profiles" icon={<UsersRound size={18} />} />
            <MetricCard label="Open actions" value={openActions.length} detail="Actions and report-back deadlines" icon={<ClipboardList size={18} />} />
            <MetricCard label="Funding entries" value={fundingEntries.length} detail="Official transit commitments" icon={<Banknote size={18} />} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-bold text-gray-900">Latest processed meeting</h2>
                        <p className="text-xs text-gray-500">Official-record summary; review source evidence for decisions</p>
                    </div>
                    <button type="button" onClick={() => onNavigate('meetings')} className="text-xs font-semibold text-cyan-700 hover:text-cyan-900">
                        View meetings
                    </button>
                </div>
                {latestMeeting ? (
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-gray-900">{latestMeeting.title}</h3>
                            <ConfidenceBadge confidence={latestMeeting.confidence} />
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Council record · {formatDate(latestMeeting.date)}</p>
                        <p className="mt-3 text-sm leading-6 text-gray-600">{latestMeeting.summary || 'No summary is available for this meeting.'}</p>
                        <div className="mt-3"><SourceLink url={latestMeeting.sourceUrl} /></div>
                    </div>
                ) : <p className="text-sm text-gray-500">No processed meeting is available.</p>}
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="font-bold text-gray-900">Source health</h2>
                <div className="mt-4 flex items-center gap-3">
                    {sourceStatus === 'healthy'
                        ? <CheckCircle2 className="text-emerald-600" size={24} />
                        : <AlertCircle className={sourceStatus === 'partial' ? 'text-amber-600' : sourceStatus === 'error' ? 'text-red-600' : 'text-gray-400'} size={24} />}
                    <div>
                        <p className="text-sm font-semibold capitalize text-gray-800">{sourceStatus}</p>
                        <p className="text-xs text-gray-500">{data.sourceHealth?.extractionGaps ?? 0} extraction gaps</p>
                    </div>
                </div>
                <p className="mt-4 text-xs leading-5 text-gray-500">
                    Missing or scanned documents remain visible as gaps; the pilot does not guess at unavailable text.
                </p>
            </section>
        </div>
    </div>
);

const MeetingsPanel: React.FC<{ meetings: CouncilMeetingSummary[]; query: string }> = ({ meetings, query }) => {
    if (!meetings.length) return <EmptyState title="No matching meetings" message={query ? 'Try a broader keyword or committee name.' : 'No meeting records are available.'} />;
    return (
        <div className="space-y-3">
            {meetings.map(meeting => (
                <article key={meeting.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="font-bold text-gray-900">{meeting.title}</h2>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">Council record · {formatDate(meeting.date)} · {meeting.status}</p>
                        </div>
                        <ConfidenceBadge confidence={meeting.confidence} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-gray-600">{meeting.summary || 'No processed summary is available.'}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {(meeting.topics ?? []).map(topic => <span key={topic} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">{topic}</span>)}
                    </div>
                    <div className="mt-4"><SourceLink url={meeting.sourceUrl} /></div>
                </article>
            ))}
        </div>
    );
};

const CouncillorsPanel: React.FC<{ councillors: CouncilCouncillorSummary[]; query: string }> = ({ councillors, query }) => {
    if (!councillors.length) return <EmptyState title="No matching councillors" message={query ? 'Try a name, ward, role, or position term.' : 'No current-term councillor profiles are available.'} />;
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {councillors.map(councillor => (
                <article key={councillor.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                        <span className="rounded-lg bg-gray-100 p-2 text-gray-600"><UserRound size={20} aria-hidden="true" /></span>
                        <div className="min-w-0 flex-1">
                            <h2 className="font-bold text-gray-900">{councillor.name}</h2>
                            <p className="text-xs text-gray-500">{[councillor.role, councillor.ward].filter(Boolean).join(' · ') || 'Current-term profile'}</p>
                        </div>
                        <ConfidenceBadge confidence={councillor.confidence} />
                    </div>
                    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500">Provisional position</span>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-gray-600">{councillor.latestPosition || 'No evidence-backed position summary is available.'}</p>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                        {[
                            ['Meetings', councillor.meetingCount],
                            ['Named votes', councillor.voteCount],
                            ['Positions', councillor.positionCount],
                        ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-lg bg-gray-50 px-2 py-2">
                                <dt className="text-[10px] text-gray-500">{label}</dt>
                                <dd className="mt-0.5 text-sm font-bold text-gray-800">{value ?? 0}</dd>
                            </div>
                        ))}
                    </dl>
                    <div className="mt-4"><SourceLink url={councillor.sourceUrl} label="Profile evidence" /></div>
                </article>
            ))}
        </div>
    );
};

const RegistersPanel: React.FC<{ entries: CouncilRegisterEntry[]; query: string }> = ({ entries, query }) => {
    if (!entries.length) return <EmptyState title="No matching register entries" message={query ? 'Try an action owner, meeting, status, decision, or funding term.' : 'No action, decision, deadline, or funding entries are available.'} />;
    return (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Entry</th>
                            <th className="px-4 py-3">Owner / status</th>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Evidence</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {entries.map(entry => (
                            <tr key={entry.id} className="align-top hover:bg-gray-50/70">
                                <td className="whitespace-nowrap px-4 py-4"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">{REGISTER_LABELS[entry.type]}</span></td>
                                <td className="min-w-[280px] px-4 py-4">
                                    <p className="font-semibold text-gray-900">{entry.title}</p>
                                    {entry.meetingTitle && <p className="mt-1 text-xs leading-5 text-gray-500">{entry.meetingTitle}</p>}
                                    {entry.amount && <p className="mt-1 text-xs font-semibold text-emerald-700">{entry.amount}</p>}
                                </td>
                                <td className="whitespace-nowrap px-4 py-4 text-xs text-gray-600">
                                    <p>{entry.owner ?? 'Not assigned'}</p>
                                    <p className="mt-1 font-semibold text-gray-700">{entry.status ?? 'Not stated'}</p>
                                </td>
                                <td className="whitespace-nowrap px-4 py-4 text-xs text-gray-600">{formatDate(entry.date)}</td>
                                <td className="whitespace-nowrap px-4 py-4">
                                    <ConfidenceBadge confidence={entry.confidence} />
                                    <div className="mt-2"><SourceLink url={entry.sourceUrl} /></div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CouncilIntelligenceWorkspace;
