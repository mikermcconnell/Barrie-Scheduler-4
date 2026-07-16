import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bus, Search, X, Check, ChevronRight, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { ScheduleEditor } from '../ScheduleEditor';
import {
    ScheduleReviewPanel,
    type ScheduleReviewChange as ScheduleReviewPanelChange,
    type ScheduleReviewIssue as ScheduleReviewPanelIssue,
} from '../schedule/ScheduleReviewPanel';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';
import type { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import type { MasterScheduleContent, RouteIdentity } from '../../utils/masterScheduleTypes';
import type { DraftBasedOn, DraftCheckpoint, DraftStatus } from '../../utils/schedule/scheduleTypes';
import { buildMasterContentFromTables, buildTablesFromContent } from '../../utils/schedule/scheduleDraftAdapter';
import {
    createDraftCheckpoint,
    getDraftCheckpoint,
    listDraftCheckpoints,
    saveDraft,
} from '../../utils/services/draftService';
import { buildDuplicateDraftName } from '../../utils/services/draftNaming';
import { publishDraft, StaleDraftPublishError } from '../../utils/services/publishService';
import { createScheduleReview } from '../../utils/services/scheduleReviewService';
import { getMasterSchedule, getMasterScheduleEntry, getVersionContent } from '../../utils/services/masterScheduleService';
import {
    assessDraftFreshness,
    buildScheduleReview,
    type DraftFreshness,
} from '../../utils/schedule/scheduleReview';
import {
    buildRouteBaselineFromGTFSFeed,
    fetchGTFSFeed,
    DEFAULT_GTFS_URL,
} from '../../utils/gtfs/gtfsImportService';

// Minimal draft info for the route switcher
export interface SiblingDraft {
    id: string;
    name: string;
    routeNumber: string;
    dayType: string;
    tripCount?: number;
}

interface ScheduleEditorWorkspaceProps {
    initialContent: MasterScheduleContent;
    basedOn?: DraftBasedOn;
    onClose: () => void;
    onOpenDrafts?: () => void;
    onNewDraft?: () => void;
    onDraftMetadataChange?: (draft: { id: string | null; name: string; updatedAt: Date | null }) => void;
    // Optional: sibling drafts for route switching (bulk import)
    siblingDrafts?: SiblingDraft[];
    currentDraftId?: string;
    currentDraftName?: string;
    currentDraftUpdatedAt?: Date;
    currentDraftStatus?: DraftStatus;
    onSwitchDraft?: (draftId: string) => void;
}

export const ScheduleEditorWorkspace: React.FC<ScheduleEditorWorkspaceProps> = ({
    initialContent,
    basedOn,
    onClose,
    onOpenDrafts,
    onNewDraft,
    onDraftMetadataChange,
    siblingDrafts,
    currentDraftId,
    currentDraftName,
    currentDraftUpdatedAt,
    currentDraftStatus = 'draft',
    onSwitchDraft
}) => {
    const { user } = useAuth();
    const { team, canManageTeam } = useTeam();
    const toast = useToast();
    const userId = user?.uid ?? null;

    const initialTables = useMemo(() => buildTablesFromContent(initialContent), [initialContent]);
    const {
        state: schedules,
        set: setSchedules,
        undo,
        redo,
        canUndo,
        canRedo
    } = useUndoRedo<MasterRouteTable[]>(initialTables, { maxHistory: 50 });

    const initialRouteNumber = initialContent.metadata?.routeNumber || '';
    const initialDraftName = currentDraftName || (initialRouteNumber ? `Draft - Route ${initialRouteNumber}` : 'Untitled Draft');

    const [draftId, setDraftId] = useState<string | null>(currentDraftId || null);
    const [draftName, setDraftName] = useState<string>(initialDraftName);
    const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(currentDraftUpdatedAt || null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isReviewOpen, setIsReviewOpen] = useState(false);
    const [isReviewWorking, setIsReviewWorking] = useState(false);
    const [publishNote, setPublishNote] = useState('');
    const [draftStatus, setDraftStatus] = useState<DraftStatus>(currentDraftStatus);
    const [freshness, setFreshness] = useState<DraftFreshness>({ status: 'not-master-derived' });
    const [baselineContent, setBaselineContent] = useState<MasterScheduleContent | null>(
        basedOn?.type === 'master' && !currentDraftId ? initialContent : null
    );
    const [reviewFocusTripId, setReviewFocusTripId] = useState<string | null>(null);
    const [showChangedOnly, setShowChangedOnly] = useState(false);
    const [reviewChangeIndex, setReviewChangeIndex] = useState(-1);
    const [checkpoints, setCheckpoints] = useState<DraftCheckpoint[]>([]);
    const [compareBaseline, setCompareBaseline] = useState<MasterRouteTable[] | null>(null);
    const [compareBaselineLabel, setCompareBaselineLabel] = useState<string | undefined>(undefined);
    const [routeSearch, setRouteSearch] = useState('');
    const [dayTypeFilter, setDayTypeFilter] = useState<'all' | 'Weekday' | 'Saturday' | 'Sunday'>('all');
    const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(true);
    const hasInitializedAutoSaveRef = useRef(false);
    const hasPendingChangesRef = useRef(false);
    const changeVersionRef = useRef(0);
    const savedVersionRef = useRef(0);
    const previousSchedulesRef = useRef(schedules);
    const previousDraftNameRef = useRef(initialDraftName);
    const userRef = useRef(user);
    const schedulesRef = useRef(schedules);
    const draftIdRef = useRef<string | null>(currentDraftId || null);
    const draftNameRef = useRef(initialDraftName);
    const draftStatusRef = useRef<DraftStatus>(currentDraftStatus);
    const sourceMetadataRef = useRef(initialContent.metadata);
    const editorUploadedAtRef = useRef(
        initialContent.metadata?.uploadedAt || new Date().toISOString()
    );
    const initialMasterDraftSaveStartedRef = useRef(false);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const latestSaveRequestRef = useRef(0);
    const reviewSubmissionInFlightRef = useRef(false);
    const publishSubmissionInFlightRef = useRef(false);
    const navigationInFlightRef = useRef(false);

    const currentSibling = siblingDrafts?.find(d => d.id === currentDraftId);

    useUnsavedChangesWarning(
        hasUnsavedChanges,
        'This schedule has unsaved changes. Leave anyway?'
    );

    const buildEditorContent = useCallback((tables: MasterRouteTable[]) => {
        const buildResult = buildMasterContentFromTables(tables);
        if (!buildResult) return null;
        return {
            ...buildResult,
            content: {
                ...buildResult.content,
                metadata: {
                    ...sourceMetadataRef.current,
                    routeNumber: buildResult.routeNumber,
                    dayType: buildResult.dayType,
                    uploadedAt: editorUploadedAtRef.current,
                },
            },
        };
    }, []);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    useEffect(() => {
        schedulesRef.current = schedules;
    }, [schedules]);

    useEffect(() => {
        draftIdRef.current = draftId;
    }, [draftId]);

    useEffect(() => {
        draftNameRef.current = draftName;
    }, [draftName]);

    useEffect(() => {
        draftStatusRef.current = draftStatus;
    }, [draftStatus]);

    useEffect(() => {
        if (!isReviewOpen || !userId || !draftId) return;
        let cancelled = false;
        void listDraftCheckpoints(userId, draftId)
            .then(items => {
                if (!cancelled) setCheckpoints(items);
            })
            .catch(error => {
                console.error('Failed to load draft checkpoints:', error);
                if (!cancelled) setCheckpoints([]);
            });
        return () => {
            cancelled = true;
        };
    }, [draftId, isReviewOpen, userId]);

    useEffect(() => {
        onDraftMetadataChange?.({
            id: draftId,
            name: draftName,
            updatedAt: lastSaved,
        });
    }, [draftId, draftName, lastSaved, onDraftMetadataChange]);

    useEffect(() => {
        let cancelled = false;

        const loadCompareBaseline = async () => {
            if (basedOn?.type === 'master' && basedOn.id) {
                const routeIdentity = basedOn.id as RouteIdentity;
                const sourceTeamId = basedOn.sourceTeamId || team?.id;
                if (!sourceTeamId) return;

                try {
                    const [sourceBaseline, currentMaster] = await Promise.all([
                        basedOn.sourceVersion
                            ? getVersionContent(sourceTeamId, routeIdentity, basedOn.sourceVersion)
                            : getMasterSchedule(sourceTeamId, routeIdentity).then(result => result?.content ?? null),
                        getMasterScheduleEntry(sourceTeamId, routeIdentity),
                    ]);
                    if (cancelled) return;
                    const effectiveBaseline = sourceBaseline || (!currentDraftId ? initialContent : null);
                    setBaselineContent(effectiveBaseline);
                    setCompareBaseline(effectiveBaseline ? buildTablesFromContent(effectiveBaseline) : null);
                    setCompareBaselineLabel(
                        basedOn.sourceVersion ? `Published Master v${basedOn.sourceVersion}` : 'Published Master'
                    );
                    setFreshness(assessDraftFreshness({ basedOn }, currentMaster));
                } catch (error) {
                    console.error('Failed to load published master comparison:', error);
                    if (!cancelled) {
                        setCompareBaseline(null);
                        setBaselineContent(null);
                        setFreshness({ status: 'unknown', routeIdentity: basedOn.id, reason: 'master-missing' });
                    }
                }
                return;
            }

            const shouldUseGtfsBaseline = (
                basedOn?.type === 'gtfs'
                || (
                    initialContent.metadata?.dayType === 'Sunday'
                    && draftName.toLowerCase().includes('boxing day')
                )
            );

            if (!shouldUseGtfsBaseline) {
                if (!cancelled) {
                    setCompareBaseline(null);
                    setCompareBaselineLabel(undefined);
                    setBaselineContent(null);
                    setFreshness({ status: 'not-master-derived' });
                }
                return;
            }

            const routeNumber = initialContent.metadata?.routeNumber;
            const dayType = initialContent.metadata?.dayType;
            if (!routeNumber || !dayType) {
                if (!cancelled) {
                    setCompareBaseline(null);
                    setCompareBaselineLabel(undefined);
                }
                return;
            }

            try {
                const feed = await fetchGTFSFeed(DEFAULT_GTFS_URL);
                const baseline = buildRouteBaselineFromGTFSFeed(feed, routeNumber, dayType);

                if (!cancelled) {
                    setCompareBaseline(baseline);
                    setCompareBaselineLabel(baseline ? 'GTFS' : undefined);
                    setBaselineContent(null);
                }
            } catch (error) {
                console.error('Failed to load GTFS compare baseline for editor draft:', error);
                if (!cancelled) {
                    setCompareBaseline(null);
                    setCompareBaselineLabel(undefined);
                    setBaselineContent(null);
                }
            }
        };

        void loadCompareBaseline();

        return () => {
            cancelled = true;
        };
    }, [basedOn, currentDraftId, draftName, initialContent, team?.id]);

    // Auto-expand the current route's group
    useEffect(() => {
        if (currentSibling) {
            setExpandedRoutes(prev => new Set(prev).add(currentSibling.routeNumber));
        }
    }, [currentDraftId, currentSibling]);

    const saveDraftNow = useCallback(async (options?: {
        suppressStatusUpdates?: boolean;
        statusOverride?: DraftStatus;
        createNew?: boolean;
        nameOverride?: string;
    }): Promise<string | null> => {
        const activeUser = userRef.current;
        if (!activeUser) {
            if (mountedRef.current && !options?.suppressStatusUpdates) {
                setAutoSaveStatus('error');
            }
            return null;
        }

        const buildResult = buildEditorContent(schedulesRef.current);
        if (!buildResult) {
            if (mountedRef.current && !options?.suppressStatusUpdates) {
                setAutoSaveStatus('error');
            }
            return null;
        }

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }

        const requestId = ++latestSaveRequestRef.current;
        const versionAtSave = changeVersionRef.current;
        const requestedNameOverride = options?.nameOverride;
        const requestedStatus = options?.statusOverride ?? draftStatusRef.current;
        if (mountedRef.current && !options?.suppressStatusUpdates) {
            setAutoSaveStatus('saving');
        }

        let resolveResult!: (draftId: string | null) => void;
        const result = new Promise<string | null>(resolve => {
            resolveResult = resolve;
        });

        saveQueueRef.current = saveQueueRef.current
            .catch((): void => {})
            .then(async () => {
                try {
                    // Resolve the target ID only when this request reaches the front of
                    // the queue. The first create therefore hands its ID to later saves.
                    const newDraftId = await saveDraft(activeUser.uid, {
                        id: options?.createNew ? undefined : (draftIdRef.current || undefined),
                        name: requestedNameOverride ?? draftNameRef.current,
                        routeNumber: buildResult.routeNumber,
                        dayType: buildResult.dayType,
                        status: requestedStatus,
                        createdBy: activeUser.uid,
                        basedOn,
                        content: buildResult.content
                    });
                    draftIdRef.current = newDraftId;
                    if (options?.createNew && requestedNameOverride) {
                        draftNameRef.current = requestedNameOverride;
                        previousDraftNameRef.current = requestedNameOverride;
                        if (mountedRef.current) setDraftName(requestedNameOverride);
                    }
                    savedVersionRef.current = Math.max(savedVersionRef.current, versionAtSave);
                    const stillDirty = changeVersionRef.current > savedVersionRef.current;
                    hasPendingChangesRef.current = stillDirty;

                    if (mountedRef.current) {
                        setDraftId(newDraftId);
                        setLastSaved(new Date());
                        setHasUnsavedChanges(stillDirty);
                        if (!options?.suppressStatusUpdates && requestId === latestSaveRequestRef.current) {
                            setAutoSaveStatus(stillDirty ? 'idle' : 'saved');
                        }
                    }
                    resolveResult(newDraftId);
                } catch (error) {
                    console.error('Draft save failed:', error);
                    if (
                        mountedRef.current
                        && !options?.suppressStatusUpdates
                        && requestId === latestSaveRequestRef.current
                    ) {
                        setAutoSaveStatus('error');
                    }
                    resolveResult(null);
                }
            });

        return result;
    }, [basedOn, buildEditorContent]);

    // Copying a master creates a real draft immediately, even before the first edit.
    useEffect(() => {
        if (
            basedOn?.type !== 'master'
            || currentDraftId
            || draftIdRef.current
            || !userId
            || initialMasterDraftSaveStartedRef.current
        ) return;

        initialMasterDraftSaveStartedRef.current = true;
        void saveDraftNow().then(savedId => {
            if (savedId) toast?.success('Draft Created', 'Your editable copy is saved.');
        });
    }, [basedOn?.type, currentDraftId, saveDraftNow, toast, userId]);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;

            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }

            if (hasPendingChangesRef.current && userRef.current) {
                void saveDraftNow({ suppressStatusUpdates: true });
            }
        };
    }, [saveDraftNow]);

    useEffect(() => {
        if (!userId) return;

        if (!hasInitializedAutoSaveRef.current) {
            hasInitializedAutoSaveRef.current = true;
            previousSchedulesRef.current = schedules;
            previousDraftNameRef.current = draftName;
            hasPendingChangesRef.current = changeVersionRef.current > savedVersionRef.current;
            setHasUnsavedChanges(hasPendingChangesRef.current);
            return;
        }

        const schedulesChanged = previousSchedulesRef.current !== schedules;
        const draftNameChanged = previousDraftNameRef.current !== draftName;

        if (!schedulesChanged && !draftNameChanged) {
            return;
        }

        previousSchedulesRef.current = schedules;
        previousDraftNameRef.current = draftName;

        changeVersionRef.current += 1;
        if (draftStatusRef.current !== 'draft') {
            draftStatusRef.current = 'draft';
            setDraftStatus('draft');
        }
        const isDirty = changeVersionRef.current > savedVersionRef.current;

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        hasPendingChangesRef.current = isDirty;
        setHasUnsavedChanges(isDirty);

        if (!isDirty) {
            return;
        }

        setAutoSaveStatus(prev => (prev === 'saved' || prev === 'error') ? 'idle' : prev);
        saveTimerRef.current = setTimeout(() => {
            void saveDraftNow();
        }, 10000);
    }, [draftName, saveDraftNow, schedules, userId]);

    const handleSaveVersion = async () => {
        await saveDraftNow();
    };

    const handleDuplicateDraft = async () => {
        const activeUser = userRef.current;
        if (!activeUser) {
            toast?.error('Duplicate Failed', 'Sign in to duplicate drafts.');
            return;
        }

        if (!buildEditorContent(schedulesRef.current)) {
            toast?.error('Duplicate Failed', 'This draft contains multiple routes or day types.');
            return;
        }

        const duplicatedName = buildDuplicateDraftName(draftNameRef.current);
        try {
            setAutoSaveStatus('saving');
            const duplicatedDraftId = await saveDraftNow({
                createNew: true,
                nameOverride: duplicatedName,
                statusOverride: 'draft',
            });
            if (!duplicatedDraftId) throw new Error('Duplicate save failed.');
            draftStatusRef.current = 'draft';
            setDraftStatus('draft');
            toast?.success('Duplicated', 'Opened a duplicated draft copy.');
        } catch (error) {
            console.error('Draft duplicate failed:', error);
            setAutoSaveStatus('error');
            toast?.error('Duplicate Failed', 'Unable to duplicate the current draft.');
        }
    };

    const activeBuildResult = useMemo(() => buildEditorContent(schedules), [buildEditorContent, schedules]);
    const scheduleReview = useMemo(() => (
        activeBuildResult
            ? buildScheduleReview(activeBuildResult.content, baselineContent)
            : null
    ), [activeBuildResult, baselineContent]);
    const reviewPanelIssues = useMemo<ScheduleReviewPanelIssue[]>(() => (
        (scheduleReview?.issues ?? []).map(issue => ({
            id: issue.id,
            severity: issue.severity,
            title: issue.message,
            rowId: issue.location.tripId,
            rowLabel: issue.location.blockId ? `Block ${issue.location.blockId}` : undefined,
        }))
    ), [scheduleReview]);
    const currentTripIds = useMemo(() => new Set(
        schedules.flatMap(table => table.trips.map(trip => trip.id))
    ), [schedules]);
    const reviewPanelChanges = useMemo<ScheduleReviewPanelChange[]>(() => (
        (scheduleReview?.changes ?? []).map(change => ({
            id: change.id,
            title: change.message,
            rowId: change.location.tripId && currentTripIds.has(change.location.tripId)
                ? change.location.tripId
                : undefined,
            rowLabel: change.location.blockId ? `Block ${change.location.blockId}` : undefined,
        }))
    ), [currentTripIds, scheduleReview]);
    const changedTripIds = useMemo(() => (
        [...new Set(reviewPanelChanges.flatMap(change => change.rowId ? [change.rowId] : []))]
    ), [reviewPanelChanges]);

    const handleNextChange = useCallback(() => {
        if (changedTripIds.length === 0) return;
        const nextIndex = (reviewChangeIndex + 1) % changedTripIds.length;
        setReviewChangeIndex(nextIndex);
        setReviewFocusTripId(changedTripIds[nextIndex]);
    }, [changedTripIds, reviewChangeIndex]);
    const baselineTripCount = useMemo(() => (
        baselineContent
            ? (baselineContent.northTable?.trips.length ?? 0) + (baselineContent.southTable?.trips.length ?? 0)
            : undefined
    ), [baselineContent]);

    const handleCreateCheckpoint = async () => {
        if (!user || !activeBuildResult) return;
        const savedDraftId = await saveDraftNow();
        if (!savedDraftId) {
            toast?.error('Checkpoint Failed', 'Save the draft before creating a checkpoint.');
            return;
        }
        const defaultName = `Before publish · ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
        const name = window.prompt('Checkpoint name', defaultName)?.trim();
        if (!name) return;

        setIsReviewWorking(true);
        try {
            await createDraftCheckpoint(user.uid, savedDraftId, name, activeBuildResult.content);
            setCheckpoints(await listDraftCheckpoints(user.uid, savedDraftId));
            toast?.success('Checkpoint Created', name);
        } catch (error) {
            console.error('Checkpoint creation failed:', error);
            toast?.error('Checkpoint Failed', 'Unable to save this recovery point.');
        } finally {
            setIsReviewWorking(false);
        }
    };

    const handleRestoreCheckpoint = async (checkpointId: string) => {
        if (!user || !draftId) return;
        const checkpoint = await getDraftCheckpoint(user.uid, draftId, checkpointId);
        if (!checkpoint?.content) {
            toast?.error('Restore Failed', 'Checkpoint content is unavailable.');
            return;
        }
        if (!window.confirm(`Restore “${checkpoint.name}”? Your current draft will remain available through undo until you leave the editor.`)) {
            return;
        }
        setSchedules(buildTablesFromContent(checkpoint.content));
        setReviewFocusTripId(null);
        setIsReviewOpen(false);
        toast?.success('Checkpoint Restored', checkpoint.name);
    };

    const handleReadyForReview = async () => {
        if (reviewSubmissionInFlightRef.current || publishSubmissionInFlightRef.current) return;
        if (!user || !team || !activeBuildResult) {
            toast?.warning('Team Required', 'Join a team before submitting a schedule for review.');
            return;
        }
        if (!scheduleReview?.publishReady) {
            toast?.warning('Resolve Critical Issues', 'Fix blocking schedule issues before review.');
            return;
        }
        reviewSubmissionInFlightRef.current = true;
        const submittedBuildResult = activeBuildResult;
        const versionAtSubmission = changeVersionRef.current;
        draftStatusRef.current = 'draft';
        setDraftStatus('draft');
        setIsReviewWorking(true);
        try {
            // Persist a non-publishable draft first. Only promote its status after
            // the immutable team review snapshot has been created successfully.
            const savedDraftId = await saveDraftNow({ statusOverride: 'draft' });
            if (!savedDraftId) {
                toast?.error('Review Submission Failed', 'Save the draft before submitting it for review.');
                return;
            }
            await createScheduleReview({
                teamId: team.id,
                userId: user.uid,
                plannerName: user.displayName || user.email || 'Planner',
                routeNumber: submittedBuildResult.routeNumber,
                dayType: submittedBuildResult.dayType,
                draftId: savedDraftId,
                sourceVersion: basedOn?.type === 'master' ? (basedOn.sourceVersion ?? 0) : 0,
                plannerNote: publishNote.trim(),
                schedule: submittedBuildResult.content,
                sourceSchedule: baselineContent,
            });
            if (changeVersionRef.current !== versionAtSubmission) {
                await saveDraftNow({ statusOverride: 'draft', suppressStatusUpdates: true });
                toast?.warning(
                    'Review Snapshot Outdated',
                    'The schedule changed during submission. Review the latest changes and submit again.'
                );
                return;
            }

            const readyDraftId = await saveDraftNow({ statusOverride: 'ready_for_review' });
            if (!readyDraftId) {
                toast?.error(
                    'Review Submission Failed',
                    'The review snapshot was created, but the draft could not be marked ready. Try again.'
                );
                return;
            }
            if (changeVersionRef.current !== versionAtSubmission) {
                await saveDraftNow({ statusOverride: 'draft', suppressStatusUpdates: true });
                toast?.warning(
                    'Review Snapshot Outdated',
                    'The schedule changed during submission. Review the latest changes and submit again.'
                );
                return;
            }
            draftStatusRef.current = 'ready_for_review';
            setDraftStatus('ready_for_review');
            toast?.success('Ready for Review', 'The draft is saved for review.');
        } catch (error) {
            console.error('Schedule review submission failed:', error);
            toast?.error('Review Submission Failed', 'Unable to create the team review snapshot.');
        } finally {
            reviewSubmissionInFlightRef.current = false;
            setIsReviewWorking(false);
        }
    };

    const handlePublish = async () => {
        if (publishSubmissionInFlightRef.current || reviewSubmissionInFlightRef.current) return;
        if (!user || !team) {
            toast?.warning('Team Required', 'Join a team to publish schedules');
            return;
        }
        if (!canManageTeam) {
            toast?.warning('Permission Required', 'Only team owners and admins can publish master schedules.');
            return;
        }
        if (!scheduleReview?.publishReady) {
            toast?.warning('Resolve Critical Issues', 'Fix blocking schedule issues before publishing.');
            setIsReviewOpen(true);
            return;
        }
        if (basedOn?.type === 'master' && freshness.status !== 'current') {
            toast?.warning(
                freshness.status === 'stale' ? 'Master Has Changed' : 'Source Master Unverified',
                'Start from the latest master schedule before publishing.'
            );
            setIsReviewOpen(true);
            return;
        }
        if (!publishNote.trim()) {
            toast?.warning('Publish Note Required', 'Briefly describe why the schedule changed.');
            setIsReviewOpen(true);
            return;
        }
        if (draftStatusRef.current !== 'ready_for_review') {
            toast?.warning('Review Confirmation Required', 'Mark the draft ready for review before publishing.');
            setIsReviewOpen(true);
            return;
        }

        publishSubmissionInFlightRef.current = true;
        const versionAtPublish = changeVersionRef.current;
        setIsPublishing(true);
        setIsReviewWorking(true);
        try {
            const savedDraftId = await saveDraftNow();
            if (!savedDraftId) {
                toast?.error('Publish Failed', 'Save the draft successfully before publishing.');
                return;
            }
            if (
                changeVersionRef.current !== versionAtPublish
                || draftStatusRef.current !== 'ready_for_review'
            ) {
                await saveDraftNow({ statusOverride: 'draft', suppressStatusUpdates: true });
                toast?.warning('Publish Cancelled', 'The schedule changed while saving. Submit the latest changes for review again.');
                return;
            }

            const buildResult = buildEditorContent(schedulesRef.current);
            if (!buildResult) {
                toast?.error('Publish Failed', 'This draft contains multiple routes/day types.');
                return;
            }
            await publishDraft({
                teamId: team.id,
                userId: user.uid,
                publisherName: user.displayName || user.email || 'User',
                draft: {
                    id: savedDraftId,
                    name: draftNameRef.current,
                    routeNumber: buildResult.routeNumber,
                    dayType: buildResult.dayType,
                    status: draftStatusRef.current,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: user.uid,
                    basedOn,
                    content: buildResult.content
                },
                publishNote: publishNote.trim(),
            });
            draftStatusRef.current = 'draft';
            setDraftStatus('draft');
            const resetDraftId = await saveDraftNow({
                statusOverride: 'draft',
                suppressStatusUpdates: true,
            });
            toast?.success('Published', `Route ${buildResult.routeNumber} published`);
            if (!resetDraftId) {
                toast?.warning(
                    'Draft Status Warning',
                    'The schedule was published, but its draft status could not be reset. Avoid publishing it again.'
                );
            }
            setPublishNote('');
            setIsReviewOpen(false);
        } catch (error) {
            console.error('Publish failed:', error);
            if (error instanceof StaleDraftPublishError) {
                setFreshness(error.freshness);
                toast?.error('Master Has Changed', error.message);
            } else {
                toast?.error('Publish Failed', 'Unable to publish schedule');
            }
        } finally {
            publishSubmissionInFlightRef.current = false;
            setIsPublishing(false);
            setIsReviewWorking(false);
        }
    };

    const saveBeforeNavigation = useCallback(async (navigate?: () => void) => {
        if (!navigate || navigationInFlightRef.current) return;
        navigationInFlightRef.current = true;
        try {
            if (userRef.current) {
                do {
                    const savedDraftId = await saveDraftNow({ suppressStatusUpdates: true });
                    if (!savedDraftId) {
                        toast?.error('Save Failed', 'Your latest changes could not be saved. Stay here and try again.');
                        return;
                    }
                    // If the planner edited while this save was in flight, persist
                    // that newer version before allowing the workspace to unmount.
                } while (hasPendingChangesRef.current);
            }
            navigate();
        } finally {
            navigationInFlightRef.current = false;
        }
    }, [saveDraftNow, toast]);

    const handleSwitchDraftRequest = useCallback((nextDraftId: string) => {
        if (!onSwitchDraft || nextDraftId === currentDraftId) return;
        void saveBeforeNavigation(() => onSwitchDraft(nextDraftId));
    }, [currentDraftId, onSwitchDraft, saveBeforeNavigation]);

    // Toggle route group expansion
    const toggleRouteExpanded = (routeNum: string) => {
        setExpandedRoutes(prev => {
            const next = new Set(prev);
            if (next.has(routeNum)) {
                next.delete(routeNum);
            } else {
                next.add(routeNum);
            }
            return next;
        });
    };

    // Group and filter siblings for sidebar
    const groupedRoutes = useMemo(() => {
        if (!siblingDrafts) return {};

        // Filter by search and day type
        const filtered = siblingDrafts.filter(d => {
            const matchesSearch = !routeSearch ||
                d.routeNumber.toLowerCase().includes(routeSearch.toLowerCase()) ||
                d.name.toLowerCase().includes(routeSearch.toLowerCase());
            const matchesDayType = dayTypeFilter === 'all' || d.dayType === dayTypeFilter;
            return matchesSearch && matchesDayType;
        });

        // Group by route number
        const groups: Record<string, SiblingDraft[]> = {};
        filtered.forEach(d => {
            if (!groups[d.routeNumber]) groups[d.routeNumber] = [];
            groups[d.routeNumber].push(d);
        });

        // Sort day types within each group
        const dayOrder: Record<string, number> = { Weekday: 0, Saturday: 1, Sunday: 2 };
        Object.values(groups).forEach(group => {
            group.sort((a, b) => (dayOrder[a.dayType] || 0) - (dayOrder[b.dayType] || 0));
        });

        return groups;
    }, [siblingDrafts, routeSearch, dayTypeFilter]);

    const sortedRouteNumbers = Object.keys(groupedRoutes).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );

    const hasSiblings = siblingDrafts && siblingDrafts.length > 1 && onSwitchDraft;

    return (
        <div className="h-full flex">
            {/* Route Sidebar - only show when multiple siblings exist */}
            {hasSiblings && (
                <div className="w-64 min-w-[256px] bg-white border-r border-gray-200 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="p-3 border-b border-gray-100 bg-gradient-to-r from-indigo-600 to-blue-600">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-white">
                                <Bus size={16} />
                                <span className="font-medium text-sm">{siblingDrafts.length} Routes</span>
                            </div>
                            <button
                                onClick={() => void saveBeforeNavigation(onClose)}
                                className="text-white/70 hover:text-white text-xs flex items-center gap-1"
                            >
                                <ArrowLeft size={12} />
                                Back
                            </button>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="p-2 border-b border-gray-100">
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search routes..."
                                value={routeSearch}
                                onChange={e => setRouteSearch(e.target.value)}
                                className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            />
                            {routeSearch && (
                                <button
                                    onClick={() => setRouteSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Day Type Filter */}
                    <div className="px-2 py-1.5 border-b border-gray-100 flex gap-1">
                        {(['all', 'Weekday', 'Saturday', 'Sunday'] as const).map(dt => (
                            <button
                                key={dt}
                                onClick={() => setDayTypeFilter(dt)}
                                className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                                    dayTypeFilter === dt
                                        ? 'bg-indigo-100 text-indigo-700'
                                        : 'text-gray-500 hover:bg-gray-100'
                                }`}
                            >
                                {dt === 'all' ? 'All' : dt.slice(0, 3)}
                            </button>
                        ))}
                    </div>

                    {/* Route List */}
                    <div className="flex-1 overflow-y-auto">
                        {sortedRouteNumbers.length === 0 ? (
                            <div className="px-4 py-6 text-center text-gray-400 text-sm">
                                No routes match your search
                            </div>
                        ) : (
                            sortedRouteNumbers.map(routeNum => {
                                const isExpanded = expandedRoutes.has(routeNum);
                                const hasCurrentRoute = groupedRoutes[routeNum].some(d => d.id === currentDraftId);
                                return (
                                    <div key={routeNum} className="border-b border-gray-100">
                                        {/* Route Group Header - clickable to expand/collapse */}
                                        <button
                                            onClick={() => toggleRouteExpanded(routeNum)}
                                            className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-50 ${
                                                hasCurrentRoute ? 'bg-indigo-50/50' : ''
                                            }`}
                                        >
                                            <span className={`text-sm font-bold ${hasCurrentRoute ? 'text-indigo-700' : 'text-gray-700'}`}>
                                                Route {routeNum}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-400">
                                                    {groupedRoutes[routeNum].length}
                                                </span>
                                                <ChevronRight
                                                    size={14}
                                                    className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                />
                                            </div>
                                        </button>

                                        {/* Day Type Options - shown when expanded */}
                                        {isExpanded && (
                                            <div className="bg-gray-50/50">
                                                {groupedRoutes[routeNum].map(draft => (
                                                    <button
                                                        key={draft.id}
                                                        onClick={() => handleSwitchDraftRequest(draft.id)}
                                                        className={`w-full pl-6 pr-3 py-2 text-left flex items-center justify-between hover:bg-gray-100 ${
                                                            draft.id === currentDraftId ? 'bg-indigo-100' : ''
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className={`w-2 h-2 rounded-full ${
                                                                draft.dayType === 'Weekday' ? 'bg-blue-500' :
                                                                draft.dayType === 'Saturday' ? 'bg-green-500' : 'bg-orange-500'
                                                            }`} />
                                                            <span className={`text-sm ${draft.id === currentDraftId ? 'font-medium text-indigo-700' : 'text-gray-600'}`}>
                                                                {draft.dayType}
                                                            </span>
                                                            {draft.tripCount !== undefined && (
                                                                <span className="text-xs text-gray-400">
                                                                    ({draft.tripCount})
                                                                </span>
                                                            )}
                                                        </div>
                                                        {draft.id === currentDraftId && (
                                                            <Check size={14} className="text-indigo-600" />
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* Editor */}
            <div className="flex-1 min-w-0">
                <ScheduleEditor
                    schedules={schedules}
                    onSchedulesChange={setSchedules}
                    originalSchedules={initialTables}
                    masterBaseline={compareBaseline}
                    compareBaselineLabel={compareBaselineLabel}
                    initialShowDeltas={basedOn?.type === 'master'}
                    highlightedTripId={reviewFocusTripId}
                    visibleTripIds={showChangedOnly ? changedTripIds : null}
                    includeRemovedMasterTripsWhenFiltered={showChangedOnly}
                    draftName={draftName}
                    onRenameDraft={setDraftName}
                    onOpenDrafts={onOpenDrafts ? () => void saveBeforeNavigation(onOpenDrafts) : undefined}
                    onNewDraft={onNewDraft ? () => void saveBeforeNavigation(onNewDraft) : undefined}
                    onDuplicateDraft={handleDuplicateDraft}
                    autoSaveStatus={autoSaveStatus}
                    lastSaved={lastSaved}
                    hasUnsavedChanges={hasUnsavedChanges}
                    onSaveVersion={handleSaveVersion}
                    onClose={hasSiblings ? undefined : () => void saveBeforeNavigation(onClose)}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    undo={undo}
                    redo={redo}
                    hideAutoSave={false}
                    publishDisabled={!user || !team || !canManageTeam}
                    isPublishing={isPublishing}
                    sourceLabel={compareBaselineLabel}
                    changeCount={scheduleReview?.changeCounts.totalChanges ?? 0}
                    warningCount={(scheduleReview?.issueCounts.error ?? 0) + (scheduleReview?.issueCounts.warning ?? 0)}
                    onReviewChanges={() => setIsReviewOpen(true)}
                    reviewChangesDisabled={!scheduleReview}
                    hideSidebar
                    teamId={team?.id}
                    userId={user?.uid}
                    uploaderName={user?.displayName || user?.email || 'Unknown'}
                    showSuccessToast={(msg) => toast?.success('Success', msg)}
                />
            </div>
            <ScheduleReviewPanel
                isOpen={isReviewOpen}
                onClose={() => setIsReviewOpen(false)}
                sourceMasterLabel={basedOn?.sourceLabel || (basedOn?.type === 'master' ? 'Published Master' : 'Loaded schedule')}
                sourceMasterVersion={basedOn?.sourceVersion}
                baselineTripCount={baselineTripCount}
                changeCounts={{
                    added: scheduleReview?.changeCounts.new ?? 0,
                    removed: scheduleReview?.changeCounts.removed ?? 0,
                    retimed: (scheduleReview?.changeCounts.retimed ?? 0)
                        + (scheduleReview?.changeCounts.extended ?? 0)
                        + (scheduleReview?.changeCounts.shortened ?? 0),
                    blockChanged: scheduleReview?.blockChangedCount ?? 0,
                }}
                changes={reviewPanelChanges}
                issues={reviewPanelIssues}
                onJumpToRow={tripId => setReviewFocusTripId(tripId)}
                onNextChange={handleNextChange}
                showChangedOnly={showChangedOnly}
                onShowChangedOnlyChange={setShowChangedOnly}
                publishNote={publishNote}
                onPublishNoteChange={setPublishNote}
                isStale={basedOn?.type === 'master' && freshness.status !== 'current'}
                staleMessage={freshness.status === 'stale'
                    ? `This draft started from v${freshness.sourceVersion}; v${freshness.currentVersion} is now published.`
                    : basedOn?.type === 'master' && freshness.status !== 'current'
                        ? 'The source master version could not be verified. Start from the latest published master.'
                        : undefined}
                onCreateCheckpoint={handleCreateCheckpoint}
                checkpointDisabled={!draftId || !activeBuildResult}
                checkpoints={checkpoints.map(checkpoint => ({
                    id: checkpoint.id,
                    name: checkpoint.name,
                    createdAtLabel: checkpoint.createdAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
                }))}
                onRestoreCheckpoint={handleRestoreCheckpoint}
                onReadyForReview={handleReadyForReview}
                readyForReviewDisabled={!scheduleReview?.publishReady || draftStatus === 'ready_for_review'}
                onPublish={handlePublish}
                publishDisabled={
                    !user
                    || !team
                    || !canManageTeam
                    || !scheduleReview?.publishReady
                    || draftStatus !== 'ready_for_review'
                    || (basedOn?.type === 'master' && freshness.status !== 'current')
                    || !publishNote.trim()
                }
                isWorking={isReviewWorking || isPublishing}
            />
        </div>
    );
};
