
import React, { useState, useEffect } from 'react';
import { ArrowRight, Save, Loader2, Check } from 'lucide-react';
import { Step1Upload } from './steps/Step1Upload';
import { Step2Analysis } from './steps/Step2Analysis';
import { Step3Build, ScheduleConfig } from './steps/Step3Build';
import { Step4Schedule } from './steps/Step4Schedule';
import { parseRuntimeCSV, RuntimeData, SegmentRawData } from './utils/csvParser';
import { calculateTotalTripTimes, detectOutliers, calculateBands, TripBucketAnalysis, TimeBand, BandSummary, DirectionBandSummary, computeDirectionBandSummary } from './utils/runtimeAnalysis';
import { generateSchedule } from './utils/scheduleGenerator';
import { MasterRouteTable } from '../../utils/masterScheduleParser';
import { useWizardProgress, WizardProgress } from '../../hooks/useWizardProgress';
import { ResumeWizardModal } from './ResumeWizardModal';
import { NewScheduleHeader } from './NewScheduleHeader';
import { ProjectManagerModal } from './ProjectManagerModal';
import { AutoSaveStatus } from '../../hooks/useAutoSave';
import { useAuth } from '../AuthContext';
import { saveProject, getProject, NewScheduleProject } from '../../utils/newScheduleProjectService';

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
    const [step, setStep] = useState(1);
    const [maxStepReached, setMaxStepReached] = useState(1);

    // Update max step tracking
    useEffect(() => {
        if (step > maxStepReached) setMaxStepReached(step);
    }, [step]);
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

    // State for Step 3 Config
    const [config, setConfig] = useState<ScheduleConfig>({
        routeNumber: '10',
        cycleTime: 60, // Default 60 mins
        blocks: []
    });

    // State for Step 4 Schedule
    const [generatedSchedules, setGeneratedSchedules] = useState<MasterRouteTable[]>([]);

    // Helper to update analysis and recalc bands
    const handleAnalysisUpdate = (newAnalysis: TripBucketAnalysis[]) => {
        // Recalculate bands based on new ignore states
        const { buckets, bands: newBands } = calculateBands(newAnalysis);
        setAnalysis(buckets);
        setBands(newBands);
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
    }, []);

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
    }, [step, dayType, files.length, analysis, bands, config, generatedSchedules]);

    const handleResume = () => {
        if (savedProgress) {
            setStep(savedProgress.step);
            setMaxStepReached(Math.max(savedProgress.step, maxStepReached));
            setDayType(savedProgress.dayType);
            if (savedProgress.analysis) setAnalysis(savedProgress.analysis);
            if (savedProgress.bands) setBands(savedProgress.bands);
            if (savedProgress.config) setConfig(savedProgress.config);
            if (savedProgress.generatedSchedules) setGeneratedSchedules(savedProgress.generatedSchedules);

            // Restore Raw Data if available (now supported in persistence)
            if (savedProgress.parsedData && savedProgress.parsedData.length > 0) {
                setParsedData(savedProgress.parsedData);
            } else {
                console.warn('Restored project but missing parsedData (raw CSV data). Generation may fail.');
            }
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
            parsedData: step >= 1 ? parsedData : undefined, // Save locally
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
                    parsedData: step >= 1 ? parsedData : undefined, // Save to cloud storage
                    isGenerated: step >= 4,
                    ...(projectId ? { id: projectId } : {})
                });
                setProjectId(savedId);
                // Success Feedback
                setManualSaveSuccess(true);
                setTimeout(() => setManualSaveSuccess(false), 2000);
            } catch (e) {
                console.error('Failed to save to Firebase:', e);
                alert('Saved locally. Cloud save failed.'); // Don't interrupt
            }
        } else {
            // alert('Progress saved locally! Sign in to save to cloud.'); // Silent success
            setManualSaveSuccess(true);
            setTimeout(() => setManualSaveSuccess(false), 2000);
        }
        setIsManualSaving(false);
    };

    const handleNext = async () => {
        if (step === 1) {
            if (files.length === 0) {
                alert("Please upload at least one CSV file.");
                return;
            }
            try {
                // Parse files
                const results = await Promise.all(files.map(f => parseRuntimeCSV(f)));
                setParsedData(results);

                // Run initial analysis
                const rawAnalysis = calculateTotalTripTimes(results);

                // 1. Detect Outliers (Auto-Ignore)
                const withOutliers = detectOutliers(rawAnalysis);

                // 2. Calculate Initial Bands
                const { buckets, bands: generatedBands } = calculateBands(withOutliers);

                setAnalysis(buckets);
                setBands(generatedBands);

                // Build segmentsMap for direction-keyed lookups in Step2Analysis
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
            } catch (error) {
                console.error(error);
                alert("Failed to parse CSV files. Please check the format.");
            }
        } else if (step === 2) {
            // Initialize one block for convenience if empty
            if (config.blocks.length === 0) {
                setConfig(prev => ({
                    ...prev,
                    blocks: [{ id: `${prev.routeNumber}-1`, startTime: '06:00', endTime: '22:00' }]
                }));
            }
            setStep(3);
        } else if (step === 3) {
            // Generate !
            // Sort parsed data by direction: North/A first, then South/B
            const directionOrder: Record<string, number> = { 'North': 0, 'A': 1, 'Loop': 2, 'South': 3, 'B': 4 };
            const sortedParsedData = [...parsedData].sort((a, b) => {
                const orderA = a.detectedDirection ? (directionOrder[a.detectedDirection] ?? 2) : 2;
                const orderB = b.detectedDirection ? (directionOrder[b.detectedDirection] ?? 2) : 2;
                return orderA - orderB;
            });

            // Group data by direction
            console.log('Parsed Data at Step 3:', parsedData.length);
            if (parsedData.length === 0) {
                alert("CRITICAL ERROR: No data found. Did you refresh the page? Please go back to Step 1 and re-upload your files.");
                return;
            }

            const groupedData: Record<string, SegmentRawData[]> = {};
            sortedParsedData.forEach(pd => {
                const dir = pd.detectedDirection || 'North'; // Default to North if unknown
                if (!groupedData[dir]) groupedData[dir] = [];
                groupedData[dir].push(...pd.segments);
            });

            // Store segmentsMap for Step2Analysis to use
            setSegmentsMap(groupedData);

            // CRITICAL: Compute bandSummary SYNCHRONOUSLY at generation time
            // The Step2Analysis component may not be mounted, so we can't rely on
            // its useEffect to have populated bandSummary state correctly.
            // This ensures fresh, accurate band data is used for schedule generation.
            const freshBandSummary = computeDirectionBandSummary(analysis, bands, groupedData);

            console.log('=== FRESH BAND SUMMARY (Computed at generation time) ===');
            Object.entries(freshBandSummary).forEach(([dir, dirBands]) => {
                console.log(`  ${dir}: ${dirBands.length} bands`);
                dirBands.forEach(b => {
                    console.log(`    Band ${b.bandId}: avgTotal=${b.avgTotal?.toFixed(1)}, ${b.segments.length} segments, timeSlots=[${b.timeSlots.join(', ')}]`);
                });
            });

            // Generate synced schedule
            console.log('Generating schedule with:', {
                config,
                bandsCount: bands.length,
                directionKeys: Object.keys(groupedData),
                exampleSegmentCts: Object.values(groupedData).map(v => v.length),
                analysisHasDetails: analysis.length > 0 ? analysis[0].details?.length : 'no analysis',
                sampleAnalysisDetails: analysis.length > 0 && analysis[0].details?.length > 0
                    ? analysis[0].details.slice(0, 2).map(d => d.segmentName)
                    : 'none'
            });

            const generatedTables = generateSchedule(
                config,
                analysis,
                bands,
                freshBandSummary,  // Use freshly computed bandSummary instead of stale state
                groupedData,
                dayType
            );

            console.log('Generated tables result:', generatedTables.length);
            console.log('Generated tables detail:', generatedTables.map(t => ({
                routeName: t.routeName,
                stopsCount: t.stops?.length || 0,
                tripsCount: t.trips?.length || 0,
                sampleStops: t.stops?.slice(0, 3),
                firstTripStartTime: t.trips?.[0]?.startTime,
                firstTripStops: t.trips?.[0]?.stops ? Object.keys(t.trips[0].stops).length : 0
            })));

            if (generatedTables.length === 0) {
                alert(`Schedule Generation Failed.\n\nPossible reasons:\n1. No directions detected in data.\n2. Cycle time is 0.\n3. Input data format mismatch.\n\nDebug Info:\nDirs: ${Object.keys(groupedData).join(', ')}\nBands: ${bands.length}\nConfig: ${JSON.stringify(config)}`);
                return; // Stay on Step 3
            }

            setGeneratedSchedules(generatedTables);
            setStep(4);

            // Save the generated schedule to Firebase project
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
                        parsedData, // VITAL: Save raw data for regeneration
                        isGenerated: true
                    });
                    setProjectId(savedId);
                    console.log('Project saved with generated schedule:', savedId);
                } catch (e) {
                    console.error('Failed to save generated schedule to project:', e);
                }
            }
        } else if (step === 4) {
            // Finalize / Export
            if (onGenerate) {
                onGenerate(generatedSchedules);
            } else {
                alert("Schedule Ready! (Export callback not connected)");
            }
        }
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
                    onNewProject={() => {
                        if (files.length > 0 || step > 1) {
                            if (!confirm('Start a new project? Current progress will be cleared.')) return;
                        }
                        clear();
                        setStep(1);
                        setFiles([]);
                        setParsedData([]);
                        setAnalysis([]);
                        setBands([]);
                        setConfig({ routeNumber: '10', cycleTime: 60, blocks: [] });
                        setProjectName('New Schedule Project');
                        setProjectId(undefined);
                    }}
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
                                onUpdateSchedules={(newScheds) => {
                                    setGeneratedSchedules(newScheds);
                                }}
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
                    // Load the project data
                    if (user?.uid) {
                        const fullProject = await getProject(user.uid, project.id);
                        if (fullProject) {
                            setProjectId(fullProject.id);
                            setProjectName(fullProject.name);
                            setDayType(fullProject.dayType);
                            if (fullProject.analysis) setAnalysis(fullProject.analysis);
                            if (fullProject.bands) setBands(fullProject.bands);
                            if (fullProject.config) setConfig(fullProject.config);
                            if (fullProject.generatedSchedules) setGeneratedSchedules(fullProject.generatedSchedules);

                            // Restore raw data
                            if (fullProject.parsedData) setParsedData(fullProject.parsedData);


                            // If generated, go to step 4 or 3?
                            // If we have schedules, we can go to 4.
                            // If just config, 3.
                            const nextStep = (fullProject.isGenerated && fullProject.generatedSchedules?.length > 0) ? 4 : (fullProject.config ? 3 : 2);
                            setStep(nextStep);
                            setMaxStepReached(nextStep);

                            // If returning to Step 3/4 without raw files, we should inform user?
                            // For now, valid restoration is enough to view Step 4.
                        }
                    }
                }}
                onLoadGeneratedSchedule={(schedules, name, id) => {
                    // Set project context for future saves
                    setProjectId(id);
                    setProjectName(name);
                    // Pass to editor via onGenerate
                    if (onGenerate) {
                        onGenerate(schedules);
                    }
                }}
                onNewProject={() => {
                    clear();
                    setStep(1);
                    setMaxStepReached(1);
                    setFiles([]);
                    setProjectId(undefined);
                    setProjectName('New Schedule Project');
                }}
            />
        </>
    );
};

