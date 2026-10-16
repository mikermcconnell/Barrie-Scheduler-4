import React, { useMemo } from 'react';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionLibrary, OptimizationResult } from '../../../utils/connections/connectionTypes';
import type { ApprovedRuntimeContract } from '../../NewSchedule/utils/step2ReviewTypes';
import { Step4Schedule } from '../../NewSchedule/steps/Step4Schedule';
import { Step5Connections } from '../../NewSchedule/steps/Step5Connections';
import { GuidedBuildSummary } from './GuidedBuildSummary';
import {
    applyManualEdit,
    applyOptimization,
    countBlocks,
    countTrips,
    resetOptimization,
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
    onConnectionsOptimized?: (result: OptimizationResult) => void;
}

const STAGES: { id: GuidedBuildStage; label: string }[] = [
    { id: 'generate', label: '1 · Generate' },
    { id: 'connections', label: '2 · Connections' },
    { id: 'tweaks', label: '3 · Manual tweaks' },
];

/**
 * Step 4: Generate (read-only result) → Connections → Manual tweaks. The
 * connections reset restores the schedule as it was before the optimizer
 * ran, so manual edits survive; see guidedBuildState.
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
    const connectionScopeSchedules = useMemo<MasterRouteTable[] | undefined>(() => (
        Object.keys(masterStopCodes).length === 0
            ? undefined
            : [...state.schedules, { routeName: '_connectionScope', stops: Object.keys(masterStopCodes), stopIds: masterStopCodes, trips: [] }]
    ), [masterStopCodes, state.schedules]);
    const strict = !state.config.cycleMode || state.config.cycleMode === 'Strict';

    const stageStatus = (stage: GuidedBuildStage): string | null => {
        if (stage === 'generate') return hasSchedule ? `${countTrips(state.schedules)} trips` : null;
        if (stage === 'connections') return state.preOptimization ? 'optimized' : null;
        return state.editCount > 0 ? `${state.editCount} edit${state.editCount === 1 ? '' : 's'}` : null;
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold text-gray-900">Build the schedule · {dayType}</h2>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label="Build stage">
                    {STAGES.map(stage => {
                        const status = stageStatus(stage.id);
                        return (
                            <button
                                key={stage.id}
                                type="button"
                                role="tab"
                                aria-selected={state.stage === stage.id}
                                disabled={stage.id !== 'generate' && (!hasSchedule || !isCurrent)}
                                onClick={() => onStateChange(current => ({ ...current, stage: stage.id }))}
                                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold ${
                                    state.stage === stage.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'
                                }`}
                            >
                                {stage.label}
                                {status && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${state.stage === stage.id ? 'bg-white/20' : 'bg-gray-200 text-gray-700'}`}>{status}</span>}
                            </button>
                        );
                    })}
                </div>
                {hasSchedule && !isCurrent && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Settings changed · generate again</span>
                )}
            </div>

            {state.stage === 'generate' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="flex-1 text-sm text-gray-600">
                            Generates trips from the approved runtimes and the Step 3 settings. Segments are rounded before summing. The result is read-only here; change it in Connections or Manual tweaks.
                            {hasSchedule && ' Generating again replaces the optimized and tweaked schedule.'}
                        </p>
                        <button
                            type="button"
                            onClick={onGenerate}
                            disabled={isGenerating}
                            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50"
                        >
                            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            {hasSchedule ? 'Generate again' : 'Generate schedule'}
                        </button>
                    </div>
                    {hasSchedule ? (
                        <GuidedBuildSummary tables={state.schedules} />
                    ) : (
                        <p className="text-sm text-gray-500">No schedule yet for {dayType}.</p>
                    )}
                </div>
            )}

            {state.stage === 'connections' && hasSchedule && (
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
                        <Step5Connections
                            schedules={state.schedules}
                            connectionScopeSchedules={connectionScopeSchedules}
                            routeIdentity={routeIdentity}
                            dayType={dayType}
                            connectionLibrary={connectionLibrary}
                            setConnectionLibrary={setConnectionLibrary}
                            routeConnectionConfig={state.routeConnectionConfig}
                            setRouteConnectionConfig={config => onStateChange(current => ({ ...current, routeConnectionConfig: config }))}
                            onOptimize={result => {
                                onStateChange(current => applyOptimization(current, result.optimizedSchedules));
                                onConnectionsOptimized?.(result);
                            }}
                            onReset={() => onStateChange(resetOptimization)}
                            teamId={teamId}
                            userId={userId}
                        />
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">Connections need a team workspace. Continue to Manual tweaks.</p>
                )
            )}

            {state.stage === 'tweaks' && hasSchedule && (
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
                    />
                </div>
            )}

            {hasSchedule && state.stage !== 'generate' && (
                <p className="text-xs text-gray-500">{countBlocks(state.schedules)} blocks · {countTrips(state.schedules)} trips</p>
            )}
        </div>
    );
};
