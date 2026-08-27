import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    BadgeCheck,
    Blocks,
    BriefcaseBusiness,
    CheckCircle2,
    ChevronRight,
    ClipboardCheck,
    Download,
    FileJson,
    FileSpreadsheet,
    Loader2,
    RefreshCw,
    Save,
    Scissors,
    ShieldCheck,
    Upload,
    Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import type { DayType, MasterScheduleEntry, RouteIdentity } from '../../utils/masterScheduleTypes';
import {
    getAllMasterSchedules,
    getMasterSchedule,
    getVersionContent,
} from '../../utils/services/masterScheduleService';
import {
    approveOperationsPlanningScenario,
    createOperationsPlanningScenario,
    getOperationsPlanningScenario,
    listOperationsPlanningScenarios,
    loadOperationsPlanningScenarioRevision,
    saveOperationsPlanningRevision,
    submitOperationsPlanningScenario,
    type OperationsPlanningRevisionPayload,
    type OperationsPlanningScenarioMetadata,
} from '../../utils/services/operationsPlanningService';
import {
    assessOperationsPlanningProposal,
    assessSourceFreshness,
    assignDailyRunToCrew,
    buildOperationsPlanningInput,
    downloadJson,
    downloadOperationsPlanningWorkbook,
    mergeDailyRuns,
    moveRunPiece,
    renumberDailyRun,
    splitDailyRun,
    type DailyRun,
    type OperationsPlanningInputV1,
    type PinnedMasterSchedule,
    type ProposalAssessment,
    type ValidationFinding,
} from '../../utils/run-cutting';

const DAY_TYPES: DayType[] = ['Weekday', 'Saturday', 'Sunday'];
const MAX_PROPOSAL_FILE_BYTES = 10 * 1024 * 1024;

type WorkspaceTab = 'overview' | 'blocks' | 'runs' | 'rosters' | 'rules';

const TABS: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <BriefcaseBusiness size={16} /> },
    { id: 'blocks', label: 'Block Audit', icon: <Blocks size={16} /> },
    { id: 'runs', label: 'Daily Runs', icon: <Scissors size={16} /> },
    { id: 'rosters', label: 'Weekly Rosters', icon: <Users size={16} /> },
    { id: 'rules', label: 'Rules & Findings', icon: <ClipboardCheck size={16} /> },
];

export const validateOperationsPlanningProposalFile = (file: File): string | null => {
    if (!file.name.toLowerCase().endsWith('.json')) return 'Choose a .json proposal file.';
    if (file.size <= 0) return 'The proposal file is empty.';
    if (file.size > MAX_PROPOSAL_FILE_BYTES) return 'The proposal file exceeds the 10 MB limit.';
    if (file.type && !['application/json', 'text/json', 'text/plain'].includes(file.type)) {
        return 'The proposal must be a JSON file.';
    }
    return null;
};

const formatMinutes = (minutes: number | null | undefined): string => {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
    const sign = minutes < 0 ? '-' : '';
    const absolute = Math.abs(Math.round(minutes));
    return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`;
};

const formatCrewNumber = (value: string): string => /^crew\b/i.test(value.trim()) ? value.trim() : `Crew ${value.trim()}`;

const findingTone = (finding: ValidationFinding): string => {
    if (finding.severity === 'error') return 'border-red-200 bg-red-50 text-red-800';
    if (finding.severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
    return 'border-gray-200 bg-gray-50 text-gray-700';
};

const sourceEntryFromManifest = (
    item: OperationsPlanningRevisionPayload['sourceManifest']['items'][number],
    current: MasterScheduleEntry | undefined,
    content: NonNullable<Awaited<ReturnType<typeof getVersionContent>>>,
): MasterScheduleEntry => ({
    ...(current ?? {
        id: item.routeIdentity,
        routeNumber: item.routeNumber,
        dayType: item.dayType,
        tripCount: content.northTable.trips.length + content.southTable.trips.length,
        northStopCount: content.northTable.stops.length,
        southStopCount: content.southTable.stops.length,
        updatedAt: new Date(item.pinnedAt),
        updatedBy: '',
        uploaderName: 'Pinned Master Schedule',
        source: 'draft' as const,
    }),
    id: item.routeIdentity,
    routeNumber: item.routeNumber,
    dayType: item.dayType,
    currentVersion: item.version,
    storagePath: item.storagePath,
});

const SummaryCard: React.FC<{
    label: string;
    value: React.ReactNode;
    detail: string;
    tone?: 'neutral' | 'success' | 'warning' | 'danger';
}> = ({ label, value, detail, tone = 'neutral' }) => {
    const tones = {
        neutral: 'border-gray-200 bg-white',
        success: 'border-emerald-200 bg-emerald-50/50',
        warning: 'border-amber-200 bg-amber-50/50',
        danger: 'border-red-200 bg-red-50/50',
    };
    return (
        <div className={`rounded-xl border p-4 ${tones[tone]}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
            <p className="mt-1 text-xs text-gray-500">{detail}</p>
        </div>
    );
};

export const RunCuttingWorkspace: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { user } = useAuth();
    const { team, canManageTeam, developerPreview } = useTeam();
    const toast = useToast();
    const proposalFileRef = useRef<HTMLInputElement>(null);
    const [tab, setTab] = useState<WorkspaceTab>('overview');
    const [masters, setMasters] = useState<MasterScheduleEntry[]>([]);
    const [scenarios, setScenarios] = useState<OperationsPlanningScenarioMetadata[]>([]);
    const [metadata, setMetadata] = useState<OperationsPlanningScenarioMetadata | null>(null);
    const [payload, setPayload] = useState<OperationsPlanningRevisionPayload | null>(null);
    const [planningInput, setPlanningInput] = useState<OperationsPlanningInputV1 | null>(null);
    const [assessment, setAssessment] = useState<ProposalAssessment | null>(null);
    const [selectedMasterIds, setSelectedMasterIds] = useState<Set<string>>(new Set());
    const [selectedDayTypes, setSelectedDayTypes] = useState<Set<DayType>>(new Set(['Sunday']));
    const [scenarioName, setScenarioName] = useState('Sunday service run cut');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sourceIsStale, setSourceIsStale] = useState(false);
    const [hasUnsavedAssessment, setHasUnsavedAssessment] = useState(false);
    const sourceTeamId = team?.dataSourceTeamIds?.masterSchedules ?? team?.id ?? '';
    const isReadOnly = metadata?.status === 'approved';

    const refreshLibrary = useCallback(async () => {
        if (!team || !sourceTeamId) return;
        setBusy('library');
        setError(null);
        try {
            const [nextMasters, nextScenarios] = await Promise.all([
                getAllMasterSchedules(sourceTeamId),
                listOperationsPlanningScenarios(team.id),
            ]);
            setMasters(nextMasters);
            setScenarios(nextScenarios);
            setSelectedMasterIds(current => {
                if (current.size > 0) return current;
                const sunday = nextMasters.filter(entry => entry.dayType === 'Sunday').map(entry => entry.id);
                return new Set(sunday.length > 0 ? sunday : nextMasters.map(entry => entry.id));
            });
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Unable to load run-cutting data.';
            setError(message);
            toast?.error('Unable to load', message);
        } finally {
            setBusy(null);
        }
    }, [sourceTeamId, team, toast]);

    useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

    const rebuildInputFromPayload = useCallback(async (
        nextMetadata: OperationsPlanningScenarioMetadata,
        nextPayload: OperationsPlanningRevisionPayload,
    ) => {
        const currentEntries = await getAllMasterSchedules(sourceTeamId);
        const currentById = new Map(currentEntries.map(entry => [entry.id, entry]));
        const pins = await Promise.all(nextPayload.sourceManifest.items.map(async item => {
            const content = await getVersionContent(item.sourceTeamId, item.routeIdentity, item.version);
            if (!content) throw new Error(`Pinned Master Schedule ${item.routeIdentity} v${item.version} is unavailable.`);
            return {
                sourceTeamId: item.sourceTeamId,
                entry: sourceEntryFromManifest(item, currentById.get(item.routeIdentity), content),
                content,
                pinnedAt: item.pinnedAt,
            } satisfies PinnedMasterSchedule;
        }));
        const nextInput = buildOperationsPlanningInput({
            scenarioId: nextMetadata.id,
            scenarioName: nextPayload.name,
            exportedAt: new Date().toISOString(),
            pinnedSchedules: pins,
            ruleProfile: nextPayload.ruleProfile,
            operationsMatrix: nextPayload.operationsMatrix,
        });
        if (nextInput.sourceManifest.fingerprint !== nextPayload.sourceManifest.fingerprint) {
            throw new Error('Pinned Master Schedule content no longer matches the saved scenario manifest.');
        }
        const currentVersions = Object.fromEntries(currentEntries.map(entry => [entry.id, entry.currentVersion]));
        const stale = assessSourceFreshness(nextPayload.sourceManifest, currentVersions).length > 0;
        setMetadata(nextMetadata);
        setPayload(nextPayload);
        setPlanningInput(nextInput);
        setAssessment(nextPayload.assessment);
        setHasUnsavedAssessment(stale !== nextPayload.validation.sourceIsStale);
        setSourceIsStale(stale);
    }, [sourceTeamId]);

    const openScenario = useCallback(async (scenario: OperationsPlanningScenarioMetadata) => {
        setBusy('open');
        setError(null);
        try {
            const latest = await getOperationsPlanningScenario(scenario.teamId, scenario.id);
            if (!latest) throw new Error('This scenario no longer exists.');
            const nextPayload = await loadOperationsPlanningScenarioRevision(latest);
            await rebuildInputFromPayload(latest, nextPayload);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Unable to open the scenario.';
            setError(message);
            toast?.error('Unable to open scenario', message);
        } finally {
            setBusy(null);
        }
    }, [rebuildInputFromPayload, toast]);

    const filteredMasters = useMemo(
        () => masters.filter(entry => selectedDayTypes.has(entry.dayType)),
        [masters, selectedDayTypes],
    );

    const createScenario = async () => {
        if (!team || !user) return;
        const selected = masters.filter(entry => selectedMasterIds.has(entry.id) && selectedDayTypes.has(entry.dayType));
        if (!scenarioName.trim()) {
            setError('Enter a scenario name.');
            return;
        }
        if (selected.length === 0) {
            setError('Select at least one current Master Schedule.');
            return;
        }
        setBusy('create');
        setError(null);
        try {
            const pins = (await Promise.all(selected.map(entry => getMasterSchedule(sourceTeamId, entry.id as RouteIdentity))))
                .filter((value): value is NonNullable<typeof value> => Boolean(value))
                .map(({ entry, content }) => ({
                    sourceTeamId,
                    entry,
                    content,
                    pinnedAt: new Date().toISOString(),
                } satisfies PinnedMasterSchedule));
            if (pins.length !== selected.length) throw new Error('One or more selected Master Schedules could not be pinned.');
            const initial = buildOperationsPlanningInput({
                scenarioId: 'pending',
                scenarioName: scenarioName.trim(),
                exportedAt: new Date().toISOString(),
                pinnedSchedules: pins,
            });
            const saved = await createOperationsPlanningScenario({
                teamId: team.id,
                userId: user.uid,
                name: scenarioName.trim(),
                sourceManifest: initial.sourceManifest,
                ruleProfile: initial.ruleProfile,
                operationsMatrix: initial.operationsMatrix,
                assessment: null,
                sourceIsStale: false,
            });
            const nextInput = buildOperationsPlanningInput({
                scenarioId: saved.metadata.id,
                scenarioName: saved.payload.name,
                exportedAt: new Date().toISOString(),
                pinnedSchedules: pins,
                ruleProfile: saved.payload.ruleProfile,
                operationsMatrix: saved.payload.operationsMatrix,
            });
            setMetadata(saved.metadata);
            setPayload(saved.payload);
            setPlanningInput(nextInput);
            setAssessment(null);
            setHasUnsavedAssessment(false);
            setSourceIsStale(false);
            setScenarios(current => [saved.metadata, ...current]);
            toast?.success('Scenario created', 'Current Master Schedule versions are pinned and remain unchanged.');
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Unable to create the scenario.';
            setError(message);
            toast?.error('Unable to create scenario', message);
        } finally {
            setBusy(null);
        }
    };

    const saveAssessment = useCallback(async (nextAssessment: ProposalAssessment | null = assessment) => {
        if (!team || !user || !metadata || !payload) return;
        setBusy('save');
        setError(null);
        try {
            const saved = await saveOperationsPlanningRevision({
                teamId: team.id,
                userId: user.uid,
                scenarioId: metadata.id,
                expectedRevision: metadata.activeRevision,
                name: payload.name,
                sourceManifest: payload.sourceManifest,
                ruleProfile: payload.ruleProfile,
                operationsMatrix: payload.operationsMatrix,
                assessment: nextAssessment,
                sourceIsStale,
            });
            setMetadata(saved.metadata);
            setPayload(saved.payload);
            setAssessment(saved.payload.assessment);
            setHasUnsavedAssessment(false);
            setScenarios(current => [saved.metadata, ...current.filter(item => item.id !== saved.metadata.id)]);
            toast?.success('Revision saved', `Scenario revision ${saved.metadata.activeRevision} is now current.`);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'Unable to save the scenario.';
            setError(message);
            toast?.error('Unable to save', message);
        } finally {
            setBusy(null);
        }
    }, [assessment, metadata, payload, sourceIsStale, team, toast, user]);

    const importProposal = async (file: File) => {
        const validationError = validateOperationsPlanningProposalFile(file);
        if (validationError) {
            setError(validationError);
            toast?.error('Proposal rejected', validationError);
            return;
        }
        if (!planningInput) return;
        setBusy('import');
        setError(null);
        try {
            const text = await file.text();
            const nextAssessment = assessOperationsPlanningProposal(planningInput, text);
            if (!nextAssessment.proposal) {
                const detail = nextAssessment.findings.find(finding => finding.severity === 'error')?.message
                    ?? 'The proposal did not pass schema and source-integrity validation.';
                throw new Error(detail);
            }
            setAssessment(nextAssessment);
            setHasUnsavedAssessment(true);
            toast?.success('Proposal imported', 'The app recomputed run, roster, and approval findings from the pinned source.');
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'The proposal is invalid.';
            setError(message);
            toast?.error('Proposal rejected', message);
        } finally {
            setBusy(null);
            if (proposalFileRef.current) proposalFileRef.current.value = '';
        }
    };

    const transition = async (action: 'submit' | 'approve') => {
        if (!team || !user || !metadata || !payload) return;
        setBusy(action);
        setError(null);
        try {
            const currentEntries = await getAllMasterSchedules(sourceTeamId);
            const currentVersions = Object.fromEntries(currentEntries.map(entry => [entry.id, entry.currentVersion]));
            const freshnessFindings = assessSourceFreshness(payload.sourceManifest, currentVersions);
            if (freshnessFindings.length > 0) {
                setSourceIsStale(true);
                throw new Error('A pinned Master Schedule has changed. Create a new source-pinned scenario before continuing.');
            }
            setSourceIsStale(false);
            const request = {
                teamId: team.id,
                scenarioId: metadata.id,
                userId: user.uid,
                expectedRevision: metadata.activeRevision,
            };
            if (action === 'submit') await submitOperationsPlanningScenario(request);
            else await approveOperationsPlanningScenario(request);
            const latest = await getOperationsPlanningScenario(team.id, metadata.id);
            if (!latest) throw new Error('The updated scenario could not be reloaded.');
            setMetadata(latest);
            setScenarios(current => [latest, ...current.filter(item => item.id !== latest.id)]);
            toast?.success(action === 'submit' ? 'Submitted for approval' : 'Scenario approved',
                action === 'submit' ? 'Owners and admins can now complete the final review.' : 'The approved revision is now immutable.');
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : `Unable to ${action} the scenario.`;
            setError(message);
            toast?.error(`Unable to ${action}`, message);
        } finally {
            setBusy(null);
        }
    };

    const applyEditedAssessment = (nextAssessment: ProposalAssessment) => {
        setAssessment(nextAssessment);
        setHasUnsavedAssessment(true);
        setError(null);
    };

    if (!user || !team) {
        return (
            <div className="flex h-full items-center justify-center bg-gray-50 p-8">
                <div className="max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    <ShieldCheck className="mx-auto mb-4 text-gray-400" size={42} />
                    <h2 className="text-xl font-bold text-gray-900">Team access required</h2>
                    <p className="mt-2 text-sm text-gray-600">Sign in and select a Scheduled Transit team before creating an operations-planning scenario.</p>
                    <button type="button" onClick={onClose} className="mt-5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Back to dashboard</button>
                </div>
            </div>
        );
    }

    const findings = assessment?.findings ?? [];
    const blockers = findings.filter(finding => finding.severity === 'error');
    const warnings = findings.filter(finding => finding.severity === 'warning');
    const savedAssessment = payload?.assessment ?? null;
    const savedIntegrityClear = savedAssessment?.findings.every(finding => (
        finding.category !== 'integrity' || finding.severity !== 'error'
    )) ?? false;
    const canSubmit = Boolean(metadata && metadata.status === 'draft' && savedAssessment?.proposal && !hasUnsavedAssessment
        && !sourceIsStale && savedIntegrityClear);
    const canApproveRole = canManageTeam || developerPreview?.mode === 'edit';
    const canApprove = Boolean(metadata && metadata.status === 'submitted' && canApproveRole
        && savedAssessment?.approvalReady && !hasUnsavedAssessment && !sourceIsStale);

    return (
        <div className="flex h-full min-h-0 flex-col bg-gray-50">
            <header className="border-b border-gray-200 bg-white px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="rounded-lg bg-gray-900 p-2 text-white"><Scissors size={19} /></div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">Run Cutting & Rostering</h1>
                                <p className="text-sm text-gray-500">Planner-reviewed duties built from pinned, immutable Master Schedules.</p>
                            </div>
                        </div>
                        {sourceTeamId !== team.id && (
                            <p className="mt-2 text-xs font-medium text-amber-700">Master Schedule source: linked team {sourceTeamId}. Scenario revisions remain in {team.name}.</p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {metadata && <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gray-700">{metadata.status}</span>}
                        <button type="button" onClick={() => void refreshLibrary()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><RefreshCw size={15} /> Refresh</button>
                        <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Close</button>
                    </div>
                </div>
                <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Run cutting workspace">
                    {TABS.map(item => (
                        <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${tab === item.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                            {item.icon}{item.label}
                        </button>
                    ))}
                </div>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto p-5">
                {error && <div role="alert" className="mx-auto mb-4 flex max-w-7xl items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><span>{error}</span></div>}
                {busy && <div className="mx-auto mb-4 flex max-w-7xl items-center gap-2 text-sm font-medium text-gray-500"><Loader2 className="animate-spin" size={16} /> Working…</div>}

                {tab === 'overview' && (
                    <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <aside className="space-y-4">
                            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                                <div className="flex items-center justify-between"><h2 className="font-bold text-gray-900">Saved scenarios</h2><span className="text-xs text-gray-500">{scenarios.length}</span></div>
                                <div className="mt-3 space-y-2">
                                    {scenarios.length === 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No saved scenarios yet.</p>}
                                    {scenarios.map(scenario => (
                                        <button key={scenario.id} type="button" onClick={() => void openScenario(scenario)} className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${metadata?.id === scenario.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-gray-900">{scenario.name}</span><span className="text-xs text-gray-500">v{scenario.activeRevision} · {scenario.status}</span></span><ChevronRight size={16} className="shrink-0 text-gray-400" />
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </aside>

                        <div className="space-y-5">
                            {!metadata ? (
                                <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                                    <h2 className="text-lg font-bold text-gray-900">Create a pinned scenario</h2>
                                    <p className="mt-1 text-sm text-gray-600">Choose current published route/day versions. Creating this scenario copies no trips back to Master and changes no vehicle block membership.</p>
                                    <label className="mt-5 block text-sm font-semibold text-gray-700">Scenario name<input value={scenarioName} maxLength={160} onChange={event => setScenarioName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-gray-500" /></label>
                                    <fieldset className="mt-4"><legend className="text-sm font-semibold text-gray-700">Service day types</legend><div className="mt-2 flex flex-wrap gap-2">{DAY_TYPES.map(dayType => <label key={dayType} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" checked={selectedDayTypes.has(dayType)} onChange={() => setSelectedDayTypes(current => { const next = new Set(current); if (next.has(dayType)) next.delete(dayType); else next.add(dayType); return next; })} />{dayType}</label>)}</div></fieldset>
                                    <div className="mt-4 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-700">Published schedules</h3><button type="button" onClick={() => setSelectedMasterIds(new Set(filteredMasters.map(entry => entry.id)))} className="text-xs font-semibold text-gray-600 hover:text-gray-900">Select visible</button></div>
                                    <div className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                                        {filteredMasters.map(entry => <label key={entry.id} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50"><input type="checkbox" checked={selectedMasterIds.has(entry.id)} onChange={() => setSelectedMasterIds(current => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} /><span className="font-medium text-gray-900">Route {entry.routeNumber}</span><span className="text-gray-500">{entry.dayType}</span><span className="ml-auto text-xs text-gray-500">v{entry.currentVersion}</span></label>)}
                                    </div>
                                    <button type="button" onClick={() => void createScenario()} disabled={busy === 'create'} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50"><BadgeCheck size={17} /> Create and pin current versions</button>
                                </section>
                            ) : (
                                <>
                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                        <SummaryCard label="Pinned schedules" value={planningInput?.sourceManifest.items.length ?? 0} detail="Route/day/version sources" />
                                        <SummaryCard label="Vehicle blocks" value={planningInput?.blockAudits.length ?? 0} detail="Audited only; membership immutable" />
                                        <SummaryCard label="Daily runs" value={assessment?.proposal?.dailyRuns.length ?? 0} detail="Driver duties in current proposal" />
                                        <SummaryCard label="Approval gate" value={sourceIsStale || blockers.length > 0 ? 'Blocked' : assessment?.proposal ? 'Clear' : 'Waiting'} detail={sourceIsStale ? 'Pinned source is stale' : `${blockers.length} blockers · ${warnings.length} warnings`} tone={sourceIsStale || blockers.length > 0 ? 'danger' : assessment?.proposal ? 'success' : 'warning'} />
                                    </div>
                                    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                                        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-gray-900">External Codex handoff</h2><p className="mt-1 max-w-3xl text-sm text-gray-600">Export the validated input bundle, run the repository Codex skill outside the app, then import its proposal. The app treats it as a suggestion and recomputes every metric and finding.</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Masters remain unchanged</span></div>
                                        <div className="mt-5 flex flex-wrap gap-2">
                                            <button type="button" disabled={!planningInput} onClick={() => planningInput && downloadJson('operations-planning-input-v1.json', planningInput)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Download size={16} /> Export Codex input</button>
                                            <input ref={proposalFileRef} className="hidden" type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void importProposal(file); }} />
                                            <button type="button" disabled={!planningInput || isReadOnly} onClick={() => proposalFileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"><Upload size={16} /> Import Codex proposal</button>
                                            <button type="button" disabled={!hasUnsavedAssessment || isReadOnly || Boolean(busy)} onClick={() => void saveAssessment()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Save size={16} /> Save revision{hasUnsavedAssessment ? ' *' : ''}</button>
                                            <button type="button" disabled={!planningInput || !assessment} onClick={() => planningInput && assessment && downloadOperationsPlanningWorkbook(planningInput, assessment)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><FileSpreadsheet size={16} /> Export Excel</button>
                                        </div>
                                        {hasUnsavedAssessment && <p className="mt-3 text-sm font-semibold text-amber-700">Unsaved proposal or source-check changes must be saved as a new immutable revision before submission.</p>}
                                    </section>
                                    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                                        <h2 className="text-lg font-bold text-gray-900">Planner decision</h2>
                                        <p className="mt-1 text-sm text-gray-600">Members may prepare and submit. Only a team owner or admin may approve. Contractual violations block approval; exception and best-practice findings remain visible warnings.</p>
                                        <div className="mt-4 flex flex-wrap items-center gap-2">
                                            {metadata.status === 'draft' && <button type="button" disabled={!canSubmit || Boolean(busy)} onClick={() => void transition('submit')} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><ClipboardCheck size={16} /> Submit for approval</button>}
                                            {metadata.status === 'submitted' && <button type="button" disabled={!canApprove || Boolean(busy)} onClick={() => void transition('approve')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 size={16} /> Approve scenario</button>}
                                            {!canApproveRole && metadata.status === 'submitted' && <span className="text-sm text-gray-500">Owner/admin approval required.</span>}
                                            {metadata.status === 'approved' && <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><BadgeCheck size={17} /> Approved revision is immutable</span>}
                                        </div>
                                    </section>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {tab === 'blocks' && <BlockAuditPanel input={planningInput} />}
                {tab === 'runs' && <DailyRunsPanel input={planningInput} assessment={assessment} readOnly={isReadOnly} onAssessmentChange={applyEditedAssessment} />}
                {tab === 'rosters' && <WeeklyRostersPanel input={planningInput} assessment={assessment} readOnly={isReadOnly} onAssessmentChange={applyEditedAssessment} />}
                {tab === 'rules' && <RulesAndFindingsPanel input={planningInput} findings={findings} sourceIsStale={sourceIsStale} />}
            </main>
        </div>
    );
};

const EmptyPanel: React.FC<{ title: string; detail: string; icon?: React.ReactNode }> = ({ title, detail, icon = <FileJson size={30} /> }) => (
    <div className="mx-auto max-w-3xl rounded-xl border-2 border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">{icon}<h2 className="mt-3 font-bold text-gray-900">{title}</h2><p className="mt-1 text-sm">{detail}</p></div>
);

const BlockAuditPanel: React.FC<{ input: OperationsPlanningInputV1 | null }> = ({ input }) => {
    if (!input) return <EmptyPanel title="Create or open a scenario" detail="Pinned block audits appear here." icon={<Blocks className="mx-auto" size={30} />} />;
    return <div className="mx-auto max-w-7xl"><div className="mb-4"><h2 className="text-lg font-bold text-gray-900">Frozen vehicle-block audit</h2><p className="text-sm text-gray-600">Trip membership is copied from the pinned Master versions for audit only. This workspace cannot reblock service.</p></div><div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Day / route</th><th className="px-4 py-3">Block</th><th className="px-4 py-3">Trips</th><th className="px-4 py-3">Service</th><th className="px-4 py-3">Audit</th></tr></thead><tbody className="divide-y divide-gray-100">{input.blockAudits.map(audit => <tr key={audit.id}><td className="px-4 py-3 font-medium text-gray-900">{audit.dayType} · {audit.routeIdentity}</td><td className="px-4 py-3">{audit.blockId}</td><td className="px-4 py-3">{audit.tripIds.length}</td><td className="px-4 py-3 tabular-nums">{formatMinutes(audit.firstDeparture)}–{formatMinutes(audit.finalArrival)}</td><td className="px-4 py-3">{audit.findings.length === 0 ? <span className="text-emerald-700">Clear</span> : <span className="font-semibold text-red-700">{audit.findings.length} finding(s)</span>}</td></tr>)}</tbody></table></div></div>;
};

interface ProposalPanelProps {
    input: OperationsPlanningInputV1 | null;
    assessment: ProposalAssessment | null;
    readOnly: boolean;
    onAssessmentChange: (assessment: ProposalAssessment) => void;
}

const DailyRunsPanel: React.FC<ProposalPanelProps> = ({ input, assessment, readOnly, onAssessmentChange }) => {
    const [splitTripByRun, setSplitTripByRun] = useState<Record<string, string>>({});
    const [mergeTargetByRun, setMergeTargetByRun] = useState<Record<string, string>>({});
    const [moveTargetByPiece, setMoveTargetByPiece] = useState<Record<string, string>>({});

    if (!input || !assessment?.proposal) {
        return <EmptyPanel title="Import a Codex proposal" detail="Validated daily run pieces and app-calculated metrics appear here." icon={<Scissors className="mx-auto" size={30} />} />;
    }

    const proposal = assessment.proposal;
    const tripById = new Map(input.trips.map(trip => [trip.id, trip]));
    const metricsById = new Map(assessment.dailyRunMetrics.map(metric => [metric.runId, metric]));
    const applyEdit = (edit: () => typeof proposal) => {
        try {
            onAssessmentChange(assessOperationsPlanningProposal(input, edit()));
        } catch (caught) {
            window.alert(caught instanceof Error ? caught.message : 'That run edit is not valid.');
        }
    };
    const handleRenumber = (run: DailyRun) => {
        const value = window.prompt('New run number', run.runNumber)?.trim();
        if (value && value !== run.runNumber) applyEdit(() => renumberDailyRun(proposal, run.id, value));
    };
    const handleSplit = (run: DailyRun) => {
        const splitTrip = splitTripByRun[run.id];
        if (!splitTrip) return;
        const runNumber = window.prompt('New run number for the second duty')?.trim();
        if (!runNumber) return;
        applyEdit(() => splitDailyRun(input, proposal, run.id, splitTrip, {
            id: `run-${crypto.randomUUID()}`,
            runNumber,
        }));
    };

    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-900">Daily runs</h2>
                <p className="text-sm text-gray-600">Split, merge, move, or renumber at valid run-piece boundaries. Every change is reassessed locally before save.</p>
            </div>
            <div className="grid gap-4">
                {proposal.dailyRuns.map(run => {
                    const metric = metricsById.get(run.id);
                    const runFindings = assessment.findings.filter(finding => finding.runId === run.id);
                    const flatTripIds = run.pieces.flatMap(piece => piece.tripIds);
                    const splitChoices = flatTripIds.slice(0, -1).filter(tripId => {
                        const trip = tripById.get(tripId);
                        return trip?.arrivalTime !== null && input.ruleProfile.reliefPoints.some(point => (
                            [point.name, ...point.aliases].some(name => name.toLowerCase() === trip?.endStop.trim().toLowerCase())
                        ));
                    });
                    const mergeTargets = proposal.dailyRuns.filter(candidate => candidate.id !== run.id && candidate.dayType === run.dayType);
                    return (
                        <article key={run.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2"><h3 className="font-bold text-gray-900">Run {run.runNumber}</h3><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{run.dayType}</span>{metric?.isSplit && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Split</span>}</div>
                                    <p className="mt-1 text-xs text-gray-500">{run.pieces.length} piece(s) · {flatTripIds.length} trips</p>
                                </div>
                                {!readOnly && <button type="button" onClick={() => handleRenumber(run)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">Renumber</button>}
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-4">
                                <SummaryCard label="Report" value={formatMinutes(metric?.reportTime)} detail="Garage report time" />
                                <SummaryCard label="Off" value={formatMinutes(metric?.offTime)} detail="Post-trip complete" />
                                <SummaryCard label="Platform" value={formatMinutes(metric?.platformMinutes)} detail="Scheduled driving" />
                                <SummaryCard label="Paid / spread" value={`${formatMinutes(metric?.paidMinutes)} / ${formatMinutes(metric?.spreadMinutes)}`} detail="Recomputed by app" />
                            </div>
                            <div className="mt-3 grid gap-2">
                                {run.pieces.map(piece => (
                                    <div key={piece.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                        <span><strong>{piece.blockId}</strong> · Route {piece.routeNumber} · {piece.tripIds.length} trips · {piece.startReliefPoint} → {piece.endReliefPoint}</span>
                                        {!readOnly && run.pieces.length > 1 && mergeTargets.length > 0 && <><select aria-label={`Move ${piece.id} to run`} value={moveTargetByPiece[piece.id] ?? ''} onChange={event => setMoveTargetByPiece(current => ({ ...current, [piece.id]: event.target.value }))} className="ml-auto rounded border border-gray-300 bg-white px-2 py-1"><option value="">Move to…</option>{mergeTargets.map(target => <option key={target.id} value={target.id}>Run {target.runNumber}</option>)}</select><button type="button" disabled={!moveTargetByPiece[piece.id]} onClick={() => applyEdit(() => moveRunPiece(proposal, piece.id, run.id, moveTargetByPiece[piece.id]))} className="rounded border border-gray-300 bg-white px-2 py-1 font-semibold disabled:opacity-40">Move</button></>}
                                    </div>
                                ))}
                            </div>
                            {!readOnly && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                                <select aria-label={`Split run ${run.runNumber} after trip`} value={splitTripByRun[run.id] ?? ''} onChange={event => setSplitTripByRun(current => ({ ...current, [run.id]: event.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"><option value="">Split after trip…</option>{splitChoices.map(tripId => { const trip = tripById.get(tripId); return <option key={tripId} value={tripId}>Trip {trip?.tripNumber} at {trip?.endStop}</option>; })}</select>
                                <button type="button" disabled={!splitTripByRun[run.id]} onClick={() => handleSplit(run)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Split</button>
                                <select aria-label={`Merge run ${run.runNumber} with`} value={mergeTargetByRun[run.id] ?? ''} onChange={event => setMergeTargetByRun(current => ({ ...current, [run.id]: event.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"><option value="">Merge with…</option>{mergeTargets.map(target => <option key={target.id} value={target.id}>Run {target.runNumber}</option>)}</select>
                                <button type="button" disabled={!mergeTargetByRun[run.id]} onClick={() => applyEdit(() => mergeDailyRuns(input, proposal, run.id, mergeTargetByRun[run.id]))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Merge</button>
                            </div>}
                            {runFindings.length > 0 && <div className="mt-3 space-y-2">{runFindings.map(finding => <div key={finding.id} className={`rounded-lg border px-3 py-2 text-xs ${findingTone(finding)}`}>{finding.message}</div>)}</div>}
                        </article>
                    );
                })}
            </div>
        </div>
    );
};

const WeeklyRostersPanel: React.FC<ProposalPanelProps> = ({ input, assessment, readOnly, onAssessmentChange }) => {
    if (!input || !assessment?.proposal) {
        return <EmptyPanel title="Import a Codex proposal" detail="Anonymous weekly crew assignments and rest checks appear here." icon={<Users className="mx-auto" size={30} />} />;
    }
    const proposal = assessment.proposal;
    const metricsById = new Map(assessment.weeklyRosterMetrics.map(metric => [metric.rosterId, metric]));
    const assign = (rosterId: string, day: Parameters<typeof assignDailyRunToCrew>[2], runId: string | null) => {
        try {
            onAssessmentChange(assessOperationsPlanningProposal(input, assignDailyRunToCrew(proposal, rosterId, day, runId)));
        } catch (caught) {
            window.alert(caught instanceof Error ? caught.message : 'That roster assignment is not valid.');
        }
    };
    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-4"><h2 className="text-lg font-bold text-gray-900">Weekly anonymous rosters</h2><p className="text-sm text-gray-600">Five Weekday instances plus Saturday and Sunday are assigned to anonymous crew numbers only. No employee or bidding data is stored.</p></div>
            <div className="space-y-4">{proposal.weeklyRosters.map(roster => {
                const metric = metricsById.get(roster.id);
                return <article key={roster.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3"><h3 className="font-bold text-gray-900">{formatCrewNumber(roster.crewNumber)}</h3><div className="flex gap-3 text-xs text-gray-600"><span>{metric?.daysWorked ?? 0} days</span><span>{formatMinutes(metric?.paidMinutes)} paid</span><span>{formatMinutes(metric?.platformMinutes)} platform</span><span className={metric?.restViolations ? 'font-semibold text-red-700' : 'text-emerald-700'}>{metric?.restViolations ?? 0} rest violations</span></div></div><div className="grid grid-cols-2 gap-px bg-gray-100 sm:grid-cols-4 lg:grid-cols-7">{roster.assignments.map(assignment => { const run = proposal.dailyRuns.find(candidate => candidate.id === assignment.runId); const eligibleRuns = proposal.dailyRuns.filter(candidate => candidate.dayType === (assignment.day === 'Saturday' ? 'Saturday' : assignment.day === 'Sunday' ? 'Sunday' : 'Weekday')); return <div key={assignment.day} className="bg-white p-3"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{assignment.day}</p>{readOnly ? <p className="mt-1 text-sm font-bold text-gray-900">{run ? `Run ${run.runNumber}` : 'Off'}</p> : <select aria-label={`${roster.crewNumber} ${assignment.day} assignment`} value={assignment.runId ?? ''} onChange={event => assign(roster.id, assignment.day, event.target.value || null)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-semibold"><option value="">Off</option>{eligibleRuns.map(candidate => <option key={candidate.id} value={candidate.id}>Run {candidate.runNumber}</option>)}</select>}</div>; })}</div></article>;
            })}</div>
        </div>
    );
};

const RulesAndFindingsPanel: React.FC<{ input: OperationsPlanningInputV1 | null; findings: ValidationFinding[]; sourceIsStale: boolean }> = ({ input, findings, sourceIsStale }) => {
    if (!input) return <EmptyPanel title="Create or open a scenario" detail="Confirmed rule sources, planner overrides, and validation findings appear here." />;
    const rules = input.ruleProfile;
    return <div className="mx-auto max-w-7xl space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Relief points" value={rules.reliefPoints.length} detail="Park Place, B.A.T.T., Downtown Hub" /><SummaryCard label="Max work" value={formatMinutes(rules.maximumWorkMinutes)} detail="Contractual maximum" /><SummaryCard label="Max spread" value={formatMinutes(rules.maximumSpreadMinutes)} detail="Long-spread share also checked" /><SummaryCard label="Relief cabs" value={rules.reliefCabCapacity} detail="Concurrent capacity; no cab assignment" /></div><section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-gray-900">Rule provenance</h2><p className="mt-1 text-sm text-gray-600">Park Place as a full break point is visibly retained as a planner-confirmed override. B.A.T.T. park-out capacity remains not evaluated until a numeric limit is supplied.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{rules.sources.map(source => <div key={source.id} className="rounded-lg border border-gray-200 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-gray-900">{source.label}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${source.authority === 'planner-confirmed-override' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{source.authority}</span></div>{source.note && <p className="mt-1 text-xs text-gray-500">{source.note}</p>}</div>)}</div></section><section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="font-bold text-gray-900">Findings</h2><span className="text-xs text-gray-500">{findings.length + (sourceIsStale ? 1 : 0)} total</span></div><div className="mt-4 space-y-2">{sourceIsStale && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Integrity · stale source:</strong> one or more pinned Master versions are no longer current. Create a fresh scenario before approval.</div>}{findings.length === 0 && !sourceIsStale && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">No validation findings in the current proposal.</div>}{findings.map(finding => <div key={finding.id} className={`rounded-lg border p-3 text-sm ${findingTone(finding)}`}><div className="flex flex-wrap items-center gap-2"><strong>{finding.category}</strong><span className="text-xs uppercase tracking-wide opacity-70">{finding.code}</span></div><p className="mt-1">{finding.message}</p></div>)}</div></section></div>;
};
