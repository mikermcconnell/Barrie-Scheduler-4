
import React, { useState, useEffect } from 'react';
import {
    Settings2,
    CalendarPlus,
    Timer,
    BarChart2,
    ArrowRight,
    ArrowLeft,
    Minimize2,
    Maximize2
} from 'lucide-react';

import { parseMasterScheduleV2 } from '../utils/masterScheduleParserV2';
import { adaptV2ToV1 } from '../utils/parserAdapter';
import { MasterRouteTable } from '../utils/masterScheduleParser';
import { OTPAnalysis } from './OTPAnalysis';
import { useAuth } from './AuthContext';
import { getAllFiles, uploadFile, downloadFileArrayBuffer, SavedFile, getAllDrafts, getDraft, ScheduleDraft, deleteFile } from '../utils/dataService';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useAutoSave } from '../hooks/useAutoSave';

import { ScheduleDashboard } from './ScheduleDashboard';
import { ScheduleEditor } from './ScheduleEditor';
import { DraftManagerModal } from './DraftManagerModal';

// --- Placeholder Components (kept from original) ---
const NewSchedule: React.FC = () => (
    <div className="flex flex-col items-center justify-center h-96 space-y-6 animate-in fade-in duration-500">
        <div className="bg-blue-50 p-8 rounded-full"><CalendarPlus size={64} className="text-brand-blue" /></div>
        <div className="text-center space-y-2">
            <h3 className="text-2xl font-extrabold text-gray-800">New Schedule Builder</h3>
            <p className="text-gray-500 font-bold max-w-md">Create brand new schedules from scratch using AI-assisted block generation.</p>
            <div className="inline-block bg-gray-100 text-gray-500 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider mt-4">Coming Soon</div>
        </div>
    </div>
);

const DwellAssessment: React.FC = () => (
    <div className="flex flex-col items-center justify-center h-96 space-y-6 animate-in fade-in duration-500">
        <div className="bg-orange-50 p-8 rounded-full"><Timer size={64} className="text-orange-500" /></div>
        <div className="text-center space-y-2">
            <h3 className="text-2xl font-extrabold text-gray-800">Dwell Time Analysis</h3>
            <p className="text-gray-500 font-bold max-w-md">Analyze stop-level dwell times to optimize schedule padding and improve on-time performance.</p>
            <div className="inline-block bg-gray-100 text-gray-500 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider mt-4">Coming Soon</div>
        </div>
    </div>
);

export const FixedRouteWorkspace: React.FC = () => {
    const { user } = useAuth();
    const [viewMode, setViewMode] = useState<'dashboard' | 'schedule' | 'new-schedule' | 'dwell' | 'otp'>('dashboard');

    // --- State ---
    const {
        state: schedules,
        set: setSchedules,
        undo, redo, canUndo, canRedo,
        reset: resetSchedules
    } = useUndoRedo<MasterRouteTable[]>([], { maxHistory: 50 });

    const [originalSchedules, setOriginalSchedules] = useState<MasterRouteTable[]>([]);
    const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
    const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
    const [draftName, setDraftName] = useState<string>('Untitled Draft');
    const [isProcessing, setIsProcessing] = useState(false);
    const [successToast, setSuccessToast] = useState<{ message: string; visible: boolean } | null>(null);
    const [showDraftManager, setShowDraftManager] = useState(false);

    // --- Auto Save ---
    const {
        status: autoSaveStatus,
        lastSaved,
        setData: setAutoSaveData,
        saveVersion,
    } = useAutoSave({
        userId: user?.uid || null,
        debounceMs: 10000,
        enabled: true
    });

    useEffect(() => {
        if (schedules.length > 0) {
            setAutoSaveData(schedules, originalSchedules, draftName);
        }
    }, [schedules, originalSchedules, draftName, setAutoSaveData]);

    const showSuccessToastImpl = (message: string) => {
        setSuccessToast({ message, visible: true });
        setTimeout(() => setSuccessToast(null), 4000);
    };

    // --- Load Data ---
    const loadSavedFiles = async () => {
        if (!user) return;
        try {
            const files = await getAllFiles(user.uid);
            setSavedFiles(files.filter(f => f.type === 'schedule_master'));
        } catch (error) {
            console.error("Failed to load saved files:", error);
        }
    };

    const loadDrafts = async () => {
        if (user) {
            getAllDrafts(user.uid).then(setDrafts).catch(console.error);
        }
    };

    const handleDeleteFile = async (file: SavedFile) => {
        if (!user) return;
        try {
            await deleteFile(user.uid, file.id, file.storagePath);
            setSavedFiles(savedFiles.filter(f => f.id !== file.id));
            showSuccessToastImpl(`Deleted: ${file.name}`);
        } catch (error) {
            console.error('Failed to delete file:', error);
            alert('Failed to delete file. Please try again.');
        }
    };

    React.useEffect(() => {
        if (user) {
            loadSavedFiles();
            loadDrafts();
        }
    }, [user]);

    // Update draft name automatically on load if untitled
    useEffect(() => {
        if (schedules.length > 0 && draftName === 'Untitled Draft') {
            const routeName = schedules[0]?.routeName?.split(' ')[0] || 'Untitled';
            setDraftName(`Draft - Route ${routeName}`);
        }
        if (schedules.length === 0) {
            setDraftName('Untitled Draft');
        }
    }, [schedules.length]);


    // --- Handlers ---

    const handleFile = async (files: File[]) => {
        if (!files || files.length === 0) return;
        const file = files[0];
        setIsProcessing(true);
        try {
            if (user) {
                const defaultName = file.name.replace('.xlsx', '');
                const name = window.prompt("Enter a name for this Master Schedule:", defaultName);
                if (name) {
                    const renamedFile = new File([file], name + ".xlsx", { type: file.type });
                    await uploadFile(user.uid, renamedFile, 'schedule_master');
                    await loadSavedFiles();
                }
            }
            const buffer = await file.arrayBuffer();
            const v2Result = parseMasterScheduleV2(buffer);
            const tables = adaptV2ToV1(v2Result);
            resetSchedules(tables);
            setOriginalSchedules(tables);
        } catch (err) {
            console.error(err);
            alert("Failed to process file.");
        }
        setIsProcessing(false);
    };

    const handleLoadSavedFile = async (file: SavedFile) => {
        setIsProcessing(true);
        try {
            const buffer = await downloadFileArrayBuffer(file.downloadUrl);
            const v2Result = parseMasterScheduleV2(buffer);
            const tables = adaptV2ToV1(v2Result);
            resetSchedules(tables);
            setOriginalSchedules(tables);
        } catch (err) {
            console.error(err);
            alert("Failed to load saved file.");
        }
        setIsProcessing(false);
    };

    const handleLoadDraft = async (draft: ScheduleDraft) => {
        if (!user) return;
        try {
            const fullDraft = await getDraft(user.uid, draft.id);
            if (fullDraft && fullDraft.schedules.length > 0) {
                resetSchedules(fullDraft.schedules);
                setOriginalSchedules(fullDraft.originalSchedules || []);
                setDraftName(fullDraft.name);
                showSuccessToastImpl(`Loaded: ${fullDraft.name}`);
            }
        } catch (e) {
            console.error('Failed to load draft:', e);
        }
    };

    const handleNewDraft = () => {
        if (schedules.length > 0) {
            if (!confirm('Start a new draft? Current changes will be auto-saved.')) return;
        }
        resetSchedules([]);
        setOriginalSchedules([]);
        setDraftName('Untitled Draft');
        // Setting empty schedules will automatically trigger the Dashboard view because of the conditional render
    };

    const handleClose = () => {
        if (schedules.length > 0) {
            if (!confirm('Close schedule? Unsaved changes may be lost.')) return;
        }
        resetSchedules([]);
        setOriginalSchedules([]);
        setDraftName('Untitled Draft');
    };

    const handleRenameDraft = (name: string) => setDraftName(name);


    // --- Render Logic ---
    const renderToolContent = () => {
        switch (viewMode) {
            case 'schedule':
                if (schedules.length > 0) {
                    return (
                        <ScheduleEditor
                            schedules={schedules}
                            onSchedulesChange={setSchedules}
                            originalSchedules={originalSchedules}
                            draftName={draftName}
                            onRenameDraft={handleRenameDraft}
                            autoSaveStatus={autoSaveStatus}
                            lastSaved={lastSaved}
                            onSaveVersion={saveVersion}
                            onClose={handleClose}
                            onNewDraft={handleNewDraft}
                            onOpenDrafts={() => setShowDraftManager(true)}
                            canUndo={canUndo}
                            canRedo={canRedo}
                            undo={undo}
                            redo={redo}
                            showSuccessToast={showSuccessToastImpl}
                        />
                    );
                } else {
                    return (
                        <ScheduleDashboard
                            drafts={drafts}
                            savedFiles={savedFiles}
                            user={user}
                            isProcessing={isProcessing}
                            onLoadDraft={handleLoadDraft}
                            onLoadFile={handleLoadSavedFile}
                            onDeleteFile={handleDeleteFile}
                            onUpload={handleFile}
                            onViewNewSchedule={() => setViewMode('new-schedule')}
                        />
                    );
                }
            case 'new-schedule': return <NewSchedule />;
            case 'dwell': return <DwellAssessment />;
            case 'otp': return <OTPAnalysis />;
            default: return null;
        }
    };

    if (viewMode === 'dashboard') {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-6xl mx-auto pt-8">
                <div className="mb-8 px-4">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Fixed Route Operations</h2>
                    <p className="text-gray-500">Select a tool to manage schedules or analyze performance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
                    <button onClick={() => setViewMode('schedule')} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-blue-50/50 p-2.5 rounded-lg text-blue-600 group-hover:bg-blue-100 transition-colors"><Settings2 size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Schedule Tweaker</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Fine-tune master schedules, adjust timepoints, and manage block recovery times.</p>
                    </button>

                    <button onClick={() => setViewMode('new-schedule')} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-emerald-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-emerald-50/50 p-2.5 rounded-lg text-emerald-600 group-hover:bg-emerald-100 transition-colors"><CalendarPlus size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-emerald-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">New Schedules</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Generate optimized schedules from scratch using AI-powered run cutting.</p>
                    </button>

                    {/* Other cards omitted for brevity/duplication, assume kept or simplified */}
                    {/* Re-adding Dwell and OTP to ensure no feature regression */}
                    <button onClick={() => setViewMode('dwell')} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-amber-50/50 p-2.5 rounded-lg text-amber-600 group-hover:bg-amber-100 transition-colors"><Timer size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Dwell Assessment</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Analyze stop-level dwell times.</p>
                    </button>

                    <button onClick={() => setViewMode('otp')} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-red-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-red-50/50 p-2.5 rounded-lg text-red-600 group-hover:bg-red-100 transition-colors"><BarChart2 size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-red-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">OTP Analysis</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Monitor On-Time Performance metrics.</p>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Navigation Header */}
            <div className="flex items-center gap-4 mb-6 px-4">
                <button
                    onClick={() => setViewMode('dashboard')}
                    className="flex items-center gap-2 text-gray-400 hover:text-gray-600 font-bold transition-colors"
                >
                    <ArrowLeft size={20} /> Back to Dashboard
                </button>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                    {viewMode === 'schedule' && 'Schedule Tweaker'}
                    {viewMode === 'new-schedule' && 'New Schedules'}
                    {viewMode === 'dwell' && 'Dwell Assessment'}
                    {viewMode === 'otp' && 'OTP Assessment'}
                </div>
            </div>

            <div className={`flex-grow overflow-hidden relative ${viewMode === 'schedule' && schedules.length > 0 ? '' : 'bg-white rounded-3xl border-2 border-gray-100 shadow-sm min-h-[600px] overflow-hidden'}`}>
                <div className={`absolute inset-0 ${viewMode === 'schedule' && schedules.length > 0 ? '' : 'overflow-auto custom-scrollbar p-6'}`}>
                    {renderToolContent()}
                </div>
            </div>

            {/* Success Toast */}
            {successToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] animate-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-4 border border-emerald-500">
                        <span className="font-bold text-sm">{successToast.message}</span>
                        <button onClick={() => { undo(); setSuccessToast(null); }} disabled={!canUndo} className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-bold transition-colors disabled:opacity-50">Undo</button>
                        <button onClick={() => setSuccessToast(null)} className="text-white/70 hover:text-white p-1">×</button>
                    </div>
                </div>
            )}

            <DraftManagerModal
                isOpen={showDraftManager}
                userId={user?.uid || null}
                currentDraftId={null}
                onClose={() => setShowDraftManager(false)}
                onLoadDraft={handleLoadDraft}
                onNewDraft={handleNewDraft}
                onRestoreVersion={(restoredDraft) => {
                    resetSchedules(restoredDraft.schedules);
                    setOriginalSchedules(restoredDraft.originalSchedules || []);
                    setDraftName(restoredDraft.name);
                    showSuccessToastImpl(`Restored: ${restoredDraft.name}`);
                }}
            />
        </div>
    );
};
