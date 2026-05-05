
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, GitCompare, Loader2, RefreshCw } from 'lucide-react';
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
    bands,
    analysis,
    segmentNames,
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
    const compareRequestTokenRef = useRef(0);
    const [masterCompare, setMasterCompare] = useState<Step4MasterCompareState>({
        status: 'idle',
        baseline: null,
    });
    const [showMasterDeltas, setShowMasterDeltas] = useState(true);

    const resolvedApprovedRuntimeModel = React.useMemo(
        () => buildStep2ApprovedRuntimeModelFromContract(approvedRuntimeContract),
        [approvedRuntimeContract]
    );
    const resolvedStep4Bands = resolvedApprovedRuntimeModel?.bands ?? bands;
    const resolvedStep4Analysis = resolvedApprovedRuntimeModel?.buckets ?? analysis;
    const resolvedStep4SegmentNames = resolvedApprovedRuntimeModel?.segmentColumns.map(column => column.segmentName) ?? segmentNames;

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
        lastSyncedSchedulesRef.current = initialSchedules;
        setOriginalSnapshot(resolvedOriginalSchedules);
        resetSchedules(initialSchedules);
    }, [editorSessionKey, initialSchedules, resetSchedules, resolvedOriginalSchedules]);

    const handleResetOriginals = useCallback(() => {
        setSchedules(originalSnapshot);
    }, [originalSnapshot, setSchedules]);

    const resolvedRouteIdentity = routeIdentity ?? approvedRuntimeContract?.routeIdentity;
    const resolvedRouteLabel = routeLabel
        ?? (approvedRuntimeContract ? `Route ${approvedRuntimeContract.routeNumber} · ${approvedRuntimeContract.dayType}` : resolvedRouteIdentity)
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

            setShowMasterDeltas(true);
            setMasterCompare({
                status: 'ready',
                baseline,
                loadedRouteIdentity: resolvedRouteIdentity,
                loadedEditorSessionKey: editorSessionKey,
                loadedAt: new Date(),
            });
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

    const scheduleEditorCompareProps = isCompareCurrent
        ? { masterBaseline: showMasterDeltas ? masterCompare.baseline : null }
        : {};

    // Sync back to parent whenever schedules change
    useEffect(() => {
        if (lastSyncedSchedulesRef.current === schedules) return;
        lastSyncedSchedulesRef.current = schedules;
        onUpdateSchedules(schedules);
    }, [schedules, onUpdateSchedules]);

    return (
        <div className="h-full flex flex-col -m-8 min-h-0 overflow-hidden">
            {resolvedApprovedRuntimeModel && (
                <div className="border-b border-blue-100 bg-blue-50 px-8 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wide text-blue-700">
                                Approved runtime contract
                            </div>
                            <p className="mt-1 text-sm text-blue-900">
                                This schedule was generated from the Step 2 approved model: {resolvedApprovedRuntimeModel.usableBucketCount} active bucket{resolvedApprovedRuntimeModel.usableBucketCount === 1 ? '' : 's'} across {resolvedApprovedRuntimeModel.usableBandCount} active band{resolvedApprovedRuntimeModel.usableBandCount === 1 ? '' : 's'}.
                            </p>
                        </div>
                        <div className="text-right text-xs text-blue-700">
                            <div className="font-semibold">
                                {resolvedApprovedRuntimeModel.chartBasis === 'observed-cycle' ? 'Observed cycle totals' : 'Uploaded bucket percentiles'}
                            </div>
                            <div>{resolvedApprovedRuntimeModel.directions.join(', ') || 'No directions'}</div>
                        </div>
                    </div>
                </div>
            )}
            <div className="border-b border-gray-200 bg-white px-8 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-3xl">
                        <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-gray-800">
                            <GitCompare size={16} className="text-indigo-600" />
                            Compare to master
                        </div>
                        <p className="mt-1 text-sm text-gray-600">
                            Review how this draft differs from the published master for {resolvedRouteLabel} before publishing.
                            Publishing is not blocked by this review.
                        </p>

                        {masterCompare.status === 'unavailable' && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                No published master found for {resolvedRouteLabel}.
                            </div>
                        )}

                        {masterCompare.status === 'error' && (
                            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {masterCompare.error || 'Could not load master comparison.'}
                            </div>
                        )}

                        {isCompareStale && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                This comparison is from a previous Step 4 schedule. Refresh it before trusting visible deltas.
                            </div>
                        )}

                        {isCompareCurrent && compareSummary && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                {[
                                    ['Matched', compareSummary.matched, 'border-slate-200 bg-slate-50 text-slate-700'],
                                    ['Retimed', compareSummary.retimed, 'border-indigo-200 bg-indigo-50 text-indigo-800'],
                                    ['New', compareSummary.new, 'border-green-200 bg-green-50 text-green-800'],
                                    ['Removed', compareSummary.removed, 'border-red-200 bg-red-50 text-red-800'],
                                    ['Review', compareSummary.review, 'border-amber-200 bg-amber-50 text-amber-900'],
                                ].map(([label, count, className]) => (
                                    <span
                                        key={label}
                                        className={`rounded-full border px-3 py-1 text-xs font-bold ${className}`}
                                    >
                                        {label} {count}
                                    </span>
                                ))}
                                {hasCompareWarnings && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">
                                        <AlertTriangle size={12} />
                                        Review before publishing
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {isCompareCurrent && (
                            <button
                                type="button"
                                onClick={() => setShowMasterDeltas(value => !value)}
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                {showMasterDeltas ? <EyeOff size={14} /> : <Eye size={14} />}
                                {showMasterDeltas ? 'Hide deltas' : 'Show deltas'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => { void handleLoadMasterCompare(); }}
                            disabled={!compareScopeReady || masterCompare.status === 'loading'}
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                </div>
            </div>
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
                    onSaveVersion={async () => { }}
                    onClose={() => { }}
                    onNewDraft={() => { }}
                    onOpenDrafts={() => { }}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    undo={undo}
                    redo={redo}
                    showSuccessToast={(msg) => console.log(msg)}
                    bands={resolvedStep4Bands}
                    analysis={resolvedStep4Analysis}
                    segmentNames={resolvedStep4SegmentNames}
                    targetCycleTime={targetCycleTime}
                    targetHeadway={targetHeadway}
                    hideAutoSave={true}
                    teamId={teamId}
                    userId={userId}
                    connectionScopeSchedules={connectionScopeSchedules}
                    {...scheduleEditorCompareProps}
                />
            </div>
        </div>
    );
};
