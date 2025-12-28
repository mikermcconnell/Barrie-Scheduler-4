
import React, { useState, useEffect } from 'react';
import { ArrowRight, Save, Loader2, Check } from 'lucide-react';
import { Step1Upload } from './steps/Step1Upload';
import { Step2Analysis } from './steps/Step2Analysis';
import { Step3Build, ScheduleConfig } from './steps/Step3Build';
import { Step4Schedule } from './steps/Step4Schedule';
import { parseRuntimeCSV, RuntimeData, SegmentRawData } from './utils/csvParser';
import { calculateTotalTripTimes, detectOutliers, calculateBands, TripBucketAnalysis, TimeBand, DirectionBandSummary, computeDirectionBandSummary } from './utils/runtimeAnalysis';
import { generateSchedule } from './utils/scheduleGenerator';
import { MasterRouteTable } from '../../utils/masterScheduleParser';
import { useWizardProgress, WizardProgress } from '../../hooks/useWizardProgress';
import { ResumeWizardModal } from './ResumeWizardModal';
import { NewScheduleHeader } from './NewScheduleHeader';
import { ProjectManagerModal } from './ProjectManagerModal';
import { AutoSaveStatus } from '../../hooks/useAutoSave';
import { useAuth } from '../AuthContext';
import { useToast } from '../ToastContext';
import { saveProject, getProject } from '../../utils/newScheduleProjectService';

// Constants - centralized magic numbers
const DEFAULT_CYCLE_TIME = 60;
const DEFAULT_ROUTE_NUMBER = '10';
const DEFAULT_START_TIME = '06:00';
const DEFAULT_END_TIME = '22:00';

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
    const toast = useToast();

    const [step, setStep] = useState(1);
    const [maxStepReached, setMaxStepReached] = useState(1);

    // Update max step tracking
    useEffect(() => {
        if (step > maxStepReached) setMaxStepReached(step);
    }, [step, maxStepReached]);

    const [dayType, setDayType] = useState<'Weekday' | 'Saturday' | 'Sunday'>('Weekday');
    const [files, setFiles] = useState<File[]>([]);
    const [projectName, setProjectName] = useState('New Schedule Project');
    const [projectId, setProjectId] = useState<string | undefined>();
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
        blocks: []
    });

    // State for Step 4 Schedule
    const [generatedSchedules, setGeneratedSchedules] = useState<MasterRouteTable[]>([]);

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

    // Check for saved progress on mount
    useEffect(() => {
        if (!hasCheckedProgress && hasProgress()) {
            const progress = load();
            setSavedProgress(progress);
            setShowResumeModal(true);
        }
        setHasCheckedProgress(true);
    }, [hasCheckedProgress, hasProgress, load, setHasCheckedProgress]);

    // Save progress when state changes (after step 1)
    useEffect(() => {
        if (step >= 1 && files.length > 0) {
            save({
                step: step as 1 | 2 | 3 | 4,
                dayType,
                fileNames: files.map(f => f.name),
                analysis: step >= 2 ? analysis : undefined,
                bands: step >= 2 ? bands : undefined,
                config: step >= 3 ? config : undefined,
                generatedSchedules: step >= 4 ? generatedSchedules : undefined,
                updatedAt: new Date().toISOString()
            });
        }
    }, [step, dayType, files.length, analysis, bands, config, generatedSchedules, save]);

    const handleResume = () => {
        if (savedProgress) {
            setStep(savedProgress.step);
            setMaxStepReached(Math.max(savedProgress.step, maxStepReached));
            setDayType(savedProgress.dayType);
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
        setShowResumeModal(false);
    };

    // Save Feedback State
    const [isManualSaving, setIsManualSaving] = useState(false);
    const [manualSaveSuccess, setManualSaveSuccess] = useState(false);

    const handleSaveProgress = async () => {
        setIsManualSaving(true);
        // Save to localStorage for quick resume
        save({
            step: step as 1 | 2 | 3 | 4,
            dayType,
            fileNames: files.map(f => f.name),
            analysis: step >= 2 ? analysis : undefined,
            bands: step >= 2 ? bands : undefined,
            config: step >= 3 ? config : undefined,
            generatedSchedules: step >= 4 ? generatedSchedules : undefined,
            parsedData: step >= 1 ? parsedData : undefined,
            updatedAt: new Date().toISOString()
        });

        // Also save to Firebase if user is authenticated
        if (user?.uid) {
            try {
                const savedId = await saveProject(user.uid, {
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
                setManualSaveSuccess(true);
                setTimeout(() => setManualSaveSuccess(false), 2000);
                toast.success('Saved to Cloud', 'Your progress has been saved');
            } catch (e) {
                console.error('Failed to save to Firebase:', e);
                toast.warning('Partial Save', 'Saved locally. Cloud save failed.');
            }
        } else {
            setManualSaveSuccess(true);
            setTimeout(() => setManualSaveSuccess(false), 2000);
            toast.info('Saved Locally', 'Sign in to save to cloud');
        }
        setIsManualSaving(false);
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

                // Auto-detect config from first file
                if (results[0]?.detectedRouteNumber) {
                    setConfig(prev => ({
                        ...prev,
                        routeNumber: results[0].detectedRouteNumber!
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
                dayType
            );

            if (generatedTables.length === 0) {
                toast.error('Generation Failed', 'Could not generate schedule. Check cycle time and data format.');
                return;
            }

            setGeneratedSchedules(generatedTables);
            setStep(4);
            toast.success('Schedule Generated', `Created ${generatedTables.length} schedule(s)`);

            // Save the generated schedule to Firebase
            if (user?.uid && generatedTables.length > 0) {
                try {
                    const savedId = await saveProject(user.uid, {
                        ...(projectId ? { id: projectId } : {}),
                        name: projectName,
                        dayType,
                        routeNumber: config.routeNumber,
                        analysis,
                        bands,
                        config,
                        generatedSchedules: generatedTables,
                        parsedData,
                        isGenerated: true
                    });
                    setProjectId(savedId);
                } catch (e) {
                    console.error('Failed to save generated schedule:', e);
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

    const handleNewProject = () => {
        if (files.length > 0 || step > 1) {
            if (!confirm('Start a new project? Current progress will be cleared.')) return;
        }
        clear();
        setStep(1);
        setMaxStepReached(1);
        setFiles([]);
        setParsedData([]);
        setAnalysis([]);
        setBands([]);
        setSegmentNames([]);
        setConfig({ routeNumber: DEFAULT_ROUTE_NUMBER, cycleTime: DEFAULT_CYCLE_TIME, blocks: [] });
        setProjectName('New Schedule Project');
        setProjectId(undefined);
        toast.info('New Project', 'Starting fresh');
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
            />

            <div className="flex flex-col h-full bg-gray-50/50">
                {/* Wizard Header */}
                <NewScheduleHeader
                    currentStep={step}
                    stepLabel={step === 1 ? 'Upload Data' : step === 2 ? 'Runtime Analysis' : 'Build Schedule'}
                    projectName={projectName}
                    onRenameProject={setProjectName}
                    onOpenProjects={() => setShowProjectManager(true)}
                    onNewProject={handleNewProject}
                    onSaveVersion={handleSaveProgress}
                    onClose={onBack}
                    onStepClick={(s) => setStep(s)}
                    maxStepReached={maxStepReached}
                    autoSaveStatus={autoSaveStatus}
                    lastSaved={lastSaved}
                    routeNumber={step >= 3 ? config.routeNumber : undefined}
                    dayType={dayType}
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
                        {/* Save Progress Button */}
                        {files.length > 0 && (
                            <button
                                onClick={handleSaveProgress}
                                disabled={isManualSaving}
                                className={`px-4 py-2 rounded-lg border font-bold flex items-center gap-2 transition-all ${manualSaveSuccess
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
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
                                ) : (
                                    <>
                                        <Save size={16} />
                                        Save Progress
                                    </>
                                )}
                            </button>
                        )}

                        <button
                            onClick={handleNext}
                            className="px-6 py-2 rounded-lg bg-brand-blue text-white font-bold hover:brightness-110 shadow-md shadow-blue-500/20 flex items-center gap-2"
                        >
                            {step === 4 ? 'Export to Dashboard' : (step === 3 ? 'Generate Schedule' : 'Next Step')}
                            {step !== 4 && <ArrowRight size={18} />}
                        </button>
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
                    if (user?.uid) {
                        const fullProject = await getProject(user.uid, project.id);
                        if (fullProject) {
                            setProjectId(fullProject.id);
                            setProjectName(fullProject.name);
                            setDayType(fullProject.dayType);
                            if (fullProject.analysis) {
                                setAnalysis(fullProject.analysis);
                                setSegmentNames(extractSegmentNames(fullProject.analysis));
                            }
                            if (fullProject.bands) setBands(fullProject.bands);
                            if (fullProject.config) setConfig(fullProject.config);
                            if (fullProject.generatedSchedules) setGeneratedSchedules(fullProject.generatedSchedules);
                            if (fullProject.parsedData) setParsedData(fullProject.parsedData);

                            const nextStep = (fullProject.isGenerated && fullProject.generatedSchedules?.length > 0) ? 4 : (fullProject.config ? 3 : 2);
                            setStep(nextStep);
                            setMaxStepReached(nextStep);

                            toast.success('Project Loaded', fullProject.name);
                        }
                    }
                    setShowProjectManager(false);
                }}
                onLoadGeneratedSchedule={(schedules, name, id) => {
                    setProjectId(id);
                    setProjectName(name);
                    if (onGenerate) {
                        onGenerate(schedules);
                        toast.success('Schedule Loaded', name);
                    }
                }}
                onNewProject={() => {
                    clear();
                    setStep(1);
                    setMaxStepReached(1);
                    setFiles([]);
                    setProjectId(undefined);
                    setProjectName('New Schedule Project');
                    setShowProjectManager(false);
                }}
            />
        </>
    );
};
