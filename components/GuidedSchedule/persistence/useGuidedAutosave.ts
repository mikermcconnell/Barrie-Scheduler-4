import { useCallback, useEffect, useRef, useState } from 'react';
import {
    saveProject as saveProjectToCloud,
    StaleNewScheduleProjectError,
} from '../../../utils/services/newScheduleProjectService';
import type { GuidedDayType } from '../runtimeReview/guidedRuntimeReviewTypes';
import { GUIDED_DAY_TYPES } from '../guidedSelection';
import { buildGuidedDayProject, type GuidedDaySaveInput } from './guidedSetPersistence';

export type GuidedSaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

type DayInputs = Partial<Record<GuidedDayType, GuidedDaySaveInput>>;

interface UseGuidedAutosaveOptions {
    userId: string | undefined;
    /** Current save input per day type in the set; days without a review are left out. */
    inputs: DayInputs;
    delayMs?: number;
    saveProject?: typeof saveProjectToCloud;
}

const sameInput = (left: GuidedDaySaveInput | undefined, right: GuidedDaySaveInput | undefined): boolean => {
    if (!left || !right) return left === right;
    return (Object.keys(right) as (keyof GuidedDaySaveInput)[]).every(key => left[key] === right[key]);
};

/**
 * Saves each changed day type of a guided set after a quiet period, one save
 * at a time. Every save carries the revision it expects, so a save made
 * elsewhere stops autosave with a conflict instead of being overwritten.
 */
export const useGuidedAutosave = ({
    userId,
    inputs,
    delayMs = 2000,
    saveProject = saveProjectToCloud,
}: UseGuidedAutosaveOptions) => {
    const [status, setStatus] = useState<GuidedSaveStatus>('idle');
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const latestRef = useRef<DayInputs>(inputs);
    latestRef.current = inputs;
    const seenRef = useRef<DayInputs>({});
    const dirtyRef = useRef(new Set<GuidedDayType>());
    const revisionsRef = useRef<Partial<Record<GuidedDayType, number>>>({});
    const queueRef = useRef<Promise<void>>(Promise.resolve());
    const pendingRef = useRef(0);
    const stoppedRef = useRef(false);
    const adoptRef = useRef(false);
    const droppedRef = useRef(new Set<GuidedDayType>());
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const userIdRef = useRef(userId);
    userIdRef.current = userId;

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const uid = userIdRef.current;
        if (!uid || stoppedRef.current || dirtyRef.current.size === 0) return queueRef.current;
        const days = GUIDED_DAY_TYPES.filter(dayType => dirtyRef.current.has(dayType));
        dirtyRef.current.clear();

        days.forEach(dayType => {
            pendingRef.current += 1;
            setStatus('saving');
            queueRef.current = queueRef.current.then(async () => {
                const input = latestRef.current[dayType];
                if (!input || stoppedRef.current || droppedRef.current.has(dayType)) return;
                const expectedRevision = revisionsRef.current[dayType] ?? 0;
                try {
                    await saveProject(uid, buildGuidedDayProject(input), { expectedRevision });
                    revisionsRef.current[dayType] = expectedRevision + 1;
                    setLastSavedAt(new Date());
                } catch (error) {
                    if (error instanceof StaleNewScheduleProjectError) {
                        stoppedRef.current = true;
                        setStatus('conflict');
                        return;
                    }
                    console.error(`Guided ${dayType} save failed:`, error);
                    dirtyRef.current.add(dayType);
                    setStatus('error');
                }
            }).finally(() => {
                pendingRef.current -= 1;
                if (pendingRef.current === 0) {
                    setStatus(current => (current === 'saving' ? 'saved' : current));
                }
            });
        });
        return queueRef.current;
    }, [saveProject]);

    // Detect changed days on every render; restart the quiet period only on a real change.
    useEffect(() => {
        let changed = false;
        let adopted = false;
        GUIDED_DAY_TYPES.forEach(dayType => {
            const input = inputs[dayType];
            if (sameInput(seenRef.current[dayType], input)) return;
            seenRef.current[dayType] = input;
            if (!input) return;
            if (adoptRef.current) {
                adopted = true;
                return;
            }
            dirtyRef.current.add(dayType);
            changed = true;
        });
        // A reopened set is adopted when its inputs first appear, not on an unrelated render.
        if (adopted) adoptRef.current = false;
        if (!changed || stoppedRef.current) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { void flush(); }, delayMs);
    });

    // Save pending changes when the workspace closes.
    useEffect(() => () => { void flush(); }, [flush]);

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (dirtyRef.current.size === 0 && pendingRef.current === 0) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    /**
     * Starts tracking a set. The next inputs are taken as already saved (a
     * reopened set), or as new (a fresh analysis) when adopt is false.
     * Without revisions, the known revisions carry over (re-analysis of the same set).
     */
    const startSet = useCallback((options: { adopt: boolean; revisions?: Partial<Record<GuidedDayType, number>> }) => {
        const { adopt, revisions } = options;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        dirtyRef.current.clear();
        droppedRef.current.clear();
        seenRef.current = {};
        if (revisions) revisionsRef.current = { ...revisions };
        stoppedRef.current = false;
        adoptRef.current = adopt;
        setStatus(adopt ? 'saved' : 'idle');
    }, []);

    /** Stops saving a day type that left the set; await flush() before deleting its project. */
    const forgetDay = useCallback((dayType: GuidedDayType) => {
        droppedRef.current.add(dayType);
        dirtyRef.current.delete(dayType);
        delete seenRef.current[dayType];
        delete revisionsRef.current[dayType];
    }, []);

    return { status, lastSavedAt, flush, startSet, forgetDay };
};
