import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const scheduleEditorSpy = vi.fn();

vi.mock('../components/ScheduleEditor', () => ({
    ScheduleEditor: (props: any) => {
        scheduleEditorSpy(props);
        return <div>schedule editor</div>;
    },
}));

vi.mock('../utils/services/masterScheduleService', () => ({
    getMasterSchedule: vi.fn(),
}));

import { Step4Schedule } from '../components/NewSchedule/steps/Step4Schedule';
import { acceptAsGenerated, createGuidedBuildState } from '../components/GuidedSchedule/build/guidedBuildState';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

const makeTable = (startTime: number): MasterRouteTable => ({
    routeName: '2 (Weekday) (North)',
    stops: ['Terminal'],
    stopIds: {},
    trips: [{
        id: 't1',
        blockId: '2-3',
        direction: 'North',
        tripNumber: 1,
        rowId: 0,
        startTime,
        endTime: startTime + 30,
        travelTime: 30,
        recoveryTime: 0,
        cycleTime: 30,
        stops: { Terminal: '6:00 AM' },
    } as MasterTrip],
});

const latestEditorProps = () => scheduleEditorSpy.mock.calls.filter(([props]) => !props.readOnly).at(-1)?.[0];

describe('Step 4 accept changes as baseline', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
        scheduleEditorSpy.mockClear();
        vi.restoreAllMocks();
    });

    const render = (onAcceptBaseline?: (schedules: MasterRouteTable[]) => void) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        const generated = [makeTable(386)];
        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={generated}
                    originalSchedules={generated}
                    editorSessionKey={1}
                    bands={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Route 2 Weekday"
                    onAcceptBaseline={onAcceptBaseline}
                />
            );
        });
        return generated;
    };

    it('hides the action when the host does not support it', () => {
        render(undefined);
        expect(latestEditorProps().onAcceptChanges).toBeUndefined();
    });

    it('makes the edited schedule the generated baseline after confirmation', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const onAcceptBaseline = vi.fn();
        const generated = render(onAcceptBaseline);
        const edited = [makeTable(365)];

        flushSync(() => latestEditorProps().onSchedulesChange(edited));
        expect(latestEditorProps().originalSchedules).toBe(generated);

        flushSync(() => latestEditorProps().onAcceptChanges());
        expect(onAcceptBaseline).toHaveBeenCalledWith(edited);
        expect(latestEditorProps().originalSchedules).toBe(edited);
    });

    it('does nothing when the planner cancels', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onAcceptBaseline = vi.fn();
        const generated = render(onAcceptBaseline);

        flushSync(() => latestEditorProps().onSchedulesChange([makeTable(365)]));
        flushSync(() => latestEditorProps().onAcceptChanges());
        expect(onAcceptBaseline).not.toHaveBeenCalled();
        expect(latestEditorProps().originalSchedules).toBe(generated);
    });

    it('passes the starting Connections and Focus toggles to every editor', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[makeTable(386)]}
                    editorSessionKey={1}
                    bands={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Route 2 Weekday"
                    initialShowConnections={false}
                    initialFocusMode={false}
                />
            );
        });
        const props = latestEditorProps();
        expect(props.initialShowConnections).toBe(false);
        expect(props.initialFocusMode).toBe(false);
    });

    it('stores the accepted schedule as the guided generated baseline and keeps the edit count', () => {
        const edited = [makeTable(365)];
        const state = { ...createGuidedBuildState('2'), generated: [makeTable(386)], schedules: edited, editCount: 2 };
        const accepted = acceptAsGenerated(state, edited);
        expect(accepted.generated).toBe(edited);
        expect(accepted.schedules).toBe(edited);
        expect(accepted.editCount).toBe(2);
    });
});
