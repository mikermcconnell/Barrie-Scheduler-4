
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionLibrary, RouteConnectionConfig } from '../../../utils/connections/connectionTypes';
import { AlertTriangle, Clock3, GitCompare, Loader2, RefreshCw, X } from 'lucide-react';
import { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import { ScheduleEditor } from '../../ScheduleEditor';
import { useUndoRedo } from '../../../hooks/useUndoRedo';
import { AutoSaveStatus } from '../../../hooks/useAutoSave';

import { TimeBand, TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { buildStep2ApprovedRuntimeModelFromContract } from '../utils/step2ApprovedRuntimeModelAdapter';
import type { ApprovedRuntimeContract } from '../utils/step2ReviewTypes';
import type { ApprovedRuntimeModel } from '../utils/wizardState';
import { getMasterSchedule } from '../../../utils/services/masterScheduleService';
import {
    buildDetailedMasterComparison,
    buildMasterComparisonChangeSummary,
} from '../../../utils/schedule/masterComparison';
import {
    DEFAULT_MIN_HOLD_RECOVERY_MINUTES,
    estimateHeadwayTargets,
    holdRoundTripHeadways,
    type HeadwayHoldResult,
} from '../../../utils/schedule/headwayHold';
import type { HeadwayTargetCell } from '../../schedule/RoundTripTableView';
import { TimeUtils } from '../../../utils/timeUtils';

interface Step4ScheduleProps {
    initialSchedules: MasterRouteTable[];
    originalSchedules?: MasterRouteTable[];
    editorSessionKey: number;
    bands: TimeBand[];
    analysis?: TripBucketAnalysis[];
    segmentNames?: string[];
    onUpdateSchedules: (schedules: MasterRouteTable[]) => void;
    projectName: string;
    autoSaveStatus?: AutoSaveStatus;
    lastSaved?: Date | null;
    targetCycleTime?: number;
    targetHeadway?: number;
    teamId?: string;
    userId?: string;
    routeIdentity?: string;
    routeLabel?: string;
    connectionScopeSchedules?: MasterRouteTable[];
    approvedRuntimeContract?: ApprovedRuntimeContract | null;
    approvedRuntimeModel?: ApprovedRuntimeModel | null;
    /** Open the editor comparing against the generated baseline. */
    compareGeneratedByDefault?: boolean;
    /** When set, the planner can accept the current schedule as the new generated baseline. */
    onAcceptBaseline?: (schedules: MasterRouteTable[]) => void;
    /** Starting state of the editor's Connections and Focus toggles. */
    initialShowConnections?: boolean;
    initialFocusMode?: boolean;
    /** Connections set up in this session (Guided Schedule), shown in the editor's connection chips. */
    connectionLibraryOverride?: ConnectionLibrary | null;
    routeConnectionConfigOverride?: RouteConnectionConfig | null;
    /** Target headways the planner typed, by round-trip row key. Kept in local state when not provided. */
    headwayTargets?: Record<string, number>;
    onHeadwayTargetsChange?: (targets: Record<string, number>) => void;
}

type MasterCompareStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface Step4MasterCompareState {
    status: MasterCompareStatus;
    baseline: MasterRouteTable[] | null;
    loadedRouteIdentity?: string;
    loadedEditorSessionKey?: number;
    loadedAt?: Date;
    error?: string;
}

const extractPublishedMasterTables = (result: Awaited<ReturnType<typeof getMasterSchedule>> | null): MasterRouteTable[] | null => {
    const tables = [
        result?.content?.northTable,
        result?.content?.southTable,
    ].filter((table): table is MasterRouteTable => !!table);

    return tables.length > 0 ? tables : null;
};

export const Step4Schedule: React.FC<Step4ScheduleProps> = ({
    initialSchedules,
    originalSchedules,
    editorSessionKey,
    onUpdateSchedules,
    projectName,
    autoSaveStatus,
    lastSaved,
    targetCycleTime,
    targetHeadway,
    teamId,
    userId,
    routeIdentity,
    routeLabel,
    connectionScopeSchedules,
    approvedRuntimeContract,
    compareGeneratedByDefault = false,
    onAcceptBaseline,
    initialShowConnections,
    initialFocusMode,
    connectionLibraryOverride,
    routeConnectionConfigOverride,
    headwayTargets,
    onHeadwayTargetsChange,
}) => {
    const resolvedOriginalSchedules = originalSchedules && originalSchedules.length > 0
        ? originalSchedules
        : initialSchedules;

    // Snapshot the original schedules on first mount so deltas remain stable
    // even after edits sync back to the parent via onUpdateSchedules
    const [originalSnapshot, setOriginalSnapshot] = useState<MasterRouteTable[]>(() => resolvedOriginalSchedules);
    const lastSyncedSchedulesRef = useRef<MasterRouteTable[] | null>(initialSchedules);
    const latestInitialSchedulesRef = useRef(initialSchedules);
    const latestResolvedOriginalSchedulesRef = useRef(resolvedOriginalSchedules);
    const compareRequestTokenRef = useRef(0);
    const [masterCompare, setMasterCompare] = useState<Step4MasterCompareState>({
        status: 'idle',
        baseline: null,
    });
    const [isMasterCompareModalOpen, setIsMasterCompareModalOpen] = useState(false);
    const [localHeadwayTargets, setLocalHeadwayTargets] = useState<Record<string, number>>({});
    const [lastHeadwayFix, setLastHeadwayFix] = useState<(Omit<HeadwayHoldResult, 'schedules'> & {
        appliedTo: MasterRouteTable[];
    }) | null>(null);
    const [acceptedHeadwayFlags, setAcceptedHeadwayFlags] = useState<Set<string>>(() => new Set());

    const resolvedApprovedRuntimeModel = React.useMemo(
        () => buildStep2ApprovedRuntimeModelFromContract(approvedRuntimeContract),
        [approvedRuntimeContract]
    );
    // Step 4 must never substitute live/re-derived Step 2 data for a missing or
    // stale approval. The wizard gate normally prevents this state; empty
    // context here keeps the component fail-closed if it is rendered directly.
    const resolvedStep4Bands = resolvedApprovedRuntimeModel?.bands ?? [];
    const resolvedStep4Analysis = resolvedApprovedRuntimeModel?.buckets ?? [];
    const resolvedStep4SegmentNames = resolvedApprovedRuntimeModel?.segmentColumns.map(column => column.segmentName) ?? [];
    latestInitialSchedulesRef.current = initialSchedules;
    latestResolvedOriginalSchedulesRef.current = resolvedOriginalSchedules;

    // We use a local Undo/Redo stack for the session in this step
    // syncing changes back to the parent for persistence
    const {
        state: schedules,
        set: setSchedules,
        undo, redo, canUndo, canRedo,
        reset: resetSchedules
    } = useUndoRedo<MasterRouteTable[]>(initialSchedules, { maxHistory: 50, deepCompare: false });

    // Only reset the local Step 4 editor session when the wizard explicitly starts
    // a new Step 4 payload (fresh generation, resume, or project load).
    useEffect(() => {
        const nextInitialSchedules = latestInitialSchedulesRef.current;
        lastSyncedSchedulesRef.current = nextInitialSchedules;
        setOriginalSnapshot(latestResolvedOriginalSchedulesRef.current);
        resetSchedules(nextInitialSchedules);
    }, [editorSessionKey, resetSchedules]);

    const handleResetOriginals = useCallback(() => {
        setSchedules(originalSnapshot);
    }, [originalSnapshot, setSchedules]);

    const handleAcceptChanges = useCallback(() => {
        if (!onAcceptBaseline) return;
        if (!window.confirm('Make the current schedule the new generated baseline? Changes are then shown against it, and Reset to Generated returns to it.')) return;
        setOriginalSnapshot(schedules);
        onAcceptBaseline(schedules);
    }, [onAcceptBaseline, schedules]);

    const resolvedRouteIdentity = routeIdentity ?? approvedRuntimeContract?.routeIdentity;
    const resolvedRouteLabel = routeLabel
        ?? (approvedRuntimeContract ? `Route ${approvedRuntimeContract.routeNumber} - ${approvedRuntimeContract.dayType}` : resolvedRouteIdentity)
        ?? 'this route/day';
    const compareScopeReady = !!teamId && !!resolvedRouteIdentity;
    const isCompareCurrent = (
        masterCompare.status === 'ready'
        && masterCompare.loadedRouteIdentity === resolvedRouteIdentity
        && masterCompare.loadedEditorSessionKey === editorSessionKey
    );
    const isCompareStale = (
        masterCompare.status === 'ready'
        && !isCompareCurrent
    );

    const compareSummary = useMemo(() => {
        if (!isCompareCurrent || !masterCompare.baseline) return null;

        const detailed = buildDetailedMasterComparison(schedules, masterCompare.baseline);
        const changeSummary = buildMasterComparisonChangeSummary(schedules, detailed);
        const matchedCount = Array.from(detailed.currentTripComparisons.values())
            .filter(entry => entry.status === 'matched')
            .length;

        return {
            matched: matchedCount,
            ...changeSummary.counts,
        };
    }, [isCompareCurrent, masterCompare.baseline, schedules]);

    const hasCompareWarnings = !!compareSummary && (
        compareSummary.new > 0
        || compareSummary.removed > 0
        || compareSummary.review > 0
    );

    const handleLoadMasterCompare = useCallback(async () => {
        if (!teamId || !resolvedRouteIdentity) {
            setMasterCompare({
                status: 'error',
                baseline: null,
                error: 'Join a team and select a route/day before loading comparison.',
            });
            return;
        }

        const requestToken = compareRequestTokenRef.current + 1;
        compareRequestTokenRef.current = requestToken;
        setMasterCompare(current => ({
            ...current,
            status: 'loading',
            error: undefined,
        }));

        try {
            const result = await getMasterSchedule(teamId, resolvedRouteIdentity as any);
            if (compareRequestTokenRef.current !== requestToken) return;

            const baseline = extractPublishedMasterTables(result);
            if (!baseline) {
                setMasterCompare({
                    status: 'unavailable',
                    baseline: null,
                    loadedRouteIdentity: resolvedRouteIdentity,
                    loadedEditorSessionKey: editorSessionKey,
                    loadedAt: new Date(),
                });
                return;
            }

            setMasterCompare({
                status: 'ready',
                baseline,
                loadedRouteIdentity: resolvedRouteIdentity,
                loadedEditorSessionKey: editorSessionKey,
                loadedAt: new Date(),
            });
            setIsMasterCompareModalOpen(true);
        } catch (error) {
            if (compareRequestTokenRef.current !== requestToken) return;
            console.error('Failed to load Step 4 master comparison:', error);
            setMasterCompare({
                status: 'error',
                baseline: null,
                loadedRouteIdentity: resolvedRouteIdentity,
                loadedEditorSessionKey: editorSessionKey,
                loadedAt: new Date(),
                error: 'Could not load the published master schedule.',
            });
        }
    }, [editorSessionKey, resolvedRouteIdentity, teamId]);

    const buildTargetHeadway = Number.isFinite(targetHeadway || NaN) && (targetHeadway || 0) > 0
        ? Math.round(targetHeadway as number)
        : null;

    const typedHeadwayTargets = headwayTargets ?? localHeadwayTargets;
    const setTypedHeadwayTargets = onHeadwayTargetsChange ?? setLocalHeadwayTargets;
    const headwayEstimates = useMemo(() => estimateHeadwayTargets(schedules), [schedules]);
    const headwayTargetCells = useMemo(() => {
        const cells: Record<string, HeadwayTargetCell> = {};
        Object.entries(headwayEstimates).forEach(([rowKey, estimate]) => {
            const typed = typedHeadwayTargets[rowKey];
            cells[rowKey] = { value: typed ?? estimate, typed: typed !== undefined, estimate };
        });
        return cells;
    }, [headwayEstimates, typedHeadwayTargets]);

    const handleHeadwayTargetChange = useCallback((rowKey: string, value: number | null) => {
        const next = { ...typedHeadwayTargets };
        if (value === null) delete next[rowKey];
        else next[rowKey] = value;
        setTypedHeadwayTargets(next);
    }, [setTypedHeadwayTargets, typedHeadwayTargets]);

    const handleFixHeadways = useCallback(() => {
        const result = holdRoundTripHeadways(schedules, typedHeadwayTargets, {
            minRecoveryMinutes: DEFAULT_MIN_HOLD_RECOVERY_MINUTES,
        });
        const { schedules: fixedSchedules, ...summary } = result;
        const changed = summary.changedRecoveryCount > 0 || summary.movedTripCount > 0;
        if (changed) setSchedules(fixedSchedules);
        setAcceptedHeadwayFlags(new Set());
        setLastHeadwayFix({ ...summary, appliedTo: changed ? fixedSchedules : schedules });
    }, [schedules, setSchedules, typedHeadwayTargets]);

    // Flags belong to the table Fix produced; any later edit or undo clears them.
    const openHeadwayFlags = lastHeadwayFix && lastHeadwayFix.appliedTo === schedules
        ? lastHeadwayFix.flags.filter(flag => !acceptedHeadwayFlags.has(flag.recoveryRowKey))
        : [];
    const headwayFlagMessages = useMemo(() => Object.fromEntries(openHeadwayFlags.map(flag => [
        flag.recoveryRowKey,
        flag.kind === 'overlap'
            ? `Block ${flag.blockId}: not enough time to reach the next trip. Recovery is 0 min.`
            : `Block ${flag.blockId}: only ${flag.recoveryMinutes} min recovery (minimum ${DEFAULT_MIN_HOLD_RECOVERY_MINUTES}).`,
    ])), [openHeadwayFlags]);

    const reviewToolsSlot = (
        <div className="space-y-3">
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-950">
                    <Clock3 size={16} className="text-emerald-700" />
                    Fix headways
                </div>
                <p className="mt-1 text-xs leading-5 text-emerald-900">
                    Sets each trip's last recovery so it leaves at its Target headway. Trips, blocks, pull-outs and run times stay the same.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-emerald-900">
                    <span className="rounded border border-dashed border-gray-300 bg-white px-1.5 italic text-gray-500">30</span>
                    estimate
                    <span className="rounded border border-emerald-500 bg-emerald-50 px-1.5 font-bold text-gray-900">60</span>
                    you typed
                </div>
                <button
                    type="button"
                    onClick={handleFixHeadways}
                    disabled={Object.keys(headwayTargetCells).length === 0}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw size={15} />
                    Fix headways
                </button>

                {lastHeadwayFix && (
                    <div className="mt-3 space-y-2 text-xs">
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 font-semibold text-emerald-900" role="status">
                            {lastHeadwayFix.changedRecoveryCount === 0 && lastHeadwayFix.movedTripCount === 0
                                ? 'Headways already match their targets.'
                                : `Set ${lastHeadwayFix.changedRecoveryCount} recover${lastHeadwayFix.changedRecoveryCount === 1 ? 'y' : 'ies'} · ${lastHeadwayFix.movedTripCount} trip${lastHeadwayFix.movedTripCount === 1 ? '' : 's'} moved · largest move ${lastHeadwayFix.maxShiftMinutes} min.`}
                            {lastHeadwayFix.pullOutOffTarget.length > 0 && (
                                <div className="mt-1 font-normal text-emerald-800">
                                    {lastHeadwayFix.pullOutOffTarget.length} block start{lastHeadwayFix.pullOutOffTarget.length === 1 ? ' is' : 's are'} off target. Pull-outs stay fixed.
                                </div>
                            )}
                        </div>
                        {openHeadwayFlags.length > 0 && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                                <div className="font-bold">
                                    {openHeadwayFlags.length} trip{openHeadwayFlags.length === 1 ? ' needs' : 's need'} a decision (red recovery cells)
                                </div>
                                <ul className="mt-2 space-y-2">
                                    {openHeadwayFlags.map(flag => {
                                        const longer = flag.targetMinutes + (DEFAULT_MIN_HOLD_RECOVERY_MINUTES - flag.recoveryMinutes);
                                        return (
                                            <li key={flag.recoveryRowKey} className="rounded-md bg-white/80 px-2 py-1.5">
                                                <div className="font-semibold">
                                                    Block {flag.blockId}: {flag.recoveryMinutes} min recovery before the {TimeUtils.fromMinutes(flag.departureMinutes)} trip
                                                </div>
                                                <div className="mt-1 flex flex-wrap gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleHeadwayTargetChange(flag.targetRowKey, longer)}
                                                        className="rounded border border-red-200 bg-white px-2 py-0.5 font-bold text-red-800 hover:bg-red-100"
                                                        title="Sets this trip's target, then click Fix headways again"
                                                    >
                                                        Use {longer} min headway
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAcceptedHeadwayFlags(previous => new Set(previous).add(flag.recoveryRowKey))}
                                                        className="rounded border border-gray-200 bg-white px-2 py-0.5 font-bold text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Accept short recovery
                                                    </button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <div className="mt-2 text-[11px] text-red-800">To add a bus, add a block in Step 3.</div>
                            </div>
                        )}
                    </div>
                )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                    <GitCompare size={16} className="text-indigo-600" />
                    Compare to master
                </div>
                <p className="mt-1 text-xs leading-5 text-gray-600">
                    Review differences from the published master for {resolvedRouteLabel}. Publishing is not blocked.
                </p>

                {masterCompare.status === 'unavailable' && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        No published master found for {resolvedRouteLabel}.
                    </div>
                )}

                {masterCompare.status === 'error' && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        {masterCompare.error || 'Could not load master comparison.'}
                    </div>
                )}

                {isCompareStale && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        Refresh before trusting visible deltas.
                    </div>
                )}

                {isCompareCurrent && compareSummary && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {[
                            ['Matched', compareSummary.matched, 'border-slate-200 bg-white text-slate-700'],
                            ['Retimed', compareSummary.retimed, 'border-indigo-200 bg-indigo-50 text-indigo-800'],
                            ['New', compareSummary.new, 'border-green-200 bg-green-50 text-green-800'],
                            ['Removed', compareSummary.removed, 'border-red-200 bg-red-50 text-red-800'],
                            ['Review', compareSummary.review, 'border-amber-200 bg-amber-50 text-amber-900'],
                        ].map(([label, count, className]) => (
                            <span
                                key={label}
                                className={`rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}
                            >
                                {label} {count}
                            </span>
                        ))}
                        {hasCompareWarnings && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">
                                <AlertTriangle size={12} />
                                Review
                            </span>
                        )}
                    </div>
                )}

                <div className="mt-3 grid gap-2">
                    {isCompareCurrent && (
                        <button
                            type="button"
                            onClick={() => setIsMasterCompareModalOpen(true)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            <GitCompare size={14} />
                            Open schedule comparison
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => { void handleLoadMasterCompare(); }}
                        disabled={!compareScopeReady || masterCompare.status === 'loading'}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        title={!compareScopeReady ? 'A team and route/day are required before comparison can load.' : undefined}
                    >
                        {masterCompare.status === 'loading' ? (
                            <Loader2 size={15} className="animate-spin" />
                        ) : isCompareCurrent || isCompareStale ? (
                            <RefreshCw size={15} />
                        ) : (
                            <GitCompare size={15} />
                        )}
                        {masterCompare.status === 'loading'
                            ? 'Loading comparison'
                            : isCompareCurrent || isCompareStale
                                ? 'Refresh comparison'
                                : 'Load comparison'}
                    </button>
                </div>
            </section>

            {resolvedApprovedRuntimeModel && (
                <section className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                    <div className="text-sm font-extrabold text-blue-900">Approved runtime contract</div>
                    <p className="mt-1 text-xs leading-5 text-blue-800">
                        {resolvedApprovedRuntimeModel.usableBucketCount} active bucket{resolvedApprovedRuntimeModel.usableBucketCount === 1 ? '' : 's'} across {resolvedApprovedRuntimeModel.usableBandCount} active band{resolvedApprovedRuntimeModel.usableBandCount === 1 ? '' : 's'}.
                    </p>
                    <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-blue-800">
                        <div>{resolvedApprovedRuntimeModel.chartBasis === 'observed-cycle' ? 'Observed cycle totals' : 'Uploaded bucket percentiles'}</div>
                        <div className="mt-1 text-blue-700">{resolvedApprovedRuntimeModel.directions.join(', ') || 'No directions'}</div>
                    </div>
                </section>
            )}

            {!resolvedApprovedRuntimeModel && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-amber-900">
                        <AlertTriangle size={16} />
                        Current runtime approval required
                    </div>
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                        Runtime bands and bucket details are unavailable until the current Step 2 review is approved.
                    </p>
                </section>
            )}

            {resolvedStep4Bands && resolvedStep4Bands.length > 0 && (
                <section>
                    <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500">Time bands</div>
                    <div className="mt-2 space-y-1.5">
                        {resolvedStep4Bands.map(band => (
                            <div key={band.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
                                <div className="flex items-center gap-2 font-semibold text-gray-800">
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                                    {band.id}
                                </div>
                                <span className="font-semibold text-gray-600">{band.avg.toFixed(0)}m</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );

    // Sync back to parent whenever schedules change
    useEffect(() => {
        if (lastSyncedSchedulesRef.current === schedules) return;
        lastSyncedSchedulesRef.current = schedules;
        onUpdateSchedules(schedules);
    }, [schedules, onUpdateSchedules]);

    return (
        <div data-testid="step4-schedule-shell" className="flex h-full min-h-0 flex-col overflow-hidden">
            {isMasterCompareModalOpen && isCompareCurrent && masterCompare.baseline && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/50 px-3 py-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="master-compare-title"
                        className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                    >
                        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <GitCompare size={18} className="text-indigo-600" />
                                    <h2 id="master-compare-title" className="text-lg font-extrabold text-gray-900">
                                        Compare to master
                                    </h2>
                                </div>
                                <p className="mt-1 text-sm text-gray-600">
                                    Read-only schedule view for {resolvedRouteLabel}. Timepoint cells show deltas from the published master.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMasterCompareModalOpen(false)}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Close master comparison popup"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {compareSummary && (
                            <div className="flex flex-shrink-0 flex-wrap gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
                                {[
                                    ['Matched', compareSummary.matched, 'border-slate-200 bg-white text-slate-700'],
                                    ['Retimed', compareSummary.retimed, 'border-indigo-200 bg-indigo-50 text-indigo-800'],
                                    ['New', compareSummary.new, 'border-green-200 bg-green-50 text-green-800'],
                                    ['Removed', compareSummary.removed, 'border-red-200 bg-red-50 text-red-800'],
                                    ['Review', compareSummary.review, 'border-amber-200 bg-amber-50 text-amber-900'],
                                ].map(([label, count, className]) => (
                                    <span
                                        key={label}
                                        className={`rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}
                                    >
                                        {label} {count}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="min-h-0 flex-1 bg-gray-50">
                            <ScheduleEditor
                                schedules={schedules}
                                useAuthoritativeTimepoints={true}
                                initialTimepointOnly={true}
                                condensedTimepointView={true}
                                readOnly={true}
                                embedded={true}
                                hideSidebar={true}
                                initialShowDeltas={true}
                                draftName={`${projectName} - Master comparison`}
                                autoSaveStatus="saved"
                                lastSaved={null}
                                bands={resolvedStep4Bands}
                                analysis={resolvedStep4Analysis}
                                segmentNames={resolvedStep4SegmentNames}
                                targetCycleTime={targetCycleTime}
                                targetHeadway={buildTargetHeadway ?? undefined}
                    initialShowConnections={initialShowConnections}
                    initialFocusMode={initialFocusMode}
                                masterBaseline={masterCompare.baseline}
                                compareBaselineLabel="Published master"
                            />
                        </div>
                    </div>
                </div>
            )}
            <div className="flex-grow min-h-0 overflow-hidden">
                <ScheduleEditor
                    schedules={schedules}
                    useAuthoritativeTimepoints={true}
                    initialTimepointOnly={true}
                    condensedTimepointView={true}
                    onSchedulesChange={setSchedules}
                    originalSchedules={originalSnapshot}
                    initialShowDeltas={compareGeneratedByDefault}
                    onResetOriginals={handleResetOriginals}
                    onAcceptChanges={onAcceptBaseline ? handleAcceptChanges : undefined}
                    draftName={projectName}
                    onRenameDraft={() => { }}
                    autoSaveStatus={autoSaveStatus || 'saved'}
                    lastSaved={lastSaved || null}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    undo={undo}
                    redo={redo}
                    showSuccessToast={(msg) => console.log(msg)}
                    bands={resolvedStep4Bands}
                    analysis={resolvedStep4Analysis}
                    segmentNames={resolvedStep4SegmentNames}
                    targetCycleTime={targetCycleTime}
                    targetHeadway={buildTargetHeadway ?? undefined}
                    initialShowConnections={initialShowConnections}
                    initialFocusMode={initialFocusMode}
                    connectionLibraryOverride={connectionLibraryOverride}
                    routeConnectionConfigOverride={routeConnectionConfigOverride}
                    headwayTargets={headwayTargetCells}
                    onHeadwayTargetChange={handleHeadwayTargetChange}
                    headwayFlags={headwayFlagMessages}
                    hideAutoSave={true}
                    teamId={teamId}
                    userId={userId}
                    connectionScopeSchedules={connectionScopeSchedules}
                    compactStep4
                    reviewToolsSlot={reviewToolsSlot}
                />
            </div>
        </div>
    );
};
