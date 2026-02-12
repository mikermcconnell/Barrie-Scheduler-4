import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bus, Search, X, Check, ChevronRight, ArrowLeft } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTeam } from './TeamContext';
import { useToast } from './ToastContext';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { ScheduleEditor } from './ScheduleEditor';
import type { AutoSaveStatus } from '../hooks/useAutoSave';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { MasterScheduleContent } from '../utils/masterScheduleTypes';
import type { DraftBasedOn } from '../utils/schedule/scheduleTypes';
import { buildMasterContentFromTables, buildTablesFromContent } from '../utils/schedule/scheduleDraftAdapter';
import { saveDraft } from '../utils/services/draftService';
import { publishDraft } from '../utils/services/publishService';

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
    // Optional: sibling drafts for route switching (bulk import)
    siblingDrafts?: SiblingDraft[];
    currentDraftId?: string;
    onSwitchDraft?: (draftId: string) => void;
}

export const ScheduleEditorWorkspace: React.FC<ScheduleEditorWorkspaceProps> = ({
    initialContent,
    basedOn,
    onClose,
    siblingDrafts,
    currentDraftId,
    onSwitchDraft
}) => {
    const { user } = useAuth();
    const { team } = useTeam();
    const toast = useToast();

    const initialTables = useMemo(() => buildTablesFromContent(initialContent), [initialContent]);
    const {
        state: schedules,
        set: setSchedules,
        undo,
        redo,
        canUndo,
        canRedo
    } = useUndoRedo<MasterRouteTable[]>(initialTables, { maxHistory: 50 });

    const [draftId, setDraftId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState<string>('Untitled Draft');
    const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [routeSearch, setRouteSearch] = useState('');
    const [dayTypeFilter, setDayTypeFilter] = useState<'all' | 'Weekday' | 'Saturday' | 'Sunday'>('all');
    const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const currentSibling = siblingDrafts?.find(d => d.id === currentDraftId);

    // Auto-expand the current route's group
    useEffect(() => {
        if (currentSibling) {
            setExpandedRoutes(prev => new Set(prev).add(currentSibling.routeNumber));
        }
    }, [currentDraftId, currentSibling]);

    useEffect(() => {
        const routeNumber = initialContent.metadata?.routeNumber || '';
        if (routeNumber) {
            setDraftName(`Draft - Route ${routeNumber}`);
        }
    }, [initialContent.metadata?.routeNumber]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, []);

    const saveDraftNow = async (): Promise<string | null> => {
        if (!user) {
            setAutoSaveStatus('error');
            return null;
        }

        const buildResult = buildMasterContentFromTables(schedules);
        if (!buildResult) {
            setAutoSaveStatus('error');
            return null;
        }

        try {
            setAutoSaveStatus('saving');
            const newDraftId = await saveDraft(user.uid, {
                id: draftId || undefined,
                name: draftName,
                routeNumber: buildResult.routeNumber,
                dayType: buildResult.dayType,
                status: 'draft',
                createdBy: user.uid,
                basedOn,
                content: buildResult.content
            });
            setDraftId(newDraftId);
            setLastSaved(new Date());
            setAutoSaveStatus('saved');
            return newDraftId;
        } catch (error) {
            console.error('Draft save failed:', error);
            setAutoSaveStatus('error');
            return null;
        }
    };

    useEffect(() => {
        if (!user) return;
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }
        setAutoSaveStatus(prev => (prev === 'saved' || prev === 'error') ? 'idle' : prev);
        saveTimerRef.current = setTimeout(() => {
            saveDraftNow();
        }, 10000);
    }, [schedules, draftName, user]);

    const handleSaveVersion = async () => {
        await saveDraftNow();
    };

    const handlePublish = async () => {
        if (!user || !team) {
            toast?.warning('Team Required', 'Join a team to publish schedules');
            return;
        }

        const savedDraftId = await saveDraftNow();
        const buildResult = buildMasterContentFromTables(schedules);
        if (!buildResult) {
            toast?.error('Publish Failed', 'This draft contains multiple routes/day types.');
            return;
        }

        setIsPublishing(true);
        try {
            await publishDraft({
                teamId: team.id,
                userId: user.uid,
                publisherName: user.displayName || user.email || 'User',
                draft: {
                    id: savedDraftId || draftId || '',
                    name: draftName,
                    routeNumber: buildResult.routeNumber,
                    dayType: buildResult.dayType,
                    status: 'ready_for_review',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: user.uid,
                    basedOn,
                    content: buildResult.content
                }
            });
            toast?.success('Published', `Route ${buildResult.routeNumber} published`);
        } catch (error) {
            console.error('Publish failed:', error);
            toast?.error('Publish Failed', 'Unable to publish schedule');
        } finally {
            setIsPublishing(false);
        }
    };

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
                                onClick={onClose}
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
                                                        onClick={() => onSwitchDraft(draft.id)}
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
                    draftName={draftName}
                    onRenameDraft={setDraftName}
                    autoSaveStatus={autoSaveStatus}
                    lastSaved={lastSaved}
                    onSaveVersion={handleSaveVersion}
                    onClose={hasSiblings ? undefined : onClose}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    undo={undo}
                    redo={redo}
                    hideAutoSave={false}
                    onPublish={handlePublish}
                    publishDisabled={!user || !team}
                    isPublishing={isPublishing}
                    hideSidebar={!!hasSiblings}
                    teamId={team?.id}
                    userId={user?.uid}
                    uploaderName={user?.displayName || user?.email || 'Unknown'}
                    showSuccessToast={(msg) => toast?.success('Success', msg)}
                />
            </div>
        </div>
    );
};
