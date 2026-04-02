
import React, { useCallback, useEffect, useState } from 'react';
import { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import { ScheduleEditor } from '../../ScheduleEditor';
import { useUndoRedo } from '../../../hooks/useUndoRedo';
import { AutoSaveStatus } from '../../../hooks/useAutoSave';

import { TimeBand, TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { buildStep2ApprovedRuntimeModelFromContract } from '../utils/step2ApprovedRuntimeModelAdapter';
import type { ApprovedRuntimeContract } from '../utils/step2ReviewTypes';
import type { ApprovedRuntimeModel } from '../utils/wizardState';

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
    masterBaseline?: MasterRouteTable[] | null;
    connectionScopeSchedules?: MasterRouteTable[];
    approvedRuntimeContract?: ApprovedRuntimeContract | null;
    approvedRuntimeModel?: ApprovedRuntimeModel | null;
}

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
    masterBaseline,
    connectionScopeSchedules,
    approvedRuntimeContract,
}) => {
    const resolvedOriginalSchedules = originalSchedules && originalSchedules.length > 0
        ? originalSchedules
        : initialSchedules;

    // Snapshot the original schedules on first mount so deltas remain stable
    // even after edits sync back to the parent via onUpdateSchedules
    const [originalSnapshot, setOriginalSnapshot] = useState<MasterRouteTable[]>(() => resolvedOriginalSchedules);

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
    } = useUndoRedo<MasterRouteTable[]>(initialSchedules, { maxHistory: 50 });

    // Only reset the local Step 4 editor session when the wizard explicitly starts
    // a new Step 4 payload (fresh generation, resume, or project load).
    useEffect(() => {
        setOriginalSnapshot(resolvedOriginalSchedules);
        resetSchedules(initialSchedules);
    }, [editorSessionKey, initialSchedules, resetSchedules, resolvedOriginalSchedules]);

    const handleResetOriginals = useCallback(() => {
        setSchedules(originalSnapshot);
    }, [originalSnapshot, setSchedules]);

    // Sync back to parent whenever schedules change
    useEffect(() => {
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
            <div className="flex-grow min-h-0 overflow-hidden">
                <ScheduleEditor
                    schedules={schedules}
                    useAuthoritativeTimepoints={true}
                    onSchedulesChange={setSchedules}
                    originalSchedules={originalSnapshot}
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
                    masterBaseline={masterBaseline}
                    connectionScopeSchedules={connectionScopeSchedules}
                />
            </div>
        </div>
    );
};
