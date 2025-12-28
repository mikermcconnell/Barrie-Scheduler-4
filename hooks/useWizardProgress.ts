/**
 * useWizardProgress Hook
 * 
 * Persists New Schedule Wizard state to localStorage so users can
 * resume incomplete wizards after browser closure.
 */

import { useState, useCallback } from 'react';
import type { TripBucketAnalysis, TimeBand } from '../components/NewSchedule/utils/runtimeAnalysis';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { RuntimeData } from '../components/NewSchedule/utils/csvParser';
import type { MasterRouteTable } from '../utils/masterScheduleParser';

const WIZARD_PROGRESS_KEY = 'newScheduleWizard_progress';

export interface WizardProgress {
    step: 1 | 2 | 3 | 4;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    fileNames: string[]; // Store names only (files can't be serialized)
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    config?: ScheduleConfig;
    generatedSchedules?: MasterRouteTable[]; // Added for persistence
    parsedData?: RuntimeData[]; // Added for persistence
    updatedAt: string;
}

export function useWizardProgress() {
    const [hasCheckedProgress, setHasCheckedProgress] = useState(false);

    const load = useCallback((): WizardProgress | null => {
        try {
            const stored = localStorage.getItem(WIZARD_PROGRESS_KEY);
            if (!stored) return null;
            return JSON.parse(stored) as WizardProgress;
        } catch (e) {
            console.error('Failed to load wizard progress:', e);
            return null;
        }
    }, []);

    const save = useCallback((progress: WizardProgress): void => {
        try {
            localStorage.setItem(WIZARD_PROGRESS_KEY, JSON.stringify({
                ...progress,
                updatedAt: new Date().toISOString()
            }));
        } catch (e) {
            console.error('Failed to save wizard progress:', e);
        }
    }, []);

    const clear = useCallback((): void => {
        try {
            localStorage.removeItem(WIZARD_PROGRESS_KEY);
        } catch (e) {
            console.error('Failed to clear wizard progress:', e);
        }
    }, []);

    const hasProgress = useCallback((): boolean => {
        const progress = load();
        // Consider progress valid if we're past step 1 OR step 1 with files
        return progress !== null && (progress.step > 1 || progress.fileNames.length > 0);
    }, [load]);

    return {
        load,
        save,
        clear,
        hasProgress,
        hasCheckedProgress,
        setHasCheckedProgress
    };
}

export default useWizardProgress;
