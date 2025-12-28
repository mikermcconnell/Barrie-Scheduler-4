
import React, { useEffect } from 'react';
import { MasterRouteTable } from '../../../utils/masterScheduleParser';
import { ScheduleEditor } from '../../ScheduleEditor';
import { useUndoRedo } from '../../../hooks/useUndoRedo';
import { AutoSaveStatus } from '../../../hooks/useAutoSave';

import { TimeBand } from '../utils/runtimeAnalysis';

interface Step4ScheduleProps {
    initialSchedules: MasterRouteTable[];
    bands: TimeBand[];
    onUpdateSchedules: (schedules: MasterRouteTable[]) => void;
    projectName: string;
    autoSaveStatus?: AutoSaveStatus;
    lastSaved?: Date | null;
}

export const Step4Schedule: React.FC<Step4ScheduleProps> = ({
    initialSchedules,
    bands,
    onUpdateSchedules,
    projectName,
    autoSaveStatus,
    lastSaved
}) => {
    // We use a local Undo/Redo stack for the session in this step
    // syncing changes back to the parent for persistence
    console.log('Step4Schedule received initialSchedules:', initialSchedules.length, initialSchedules.map(t => t.routeName));
    const {
        state: schedules,
        set: setSchedules,
        undo, redo, canUndo, canRedo
    } = useUndoRedo<MasterRouteTable[]>(initialSchedules, { maxHistory: 50 });
    console.log('Step4Schedule useUndoRedo state:', schedules.length);

    // Sync back to parent whenever schedules change
    useEffect(() => {
        onUpdateSchedules(schedules);
    }, [schedules, onUpdateSchedules]);

    return (
        <div className="h-full flex flex-col -m-8 min-h-0 overflow-hidden">
            {/* Legend Overlay (Absolute position to sit on top of Editor or integrated?) 
               The Editor takes full height. Let's put it in a header bar above or overlay?
               Step 3 had it in a header. Step 4 is just the Editor.
               The user wants it on the "Step 4 page".
               Let's put it in a thin strip at the top, or overlay. 
               The Editor header is inside ScheduleEditor.
               Let's add a small container above ScheduleEditor if we can afford space, 
               or pass it into ScheduleEditor? Passing is complex.
               I'll put it in a top bar above the editor.
            */}
            <div className="bg-white border-b border-gray-200 px-6 py-2 flex justify-between items-center flex-shrink-0 z-10">
                <h3 className="text-sm font-bold text-gray-500 uppercase">Review Schedule</h3>

                {/* Time Band Legend */}
                <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-gray-400 uppercase mr-2">Band References</span>
                    {bands.map(band => (
                        <div key={band.id} className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                            <span className="text-xs font-bold text-gray-700 whitespace-nowrap">
                                {band.id} <span className="text-gray-400 font-normal">({band.avg.toFixed(0)}m)</span>
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-grow min-h-0 overflow-hidden">
                <ScheduleEditor
                    schedules={schedules}
                    onSchedulesChange={setSchedules}
                    originalSchedules={initialSchedules}
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
                />
            </div>
        </div>
    );
};
