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
import type { ApprovedRuntimeModel } from '../components/NewSchedule/utils/wizardState';
import type { ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2ReviewTypes';
import { hasRestorableWizardProgress } from '../components/NewSchedule/utils/wizardState';

const WIZARD_PROGRESS_KEY = 'newScheduleWizard_progress';

export type WizardImportMode = 'csv' | 'gtfs' | 'performance';
export type WizardProgressStep = 1 | 2 | 3 | 4 | 5;

export interface WizardPerformanceConfig {
    routeId: string;
    dateRange: { start: string; end: string } | null;
}

export interface WizardProgress {
    step: WizardProgressStep;
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
    originalGeneratedSchedules?: MasterRouteTable[]; // Stable Step 4 delta baseline
    generatedScheduleInputFingerprint?: string;
    parsedData?: RuntimeData[]; // Added for persistence
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
    updatedAt: string;
}

const isWizardProgress = (value: unknown): value is WizardProgress => {
    if (!value || typeof value !== 'object') return false;

    const progress = value as Partial<WizardProgress>;
    return (
        Number.isInteger(progress.step)
        && (progress.step as number) >= 1
        && (progress.step as number) <= 5
        && ['Weekday', 'Saturday', 'Sunday'].includes(progress.dayType ?? '')
        && Array.isArray(progress.fileNames)
        && progress.fileNames.every((fileName) => typeof fileName === 'string')
        && typeof progress.updatedAt === 'string'
        && !Number.isNaN(Date.parse(progress.updatedAt))
    );
};

export function useWizardProgress() {
    const [hasCheckedProgress, setHasCheckedProgress] = useState(false);

    const load = useCallback((): WizardProgress | null => {
        try {
            const stored = localStorage.getItem(WIZARD_PROGRESS_KEY);
            if (!stored) return null;
            const parsed: unknown = JSON.parse(stored);
            if (!isWizardProgress(parsed)) {
                console.warn('Ignoring invalid wizard progress in local storage.');
                return null;
            }
            return parsed;
        } catch (e) {
            console.error('Failed to load wizard progress:', e);
            return null;
        }
    }, []);

    const save = useCallback((progress: WizardProgress): boolean => {
        try {
            localStorage.setItem(WIZARD_PROGRESS_KEY, JSON.stringify({
                ...progress,
                updatedAt: new Date().toISOString()
            }));
            return true;
        } catch (e) {
            console.error('Failed to save wizard progress:', e);
            return false;
        }
    }, []);

    const clear = useCallback((): boolean => {
        try {
            localStorage.removeItem(WIZARD_PROGRESS_KEY);
            return true;
        } catch (e) {
            console.error('Failed to clear wizard progress:', e);
            return false;
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
