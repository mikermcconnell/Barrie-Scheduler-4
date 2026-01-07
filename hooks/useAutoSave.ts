/**
 * useAutoSave Hook
 * 
 * Provides debounced auto-save functionality for schedule drafts.
 * - Authenticated users: saves to Firebase Firestore
 * - Guest users: saves to localStorage
 * 
 * Features:
 * - 10-second debounce after last change
 * - Status indicator (idle/saving/saved/error)
 * - Manual version save trigger
 * - Automatic draft creation on first save
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { saveDraft, saveDraftVersion, getDraft, ScheduleDraft, withRetry } from '../utils/dataService';
import type { MasterRouteTable, InterlineConfig } from '../utils/masterScheduleParser';

// localStorage keys for guest users
const GUEST_DRAFT_KEY = 'scheduleDraft_current';
const GUEST_VERSIONS_KEY = 'scheduleDraft_versions';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveOptions {
    userId?: string | null;
    debounceMs?: number;
    enabled?: boolean;
}

export interface UseAutoSaveResult {
    status: AutoSaveStatus;
    lastSaved: Date | null;
    error: string | null;
    currentDraftId: string | null;

    // Trigger functions
    triggerSave: () => Promise<void>;
    saveVersion: (label?: string) => Promise<void>;
    loadDraft: (draftId: string) => Promise<ScheduleDraft | null>;
    clearDraft: () => void;

    // Data setters (call these when state changes)
    setData: (schedules: MasterRouteTable[], originalSchedules: MasterRouteTable[], name?: string, interlineConfig?: InterlineConfig) => void;
}

interface GuestDraft {
    name: string;
    schedules: MasterRouteTable[];
    originalSchedules: MasterRouteTable[];
    interlineConfig?: InterlineConfig;
    updatedAt: string;
}

interface GuestVersion {
    id: string;
    schedules: MasterRouteTable[];
    originalSchedules: MasterRouteTable[];
    interlineConfig?: InterlineConfig;
    savedAt: string;
    label?: string;
}

export const useAutoSave = (options: UseAutoSaveOptions = {}): UseAutoSaveResult => {
    const { userId = null, debounceMs = 10000, enabled = true } = options;

    const [status, setStatus] = useState<AutoSaveStatus>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);

    // Refs for debounce and data
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dataRef = useRef<{
        schedules: MasterRouteTable[];
        originalSchedules: MasterRouteTable[];
        interlineConfig?: InterlineConfig;
        name: string;
        isDirty: boolean;
        version: number;
    }>({
        schedules: [],
        originalSchedules: [],
        interlineConfig: undefined,
        name: 'Untitled Draft',
        isDirty: false,
        version: 0
    });

    // Clean up debounce timer on unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    // Save to localStorage (for guests)
    const saveToLocalStorage = useCallback(() => {
        try {
            const draft: GuestDraft = {
                name: dataRef.current.name,
                schedules: dataRef.current.schedules,
                originalSchedules: dataRef.current.originalSchedules,
                interlineConfig: dataRef.current.interlineConfig,
                updatedAt: new Date().toISOString()
            };
            localStorage.setItem(GUEST_DRAFT_KEY, JSON.stringify(draft));
            setLastSaved(new Date());
            setStatus('saved');
            setError(null);
            dataRef.current.isDirty = false;
        } catch (e) {
            console.error('localStorage save failed:', e);
            setStatus('error');
            setError('Failed to save locally');
        }
    }, []);

    // Save to Firebase (for authenticated users)
    const saveToFirebase = useCallback(async () => {
        if (!userId) return;

        try {
            const saveVersion = dataRef.current.version;
            setStatus('saving');

            const draftId = await withRetry(() => saveDraft(userId, {
                id: currentDraftId || undefined,
                name: dataRef.current.name,
                schedules: dataRef.current.schedules,
                originalSchedules: dataRef.current.originalSchedules,
                interlineConfig: dataRef.current.interlineConfig
            }));

            if (!currentDraftId) {
                setCurrentDraftId(draftId);
            }

            // prevent race condition: only update if no new changes occurred during save
            if (dataRef.current.version === saveVersion) {
                setLastSaved(new Date());
                setStatus('saved');
                setError(null);
                dataRef.current.isDirty = false;
            }
        } catch (e) {
            console.error('Firebase save failed:', e);
            setStatus('error');
            setError(e instanceof Error ? e.message : 'Failed to save');
        }
    }, [userId, currentDraftId]);

    // Main save function (chooses storage based on auth)
    const triggerSave = useCallback(async () => {
        if (!enabled || !dataRef.current.isDirty) return;

        if (userId) {
            await saveToFirebase();
        } else {
            saveToLocalStorage();
        }
    }, [enabled, userId, saveToFirebase, saveToLocalStorage]);

    // Debounced save - call this when data changes
    const scheduleSave = useCallback(() => {
        if (!enabled) return;

        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Schedule new save
        debounceTimerRef.current = setTimeout(() => {
            triggerSave();
        }, debounceMs);
    }, [enabled, debounceMs, triggerSave]);

    // Set data and trigger debounced save
    const setData = useCallback((
        schedules: MasterRouteTable[],
        originalSchedules: MasterRouteTable[],
        name?: string,
        interlineConfig?: InterlineConfig
    ) => {
        dataRef.current = {
            schedules,
            originalSchedules,
            interlineConfig: interlineConfig || dataRef.current.interlineConfig,
            name: name || dataRef.current.name,
            isDirty: true,
            version: (dataRef.current.version || 0) + 1
        };

        // Only update status to idle if we were saved or errorRed.
        // If we are currently 'saving', keep it 'saving' so UI doesn't flicker
        // (but logic in saveToFirebase will prevent setting 'saved' if version mismatch)
        setStatus(prev => (prev === 'saved' || prev === 'error') ? 'idle' : prev);
        scheduleSave();
    }, [scheduleSave]);

    // Save a named version (manual action)
    const saveVersion = useCallback(async (label?: string) => {
        if (!dataRef.current.schedules.length) return;

        if (userId) {
            // Firebase version
            try {
                setStatus('saving');

                // Ensure draft exists first - create if needed
                let draftId = currentDraftId;
                if (!draftId) {
                    draftId = await saveDraft(userId, {
                        name: dataRef.current.name,
                        schedules: dataRef.current.schedules,
                        originalSchedules: dataRef.current.originalSchedules,
                        interlineConfig: dataRef.current.interlineConfig
                    });
                    setCurrentDraftId(draftId);
                }

                await saveDraftVersion(
                    userId,
                    draftId,
                    dataRef.current.schedules,
                    dataRef.current.originalSchedules,
                    label,
                    dataRef.current.interlineConfig
                );
                setLastSaved(new Date());
                setStatus('saved');
                dataRef.current.isDirty = false;
            } catch (e) {
                console.error('Version save failed:', e);
                setStatus('error');
                setError(e instanceof Error ? e.message : 'Failed to save version');
            }
        } else {
            // localStorage version
            try {
                const versionsJson = localStorage.getItem(GUEST_VERSIONS_KEY);
                const versions: GuestVersion[] = versionsJson ? JSON.parse(versionsJson) : [];

                versions.unshift({
                    id: `v_${Date.now()}`,
                    schedules: dataRef.current.schedules,
                    originalSchedules: dataRef.current.originalSchedules,
                    interlineConfig: dataRef.current.interlineConfig,
                    savedAt: new Date().toISOString(),
                    label
                });

                // Keep only last 10 versions
                localStorage.setItem(GUEST_VERSIONS_KEY, JSON.stringify(versions.slice(0, 10)));
                setStatus('saved');
            } catch (e) {
                console.error('Local version save failed:', e);
                setStatus('error');
            }
        }
    }, [userId, currentDraftId]);

    // Load a specific draft
    const loadDraft = useCallback(async (draftId: string): Promise<ScheduleDraft | null> => {
        if (!userId) {
            // Load from localStorage for guests
            const draftJson = localStorage.getItem(GUEST_DRAFT_KEY);
            if (draftJson) {
                const draft = JSON.parse(draftJson) as GuestDraft;
                dataRef.current = {
                    schedules: draft.schedules,
                    originalSchedules: draft.originalSchedules,
                    interlineConfig: draft.interlineConfig,
                    name: draft.name,
                    isDirty: false,
                    version: 0
                };
                return {
                    id: 'local',
                    name: draft.name,
                    schedules: draft.schedules,
                    originalSchedules: draft.originalSchedules,
                    interlineConfig: draft.interlineConfig,
                    createdAt: new Date(draft.updatedAt),
                    updatedAt: new Date(draft.updatedAt)
                };
            }
            return null;
        }

        try {
            const draft = await getDraft(userId, draftId);
            if (draft) {
                setCurrentDraftId(draftId);
                dataRef.current = {
                    schedules: draft.schedules,
                    originalSchedules: draft.originalSchedules,
                    interlineConfig: draft.interlineConfig,
                    name: draft.name,
                    isDirty: false,
                    version: 0
                };
            }
            return draft;
        } catch (e) {
            console.error('Failed to load draft:', e);
            return null;
        }
    }, [userId]);

    // Clear current draft (start fresh)
    const clearDraft = useCallback(() => {
        setCurrentDraftId(null);
        dataRef.current = {
            schedules: [],
            originalSchedules: [],
            interlineConfig: undefined,
            name: 'Untitled Draft',
            isDirty: false,
            version: 0
        };
        setStatus('idle');
        setLastSaved(null);
        setError(null);

        // Also clear localStorage for guests
        if (!userId) {
            localStorage.removeItem(GUEST_DRAFT_KEY);
        }
    }, [userId]);

    // Check for existing guest draft on mount
    useEffect(() => {
        if (!userId && enabled) {
            const draftJson = localStorage.getItem(GUEST_DRAFT_KEY);
            if (draftJson) {
                try {
                    const draft = JSON.parse(draftJson) as GuestDraft;
                    if (draft.schedules?.length > 0) {
                        dataRef.current = {
                            schedules: draft.schedules,
                            originalSchedules: draft.originalSchedules,
                            interlineConfig: draft.interlineConfig,
                            name: draft.name,
                            isDirty: false,
                            version: 0
                        };
                        setLastSaved(new Date(draft.updatedAt));
                        setStatus('saved');
                    }
                } catch (e) {
                    console.error('Failed to parse guest draft:', e);
                }
            }
        }
    }, [userId, enabled]);

    return {
        status,
        lastSaved,
        error,
        currentDraftId,
        triggerSave,
        saveVersion,
        loadDraft,
        clearDraft,
        setData
    };
};

export default useAutoSave;
