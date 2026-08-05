
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    previewScheduleHeadwayRegularization,
    regularizeScheduleHeadways,
    type HeadwayRegularizationSummary,
} from '../../../utils/schedule/headwayRegularization';

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
    const [lastHeadwayRegularization, setLastHeadwayRegularization] = useState<HeadwayRegularizationSummary | null>(null);
    const [headwayTargetOverride, setHeadwayTargetOverride] = useState<number | null>(null);
    const [isHeadwayModalOpen, setIsHeadwayModalOpen] = useState(false);
    const [headwayInput, setHeadwayInput] = useState(() => (
        targetHeadway && targetHeadway > 0 ? String(Math.round(targetHeadway)) : '30'
    ));
    const [headwayInputError, setHeadwayInputError] = useState<string | null>(null);

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
    const headwayTargetMinutes = headwayTargetOverride ?? buildTargetHeadway;

    const openHeadwayModal = useCallback(() => {
        setHeadwayInput(String(headwayTargetMinutes ?? 30));
        setHeadwayInputError(null);
        setIsHeadwayModalOpen(true);
    }, [headwayTargetMinutes]);

    const handleSaveHeadwayTarget = useCallback(() => {
        const parsed = Number(headwayInput);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setHeadwayInputError('Enter a headway greater than 0 minutes.');
            return;
        }

        const rounded = Math.round(parsed);
        setHeadwayTargetOverride(rounded);
        setLastHeadwayRegularization(null);
        setHeadwayInput(String(rounded));
        setHeadwayInputError(null);
        setIsHeadwayModalOpen(false);
    }, [headwayInput]);

    const headwaySourceLabel = headwayTargetOverride !== null
        ? 'Custom target'
        : buildTargetHeadway !== null
            ? 'Build target'
        : null;

    const headwayPreview = useMemo(() => (
        headwayTargetMinutes
            ? previewScheduleHeadwayRegularization(schedules, {
                targetHeadwayMinutes: headwayTargetMinutes,
                minRecoveryMinutes: 5,
            })
            : null
    ), [headwayTargetMinutes, schedules]);

    const handleRegularizeHeadway = useCallback(() => {
        if (!headwayTargetMinutes) return;

        const result = regularizeScheduleHeadways(schedules, {
            targetHeadwayMinutes: headwayTargetMinutes,
            minRecoveryMinutes: 5,
        });
        setSchedules(result.schedules);
        setLastHeadwayRegularization(result.summary);
    }, [headwayTargetMinutes, schedules, setSchedules]);

    const reviewToolsSlot = (
        <div className="space-y-3">
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-950">
                    <Clock3 size={16} className="text-emerald-700" />
                    Regularize headway
                </div>
                <p className="mt-1 text-xs leading-5 text-emerald-900">
                    Snap each direction to the target headway and rebalance terminal recovery. Travel times stay unchanged.
                </p>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Target</div>
                        <div className="text-sm font-extrabold text-emerald-950">
                            {headwayTargetMinutes ? `${headwayTargetMinutes} min` : 'Not set'}
                        </div>
                        {headwaySourceLabel && (
                            <div className="text-[11px] font-semibold text-emerald-700">{headwaySourceLabel}</div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={openHeadwayModal}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-extrabold text-emerald-800 hover:bg-emerald-50"
                    >
                        {headwayTargetMinutes ? 'Change target' : 'Set target'}
                    </button>
                </div>

                {headwayPreview ? (
                    <div className="mt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-white/80 px-3 py-2">
                                <div className="font-bold text-gray-500">Before</div>
                                <div className="mt-1 font-extrabold text-gray-900">
                                    {headwayPreview.before.offTargetHeadways} off-target
                                </div>
                                <div className="text-gray-600">
                                    Worst ±{headwayPreview.before.worstDeviationMinutes}m
                                </div>
                            </div>
                            <div className="rounded-lg bg-white/80 px-3 py-2">
                                <div className="font-bold text-gray-500">After</div>
                                <div className="mt-1 font-extrabold text-gray-900">
                                    {headwayPreview.after.offTargetHeadways} off-target
                                </div>
                                <div className="text-gray-600">
                                    Worst ±{headwayPreview.after.worstDeviationMinutes}m
                                </div>
                            </div>
                        </div>

                        {(headwayPreview.tightRecoveryCount > 0 || headwayPreview.overlapCount > 0) && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                                {headwayPreview.overlapCount > 0
                                    ? `${headwayPreview.overlapCount} block connection${headwayPreview.overlapCount === 1 ? '' : 's'} would overlap.`
                                    : `${headwayPreview.tightRecoveryCount} recovery window${headwayPreview.tightRecoveryCount === 1 ? '' : 's'} would be under 5 minutes.`}
                            </div>
                        )}

                        <div className="text-xs font-semibold text-emerald-900">
                            Preview: {headwayPreview.adjustedTripCount} trip{headwayPreview.adjustedTripCount === 1 ? '' : 's'} would shift, up to {headwayPreview.maxTripShiftMinutes} minutes.
                        </div>

                        {lastHeadwayRegularization && (
                            <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900">
                                Applied: {lastHeadwayRegularization.adjustedTripCount} trip{lastHeadwayRegularization.adjustedTripCount === 1 ? '' : 's'} shifted, {lastHeadwayRegularization.changedRecoveryCount} recovery value{lastHeadwayRegularization.changedRecoveryCount === 1 ? '' : 's'} updated.
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={handleRegularizeHeadway}
                            disabled={headwayPreview.before.totalHeadways === 0}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw size={15} />
                            Regularize to {headwayTargetMinutes} min
                        </button>
                    </div>
                ) : (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        Set a target headway before using this tool.
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
            {isHeadwayModalOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/40 px-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="headway-target-title"
                        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 id="headway-target-title" className="text-lg font-extrabold text-gray-900">
                                    Set target headway
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-gray-600">
                                    Choose the clock-face spacing Step 4 should regularize toward. This only changes trip timing and terminal recovery.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsHeadwayModalOpen(false)}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Close target headway modal"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <label className="mt-4 block">
                            <span className="text-sm font-bold text-gray-800">Target headway, minutes</span>
                            <input
                                type="number"
                                min={1}
                                step={1}
                                value={headwayInput}
                                onChange={event => {
                                    setHeadwayInput(event.target.value);
                                    setHeadwayInputError(null);
                                }}
                                className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-base font-semibold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            />
                        </label>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {[15, 20, 30, 60].map(value => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => {
                                        setHeadwayInput(String(value));
                                        setHeadwayInputError(null);
                                    }}
                                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-700 hover:bg-emerald-50 hover:text-emerald-800"
                                >
                                    {value} min
                                </button>
                            ))}
                        </div>

                        {headwayInputError && (
                            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                                {headwayInputError}
                            </div>
                        )}

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsHeadwayModalOpen(false)}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveHeadwayTarget}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                            >
                                Use target
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
                                targetHeadway={headwayTargetMinutes ?? undefined}
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
                    initialShowDeltas={false}
                    onResetOriginals={handleResetOriginals}
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
                    targetHeadway={headwayTargetMinutes ?? undefined}
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
