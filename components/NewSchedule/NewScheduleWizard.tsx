
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowRight, Save, Loader2, Check, Upload, Cloud, HardDrive } from 'lucide-react';
import { Step1Upload } from './steps/Step1Upload';
import { Step2Analysis } from './steps/Step2Analysis';
import { Step3Build, ScheduleConfig } from './steps/Step3Build';
import { Step4Schedule } from './steps/Step4Schedule';
import { parseRuntimeCSV, RuntimeData, SegmentRawData } from './utils/csvParser';
import { calculateTotalTripTimes, detectOutliers, calculateBands, TripBucketAnalysis, TimeBand, DirectionBandSummary, computeDirectionBandSummary } from '../../utils/ai/runtimeAnalysis';
import { generateSchedule } from '../../utils/schedule/scheduleGenerator';
import { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import { useWizardProgress, WizardProgress } from '../../hooks/useWizardProgress';
import { ResumeWizardModal } from './ResumeWizardModal';
import { NewScheduleHeader } from './NewScheduleHeader';
import { ProjectManagerModal } from './ProjectManagerModal';
import { AutoSaveStatus } from '../../hooks/useAutoSave';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { saveProject, getProject, getAllProjects } from '../../utils/services/newScheduleProjectService';
import { UploadToMasterModal } from '../modals/UploadToMasterModal';
import { prepareUpload, uploadToMasterSchedule, getMasterSchedule, getAllStopsWithCodes } from '../../utils/services/masterScheduleService';
import { extractRouteNumber, extractDayType, buildRouteIdentity } from '../../utils/masterScheduleTypes';
import { extractDirectionFromName } from '../../utils/config/routeDirectionConfig';
import type { UploadConfirmation, DayType as MasterDayType } from '../../utils/masterScheduleTypes';
import { buildStopNameToIdMap } from '../../utils/gtfs/gtfsStopLookup';
import { resolveAutoRouteNumber } from './utils/routeInference';

// Constants - centralized magic numbers
const DEFAULT_CYCLE_TIME = 60;
const DEFAULT_RECOVERY_RATIO = 15;
const DEFAULT_ROUTE_NUMBER = '10';
const DEFAULT_START_TIME = '06:00';
const DEFAULT_END_TIME = '22:00';
const DEFAULT_PROJECT_NAME = 'New Schedule Project';

const normalizeStopLookupKey = (value: string): string => {
    return value
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bpl\b/g, ' place ')
        .replace(/\bcoll\b/g, ' college ')
        .replace(/\bctr\b/g, ' centre ')
        .replace(/\bstn\b/g, ' station ')
        .replace(/\bterm\b/g, ' terminal ')
        .replace(/\bhwy\b/g, ' highway ')
        .replace(/\bgovernors\b/g, 'govenors ')
        .replace(/[()[\]{}'".,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '');

const cleanTitleFragment = (value: string): string => {
    return stripExtension(value)
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(final|latest|updated|copy|draft)\b/gi, ' ')
        .replace(/\b(v|ver|rev)\s*\d+\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const buildSourceLabelFromFiles = (inputFiles: File[]): string => {
    if (inputFiles.length === 0) return '';

    const cleaned = inputFiles
        .map(file => cleanTitleFragment(file.name))
        .filter(Boolean);

    if (cleaned.length === 0) return '';
    if (cleaned.length === 1) return cleaned[0];

    const tokenized = cleaned.map(name => name.toLowerCase().split(/\s+/).filter(Boolean));
    const first = tokenized[0];
    let prefixLen = first.length;
    for (let i = 1; i < tokenized.length; i++) {
        let j = 0;
        while (j < prefixLen && j < tokenized[i].length && tokenized[i][j] === first[j]) j++;
        prefixLen = j;
        if (prefixLen === 0) break;
    }

    if (prefixLen >= 2) {
        return cleaned[0].split(/\s+/).slice(0, prefixLen).join(' ');
    }

    const remainingCount = cleaned.length - 1;
    return `${cleaned[0]} +${remainingCount} file${remainingCount === 1 ? '' : 's'}`;
};

const buildSuggestedProjectName = (
    inputFiles: File[],
    routeNumber: string,
    dayType: 'Weekday' | 'Saturday' | 'Sunday'
): string => {
    const sourceLabel = buildSourceLabelFromFiles(inputFiles);
    const routeLabel = routeNumber?.trim() ? `Route ${routeNumber.trim()}` : 'Route';
    const base = sourceLabel
        ? `${routeLabel} ${dayType} - ${sourceLabel}`
        : `${routeLabel} ${dayType}`;
    return base.replace(/\s+/g, ' ').trim();
};

const toCollisionSafeName = (requestedName: string, occupiedNames: Set<string>): string => {
    const trimmed = requestedName.trim() || 'Untitled Project';
    if (!occupiedNames.has(trimmed.toLowerCase())) return trimmed;

    const root = trimmed.replace(/\s+\(\d+\)\s*$/, '').trim() || 'Untitled Project';
    let suffix = 2;
    let candidate = `${root} (${suffix})`;
    while (occupiedNames.has(candidate.toLowerCase())) {
        suffix += 1;
        candidate = `${root} (${suffix})`;
    }
    return candidate;
};

interface NewScheduleWizardProps {
    onBack: () => void;
    onGenerate?: (tables: MasterRouteTable[]) => void;
    autoSaveStatus?: AutoSaveStatus;
    lastSaved?: Date | null;
}

export const NewScheduleWizard: React.FC<NewScheduleWizardProps> = ({
    onBack,
    onGenerate,
    autoSaveStatus,
    lastSaved
}) => {
    const { user } = useAuth();
    const { team, hasTeam } = useTeam();
    const toast = useToast();
    const gtfsStopLookup = useMemo(() => buildStopNameToIdMap(), []);

    const [step, setStep] = useState(1);
    const [maxStepReached, setMaxStepReached] = useState(1);

    // Update max step tracking
    useEffect(() => {
        if (step > maxStepReached) setMaxStepReached(step);
    }, [step, maxStepReached]);

    const [dayType, setDayType] = useState<'Weekday' | 'Saturday' | 'Sunday'>('Weekday');
    const [files, setFiles] = useState<File[]>([]);
    const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
    const [isAutoProjectName, setIsAutoProjectName] = useState(true);
    const [projectId, setProjectId] = useState<string | undefined>();
    const projectIdRef = useRef<string | undefined>(undefined);
    const [showProjectManager, setShowProjectManager] = useState(false);

    // State for Step 2 Analysis
    const [parsedData, setParsedData] = useState<RuntimeData[]>([]);
    const [analysis, setAnalysis] = useState<TripBucketAnalysis[]>([]);
    const [bands, setBands] = useState<TimeBand[]>([]);
    const [bandSummary, setBandSummary] = useState<DirectionBandSummary>({});
    const [segmentsMap, setSegmentsMap] = useState<Record<string, SegmentRawData[]>>({});
    const [segmentNames, setSegmentNames] = useState<string[]>([]);

    // State for Step 3 Config
    const [config, setConfig] = useState<ScheduleConfig>({
        routeNumber: DEFAULT_ROUTE_NUMBER,
        cycleTime: DEFAULT_CYCLE_TIME,
        recoveryRatio: DEFAULT_RECOVERY_RATIO,
        blocks: []
    });

    // State for Step 4 Schedule
    const [generatedSchedules, setGeneratedSchedules] = useState<MasterRouteTable[]>([]);

    // Master Schedule Upload State
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmation | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    // Compare to Master State (inline toggle, not modal)
    const [isMasterCompareActive, setIsMasterCompareActive] = useState(false);
    const [masterBaseline, setMasterBaseline] = useState<MasterRouteTable[] | null>(null);
    const [isCompareLoading, setIsCompareLoading] = useState(false);

    // Connection scope: load all master stop codes so ConnectionsPanel validation
    // recognises stop IDs from other routes (mirrors editor workspace pattern).
    const [masterStopCodes, setMasterStopCodes] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!team?.id) return;
        getAllStopsWithCodes(team.id)
            .then(({ stopCodes }) => setMasterStopCodes(stopCodes))
            .catch(err => console.error('Failed to load master stop codes:', err));
    }, [team?.id]);

    useEffect(() => {
        projectIdRef.current = projectId;
    }, [projectId]);

    const suggestedProjectName = useMemo(() => {
        if (files.length === 0) return DEFAULT_PROJECT_NAME;
        return buildSuggestedProjectName(files, config.routeNumber, dayType);
    }, [files, config.routeNumber, dayType]);

    useEffect(() => {
        if (!isAutoProjectName) return;
        if (projectName !== suggestedProjectName) {
            setProjectName(suggestedProjectName);
        }
    }, [isAutoProjectName, projectName, suggestedProjectName]);

    const connectionScopeSchedules = useMemo(() => {
        if (Object.keys(masterStopCodes).length === 0) return undefined;
        const scopeTable: MasterRouteTable = {
            routeName: '_connectionScope',
            stops: Object.keys(masterStopCodes),
            stopIds: masterStopCodes,
            trips: []
        };
        return [...generatedSchedules, scopeTable];
    }, [generatedSchedules, masterStopCodes]);

    // Backfill old generated schedules that used sequential stop IDs (#1, #2, ...)
    // so existing projects immediately get real stop codes for connections.
    useEffect(() => {
        if (generatedSchedules.length === 0) return;

        const normalizedLookup: Record<string, string> = {};
        const addLookup = (lookup: Record<string, string>) => {
            Object.entries(lookup).forEach(([name, code]) => {
                const normalized = normalizeStopLookupKey(name);
                if (normalized && code && !normalizedLookup[normalized]) {
                    normalizedLookup[normalized] = code;
                }
            });
        };
        addLookup(gtfsStopLookup);
        addLookup(masterStopCodes);

        let changedAny = false;
        const repaired = generatedSchedules.map(table => {
            if (!table.stops?.length) return table;
            const existingStopIds = table.stopIds || {};
            let changedTable = false;
            const repairedStopIds: Record<string, string> = { ...existingStopIds };

            table.stops.forEach((stop, idx) => {
                const current = (existingStopIds[stop] || '').trim();
                const exact = gtfsStopLookup[stop] || masterStopCodes[stop];
                const normalized = normalizedLookup[normalizeStopLookupKey(stop)];
                const resolved = exact || normalized;
                const isPlaceholder = current === String(idx + 1);
                if (resolved && (!current || isPlaceholder) && current !== resolved) {
                    repairedStopIds[stop] = resolved;
                    changedTable = true;
                }
            });

            if (!changedTable) return table;
            changedAny = true;
            return { ...table, stopIds: repairedStopIds };
        });

        if (changedAny) {
            setGeneratedSchedules(repaired);
        }
    }, [generatedSchedules, masterStopCodes, gtfsStopLookup]);

    // Helper to extract unique segment names from analysis
    const extractSegmentNames = (analysisData: TripBucketAnalysis[]): string[] => {
        const names = new Set<string>();
        analysisData.forEach(bucket => {
            bucket.details?.forEach(detail => {
                names.add(detail.segmentName);
            });
        });
        return Array.from(names);
    };

    const stopSuggestions = useMemo(() => {
        const seen = new Set<string>();
        const ordered: string[] = [];
        const add = (value?: string) => {
            const cleaned = value?.trim();
            if (!cleaned) return;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            ordered.push(cleaned);
        };

        Object.values(segmentsMap).forEach(segments => {
            segments.forEach(seg => {
                const parts = seg.segmentName.split(' to ');
                if (parts.length !== 2) return;
                add(parts[0]);
                add(parts[1]);
            });
        });
        return ordered;
    }, [segmentsMap]);

    // Helper to update analysis and recalc bands
    const handleAnalysisUpdate = (newAnalysis: TripBucketAnalysis[]) => {
        const { buckets, bands: newBands } = calculateBands(newAnalysis);
        setAnalysis(buckets);
        setBands(newBands);
        setSegmentNames(extractSegmentNames(buckets));
    };

    // Wizard Progress Persistence
    const { load, save, clear, hasProgress, hasCheckedProgress, setHasCheckedProgress } = useWizardProgress();
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [savedProgress, setSavedProgress] = useState<WizardProgress | null>(null);

    // ========== CONSOLIDATED SAVE SYSTEM ==========
    // Save state tracking to prevent race conditions
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingProject, setIsLoadingProject] = useState(false);
    const pendingSaveRef = useRef(false);
    const pendingOverridesRef = useRef<{
        id?: string;
        name?: string;
        generatedSchedules?: MasterRouteTable[];
        isGenerated?: boolean;
    } | null>(null);
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Cloud save tracking + dirty state
    type CloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
    const [cloudSaveStatus, setCloudSaveStatus] = useState<CloudSaveStatus>('idle');
    const [lastCloudSaveTime, setLastCloudSaveTime] = useState<Date | null>(null);
    const stateVersionRef = useRef(0);
    const lastSavedVersionRef = useRef(0);

    const resolveUniqueProjectName = useCallback(async (
        requestedName: string,
        existingProjectId?: string
    ): Promise<string> => {
        const trimmed = requestedName.trim() || 'Untitled Project';
        if (!user?.uid) return trimmed;

        try {
            const projects = await getAllProjects(user.uid);
            const occupiedNames = new Set(
                projects
                    .filter(p => p.id !== existingProjectId)
                    .map(p => (p.name || '').trim().toLowerCase())
                    .filter(Boolean)
            );
            return toCollisionSafeName(trimmed, occupiedNames);
        } catch (error) {
            console.warn('Failed to check project name collisions:', error);
            return trimmed;
        }
    }, [user?.uid]);

    // Helper: Build localStorage save data structure
    const buildLocalSaveData = useCallback((overrides?: {
        generatedSchedules?: MasterRouteTable[]
    }) => ({
        step: step as 1 | 2 | 3 | 4,
        dayType,
        projectName,
        fileNames: files.map(f => f.name),
        analysis: step >= 2 ? analysis : undefined,
        bands: step >= 2 ? bands : undefined,
        config: step >= 3 ? config : undefined,
        generatedSchedules: step >= 4 ? (overrides?.generatedSchedules || generatedSchedules) : undefined,
        parsedData: step >= 1 ? parsedData : undefined,
        updatedAt: new Date().toISOString()
    }), [step, dayType, projectName, files, analysis, bands, config, generatedSchedules, parsedData]);

    // Helper: Build Firebase save data structure
    const buildFirebaseSaveData = useCallback((overrides?: {
        id?: string;
        name?: string;
        generatedSchedules?: MasterRouteTable[];
        isGenerated?: boolean;
    }) => {
        const effectiveProjectId = overrides?.id ?? projectId;
        return ({
        name: overrides?.name || projectName,
        dayType,
        routeNumber: config.routeNumber,
        analysis: step >= 2 ? analysis : undefined,
        bands: step >= 2 ? bands : undefined,
        config: step >= 3 ? config : undefined,
        generatedSchedules: step >= 4 ? (overrides?.generatedSchedules || generatedSchedules) : undefined,
        parsedData: step >= 1 ? parsedData : undefined,
        isGenerated: overrides?.isGenerated ?? (step >= 4),
        ...(effectiveProjectId ? { id: effectiveProjectId } : {})
        });
    }, [projectName, dayType, config, step, analysis, bands, generatedSchedules, parsedData, projectId]);

    // Track state version for dirty detection - increment on meaningful changes
    useEffect(() => {
        if (!isLoadingProject) {
            stateVersionRef.current += 1;
        }
    }, [step, dayType, files.length, analysis, bands, config, generatedSchedules, parsedData, isLoadingProject]);

    const hasProjectContent = useMemo(() => (
        files.length > 0 ||
        parsedData.length > 0 ||
        analysis.length > 0 ||
        bands.length > 0 ||
        config.blocks.length > 0 ||
        generatedSchedules.length > 0 ||
        !!projectId
    ), [
        files.length,
        parsedData.length,
        analysis.length,
        bands.length,
        config.blocks.length,
        generatedSchedules.length,
        projectId
    ]);

    // isDirty: true when state has changed since last cloud save
    const isDirty = useMemo(() => {
        return stateVersionRef.current > lastSavedVersionRef.current && hasProjectContent;
    // Re-evaluate whenever cloud save completes or state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stateVersionRef.current, lastSavedVersionRef.current, hasProjectContent]);

    // Helper: Save to localStorage (fast, synchronous)
    const saveToLocalStorage = useCallback((overrides?: { generatedSchedules?: MasterRouteTable[] }) => {
        if (step >= 1 && hasProjectContent) {
            save(buildLocalSaveData(overrides));
        }
    }, [step, hasProjectContent, save, buildLocalSaveData]);

    // Helper: Save to Firebase with lock to prevent race conditions
    const saveToFirebase = useCallback(async (overrides?: {
        id?: string;
        name?: string;
        generatedSchedules?: MasterRouteTable[];
        isGenerated?: boolean;
    }): Promise<string | undefined> => {
        if (!user?.uid) return undefined;

        // If already saving, store overrides and mark as pending
        if (isSaving) {
            pendingOverridesRef.current = overrides || null;
            pendingSaveRef.current = true;
            return undefined;
        }

        setIsSaving(true);
        setCloudSaveStatus('saving');
        try {
            const currentProjectId = overrides?.id ?? projectIdRef.current;
            const requestedName = overrides?.name ?? projectName;
            const uniqueName = await resolveUniqueProjectName(requestedName, currentProjectId);

            const saveOverrides = {
                ...overrides,
                id: currentProjectId,
                name: uniqueName
            };

            const savedId = await saveProject(user.uid, buildFirebaseSaveData(saveOverrides));
            projectIdRef.current = savedId;
            setProjectId(savedId);
            if (projectName !== uniqueName) {
                setProjectName(uniqueName);
            }
            setCloudSaveStatus('saved');
            setLastCloudSaveTime(new Date());
            lastSavedVersionRef.current = stateVersionRef.current;
            return savedId;
        } catch (e) {
            console.error('Firebase save failed:', e);
            setCloudSaveStatus('error');
            throw e;
        } finally {
            setIsSaving(false);
            // If there was a pending save, execute it with stored overrides
            if (pendingSaveRef.current) {
                const storedOverrides = pendingOverridesRef.current;
                pendingSaveRef.current = false;
                pendingOverridesRef.current = null;
                // Use setTimeout to avoid stack overflow
                setTimeout(() => {
                    saveToFirebase(storedOverrides ? {
                        ...storedOverrides,
                        id: storedOverrides.id ?? projectIdRef.current
                    } : { id: projectIdRef.current });
                }, 100);
            }
        }
    }, [user?.uid, isSaving, buildFirebaseSaveData, projectName, resolveUniqueProjectName]);

    // Debounced auto-save to localStorage (2 second delay)
    useEffect(() => {
        // Skip auto-save when loading a project to avoid redundant write
        if (step >= 1 && hasProjectContent && !isLoadingProject) {
            // Clear any existing timer
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            // Set new debounced save
            saveTimerRef.current = setTimeout(() => {
                save(buildLocalSaveData());
            }, 2000);
        }
        // Cleanup on unmount - save immediately to prevent data loss
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                // Save immediately on unmount (debounced save might not have fired)
                if (step >= 1 && hasProjectContent) {
                    save(buildLocalSaveData());
                }
            }
        };
    }, [step, dayType, hasProjectContent, analysis, bands, config, generatedSchedules, save, buildLocalSaveData, isLoadingProject]);

    // Warn before navigating away if there are unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            // Consider unsaved if debounce timer is running or actively saving
            const hasUnsavedChanges = saveTimerRef.current !== null || isSaving;
            if (hasUnsavedChanges && step >= 1) {
                e.preventDefault();
                e.returnValue = ''; // Chrome requires returnValue to be set
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isSaving, step]);
    // ========== END CONSOLIDATED SAVE SYSTEM ==========

    // Check for saved progress on mount
    useEffect(() => {
        if (!hasCheckedProgress && hasProgress()) {
            const progress = load();
            setSavedProgress(progress);
            setShowResumeModal(true);
        }
        setHasCheckedProgress(true);
    }, [hasCheckedProgress, hasProgress, load, setHasCheckedProgress]);

    const handleResume = () => {
        if (savedProgress) {
            setStep(savedProgress.step);
            setMaxStepReached(Math.max(savedProgress.step, maxStepReached));
            setDayType(savedProgress.dayType);
            if (savedProgress.projectName) {
                setProjectName(savedProgress.projectName);
                setIsAutoProjectName(false);
            }
            if (savedProgress.analysis) {
                setAnalysis(savedProgress.analysis);
                setSegmentNames(extractSegmentNames(savedProgress.analysis));
            }
            if (savedProgress.bands) setBands(savedProgress.bands);
            if (savedProgress.config) setConfig(savedProgress.config);
            if (savedProgress.generatedSchedules) setGeneratedSchedules(savedProgress.generatedSchedules);

            // Restore Raw Data if available
            if (savedProgress.parsedData && savedProgress.parsedData.length > 0) {
                setParsedData(savedProgress.parsedData);
            }

            toast.success('Progress Restored', 'Continuing from where you left off');
        }
        setShowResumeModal(false);
    };

    const handleStartFresh = () => {
        clear();
        setProjectName(DEFAULT_PROJECT_NAME);
        setIsAutoProjectName(true);
        setIsMasterCompareActive(false);
        setMasterBaseline(null);
        setIsCompareLoading(false);
        setShowResumeModal(false);
    };

    // Save Feedback State
    const [isManualSaving, setIsManualSaving] = useState(false);
    const [manualSaveSuccess, setManualSaveSuccess] = useState(false);

    const handleSaveProgress = async () => {
        setIsManualSaving(true);

        // Save to localStorage immediately (uses consolidated helper)
        saveToLocalStorage();

        // Also save to Firebase if user is authenticated (uses consolidated helper with lock)
        if (user?.uid) {
            try {
                await saveToFirebase();
                setManualSaveSuccess(true);
                setTimeout(() => setManualSaveSuccess(false), 2000);
                toast.success('Saved to Cloud', 'Schedule backed up securely');
            } catch (e) {
                toast.error('Cloud Save Failed', 'Saved locally. Click "Save" to retry.');
            }
        } else {
            setManualSaveSuccess(true);
            setTimeout(() => setManualSaveSuccess(false), 2000);
            toast.info('Saved Locally', 'Sign in to save to cloud');
        }
        setIsManualSaving(false);
    };

    // Handle project rename with auto-save
    const handleRenameProject = async (newName: string) => {
        setProjectName(newName);
        setIsAutoProjectName(false);

        // Auto-save the rename to Firebase if authenticated (uses consolidated helper with lock)
        if (user?.uid && projectId && !isSaving) {
            try {
                await saveToFirebase({ name: newName });
                toast.success('Renamed', `Project renamed to "${newName}"`);
            } catch (e) {
                toast.warning('Rename Saved Locally', 'Could not sync to cloud');
            }
        }
    };

    const handleNext = async () => {
        if (step === 1) {
            if (files.length === 0) {
                toast.warning('No Files', 'Please upload at least one CSV file');
                return;
            }
            try {
                // Parse files
                const results = await Promise.all(files.map(f => parseRuntimeCSV(f)));
                setParsedData(results);

                // Run initial analysis
                const rawAnalysis = calculateTotalTripTimes(results);
                const withOutliers = detectOutliers(rawAnalysis);
                const { buckets, bands: generatedBands } = calculateBands(withOutliers);

                setAnalysis(buckets);
                setBands(generatedBands);
                setSegmentNames(extractSegmentNames(buckets));

                // Build segmentsMap for direction-keyed lookups
                const groupedSegments: Record<string, SegmentRawData[]> = {};
                results.forEach(pd => {
                    const dir = pd.detectedDirection || 'North';
                    if (!groupedSegments[dir]) groupedSegments[dir] = [];
                    groupedSegments[dir].push(...pd.segments);
                });
                setSegmentsMap(groupedSegments);

                // Auto-detect route number from parsed files
                // When 2 files have the same numeric base but different letter suffixes
                // (e.g., "12A" North + "12B" South), use the common base ("12") as the route.
                const autoRouteNumber = resolveAutoRouteNumber(
                    results.map(r => r.detectedRouteNumber)
                );
                if (autoRouteNumber) {
                    setConfig(prev => ({
                        ...prev,
                        routeNumber: autoRouteNumber!
                    }));
                }

                setStep(2);
                toast.success('Files Parsed', 'Runtime data analyzed successfully');
            } catch (error) {
                console.error(error);
                toast.error('Parse Error', 'Failed to parse CSV files. Please check the format.');
            }
        } else if (step === 2) {
            // Initialize one block for convenience if empty
            if (config.blocks.length === 0) {
                setConfig(prev => ({
                    ...prev,
                    blocks: [{ id: `${prev.routeNumber}-1`, startTime: DEFAULT_START_TIME, endTime: DEFAULT_END_TIME }]
                }));
            }
            setStep(3);
        } else if (step === 3) {
            // Validate before generating
            if (parsedData.length === 0) {
                toast.error('No Data', 'No data found. Please go back to Step 1 and re-upload your files.');
                return;
            }

            // Non-blocking guidance: strict cycle should be close to observed runtime bands.
            if (config.cycleMode !== 'Floating') {
                const bandsWithData = bands.filter(b => b.count > 0 && b.avg > 0);
                if (bandsWithData.length > 0 && config.cycleTime > 0) {
                    const suggested = Math.round(
                        bandsWithData.reduce((sum, b) => sum + (b.avg * b.count), 0) /
                        bandsWithData.reduce((sum, b) => sum + b.count, 0)
                    );
                    const deltaPct = Math.round(((config.cycleTime - suggested) / suggested) * 100);
                    if (Math.abs(deltaPct) >= 35) {
                        toast.error(
                            'Strict Cycle Time Is Far Off',
                            `${config.cycleTime}m vs observed ~${suggested}m (${deltaPct > 0 ? '+' : ''}${deltaPct}%).`
                        );
                    } else if (Math.abs(deltaPct) >= 20) {
                        toast.warning(
                            'Check Strict Cycle Time',
                            `Configured ${config.cycleTime}m vs observed ~${suggested}m (${deltaPct > 0 ? '+' : ''}${deltaPct}%).`
                        );
                    }
                }
            }

            // Sort parsed data by direction
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

            // Generate schedule
            const generatedTables = generateSchedule(
                config,
                analysis,
                bands,
                freshBandSummary,
                groupedData,
                dayType,
                gtfsStopLookup,
                masterStopCodes
            );

            if (generatedTables.length === 0) {
                toast.error('Generation Failed', 'Could not generate schedule. Check cycle time and data format.');
                return;
            }

            setGeneratedSchedules(generatedTables);

            // Sync block configs with actual generated start/end stops.
            // The autofill from master may have different stops than the runtime
            // data used for generation (e.g. B. South GO pullout stop).
            const toOp = (m: number) => m < 240 ? m + 1440 : m;
            const blockFirstTrip = new Map<string, { startTime: number; stops: Record<string, string>; direction: string }>();
            const blockLastTrip = new Map<string, { endTime: number; stops: Record<string, string> }>();
            for (const table of generatedTables) {
                for (const trip of table.trips) {
                    const opStart = toOp(trip.startTime);
                    const opEnd = toOp(trip.endTime);
                    const existing = blockFirstTrip.get(trip.blockId);
                    if (!existing || opStart < toOp(existing.startTime)) {
                        blockFirstTrip.set(trip.blockId, { startTime: trip.startTime, stops: trip.stops, direction: trip.direction });
                    }
                    const existingLast = blockLastTrip.get(trip.blockId);
                    if (!existingLast || opEnd > toOp(existingLast.endTime)) {
                        blockLastTrip.set(trip.blockId, { endTime: trip.endTime, stops: trip.stops });
                    }
                }
            }
            const updatedBlocks = config.blocks.map(block => {
                const first = blockFirstTrip.get(block.id);
                const last = blockLastTrip.get(block.id);
                if (!first) return block;
                const firstStops = Object.keys(first.stops);
                const lastStops = last ? Object.keys(last.stops) : [];
                return {
                    ...block,
                    // Preserve configured block start stop (from Step 3/master autofill).
                    // Do not overwrite it with generated table column order.
                    startStop: block.startStop || firstStops[0],
                    endStop: lastStops[lastStops.length - 1] || block.endStop,
                    startDirection: (first.direction === 'North' || first.direction === 'South') ? first.direction as 'North' | 'South' : block.startDirection,
                };
            });
            setConfig({ ...config, blocks: updatedBlocks });

            setStep(4);
            toast.success('Schedule Generated', `Created ${generatedTables.length} schedule(s)`);

            // Save generated schedule - localStorage backup + Firebase (uses consolidated helpers)
            // Note: Pass generatedTables directly since state hasn't updated yet
            saveToLocalStorage({ generatedSchedules: generatedTables });

            if (user?.uid && generatedTables.length > 0) {
                try {
                    await saveToFirebase({ generatedSchedules: generatedTables, isGenerated: true });
                    toast.success('Saved to Cloud', 'Schedule backed up securely');
                } catch (e) {
                    toast.error('Cloud Save Failed', 'Saved locally. Click "Save" to retry.');
                }
            }
        } else if (step === 4) {
            // Finalize / Export
            if (onGenerate) {
                onGenerate(generatedSchedules);
                toast.success('Exported', 'Schedule exported to dashboard');
            } else {
                toast.info('Ready', 'Schedule is ready for export');
            }
        }
    };

    const resetWizardState = useCallback(() => {
        clear();
        setStep(1);
        setMaxStepReached(1);
        setFiles([]);
        setParsedData([]);
        setAnalysis([]);
        setBands([]);
        setSegmentNames([]);
        setConfig({
            routeNumber: DEFAULT_ROUTE_NUMBER,
            cycleTime: DEFAULT_CYCLE_TIME,
            recoveryRatio: DEFAULT_RECOVERY_RATIO,
            blocks: []
        });
        setProjectName(DEFAULT_PROJECT_NAME);
        setIsAutoProjectName(true);
        setProjectId(undefined);
        projectIdRef.current = undefined;
        setIsMasterCompareActive(false);
        setMasterBaseline(null);
        setIsCompareLoading(false);
    }, [clear]);

    const handleNewProject = () => {
        if (files.length > 0 || step > 1) {
            if (!confirm('Start a new project? Current progress will be cleared.')) return;
        }
        resetWizardState();
        toast.info('New Project', 'Starting fresh');
    };

    // Helper: Restore project data into wizard state (shared by load callbacks)
    const restoreProjectData = useCallback((fullProject: {
        id: string;
        name: string;
        dayType: 'Weekday' | 'Saturday' | 'Sunday';
        analysis?: TripBucketAnalysis[];
        bands?: TimeBand[];
        config?: ScheduleConfig;
        generatedSchedules?: MasterRouteTable[];
        parsedData?: RuntimeData[];
        isGenerated?: boolean;
    }) => {
        setIsMasterCompareActive(false);
        setMasterBaseline(null);
        setIsCompareLoading(false);
        setProjectId(fullProject.id);
        projectIdRef.current = fullProject.id;
        setProjectName(fullProject.name);
        setIsAutoProjectName(false);
        setDayType(fullProject.dayType);

        if (fullProject.analysis && fullProject.analysis.length > 0) {
            setAnalysis(fullProject.analysis);
            setSegmentNames(extractSegmentNames(fullProject.analysis));
        }
        if (fullProject.bands && fullProject.bands.length > 0) {
            setBands(fullProject.bands);
        }
        if (fullProject.config) {
            setConfig(fullProject.config);
        }
        if (fullProject.generatedSchedules && fullProject.generatedSchedules.length > 0) {
            setGeneratedSchedules(fullProject.generatedSchedules);
        }
        if (fullProject.parsedData && fullProject.parsedData.length > 0) {
            setParsedData(fullProject.parsedData);
        }
    }, []);

    // ========== COMPARE TO MASTER (INLINE TOGGLE) ==========

    const handleToggleMasterCompare = async () => {
        // Toggle OFF
        if (isMasterCompareActive) {
            setIsMasterCompareActive(false);
            setMasterBaseline(null);
            return;
        }

        // Toggle ON - fetch master schedule
        if (!team?.id) return;

        setIsCompareLoading(true);
        try {
            const routeIdentity = buildRouteIdentity(config.routeNumber, dayType);
            const result = await getMasterSchedule(team.id, routeIdentity);

            if (!result) {
                toast.warning('No Master Found', `No Master schedule found for Route ${config.routeNumber} ${dayType}`);
                return;
            }

            setMasterBaseline([result.content.northTable, result.content.southTable]);
            setIsMasterCompareActive(true);
        } catch (error) {
            console.error('Error fetching master schedule:', error);
            toast.error('Compare Failed', 'Could not fetch Master schedule');
        } finally {
            setIsCompareLoading(false);
        }
    };

    // ========== MASTER SCHEDULE UPLOAD ==========

    const handleUploadToMaster = async () => {
        if (!hasTeam || !team || generatedSchedules.length === 0) return;

        try {
            // Find north and south tables using centralized direction config
            const northTable = generatedSchedules.find(t => extractDirectionFromName(t.routeName) === 'North');
            const southTable = generatedSchedules.find(t => extractDirectionFromName(t.routeName) === 'South');

            if (!northTable || !southTable) {
                toast.error('Missing Tables', 'Both North and South schedules are required');
                return;
            }

            // Extract route info from first table
            const routeNumber = extractRouteNumber(northTable.routeName);
            const dayType = extractDayType(northTable.routeName) as MasterDayType;

            // Prepare confirmation data
            const confirmation = await prepareUpload(
                team.id,
                northTable,
                southTable,
                routeNumber,
                dayType
            );

            setUploadConfirmation(confirmation);
            setShowUploadModal(true);
        } catch (error) {
            console.error('Error preparing upload:', error);
            toast.error('Upload Failed', 'Could not prepare upload');
        }
    };

    const handleConfirmUpload = async () => {
        if (!user || !team || !uploadConfirmation || generatedSchedules.length === 0) return;

        setIsUploading(true);
        try {
            const northTable = generatedSchedules.find(t => extractDirectionFromName(t.routeName) === 'North')!;
            const southTable = generatedSchedules.find(t => extractDirectionFromName(t.routeName) === 'South')!;

            await uploadToMasterSchedule(
                team.id,
                user.uid,
                user.displayName || user.email?.split('@')[0] || 'User',
                northTable,
                southTable,
                uploadConfirmation.routeNumber,
                uploadConfirmation.dayType,
                'wizard'
            );

            toast.success('Uploaded!', `${uploadConfirmation.routeNumber} uploaded to Master Schedule`);
            setShowUploadModal(false);
            setUploadConfirmation(null);
        } catch (error) {
            console.error('Error uploading to master:', error);
            toast.error('Upload Failed', 'Could not upload to Master Schedule');
        } finally {
            setIsUploading(false);
        }
    };

    const handleCancelUpload = () => {
        setShowUploadModal(false);
        setUploadConfirmation(null);
    };

    return (
        <>
            {/* Resume Modal */}
            <ResumeWizardModal
                isOpen={showResumeModal}
                progress={savedProgress}
                onResume={handleResume}
                onStartFresh={handleStartFresh}
                onClose={() => setShowResumeModal(false)}
                isAuthenticated={!!user?.uid}
            />

            <div className="flex flex-col h-full bg-gray-50/50">
                {/* Wizard Header */}
                <NewScheduleHeader
                    currentStep={step}
                    stepLabel={step === 1 ? 'Upload Data' : step === 2 ? 'Runtime Analysis' : 'Build Schedule'}
                    projectName={projectName}
                    onRenameProject={handleRenameProject}
                    onOpenProjects={() => setShowProjectManager(true)}
                    onNewProject={handleNewProject}
                    onSaveVersion={handleSaveProgress}
                    onClose={onBack}
                    onStepClick={(s) => setStep(s)}
                    maxStepReached={maxStepReached}
                    cloudSaveStatus={cloudSaveStatus}
                    lastCloudSaveTime={lastCloudSaveTime}
                    isDirty={isDirty}
                    isAuthenticated={!!user?.uid}
                    onRetrySave={handleSaveProgress}
                    routeNumber={step >= 3 ? config.routeNumber : undefined}
                    dayType={dayType}
                    isMasterCompareActive={isMasterCompareActive}
                    onToggleMasterCompare={handleToggleMasterCompare}
                    isCompareLoading={isCompareLoading}
                    compareAvailable={step === 4 && !!team?.id}
                />

                {/* Content Area */}
                <div className="flex-grow p-8 overflow-auto">
                    <div className={step === 4 || step === 2 ? "w-full" : "max-w-5xl mx-auto"}>
                        {step === 1 && (
                            <Step1Upload
                                files={files}
                                setFiles={setFiles}
                                dayType={dayType}
                                setDayType={setDayType}
                                userId={user?.uid}
                                onGTFSImport={(result) => {
                                    if (result.success && result.draftId) {
                                        toast.success('GTFS Import Complete', `Created draft for ${result.routeIdentity}`);
                                        // Optionally navigate to the draft editor
                                        onBack(); // Return to dashboard where user can open the draft
                                    }
                                }}
                            />
                        )}
                        {step === 2 && (
                            <Step2Analysis
                                dayType={dayType}
                                analysis={analysis}
                                bands={bands}
                                setAnalysis={handleAnalysisUpdate}
                                segmentsMap={segmentsMap}
                                onBandSummaryChange={setBandSummary}
                            />
                        )}
                        {step === 3 && (
                            <Step3Build
                                dayType={dayType}
                                bands={bands}
                                config={config}
                                setConfig={setConfig}
                                teamId={team?.id}
                                stopSuggestions={stopSuggestions}
                            />
                        )}
                        {step === 4 && (
                            <Step4Schedule
                                initialSchedules={generatedSchedules}
                                bands={bands}
                                analysis={analysis}
                                segmentNames={segmentNames}
                                onUpdateSchedules={setGeneratedSchedules}
                                projectName={projectName}
                                autoSaveStatus={autoSaveStatus}
                                lastSaved={lastSaved}
                                targetCycleTime={(!config.cycleMode || config.cycleMode === 'Strict') ? config.cycleTime : undefined}
                                targetHeadway={(!config.cycleMode || config.cycleMode === 'Strict') && config.blocks.length > 0 ? Math.round(config.cycleTime / config.blocks.length) : undefined}
                                teamId={team?.id}
                                userId={user?.uid}
                                masterBaseline={isMasterCompareActive ? masterBaseline : null}
                                connectionScopeSchedules={connectionScopeSchedules}
                            />
                        )}
                    </div>
                </div>

                {/* Footer / Actions */}
                <div className="bg-white border-t border-gray-200 p-4 px-8 flex justify-between items-center">
                    <button
                        onClick={() => setStep(s => Math.max(1, s - 1))}
                        disabled={step === 1}
                        className="px-6 py-2 rounded-lg text-gray-600 font-bold hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                        Back
                    </button>

                    <div className="flex items-center gap-3">
                        {/* Save Progress Button - context-aware */}
                        {hasProjectContent && (
                            <button
                                onClick={handleSaveProgress}
                                disabled={isManualSaving || (!isDirty && cloudSaveStatus === 'saved')}
                                className={`px-4 py-2 rounded-lg border font-bold flex items-center gap-2 transition-all ${
                                    cloudSaveStatus === 'error'
                                        ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                        : manualSaveSuccess
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                            : (!isDirty && cloudSaveStatus === 'saved')
                                                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                                    }`}
                            >
                                {isManualSaving ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Saving...
                                    </>
                                ) : manualSaveSuccess ? (
                                    <>
                                        <Check size={16} />
                                        Saved!
                                    </>
                                ) : cloudSaveStatus === 'error' ? (
                                    <>
                                        <Save size={16} />
                                        Retry Save
                                    </>
                                ) : (
                                    <>
                                        {user?.uid ? <Cloud size={16} /> : <HardDrive size={16} />}
                                        {user?.uid ? 'Save to Cloud' : 'Save Locally'}
                                    </>
                                )}
                            </button>
                        )}

                        {/* Upload to Master Button (Step 4 or 5, if user has team) */}
                        {step === 4 && hasTeam && generatedSchedules.length > 0 && (
                            <button
                                onClick={handleUploadToMaster}
                                className="px-6 py-2 rounded-lg border-2 border-brand-green text-brand-green font-bold hover:bg-green-50 flex items-center gap-2"
                            >
                                <Upload size={18} />
                                Upload to Master
                            </button>
                        )}

                        {step !== 4 && (
                            <button
                                onClick={handleNext}
                                className="px-6 py-2 rounded-lg bg-brand-blue text-white font-bold hover:brightness-110 shadow-md shadow-blue-500/20 flex items-center gap-2"
                            >
                                {step === 3 ? 'Generate Schedule' : 'Next Step'}
                                <ArrowRight size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Project Manager Modal */}
            <ProjectManagerModal
                isOpen={showProjectManager}
                userId={user?.uid || null}
                currentProjectId={projectId}
                onClose={() => setShowProjectManager(false)}
                onLoadProject={async (project) => {
                    setIsLoadingProject(true);
                    setIsMasterCompareActive(false);
                    setMasterBaseline(null);
                    setIsCompareLoading(false);

                    if (user?.uid) {
                        try {
                            const fullProject = await getProject(user.uid, project.id);
                            if (fullProject) {
                                restoreProjectData(fullProject);

                                // Calculate which step to go to based on what data exists
                                let nextStep = 1;
                                if (fullProject.isGenerated && fullProject.generatedSchedules?.length) {
                                    nextStep = 4;
                                } else if (fullProject.config?.blocks?.length) {
                                    nextStep = 3;
                                } else if (fullProject.analysis?.length || fullProject.parsedData?.length) {
                                    nextStep = 2;
                                }

                                setStep(nextStep);
                                setMaxStepReached(nextStep);
                                toast.success('Project Loaded', `${fullProject.name} - Step ${nextStep}`);
                            } else {
                                toast.error('Load Failed', 'Project data not found');
                            }
                        } catch (error) {
                            console.error('Error loading project:', error);
                            toast.error('Load Failed', 'Could not load project data');
                        }
                    } else {
                        toast.error('Not Signed In', 'Please sign in to load projects');
                    }
                    setShowProjectManager(false);

                    // Re-enable auto-save after state updates settle
                    setTimeout(() => setIsLoadingProject(false), 3000);
                }}
                onLoadGeneratedSchedule={async (schedules, name, id) => {
                    setIsLoadingProject(true);
                    setIsMasterCompareActive(false);
                    setMasterBaseline(null);
                    setIsCompareLoading(false);
                    // Pre-set schedules so step 4 renders immediately
                    setGeneratedSchedules(schedules);

                    if (user?.uid) {
                        try {
                            const fullProject = await getProject(user.uid, id);
                            if (fullProject) {
                                restoreProjectData(fullProject);
                            }
                        } catch (e) {
                            console.error('Failed to load full project data:', e);
                            // Fallback: set minimal identity if full load fails
                            setProjectId(id);
                            projectIdRef.current = id;
                            setProjectName(name);
                            setIsAutoProjectName(false);
                        }
                    } else {
                        setProjectId(id);
                        projectIdRef.current = id;
                        setProjectName(name);
                        setIsAutoProjectName(false);
                    }

                    setStep(4);
                    setMaxStepReached(4);
                    toast.success('Schedule Loaded', `${name} - Step 4`);

                    setTimeout(() => setIsLoadingProject(false), 1000);
                }}
                onNewProject={() => {
                    resetWizardState();
                    setShowProjectManager(false);
                }}
            />

            {/* Upload to Master Modal */}
            <UploadToMasterModal
                isOpen={showUploadModal}
                confirmation={uploadConfirmation}
                onConfirm={handleConfirmUpload}
                onCancel={handleCancelUpload}
                isUploading={isUploading}
            />
        </>
    );
};
