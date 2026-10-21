import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { GuidedDaySaveInput } from '../components/GuidedSchedule/persistence/guidedSetPersistence';
import type { GuidedDayType } from '../components/GuidedSchedule/runtimeReview/guidedRuntimeReviewTypes';

vi.mock('../utils/firebase', () => ({ db: {}, storage: {} }));

vi.mock('../components/GuidedSchedule/persistence/guidedSetPersistence', () => ({
    buildGuidedDayProject: (input: { dayType: string; marker: number }) => ({ id: `set_${input.dayType}`, marker: input.marker }),
}));

const { useGuidedAutosave } = await import('../components/GuidedSchedule/persistence/useGuidedAutosave');
const { StaleNewScheduleProjectError } = await import('../utils/services/newScheduleProjectService');

type Inputs = Partial<Record<GuidedDayType, GuidedDaySaveInput>>;
type Autosave = ReturnType<typeof useGuidedAutosave>;

// The hook compares inputs field by field; a fake input with a changing marker is enough.
const input = (dayType: GuidedDayType, marker: number) => ({ dayType, marker } as unknown as GuidedDaySaveInput);

describe('useGuidedAutosave', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    let current: Autosave;
    let saveProject: ReturnType<typeof vi.fn>;

    const Harness: React.FC<{ inputs: Inputs }> = ({ inputs }) => {
        current = useGuidedAutosave({ userId: 'user-1', inputs, saveProject: saveProject as never });
        return null;
    };

    const render = (inputs: Inputs) => act(() => { root?.render(<Harness inputs={inputs} />); });
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        saveProject = vi.fn().mockResolvedValue('id');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        render({});
    });

    afterEach(() => {
        if (root) act(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
        vi.useRealTimers();
    });

    it('saves a changed day after the quiet period with the expected revision', async () => {
        act(() => current.startSet({ adopt: false, revisions: {} }));
        render({ Weekday: input('Weekday', 1) });
        render({ Weekday: input('Weekday', 2) });
        expect(saveProject).not.toHaveBeenCalled();
        await advance(2000);

        expect(saveProject).toHaveBeenCalledTimes(1);
        expect(saveProject).toHaveBeenCalledWith('user-1', { id: 'set_Weekday', marker: 2 }, { expectedRevision: 0 });
        expect(current.status).toBe('saved');

        render({ Weekday: input('Weekday', 3) });
        await advance(2000);
        expect(saveProject).toHaveBeenLastCalledWith('user-1', { id: 'set_Weekday', marker: 3 }, { expectedRevision: 1 });
    });

    it('does not save a reopened set until something changes', async () => {
        act(() => current.startSet({ adopt: true, revisions: { Weekday: 5 } }));
        render({ Weekday: input('Weekday', 1) });
        await advance(5000);
        expect(saveProject).not.toHaveBeenCalled();

        render({ Weekday: input('Weekday', 2) });
        await advance(2000);
        expect(saveProject).toHaveBeenCalledWith('user-1', { id: 'set_Weekday', marker: 2 }, { expectedRevision: 5 });
    });

    it('stops autosave after a conflicting save elsewhere', async () => {
        saveProject.mockRejectedValue(new StaleNewScheduleProjectError());
        act(() => current.startSet({ adopt: false, revisions: {} }));
        render({ Weekday: input('Weekday', 1) });
        await advance(2000);
        expect(current.status).toBe('conflict');

        render({ Weekday: input('Weekday', 2) });
        await advance(5000);
        expect(saveProject).toHaveBeenCalledTimes(1);
    });

    it('skips a dropped day even when its save was already queued', async () => {
        act(() => current.startSet({ adopt: false, revisions: {} }));
        render({ Weekday: input('Weekday', 1), Sunday: input('Sunday', 1) });
        act(() => current.forgetDay('Sunday'));
        await act(async () => { await current.flush(); });

        expect(saveProject).toHaveBeenCalledTimes(1);
        expect(saveProject.mock.calls[0][1]).toEqual({ id: 'set_Weekday', marker: 1 });
    });

    it('saves pending changes when the workspace closes', async () => {
        act(() => current.startSet({ adopt: false, revisions: {} }));
        render({ Saturday: input('Saturday', 1) });
        act(() => root?.unmount());
        root = null;
        await act(async () => { await vi.runAllTimersAsync(); });
        expect(saveProject).toHaveBeenCalledTimes(1);
    });
});
