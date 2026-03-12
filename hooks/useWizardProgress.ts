/**
 * useWizardProgress Hook
 * 
 * Persists New Schedule Wizard state to localStorage so users can
 * resume incomplete wizards after browser closure.
 */

import { useState, useCallback } from 'react';
import type { TripBucketAnalysis, TimeBand } from '../utils/ai/runtimeAnalysis';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { RuntimeData } from '../components/NewSchedule/utils/csvParser';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import { hasRestorableWizardProgress } from '../components/NewSchedule/utils/wizardState';

const WIZARD_PROGRESS_KEY = 'newScheduleWizard_progress';

export type WizardImportMode = 'csv' | 'gtfs' | 'performance';

export interface WizardPerformanceConfig {
    routeId: string;
    dateRange: { start: string; end: string } | null;
}

export interface WizardProgress {
    step: 1 | 2 | 3 | 4;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    importMode?: WizardImportMode;
    performanceConfig?: WizardPerformanceConfig;
    autofillFromMaster?: boolean;
    projectName?: string; // Draft/project name
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
        return hasRestorableWizardProgress(load());
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
