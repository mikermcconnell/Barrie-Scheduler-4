import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bus, Copy, Download, GitBranch, Loader2, MapPinned, Share2, Star, Trash2, TriangleAlert } from 'lucide-react';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';
import { saveDraft } from '../../utils/services/draftService';
import { downloadCSV } from '../../utils/services/exportService';
import { getAllMasterSchedules, getMasterSchedule } from '../../utils/services/masterScheduleService';
import { getTransitAppData } from '../../utils/transit-app/transitAppService';
import { analyzeNetworkConnections } from '../../utils/network-connections/networkConnectionAnalysis';
import { saveNetworkConnectionEditorHandoff, saveNetworkConnectionMasterHandoff } from '../../utils/network-connections/networkConnectionHandoff';
import {
    buildSavedActionsCsv,
    buildSavedActionsMarkdown,
    summarizeObservedSignalForPattern,
    summarizeObservedSignalForSavedRecommendation,
} from '../../utils/network-connections/networkConnectionObservedSignals';
import type {
    NetworkConnectionAnalysisResult,
    NetworkConnectionHub,
    NetworkConnectionOpportunity,
    NetworkConnectionPattern,
    NetworkConnectionScheduleInput,
    NetworkConnectionTimeBand,
} from '../../utils/network-connections/networkConnectionTypes';
import type { DayType } from '../../utils/masterScheduleTypes';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { NetworkConnectionsMap } from '../NetworkConnections/NetworkConnectionsMap';
import { useToast } from '../contexts/ToastContext';
import type {
    SavedNetworkConnectionRecommendation,
    SavedNetworkConnectionRecommendationStatus,
} from '../../utils/network-connections/networkConnectionRecommendationStore';
import {
    loadSavedNetworkConnectionRecommendations,
    removeSavedNetworkConnectionRecommendation,
    updateSavedNetworkConnectionRecommendationStatus,
    upsertSavedNetworkConnectionRecommendation,
} from '../../utils/network-connections/networkConnectionRecommendationStore';

interface NetworkConnectionsWorkspaceProps {
    onBack: () => void;
    teamId?: string | null;
    userId?: string | null;
    observedTransitData?: TransitAppDataSummary | null;
}

const DAY_TYPES: DayType[] = ['Weekday', 'Saturday', 'Sunday'];
const TIME_BANDS: Array<{ id: NetworkConnectionTimeBand; label: string }> = [
    { id: 'full_day', label: 'Full Day' },
    { id: 'am_peak', label: 'AM Peak' },
    { id: 'midday', label: 'Midday' },
    { id: 'pm_peak', label: 'PM Peak' },
    { id: 'evening', label: 'Evening' },
];

function severityPillClass(severity: NetworkConnectionHub['severity'] | NetworkConnectionPattern['severity']): string {
    if (severity === 'weak') return 'bg-red-100 text-red-700';
    if (severity === 'mixed') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
}

function opportunityPillClass(classification: NetworkConnectionOpportunity['classification']): string {
    if (classification === 'missed') return 'bg-red-100 text-red-700';
    if (classification === 'tight') return 'bg-amber-100 text-amber-700';
    if (classification === 'good') return 'bg-emerald-100 text-emerald-700';
    return 'bg-slate-100 text-slate-700';
}

function formatOpportunityClass(classification: NetworkConnectionOpportunity['classification']): string {
    if (classification === 'missed') return 'Missed';
    if (classification === 'tight') return 'Tight';
    if (classification === 'good') return 'Good';
    return 'Long';
}

function formatWait(waitMinutes: number | null): string {
    return waitMinutes == null ? 'No connection' : `${waitMinutes} min`;
}

function formatTime(minutes: number | null): string {
    if (minutes == null) return '-';
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function opportunityKey(opportunity: NetworkConnectionOpportunity): string {
    return [
        opportunity.fromTripId,
        opportunity.toTripId ?? 'none',
        opportunity.fromStopId,
        opportunity.toStopId ?? 'none',
        opportunity.fromTime,
        opportunity.toTime ?? 'none',
    ].join('|');
}

function pickDefaultOpportunity(opportunities: NetworkConnectionOpportunity[]): NetworkConnectionOpportunity | null {
    return opportunities.find((item) => item.classification === 'good' || item.classification === 'tight')
        ?? opportunities[0]
        ?? null;
}

function formatSavedTimestamp(value: Date): string {
    return value.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function buildSavedRecommendationId(
    dayType: DayType,
    timeBand: NetworkConnectionTimeBand,
    patternId: string,
    recommendationId: string,
): string {
    return [dayType, timeBand, patternId, recommendationId].join('|');
}

function formatObservedTimeBands(values: string[]): string {
    if (values.length === 0) return 'No dominant band';
    return values
        .map((value) => value.replace(/_/g, ' '))
        .join(', ');
}

function observedDemandClass(level: 'none' | 'light' | 'moderate' | 'strong'): string {
    if (level === 'strong') return 'bg-red-100 text-red-700';
    if (level === 'moderate') return 'bg-amber-100 text-amber-700';
    if (level === 'light') return 'bg-cyan-100 text-cyan-700';
    return 'bg-slate-100 text-slate-600';
}

function recommendationStatusClass(status: SavedNetworkConnectionRecommendationStatus): string {
    if (status === 'implemented') return 'bg-emerald-100 text-emerald-700';
    if (status === 'accepted') return 'bg-cyan-100 text-cyan-700';
    if (status === 'reviewing') return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-600';
}

function openPublishedRoute(routeNumber: string, dayType: DayType): void {
    saveNetworkConnectionMasterHandoff({ routeNumber, dayType });
    window.location.hash = 'fixed/master';
}

async function copyRouteToDraftAndOpenEditor(
    pattern: NetworkConnectionPattern,
    target: 'from' | 'to',
    teamId: string,
    userId: string,
    setDraftHandoffKey: React.Dispatch<React.SetStateAction<string | null>>,
    toast?: ReturnType<typeof useToast>,
): Promise<void> {
    const service = target === 'from' ? pattern.fromService : pattern.toService;
    const actionKey = `${pattern.id}-${target}`;
    setDraftHandoffKey(actionKey);

    try {
        const result = await getMasterSchedule(teamId, service.routeIdentity as `${string}-${DayType}`);
        if (!result) {
            toast?.error('Route Not Found', `Could not load published Route ${service.routeNumber}.`);
            return;
        }

        const draftId = await saveDraft(userId, {
            name: `Draft - Route ${service.routeNumber}`,
            routeNumber: result.content.metadata.routeNumber,
            dayType: result.content.metadata.dayType,
            status: 'draft',
            createdBy: userId,
            basedOn: { type: 'master', id: result.entry.id },
            content: result.content,
        });

        saveNetworkConnectionEditorHandoff({ draftId });
        toast?.success('Draft Created', `Route ${service.routeNumber} copied to draft and opened in the editor.`);
        window.location.hash = 'fixed/editor';
    } catch (caughtError) {
        console.error('Failed to copy route to draft from network connections:', caughtError);
        toast?.error('Draft Copy Failed', `Could not copy Route ${service.routeNumber} into the editor.`);
    } finally {
        setDraftHandoffKey((current) => current === actionKey ? null : current);
    }
}

function HubCard({ hub, selected, onClick }: { hub: NetworkConnectionHub; selected: boolean; onClick: () => void }): React.ReactElement {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${
                selected ? 'border-brand-blue bg-cyan-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm font-extrabold text-gray-900">{hub.name}</div>
                    <div className="mt-1 text-xs font-semibold text-gray-500">{hub.routeNumbers.join(', ')}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${severityPillClass(hub.severity)}`}>{hub.severity}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-gray-600">
                <div className="rounded-xl border border-gray-200 bg-white/80 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-gray-400">Routes</div>
                    <div className="mt-1 text-sm font-extrabold text-gray-900">{hub.routeNumbers.length}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white/80 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-gray-400">Issue Score</div>
                    <div className="mt-1 text-sm font-extrabold text-gray-900">{hub.issueScore}</div>
                </div>
            </div>
            <p className="mt-3 text-xs font-semibold leading-relaxed text-gray-500">{hub.topRecommendationSummary}</p>
        </button>
    );
}

export const NetworkConnectionsWorkspace: React.FC<NetworkConnectionsWorkspaceProps> = ({
    onBack,
    teamId,
    userId,
    observedTransitData,
}) => {
    const toast = useToast();
    const [dayType, setDayType] = useState<DayType>('Weekday');
    const [timeBand, setTimeBand] = useState<NetworkConnectionTimeBand>('full_day');
    const [analysis, setAnalysis] = useState<NetworkConnectionAnalysisResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedHubId, setSelectedHubId] = useState<string | null>(null);
    const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
    const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
    const [draftHandoffKey, setDraftHandoffKey] = useState<string | null>(null);
    const [savedRecommendations, setSavedRecommendations] = useState<SavedNetworkConnectionRecommendation[]>([]);
    const [savedStatusFilter, setSavedStatusFilter] = useState<'all' | SavedNetworkConnectionRecommendationStatus>('all');
    const [localTransitData, setLocalTransitData] = useState<TransitAppDataSummary | null>(observedTransitData ?? null);
    const [loadingObservedData, setLoadingObservedData] = useState(false);

    useEffect(() => {
        setSavedRecommendations(loadSavedNetworkConnectionRecommendations(teamId));
    }, [teamId]);

    useEffect(() => {
        if (observedTransitData) {
            setLocalTransitData(observedTransitData);
            return;
        }
        if (!teamId) {
            setLocalTransitData(null);
            return;
        }

        let cancelled = false;
        setLoadingObservedData(true);

        void getTransitAppData(teamId)
            .then((data) => {
                if (!cancelled) setLocalTransitData(data ?? null);
            })
            .catch((error) => {
                console.error('Failed to load observed transfer data for network connections:', error);
                if (!cancelled) setLocalTransitData(null);
            })
            .finally(() => {
                if (!cancelled) setLoadingObservedData(false);
            });

        return () => {
            cancelled = true;
        };
    }, [observedTransitData, teamId]);

    useEffect(() => {
        let cancelled = false;

        async function load(): Promise<void> {
            if (!teamId) {
                setAnalysis(null);
                setSelectedHubId(null);
                setSelectedPatternId(null);
                setSelectedOpportunityId(null);
                setError('Join a team to analyze published master schedules.');
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const entries = await getAllMasterSchedules(teamId);
                const matchingEntries = entries.filter((entry) => entry.dayType === dayType);
                const schedules = (await Promise.all(
                    matchingEntries.map(async (entry): Promise<NetworkConnectionScheduleInput | null> => {
                        const result = await getMasterSchedule(teamId, entry.id as `${string}-${DayType}`);
                        return result ? { entry: result.entry, content: result.content } : null;
                    }),
                )).filter((value): value is NetworkConnectionScheduleInput => value !== null);

                if (cancelled) return;

                if (schedules.length === 0) {
                    setAnalysis(null);
                    setSelectedHubId(null);
                    setSelectedPatternId(null);
                    setSelectedOpportunityId(null);
                    setError(`No published ${dayType.toLowerCase()} master schedules were found for this team.`);
                    return;
                }

                const nextAnalysis = analyzeNetworkConnections({ schedules, dayType, timeBand });
                setAnalysis(nextAnalysis);
                setSelectedHubId((current) => current && nextAnalysis.hubs.some((hub) => hub.id === current) ? current : nextAnalysis.hubs[0]?.id ?? null);
            } catch (caughtError) {
                console.error('Failed to load network connections analysis:', caughtError);
                if (!cancelled) {
                    setAnalysis(null);
                    setSelectedHubId(null);
                    setSelectedPatternId(null);
                    setSelectedOpportunityId(null);
                    setError('Failed to load published schedules for network connection analysis.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [dayType, teamId, timeBand]);

    const selectedHub = useMemo(() => analysis?.hubs.find((hub) => hub.id === selectedHubId) ?? analysis?.hubs[0] ?? null, [analysis, selectedHubId]);
    const selectedPatterns = useMemo(
        () => !analysis || !selectedHub ? [] : analysis.patterns.filter((pattern) => pattern.hubId === selectedHub.id).slice(0, 8),
        [analysis, selectedHub],
    );

    useEffect(() => {
        setSelectedPatternId((current) => current && selectedPatterns.some((pattern) => pattern.id === current) ? current : selectedPatterns[0]?.id ?? null);
    }, [selectedPatterns]);

    const selectedPattern = useMemo(
        () => selectedPatterns.find((pattern) => pattern.id === selectedPatternId) ?? selectedPatterns[0] ?? null,
        [selectedPatternId, selectedPatterns],
    );

    useEffect(() => {
        const opportunities = selectedPattern?.opportunities ?? [];
        const defaultOpportunity = pickDefaultOpportunity(opportunities);
        setSelectedOpportunityId((current) => current && opportunities.some((item) => opportunityKey(item) === current)
            ? current
            : defaultOpportunity ? opportunityKey(defaultOpportunity) : null);
    }, [selectedPattern]);

    const selectedOpportunity = useMemo(
        () => selectedPattern?.opportunities.find((item) => opportunityKey(item) === selectedOpportunityId) ?? pickDefaultOpportunity(selectedPattern?.opportunities ?? []) ?? null,
        [selectedOpportunityId, selectedPattern],
    );

    const selectedRoutes = useMemo(
        () => new Set((selectedHub?.routeNumbers ?? []).map((value) => value.trim().toUpperCase())),
        [selectedHub],
    );
    const focusedRoutes = useMemo(() => {
        if (!selectedPattern) return new Set<string>();
        return new Set([
            selectedPattern.fromService.routeNumber.trim().toUpperCase(),
            selectedPattern.toService.routeNumber.trim().toUpperCase(),
        ]);
    }, [selectedPattern]);

    const backgroundRouteShapes = useMemo(() => {
        const allShapes = loadGtfsRouteShapes();
        if (selectedRoutes.size === 0) return allShapes;
        return allShapes.filter((shape) => selectedRoutes.has(shape.routeShortName.trim().toUpperCase()));
    }, [selectedRoutes]);

    const focusRouteShapes = useMemo(
        () => backgroundRouteShapes.filter((shape) => focusedRoutes.has(shape.routeShortName.trim().toUpperCase())),
        [backgroundRouteShapes, focusedRoutes],
    );

    const displayedPatterns = useMemo(() => (analysis?.patterns ?? []).slice(0, 5), [analysis]);
    const displayedOpportunities = useMemo(() => selectedPattern?.opportunities.slice(0, 6) ?? [], [selectedPattern]);
    const selectedPatternObserved = useMemo(
        () => selectedPattern && selectedHub
            ? summarizeObservedSignalForPattern(
                selectedPattern,
                selectedHub.name,
                selectedHub.stops.map((stop) => stop.stopName),
                timeBand,
                localTransitData,
            )
            : null,
        [localTransitData, selectedHub, selectedPattern, timeBand],
    );
    const savedActionRows = useMemo(
        () => savedRecommendations.map((recommendation) => ({
            recommendation,
            observed: summarizeObservedSignalForSavedRecommendation(recommendation, localTransitData),
        })),
        [localTransitData, savedRecommendations],
    );
    const filteredSavedActionRows = useMemo(
        () => savedStatusFilter === 'all'
            ? savedActionRows
            : savedActionRows.filter(({ recommendation }) => recommendation.status === savedStatusFilter),
        [savedActionRows, savedStatusFilter],
    );
    const savedStatusCounts = useMemo(() => ({
        all: savedRecommendations.length,
        new: savedRecommendations.filter((item) => item.status === 'new').length,
        reviewing: savedRecommendations.filter((item) => item.status === 'reviewing').length,
        accepted: savedRecommendations.filter((item) => item.status === 'accepted').length,
        implemented: savedRecommendations.filter((item) => item.status === 'implemented').length,
    }), [savedRecommendations]);

    const handleExportSavedActions = () => {
        if (savedActionRows.length === 0) return;
        const slug = new Date().toISOString().slice(0, 10);
        downloadCSV(buildSavedActionsCsv(savedActionRows), `network_connections_saved_actions_${slug}.csv`);
        toast?.success('Saved Actions Exported', 'Downloaded a CSV snapshot of the current shortlist.');
    };

    const handleCopySavedActionsBrief = async () => {
        if (savedActionRows.length === 0) return;
        try {
            await navigator.clipboard.writeText(buildSavedActionsMarkdown(savedActionRows));
            toast?.success('Brief Copied', 'Saved actions summary copied to clipboard.');
        } catch (error) {
            console.error('Failed to copy saved actions brief:', error);
            toast?.error('Copy Failed', 'Could not copy the saved actions brief.');
        }
    };
    const applySavedRecommendation = (saved: SavedNetworkConnectionRecommendation) => {
        setDayType(saved.dayType);
        setTimeBand(saved.timeBand);
        setSelectedHubId(saved.hubId);
        setSelectedPatternId(saved.patternId);
        setSelectedOpportunityId(saved.opportunityId ?? null);
    };

    const handleSaveRecommendation = (
        recommendation: NetworkConnectionPattern['recommendations'][number],
    ) => {
        if (!selectedHub || !selectedPattern) return;

        const nextId = buildSavedRecommendationId(dayType, timeBand, selectedPattern.id, recommendation.id);
        const opportunityLabel = selectedOpportunity
            ? `${formatTime(selectedOpportunity.fromTime)} to ${formatTime(selectedOpportunity.toTime)}`
            : null;
        const now = new Date();
        const existing = savedRecommendations.find((item) => item.id === nextId);

        const nextRecommendation: SavedNetworkConnectionRecommendation = {
            id: nextId,
            teamId: teamId ?? null,
            status: existing?.status ?? 'new',
            dayType,
            timeBand,
            hubId: selectedHub.id,
            hubName: selectedHub.name,
            hubStopNames: selectedHub.stops.map((stop) => stop.stopName),
            hubSeverity: selectedHub.severity,
            routeNumbers: selectedHub.routeNumbers,
            patternId: selectedPattern.id,
            patternLabel: `${selectedPattern.fromService.routeNumber} ${selectedPattern.fromService.direction} -> ${selectedPattern.toService.routeNumber} ${selectedPattern.toService.direction}`,
            patternSeverity: selectedPattern.severity,
            recommendationId: recommendation.id,
            recommendationType: recommendation.type,
            recommendationTitle: recommendation.title,
            recommendationSummary: recommendation.summary,
            recommendationRationale: recommendation.rationale,
            fromRouteNumber: selectedPattern.fromService.routeNumber,
            toRouteNumber: selectedPattern.toService.routeNumber,
            opportunityId: selectedOpportunity ? opportunityKey(selectedOpportunity) : null,
            opportunityLabel,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        setSavedRecommendations(upsertSavedNetworkConnectionRecommendation(nextRecommendation, teamId));
        toast?.success(
            existing ? 'Recommendation Updated' : 'Recommendation Saved',
            existing
                ? `${recommendation.title} was refreshed in Saved Actions.`
                : `${recommendation.title} was added to Saved Actions.`,
        );
    };

    const handleDeleteSavedRecommendation = (recommendationId: string) => {
        setSavedRecommendations(removeSavedNetworkConnectionRecommendation(recommendationId, teamId));
        toast?.success('Saved Action Removed', 'The saved recommendation was removed from this workspace.');
    };

    const handleUpdateSavedRecommendationStatus = (
        recommendationId: string,
        status: SavedNetworkConnectionRecommendationStatus,
    ) => {
        setSavedRecommendations(updateSavedNetworkConnectionRecommendationStatus(recommendationId, status, teamId));
        toast?.success('Saved Action Updated', `Recommendation marked as ${status}.`);
    };

    return (
        <div className="h-full overflow-auto bg-[#f6f7f8] custom-scrollbar">
            <div className="mx-auto max-w-[1820px] p-6">
                <div className="mb-6 rounded-[30px] border-2 border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                            <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
                                <ArrowLeft size={14} /> Back to Planning Data
                            </button>
                            <div className="flex items-center gap-3">
                                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700 shadow-sm">
                                    <MapPinned size={24} />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Network Connections</h2>
                                        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-violet-700">Map First</span>
                                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">Friendly Theme</span>
                                    </div>
                                    <p className="mt-2 max-w-4xl text-sm font-semibold leading-relaxed text-gray-500">
                                        Scan the published network as a transfer system instead of route-by-route tables. Hubs are discovered from shared and nearby stops, then ranked by repeated connection quality.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-1">
                                {DAY_TYPES.map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setDayType(value)}
                                        className={`rounded-xl px-3 py-2 text-sm font-extrabold transition-colors ${dayType === value ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        {value}
                                    </button>
                                ))}
                            </div>
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-1">
                                {TIME_BANDS.map((band) => (
                                    <button
                                        key={band.id}
                                        type="button"
                                        onClick={() => setTimeBand(band.id)}
                                        className={`rounded-xl px-3 py-2 text-sm font-extrabold transition-colors ${timeBand === band.id ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        {band.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)_420px]">
                    <aside className="space-y-4">
                        <section className="rounded-[28px] border-2 border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">Hub Ranking</p>
                                    <h3 className="text-lg font-extrabold text-gray-900">Priority hubs</h3>
                                </div>
                                <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                    {analysis?.summary.hubCount ?? 0}
                                </div>
                            </div>
                            <div className="space-y-3">
                                {(analysis?.hubs ?? []).slice(0, 8).map((hub) => (
                                    <HubCard
                                        key={hub.id}
                                        hub={hub}
                                        selected={hub.id === selectedHub?.id}
                                        onClick={() => {
                                            setSelectedHubId(hub.id);
                                            setSelectedPatternId(null);
                                            setSelectedOpportunityId(null);
                                        }}
                                    />
                                ))}
                                {!loading && !error && (analysis?.hubs.length ?? 0) === 0 && (
                                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm font-semibold text-gray-500">
                                        No multi-route hubs were discovered for this schedule set.
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="rounded-[28px] border-2 border-violet-200 bg-violet-50 p-4 shadow-sm">
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-700">Route Pairs</p>
                            <h3 className="mt-1 text-lg font-extrabold text-violet-950">Most fragile patterns</h3>
                            <div className="mt-3 space-y-3">
                                {displayedPatterns.map((pattern) => (
                                    <button
                                        key={pattern.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedHubId(pattern.hubId);
                                            setSelectedPatternId(pattern.id);
                                            setSelectedOpportunityId(null);
                                        }}
                                        className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${pattern.id === selectedPattern?.id ? 'border-violet-400 bg-white shadow-sm' : 'border-violet-200 bg-white hover:border-violet-300'}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-sm font-extrabold text-gray-900">
                                                {pattern.fromService.routeNumber} {pattern.fromService.direction} -&gt; {pattern.toService.routeNumber} {pattern.toService.direction}
                                            </div>
                                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${severityPillClass(pattern.severity)}`}>{pattern.severity}</span>
                                        </div>
                                        <div className="mt-2 text-xs font-semibold text-gray-500">
                                            {pattern.opportunityCount} opportunities · {Math.round(pattern.missRate * 100)}% missed · median {formatWait(pattern.medianWaitMinutes)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-[28px] border-2 border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-700">Saved Actions</p>
                                    <h3 className="text-lg font-extrabold text-emerald-950">Pinned recommendations</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
                                        {savedRecommendations.length}
                                    </div>
                                    {loadingObservedData && (
                                        <div className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
                                            Loading demand
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mb-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleExportSavedActions}
                                    disabled={savedActionRows.length === 0}
                                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-extrabold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Download size={12} />
                                    Export CSV
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleCopySavedActionsBrief()}
                                    disabled={savedActionRows.length === 0}
                                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-extrabold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Share2 size={12} />
                                    Copy Brief
                                </button>
                            </div>
                            <div className="mb-3 flex flex-wrap gap-2">
                                {([
                                    ['all', 'All'],
                                    ['new', 'New'],
                                    ['reviewing', 'Reviewing'],
                                    ['accepted', 'Accepted'],
                                    ['implemented', 'Implemented'],
                                ] as Array<[typeof savedStatusFilter, string]>).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setSavedStatusFilter(value)}
                                        className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] transition-colors ${
                                            savedStatusFilter === value
                                                ? 'bg-emerald-700 text-white'
                                                : 'bg-white text-emerald-800 hover:bg-emerald-100'
                                        }`}
                                    >
                                        {label} {savedStatusCounts[value]}
                                    </button>
                                ))}
                            </div>
                            <div className="max-h-[760px] space-y-3 overflow-auto pr-1 custom-scrollbar">
                                {filteredSavedActionRows.map(({ recommendation: saved, observed }) => {
                                    const active = saved.patternId === selectedPattern?.id
                                        && saved.dayType === dayType
                                        && saved.timeBand === timeBand;

                                    return (
                                        <div
                                            key={saved.id}
                                            className={`rounded-2xl border p-4 transition-colors ${
                                                active ? 'border-emerald-400 bg-white shadow-sm' : 'border-emerald-200 bg-white/80'
                                            }`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => applySavedRecommendation(saved)}
                                                className="w-full text-left"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-extrabold text-gray-900">{saved.recommendationTitle}</div>
                                                        <div className="mt-1 text-xs font-semibold text-gray-500">
                                                            {saved.patternLabel} · {saved.hubName}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${recommendationStatusClass(saved.status)}`}>
                                                            {saved.status}
                                                        </span>
                                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${severityPillClass(saved.patternSeverity)}`}>
                                                            {saved.recommendationType}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="mt-2 text-xs font-semibold leading-relaxed text-gray-600">
                                                    {saved.recommendationSummary}
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em]">
                                                    <span className={`rounded-full px-2.5 py-1 ${observedDemandClass(observed.demandLevel)}`}>
                                                        {observed.hasObservedMatch ? `${observed.demandLevel} demand` : 'No observed match'}
                                                    </span>
                                                    <span className="rounded-full bg-white px-2.5 py-1 text-gray-500">
                                                        {observed.hasObservedMatch ? `${observed.totalObservedTransfers} transfers` : 'Schedule only'}
                                                    </span>
                                                    {observed.priorityTier !== 'none' && (
                                                        <span className="rounded-full bg-white px-2.5 py-1 text-gray-500">
                                                            {observed.priorityTier} priority
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
                                                    <span className="rounded-full bg-emerald-100 px-2.5 py-1">{saved.dayType}</span>
                                                    <span className="rounded-full bg-emerald-100 px-2.5 py-1">{saved.timeBand.replace('_', ' ')}</span>
                                                    <span className="rounded-full bg-white px-2.5 py-1 text-gray-500">{formatSavedTimestamp(saved.updatedAt)}</span>
                                                </div>
                                            </button>
                                            <div className="mt-3 flex items-start justify-between gap-3">
                                                <div className="text-xs font-semibold text-gray-500">
                                                    {observed.matchedStopName
                                                        ? `${observed.matchedStopName} · ${saved.opportunityLabel ?? 'No pinned trip opportunity'}`
                                                        : saved.opportunityLabel ?? 'No pinned trip opportunity'}
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-2">
                                                    {(['new', 'reviewing', 'accepted', 'implemented'] as SavedNetworkConnectionRecommendationStatus[]).map((status) => (
                                                        <button
                                                            key={status}
                                                            type="button"
                                                            onClick={() => handleUpdateSavedRecommendationStatus(saved.id, status)}
                                                            className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] transition-colors ${
                                                                saved.status === status
                                                                    ? `${recommendationStatusClass(status)} border-transparent`
                                                                    : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100'
                                                            }`}
                                                        >
                                                            {status}
                                                        </button>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteSavedRecommendation(saved.id)}
                                                        className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-emerald-800 transition-colors hover:bg-emerald-100"
                                                    >
                                                        <Trash2 size={12} />
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {filteredSavedActionRows.length === 0 && (
                                    <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/80 px-4 py-6 text-sm font-semibold text-emerald-900">
                                        {savedRecommendations.length === 0
                                            ? 'Save a recommendation from the detail rail to build a reusable shortlist of network fixes.'
                                            : 'No saved actions match the current status filter.'}
                                    </div>
                                )}
                            </div>
                        </section>
                    </aside>

                    <section className="rounded-[32px] border-2 border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">Network Map</p>
                                <h3 className="text-xl font-extrabold text-gray-900">Transfer hubs and route context</h3>
                                <p className="mt-1 text-sm font-semibold text-gray-500">
                                    The map locks onto the selected hub, highlights the chosen route pair, and can trace a specific transfer opportunity between stops.
                                </p>
                            </div>
                            {analysis && (
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50 px-4 py-3">
                                        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Hubs</div>
                                        <div className="mt-1 text-2xl font-extrabold text-cyan-950">{analysis.summary.hubCount}</div>
                                    </div>
                                    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
                                        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-700">Weak Pairs</div>
                                        <div className="mt-1 text-2xl font-extrabold text-amber-950">{analysis.summary.weakPatternCount}</div>
                                    </div>
                                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3">
                                        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Avg Wait</div>
                                        <div className="mt-1 text-2xl font-extrabold text-emerald-950">
                                            {analysis.summary.avgObservedWaitMinutes == null ? '-' : `${analysis.summary.avgObservedWaitMinutes}m`}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="rounded-[28px] border border-gray-200 bg-gray-50 p-3">
                            {loading ? (
                                <div className="grid min-h-[560px] place-items-center rounded-[24px] bg-white">
                                    <div className="flex items-center gap-3 text-sm font-semibold text-gray-500">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Building network connection view...
                                    </div>
                                </div>
                            ) : error ? (
                                <div className="grid min-h-[560px] place-items-center rounded-[24px] border border-dashed border-amber-200 bg-amber-50 p-8 text-center">
                                    <div className="max-w-md">
                                        <TriangleAlert className="mx-auto h-8 w-8 text-amber-600" />
                                        <h4 className="mt-3 text-lg font-extrabold text-amber-950">Connection analysis unavailable</h4>
                                        <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-900">{error}</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white bg-white/80 px-3 py-2">
                                        {selectedPattern ? (
                                            <>
                                                <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Focus Pair</span>
                                                <span className="text-sm font-extrabold text-gray-900">
                                                    {selectedPattern.fromService.routeNumber} {selectedPattern.fromService.direction} -&gt; {selectedPattern.toService.routeNumber} {selectedPattern.toService.direction}
                                                </span>
                                                {selectedOpportunity && (
                                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${opportunityPillClass(selectedOpportunity.classification)}`}>
                                                        {formatOpportunityClass(selectedOpportunity.classification)}
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-sm font-semibold text-gray-500">Select a hub or route pair to focus the map.</span>
                                        )}
                                    </div>
                                    <NetworkConnectionsMap
                                        hubs={analysis?.hubs ?? []}
                                        selectedHubId={selectedHub?.id ?? null}
                                        onSelectHub={(hubId) => {
                                            setSelectedHubId(hubId);
                                            setSelectedPatternId(null);
                                            setSelectedOpportunityId(null);
                                        }}
                                        backgroundRouteShapes={backgroundRouteShapes}
                                        focusRouteShapes={focusRouteShapes}
                                        hubStops={selectedHub?.stops ?? []}
                                        selectedOpportunity={selectedOpportunity}
                                    />
                                </div>
                            )}
                        </div>
                    </section>

                    <aside className="space-y-4">
                        <section className="rounded-[28px] border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">Selected Hub</p>
                                    <h3 className="mt-1 text-xl font-extrabold text-gray-900">{selectedHub?.name ?? 'No hub selected'}</h3>
                                </div>
                                {selectedHub && (
                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${severityPillClass(selectedHub.severity)}`}>
                                        {selectedHub.severity}
                                    </span>
                                )}
                            </div>

                            {selectedHub ? (
                                <>
                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50 p-3">
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Routes</div>
                                            <div className="mt-1 text-lg font-extrabold text-cyan-950">{selectedHub.routeNumbers.join(', ')}</div>
                                        </div>
                                        <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 p-3">
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-700">Hub Type</div>
                                            <div className="mt-1 text-lg font-extrabold capitalize text-violet-950">{selectedHub.hubType.replace('_', ' ')}</div>
                                        </div>
                                    </div>
                                    <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                        <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                                            <Bus size={16} />
                                            Immediate read
                                        </div>
                                        <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-600">{selectedHub.topRecommendationSummary}</p>
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {selectedHub.stops.map((stop) => (
                                            <span key={stop.stopId} className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
                                                {stop.stopName}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="mt-3 text-sm font-semibold text-gray-500">
                                    Select a hub from the map or ranking rail to inspect route pairs and recommendations.
                                </p>
                            )}
                        </section>

                        <section className="rounded-[28px] border-2 border-amber-200 bg-amber-50 p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <GitBranch size={16} className="text-amber-700" />
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-700">Route Pair Detail</p>
                                    <h3 className="text-lg font-extrabold text-amber-950">Selected connection pattern</h3>
                                </div>
                            </div>

                            <div className="mt-4 space-y-3">
                                {selectedPatterns.map((pattern) => (
                                    <button
                                        key={pattern.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedPatternId(pattern.id);
                                            setSelectedOpportunityId(null);
                                        }}
                                        className={`w-full rounded-2xl border p-4 text-left transition-colors ${pattern.id === selectedPattern?.id ? 'border-amber-400 bg-white shadow-sm' : 'border-amber-200 bg-white/80 hover:border-amber-300'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm font-extrabold text-gray-900">
                                                    {pattern.fromService.routeNumber} {pattern.fromService.direction} -&gt; {pattern.toService.routeNumber} {pattern.toService.direction}
                                                </div>
                                                <div className="mt-1 text-xs font-semibold text-gray-500">
                                                    {pattern.opportunityCount} opportunities · {pattern.missedCount} missed · median {formatWait(pattern.medianWaitMinutes)}
                                                </div>
                                            </div>
                                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${severityPillClass(pattern.severity)}`}>{pattern.severity}</span>
                                        </div>
                                    </button>
                                ))}
                                {!selectedPatterns.length && (
                                    <p className="text-sm font-semibold text-amber-900">
                                        No recurring route-pair patterns were derived for this hub in the selected time band.
                                    </p>
                                )}
                            </div>

                            {selectedPattern && (
                                <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-white p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-extrabold text-gray-900">
                                                {selectedPattern.fromService.routeNumber} {selectedPattern.fromService.direction} -&gt; {selectedPattern.toService.routeNumber} {selectedPattern.toService.direction}
                                            </div>
                                            <p className="mt-1 text-xs font-semibold leading-relaxed text-gray-500">
                                                This pair is the active map focus. Selecting a trip below will trace the transfer path between stops.
                                            </p>
                                        </div>
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${severityPillClass(selectedPattern.severity)}`}>{selectedPattern.severity}</span>
                                    </div>

                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3">
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-red-700">Missed</div>
                                            <div className="mt-1 text-lg font-extrabold text-red-950">{selectedPattern.missedCount}</div>
                                        </div>
                                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Good or Tight</div>
                                            <div className="mt-1 text-lg font-extrabold text-emerald-950">{selectedPattern.goodCount + selectedPattern.tightCount}</div>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-700">Median Wait</div>
                                            <div className="mt-1 text-lg font-extrabold text-slate-950">{formatWait(selectedPattern.medianWaitMinutes)}</div>
                                        </div>
                                    </div>

                                    <div className="mt-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Observed Transfer Weight</div>
                                                <div className="mt-1 text-sm font-extrabold text-cyan-950">
                                                    {selectedPatternObserved?.hasObservedMatch
                                                        ? `${selectedPatternObserved.totalObservedTransfers} observed transfers`
                                                        : loadingObservedData
                                                            ? 'Loading observed transfer data...'
                                                            : 'No observed transfer match'}
                                                </div>
                                            </div>
                                            {selectedPatternObserved && (
                                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${observedDemandClass(selectedPatternObserved.demandLevel)}`}>
                                                    {selectedPatternObserved.hasObservedMatch ? `${selectedPatternObserved.demandLevel} demand` : 'schedule only'}
                                                </span>
                                            )}
                                        </div>
                                        {selectedPatternObserved?.hasObservedMatch && (
                                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold">
                                                <div className="rounded-xl border border-cyan-200 bg-white px-3 py-2 text-gray-600">
                                                    <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Observed Wait</div>
                                                    <div className="mt-1 text-sm font-extrabold text-cyan-950">
                                                        {selectedPatternObserved.avgObservedWaitMinutes == null ? '-' : `${selectedPatternObserved.avgObservedWaitMinutes} min`}
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-cyan-200 bg-white px-3 py-2 text-gray-600">
                                                    <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Priority</div>
                                                    <div className="mt-1 text-sm font-extrabold text-cyan-950">{selectedPatternObserved.priorityTier}</div>
                                                </div>
                                                <div className="rounded-xl border border-cyan-200 bg-white px-3 py-2 text-gray-600">
                                                    <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-700">Observed Bands</div>
                                                    <div className="mt-1 text-sm font-extrabold text-cyan-950">{formatObservedTimeBands(selectedPatternObserved.dominantTimeBands)}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        {selectedPattern.recommendations.map((recommendation) => {
                                            const savedId = buildSavedRecommendationId(dayType, timeBand, selectedPattern.id, recommendation.id);
                                            const isSaved = savedRecommendations.some((item) => item.id === savedId);

                                            return (
                                                <div key={recommendation.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-extrabold text-amber-950">{recommendation.title}</div>
                                                            <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-900">
                                                                {recommendation.summary}
                                                            </p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSaveRecommendation(recommendation)}
                                                            className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-extrabold transition-colors ${
                                                                isSaved
                                                                    ? 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                                                                    : 'border-amber-300 bg-white text-amber-900 hover:bg-amber-100'
                                                            }`}
                                                        >
                                                            <Star size={12} className={isSaved ? 'fill-current' : ''} />
                                                            {isSaved ? 'Saved' : 'Save'}
                                                        </button>
                                                    </div>
                                                    <div className="mt-2 text-xs font-semibold leading-relaxed text-gray-600">
                                                        {recommendation.rationale}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => openPublishedRoute(selectedPattern.fromService.routeNumber, selectedPattern.fromService.dayType)}
                                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-extrabold text-gray-700 transition-colors hover:bg-white"
                                        >
                                            Open Route {selectedPattern.fromService.routeNumber}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openPublishedRoute(selectedPattern.toService.routeNumber, selectedPattern.toService.dayType)}
                                            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-extrabold text-gray-700 transition-colors hover:bg-white"
                                        >
                                            Open Route {selectedPattern.toService.routeNumber}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!teamId || !userId) {
                                                    toast?.warning('Sign In Required', 'Sign in and join a team to copy a route into the editor.');
                                                    return;
                                                }
                                                void copyRouteToDraftAndOpenEditor(selectedPattern, 'from', teamId, userId, setDraftHandoffKey, toast);
                                            }}
                                            disabled={!userId || draftHandoffKey === `${selectedPattern.id}-from`}
                                            className="inline-flex items-center gap-1 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-extrabold text-cyan-800 transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {draftHandoffKey === `${selectedPattern.id}-from` ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                                            Draft {selectedPattern.fromService.routeNumber}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!teamId || !userId) {
                                                    toast?.warning('Sign In Required', 'Sign in and join a team to copy a route into the editor.');
                                                    return;
                                                }
                                                void copyRouteToDraftAndOpenEditor(selectedPattern, 'to', teamId, userId, setDraftHandoffKey, toast);
                                            }}
                                            disabled={!userId || draftHandoffKey === `${selectedPattern.id}-to`}
                                            className="inline-flex items-center gap-1 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-extrabold text-cyan-800 transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {draftHandoffKey === `${selectedPattern.id}-to` ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                                            Draft {selectedPattern.toService.routeNumber}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="rounded-[28px] border-2 border-gray-200 bg-white p-5 shadow-sm">
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">Trip Opportunities</p>
                            <h3 className="mt-1 text-lg font-extrabold text-gray-900">Map-linked timing details</h3>
                            {displayedOpportunities.length > 0 ? (
                                <div className="mt-4 space-y-3">
                                    {displayedOpportunities.map((opportunity) => {
                                        const id = opportunityKey(opportunity);
                                        const selected = selectedOpportunityId === id;

                                        return (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => setSelectedOpportunityId(id)}
                                                className={`w-full rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-brand-blue bg-cyan-50 shadow-sm' : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white'}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-extrabold text-gray-900">
                                                            {formatTime(opportunity.fromTime)} from {opportunity.fromStopName}
                                                        </div>
                                                        <div className="mt-1 text-xs font-semibold text-gray-500">
                                                            {opportunity.toTime == null ? 'No departure was found inside the connection window.' : `${formatTime(opportunity.toTime)} to ${opportunity.toStopName}`}
                                                        </div>
                                                    </div>
                                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${opportunityPillClass(opportunity.classification)}`}>
                                                        {formatOpportunityClass(opportunity.classification)}
                                                    </span>
                                                </div>
                                                <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold">
                                                    <span className="text-gray-500">Wait {formatWait(opportunity.waitMinutes)}</span>
                                                    <span className="text-gray-400">{selected ? 'Highlighted on map' : 'Select to trace on map'}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm font-semibold text-gray-500">
                                    Select a route pair with recurring opportunities to inspect stop-level timing.
                                </p>
                            )}
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default NetworkConnectionsWorkspace;
