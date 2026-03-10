import React, { useState, useMemo, useEffect, useRef } from 'react';
import { generateRequirements, generateShifts, calculateSchedule, calculateMetrics } from '../../utils/dataGenerator';
import { optimizeScheduleWithGemini, OptimizationResult } from '../../utils/ai/geminiOptimizer';
import { useToast } from '../contexts/ToastContext';
import { SummaryCards } from '../SummaryCards';
import { GapChart } from '../GapChart';
import { FileUpload } from '../FileUpload';
import { ShiftEditor } from '../ShiftEditor';
import { ShiftEditorModal } from '../modals/ShiftEditorModal';

import { OptimizationReviewModal } from '../modals/OptimizationReviewModal';
import { FocusPromptModal } from '../modals/FocusPromptModal';
import { FileManager } from '../FileManager';
import { useAuth } from '../contexts/AuthContext';
import { parseScheduleMaster, parseRideCo } from '../../utils/parsers/csvParsers';
import { parseMasterSchedule, convertMasterRouteTablesToRequirements } from '../../utils/parsers/masterScheduleParser';
import * as XLSX from 'xlsx';
import {
    SavedFile,
    SavedSchedule,
    downloadFileContent,
    downloadFileArrayBuffer,
    saveSchedule,
    updateSchedule,
    getSchedule
} from '../../utils/services/dataService';
import { generateRideCoCSV, downloadCSV } from '../../utils/services/exportService';
import { exportTODPaddlesPDF } from '../../utils/services/paddleExportService';
import { SummaryMetrics, Shift, Requirement, Zone, ZoneFilterType } from '../../utils/demandTypes';
import {
    createScopedShiftId,
    filterShiftsByDay,
    normalizeOnDemandShifts,
    OnDemandDayType,
    removeShiftFromDay,
    updateShiftInDay
} from '../../utils/onDemandShiftUtils';
import {
    Wand2, Users, BarChart3, Sparkles, AlertTriangle, Loader2,
    FolderOpen, Save, CloudDownload, Check, Edit3, RotateCcw, ArrowLeft, Star, X
} from 'lucide-react';
import { SHIFT_DURATION_SLOTS, BREAK_DURATION_SLOTS } from '../../utils/demandConstants';

// Valid day types for shifts
type DayType = OnDemandDayType;
const VALID_DAY_TYPES: DayType[] = ['Weekday', 'Saturday', 'Sunday'];

const INITIAL_REQUIREMENTS = generateRequirements();
const INITIAL_ALL_SHIFTS = normalizeOnDemandShifts(generateShifts(INITIAL_REQUIREMENTS, false), 'Weekday');

// Helper to validate and return a safe day type
const toValidDayType = (day: string): DayType => {
    return VALID_DAY_TYPES.includes(day as DayType) ? (day as DayType) : 'Weekday';
};

export const OnDemandWorkspace: React.FC = () => {
    const { user } = useAuth();
    const toast = useToast();

    const [schedules, setSchedules] = useState<Record<string, Requirement[]> | null>(null);
    const [selectedDayType, setSelectedDayType] = useState<DayType>('Weekday');
    // Core State
    // Initialize synchronously to ensure data is present for first render calculation
    const [requirements, setRequirements] = useState<Requirement[]>(() => INITIAL_REQUIREMENTS);
    const [allShifts, setAllShifts] = useState<Shift[]>(() => INITIAL_ALL_SHIFTS);
    const [shifts, setShifts] = useState<Shift[]>(() => filterShiftsByDay(INITIAL_ALL_SHIFTS, 'Weekday'));

    const [activeTab, setActiveTab] = useState<'overview' | 'editor'>('overview');
    const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

    // Shared Zone Filter State (Lifted Up)
    const [zoneFilter, setZoneFilter] = useState<ZoneFilterType>('All');

    // File Upload State
    const [uploadedFiles, setUploadedFiles] = useState<{ master: File | null, rideco: File | null }>({ master: null, rideco: null });
    // Cache file content to enable "Reset to Upload"
    const [cachedFiles, setCachedFiles] = useState<{ master: string | ArrayBuffer | null, rideco: string | ArrayBuffer | null }>({ master: null, rideco: null });

    // Cloud File Manager State
    const [showFileManager, setShowFileManager] = useState(false);
    const [loadedCloudFiles, setLoadedCloudFiles] = useState<{ master: SavedFile | null, rideco: SavedFile | null }>({ master: null, rideco: null });
    const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [isLoadingFromCloud, setIsLoadingFromCloud] = useState(false);
    const handleScheduleSelectRef = React.useRef<(schedule: SavedSchedule) => void>(() => {});

    // Default Schedule (auto-load on mount)
    const [defaultScheduleId, setDefaultScheduleId] = useState<string | null>(
        () => localStorage.getItem('od-default-schedule-id')
    );

    // Draft Name State (Supporting "Save As" via Rename)
    const [draftName, setDraftName] = useState<string>(`On-Demand Schedule - ${new Date().toLocaleDateString()}`);
    const [originalDraftName, setOriginalDraftName] = useState<string | null>(null);

    // UI State
    const [isOptimized, setIsOptimized] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [optimizationMode, setOptimizationMode] = useState<'full' | 'refine' | null>(null);
    const [reviewModalData, setReviewModalData] = useState<{ current: Shift[], optimized: Shift[] } | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [optimizationPhase, setOptimizationPhase] = useState('');
    const abortControllerRef = useRef<AbortController | null>(null);

    // Elapsed timer for optimization progress
    useEffect(() => {
        if (isAnimating) {
            setElapsedSeconds(0);
            elapsedRef.current = setInterval(() => setElapsedSeconds(s => {
                const next = s + 1;
                if (next === 60) {
                    toast.info('Still working...', 'AI optimization can take 2-3 minutes');
                }
                return next;
            }), 1000);
        } else {
            if (elapsedRef.current) clearInterval(elapsedRef.current);
            elapsedRef.current = null;
        }
        return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
    }, [isAnimating, toast]);

    // Derived State
    // Now guaranteed to have valid inputs on first render
    const timeSlots = useMemo(() => calculateSchedule(shifts, requirements), [shifts, requirements]);
    const metrics = useMemo(() => calculateMetrics(timeSlots), [timeSlots]);

    // Helper to parse RideCo content (string or ArrayBuffer)
    const parseRideCoContent = (content: string | ArrayBuffer): Shift[] => {
        if (typeof content === 'string') {
            return normalizeOnDemandShifts(parseRideCo(content), 'Weekday');
        } else {
            const workbook = XLSX.read(content, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json<(string | number)[]>(firstSheet, { header: 1, defval: '' });
            return normalizeOnDemandShifts(parseRideCo(data as string[][]), 'Weekday');
        }
    };

    // Helper to parse Master Schedule content (string or ArrayBuffer)
    const parseMasterContent = (content: string | ArrayBuffer): Record<string, Requirement[]> => {
        if (typeof content === 'string') {
            return parseScheduleMaster(content);
        } else {
            const tables = parseMasterSchedule(content);
            return convertMasterRouteTablesToRequirements(tables);
        }
    };

    const handleCancelOptimization = () => {
        abortControllerRef.current?.abort();
        setIsAnimating(false);
        setOptimizationMode(null);
        setOptimizationPhase('');
        abortControllerRef.current = null;
        toast.info('Optimization cancelled');
    };

    const handleRegenerate = async () => {
        if (shifts.length > 0) {
            if (!confirm('This will replace your current schedule with a brand new one generated from scratch. All custom changes will be lost. Continue?')) {
                return;
            }
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setOptimizationMode('full');
        setIsAnimating(true);
        setOptimizationPhase('Connecting...');

        try {
            setOptimizationPhase('Generating schedule...');
            const result = await optimizeScheduleWithGemini(requirements, 'full', [], undefined, controller.signal);

            if (controller.signal.aborted) return;

            setOptimizationPhase('Processing results...');

            if (result.warning) {
                toast.warning('Used fallback scheduler', result.warning);
            }

            if (result.shifts.length > 0) {
                const taggedShifts = normalizeOnDemandShifts(
                    result.shifts.map(s => ({ ...s, dayType: selectedDayType })),
                    selectedDayType
                );

                setShifts(taggedShifts);
                setAllShifts(prev => {
                    const others = prev.filter(s => (s.dayType || 'Weekday') !== selectedDayType);
                    return [...others, ...taggedShifts];
                });
                setIsOptimized(true);

                if (result.source === 'ai') {
                    toast.success('Schedule generated', `AI optimization completed in ${Math.round(result.durationMs / 1000)}s`);
                }
            } else {
                console.warn("Optimization returned no shifts.");
                toast.error('Generation failed', 'No shifts were returned');
            }
        } catch (e) {
            console.error("Optimization error", e);
            toast.error('Generation failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsAnimating(false);
            setOptimizationMode(null);
            setOptimizationPhase('');
            abortControllerRef.current = null;
        }
    };

    // Focus Text
    const [focusInstruction, setFocusInstruction] = useState('');
    const [showFocusPrompt, setShowFocusPrompt] = useState(false);

    const handleRefineClick = () => {
        setShowFocusPrompt(true);
    };

    const handleStartOptimization = async (instruction: string) => {
        setShowFocusPrompt(false);
        setFocusInstruction(instruction);

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setOptimizationMode('refine');
        setIsAnimating(true);
        setOptimizationPhase('Connecting...');

        try {
            setOptimizationPhase('Optimizing...');
            const result = await optimizeScheduleWithGemini(requirements, 'refine', shifts, instruction, controller.signal);

            if (controller.signal.aborted) return;

            setOptimizationPhase('Processing results...');

            if (result.warning) {
                toast.warning('Used fallback scheduler', result.warning);
            }

            if (result.shifts.length > 0) {
                setReviewModalData({
                    current: shifts,
                    optimized: result.shifts
                });

                if (result.source === 'ai') {
                    toast.success('Refinement complete', `AI optimization completed in ${Math.round(result.durationMs / 1000)}s`);
                }
            } else {
                toast.error('No refinements found', 'The optimizer returned no changes');
            }
        } catch (e) {
            console.error("Refinement error", e);
            toast.error('Refinement failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsAnimating(false);
            setOptimizationMode(null);
            setOptimizationPhase('');
            abortControllerRef.current = null;
        }
    };

    const applyRefinements = (finalShifts: Shift[]) => {
        const taggedShifts = normalizeOnDemandShifts(
            finalShifts.map(s => ({ ...s, dayType: selectedDayType })),
            selectedDayType
        );

        setShifts(taggedShifts);

        setAllShifts(prev => {
            const others = prev.filter(s => (s.dayType || 'Weekday') !== selectedDayType);
            return [...others, ...taggedShifts];
        });

        setReviewModalData(null);
        setIsOptimized(true);
    };

    const handleShiftUpdate = (updatedShift: Shift) => {
        setShifts(prev => updateShiftInDay(prev, updatedShift, selectedDayType));
        setAllShifts(prev => updateShiftInDay(prev, updatedShift, selectedDayType));
    };

    const handleDayTypeChange = (dayType: string) => {
        if (schedules && schedules[dayType]) {
            const validDayType = toValidDayType(dayType);
            setSelectedDayType(validDayType);
            setRequirements(schedules[dayType]);

            // Filter shifts - only show shifts that explicitly match this day type
            // Shifts without dayType are assigned to 'Weekday' by default
            setShifts(filterShiftsByDay(allShifts, validDayType));
        }
    };

    const handleDeleteShift = (id: string) => {
        setShifts(prev => removeShiftFromDay(prev, id, selectedDayType));
        setAllShifts(prev => removeShiftFromDay(prev, id, selectedDayType));
    };

    const handleAddShift = (zone: ZoneFilterType = 'All') => {
        // Determine start zone based on filter or default to Floater
        let startZone = Zone.FLOATER;
        if (zone === 'North') startZone = Zone.NORTH;
        if (zone === 'South') startZone = Zone.SOUTH;

        // Auto-increment Name Logic
        // 1. Filter existing shifts matching the zone
        // 2. Extract numbers from names like "{Zone} {N}"
        // 3. Find max and increment
        const zoneName = startZone; // "North", "South", "Floater"
        const existingNames = shifts
            .filter(s => s.zone === startZone)
            .map(s => s.driverName);

        let maxNum = 0;
        const regex = new RegExp(`^${zoneName}\\s+(\\d+)$`, 'i');

        existingNames.forEach(name => {
            const match = name.match(regex);
            if (match) {
                const num = parseInt(match[1], 10);
                if (!isNaN(num) && num > maxNum) {
                    maxNum = num;
                }
            }
        });

        const newName = `${zoneName} ${maxNum + 1}`;

        // Default shift: 8am - 4pm
        // Default shift: 8am - 4pm
        const newShift: Shift = {
            id: createScopedShiftId(selectedDayType),
            driverName: newName,
            zone: startZone,
            startSlot: 32, // 08:00
            endSlot: 32 + SHIFT_DURATION_SLOTS,
            breakStartSlot: 32 + 16, // Break after 4 hours
            breakDurationSlots: BREAK_DURATION_SLOTS,
            dayType: selectedDayType
        };
        setShifts(prev => [...prev, newShift]);
        setAllShifts(prev => [...prev, newShift]);
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

        // Capture current files before clearing (fix race condition)
        const filesToProcess = { ...uploadedFiles };
        setUploadedFiles({ master: null, rideco: null });

        try {
            // Helper to read file
            const readFile = async (file: File | null): Promise<string | ArrayBuffer | null> => {
                if (!file) return null;
                if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                    return await file.arrayBuffer();
                }
                return await file.text();
            };

            const masterContent = await readFile(filesToProcess.master);
            const ridecoContent = await readFile(filesToProcess.rideco);
            let dayForShiftFiltering = selectedDayType;

            setCachedFiles({ master: masterContent, rideco: ridecoContent });

            if (masterContent) {
                const newSchedules = parseMasterContent(masterContent);
                setSchedules(newSchedules);

                const defaultDayKey = newSchedules['Weekday'] ? 'Weekday' : Object.keys(newSchedules)[0];
                if (defaultDayKey) {
                    const validDay = toValidDayType(defaultDayKey);
                    dayForShiftFiltering = validDay;
                    setSelectedDayType(validDay);
                    setRequirements(newSchedules[defaultDayKey]);
                }
            }

            if (ridecoContent) {
                const newShifts = parseRideCoContent(ridecoContent);

                if (newShifts.length > 0) {
                    setAllShifts(newShifts);
                    setShifts(filterShiftsByDay(newShifts, dayForShiftFiltering));
                }
            }
        } catch (e) {
            console.error(e);
            alert('Error processing files.');
        } finally {
            setIsAnimating(false);
        }
    };

    // Reset to original uploaded files
    const handleResetToUpload = async () => {
        if (!cachedFiles.rideco && !cachedFiles.master) return;

        setIsAnimating(true);
        try {
            let dayForShiftFiltering = selectedDayType;
            if (cachedFiles.master) {
                const newSchedules = parseMasterContent(cachedFiles.master);
                setSchedules(newSchedules);
                const defaultDayKey = newSchedules['Weekday'] ? 'Weekday' : Object.keys(newSchedules)[0];
                if (defaultDayKey) {
                    const validDay = toValidDayType(defaultDayKey);
                    dayForShiftFiltering = validDay;
                    setSelectedDayType(validDay);
                    setRequirements(newSchedules[defaultDayKey]);
                }
            }
            if (cachedFiles.rideco) {
                const newShifts = parseRideCoContent(cachedFiles.rideco);

                if (newShifts.length > 0) {
                    setAllShifts(newShifts);
                    setShifts(filterShiftsByDay(newShifts, dayForShiftFiltering));
                }
            }
            setIsOptimized(false);
        } catch (e) {
            console.error('Reset failed:', e);
        } finally {
            setIsAnimating(false);
        }
    };

    // Auto-process when both files are uploaded
    // Note: We use a ref to avoid stale closure issues with processFiles
    const processFilesRef = React.useRef(processFiles);
    processFilesRef.current = processFiles;

    // Track if we have pending files to process (uploaded during animation)
    const pendingProcessRef = React.useRef(false);

    React.useEffect(() => {
        if (uploadedFiles.master && uploadedFiles.rideco) {
            if (!isAnimating) {
                processFilesRef.current();
                pendingProcessRef.current = false;
            } else {
                // Mark as pending if currently animating
                pendingProcessRef.current = true;
            }
        }
    }, [uploadedFiles.master, uploadedFiles.rideco]);

    // Process pending files when animation ends
    React.useEffect(() => {
        if (!isAnimating && pendingProcessRef.current && uploadedFiles.master && uploadedFiles.rideco) {
            processFilesRef.current();
            pendingProcessRef.current = false;
        }
    }, [isAnimating, uploadedFiles.master, uploadedFiles.rideco]);

    // Get the shift being edited (with safety check to prevent crashes)
    const shiftToEdit = editingShiftId ? shifts.find(s => s.id === editingShiftId) : null;

    // Clear editing state if the shift was deleted while modal was pending
    React.useEffect(() => {
        if (editingShiftId && !shiftToEdit) {
            console.warn('Shift being edited was deleted, closing modal');
            setEditingShiftId(null);
        }
    }, [editingShiftId, shiftToEdit]);

    // Auto-load default schedule once auth/default id is available
    React.useEffect(() => {
        if (!user || !defaultScheduleId) return;
        let cancelled = false;
        (async () => {
            try {
                const schedule = await getSchedule(user.uid, defaultScheduleId);
                if (cancelled) return;
                if (schedule) {
                    handleScheduleSelectRef.current(schedule);
                } else {
                    // Schedule was deleted — clear preference
                    localStorage.removeItem('od-default-schedule-id');
                    setDefaultScheduleId(null);
                }
            } catch (err) {
                console.warn('Failed to auto-load default schedule:', err);
                // Don't clear preference on network error — retry next visit
            }
        })();
        return () => { cancelled = true; };
    }, [user, defaultScheduleId]);

    const handleSetDefaultSchedule = (id: string | null) => {
        if (id) {
            localStorage.setItem('od-default-schedule-id', id);
        } else {
            localStorage.removeItem('od-default-schedule-id');
        }
        setDefaultScheduleId(id);
    };

    // Handle loading a file from cloud storage
    const handleCloudFileSelect = async (file: SavedFile) => {
        console.log('Loading file from cloud:', file.name, 'Type:', file.type);
        setIsLoadingFromCloud(true);
        try {
            const lowerName = file.name.toLowerCase();
            const isExcelFile = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
            const content = isExcelFile
                ? await downloadFileArrayBuffer(file.downloadUrl)
                : await downloadFileContent(file.downloadUrl);
            console.log('Downloaded content length:', typeof content === 'string' ? content.length : content.byteLength);

            // Determine file type - if 'other', try to detect from filename
            let fileType = file.type;
            if (fileType === 'other' || fileType === 'barrie_tod') {
                if (lowerName.includes('rideco') || lowerName.includes('shift') || lowerName.includes('template')) {
                    fileType = 'rideco';
                } else if (lowerName.includes('master') || lowerName.includes('schedule')) {
                    fileType = 'schedule_master';
                }
            }

            if (fileType === 'schedule_master') {
                // Parse as master schedule
                console.log('Parsing as Master Schedule...');
                setCachedFiles(prev => ({ ...prev, master: content }));
                const newSchedules = parseMasterContent(content);
                console.log('Parsed schedules:', Object.keys(newSchedules));
                setSchedules(newSchedules);
                setLoadedCloudFiles(prev => ({ ...prev, master: file }));

                const defaultDayKey = newSchedules['Weekday'] ? 'Weekday' : Object.keys(newSchedules)[0];
                if (defaultDayKey) {
                    setSelectedDayType(toValidDayType(defaultDayKey));
                    setRequirements(newSchedules[defaultDayKey]);
                }
            } else if (fileType === 'rideco') {
                // Parse as RideCo shifts
                console.log('Parsing as RideCo shifts...');
                setCachedFiles(prev => ({ ...prev, rideco: content }));
                const newShifts = parseRideCoContent(content);
                console.log('Parsed shifts count:', newShifts.length);
                if (newShifts.length > 0) {
                    setAllShifts(newShifts);
                    setLoadedCloudFiles(prev => ({ ...prev, rideco: file }));
                    const currentDay = selectedDayType || 'Weekday';
                    setShifts(filterShiftsByDay(newShifts, currentDay));
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
        const normalizedShiftData = schedule.shiftData
            ? normalizeOnDemandShifts(schedule.shiftData, 'Weekday')
            : [];

        // Restore the workspace state from the saved schedule
        if (normalizedShiftData.length > 0) {
            setAllShifts(normalizedShiftData);
        }

        // Restore multi-day schedules if available
        if (schedule.schedulesData) {
            setSchedules(schedule.schedulesData);

            // Smartly select the day to show
            // If currently selected day is available in the loaded schedule, keep it
            // Otherwise default to Weekday or first available
            const availableDays = Object.keys(schedule.schedulesData);
            let dayToSelectKey: string = selectedDayType;

            if (!availableDays.includes(dayToSelectKey)) {
                dayToSelectKey = availableDays.includes('Weekday') ? 'Weekday' : availableDays[0];
            }

            if (dayToSelectKey && schedule.schedulesData[dayToSelectKey]) {
                const validDay = toValidDayType(dayToSelectKey);
                setSelectedDayType(validDay);
                setRequirements(schedule.schedulesData[dayToSelectKey]);

                // Filter shifts for this day (default to Weekday if no dayType)
                if (normalizedShiftData.length > 0) {
                    setShifts(filterShiftsByDay(normalizedShiftData, validDay));
                }
            } else if (schedule.masterScheduleData) {
                // Fallback to legacy master data if no specific day matched
                setRequirements(schedule.masterScheduleData);
            }
        } else {
            // Legacy load handling (older saves without schedulesData)
            if (schedule.masterScheduleData) {
                setRequirements(schedule.masterScheduleData);
            }
            if (normalizedShiftData.length > 0) {
                setShifts(filterShiftsByDay(normalizedShiftData, selectedDayType));
            }
        }

        setDraftName(schedule.name);
        setOriginalDraftName(schedule.name);
        setCurrentDraftId(schedule.id);
        setShowFileManager(false);
    };
    handleScheduleSelectRef.current = handleScheduleSelect;

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
                description: `${allShifts.length} shifts, Active Day: ${selectedDayType}`,
                status: 'draft' as const,
                shiftData: allShifts, // Save ALL shifts from all days
                masterScheduleData: requirements, // Save current view
                schedulesData: schedules || undefined, // Save all day requirements
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
        <div className="animate-in fade-in zoom-in-95 duration-500 h-full overflow-y-auto custom-scrollbar pb-24 pr-2">
            <style>{`
                @keyframes progressSlide {
                    0% { left: -33%; }
                    100% { left: 100%; }
                }
            `}</style>

            {/* File Manager Modal */}
            {showFileManager && user && (
                <FileManager
                    onClose={() => setShowFileManager(false)}
                    onSelectFile={handleCloudFileSelect}
                    onSelectSchedule={handleScheduleSelect}
                    defaultScheduleId={defaultScheduleId}
                    onSetDefaultSchedule={handleSetDefaultSchedule}
                />
            )}

            {/* Focus Prompt Modal - Step 1 of Refine */}
            {showFocusPrompt && (
                <FocusPromptModal
                    onCancel={() => setShowFocusPrompt(false)}
                    onOptimize={handleStartOptimization}
                    initialInstruction={focusInstruction}
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
            <div className="flex flex-col md:flex-row flex-wrap justify-between items-end mb-8 gap-4">
                <div className="flex-1">
                    <button
                        onClick={() => { window.location.hash = ''; }}
                        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors mb-3"
                    >
                        <ArrowLeft size={14} /> Back to Main
                    </button>
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
                        {currentDraftId && currentDraftId === defaultScheduleId && (
                            <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                                <Star size={12} className="fill-amber-500 text-amber-500" /> Default
                            </span>
                        )}
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
                                    // Export all shifts, not just the currently filtered day
                                    const csv = generateRideCoCSV(allShifts);
                                    downloadCSV(csv, `RideCo_Shifts_All_${new Date().toISOString().split('T')[0]}.csv`);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 hover:bg-white hover:shadow-sm rounded-md transition-all"
                                title={`Export all ${allShifts.length} shifts as RideCo Template`}
                            >
                                <CloudDownload size={14} className="rotate-180" />
                                Export CSV
                            </button>
                            <div className="w-px h-4 bg-gray-200"></div>
                            <button
                                onClick={async () => {
                                    await exportTODPaddlesPDF(allShifts);
                                }}
                                disabled={allShifts.length === 0}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${allShifts.length === 0
                                    ? 'text-gray-300 cursor-not-allowed'
                                    : 'text-gray-500 hover:text-gray-900 hover:bg-white hover:shadow-sm'
                                    }`}
                                title={`Export ${allShifts.length} paddles as PDF`}
                            >
                                <CloudDownload size={14} />
                                Paddles PDF
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
                            {['Weekday', 'Saturday', 'Sunday'].filter(day => schedules[day]).map(day => (
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
                            {/* Reset to Upload - Only if we have cached files */}
                            {(cachedFiles.rideco || cachedFiles.master) && (
                                <button
                                    onClick={handleResetToUpload}
                                    disabled={isAnimating}
                                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 hover:text-gray-700 active:scale-95 transition-all"
                                    title="Reset to uploaded files"
                                >
                                    <RotateCcw size={18} />
                                </button>
                            )}

                            {/* Refine Button - Primary Action */}
                            <button
                                onClick={handleRefineClick}
                                disabled={isAnimating || shifts.length === 0}
                                className={`
                                flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-white shadow-md hover:shadow-lg active:scale-95 whitespace-nowrap
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
                                    <>
                                        <Sparkles className="animate-spin text-white" size={18} />
                                        <span>Processing... (may take a few mins)</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={18} />
                                        <span>Refine</span>
                                    </>
                                )}
                            </button>

                            {/* Regenerate Button - Distinct but Secondary */}
                            <button
                                onClick={handleRegenerate}
                                disabled={isAnimating}
                                className={`
                                flex items-center gap-2 px-5 py-2 rounded-xl font-bold shadow-sm border active:scale-95 whitespace-nowrap
                                ${isAnimating && optimizationMode === 'full'
                                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-wait'
                                        : 'bg-green-500 text-white border-green-600 hover:bg-green-600 hover:border-green-700'
                                    }
                                transition-all duration-200
                            `}
                                title="Generate fresh schedule"
                            >
                                {isAnimating && optimizationMode === 'full' ? (
                                    <>
                                        <Loader2 className="animate-spin" size={18} />
                                        <span>Generating... (may take a few mins)</span>
                                    </>
                                ) : (
                                    <>
                                        <Wand2 size={18} />
                                        <span>Regenerate</span>
                                    </>
                                )}
                            </button>
                        </div>


                        {/* Progress bar when optimizing */}
                        {isAnimating && (
                            <div className="w-full max-w-md space-y-1.5">
                                <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
                                    <div className="flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>{optimizationPhase || (optimizationMode === 'full' ? 'Generating schedule...' : 'Refining schedule...')}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="tabular-nums text-gray-400">
                                            {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                                        </span>
                                        <button
                                            onClick={handleCancelOptimization}
                                            className="flex items-center gap-1 text-red-500 hover:text-red-700 font-bold transition-colors"
                                            title="Cancel optimization"
                                        >
                                            <X size={12} />
                                            <span>Cancel</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden relative">
                                    <div
                                        className="absolute h-full w-1/3 rounded-full"
                                        style={{
                                            background: optimizationMode === 'full'
                                                ? 'linear-gradient(90deg, #22c55e, #4ade80, #22c55e)'
                                                : 'linear-gradient(90deg, #6366f1, #818cf8, #6366f1)',
                                            animation: 'progressSlide 1.5s ease-in-out infinite',
                                        }}
                                    />
                                </div>
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
                            <FileUpload
                                onFileUpload={handleFileUpload}
                                title="Drop Schedule Files Here"
                                subtitle="Supports Master Schedule (.xlsx) & RideCo/MVT (.csv)"
                                accept=".xlsx, .csv"
                                allowMultiple={true}
                            />
                        </div>
                        <div className="lg:col-span-1">
                            <div className="bg-white p-6 rounded-3xl border-2 border-gray-200 h-full">
                                <h3 className="text-xl font-extrabold text-gray-700 mb-4">Quick Summary</h3>
                                <div className="space-y-3">
                                    {/* Actual Zone Counts */}
                                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border-2 border-blue-100">
                                        <span className="font-bold text-gray-600">North Zone</span>
                                        <span className="font-extrabold text-brand-blue">
                                            {shifts.filter(s => s.zone === Zone.NORTH).length} Drivers
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-xl border-2 border-green-100">
                                        <span className="font-bold text-gray-600">South Zone</span>
                                        <span className="font-extrabold text-brand-green">
                                            {shifts.filter(s => s.zone === Zone.SOUTH).length} Drivers
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-purple-50 rounded-xl border-2 border-purple-100">
                                        <span className="font-bold text-gray-600">Floaters</span>
                                        <span className="font-extrabold text-purple-600">
                                            {shifts.filter(s => s.zone === Zone.FLOATER).length} Drivers
                                        </span>
                                    </div>

                                    {/* Total Hours */}
                                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border-2 border-gray-200 mt-2">
                                        <span className="font-bold text-gray-600">Total Shift Hours</span>
                                        <span className="font-extrabold text-gray-800">
                                            {Math.round(shifts.reduce((sum, s) => sum + (s.endSlot - s.startSlot) / 4, 0))}h
                                        </span>
                                    </div>

                                    {/* Coverage Status */}
                                    <div className={`flex justify-between items-center p-3 rounded-xl border-2 mt-2 ${metrics.coveragePercent >= 100 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                                        <span className="font-bold text-gray-600">Coverage</span>
                                        <span className={`font-extrabold ${metrics.coveragePercent >= 100 ? 'text-green-600' : 'text-amber-600'}`}>
                                            {Math.round(metrics.coveragePercent)}%
                                        </span>
                                    </div>
                                </div>

                                {/* Status Message */}
                                <div className={`mt-4 p-3 rounded-xl border-2 ${isOptimized ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-200'}`}>
                                    <p className={`text-sm font-bold ${isOptimized ? 'text-purple-600' : 'text-gray-500'}`}>
                                        {isOptimized ? '✨ AI Optimized' : shifts.length === 0 ? 'No shifts loaded' : 'Ready for optimization'}
                                    </p>
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
                        onAddShift={() => handleAddShift(zoneFilter)}
                        onEditShift={(id) => {
                            console.log('OnDemandWorkspace received edit request for:', id);
                            setEditingShiftId(id);
                        }}
                        // Pass Synced Filter State
                        zoneFilter={zoneFilter}
                        onZoneFilterChange={setZoneFilter}
                        metrics={metrics}
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
