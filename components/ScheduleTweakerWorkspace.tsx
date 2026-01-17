import React, { useState, useEffect, useRef } from 'react';
import { MasterRouteTable, InterlineConfig } from '../utils/masterScheduleParser';
import { useAuth } from './AuthContext';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useAutoSave } from '../hooks/useAutoSave';
import { ScheduleEditor } from './ScheduleEditor';
import { DraftManagerModal } from './DraftManagerModal';
import { getAllDrafts, getDraft, ScheduleDraft, SavedFile, uploadFile, downloadFileArrayBuffer, deleteFile, getAllFiles } from '../utils/dataService';
import { parseMasterScheduleV2 } from '../utils/masterScheduleParserV2';
import { adaptV2ToV1 } from '../utils/parserAdapter';
import { ScheduleDashboard } from './ScheduleDashboard';
import { useToast } from './ToastContext';
import { migrateLegacyUserData } from '../utils/legacyDraftMigration';

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
    const toast = useToast();

    // --- State ---
    const {
        state: schedules,
        set: setSchedules,
        undo, redo, canUndo, canRedo,
        reset: resetSchedules,
        historyState
    } = useUndoRedo<MasterRouteTable[]>([], { maxHistory: 50 });

    const [originalSchedules, setOriginalSchedules] = useState<MasterRouteTable[]>([]);
    const [interlineConfig, setInterlineConfig] = useState<InterlineConfig>({ rules: [] });
    const [draftName, setDraftName] = useState<string>('Untitled Draft');
    const [successToast, setSuccessToast] = useState<{ message: string; visible: boolean; undoCount: number } | null>(null);
    const [showDraftManager, setShowDraftManager] = useState(false);

    // Additional state for internal dashboard (if started empty)
    const [internalViewMode, setInternalViewMode] = useState<'editor' | 'dashboard'>('dashboard');
    const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
    const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isMigratingLegacy, setIsMigratingLegacy] = useState(false);

    // Ref to track mounted state for async cleanup
    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

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
                if (!isMountedRef.current) return;
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
            setAutoSaveData(schedules, originalSchedules, draftName, interlineConfig);
        }
    }, [schedules, originalSchedules, draftName, interlineConfig, setAutoSaveData]);

    const showSuccessToastImpl = (message: string) => {
        // Capture current undo count so toast undo button knows if it's still relevant
        setSuccessToast({ message, visible: true, undoCount: historyState.past.length });
        setTimeout(() => setSuccessToast(null), 4000);
    };

    // --- Data Loading Helpers ---
    const loadSavedFiles = async () => {
        if (!user) return;
        try {
            const files = await getAllFiles(user.uid);
            if (!isMountedRef.current) return;
            setSavedFiles(files.filter(f => f.type === 'schedule_master'));
        } catch (error) {
            console.error("Failed to load saved files:", error);
        }
    };

    const loadDrafts = async () => {
        if (!user) return;
        try {
            const loadedDrafts = await getAllDrafts(user.uid);
            if (!isMountedRef.current) return;
            setDrafts(loadedDrafts);
        } catch (error) {
            console.error("Failed to load drafts:", error);
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
    const handleMigrateLegacy = async () => {
        if (!user) {
            toast?.warning('Sign In Required', 'Sign in to migrate legacy drafts.');
            return;
        }
        if (isMigratingLegacy) return;
        setIsMigratingLegacy(true);

        try {
            const summary = await migrateLegacyUserData(user.uid);
            const migratedLabel = `${summary.migrated} draft${summary.migrated === 1 ? '' : 's'} migrated`;
            const skippedLabel = `${summary.skipped} skipped`;

            if (summary.errors.length > 0) {
                console.error('Legacy migration errors:', summary.errors);
                toast?.warning('Migration Completed', `${migratedLabel}, ${skippedLabel}, ${summary.errors.length} error(s)`);
            } else {
                toast?.success('Migration Completed', `${migratedLabel}, ${skippedLabel}`);
            }

            if (summary.migrated > 0) {
                await loadDrafts();
            }
        } catch (error) {
            console.error('Legacy migration failed:', error);
            toast?.error('Migration Failed', 'Unable to migrate legacy drafts');
        } finally {
            if (isMountedRef.current) setIsMigratingLegacy(false);
        }
    };

    const handleFile = async (files: File[]) => {
        if (!files || files.length === 0) return;
        if (isProcessing) return; // Prevent concurrent loads
        const file = files[0];
        setIsProcessing(true);
        try {
            // If user is logged in, prompt for name and save to cloud
            if (user) {
                const defaultName = file.name.replace('.xlsx', '');
                const name = window.prompt("Enter a name for this Master Schedule:", defaultName);
                if (!name) {
                    // User cancelled - don't process the file
                    setIsProcessing(false);
                    return;
                }
                const renamedFile = new File([file], name + ".xlsx", { type: file.type });
                await uploadFile(user.uid, renamedFile, 'schedule_master');
                if (!isMountedRef.current) return;
                await loadSavedFiles();
            }
            if (!isMountedRef.current) return;
            const buffer = await file.arrayBuffer();
            const v2Result = parseMasterScheduleV2(buffer);
            const tables = adaptV2ToV1(v2Result);
            resetSchedules(tables);
            setOriginalSchedules(tables);
            setInternalViewMode('editor');
        } catch (err) {
            console.error(err);
            if (isMountedRef.current) alert("Failed to process file.");
        }
        if (isMountedRef.current) setIsProcessing(false);
    };

    const handleLoadSavedFile = async (file: SavedFile) => {
        if (isProcessing) return; // Prevent concurrent loads
        setIsProcessing(true);
        try {
            const buffer = await downloadFileArrayBuffer(file.downloadUrl);
            if (!isMountedRef.current) return;
            const v2Result = parseMasterScheduleV2(buffer);
            const tables = adaptV2ToV1(v2Result);
            resetSchedules(tables);
            setOriginalSchedules(tables);
            setInternalViewMode('editor');
        } catch (err) {
            console.error(err);
            if (isMountedRef.current) alert("Failed to load saved file.");
        }
        if (isMountedRef.current) setIsProcessing(false);
    };

    const handleLoadDraft = async (draft: ScheduleDraft) => {
        try {
            // If draft already has schedules loaded (e.g., from Master Schedule Browser), use directly
            if (draft.schedules && draft.schedules.length > 0) {
                resetSchedules(draft.schedules);
                setOriginalSchedules(draft.originalSchedules || draft.schedules);
                setInterlineConfig(draft.interlineConfig || { rules: [] });
                setDraftName(draft.name);
                showSuccessToastImpl(`Loaded: ${draft.name}`);
                setInternalViewMode('editor');
                return;
            }

            // Otherwise, fetch from Firestore
            if (!user) return;
            if (isProcessing) return; // Prevent concurrent loads
            setIsProcessing(true);
            const fullDraft = await getDraft(user.uid, draft.id);
            if (!isMountedRef.current) return;
            if (fullDraft && fullDraft.schedules.length > 0) {
                resetSchedules(fullDraft.schedules);
                setOriginalSchedules(fullDraft.originalSchedules || []);
                setInterlineConfig(fullDraft.interlineConfig || { rules: [] });
                setDraftName(fullDraft.name);
                showSuccessToastImpl(`Loaded: ${fullDraft.name}`);
                setInternalViewMode('editor');
            } else if (fullDraft) {
                alert('This draft appears to be empty or corrupted.');
            } else {
                alert('Draft not found.');
            }
        } catch (e) {
            console.error('Failed to load draft:', e);
            if (isMountedRef.current) alert('Failed to load draft. Please try again.');
        } finally {
            if (isMountedRef.current) setIsProcessing(false);
        }
    };

    const handleNewDraft = () => {
        if (schedules.length > 0) {
            if (!confirm('Start a new draft? Current changes will be auto-saved.')) return;
        }
        resetSchedules([]);
        setOriginalSchedules([]);
        setDraftName('Untitled Draft');
        setInternalViewMode('dashboard');
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

    // Update draft name automatically when schedules first load
    const firstRouteName = schedules[0]?.routeName?.split(' ')[0];
    useEffect(() => {
        if (schedules.length > 0 && draftName === 'Untitled Draft' && firstRouteName) {
            setDraftName(`Draft - Route ${firstRouteName}`);
        }
    }, [schedules.length, draftName, firstRouteName]);

    // --- Render ---

    if (internalViewMode === 'dashboard') {
        return (
            <ScheduleDashboard
                drafts={drafts}
                savedFiles={savedFiles}
                user={user}
                isProcessing={isProcessing}
                isMigratingLegacy={isMigratingLegacy}
                onLoadDraft={handleLoadDraft}
                onLoadFile={handleLoadSavedFile}
                onDeleteFile={handleDeleteFile}
                onUpload={handleFile}
                onViewNewSchedule={() => onClose()} // "New Schedule" from here just exits Tweaker to let parent handle it
                onMigrateLegacy={handleMigrateLegacy}
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
                forceSimpleView={true}
                // Interline configuration
                initialInterlineConfig={interlineConfig}
                onInterlineConfigChange={setInterlineConfig}
            />

            {/* Success Toast */}
            {successToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] animate-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-4 border border-emerald-500">
                        <span className="font-bold text-sm">{successToast.message}</span>
                        {/* Only show undo if history hasn't changed since toast was shown */}
                        {historyState.past.length === successToast.undoCount && canUndo && (
                            <button onClick={() => { undo(); setSuccessToast(null); }} className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-bold transition-colors">Undo</button>
                        )}
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
