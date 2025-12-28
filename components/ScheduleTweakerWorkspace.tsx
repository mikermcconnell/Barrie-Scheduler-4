import React, { useState, useEffect } from 'react';
import { MasterRouteTable } from '../utils/masterScheduleParser';
import { useAuth } from './AuthContext';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useAutoSave } from '../hooks/useAutoSave';
import { ScheduleEditor } from './ScheduleEditor';
import { DraftManagerModal } from './DraftManagerModal';
import { getAllDrafts, getDraft, ScheduleDraft, SavedFile, uploadFile, downloadFileArrayBuffer, deleteFile, getAllFiles } from '../utils/dataService';
import { parseMasterScheduleV2 } from '../utils/masterScheduleParserV2';
import { adaptV2ToV1 } from '../utils/parserAdapter';
import { Loader2 } from 'lucide-react';
import { ScheduleDashboard } from './ScheduleDashboard';

interface ScheduleTweakerWorkspaceProps {
    initialDraft?: ScheduleDraft;
    initialFile?: SavedFile;
    onClose: () => void;
}

export const ScheduleTweakerWorkspace: React.FC<ScheduleTweakerWorkspaceProps> = ({
    initialDraft,
    initialFile,
    onClose
}) => {
    const { user } = useAuth();

    // --- State ---
    const {
        state: schedules,
        set: setSchedules,
        undo, redo, canUndo, canRedo,
        reset: resetSchedules
    } = useUndoRedo<MasterRouteTable[]>([], { maxHistory: 50 });

    const [originalSchedules, setOriginalSchedules] = useState<MasterRouteTable[]>([]);
    const [draftName, setDraftName] = useState<string>('Untitled Draft');
    const [successToast, setSuccessToast] = useState<{ message: string; visible: boolean } | null>(null);
    const [showDraftManager, setShowDraftManager] = useState(false);

    // Additional state for internal dashboard (if started empty)
    const [internalViewMode, setInternalViewMode] = useState<'editor' | 'dashboard'>('dashboard');
    const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
    const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // --- Init Effect ---
    useEffect(() => {
        const init = async () => {
            if (initialDraft) {
                await handleLoadDraft(initialDraft);
            } else if (initialFile) {
                // If passed a file, we load it immediately
                await handleLoadSavedFile(initialFile);
            } else {
                // Start empty -> show internal dashboard
                setInternalViewMode('dashboard');
                if (user) {
                    loadSavedFiles();
                    loadDrafts();
                }
            }
        };
        init();
    }, [initialDraft, initialFile, user]);

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

    // --- Data Loading Helpers ---
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
            setInternalViewMode('editor');
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
            setInternalViewMode('editor');
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
                setInternalViewMode('editor');
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
        // If we are in "editor" mode with empty schedules, Render Logic will handle it, or we can go back to dashboard
        // Ideally "New Draft" creates a blank slate in the editor? 
        // Or goes back to file picking?
        // Let's assume it clears state.
    };

    const handleCloseInternal = () => {
        if (schedules.length > 0) {
            if (!confirm('Close schedule? Unsaved changes may be lost.')) return;
        }
        // If we were passed an initial draft/file, closing might mean leaving the component entirely
        // But for safe UX, let's just go back to internal dashboard?
        // Or if the PROP onClose is provided, call that?
        onClose();
    };

    const handleRenameDraft = (name: string) => setDraftName(name);

    // Update draft name automatically
    useEffect(() => {
        if (schedules.length > 0 && draftName === 'Untitled Draft') {
            const routeName = schedules[0]?.routeName?.split(' ')[0] || 'Untitled';
            setDraftName(`Draft - Route ${routeName}`);
        }
    }, [schedules.length]);

    // --- Render ---

    if (internalViewMode === 'dashboard') {
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
                onViewNewSchedule={() => onClose()} // "New Schedule" from here just exits Tweaker to let parent handle it
            />
        );
    }

    return (
        <div className="h-full flex flex-col relative">
            <ScheduleEditor
                schedules={schedules}
                onSchedulesChange={setSchedules}
                originalSchedules={originalSchedules}
                draftName={draftName}
                onRenameDraft={handleRenameDraft}
                autoSaveStatus={autoSaveStatus}
                lastSaved={lastSaved}
                onSaveVersion={saveVersion}
                onClose={handleCloseInternal}
                onNewDraft={handleNewDraft}
                onOpenDrafts={() => setShowDraftManager(true)}
                canUndo={canUndo}
                canRedo={canRedo}
                undo={undo}
                redo={redo}
                showSuccessToast={showSuccessToastImpl}
            />

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
                currentDraftId={null} // We could track this if needed
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
