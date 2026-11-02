import React, { useEffect, useMemo } from 'react';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionLibrary } from '../../../utils/connections/connectionTypes';
import type { ApprovedRuntimeContract } from '../../NewSchedule/utils/step2ReviewTypes';
import { Step4Schedule } from '../../NewSchedule/steps/Step4Schedule';
import { GuidedConnections, type ConnectionsApplySummary } from '../connections/GuidedConnections';
import { useDayConnectionLibrary } from '../connections/useDayConnectionLibrary';
import { getConnectionLibrary } from '../../../utils/connections/connectionLibraryService';
import {
    acceptAsGenerated,
    applyManualEdit,
    applyOptimization,
    countBlocks,
    countTrips,
    resetOptimization,
    resolveBuildStage,
    setHeadwayTargets,
    type GuidedBuildStage,
    type GuidedBuildState,
} from './guidedBuildState';
import type { GuidedDayType } from '../runtimeReview/guidedRuntimeReviewTypes';

interface GuidedStep4Props {
    dayType: GuidedDayType;
    routeNumber: string;
    contract: ApprovedRuntimeContract;
    state: GuidedBuildState;
    isCurrent: boolean;
    isGenerating: boolean;
    onGenerate: () => void;
    onStateChange: (update: (state: GuidedBuildState) => GuidedBuildState) => void;
    teamId?: string;
    userId?: string;
    masterStopCodes: Record<string, string>;
    connectionLibrary: ConnectionLibrary | null;
    setConnectionLibrary: (library: ConnectionLibrary) => void;
    onConnectionsOptimized?: (summary: ConnectionsApplySummary) => void;
}

const NO_HEADWAY_TARGETS: Record<string, number> = {};

const STAGES: { id: GuidedBuildStage; label: string }[] = [
    { id: 'tweaks', label: '1 · Manual tweaks' },
    { id: 'connections', label: '2 · Connections' },
];

/**
 * Step 4: the schedule is built on entry (see the workspace), then Manual
 * tweaks → Connections. The connections reset restores the schedule as it
 * was before the optimizer ran, so manual edits survive; see guidedBuildState.
 */
export const GuidedStep4: React.FC<GuidedStep4Props> = ({
    dayType,
    routeNumber,
    contract,
    state,
    isCurrent,
    isGenerating,
    onGenerate,
    onStateChange,
    teamId,
    userId,
    masterStopCodes,
    connectionLibrary,
    setConnectionLibrary,
    onConnectionsOptimized,
}) => {
    const routeIdentity = `${routeNumber}-${dayType}`;
    const hasSchedule = state.schedules.length > 0;
    const hasConnections = !!state.routeConnectionConfig?.connections.some(connection => connection.enabled);
    // Manual tweaks shows this session's connections as chips, with the day's times.
    const dayConnectionLibrary = useDayConnectionLibrary(connectionLibrary, teamId, dayType);
    useEffect(() => {
        if (connectionLibrary || !teamId || !hasConnections) return;
        let cancelled = false;
        getConnectionLibrary(teamId)
            .then(library => { if (!cancelled && library) setConnectionLibrary(library); })
            .catch(error => console.error('Could not load the connection library', error));
        return () => { cancelled = true; };
    }, [connectionLibrary, teamId, hasConnections, setConnectionLibrary]);
    const connectionScopeSchedules = useMemo<MasterRouteTable[] | undefined>(() => (
        Object.keys(masterStopCodes).length === 0
            ? undefined
            : [...state.schedules, { routeName: '_connectionScope', stops: Object.keys(masterStopCodes), stopIds: masterStopCodes, trips: [] }]
    ), [masterStopCodes, state.schedules]);
    const strict = !state.config.cycleMode || state.config.cycleMode === 'Strict';
    const stage = resolveBuildStage(state.stage);
    const hasPlannerChanges = state.editCount > 0 || state.preOptimization !== null;
    const regenerate = () => {
        if (hasPlannerChanges && !window.confirm(`Regenerate the ${dayType} schedule? This replaces your manual tweaks and connection changes.`)) return;
        onGenerate();
    };

    const stageStatus = (stage: GuidedBuildStage): string | null => {
        if (stage === 'connections') return state.preOptimization ? 'optimized' : null;
        return state.editCount > 0 ? `${state.editCount} edit${state.editCount === 1 ? '' : 's'}` : null;
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold text-gray-900">Build the schedule · {dayType}</h2>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label="Build stage">
                    {STAGES.map(entry => {
                        const status = stageStatus(entry.id);
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                role="tab"
                                aria-selected={stage === entry.id}
                                disabled={!hasSchedule}
                                onClick={() => onStateChange(current => ({ ...current, stage: entry.id }))}
                                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold ${
                                    stage === entry.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'
                                }`}
                            >
                                {entry.label}
                                {status && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stage === entry.id ? 'bg-white/20' : 'bg-gray-200 text-gray-700'}`}>{status}</span>}
                            </button>
                        );
                    })}
                </div>
                {hasSchedule && (
                    <button
                        type="button"
                        onClick={regenerate}
                        disabled={isGenerating}
                        className={`ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                            isCurrent ? 'border border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-amber-600 text-white hover:bg-amber-700'
                        }`}
                    >
                        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        Regenerate
                    </button>
                )}
            </div>

            {!hasSchedule && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="flex-1 text-sm text-gray-600">
                        {isGenerating
                            ? `Building the ${dayType} schedule from the approved runtimes and the Step 3 settings…`
                            : `No schedule yet for ${dayType}. Build it from the approved runtimes and the Step 3 settings.`}
                    </p>
                    <button
                        type="button"
                        onClick={onGenerate}
                        disabled={isGenerating}
                        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                        {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        Build schedule
                    </button>
                </div>
            )}

            {hasSchedule && !isCurrent && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                    <span className="flex-1">The Step 3 settings or approved runtimes changed after this schedule was built. Regenerate to apply them; it replaces your tweaks and connection changes.</span>
                </div>
            )}

            {stage === 'connections' && hasSchedule && (
                teamId && userId ? (
                    <div className="space-y-3">
                        {state.preOptimization && (
                            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
                                <span className="flex-1">The optimizer has changed this schedule. Reset restores it as it was before the optimizer ran, including your manual edits.</span>
                                <button
                                    type="button"
                                    onClick={() => onStateChange(resetOptimization)}
                                    className="flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1 text-xs font-bold text-blue-800 hover:bg-blue-100"
                                >
                                    <RotateCcw size={12} /> Reset optimizer
                                </button>
                            </div>
                        )}
                        <GuidedConnections
                            routeNumber={routeNumber}
                            dayType={dayType}
                            schedules={state.schedules}
                            teamId={teamId}
                            userId={userId}
                            connectionLibrary={connectionLibrary}
                            setConnectionLibrary={setConnectionLibrary}
                            routeConnectionConfig={state.routeConnectionConfig}
                            setRouteConnectionConfig={config => onStateChange(current => ({ ...current, routeConnectionConfig: config }))}
                            onApply={(optimized, summary) => {
                                onStateChange(current => applyOptimization(current, optimized));
                                onConnectionsOptimized?.(summary);
                            }}
                        />
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">Connections need a team workspace. Use Manual tweaks instead.</p>
                )
            )}

            {stage === 'tweaks' && hasSchedule && (
                <div className="min-h-[36rem] flex-1">
                    <Step4Schedule
                        initialSchedules={state.schedules}
                        originalSchedules={state.generated}
                        editorSessionKey={state.editorSessionKey}
                        bands={contract.planning.bands}
                        analysis={contract.planning.approvedBuckets}
                        segmentNames={contract.planning.segmentColumns.map(column => column.segmentName)}
                        onUpdateSchedules={tables => onStateChange(current => applyManualEdit(current, tables))}
                        projectName={`Route ${routeNumber} ${dayType}`}
                        targetCycleTime={strict ? state.config.cycleTime : undefined}
                        targetHeadway={strict && state.config.blocks.length > 0 ? Math.round(state.config.cycleTime / state.config.blocks.length) : undefined}
                        teamId={teamId}
                        userId={userId}
                        routeIdentity={routeIdentity}
                        routeLabel={`Route ${routeNumber} · ${dayType}`}
                        connectionScopeSchedules={connectionScopeSchedules}
                        approvedRuntimeContract={contract}
                        compareGeneratedByDefault
                        initialShowConnections={hasConnections}
                        connectionLibraryOverride={hasConnections ? dayConnectionLibrary : undefined}
                        routeConnectionConfigOverride={hasConnections ? state.routeConnectionConfig : undefined}
                        initialFocusMode={false}
                        onAcceptBaseline={tables => onStateChange(current => acceptAsGenerated(current, tables))}
                        headwayTargets={state.headwayTargets ?? NO_HEADWAY_TARGETS}
                        onHeadwayTargetsChange={targets => onStateChange(current => setHeadwayTargets(current, targets))}
                    />
                </div>
            )}

            {hasSchedule && (
                <p className="text-xs text-gray-500">{countBlocks(state.schedules)} blocks · {countTrips(state.schedules)} trips</p>
            )}
        </div>
    );
};
