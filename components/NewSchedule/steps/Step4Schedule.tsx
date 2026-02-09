
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MasterRouteTable } from '../../../utils/masterScheduleParser';
import { ScheduleEditor } from '../../ScheduleEditor';
import { useUndoRedo } from '../../../hooks/useUndoRedo';
import { AutoSaveStatus } from '../../../hooks/useAutoSave';

import { TimeBand, TripBucketAnalysis } from '../../../utils/runtimeAnalysis';

interface Step4ScheduleProps {
    initialSchedules: MasterRouteTable[];
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
}

export const Step4Schedule: React.FC<Step4ScheduleProps> = ({
    initialSchedules,
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
    connectionScopeSchedules
}) => {
    // Snapshot the original schedules on first mount so deltas remain stable
    // even after edits sync back to the parent via onUpdateSchedules
    const [originalSnapshot, setOriginalSnapshot] = useState<MasterRouteTable[]>(() => initialSchedules);

    // We use a local Undo/Redo stack for the session in this step
    // syncing changes back to the parent for persistence
    const {
        state: schedules,
        set: setSchedules,
        undo, redo, canUndo, canRedo
    } = useUndoRedo<MasterRouteTable[]>(initialSchedules, { maxHistory: 50 });

    const handleResetOriginals = useCallback(() => {
        setSchedules(originalSnapshot);
    }, [originalSnapshot, setSchedules]);

    // Sync back to parent whenever schedules change
    useEffect(() => {
        onUpdateSchedules(schedules);
    }, [schedules, onUpdateSchedules]);

    return (
        <div className="h-full flex flex-col -m-8 min-h-0 overflow-hidden">
            <div className="flex-grow min-h-0 overflow-hidden">
                <ScheduleEditor
                    schedules={schedules}
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
                    bands={bands}
                    analysis={analysis}
                    segmentNames={segmentNames}
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
