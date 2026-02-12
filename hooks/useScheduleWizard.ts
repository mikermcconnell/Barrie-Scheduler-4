/**
 * useScheduleWizard Hook
 *
 * Centralizes all wizard state management for the NewSchedule workflow.
 * Extracted from NewScheduleWizard.tsx to improve maintainability.
 */

import { useState, useEffect, useCallback } from 'react';
import { parseRuntimeCSV, RuntimeData, SegmentRawData } from '../components/NewSchedule/utils/csvParser';
import {
    calculateTotalTripTimes,
    detectOutliers,
    calculateBands,
    TripBucketAnalysis,
    TimeBand,
    DirectionBandSummary,
    computeDirectionBandSummary
} from '../utils/ai/runtimeAnalysis';
import { generateSchedule } from '../utils/schedule/scheduleGenerator';
import { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import { useWizardProgress, WizardProgress } from './useWizardProgress';
import { saveProject, getProject, NewScheduleProject } from '../utils/services/newScheduleProjectService';
import { buildStopNameToIdMap } from '../utils/gtfs/gtfsStopLookup';

// Constants
export const DEFAULT_CYCLE_TIME = 60;
export const DEFAULT_RECOVERY_RATIO = 0;  // 0% since GTFS times are complete
export const DEFAULT_ROUTE_NUMBER = '10';
export const MAX_FILES = 2;

// Wizard step type
export type WizardStep = 1 | 2 | 3 | 4;

// Day types
export type DayType = 'Weekday' | 'Saturday' | 'Sunday';

// Initial config
const INITIAL_CONFIG: ScheduleConfig = {
    routeNumber: DEFAULT_ROUTE_NUMBER,
    cycleTime: DEFAULT_CYCLE_TIME,
    blocks: []
};

// Result types for async operations
export interface ParseResult {
    success: boolean;
    error?: string;
}

export interface GenerateResult {
    success: boolean;
    tables: MasterRouteTable[];
    error?: string;
}

export interface SaveResult {
    success: boolean;
    projectId?: string;
    error?: string;
}

// Hook interface
export interface UseScheduleWizardReturn {
    // Step navigation
    step: WizardStep;
    maxStepReached: number;
    setStep: (step: WizardStep) => void;
    canGoBack: boolean;
    canGoNext: boolean;

    // Data state
    dayType: DayType;
    setDayType: (type: DayType) => void;
    files: File[];
    setFiles: (files: File[]) => void;
    projectName: string;
    setProjectName: (name: string) => void;
    projectId: string | undefined;

    // Analysis state
    parsedData: RuntimeData[];
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    bandSummary: DirectionBandSummary;
    segmentsMap: Record<string, SegmentRawData[]>;

    // Config state
    config: ScheduleConfig;
    setConfig: (config: ScheduleConfig) => void;

    // Generated schedules
    generatedSchedules: MasterRouteTable[];
    setGeneratedSchedules: (schedules: MasterRouteTable[]) => void;

    // Actions
    parseFiles: () => Promise<ParseResult>;
    generateSchedules: () => Promise<GenerateResult>;
    handleAnalysisUpdate: (analysis: TripBucketAnalysis[]) => void;
    saveProgress: (userId: string | undefined) => Promise<SaveResult>;
    loadProject: (userId: string, project: NewScheduleProject) => Promise<void>;
    resetWizard: () => void;

    // Progress persistence
    hasProgress: boolean;
    savedProgress: WizardProgress | null;
    resumeProgress: () => void;
    clearProgress: () => void;
}

export const useScheduleWizard = (): UseScheduleWizardReturn => {
    // Step state
    const [step, setStepInternal] = useState<WizardStep>(1);
    const [maxStepReached, setMaxStepReached] = useState(1);

    // Data state
    const [dayType, setDayType] = useState<DayType>('Weekday');
    const [files, setFiles] = useState<File[]>([]);
    const [projectName, setProjectName] = useState('New Schedule Project');
    const [projectId, setProjectId] = useState<string | undefined>();

    // Analysis state
    const [parsedData, setParsedData] = useState<RuntimeData[]>([]);
    const [analysis, setAnalysis] = useState<TripBucketAnalysis[]>([]);
    const [bands, setBands] = useState<TimeBand[]>([]);
    const [bandSummary, setBandSummary] = useState<DirectionBandSummary>({});
    const [segmentsMap, setSegmentsMap] = useState<Record<string, SegmentRawData[]>>({});

    // Config state
    const [config, setConfig] = useState<ScheduleConfig>(INITIAL_CONFIG);

    // Generated schedules
    const [generatedSchedules, setGeneratedSchedules] = useState<MasterRouteTable[]>([]);

    // Progress persistence
    const { load, save, clear, hasProgress: checkHasProgress } = useWizardProgress();
    const [savedProgress, setSavedProgress] = useState<WizardProgress | null>(null);
    const [hasCheckedProgress, setHasCheckedProgress] = useState(false);

    // Check for saved progress on mount
    useEffect(() => {
        if (!hasCheckedProgress && checkHasProgress()) {
            const progress = load();
            setSavedProgress(progress);
        }
        setHasCheckedProgress(true);
    }, [hasCheckedProgress, checkHasProgress, load]);

    // Update max step tracking
    useEffect(() => {
        if (step > maxStepReached) {
            setMaxStepReached(step);
        }
    }, [step, maxStepReached]);

    // Auto-save progress when state changes
    useEffect(() => {
        if (step >= 1 && files.length > 0) {
            save({
                step,
                dayType,
                fileNames: files.map(f => f.name),
                analysis: step >= 2 ? analysis : undefined,
                bands: step >= 2 ? bands : undefined,
                config: step >= 3 ? config : undefined,
                generatedSchedules: step >= 4 ? generatedSchedules : undefined,
                parsedData: step >= 1 ? parsedData : undefined,
                updatedAt: new Date().toISOString()
            });
        }
    }, [step, dayType, files.length, analysis, bands, config, generatedSchedules, parsedData, save]);

    // Set step with validation
    const setStep = useCallback((newStep: WizardStep) => {
        if (newStep >= 1 && newStep <= 4) {
            setStepInternal(newStep);
        }
    }, []);

    // Parse uploaded files
    const parseFiles = useCallback(async (): Promise<ParseResult> => {
        if (files.length === 0) {
            return { success: false, error: 'Please upload at least one CSV file.' };
        }

        try {
            const results = await Promise.all(files.map(f => parseRuntimeCSV(f)));
            setParsedData(results);

            // Run initial analysis
            const rawAnalysis = calculateTotalTripTimes(results);
            const withOutliers = detectOutliers(rawAnalysis);
            const { buckets, bands: generatedBands } = calculateBands(withOutliers);

            setAnalysis(buckets);
            setBands(generatedBands);

            // Build segmentsMap for direction-keyed lookups
            const groupedSegments: Record<string, SegmentRawData[]> = {};
            results.forEach(pd => {
                const dir = pd.detectedDirection || 'North';
                if (!groupedSegments[dir]) groupedSegments[dir] = [];
                groupedSegments[dir].push(...pd.segments);
            });
            setSegmentsMap(groupedSegments);

            // Auto-detect config from first file
            if (results[0]?.detectedRouteNumber) {
                setConfig(prev => ({
                    ...prev,
                    routeNumber: results[0].detectedRouteNumber!
                }));
            }

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to parse CSV files';
            return { success: false, error: message };
        }
    }, [files]);

    // Generate schedules
    const generateSchedules = useCallback(async (): Promise<GenerateResult> => {
        if (parsedData.length === 0) {
            return {
                success: false,
                tables: [],
                error: 'No data found. Please go back to Step 1 and re-upload your files.'
            };
        }

        // Sort parsed data by direction: North/A first, then South/B
        const directionOrder: Record<string, number> = { 'North': 0, 'A': 1, 'Loop': 2, 'South': 3, 'B': 4 };
        const sortedParsedData = [...parsedData].sort((a, b) => {
            const orderA = a.detectedDirection ? (directionOrder[a.detectedDirection] ?? 2) : 2;
            const orderB = b.detectedDirection ? (directionOrder[b.detectedDirection] ?? 2) : 2;
            return orderA - orderB;
        });

        // Group data by direction
        const groupedData: Record<string, SegmentRawData[]> = {};
        sortedParsedData.forEach(pd => {
            const dir = pd.detectedDirection || 'North';
            if (!groupedData[dir]) groupedData[dir] = [];
            groupedData[dir].push(...pd.segments);
        });
        setSegmentsMap(groupedData);

        // Compute bandSummary synchronously at generation time
        const freshBandSummary = computeDirectionBandSummary(analysis, bands, groupedData);
        setBandSummary(freshBandSummary);

        // Build GTFS stop name → stop_id lookup for real stop codes
        const gtfsStopLookup = buildStopNameToIdMap();

        // Generate schedule
        const tables = generateSchedule(
            config,
            analysis,
            bands,
            freshBandSummary,
            groupedData,
            dayType,
            gtfsStopLookup
        );

        if (tables.length === 0) {
            return {
                success: false,
                tables: [],
                error: `Schedule generation failed. Possible reasons:\n• No directions detected\n• Cycle time is 0\n• Data format mismatch`
            };
        }

        setGeneratedSchedules(tables);
        return { success: true, tables };
    }, [parsedData, analysis, bands, config, dayType]);

    // Handle analysis update (recalculate bands)
    const handleAnalysisUpdate = useCallback((newAnalysis: TripBucketAnalysis[]) => {
        const { buckets, bands: newBands } = calculateBands(newAnalysis);
        setAnalysis(buckets);
        setBands(newBands);
    }, []);

    // Save progress to Firebase
    const saveProgress = useCallback(async (userId: string | undefined): Promise<SaveResult> => {
        // Always save to localStorage
        save({
            step,
            dayType,
            fileNames: files.map(f => f.name),
            analysis: step >= 2 ? analysis : undefined,
            bands: step >= 2 ? bands : undefined,
            config: step >= 3 ? config : undefined,
            generatedSchedules: step >= 4 ? generatedSchedules : undefined,
            parsedData: step >= 1 ? parsedData : undefined,
            updatedAt: new Date().toISOString()
        });

        // Save to Firebase if authenticated
        if (userId) {
            try {
                const savedId = await saveProject(userId, {
                    name: projectName,
                    dayType,
                    routeNumber: config.routeNumber,
                    analysis: step >= 2 ? analysis : undefined,
                    bands: step >= 2 ? bands : undefined,
                    config: step >= 3 ? config : undefined,
                    generatedSchedules: step >= 4 ? generatedSchedules : undefined,
                    parsedData: step >= 1 ? parsedData : undefined,
                    isGenerated: step >= 4,
                    ...(projectId ? { id: projectId } : {})
                });
                setProjectId(savedId);
                return { success: true, projectId: savedId };
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Cloud save failed';
                return { success: false, error: message };
            }
        }

        return { success: true };
    }, [step, dayType, files, analysis, bands, config, generatedSchedules, parsedData, projectName, projectId, save]);

    // Load project from Firebase
    const loadProject = useCallback(async (userId: string, project: NewScheduleProject) => {
        const fullProject = await getProject(userId, project.id);
        if (fullProject) {
            setProjectId(fullProject.id);
            setProjectName(fullProject.name);
            setDayType(fullProject.dayType as DayType);
            if (fullProject.analysis) setAnalysis(fullProject.analysis);
            if (fullProject.bands) setBands(fullProject.bands);
            if (fullProject.config) setConfig(fullProject.config);
            if (fullProject.generatedSchedules) setGeneratedSchedules(fullProject.generatedSchedules);
            if (fullProject.parsedData) setParsedData(fullProject.parsedData);

            const nextStep = (fullProject.isGenerated && fullProject.generatedSchedules?.length > 0)
                ? 4
                : (fullProject.config ? 3 : 2);
            setStepInternal(nextStep as WizardStep);
            setMaxStepReached(nextStep);
        }
    }, []);

    // Resume from saved progress
    const resumeProgress = useCallback(() => {
        if (savedProgress) {
            setStepInternal(savedProgress.step);
            setMaxStepReached(Math.max(savedProgress.step, maxStepReached));
            setDayType(savedProgress.dayType as DayType);
            if (savedProgress.analysis) setAnalysis(savedProgress.analysis);
            if (savedProgress.bands) setBands(savedProgress.bands);
            if (savedProgress.config) setConfig(savedProgress.config);
            if (savedProgress.generatedSchedules) setGeneratedSchedules(savedProgress.generatedSchedules);
            if (savedProgress.parsedData) setParsedData(savedProgress.parsedData);
        }
        setSavedProgress(null);
    }, [savedProgress, maxStepReached]);

    // Clear progress
    const clearProgress = useCallback(() => {
        clear();
        setSavedProgress(null);
    }, [clear]);

    // Reset wizard to initial state
    const resetWizard = useCallback(() => {
        clear();
        setStepInternal(1);
        setMaxStepReached(1);
        setFiles([]);
        setParsedData([]);
        setAnalysis([]);
        setBands([]);
        setBandSummary({});
        setSegmentsMap({});
        setConfig(INITIAL_CONFIG);
        setGeneratedSchedules([]);
        setProjectName('New Schedule Project');
        setProjectId(undefined);
    }, [clear]);

    return {
        // Step navigation
        step,
        maxStepReached,
        setStep,
        canGoBack: step > 1,
        canGoNext: step < 4,

        // Data state
        dayType,
        setDayType,
        files,
        setFiles,
        projectName,
        setProjectName,
        projectId,

        // Analysis state
        parsedData,
        analysis,
        bands,
        bandSummary,
        segmentsMap,

        // Config state
        config,
        setConfig,

        // Generated schedules
        generatedSchedules,
        setGeneratedSchedules,

        // Actions
        parseFiles,
        generateSchedules,
        handleAnalysisUpdate,
        saveProgress,
        loadProject,
        resetWizard,

        // Progress persistence
        hasProgress: savedProgress !== null,
        savedProgress,
        resumeProgress,
        clearProgress
    };
};

export default useScheduleWizard;
