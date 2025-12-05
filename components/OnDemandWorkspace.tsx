import React, { useState, useMemo } from 'react';
import { generateRequirements, generateShifts, calculateSchedule, calculateMetrics } from '../utils/dataGenerator';
import { optimizeScheduleWithGemini } from '../utils/geminiOptimizer';
import { SummaryCards } from './SummaryCards';
import { GapChart } from './GapChart';
import { FileUpload } from './FileUpload';
import { ShiftEditor } from './ShiftEditor';
import { ShiftEditorModal } from './ShiftEditorModal';
import { OptimizationReviewModal } from './OptimizationReviewModal';
import { FileManager } from './FileManager';
import { useAuth } from './AuthContext';
import { parseScheduleMaster, parseRideCo } from '../utils/csvParsers';
import {
    SavedFile,
    SavedSchedule,
    downloadFileContent,
    saveSchedule,
    updateSchedule
} from '../utils/dataService';
import { generateRideCoCSV, downloadCSV } from '../utils/exportService';
import { SummaryMetrics, Shift, Requirement, Zone } from '../types';
import {
    Wand2, Users, BarChart3, Sparkles, AlertTriangle, Loader2,
    FolderOpen, Save, CloudDownload, Check, Edit3
} from 'lucide-react';
import { SHIFT_DURATION_SLOTS, BREAK_DURATION_SLOTS } from '../constants';

// Define the Shared Filter Type
export type ZoneFilterType = 'All' | 'North' | 'South' | 'Floater';

export const OnDemandWorkspace: React.FC = () => {
    const { user } = useAuth();

    const [schedules, setSchedules] = useState<Record<string, Requirement[]> | null>(null);
    const [selectedDayType, setSelectedDayType] = useState<string>('Weekday');
    // Core State
    // Initialize synchronously to ensure data is present for first render calculation
    const [requirements, setRequirements] = useState<Requirement[]>(() => generateRequirements());
    const [allShifts, setAllShifts] = useState<Shift[]>(() => generateShifts(generateRequirements(), false));
    const [shifts, setShifts] = useState<Shift[]>(() => generateShifts(generateRequirements(), false));

    const [activeTab, setActiveTab] = useState<'overview' | 'editor'>('overview');
    const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

    // Shared Zone Filter State (Lifted Up)
    const [zoneFilter, setZoneFilter] = useState<ZoneFilterType>('All');

    // File Upload State
    const [uploadedFiles, setUploadedFiles] = useState<{ master: File | null, rideco: File | null }>({ master: null, rideco: null });

    // Cloud File Manager State
    const [showFileManager, setShowFileManager] = useState(false);
    const [loadedCloudFiles, setLoadedCloudFiles] = useState<{ master: SavedFile | null, rideco: SavedFile | null }>({ master: null, rideco: null });
    const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [isLoadingFromCloud, setIsLoadingFromCloud] = useState(false);

    // Draft Name State (Supporting "Save As" via Rename)
    const [draftName, setDraftName] = useState<string>(`On-Demand Schedule - ${new Date().toLocaleDateString()}`);
    const [originalDraftName, setOriginalDraftName] = useState<string | null>(null);

    // UI State
    const [isOptimized, setIsOptimized] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [optimizationMode, setOptimizationMode] = useState<'full' | 'refine' | null>(null);
    const [reviewModalData, setReviewModalData] = useState<{ current: Shift[], optimized: Shift[] } | null>(null);

    // Derived State
    // Now guaranteed to have valid inputs on first render
    const timeSlots = useMemo(() => calculateSchedule(shifts, requirements), [shifts, requirements]);
    const metrics = useMemo(() => calculateMetrics(timeSlots), [timeSlots]);

    const handleRegenerate = async () => {
        if (shifts.length > 0) {
            if (!confirm('This will replace your current schedule with a brand new one generated from scratch. All custom changes will be lost. Continue?')) {
                return;
            }
        }

        setOptimizationMode('full');
        setIsAnimating(true);

        try {
            // Call Gemini API - Full Mode
            const aiShifts = await optimizeScheduleWithGemini(requirements, 'full');

            if (aiShifts.length > 0) {
                setShifts(aiShifts);
                setIsOptimized(true);
            } else {
                console.warn("Gemini API returned no shifts.");
                alert("Optimization failed to return shifts.");
            }
        } catch (e) {
            console.error("Optimization error", e);
            alert("Optimization failed.");
        } finally {
            setIsAnimating(false);
            setOptimizationMode(null);
        }
    };

    const handleRefine = async () => {
        setOptimizationMode('refine');
        setIsAnimating(true);

        try {
            // Call Gemini API - Refine Mode
            const aiShifts = await optimizeScheduleWithGemini(requirements, 'refine', shifts);

            if (aiShifts.length > 0) {
                // Open Review Modal instead of applying directly
                setReviewModalData({
                    current: shifts,
                    optimized: aiShifts
                });
            } else {
                alert("No refinements found.");
            }
        } catch (e) {
            console.error("Refinement error", e);
            alert("Refinement failed.");
        } finally {
            setIsAnimating(false);
            setOptimizationMode(null);
        }
    };

    const applyRefinements = (finalShifts: Shift[]) => {
        setShifts(finalShifts);
        setReviewModalData(null);
        setIsOptimized(true);
    };

    const handleShiftUpdate = (updatedShift: Shift) => {
        setShifts(prev => prev.map(s => s.id === updatedShift.id ? updatedShift : s));
    };

    const handleDayTypeChange = (dayType: string) => {
        if (schedules && schedules[dayType]) {
            setSelectedDayType(dayType);
            setRequirements(schedules[dayType]);

            // Filter shifts
            const filtered = allShifts.filter(s => !s.dayType || s.dayType === dayType);
            setShifts(filtered);
        }
    };

    const handleDeleteShift = (id: string) => {
        setShifts(prev => prev.filter(s => s.id !== id));
    };

    const handleAddShift = () => {
        // Default shift: 8am - 4pm
        const newShift: Shift = {
            id: `shift-${Math.random().toString(36).substr(2, 9)}`,
            driverName: `New Driver`,
            zone: Zone.FLOATER,
            startSlot: 32, // 08:00
            endSlot: 32 + SHIFT_DURATION_SLOTS,
            breakStartSlot: 32 + 16, // Break after 4 hours
            breakDurationSlots: BREAK_DURATION_SLOTS
        };
        setShifts(prev => [...prev, newShift]);
        // Switch to editor to see the new shift
        setActiveTab('editor');
    };

    const handleFileUpload = (files: File[]) => {
        setUploadedFiles(prev => {
            const newFiles = { ...prev };
            files.forEach(file => {
                if (file.name.includes('Schedule Master') || file.name.includes('Master')) {
                    newFiles.master = file;
                } else if (file.name.includes('RideCo') || file.name.includes('Template')) {
                    newFiles.rideco = file;
                }
            });
            return newFiles;
        });
    };

    const processFiles = async () => {
        setIsAnimating(true);
        try {
            if (uploadedFiles.master) {
                const text = await uploadedFiles.master.text();
                const newSchedules = parseScheduleMaster(text);
                setSchedules(newSchedules);

                // Default to Weekday if available, else first key
                const defaultDay = newSchedules['Weekday'] ? 'Weekday' : Object.keys(newSchedules)[0];
                if (defaultDay) {
                    setSelectedDayType(defaultDay);
                    setRequirements(newSchedules[defaultDay]);
                }
            }

            if (uploadedFiles.rideco) {
                const text = await uploadedFiles.rideco.text();
                const newShifts = parseRideCo(text);
                if (newShifts.length > 0) {
                    setAllShifts(newShifts);
                    // Filter for current selected day
                    const currentDay = selectedDayType || 'Weekday';
                    const filtered = newShifts.filter(s => !s.dayType || s.dayType === currentDay);
                    setShifts(filtered);
                }
            }

            setUploadedFiles({ master: null, rideco: null });
        } catch (e) {
            console.error(e);
            alert('Error processing files.');
        } finally {
            setIsAnimating(false);
        }
    };

    // Auto-process when both files are uploaded
    // Note: We use a ref to avoid stale closure issues with processFiles
    const processFilesRef = React.useRef(processFiles);
    processFilesRef.current = processFiles;

    React.useEffect(() => {
        if (uploadedFiles.master && uploadedFiles.rideco && !isAnimating) {
            processFilesRef.current();
        }
    }, [uploadedFiles, isAnimating]);

    // Get the shift being edited (with safety check to prevent crashes)
    const shiftToEdit = editingShiftId ? shifts.find(s => s.id === editingShiftId) : null;

    // Handle loading a file from cloud storage
    const handleCloudFileSelect = async (file: SavedFile) => {
        console.log('Loading file from cloud:', file.name, 'Type:', file.type);
        setIsLoadingFromCloud(true);
        try {
            const content = await downloadFileContent(file.downloadUrl);
            console.log('Downloaded content length:', content.length);

            // Determine file type - if 'other', try to detect from filename
            let fileType = file.type;
            if (fileType === 'other' || fileType === 'barrie_tod') {
                const lowerName = file.name.toLowerCase();
                if (lowerName.includes('rideco') || lowerName.includes('shift') || lowerName.includes('template')) {
                    fileType = 'rideco';
                } else if (lowerName.includes('master') || lowerName.includes('schedule')) {
                    fileType = 'schedule_master';
                }
            }

            if (fileType === 'schedule_master') {
                // Parse as master schedule
                console.log('Parsing as Master Schedule...');
                const newSchedules = parseScheduleMaster(content);
                console.log('Parsed schedules:', Object.keys(newSchedules));
                setSchedules(newSchedules);
                setLoadedCloudFiles(prev => ({ ...prev, master: file }));

                const defaultDay = newSchedules['Weekday'] ? 'Weekday' : Object.keys(newSchedules)[0];
                if (defaultDay) {
                    setSelectedDayType(defaultDay);
                    setRequirements(newSchedules[defaultDay]);
                }
            } else if (fileType === 'rideco') {
                // Parse as RideCo shifts
                console.log('Parsing as RideCo shifts...');
                const newShifts = parseRideCo(content);
                console.log('Parsed shifts count:', newShifts.length);
                if (newShifts.length > 0) {
                    setAllShifts(newShifts);
                    setLoadedCloudFiles(prev => ({ ...prev, rideco: file }));
                    const currentDay = selectedDayType || 'Weekday';
                    const filtered = newShifts.filter(s => !s.dayType || s.dayType === currentDay);
                    setShifts(filtered);
                } else {
                    alert('No shifts found in the file. Make sure it\'s a valid RideCo shift template.');
                }
            } else {
                // Unknown type - let user know
                alert(`Unknown file type: "${file.type}". Please ensure the file is either a RideCo Shift Template or a Master Schedule.`);
            }

            setShowFileManager(false);
        } catch (err) {
            console.error('Failed to load file from cloud:', err);
            alert('Failed to load file. Please try again.');
        } finally {
            setIsLoadingFromCloud(false);
        }
    };

    // Handle loading a saved draft/schedule
    const handleScheduleSelect = (schedule: SavedSchedule) => {
        // Restore the workspace state from the saved schedule
        if (schedule.shiftData) {
            setShifts(schedule.shiftData);
            setAllShifts(schedule.shiftData);
        }
        if (schedule.masterScheduleData) {
            setRequirements(schedule.masterScheduleData);
        }
        setDraftName(schedule.name);
        setOriginalDraftName(schedule.name);
        setCurrentDraftId(schedule.id);
        setShowFileManager(false);
    };

    // Save current work as a draft
    const handleSaveDraft = async () => {
        if (!user) {
            alert('Please sign in to save your work.');
            return;
        }

        setIsSaving(true);
        setSaveSuccess(false);

        try {
            const scheduleData = {
                name: draftName,
                description: `${shifts.length} shifts, Day Type: ${selectedDayType}`,
                status: 'draft' as const,
                shiftData: shifts,
                masterScheduleData: requirements,
            };

            // Logic: "Save As" if the ID exists BUT the name has changed
            // This allows creating new versions simply by renaming
            if (currentDraftId && draftName === originalDraftName) {
                // Update existing draft
                await updateSchedule(user.uid, currentDraftId, scheduleData);
            } else {
                // Create new draft
                const newId = await saveSchedule(user.uid, scheduleData);
                setCurrentDraftId(newId);
                setOriginalDraftName(draftName); // Sync baseline to the new name
            }

            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            console.error('Failed to save draft:', err);
            alert('Failed to save. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="animate-in fade-in zoom-in-95 duration-500">

            {/* File Manager Modal */}
            {showFileManager && user && (
                <FileManager
                    onClose={() => setShowFileManager(false)}
                    onSelectFile={handleCloudFileSelect}
                    onSelectSchedule={handleScheduleSelect}
                />
            )}

            {/* Review Modal */}
            {reviewModalData && (
                <OptimizationReviewModal
                    currentShifts={reviewModalData.current}
                    optimizedShifts={reviewModalData.optimized}
                    requirements={requirements}
                    onApply={applyRefinements}
                    onCancel={() => setReviewModalData(null)}
                />
            )}

            {/* Title & Actions */}
            <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
                <div className="flex-1">
                    <div className="group flex items-center gap-3">
                        <div className="relative">
                            <input
                                type="text"
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                className="text-3xl font-extrabold text-gray-800 bg-transparent border-b-2 border-transparent hover:border-gray-200 focus:border-brand-blue focus:outline-none transition-all w-full md:w-[600px] py-1"
                            />
                            <Edit3 size={16} className="absolute -right-6 top-1/2 -translate-y-1/2 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        </div>
                    </div>

                    <p className="text-gray-500 font-bold mt-1">Manage Master Schedules vs. MVT Driver Shifts</p>
                    {/* Show loaded cloud files */}
                    {(loadedCloudFiles.master || loadedCloudFiles.rideco) && (
                        <div className="flex gap-4 mt-2">
                            {loadedCloudFiles.master && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg font-bold">
                                    📄 {loadedCloudFiles.master.name}
                                </span>
                            )}
                            {loadedCloudFiles.rideco && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-bold">
                                    🚌 {loadedCloudFiles.rideco.name}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Cloud Actions Group */}
                    {user && (
                        <div className="flex items-center gap-2 mr-4 p-1 bg-gray-50 rounded-lg border border-gray-100">
                            <button
                                onClick={() => {
                                    const csv = generateRideCoCSV(shifts);
                                    downloadCSV(csv, `RideCo_Shifts_${new Date().toISOString().split('T')[0]}.csv`);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 hover:bg-white hover:shadow-sm rounded-md transition-all"
                                title="Export as RideCo Template"
                            >
                                <CloudDownload size={14} className="rotate-180" />
                                Export
                            </button>
                            <div className="w-px h-4 bg-gray-200"></div>
                            <button
                                onClick={() => setShowFileManager(true)}
                                disabled={isLoadingFromCloud}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 hover:bg-white hover:shadow-sm rounded-md transition-all"
                            >
                                {isLoadingFromCloud ? (
                                    <Loader2 className="animate-spin" size={14} />
                                ) : (
                                    <CloudDownload size={14} />
                                )}
                                Load
                            </button>
                            <div className="w-px h-4 bg-gray-200"></div>
                            <button
                                onClick={handleSaveDraft}
                                disabled={isSaving}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${saveSuccess
                                    ? 'bg-green-50 text-green-700'
                                    : 'text-gray-500 hover:text-brand-blue hover:bg-white hover:shadow-sm'
                                    }`}
                            >
                                {isSaving ? (
                                    <Loader2 className="animate-spin" size={14} />
                                ) : saveSuccess ? (
                                    <Check size={14} />
                                ) : (
                                    <Save size={14} />
                                )}
                                {isSaving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save Draft'}
                            </button>
                        </div>
                    )}

                    {schedules && (
                        <div className="flex bg-gray-100 p-1 rounded-lg mr-4">
                            {Object.keys(schedules).map(day => (
                                <button
                                    key={day}
                                    onClick={() => handleDayTypeChange(day)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${selectedDayType === day
                                        ? 'bg-white text-brand-blue shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-3">
                            {/* Refine Button - Primary Action */}
                            <button
                                onClick={handleRefine}
                                disabled={isAnimating || shifts.length === 0}
                                className={`
                                flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-md hover:shadow-lg active:scale-95
                                ${isAnimating && optimizationMode === 'refine'
                                        ? 'bg-indigo-400 cursor-wait'
                                        : shifts.length === 0
                                            ? 'bg-gray-300 cursor-not-allowed shadow-none'
                                            : 'bg-indigo-600 hover:bg-indigo-700'
                                    }
                                transition-all duration-200
                            `}
                                title="Refine current shifts"
                            >
                                {isAnimating && optimizationMode === 'refine' ? (
                                    <Sparkles className="animate-spin text-white" size={18} />
                                ) : (
                                    <Sparkles size={18} />
                                )}
                                Refine & Polish
                            </button>

                            {/* Regenerate Button - Distinct but Secondary */}
                            <button
                                onClick={handleRegenerate}
                                disabled={isAnimating}
                                className={`
                                flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold shadow-sm border active:scale-95
                                ${isAnimating && optimizationMode === 'full'
                                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-wait'
                                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                    }
                                transition-all duration-200
                            `}
                                title="Generate fresh schedule"
                            >
                                {isAnimating && optimizationMode === 'full' ? (
                                    <Loader2 className="animate-spin" size={18} />
                                ) : (
                                    <Wand2 size={18} />
                                )}
                                Regenerate
                            </button>
                        </div>


                        {/* Notification when optimizing */}
                        {isAnimating && (
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-500 animate-pulse bg-yellow-50 px-3 py-1 rounded-lg border border-yellow-200">
                                <Loader2 size={12} className="animate-spin" />
                                {optimizationMode === 'full' ? 'Generating fresh schedule...' : 'Refining existing shifts...'}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* File Upload Staging Area */}
            {(uploadedFiles.master || uploadedFiles.rideco) && (
                <div className="mb-8 bg-blue-50 border border-blue-100 rounded-2xl p-6 flex items-center justify-between animate-in slide-in-from-top-4">
                    <div className="flex gap-6">
                        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 ${uploadedFiles.master ? 'bg-white border-green-200 text-green-700' : 'bg-gray-50 border-dashed border-gray-300 text-gray-400'}`}>
                            <BarChart3 size={20} />
                            <span className="font-bold">{uploadedFiles.master ? uploadedFiles.master.name : 'Missing Demand File'}</span>
                        </div>
                        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 ${uploadedFiles.rideco ? 'bg-white border-green-200 text-green-700' : 'bg-gray-50 border-dashed border-gray-300 text-gray-400'}`}>
                            <Users size={20} />
                            <span className="font-bold">{uploadedFiles.rideco ? uploadedFiles.rideco.name : 'Missing Supply File'}</span>
                        </div>
                    </div>
                    <button
                        onClick={processFiles}
                        className="px-8 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 shadow-lg shadow-green-200 transition-all"
                    >
                        Process Files
                    </button>
                </div>
            )}

            {/* Real-time Visualization (Always Visible) */}
            <div className="mb-8">
                <GapChart
                    data={timeSlots}
                    zoneFilter={zoneFilter}
                    onZoneFilterChange={setZoneFilter}
                />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-4 mb-6 border-b-2 border-gray-200 pb-1">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`
                    pb-3 px-4 font-extrabold text-lg flex items-center gap-2 transition-all
                    ${activeTab === 'overview'
                            ? 'text-brand-blue border-b-4 border-brand-blue translate-y-[2px]'
                            : 'text-gray-400 hover:text-gray-600'
                        }
                `}
                >
                    <BarChart3 size={20} /> Overview & Metrics
                </button>
                <button
                    onClick={() => setActiveTab('editor')}
                    className={`
                    pb-3 px-4 font-extrabold text-lg flex items-center gap-2 transition-all
                    ${activeTab === 'editor'
                            ? 'text-brand-blue border-b-4 border-brand-blue translate-y-[2px]'
                            : 'text-gray-400 hover:text-gray-600'
                        }
                `}
                >
                    <Users size={20} /> Shift Editor <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full ml-1">{shifts.length}</span>
                </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <SummaryCards metrics={metrics} />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2">
                            <FileUpload onFileUpload={handleFileUpload} />
                        </div>
                        <div className="lg:col-span-1">
                            <div className="bg-white p-6 rounded-3xl border-2 border-gray-200 h-full">
                                <h3 className="text-xl font-extrabold text-gray-700 mb-4">Shift Distribution</h3>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border-2 border-blue-100">
                                        <span className="font-bold text-gray-600">North Zone</span>
                                        <span className="font-extrabold text-brand-blue">
                                            ~{Math.round(shifts.length * 0.4)} Drivers
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-xl border-2 border-green-100">
                                        <span className="font-bold text-gray-600">South Zone</span>
                                        <span className="font-extrabold text-brand-green">
                                            ~{Math.round(shifts.length * 0.4)} Drivers
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded-xl border-2 border-orange-100">
                                        <div className="flex items-center gap-2">
                                            {/* Coffee icon removed to avoid unused import if Coffee not imported. Assuming Coffee is needed or use generic icon */}
                                            <span className="font-bold text-gray-600">Break Policy</span>
                                        </div>
                                        <span className="font-extrabold text-orange-500 text-xs">Active</span>
                                    </div>
                                </div>

                                <div className={`mt-6 p-4 rounded-2xl border-2 ${isOptimized ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-200'}`}>
                                    <h4 className={`font-bold mb-1 ${isOptimized ? 'text-purple-600' : 'text-gray-500'}`}>
                                        {isOptimized ? 'AI Optimization Report' : 'Current Status'}
                                    </h4>
                                    <p className="text-sm text-gray-600 font-semibold mb-2">
                                        {isOptimized
                                            ? 'Gemini has re-balanced the schedule. Notice that gaps may still exist due to 8-hour shift constraints.'
                                            : 'Standard Roster. Potential inefficiencies detected.'}
                                    </p>
                                    {isOptimized && (
                                        <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-100 p-2 rounded-lg">
                                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                            <span>
                                                <strong>Why +5 surplus?</strong> 8-hour shifts are rigid. To cover peaks at 8am and 5pm, overlap at noon is mathematically unavoidable without split shifts.
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'editor' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <ShiftEditor
                        shifts={shifts}
                        onUpdateShift={handleShiftUpdate}
                        onDeleteShift={handleDeleteShift}
                        onAddShift={handleAddShift}
                        onEditShift={(id) => {
                            console.log('OnDemandWorkspace received edit request for:', id);
                            setEditingShiftId(id);
                        }}
                        // Pass Synced Filter State
                        zoneFilter={zoneFilter}
                        onZoneFilterChange={setZoneFilter}
                    />
                </div>
            )}

            {/* Modal Overlay - only render if shift exists (prevents crash) */}
            {shiftToEdit && (
                <ShiftEditorModal
                    shift={shiftToEdit}
                    allShifts={shifts}
                    requirements={requirements}
                    onSave={(updated) => {
                        handleShiftUpdate(updated);
                        setEditingShiftId(null);
                    }}
                    onCancel={() => setEditingShiftId(null)}
                />
            )}
        </div>
    );
};