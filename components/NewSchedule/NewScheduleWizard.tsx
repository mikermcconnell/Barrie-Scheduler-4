
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowRight, Save, Loader2, Check, Upload, Cloud, HardDrive } from 'lucide-react';
import { Step1Upload, type ImportMode, type PerformanceConfig } from './steps/Step1Upload';
import { Step2Analysis } from './steps/Step2Analysis';
import { Step3Build, ScheduleConfig } from './steps/Step3Build';
import { Step4Schedule } from './steps/Step4Schedule';
import { Step2ApprovalFooter } from './step2/Step2ApprovalFooter';
import { parseRuntimeCSV, RuntimeData, SegmentRawData } from './utils/csvParser';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import {
    computeRuntimesFromPerformance,
    getAvailableRuntimeRoutes,
    getStep2CleanHistoryWindow,
    getStep2CleanPerformanceSummary,
    inspectPerformanceRuntimeAvailability,
} from '../../utils/performanceRuntimeComputer';
import type { DayType as PerfDayType } from '../../utils/performanceDataTypes';
import { calculateTotalTripTimes, detectOutliers, calculateBands, hardenRuntimeAnalysisBuckets, TripBucketAnalysis, TimeBand, DirectionBandSummary } from '../../utils/ai/runtimeAnalysis';
import { generateSchedule, MissingApprovedRuntimeError } from '../../utils/schedule/scheduleGenerator';
import { copyNearestMasterRecoveryToGenerated } from '../../utils/schedule/masterRecoveryTransfer';
import { computeSuggestedStrictCycle } from '../../utils/schedule/strictCycleSuggestion';
import { validateMergedRouteBlockContinuity } from '../../utils/schedule/mergedRouteContinuity';
import { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import { useWizardProgress } from '../../hooks/useWizardProgress';
import { NewScheduleHeader } from './NewScheduleHeader';
import { ProjectManagerModal } from './ProjectManagerModal';
import { AutoSaveStatus } from '../../hooks/useAutoSave';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import {
    getAllProjects,
    getProject,
    resetLegacyRuntimeProject,
    saveProject,
    StaleNewScheduleProjectError,
} from '../../utils/services/newScheduleProjectService';
import { UploadToMasterModal } from '../modals/UploadToMasterModal';
import { prepareUpload, uploadToMasterSchedule, getMasterSchedule, getAllStopsWithCodes } from '../../utils/services/masterScheduleService';
import { extractRouteNumber, extractDayType, buildRouteIdentity } from '../../utils/masterScheduleTypes';
import { extractDirectionFromName } from '../../utils/config/routeDirectionConfig';
import type { UploadConfirmation, DayType as MasterDayType } from '../../utils/masterScheduleTypes';
import { buildStopNameToIdMap } from '../../utils/gtfs/gtfsStopLookup';
import { resolveAutoRouteNumber } from './utils/routeInference';
import { resolveStopOrderFromPerformance } from '../../utils/newSchedule/stopOrderResolver';
import {
    buildCanonicalSegmentColumnsFromMasterStops,
    buildRuntimeDerivedCanonicalDirectionStops,
    buildSegmentsMapFromParsedData,
    createDefaultPerformanceConfig,
    createDefaultScheduleConfig,
    deriveWizardStepFromProject,
    getUsableCanonicalDirectionStops,
    getOrderedSegmentNames,
    shouldShowNextStepAction,
    type ApprovedRuntimeModel,
    type OrderedSegmentColumn,
} from './utils/wizardState';
import {
    buildFirebaseWizardSaveData,
    buildLocalWizardProgress,
    normalizeRestoredWizardState,
} from './utils/wizardProjectState';
import { buildFullPerformanceLoadRouteIds } from './utils/performanceRouteLoadOptions';
import {
    buildStep2ReviewResult,
    buildStep2SourceSnapshot,
    type Step2ReviewBuilderInput,
} from './utils/step2ReviewBuilder';
import { buildStep2ParsedDataFingerprint } from './utils/step2ParsedDataFingerprint';
import { buildStep2ApprovedRuntimeModelFromContract } from './utils/step2ApprovedRuntimeModelAdapter';
import { createStep2ApprovedRuntimeContract } from './utils/step2Approval';
import { resolveStep2ApprovalState } from './utils/step2Invalidation';
import { resolveWizardStepWithStep2Gate } from './utils/step2NavigationGate';
import {
    buildStep2StopOrderHealth,
    extractStopOrderDirectionStops,
    type Step2StopOrderHealth,
} from './utils/step2StopOrder';
import type {
    ApprovedRuntimeContract,
    Step2ApprovalState,
    Step2CanonicalRouteSource,
    Step2ReviewResult,
} from './utils/step2ReviewTypes';

// Constants - centralized magic numbers
const DEFAULT_CYCLE_TIME = 60;
const DEFAULT_RECOVERY_RATIO = 15;
const DEFAULT_ROUTE_NUMBER = '10';
const DEFAULT_START_TIME = '06:00';
const DEFAULT_END_TIME = '22:00';
const DEFAULT_PROJECT_NAME = 'New Schedule Project';
const DEFAULT_IMPORT_MODE: ImportMode = 'performance';

const buildRuntimeAnalysisModel = (results: RuntimeData[]) => {
    const segmentsMap = buildSegmentsMapFromParsedData(results);
    const orderedSegmentNames = getOrderedSegmentNames(segmentsMap);
    const rawAnalysis = calculateTotalTripTimes(results);
    const hardenedAnalysis = hardenRuntimeAnalysisBuckets(rawAnalysis, orderedSegmentNames);
    const withOutliers = detectOutliers(hardenedAnalysis);
    const { buckets, bands } = calculateBands(withOutliers);
    return { buckets, bands, segmentsMap };
};

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
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(final|latest|updated|copy|draft)\b/gi, ' ')
        .replace(/\b(v|ver|rev)\s*\d+\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const formatFooterTimestamp = (value?: string | null): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(parsed);
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
    const [importMode, setImportMode] = useState<ImportMode>(DEFAULT_IMPORT_MODE);
    const [performanceConfig, setPerformanceConfig] = useState<PerformanceConfig>({ routeId: '', dateRange: null });
    const [performanceLoadRouteId, setPerformanceLoadRouteId] = useState<string>('all');
    const [performanceLoadRouteManuallySelected, setPerformanceLoadRouteManuallySelected] = useState(false);
    const [autofillFromMaster, setAutofillFromMaster] = useState(true);
    const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
    const [isAutoProjectName, setIsAutoProjectName] = useState(true);
    const [projectId, setProjectId] = useState<string | undefined>();
    const projectIdRef = useRef<string | undefined>(undefined);
    const projectRevisionRef = useRef(0);
    const projectSessionRef = useRef(0);
    const pendingRestoredStepRef = useRef<1 | 2 | 3 | 4 | null>(null);
    const [showProjectManager, setShowProjectManager] = useState(false);

    // Performance data (lazy-loaded only when performance mode is selected)
    const performanceMetadataQuery = usePerformanceMetadataQuery(team?.id);
    const performanceLoadRouteIds = useMemo(() => {
        const paths = performanceMetadataQuery.data?.routeStoragePaths;
        const monthlyPaths = performanceMetadataQuery.data?.routeMonthlyStoragePaths;
        const routeIds = [
            ...Object.keys(paths || {}),
            ...Object.keys(monthlyPaths || {}),
        ];
        if (routeIds.length === 0) return [];
        return buildFullPerformanceLoadRouteIds(routeIds);
    }, [performanceMetadataQuery.data?.routeStoragePaths, performanceMetadataQuery.data?.routeMonthlyStoragePaths]);
    const defaultPerformanceLoadRouteId = useMemo(() => {
        if (performanceLoadRouteIds.length === 0) return 'all';
        const configuredRouteId = performanceConfig.routeId.trim();
        if (configuredRouteId && performanceLoadRouteIds.includes(configuredRouteId)) {
            return configuredRouteId;
        }
        if (performanceLoadRouteId !== 'all' && performanceLoadRouteIds.includes(performanceLoadRouteId)) {
            return performanceLoadRouteId;
        }
        return performanceLoadRouteIds[0];
    }, [performanceConfig.routeId, performanceLoadRouteId, performanceLoadRouteIds]);
    const effectivePerformanceLoadRouteId = (
        performanceLoadRouteId === 'all' && !performanceLoadRouteManuallySelected
            ? defaultPerformanceLoadRouteId
            : performanceLoadRouteId
    );
    useEffect(() => {
        if (importMode !== 'performance' || performanceLoadRouteIds.length === 0) return;
        if (performanceLoadRouteManuallySelected && performanceLoadRouteId === 'all') return;

        const configuredRouteId = performanceConfig.routeId.trim();
        if (configuredRouteId && performanceLoadRouteIds.includes(configuredRouteId)) {
            setPerformanceLoadRouteId(current => (
                current === configuredRouteId ? current : configuredRouteId
            ));
            return;
        }

        const firstRouteId = defaultPerformanceLoadRouteId;
        setPerformanceLoadRouteId(current => {
            if (current !== 'all' && performanceLoadRouteIds.includes(current)) return current;
            return firstRouteId;
        });
        setPerformanceConfig(current => (
            current.routeId ? current : { ...current, routeId: firstRouteId }
        ));
    }, [
        defaultPerformanceLoadRouteId,
        importMode,
        performanceConfig.routeId,
        performanceLoadRouteId,
        performanceLoadRouteIds,
        performanceLoadRouteManuallySelected,
    ]);
    const perfQuery = usePerformanceDataQuery(
        team?.id,
        importMode === 'performance' && !performanceMetadataQuery.isLoading,
        performanceMetadataQuery.data,
        effectivePerformanceLoadRouteId
    );
    const perfData = perfQuery.data;
    const cleanStep2PerfData = useMemo(
        () => getStep2CleanPerformanceSummary(perfData),
        [perfData]
    );
    const performanceHistoryStatus = useMemo(() => {
        if (!perfData) return null;
        const cleanWindow = getStep2CleanHistoryWindow(perfData.dailySummaries || [], perfData.metadata);
        return {
            totalDays: perfData.dailySummaries?.length ?? 0,
            cleanDays: cleanWindow.dailySummaries.length,
            runtimeLogicVersion: perfData.metadata?.runtimeLogicVersion,
            cleanHistoryStartDate: cleanWindow.cleanHistoryStartDate,
            excludedLegacyDayCount: cleanWindow.excludedLegacyDayCount,
            usesCleanHistoryCutoff: cleanWindow.usesCleanHistoryCutoff,
        };
    }, [perfData]);

    const availableRoutes = useMemo(() => {
        if (!cleanStep2PerfData?.dailySummaries) return [];
        const normalizedDayType = dayType.toLowerCase() as PerfDayType;
        return getAvailableRuntimeRoutes(
            cleanStep2PerfData.dailySummaries,
            normalizedDayType,
            performanceConfig.dateRange || undefined
        );
    }, [cleanStep2PerfData?.dailySummaries, dayType, performanceConfig.dateRange]);

    const performanceDateRange = useMemo(() => {
        if (!cleanStep2PerfData?.metadata?.dateRange) return undefined;
        return cleanStep2PerfData.metadata.dateRange;
    }, [cleanStep2PerfData?.metadata?.dateRange]);

    const performanceDiagnostics = useMemo(() => {
        if (!perfData?.dailySummaries || !performanceConfig.routeId) return null;
        return inspectPerformanceRuntimeAvailability(perfData.dailySummaries, {
            routeId: performanceConfig.routeId,
            dayType: dayType.toLowerCase() as PerfDayType,
            dateRange: performanceConfig.dateRange || undefined,
            metadata: perfData.metadata,
        });
    }, [dayType, perfData?.dailySummaries, perfData?.metadata, performanceConfig.dateRange, performanceConfig.routeId]);

    const handlePerformanceLoadRouteChange = useCallback((routeId: string) => {
        setPerformanceLoadRouteManuallySelected(true);
        setPerformanceLoadRouteId(routeId);
        if (routeId !== 'all') {
            setPerformanceConfig(prev => ({
                ...prev,
                routeId,
            }));
        }
    }, []);

    // State for Step 2 Analysis
    const [parsedData, setParsedData] = useState<RuntimeData[]>([]);
    const [analysis, setAnalysis] = useState<TripBucketAnalysis[]>([]);
    const [bands, setBands] = useState<TimeBand[]>([]);
    const [, setBandSummary] = useState<DirectionBandSummary>({});
    const [segmentsMap, setSegmentsMap] = useState<Record<string, SegmentRawData[]>>({});
    const [segmentNames, setSegmentNames] = useState<string[]>([]);
    const [matrixAnalysis, setMatrixAnalysis] = useState<TripBucketAnalysis[]>([]);
    const [matrixSegmentsMap, setMatrixSegmentsMap] = useState<Record<string, SegmentRawData[]>>({});
    const [troubleshootingPatternWarning, setTroubleshootingPatternWarning] = useState<string | null>(null);
    const [canonicalSegmentColumns, setCanonicalSegmentColumns] = useState<OrderedSegmentColumn[] | undefined>(undefined);
    const [canonicalDirectionStops, setCanonicalDirectionStops] = useState<Record<string, string[]> | undefined>(undefined);
    const [canonicalRouteIdentity, setCanonicalRouteIdentity] = useState<string | undefined>(undefined);
    const [canonicalRouteSource, setCanonicalRouteSource] = useState<Step2CanonicalRouteSource | undefined>(undefined);
    const [step2StopOrderHealth, setStep2StopOrderHealth] = useState<Step2StopOrderHealth | null>(null);
    const [approvedRuntimeContract, setApprovedRuntimeContract] = useState<ApprovedRuntimeContract | null>(null);
    const [legacyApprovedRuntimeModel, setLegacyApprovedRuntimeModel] = useState<ApprovedRuntimeModel | null>(null);
    const [step2WarningsAcknowledged, setStep2WarningsAcknowledged] = useState(false);

    // State for Step 3 Config
    const [config, setConfig] = useState<ScheduleConfig>({
        routeNumber: DEFAULT_ROUTE_NUMBER,
        cycleTime: DEFAULT_CYCLE_TIME,
        recoveryRatio: DEFAULT_RECOVERY_RATIO,
        blocks: []
    });

    // State for Step 4 Schedule
    const [generatedSchedules, setGeneratedSchedules] = useState<MasterRouteTable[]>([]);
    const [originalGeneratedSchedules, setOriginalGeneratedSchedules] = useState<MasterRouteTable[]>([]);
    const [step4EditorSessionKey, setStep4EditorSessionKey] = useState(0);

    // Master Schedule Upload State
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmation | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isPreparingStep2, setIsPreparingStep2] = useState(false);
    const [step2LoadingMessage, setStep2LoadingMessage] = useState('Analyzing runtime data...');
    const [isPreparingStep4, setIsPreparingStep4] = useState(false);
    const [step4LoadingMessage, setStep4LoadingMessage] = useState('Generating schedule...');

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
        if (importMode === 'performance') return;
        setStep2StopOrderHealth(null);
    }, [importMode]);

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

    const currentConfiguredRouteIdentity = useMemo(() => (
        config.routeNumber?.trim()
            ? buildRouteIdentity(config.routeNumber.trim(), dayType)
            : undefined
    ), [config.routeNumber, dayType]);
    const step2ImportMode = importMode === 'performance' ? 'performance' : 'csv';

    const activeCanonicalSegmentColumns = useMemo(() => (
        currentConfiguredRouteIdentity && canonicalRouteIdentity === currentConfiguredRouteIdentity
            ? canonicalSegmentColumns
            : undefined
    ), [canonicalRouteIdentity, canonicalSegmentColumns, currentConfiguredRouteIdentity]);

    const activeCanonicalDirectionStops = useMemo(() => (
        currentConfiguredRouteIdentity && canonicalRouteIdentity === currentConfiguredRouteIdentity
            ? canonicalDirectionStops
            : undefined
    ), [canonicalDirectionStops, canonicalRouteIdentity, currentConfiguredRouteIdentity]);

    const activeCanonicalRouteSource = useMemo(() => (
        currentConfiguredRouteIdentity && canonicalRouteIdentity === currentConfiguredRouteIdentity
            ? canonicalRouteSource
            : undefined
    ), [canonicalRouteIdentity, canonicalRouteSource, currentConfiguredRouteIdentity]);

    const runtimeDerivedCanonicalDirectionStops = useMemo(() => {
        if (step2ImportMode !== 'csv' || activeCanonicalDirectionStops || Object.keys(segmentsMap).length === 0) {
            return undefined;
        }

        return buildRuntimeDerivedCanonicalDirectionStops(
            (config.routeNumber || DEFAULT_ROUTE_NUMBER).trim(),
            segmentsMap
        );
    }, [activeCanonicalDirectionStops, config.routeNumber, segmentsMap, step2ImportMode]);

    const runtimeDerivedCanonicalSegmentColumns = useMemo(() => {
        if (!runtimeDerivedCanonicalDirectionStops) return undefined;

        return buildCanonicalSegmentColumnsFromMasterStops(
            (config.routeNumber || DEFAULT_ROUTE_NUMBER).trim(),
            runtimeDerivedCanonicalDirectionStops.North ?? [],
            runtimeDerivedCanonicalDirectionStops.South ?? []
        );
    }, [config.routeNumber, runtimeDerivedCanonicalDirectionStops]);

    const effectiveCanonicalDirectionStops = activeCanonicalDirectionStops ?? runtimeDerivedCanonicalDirectionStops;
    const effectiveCanonicalSegmentColumns = activeCanonicalSegmentColumns ?? runtimeDerivedCanonicalSegmentColumns;
    const effectiveCanonicalRouteSource = useMemo(() => (
        activeCanonicalRouteSource ?? (
            runtimeDerivedCanonicalDirectionStops
                ? {
                    type: 'runtime-derived' as const,
                    routeIdentity: currentConfiguredRouteIdentity,
                    versionHint: 'csv-runtime-segment-chain',
                }
                : undefined
        )
    ), [activeCanonicalRouteSource, currentConfiguredRouteIdentity, runtimeDerivedCanonicalDirectionStops]);

    const parsedDataFingerprint = useMemo(
        () => buildStep2ParsedDataFingerprint(parsedData, {
            analysis,
            bands,
            segmentsMap,
            matrixAnalysis,
            matrixSegmentsMap,
            troubleshootingPatternWarning,
            canonicalDirectionStops: effectiveCanonicalDirectionStops,
            canonicalSegmentColumns: effectiveCanonicalSegmentColumns,
        }),
        [
            analysis,
            bands,
            effectiveCanonicalDirectionStops,
            effectiveCanonicalSegmentColumns,
            matrixAnalysis,
            matrixSegmentsMap,
            parsedData,
            segmentsMap,
            troubleshootingPatternWarning,
        ]
    );

    const step2PlannerOverrides = useMemo(() => ({
        excludedBuckets: analysis
            .filter(bucket => bucket.ignored)
            .map(bucket => bucket.timeBucket),
    }), [analysis]);

    const cycleAnalysisByStartDirection = useMemo(() => {
        if (!parsedData.some(runtime => runtime.cycleStartDirection)) return undefined;

        const result: Partial<Record<'North' | 'South', TripBucketAnalysis[]>> = {};
        const hasNorthStartModel = parsedData.some(runtime => runtime.cycleStartDirection === 'North');
        const primaryDirection: 'North' | 'South' = hasNorthStartModel ? 'North' : 'South';
        const excludedBuckets = new Set(step2PlannerOverrides.excludedBuckets);
        (['North', 'South'] as const).forEach(direction => {
            const directionResults = parsedData.filter(runtime => runtime.cycleStartDirection === direction);
            if (directionResults.length > 0) {
                const directionAnalysis = direction === primaryDirection
                    ? analysis
                    : buildRuntimeAnalysisModel(directionResults).buckets;
                result[direction] = directionAnalysis.map(bucket => (
                    excludedBuckets.has(bucket.timeBucket)
                        ? { ...bucket, ignored: true }
                        : bucket
                ));
            }
        });
        return result;
    }, [analysis, parsedData, step2PlannerOverrides.excludedBuckets]);

    const step2ReviewBuilderInput = useMemo<Step2ReviewBuilderInput | null>(() => {
        if (analysis.length === 0) return null;

        return {
            routeIdentity: currentConfiguredRouteIdentity || buildRouteIdentity((config.routeNumber || DEFAULT_ROUTE_NUMBER).trim(), dayType),
            routeNumber: (config.routeNumber || DEFAULT_ROUTE_NUMBER).trim(),
            dayType,
            importMode: step2ImportMode,
            performanceConfig: step2ImportMode === 'performance'
                ? {
                    routeId: performanceConfig.routeId,
                    dateRange: performanceConfig.dateRange,
                }
                : null,
            performanceDiagnostics: step2ImportMode === 'performance'
                ? {
                    routeId: performanceConfig.routeId,
                    dateRange: performanceConfig.dateRange,
                    runtimeLogicVersion: performanceDiagnostics?.runtimeLogicVersion,
                    importedAt: performanceDiagnostics?.importedAt,
                    cleanHistoryStartDate: performanceDiagnostics?.cleanHistoryStartDate,
                    excludedLegacyDayCount: performanceDiagnostics?.excludedLegacyDayCount,
                    usesCleanHistoryCutoff: performanceDiagnostics?.usesCleanHistoryCutoff,
                }
                : null,
            parsedDataFingerprint,
            canonicalDirectionStops: effectiveCanonicalDirectionStops ?? null,
            canonicalRouteSource: effectiveCanonicalRouteSource ?? {
                type: 'runtime-derived',
                routeIdentity: currentConfiguredRouteIdentity,
                versionHint: 'runtime-derived',
            },
            plannerOverrides: step2PlannerOverrides,
            analysis,
            cycleAnalysisByStartDirection,
            bands,
            segmentsMap,
            matrixAnalysis,
            matrixSegmentsMap,
            troubleshootingPatternWarning,
            canonicalSegmentColumns: effectiveCanonicalSegmentColumns ?? null,
            runtimeDiagnostics: step2ImportMode === 'performance' ? performanceDiagnostics : null,
            stopOrder: step2StopOrderHealth,
        };
    }, [
        analysis,
        bands,
        cycleAnalysisByStartDirection,
        config.routeNumber,
        currentConfiguredRouteIdentity,
        dayType,
        importMode,
        matrixAnalysis,
        matrixSegmentsMap,
        parsedDataFingerprint,
        performanceConfig.dateRange,
        performanceConfig.routeId,
        performanceDiagnostics,
        step2StopOrderHealth,
        step2ImportMode,
        segmentsMap,
        step2PlannerOverrides,
        effectiveCanonicalDirectionStops,
        effectiveCanonicalRouteSource,
        effectiveCanonicalSegmentColumns,
        troubleshootingPatternWarning,
    ]);

    const step2ReviewResult = useMemo<Step2ReviewResult | null>(
        () => (step2ReviewBuilderInput ? buildStep2ReviewResult(step2ReviewBuilderInput) : null),
        [step2ReviewBuilderInput]
    );

    const step2HealthReport = step2ReviewResult?.health ?? null;

    const approvalState = useMemo<Step2ApprovalState>(() => (
        step2ReviewResult
            ? resolveStep2ApprovalState(step2ReviewResult, approvedRuntimeContract)
            : 'unapproved'
    ), [approvedRuntimeContract, step2ReviewResult]);

    const approvedContractRuntimeModel = useMemo(
        () => buildStep2ApprovedRuntimeModelFromContract(approvedRuntimeContract),
        [approvedRuntimeContract]
    );

    const lastApprovedRuntimeModel = useMemo<ApprovedRuntimeModel | null>(
        () => approvedContractRuntimeModel ?? legacyApprovedRuntimeModel,
        [approvedContractRuntimeModel, legacyApprovedRuntimeModel]
    );

    const approvedRuntimeModel = useMemo<ApprovedRuntimeModel | null>(() => {
        return approvedContractRuntimeModel ?? legacyApprovedRuntimeModel;
    }, [approvedContractRuntimeModel, legacyApprovedRuntimeModel]);

    const currentApprovedRuntimeContract = useMemo<ApprovedRuntimeContract | null>(() => (
        approvedRuntimeContract?.schemaVersion === 2 && approvalState === 'approved'
            ? approvedRuntimeContract
            : null
    ), [approvalState, approvedRuntimeContract]);

    const navigateWithStep2Gate = useCallback((requestedStep: 1 | 2 | 3 | 4) => {
        const resolvedStep = resolveWizardStepWithStep2Gate({
            requestedStep,
            approvalState,
            hasReviewResult: !!step2ReviewResult,
        });
        setStep(resolvedStep);

        if (resolvedStep !== requestedStep) {
            toast.warning(
                'Trusted Runtime Required',
                resolvedStep === 2
                    ? 'Review and approve the current Step 2 runtime data before opening later steps.'
                    : 'Build the Step 2 runtime review before opening later steps.'
            );
        }
    }, [approvalState, step2ReviewResult, toast]);

    useEffect(() => {
        const pendingRestoredStep = pendingRestoredStepRef.current;
        if (pendingRestoredStep && step2ReviewResult && approvalState === 'approved') {
            pendingRestoredStepRef.current = null;
            const restoredStep = resolveWizardStepWithStep2Gate({
                requestedStep: pendingRestoredStep,
                approvalState,
                hasReviewResult: true,
            });
            if (restoredStep !== step) {
                setStep(restoredStep);
            }
            return;
        }

        if (pendingRestoredStep) {
            if (step2ReviewResult && step !== 2) {
                setStep(2);
            }
            return;
        }

        const resolvedStep = resolveWizardStepWithStep2Gate({
            requestedStep: step as 1 | 2 | 3 | 4,
            approvalState,
            hasReviewResult: !!step2ReviewResult,
        });
        if (resolvedStep !== step) {
            setStep(resolvedStep);
        }
    }, [approvalState, step, step2ReviewResult]);

    useEffect(() => {
        if (!step2ReviewResult) {
            setStep2WarningsAcknowledged(false);
            return;
        }

        if (approvalState === 'approved' && step2ReviewResult.health.status === 'warning') {
            setStep2WarningsAcknowledged(true);
            return;
        }

        setStep2WarningsAcknowledged(false);
    }, [approvalState, step2ReviewResult?.health.status, step2ReviewResult?.inputFingerprint]);
    useEffect(() => {
        let isCancelled = false;

        if (!team?.id || !config.routeNumber?.trim()) {
            setCanonicalSegmentColumns(undefined);
            setCanonicalDirectionStops(undefined);
            setCanonicalRouteIdentity(undefined);
            setCanonicalRouteSource(undefined);
            return () => {
                isCancelled = true;
            };
        }

        const routeIdentity = buildRouteIdentity(config.routeNumber.trim(), dayType);
        if (
            importMode === 'performance'
            && canonicalRouteSource?.type === 'runtime-derived'
            && canonicalRouteIdentity === routeIdentity
            && canonicalDirectionStops
        ) {
            return () => {
                isCancelled = true;
            };
        }
        setCanonicalSegmentColumns(undefined);
        setCanonicalDirectionStops(undefined);
        setCanonicalRouteIdentity(undefined);
        setCanonicalRouteSource(undefined);

        const loadCanonicalSegmentColumns = async () => {
            try {
                const result = await getMasterSchedule(team.id, routeIdentity);
                if (isCancelled) return;

                if (!result) {
                    setCanonicalSegmentColumns(undefined);
                    setCanonicalDirectionStops(undefined);
                    setCanonicalRouteIdentity(routeIdentity);
                    setCanonicalRouteSource(undefined);
                    return;
                }

                const directionStops = getUsableCanonicalDirectionStops(config.routeNumber.trim(), {
                    North: result.content.northTable.stops || [],
                    South: result.content.southTable.stops || [],
                });
                if (!directionStops) {
                    setCanonicalSegmentColumns(undefined);
                    setCanonicalDirectionStops(undefined);
                    setCanonicalRouteIdentity(routeIdentity);
                    setCanonicalRouteSource(undefined);
                    return;
                }
                const columns = buildCanonicalSegmentColumnsFromMasterStops(
                    config.routeNumber.trim(),
                    directionStops.North,
                    directionStops.South
                );
                setCanonicalDirectionStops(directionStops);
                setCanonicalSegmentColumns(columns.length > 0 ? columns : undefined);
                setCanonicalRouteIdentity(routeIdentity);
                setCanonicalRouteSource({
                    type: 'master',
                    routeIdentity,
                    versionHint: 'master-schedule',
                });
            } catch (error) {
                if (isCancelled) return;
                console.error('Error loading canonical segment columns from master schedule:', error);
                setCanonicalSegmentColumns(undefined);
                setCanonicalDirectionStops(undefined);
                setCanonicalRouteIdentity(undefined);
                setCanonicalRouteSource(undefined);
            }
        };

        void loadCanonicalSegmentColumns();

        return () => {
            isCancelled = true;
        };
        // Deliberately do not depend on canonical state here. This effect is responsible
        // for loading or clearing that state, so depending on the values it sets can
        // cause a reset/reload loop that makes Step 2 flicker between runtime-derived
        // and master-derived segment columns.
    }, [team?.id, config.routeNumber, dayType, importMode]);

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

        const repairSchedules = (schedules: MasterRouteTable[]) => {
            let changedAny = false;
            const repaired = schedules.map(table => {
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

            return { repaired, changedAny };
        };

        const { repaired, changedAny } = repairSchedules(generatedSchedules);
        if (!changedAny) return;

        setGeneratedSchedules(repaired);
        if (originalGeneratedSchedules.length > 0) {
            const { repaired: repairedOriginals, changedAny: changedOriginals } = repairSchedules(originalGeneratedSchedules);
            if (changedOriginals) {
                setOriginalGeneratedSchedules(repairedOriginals);
            }
        }
    }, [generatedSchedules, originalGeneratedSchedules, masterStopCodes, gtfsStopLookup]);

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
        setSegmentNames(getOrderedSegmentNames(segmentsMap, buckets));
    };

    // Wizard Progress Persistence
    const { save, clear } = useWizardProgress();

    // ========== CONSOLIDATED SAVE SYSTEM ==========
    // Save state tracking to prevent race conditions
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingProject, setIsLoadingProject] = useState(false);
    const saveQueueTailRef = useRef<Promise<void>>(Promise.resolve());
    const pendingCloudSaveCountRef = useRef(0);
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Cloud save tracking + dirty state
    type CloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
    const [cloudSaveStatus, setCloudSaveStatus] = useState<CloudSaveStatus>('idle');
    const [lastCloudSaveTime, setLastCloudSaveTime] = useState<Date | null>(null);
    const stateVersionRef = useRef(0);
    const lastSavedVersionRef = useRef(0);

    const startNewStep4EditorSession = useCallback(() => {
        setStep4EditorSessionKey(prev => prev + 1);
    }, []);

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
        generatedSchedules?: MasterRouteTable[];
        originalGeneratedSchedules?: MasterRouteTable[];
    }) => buildLocalWizardProgress({
        step: step as 1 | 2 | 3 | 4,
        dayType,
        importMode,
        performanceConfig,
        autofillFromMaster,
        projectName,
        fileNames: files.map(f => f.name),
        analysis,
        bands,
        config,
        generatedSchedules,
        originalGeneratedSchedules,
        parsedData,
        approvedRuntimeContract: approvedRuntimeContract || undefined,
        approvedRuntimeModel: lastApprovedRuntimeModel || undefined,
        projectId,
    }, overrides), [
        step,
        dayType,
        importMode,
        performanceConfig,
        autofillFromMaster,
        projectName,
        files,
        analysis,
        bands,
        config,
        generatedSchedules,
        originalGeneratedSchedules,
        parsedData,
        approvedRuntimeContract,
        lastApprovedRuntimeModel,
        projectId
    ]);

    // Helper: Build Firebase save data structure
    const buildFirebaseSaveData = useCallback((overrides?: {
        id?: string;
        name?: string;
        generatedSchedules?: MasterRouteTable[];
        originalGeneratedSchedules?: MasterRouteTable[];
        isGenerated?: boolean;
    }) => buildFirebaseWizardSaveData({
        step: step as 1 | 2 | 3 | 4,
        dayType,
        importMode,
        performanceConfig,
        autofillFromMaster,
        projectName,
        fileNames: files.map(f => f.name),
        analysis,
        bands,
        config,
        generatedSchedules,
        originalGeneratedSchedules,
        parsedData,
        approvedRuntimeContract: approvedRuntimeContract || undefined,
        approvedRuntimeModel: lastApprovedRuntimeModel || undefined,
        projectId,
    }, overrides), [
        step,
        dayType,
        importMode,
        performanceConfig,
        autofillFromMaster,
        projectName,
        files,
        analysis,
        bands,
        config,
        generatedSchedules,
        originalGeneratedSchedules,
        parsedData,
        approvedRuntimeContract,
        lastApprovedRuntimeModel,
        projectId
    ]);

    // Track state version for dirty detection - increment on meaningful changes
    useEffect(() => {
        if (!isLoadingProject) {
            stateVersionRef.current += 1;
        }
    }, [step, dayType, files.length, analysis, bands, config, generatedSchedules, originalGeneratedSchedules, parsedData, approvedRuntimeContract, lastApprovedRuntimeModel, autofillFromMaster, isLoadingProject]);

    const hasProjectContent = useMemo(() => (
        files.length > 0 ||
        parsedData.length > 0 ||
        analysis.length > 0 ||
        bands.length > 0 ||
        !!approvedRuntimeContract ||
        !!lastApprovedRuntimeModel ||
        config.blocks.length > 0 ||
        generatedSchedules.length > 0 ||
        !!projectId ||
        !!performanceConfig.routeId
    ), [
        files.length,
        parsedData.length,
        analysis.length,
        bands.length,
        approvedRuntimeContract,
        lastApprovedRuntimeModel,
        config.blocks.length,
        generatedSchedules.length,
        projectId,
        performanceConfig.routeId
    ]);

    // isDirty: true when state has changed since last cloud save
    const isDirty = useMemo(() => {
        return stateVersionRef.current > lastSavedVersionRef.current && hasProjectContent;
    // Re-evaluate whenever cloud save completes or state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stateVersionRef.current, lastSavedVersionRef.current, hasProjectContent]);

    // Helper: Save to localStorage (fast, synchronous)
    const saveToLocalStorage = useCallback((overrides?: {
        generatedSchedules?: MasterRouteTable[];
        originalGeneratedSchedules?: MasterRouteTable[];
    }) => {
        if (step >= 1 && hasProjectContent) {
            save(buildLocalSaveData(overrides));
        }
    }, [step, hasProjectContent, save, buildLocalSaveData]);

    // Helper: queue Firebase saves in request order. Each request owns an exact
    // payload/version snapshot and resolves only after its own cloud commit.
    const saveToFirebase = useCallback(async (overrides?: {
        id?: string;
        name?: string;
        generatedSchedules?: MasterRouteTable[];
        originalGeneratedSchedules?: MasterRouteTable[];
        isGenerated?: boolean;
    }): Promise<string | undefined> => {
        if (!user?.uid) return undefined;

        const userId = user.uid;
        const requestedProjectId = overrides?.id ?? projectIdRef.current;
        const requestedName = overrides?.name ?? projectName;
        const requestedStateVersion = stateVersionRef.current;
        const requestedProjectSession = projectSessionRef.current;
        const capturedPayload = buildFirebaseSaveData({
            ...overrides,
            id: requestedProjectId,
            name: requestedName,
        });

        pendingCloudSaveCountRef.current += 1;
        setIsSaving(true);
        setCloudSaveStatus('saving');

        const executeSave = async (): Promise<string> => {
            if (requestedProjectSession !== projectSessionRef.current) {
                throw new Error('This save belongs to a project that is no longer open.');
            }

            const currentProjectId = requestedProjectId ?? projectIdRef.current;
            const uniqueName = await resolveUniqueProjectName(requestedName, currentProjectId);
            const expectedRevision = projectRevisionRef.current;
            const savedId = await saveProject(userId, {
                ...capturedPayload,
                id: currentProjectId,
                name: uniqueName,
            }, { expectedRevision });

            if (requestedProjectSession === projectSessionRef.current) {
                projectIdRef.current = savedId;
                projectRevisionRef.current = expectedRevision + 1;
                setProjectId(savedId);
                if (projectName !== uniqueName) {
                    setProjectName(uniqueName);
                }
                lastSavedVersionRef.current = Math.max(
                    lastSavedVersionRef.current,
                    requestedStateVersion
                );
                setLastCloudSaveTime(new Date());
                if (pendingCloudSaveCountRef.current === 1) {
                    setCloudSaveStatus('saved');
                }
            }

            return savedId;
        };

        const queuedSave = saveQueueTailRef.current
            .catch((): void => undefined)
            .then(executeSave);
        saveQueueTailRef.current = queuedSave.then(
            (): void => undefined,
            (): void => undefined
        );

        try {
            return await queuedSave;
        } catch (error) {
            console.error('Firebase save failed:', error);
            if (requestedProjectSession === projectSessionRef.current) {
                if (pendingCloudSaveCountRef.current === 1) {
                    setCloudSaveStatus('error');
                }
                if (error instanceof StaleNewScheduleProjectError) {
                    toast.error(
                        'Cloud Save Conflict',
                        'This project changed in another browser or tab. Reload the project before saving again.'
                    );
                }
            }
            throw error;
        } finally {
            pendingCloudSaveCountRef.current = Math.max(0, pendingCloudSaveCountRef.current - 1);
            if (pendingCloudSaveCountRef.current === 0) {
                setIsSaving(false);
            }
        }
    }, [user?.uid, buildFirebaseSaveData, projectName, resolveUniqueProjectName, toast]);
    const saveToFirebaseRef = useRef(saveToFirebase);

    useEffect(() => {
        saveToFirebaseRef.current = saveToFirebase;
    }, [saveToFirebase]);

    // Debounced auto-save to localStorage and cloud (2 second delay)
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
                if (user?.uid) {
                    saveToFirebaseRef.current({ id: projectIdRef.current }).catch((error) => {
                        console.error('Firebase auto-save failed:', error);
                    });
                }
                saveTimerRef.current = null;
            }, 2000);
        }
        // Cleanup on unmount - save immediately to prevent data loss
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                // Save immediately on unmount (debounced save might not have fired)
                if (step >= 1 && hasProjectContent) {
                    save(buildLocalSaveData());
                }
            }
        };
    }, [step, dayType, hasProjectContent, analysis, bands, approvedRuntimeContract, lastApprovedRuntimeModel, config, generatedSchedules, originalGeneratedSchedules, save, buildLocalSaveData, isLoadingProject, user?.uid]);

    // Warn before navigating away if there are unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            // Include queued saves, not only the request currently in flight.
            const hasUnsavedChanges = saveTimerRef.current !== null
                || pendingCloudSaveCountRef.current > 0;
            if (hasUnsavedChanges && step >= 1) {
                e.preventDefault();
                e.returnValue = ''; // Chrome requires returnValue to be set
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isSaving, step]);
    // ========== END CONSOLIDATED SAVE SYSTEM ==========

    const resetLoadedWizardData = useCallback(() => {
        setFiles([]);
        setParsedData([]);
        setAnalysis([]);
        setBands([]);
        setBandSummary({});
        setSegmentsMap({});
        setSegmentNames([]);
        setTroubleshootingPatternWarning(null);
        setGeneratedSchedules([]);
        setOriginalGeneratedSchedules([]);
        setConfig(createDefaultScheduleConfig());
        setCanonicalSegmentColumns(undefined);
        setCanonicalDirectionStops(undefined);
        setCanonicalRouteIdentity(undefined);
        setCanonicalRouteSource(undefined);
        setStep2StopOrderHealth(null);
        setApprovedRuntimeContract(null);
        setLegacyApprovedRuntimeModel(null);
        setStep2WarningsAcknowledged(false);
    }, []);

    const applyRestoredWizardData = useCallback((restored: ReturnType<typeof normalizeRestoredWizardState>) => {
        setDayType(restored.dayType);
        setImportMode(restored.importMode);
        setPerformanceConfig(restored.performanceConfig);
        setAutofillFromMaster(restored.autofillFromMaster);
        setParsedData(restored.parsedData);
        setAnalysis(restored.analysis);
        setBands(restored.bands);
        setConfig(restored.config);
        setSegmentsMap(restored.segmentsMap);
        setSegmentNames(restored.segmentNames);
        setMatrixAnalysis(restored.matrixAnalysis);
        setMatrixSegmentsMap(restored.matrixSegmentsMap);
        setTroubleshootingPatternWarning(restored.troubleshootingPatternWarning);
        setCanonicalSegmentColumns(restored.canonicalSegmentColumns);
        setCanonicalDirectionStops(restored.canonicalDirectionStops as Record<string, string[]> | undefined);
        setCanonicalRouteIdentity(restored.canonicalRouteIdentity);
        setCanonicalRouteSource(restored.canonicalRouteSource);
        setStep2StopOrderHealth(restored.step2StopOrderHealth);
        setGeneratedSchedules(restored.generatedSchedules);
        setOriginalGeneratedSchedules(restored.originalGeneratedSchedules);
        setApprovedRuntimeContract(restored.approvedRuntimeContract || null);
        setLegacyApprovedRuntimeModel(restored.approvedRuntimeModel || null);
        setStep2WarningsAcknowledged(false);
    }, []);

    const restoreProjectData = useCallback(async (fullProject: {
        id: string;
        name: string;
        dayType: 'Weekday' | 'Saturday' | 'Sunday';
        importMode?: ImportMode;
        performanceConfig?: PerformanceConfig;
        autofillFromMaster?: boolean;
        analysis?: TripBucketAnalysis[];
        bands?: TimeBand[];
        config?: ScheduleConfig;
        generatedSchedules?: MasterRouteTable[];
        originalGeneratedSchedules?: MasterRouteTable[];
        parsedData?: RuntimeData[];
        approvedRuntimeContract?: ApprovedRuntimeContract;
        approvedRuntimeModel?: ApprovedRuntimeModel;
        isGenerated?: boolean;
        projectRevision?: number;
    }): Promise<boolean> => {
        const restoredState = normalizeRestoredWizardState({
            dayType: fullProject.dayType,
            importMode: fullProject.importMode,
            performanceConfig: fullProject.performanceConfig,
            autofillFromMaster: fullProject.autofillFromMaster,
            analysis: fullProject.analysis,
            bands: fullProject.bands,
            config: fullProject.config,
            generatedSchedules: fullProject.generatedSchedules,
            originalGeneratedSchedules: fullProject.originalGeneratedSchedules,
            parsedData: fullProject.parsedData,
            approvedRuntimeContract: fullProject.approvedRuntimeContract,
            approvedRuntimeModel: fullProject.approvedRuntimeModel,
        });

        projectSessionRef.current += 1;
        projectRevisionRef.current = fullProject.projectRevision ?? 0;
        resetLoadedWizardData();
        setProjectId(fullProject.id);
        projectIdRef.current = fullProject.id;
        setProjectName(fullProject.name);
        setIsAutoProjectName(false);
        applyRestoredWizardData(restoredState);
        if (restoredState.legacyRuntimeDataReset) {
            setStep(1);
            setMaxStepReached(1);
            if (user?.uid) {
                try {
                    projectRevisionRef.current = await resetLegacyRuntimeProject(user.uid, fullProject.id, {
                        expectedRevision: fullProject.projectRevision ?? 0,
                    });
                    toast.info(
                        'Runtime Review Reset',
                        'Old runtime results and generated schedules were removed from the saved project. Your settings were kept; rebuild the runtime review from Step 1.'
                    );
                } catch (error) {
                    console.error('Failed to reset legacy runtime data in the cloud:', error);
                    toast.error(
                        'Cloud Reset Failed',
                        'The old runtime data was removed locally but not from the saved project. Reload the project and try again before rebuilding.'
                    );
                }
            } else {
                toast.error(
                    'Cloud Reset Needed',
                    'Sign in and reload this project so its old runtime data can be removed safely.'
                );
            }
        }
        startNewStep4EditorSession();
        return restoredState.legacyRuntimeDataReset;
    }, [applyRestoredWizardData, resetLoadedWizardData, startNewStep4EditorSession, toast, user?.uid]);

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
            } catch (error) {
                if (!(error instanceof StaleNewScheduleProjectError)) {
                    toast.error('Cloud Save Failed', 'Saved locally. Click "Save" to retry.');
                }
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

        // Queue the rename behind any cloud save already in progress.
        if (user?.uid && projectId) {
            try {
                await saveToFirebase({ name: newName });
                toast.success('Renamed', `Project renamed to "${newName}"`);
            } catch (error) {
                if (!(error instanceof StaleNewScheduleProjectError)) {
                    toast.warning('Rename Saved Locally', 'Could not sync to cloud');
                }
            }
        }
    };

    const handleApproveStep2 = useCallback((acknowledgedWarnings: string[], options?: { silent?: boolean }) => {
        if (!step2ReviewResult || !step2ReviewBuilderInput) {
            toast.warning('Approval Failed', 'Step 2 review data is not ready yet.');
            return false;
        }

        const contract = createStep2ApprovedRuntimeContract({
            reviewResult: step2ReviewResult,
            sourceSnapshot: buildStep2SourceSnapshot(step2ReviewBuilderInput),
            approvedAt: new Date().toISOString(),
            acknowledgedWarnings,
        });

        if (!contract) {
            toast.warning('Approval Failed', 'Review the warnings and try approving the runtime model again.');
            return false;
        }

        setApprovedRuntimeContract(contract);
        setLegacyApprovedRuntimeModel(buildStep2ApprovedRuntimeModelFromContract(contract));
        setStep2WarningsAcknowledged(contract.readinessStatus === 'warning');
        if (!options?.silent) {
            toast.success('Runtime Approved', 'Step 2 is now approved for schedule building.');
        }
        return true;
    }, [
        step2ReviewBuilderInput,
        step2ReviewResult,
        toast,
    ]);

    // Shared helper: take RuntimeData[] through analysis pipeline and advance to Step 2
    const processRuntimeResults = (results: RuntimeData[], displayResults: RuntimeData[] = results) => {
        setParsedData(results);

        const northStartResults = results.filter(runtime => runtime.cycleStartDirection === 'North');
        const southStartResults = results.filter(runtime => runtime.cycleStartDirection === 'South');
        const primaryResults = northStartResults.length > 0
            ? northStartResults
            : southStartResults.length > 0
                ? southStartResults
                : results;
        const {
            buckets,
            bands: generatedBands,
            segmentsMap: groupedSegments,
        } = buildRuntimeAnalysisModel(primaryResults);
        const displayNorthStartResults = displayResults.filter(runtime => runtime.cycleStartDirection === 'North');
        const displaySouthStartResults = displayResults.filter(runtime => runtime.cycleStartDirection === 'South');
        const primaryDisplayResults = displayNorthStartResults.length > 0
            ? displayNorthStartResults
            : displaySouthStartResults.length > 0
                ? displaySouthStartResults
                : displayResults;
        const displayRawAnalysis = calculateTotalTripTimes(primaryDisplayResults);
        const displayWithOutliers = detectOutliers(displayRawAnalysis);
        const { buckets: displayBuckets } = calculateBands(displayWithOutliers);
        const displayGroupedSegments = buildSegmentsMapFromParsedData(primaryDisplayResults);

        setAnalysis(buckets);
        setBands(generatedBands);
        setSegmentsMap(groupedSegments);
        setSegmentNames(getOrderedSegmentNames(groupedSegments, buckets));
        setMatrixAnalysis(displayBuckets);
        setMatrixSegmentsMap(displayGroupedSegments);
        const fallbackDirections = displayResults
            .filter(runtime => runtime.troubleshootingPatternStatus === 'fallback' && runtime.detectedDirection)
            .map(runtime => runtime.detectedDirection as string);
        setTroubleshootingPatternWarning(
            fallbackDirections.length > 0
                ? `Troubleshooting view could not confirm a full anchored route pattern for ${Array.from(new Set(fallbackDirections)).join(', ')}. The stop-by-stop matrix is hidden until a confirmed full-route path is available.`
                : null
        );

        const autoRouteNumber = resolveAutoRouteNumber(
            results.map(r => r.detectedRouteNumber)
        );
        if (autoRouteNumber) {
            setConfig(prev => ({ ...prev, routeNumber: autoRouteNumber! }));
        }

        setStep(2);
    };

    const showStep2Loading = async (message: string) => {
        setStep2LoadingMessage(message);
        setIsPreparingStep2(true);
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    };

    const showStep4Loading = async (message: string) => {
        setStep4LoadingMessage(message);
        setIsPreparingStep4(true);
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    };

    const hideStep4LoadingAfterPaint = () => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsPreparingStep4(false);
            });
        });
    };

    const handleNext = async () => {
        if (step === 1) {
            if (importMode === 'gtfs') {
                toast.info('Use GTFS Import', 'Complete the GTFS import panel to continue.');
                return;
            }
            if (importMode === 'performance') {
                // Performance data mode
                if (!performanceConfig.routeId) {
                    toast.warning('No Route', 'Please select a route');
                    return;
                }
                if (performanceConfig.dateRange) {
                    const { start, end } = performanceConfig.dateRange;
                    if (!start || !end) {
                        toast.warning('Invalid Date Range', 'Select both start and end dates, or use all data.');
                        return;
                    }
                    if (start > end) {
                        toast.warning('Invalid Date Range', 'Start date must be on or before end date.');
                        return;
                    }
                    if (performanceDateRange && (start < performanceDateRange.start || end > performanceDateRange.end)) {
                        toast.warning(
                            'Date Range Out of Bounds',
                            `Available data is ${performanceDateRange.start} to ${performanceDateRange.end}.`
                        );
                        return;
                    }
                }
                if (!cleanStep2PerfData || cleanStep2PerfData.dailySummaries.length === 0) {
                    toast.warning(
                        'Clean History Needed',
                        'Step 2 is now using clean post-fix history only. Import or re-import at least one day with the current STREETS pipeline before building schedules.'
                    );
                    return;
                }
                await showStep2Loading('Analyzing performance runtimes...');
                try {
                    const selectedRouteMetadata = availableRoutes.find(route => route.routeId === performanceConfig.routeId);
                    if (selectedRouteMetadata && selectedRouteMetadata.stopLevelDayCount === 0) {
                        toast.error(
                            'Re-import STREETS Data',
                            `Route ${performanceConfig.routeId} only has older coarse runtime summaries right now. Re-import STREETS data to compute stop-level runtimes for New Schedule.`
                        );
                        return;
                    }

                    const normalizedDayType = dayType.toLowerCase() as PerfDayType;
                    const selectedRouteNumber = performanceConfig.routeId.trim();
                    const selectedRouteIdentity = buildRouteIdentity(selectedRouteNumber, dayType);
                    let masterCanonicalStops: Record<string, string[]> | undefined;

                    if (team?.id && selectedRouteIdentity) {
                        const masterResult = await getMasterSchedule(team.id, selectedRouteIdentity);
                        if (masterResult) {
                            masterCanonicalStops = getUsableCanonicalDirectionStops(selectedRouteNumber, {
                                North: masterResult.content.northTable.stops || [],
                                South: masterResult.content.southTable.stops || [],
                            });
                        }
                    }

                    const stopOrderResolution = resolveStopOrderFromPerformance(cleanStep2PerfData.dailySummaries, {
                        routeId: selectedRouteNumber,
                        dayType: normalizedDayType,
                        dateRange: performanceConfig.dateRange || undefined,
                        patternAnchorStops: masterCanonicalStops,
                        runtimePatternStrategy: 'detour-fallback',
                    });
                    const resolvedCanonicalStops = stopOrderResolution.decision === 'accept'
                        ? getUsableCanonicalDirectionStops(
                            selectedRouteNumber,
                            extractStopOrderDirectionStops(stopOrderResolution)
                        )
                        : undefined;
                    const selectedCanonicalStops = resolvedCanonicalStops ?? masterCanonicalStops;
                    const selectedCanonicalColumns = selectedCanonicalStops
                        ? buildCanonicalSegmentColumnsFromMasterStops(
                            selectedRouteNumber,
                            selectedCanonicalStops.North ?? selectedCanonicalStops.Loop ?? [],
                            selectedCanonicalStops.South ?? []
                        )
                        : [];
                    const selectedCanonicalRouteSource: Step2CanonicalRouteSource | undefined = resolvedCanonicalStops
                        ? {
                            type: 'runtime-derived',
                            routeIdentity: selectedRouteIdentity,
                            versionHint: `stop-order-${stopOrderResolution.decision}`,
                        }
                        : masterCanonicalStops
                            ? {
                                type: 'master',
                                routeIdentity: selectedRouteIdentity,
                                versionHint: 'master-schedule',
                            }
                            : undefined;

                    setCanonicalDirectionStops(selectedCanonicalStops);
                    setCanonicalSegmentColumns(selectedCanonicalColumns.length > 0 ? selectedCanonicalColumns : undefined);
                    setCanonicalRouteIdentity(selectedRouteIdentity);
                    setCanonicalRouteSource(selectedCanonicalStops ? selectedCanonicalRouteSource : undefined);
                    setStep2StopOrderHealth(buildStep2StopOrderHealth(
                        stopOrderResolution,
                        resolvedCanonicalStops
                            ? 'runtime-derived'
                            : masterCanonicalStops
                                ? 'master-fallback'
                                : 'none'
                    ));

                    const results = computeRuntimesFromPerformance(cleanStep2PerfData.dailySummaries, {
                        routeId: performanceConfig.routeId,
                        dayType: normalizedDayType,
                        dateRange: performanceConfig.dateRange || undefined,
                        canonicalDirectionStops: selectedCanonicalStops,
                        patternAnchorStops: resolvedCanonicalStops ?? masterCanonicalStops,
                        fullPatternOnly: true,
                        runtimePatternStrategy: 'detour-fallback',
                    });
                    // Keep the schedule-driving analysis tied to the canonical route chain,
                    // but let the Step 2 matrix show the finer stop-to-stop legs when available.
                    const displayResults = selectedCanonicalStops
                        ? computeRuntimesFromPerformance(cleanStep2PerfData.dailySummaries, {
                            routeId: performanceConfig.routeId,
                            dayType: normalizedDayType,
                            dateRange: performanceConfig.dateRange || undefined,
                            patternAnchorStops: resolvedCanonicalStops ?? masterCanonicalStops,
                            fullPatternOnly: true,
                            runtimePatternStrategy: 'detour-fallback',
                        })
                        : results;

                    if (results.length === 0) {
                        const diagnosticsMessage = performanceDiagnostics
                            ? `Checked ${performanceDiagnostics.filteredDayCount} ${dayType.toLowerCase()} day(s); matched ${performanceDiagnostics.matchedRouteDayCount} day(s), ${performanceDiagnostics.stopEntryCount} stop-level segment row(s), ${performanceDiagnostics.tripEntryCount} trip-leg row(s), and ${performanceDiagnostics.coarseEntryCount} coarse segment row(s).`
                            : undefined;
                        toast.error(
                            'No Data',
                            diagnosticsMessage
                                ? `No segment runtime data found for Route ${performanceConfig.routeId} on ${dayType}s. ${diagnosticsMessage}`
                                : `No segment runtime data found for Route ${performanceConfig.routeId} on ${dayType}s`
                        );
                        return;
                    }

                    processRuntimeResults(results, displayResults);
                    toast.success('Data Computed', 'Performance runtimes analyzed successfully');
                } catch (error) {
                    console.error(error);
                    toast.error('Compute Error', 'Failed to compute runtimes from performance data.');
                } finally {
                    setIsPreparingStep2(false);
                }
            } else {
                // CSV mode
                if (files.length === 0) {
                    toast.warning('No Files', 'Please upload at least one CSV file');
                    return;
                }
                await showStep2Loading('Parsing runtime CSV files...');
                try {
                    const results = await Promise.all(files.map(f => parseRuntimeCSV(f)));
                    processRuntimeResults(results);
                    toast.success('Files Parsed', 'Runtime data analyzed successfully');
                } catch (error) {
                    console.error(error);
                    toast.error('Parse Error', 'Failed to parse CSV files. Please check the format.');
                } finally {
                    setIsPreparingStep2(false);
                }
            }
        } else if (step === 2) {
            if (approvalState !== 'approved') {
                const approved = handleApproveStep2(step2ApprovalWarnings, { silent: true });
                if (!approved) {
                    toast.error(
                        'Trusted Runtime Required',
                        'Step 2 does not yet have enough complete runtime evidence to build a schedule.'
                    );
                    return;
                }
            }
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

            const activeApprovedPlanning = currentApprovedRuntimeContract?.planning ?? null;
            if (!activeApprovedPlanning) {
                toast.error('Runtime Model Missing', 'Runtime analysis is not available. Return to Step 2 and rebuild the runtime review.');
                return;
            }

            const approvedBuckets = activeApprovedPlanning.approvedBuckets;
            const approvedBands = activeApprovedPlanning.bands;
            const approvedDirectionBandSummary = activeApprovedPlanning.directionBandSummary;

            // Non-blocking guidance: strict cycle should be close to observed runtime bands.
            if (config.cycleMode !== 'Floating') {
                const suggestion = computeSuggestedStrictCycle(approvedBuckets, approvedBands);
                const suggested = suggestion.minutes;
                if (suggested && config.cycleTime > 0) {
                    const deltaPct = Math.round(((config.cycleTime - suggested) / suggested) * 100);
                    const referenceLabel = suggestion.quality === 'high'
                        ? 'observed cycle reference'
                        : `${suggestion.basisLabel} reference`;
                    if (Math.abs(deltaPct) >= 35) {
                        toast.error(
                            'Strict Cycle Time Is Far Off',
                            `${config.cycleTime}m vs ${referenceLabel} ~${suggested}m (${deltaPct > 0 ? '+' : ''}${deltaPct}%).`
                        );
                    } else if (Math.abs(deltaPct) >= 20) {
                        toast.warning(
                            'Check Strict Cycle Time',
                            `Configured ${config.cycleTime}m vs ${referenceLabel} ~${suggested}m (${deltaPct > 0 ? '+' : ''}${deltaPct}%).`
                        );
                    }
                }
            }

            const generationNorthStartData = parsedData.filter(runtime => runtime.cycleStartDirection === 'North');
            const generationSouthStartData = parsedData.filter(runtime => runtime.cycleStartDirection === 'South');
            const generationSourceData = generationNorthStartData.length > 0
                ? generationNorthStartData
                : generationSouthStartData.length > 0
                    ? generationSouthStartData
                    : parsedData;

            // Sort parsed data by direction
            const directionOrder: Record<string, number> = { 'North': 0, 'A': 1, 'Loop': 2, 'South': 3, 'B': 4 };
            const sortedParsedData = [...generationSourceData].sort((a, b) => {
                const orderA = a.detectedDirection ? (directionOrder[a.detectedDirection] ?? 2) : 2;
                const orderB = b.detectedDirection ? (directionOrder[b.detectedDirection] ?? 2) : 2;
                return orderA - orderB;
            });

            const groupedData = buildSegmentsMapFromParsedData(sortedParsedData);
            setSegmentsMap(groupedData);

            const generationCanonicalStops = activeApprovedPlanning?.canonicalDirectionStops
                ?? effectiveCanonicalDirectionStops;

            if (!approvedDirectionBandSummary) {
                toast.error('Runtime Model Missing', 'The Step 2 direction summary is unavailable. Return to Step 2 and rebuild the runtime review.');
                return;
            }

            await showStep4Loading('Generating your schedule from the runtime analysis...');

            // Generate schedule
            let generatedTables: MasterRouteTable[];
            try {
                generatedTables = generateSchedule(
                    config,
                    approvedBuckets,
                    approvedBands,
                    approvedDirectionBandSummary,
                    groupedData,
                    dayType,
                    gtfsStopLookup,
                    masterStopCodes,
                    generationCanonicalStops,
                    activeApprovedPlanning.approvedCycleBucketsByStartDirection,
                    {
                        strictApprovedRuntime: true,
                        approvedBucketMode: currentApprovedRuntimeContract.importMode === 'performance'
                            ? 'paired-cycle-start'
                            : 'trip-start',
                    }
                );
            } catch (error) {
                console.error(error);
                setIsPreparingStep4(false);
                if (error instanceof MissingApprovedRuntimeError) {
                    toast.error(
                        'Trusted Runtime Missing',
                        `${error.direction} ${error.timeBucket} is missing trusted data for ${error.segmentName}. Return to Step 2 or change the service span.`
                    );
                } else {
                    toast.error('Generation Failed', 'Could not generate schedule. Check cycle time and data format.');
                }
                return;
            }

            if (generatedTables.length === 0) {
                setIsPreparingStep4(false);
                toast.error('Generation Failed', 'Could not generate schedule. Check cycle time and data format.');
                return;
            }

            if (autofillFromMaster && team?.id && currentConfiguredRouteIdentity) {
                try {
                    setStep4LoadingMessage('Copying recovery times from the master schedule...');
                    const masterResult = await getMasterSchedule(team.id, currentConfiguredRouteIdentity);
                    if (masterResult) {
                        const recoveryResult = copyNearestMasterRecoveryToGenerated(
                            generatedTables,
                            [masterResult.content.northTable, masterResult.content.southTable].filter(Boolean)
                        );
                        generatedTables = recoveryResult.tables;
                        if (recoveryResult.appliedCount > 0) {
                            toast.info(
                                'Recovery Times Copied',
                                `Matched nearest master trips for ${recoveryResult.appliedCount} generated trip${recoveryResult.appliedCount === 1 ? '' : 's'}.`
                            );
                        }
                    }
                } catch (error) {
                    console.warn('Could not copy recovery times from master schedule', error);
                    toast.warning('Recovery Copy Skipped', 'The schedule was generated, but master recovery times could not be copied.');
                }
            }

            setGeneratedSchedules(generatedTables);
            setOriginalGeneratedSchedules(generatedTables);
            startNewStep4EditorSession();

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

            setStep4LoadingMessage('Opening the schedule editor...');
            setStep(4);
            toast.success('Schedule Generated', `Created ${generatedTables.length} schedule(s)`);
            const nearbyRuntimeTrips = generatedTables
                .flatMap(table => table.trips)
                .filter(trip => Object.values(trip.runtimeSourceBreakdown || {}).some(
                    source => source.startsWith('approved-nearest-bucket')
                ));
            const nearbyRuntimeMappings = new Set(
                nearbyRuntimeTrips
                    .flatMap(trip => Object.values(trip.runtimeSourceBreakdown || {}))
                    .filter(source => source.startsWith('approved-nearest-bucket'))
            );
            if (nearbyRuntimeTrips.length > 0) {
                toast.warning(
                    'Nearby Runtime Buckets Used',
                    `${nearbyRuntimeTrips.length} trip${nearbyRuntimeTrips.length === 1 ? '' : 's'} used the nearest approved runtime across ${nearbyRuntimeMappings.size} bucket substitution${nearbyRuntimeMappings.size === 1 ? '' : 's'}.`
                );
            }
            hideStep4LoadingAfterPaint();

            // Save generated schedule - localStorage backup + Firebase (uses consolidated helpers)
            // Note: Pass generatedTables directly since state hasn't updated yet
            saveToLocalStorage({
                generatedSchedules: generatedTables,
                originalGeneratedSchedules: generatedTables
            });

            if (user?.uid && generatedTables.length > 0) {
                try {
                    await saveToFirebase({
                        generatedSchedules: generatedTables,
                        originalGeneratedSchedules: generatedTables,
                        isGenerated: true
                    });
                    toast.success('Saved to Cloud', 'Schedule backed up securely');
                } catch (error) {
                    if (!(error instanceof StaleNewScheduleProjectError)) {
                        toast.error('Cloud Save Failed', 'Saved locally. Click "Save" to retry.');
                    }
                }
            }
        } else if (step === 4) {
            // Finalize / Export
            if (!currentApprovedRuntimeContract) {
                toast.error(
                    'Trusted Runtime Required',
                    'Return to Step 2 and approve the current runtime review before exporting this schedule.'
                );
                return;
            }
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
        projectSessionRef.current += 1;
        projectRevisionRef.current = 0;
        pendingRestoredStepRef.current = null;
        setStep(1);
        setMaxStepReached(1);
        setFiles([]);
        setParsedData([]);
        setAnalysis([]);
        setBands([]);
        setBandSummary({});
        setSegmentsMap({});
        setSegmentNames([]);
        setTroubleshootingPatternWarning(null);
        setGeneratedSchedules([]);
        setOriginalGeneratedSchedules([]);
        setConfig(createDefaultScheduleConfig());
        setProjectName(DEFAULT_PROJECT_NAME);
        setIsAutoProjectName(true);
        setProjectId(undefined);
        projectIdRef.current = undefined;
        setImportMode(DEFAULT_IMPORT_MODE);
        setPerformanceLoadRouteId('all');
        setPerformanceLoadRouteManuallySelected(false);
        setPerformanceConfig(createDefaultPerformanceConfig());
        setAutofillFromMaster(true);
        setApprovedRuntimeContract(null);
        setLegacyApprovedRuntimeModel(null);
        setStep2WarningsAcknowledged(false);
        setStep4EditorSessionKey(0);
        setShowUploadModal(false);
        setUploadConfirmation(null);
    }, [clear]);

    const handleNewProject = () => {
        if (files.length > 0 || step > 1) {
            if (!confirm('Start a new project? Current progress will be cleared.')) return;
        }
        resetWizardState();
        toast.info('New Project', 'Starting fresh');
    };

    // ========== MASTER SCHEDULE UPLOAD ==========

    const handleUploadToMaster = async () => {
        if (!hasTeam || !team || generatedSchedules.length === 0) return;
        if (!currentApprovedRuntimeContract) {
            toast.error(
                'Trusted Runtime Required',
                'Return to Step 2 and approve the current runtime review before uploading this schedule.'
            );
            return;
        }

        try {
            const continuityIssues = validateMergedRouteBlockContinuity(generatedSchedules);
            if (continuityIssues.length > 0) {
                toast.error(
                    'Fix A/B Blocks First',
                    continuityIssues.slice(0, 2).map(issue => issue.message).join(' ')
                );
                return;
            }

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
        if (!currentApprovedRuntimeContract) {
            setShowUploadModal(false);
            setUploadConfirmation(null);
            toast.error(
                'Trusted Runtime Required',
                'The runtime approval is no longer current. Return to Step 2 before uploading.'
            );
            return;
        }

        setIsUploading(true);
        try {
            const continuityIssues = validateMergedRouteBlockContinuity(generatedSchedules);
            if (continuityIssues.length > 0) {
                toast.error(
                    'Fix A/B Blocks First',
                    continuityIssues.slice(0, 2).map(issue => issue.message).join(' ')
                );
                setIsUploading(false);
                return;
            }

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
                'wizard',
                {
                    cycleMode: config.cycleMode ?? 'Strict',
                }
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

    const step2ApprovalRequiresAcknowledgement = step2HealthReport?.status === 'warning';
    const step2ApprovalWarnings = step2ApprovalRequiresAcknowledgement
        ? step2HealthReport?.warnings ?? []
        : [];
    const step2ApprovalActionDisabled = (
        !step2ReviewResult
        || approvalState === 'approved'
        || step2HealthReport?.status === 'blocked'
    );
    const primaryActionDisabled = isPreparingStep2 || isPreparingStep4;
    const primaryActionLabel = step === 3
        ? 'Generate Schedule'
        : step === 2
            ? 'Continue to Build Schedule'
            : 'Next Step';

    return (
        <>
            <div className="flex h-full min-h-0 flex-col bg-gray-50/50">
                {(isPreparingStep2 || isPreparingStep4) && (
                    <div
                        className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/35 px-4 backdrop-blur-sm"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="wizard-loading-title"
                        aria-busy="true"
                    >
                        <div className="w-full max-w-sm rounded-2xl border border-white/70 bg-white p-6 text-center shadow-2xl">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-brand-blue">
                                <Loader2 size={28} className="animate-spin" />
                            </div>
                            <h3 id="wizard-loading-title" className="mt-4 text-lg font-bold text-gray-900">
                                {isPreparingStep4 ? 'Generating schedule' : 'Preparing runtime analysis'}
                            </h3>
                            <p className="mt-2 text-sm text-gray-600">
                                {isPreparingStep4 ? step4LoadingMessage : step2LoadingMessage}
                            </p>
                            <p className="mt-3 text-xs text-gray-400">
                                This can take a few seconds.
                            </p>
                        </div>
                    </div>
                )}

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
                    onStepClick={(s) => navigateWithStep2Gate(s as 1 | 2 | 3 | 4)}
                    maxStepReached={maxStepReached}
                    cloudSaveStatus={cloudSaveStatus}
                    lastCloudSaveTime={lastCloudSaveTime}
                    isDirty={isDirty}
                    isAuthenticated={!!user?.uid}
                    onRetrySave={handleSaveProgress}
                    routeNumber={step >= 3 ? config.routeNumber : undefined}
                    dayType={dayType}
                />

                {/* Content Area */}
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-5 lg:px-8">
                    <div className={step === 4 || step === 2 ? "w-full" : "mx-auto max-w-5xl"}>
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
                                        onBack();
                                    }
                                }}
                                importMode={importMode}
                                setImportMode={setImportMode}
                                availableRoutes={availableRoutes}
                                performanceConfig={performanceConfig}
                                onPerformanceConfigChange={setPerformanceConfig}
                                performanceDataLoading={perfQuery.isLoading}
                                performanceMetadataLoading={performanceMetadataQuery.isLoading}
                                performanceLoadRouteId={performanceLoadRouteId}
                                performanceLoadRouteIds={performanceLoadRouteIds}
                                onPerformanceLoadRouteChange={handlePerformanceLoadRouteChange}
                                performanceDateRange={performanceDateRange}
                                performanceDiagnostics={performanceDiagnostics}
                                performanceHistoryStatus={performanceHistoryStatus}
                            />
                        )}
                        {step === 2 && (
                            <Step2Analysis
                                dayType={dayType}
                                routeNumber={config.routeNumber}
                                analysis={analysis}
                                bands={bands}
                                setAnalysis={handleAnalysisUpdate}
                                segmentsMap={segmentsMap}
                                matrixAnalysis={matrixAnalysis}
                                matrixSegmentsMap={matrixSegmentsMap}
                                canonicalSegmentColumns={effectiveCanonicalSegmentColumns}
                                canonicalDirectionStops={effectiveCanonicalDirectionStops}
                                healthReport={step2HealthReport}
                                approvedRuntimeModel={approvedRuntimeModel}
                                approvalState={approvalState}
                                approvedRuntimeContract={approvedRuntimeContract}
                                onApproveRuntimeContract={handleApproveStep2}
                                warningAcknowledged={step2WarningsAcknowledged}
                                onWarningAcknowledgedChange={setStep2WarningsAcknowledged}
                                troubleshootingPatternWarning={troubleshootingPatternWarning}
                                onBandSummaryChange={setBandSummary}
                            />
                        )}
                        {step === 3 && (
                            <Step3Build
                                dayType={dayType}
                                bands={bands}
                                analysis={analysis}
                                approvedRuntimeContract={currentApprovedRuntimeContract}
                                approvedRuntimeModel={lastApprovedRuntimeModel}
                                config={config}
                                setConfig={setConfig}
                                teamId={team?.id}
                                stopSuggestions={stopSuggestions}
                                autofillFromMaster={autofillFromMaster}
                                onAutofillFromMasterChange={setAutofillFromMaster}
                                onChangeRoute={() => setStep(1)}
                            />
                        )}
                        {step === 4 && (
                            <Step4Schedule
                                initialSchedules={generatedSchedules}
                                originalSchedules={originalGeneratedSchedules}
                                editorSessionKey={step4EditorSessionKey}
                                bands={currentApprovedRuntimeContract?.planning.bands ?? []}
                                analysis={currentApprovedRuntimeContract?.planning.approvedBuckets ?? []}
                                segmentNames={currentApprovedRuntimeContract?.planning.segmentColumns.map(column => column.segmentName) ?? []}
                                onUpdateSchedules={setGeneratedSchedules}
                                projectName={projectName}
                                autoSaveStatus={autoSaveStatus}
                                lastSaved={lastSaved}
                                targetCycleTime={(!config.cycleMode || config.cycleMode === 'Strict') ? config.cycleTime : undefined}
                                targetHeadway={(!config.cycleMode || config.cycleMode === 'Strict') && config.blocks.length > 0 ? Math.round(config.cycleTime / config.blocks.length) : undefined}
                                teamId={team?.id}
                                userId={user?.uid}
                                routeIdentity={currentConfiguredRouteIdentity}
                                routeLabel={config.routeNumber ? `Route ${config.routeNumber} · ${dayType}` : undefined}
                                connectionScopeSchedules={connectionScopeSchedules}
                                approvedRuntimeContract={currentApprovedRuntimeContract}
                                approvedRuntimeModel={currentApprovedRuntimeContract ? lastApprovedRuntimeModel : null}
                            />
                        )}
                    </div>
                </div>

                {/* Footer / Actions */}
                <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-2.5 sm:px-6 lg:px-8">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                        onClick={() => setStep(s => Math.max(1, s - 1))}
                        disabled={step === 1}
                        className="rounded-lg px-5 py-1.5 text-sm font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                        Back
                    </button>

                    <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
                        {/* Save Progress Button - context-aware */}
                        {hasProjectContent && (
                            <button
                                onClick={handleSaveProgress}
                                disabled={isManualSaving || (!isDirty && cloudSaveStatus === 'saved')}
                                className={`flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-4 py-1.5 text-sm font-bold transition-all ${
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
                                disabled={!currentApprovedRuntimeContract}
                                title={!currentApprovedRuntimeContract ? 'Approve the current Step 2 runtime review before uploading.' : undefined}
                                className="flex items-center gap-2 rounded-lg border-2 border-brand-green px-5 py-1.5 text-sm font-bold text-brand-green hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Upload size={18} />
                                Upload to Master
                            </button>
                        )}

                        {step === 2 && (
                            <Step2ApprovalFooter
                                mode="next-step"
                                title="Next step"
                                approvalState={approvalState}
                                readinessStatus={step2HealthReport?.status ?? 'blocked'}
                                primaryActionVariant="continue"
                                approvalRequiresAcknowledgement={step2ApprovalRequiresAcknowledgement}
                                warningAcknowledged={step2WarningsAcknowledged}
                                approvedAtLabel={formatFooterTimestamp(approvedRuntimeContract?.approvedAt)}
                                statusLabel={
                                    step2HealthReport?.status === 'blocked'
                                        ? 'Needs fixes'
                                        : step2HealthReport?.status === 'warning'
                                            ? 'Continue with warnings'
                                            : 'Ready'
                                }
                                statusMessage={
                                    step2HealthReport?.status === 'blocked'
                                        ? 'Resolve the Step 2 issues before continuing to schedule building.'
                                        : step2HealthReport?.status === 'warning'
                                            ? 'Review the warnings above, then continue if these runtimes are acceptable.'
                                            : 'If this looks right, continue to build the schedule.'
                                }
                                approvalActionDisabled={false}
                                continueActionDisabled={step2HealthReport?.status === 'blocked'}
                                onApproveRuntimeContract={() => handleApproveStep2(step2ApprovalWarnings)}
                                onContinueToStep3={() => {
                                    void handleNext();
                                }}
                            />
                        )}

                        {step !== 2 && shouldShowNextStepAction(step, importMode) && (
                            <button
                                onClick={handleNext}
                                disabled={primaryActionDisabled}
                                className={`flex items-center justify-center gap-2 rounded-lg px-5 py-1.5 text-sm font-bold shadow-md ${
                                    primaryActionDisabled
                                        ? 'bg-gray-300 text-gray-500 shadow-none cursor-not-allowed'
                                        : 'bg-brand-blue text-white hover:brightness-110 shadow-blue-500/20'
                                }`}
                            >
                                {primaryActionLabel}
                                <ArrowRight size={18} />
                            </button>
                        )}
                    </div>
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

                    if (user?.uid) {
                        try {
                            const fullProject = await getProject(user.uid, project.id);
                            if (fullProject) {
                                const wasReset = await restoreProjectData(fullProject);

                                // Calculate which step to go to based on what data exists
                                const requestedStep = wasReset ? 1 : deriveWizardStepFromProject(fullProject);
                                pendingRestoredStepRef.current = (
                                    requestedStep > 2
                                    && fullProject.approvedRuntimeContract?.schemaVersion === 2
                                ) ? requestedStep : null;
                                const nextStep = resolveWizardStepWithStep2Gate({
                                    requestedStep,
                                    approvalState: 'unapproved',
                                    hasReviewResult: !wasReset && !!(
                                        fullProject.analysis?.length
                                        || fullProject.parsedData?.length
                                        || fullProject.approvedRuntimeContract
                                    ),
                                });
                                setStep(nextStep);
                                setMaxStepReached(nextStep);
                                if (!wasReset) toast.success('Project Loaded', `${fullProject.name} - Step ${nextStep}`);
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
                onLoadGeneratedSchedule={async (fullProject) => {
                    setIsLoadingProject(true);
                    const wasReset = await restoreProjectData(fullProject);

                    const requestedStep = wasReset ? 1 : deriveWizardStepFromProject(fullProject);
                    pendingRestoredStepRef.current = (
                        requestedStep > 2
                        && fullProject.approvedRuntimeContract?.schemaVersion === 2
                    ) ? requestedStep : null;
                    const nextStep = resolveWizardStepWithStep2Gate({
                        requestedStep,
                        approvalState: 'unapproved',
                        hasReviewResult: !wasReset && !!(
                            fullProject.analysis?.length
                            || fullProject.parsedData?.length
                            || fullProject.approvedRuntimeContract
                        ),
                    });
                    setStep(nextStep);
                    setMaxStepReached(nextStep);
                    if (!wasReset) toast.success('Schedule Loaded', `${fullProject.name} - Step ${nextStep}`);

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
