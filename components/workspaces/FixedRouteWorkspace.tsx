
import React, { useState, useEffect, useCallback } from 'react';
import {
    CalendarPlus,
    ArrowRight,
    ArrowLeft,
    FileSpreadsheet,
    FileText,
    GitBranch,
    Edit3,
    Database,
    Loader2,
    Clock,
    Trash2,
    RefreshCw
} from 'lucide-react';
import { NewScheduleWizard } from '../NewSchedule/NewScheduleWizard';
import { MasterScheduleBrowser } from '../MasterScheduleBrowser';
import { ScheduleEditorWorkspace, SiblingDraft } from './ScheduleEditorWorkspace';
import { SystemDraftEditorWorkspace } from './SystemDraftEditorWorkspace';
import { ReportsDashboard } from '../Reports/ReportsDashboard';
import { AnalyticsDashboard } from '../Analytics/AnalyticsDashboard';
import { PerformanceDashboard } from '../Performance/PerformanceDashboard';
import { ReportsWorkspace as PerfReportsWorkspace } from './ReportsWorkspace';
import { GTFSImportModal } from '../GTFSImport';
import { SystemDraftList } from '../layout/SystemDraftList';
import type { MasterScheduleContent } from '../../utils/masterScheduleTypes';
import type { DraftBasedOn, DraftSchedule, SystemDraft } from '../../utils/schedule/scheduleTypes';
import { buildMasterContentFromTables } from '../../utils/schedule/scheduleDraftAdapter';
import { getAllDrafts, getDraft, deleteDraft } from '../../utils/services/draftService';
import { getSystemDraft } from '../../utils/services/systemDraftService';
import {
    buildOpenDraftEditorState,
    getRemainingDraftsAfterBulkDelete,
} from '../../utils/workspaces/fixedRouteDraftState';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

type FixedRouteViewMode = 'dashboard' | 'editor' | 'new-schedule' | 'master' | 'reports' | 'analytics' | 'performance' | 'perf-reports' | 'drafts' | 'system-editor';

const VALID_VIEW_MODES = new Set<string>([
    'dashboard', 'editor', 'new-schedule', 'master', 'reports', 'analytics', 'performance', 'perf-reports', 'drafts', 'system-editor'
]);

function parseHashViewMode(): FixedRouteViewMode {
    const hash = window.location.hash.slice(1);
    const parts = hash.split('/');
    if (parts[0] === 'fixed' && parts[1] && VALID_VIEW_MODES.has(parts[1])) {
        return parts[1] as FixedRouteViewMode;
    }
    return 'dashboard';
}

const VIEW_MODE_LABELS: Record<FixedRouteViewMode, string> = {
    dashboard: '',
    'new-schedule': 'New Schedule',
    master: 'Master Schedule',
    reports: 'Timetable Publisher',
    analytics: 'Analytics',
    performance: 'Operations Dashboard',
    'perf-reports': 'STREETS Reports',
    editor: 'Schedule Editor',
    drafts: 'Schedule Editor',
    'system-editor': 'System Draft Editor'
};

interface DashboardCardProps {
    onClick: () => void;
    icon: React.ReactNode;
    title: string;
    description: string;
    color: 'indigo' | 'emerald' | 'purple' | 'amber' | 'cyan';
}

const DashboardCard: React.FC<DashboardCardProps> = ({ onClick, icon, title, description, color }) => {
    const colorClasses = {
        indigo: { bg: 'bg-indigo-50/50', text: 'text-indigo-600', hover: 'hover:bg-indigo-100', border: 'hover:border-indigo-300', arrow: 'group-hover:text-indigo-500' },
        emerald: { bg: 'bg-emerald-50/50', text: 'text-emerald-600', hover: 'hover:bg-emerald-100', border: 'hover:border-emerald-300', arrow: 'group-hover:text-emerald-500' },
        purple: { bg: 'bg-purple-50/50', text: 'text-purple-600', hover: 'hover:bg-purple-100', border: 'hover:border-purple-300', arrow: 'group-hover:text-purple-500' },
        amber: { bg: 'bg-amber-50/50', text: 'text-amber-600', hover: 'hover:bg-amber-100', border: 'hover:border-amber-300', arrow: 'group-hover:text-amber-500' },
        cyan: { bg: 'bg-cyan-50/50', text: 'text-cyan-600', hover: 'hover:bg-cyan-100', border: 'hover:border-cyan-300', arrow: 'group-hover:text-cyan-500' },
    };
    const c = colorClasses[color];

    return (
        <button onClick={onClick} className={`group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md ${c.border} transition-all text-left flex flex-col h-full active:scale-[0.99]`}>
            <div className="flex items-center justify-between mb-4">
                <div className={`${c.bg} p-2.5 rounded-lg ${c.text} group-${c.hover} transition-colors`}>{icon}</div>
                <ArrowRight size={16} className={`text-gray-300 ${c.arrow} transition-colors`} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        </button>
    );
};

export const FixedRouteWorkspace: React.FC = () => {
    const { user } = useAuth();
    const toast = useToast();
    const [viewMode, setViewModeState] = useState<FixedRouteViewMode>(parseHashViewMode);
    const [showGTFSImport, setShowGTFSImport] = useState(false);

    // Wrap navigation to sync URL hash
    const setViewMode = useCallback((mode: FixedRouteViewMode) => {
        setViewModeState(mode);
        window.location.hash = mode === 'dashboard' ? 'fixed' : `fixed/${mode}`;
    }, []);

    // Handle browser back/forward
    useEffect(() => {
        const handler = () => setViewModeState(parseHashViewMode());
        window.addEventListener('hashchange', handler);
        return () => window.removeEventListener('hashchange', handler);
    }, []);

    const [editorInitialContent, setEditorInitialContent] = useState<MasterScheduleContent | null>(null);

    // Drafts list state
    const [drafts, setDrafts] = useState<DraftSchedule[]>([]);
    const [draftsLoading, setDraftsLoading] = useState(false);
    const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null);
    const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
    const [deletingAll, setDeletingAll] = useState(false);

    // Route switcher state (for bulk GTFS import)
    const [siblingDrafts, setSiblingDrafts] = useState<SiblingDraft[]>([]);
    const [currentEditorDraftId, setCurrentEditorDraftId] = useState<string | null>(null);

    // System draft state (new model - all routes for a day type)
    const [activeSystemDraft, setActiveSystemDraft] = useState<SystemDraft | null>(null);

    // Fetch drafts when entering drafts view
    useEffect(() => {
        if (viewMode === 'drafts' && user) {
            fetchDrafts();
        }
    }, [viewMode, user]);

    const fetchDrafts = async () => {
        if (!user) return;
        setDraftsLoading(true);
        try {
            const userDrafts = await getAllDrafts(user.uid);
            setDrafts(userDrafts);
        } catch (error) {
            console.error('Failed to fetch drafts:', error);
            toast?.error('Error', 'Failed to load drafts');
        } finally {
            setDraftsLoading(false);
        }
    };

    const handleOpenDraft = async (draft: DraftSchedule) => {
        if (!user || !draft.id) return;
        setLoadingDraftId(draft.id);
        try {
            const fullDraft = await getDraft(user.uid, draft.id);
            if (fullDraft?.content) {
                const nextEditorState = buildOpenDraftEditorState(
                    fullDraft.id || draft.id,
                    fullDraft.content,
                    fullDraft.basedOn
                );
                setSiblingDrafts([]);
                setCurrentEditorDraftId(nextEditorState.currentEditorDraftId);
                setEditorInitialContent(nextEditorState.initialContent);
                setEditorBasedOn(nextEditorState.basedOn);
                setViewMode('editor');
            } else {
                toast?.error('Error', 'Draft content not found');
            }
        } catch (error) {
            console.error('Failed to load draft:', error);
            toast?.error('Error', 'Failed to load draft');
        } finally {
            setLoadingDraftId(null);
        }
    };

    const handleDeleteDraft = async (draftId: string) => {
        if (!user || !confirm('Delete this draft? This cannot be undone.')) return;
        try {
            await deleteDraft(user.uid, draftId);
            setDrafts(prev => prev.filter(d => d.id !== draftId));
            toast?.success('Deleted', 'Draft deleted successfully');
        } catch (error) {
            console.error('Failed to delete draft:', error);
            toast?.error('Error', 'Failed to delete draft');
        }
    };

    const handleDeleteAllDrafts = async () => {
        if (!user || drafts.length === 0) return;
        setDeletingAll(true);

        const draftsToDelete = [...drafts];
        const deletedDraftIds = new Set<string>();
        let deleted = 0;
        let failed = 0;

        try {
            for (const draft of draftsToDelete) {
                if (!draft.id) continue;
                try {
                    await deleteDraft(user.uid, draft.id);
                    deleted++;
                    deletedDraftIds.add(draft.id);
                } catch (error) {
                    console.error(`Failed to delete draft ${draft.id}:`, error);
                    failed++;
                }
            }

            setDrafts(prev => getRemainingDraftsAfterBulkDelete(prev, deletedDraftIds));

            if (failed > 0) {
                await fetchDrafts();
                toast?.warning('Partial Delete', `Deleted ${deleted} drafts, ${failed} failed`);
            } else {
                toast?.success('All Deleted', `Deleted ${deleted} drafts`);
            }
        } finally {
            setDeletingAll(false);
            setDeleteAllConfirm(false);
        }
    };

    const [editorBasedOn, setEditorBasedOn] = useState<DraftBasedOn | undefined>(undefined);

    // --- Handlers ---

    const handleOpenNewSchedule = () => {
        setViewMode('new-schedule');
    };

    const handleOpenMasterSchedule = () => {
        setViewMode('master');
    };

    const openEditorWorkspace = (content: MasterScheduleContent, basedOn?: DraftBasedOn) => {
        setEditorInitialContent(content);
        setEditorBasedOn(basedOn);
        setSiblingDrafts([]); // Clear siblings for single-draft editing
        setCurrentEditorDraftId(null);
        setViewMode('editor');
    };

    // Open editor with multiple sibling drafts (bulk GTFS import)
    const openEditorWithSiblings = async (draftIds: string[]) => {
        if (!user || draftIds.length === 0) return;

        try {
            // Load all drafts to get their metadata
            const loadedDrafts: SiblingDraft[] = [];
            let firstDraftContent: MasterScheduleContent | null = null;
            let firstDraftBasedOn: DraftBasedOn | undefined;

            for (const draftId of draftIds) {
                const draft = await getDraft(user.uid, draftId);
                if (draft) {
                    // Calculate trip count from content
                    const tripCount = draft.content
                        ? (draft.content.northTable?.trips?.length || 0) + (draft.content.southTable?.trips?.length || 0)
                        : undefined;

                    loadedDrafts.push({
                        id: draft.id || draftId,
                        name: draft.name,
                        routeNumber: draft.routeNumber,
                        dayType: draft.dayType,
                        tripCount
                    });
                    // Keep first draft's content for initial display
                    if (!firstDraftContent && draft.content) {
                        firstDraftContent = draft.content;
                        firstDraftBasedOn = draft.basedOn;
                    }
                }
            }

            // Sort by route number then day type
            loadedDrafts.sort((a, b) => {
                const routeCompare = (a.routeNumber || '').localeCompare(b.routeNumber || '', undefined, { numeric: true });
                if (routeCompare !== 0) return routeCompare;
                const dayOrder: Record<string, number> = { Weekday: 0, Saturday: 1, Sunday: 2 };
                return (dayOrder[a.dayType] || 0) - (dayOrder[b.dayType] || 0);
            });

            if (firstDraftContent && loadedDrafts.length > 0) {
                setSiblingDrafts(loadedDrafts);
                setCurrentEditorDraftId(loadedDrafts[0].id);
                setEditorInitialContent(firstDraftContent);
                setEditorBasedOn(firstDraftBasedOn);
                setViewMode('editor');
            } else {
                toast?.error('Error', 'No drafts could be loaded');
                setViewMode('drafts');
            }
        } catch (error) {
            console.error('Failed to load drafts:', error);
            toast?.error('Error', 'Failed to load imported drafts');
            setViewMode('drafts');
        }
    };

    // Switch to a different sibling draft
    const handleSwitchDraft = async (draftId: string) => {
        if (!user) return;
        try {
            const draft = await getDraft(user.uid, draftId);
            if (draft?.content) {
                setCurrentEditorDraftId(draftId);
                setEditorInitialContent(draft.content);
                setEditorBasedOn(draft.basedOn);
            }
        } catch (error) {
            console.error('Failed to switch draft:', error);
            toast?.error('Error', 'Failed to load route');
        }
    };

    // --- Render Logic ---

    // 1. Dashboard View
    if (viewMode === 'dashboard') {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-6xl mx-auto pt-8">
                <div className="mb-8 px-4">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Fixed Route Operations</h2>
                    <p className="text-gray-500">Select a tool to manage schedules or analyze performance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
                    <DashboardCard onClick={handleOpenMasterSchedule} icon={<FileSpreadsheet size={20} />} color="purple"
                        title="Master Schedule" description="Browse Barrie Transits Current Schedule." />

                    <DashboardCard onClick={() => setViewMode('drafts')} icon={<Edit3 size={20} />} color="indigo"
                        title="Schedule Editor" description="Edit drafts and publish to Master Schedule. The main workflow for schedule changes." />

                    <DashboardCard onClick={handleOpenNewSchedule} icon={<CalendarPlus size={20} />} color="emerald"
                        title="New Schedules" description="Generate optimized schedules from scratch using Transify data." />

                    <DashboardCard onClick={() => user ? setShowGTFSImport(true) : toast.warning('Sign In Required', 'Please sign in to import from GTFS')}
                        icon={<Database size={20} />} color="indigo"
                        title="Import from GTFS" description="Import existing Barrie Transit schedules from the GTFS feed." />

                    <DashboardCard onClick={() => setViewMode('reports')} icon={<FileText size={20} />} color="amber"
                        title="Timetable Publisher" description="Generate public timetables and GTFS exports." />

                    <DashboardCard onClick={() => setViewMode('analytics')} icon={<GitBranch size={20} />} color="cyan"
                        title="Analytics" description="Analyze rider demand, route performance, and connections from Transit App data." />

                    <DashboardCard onClick={() => setViewMode('performance')} icon={<Clock size={20} />} color="amber"
                        title="Operations Dashboard" description="OTP, ridership, and load profiles from STREETS AVL/APC data." />

                    <DashboardCard onClick={() => setViewMode('perf-reports')} icon={<FileText size={20} />} color="cyan"
                        title="STREETS Reports" description="Weekly summaries, route deep-dives, and AI-powered analysis of STREETS data." />
                </div>

                {/* GTFS Import Modal */}
                {user && (
                    <GTFSImportModal
                        isOpen={showGTFSImport}
                        onClose={() => setShowGTFSImport(false)}
                        userId={user.uid}
                        onImportComplete={async (result) => {
                            if (result.success) {
                                toast.success('GTFS Import Complete', result.warnings?.[0] || 'Routes imported successfully');
                                setShowGTFSImport(false);

                                // Bulk import with multiple drafts
                                if (result.allDraftIds && result.allDraftIds.length > 1) {
                                    await openEditorWithSiblings(result.allDraftIds);
                                } else if (result.draftId) {
                                    // Single import: open the draft in editor
                                    try {
                                        const draft = await getDraft(user.uid, result.draftId);
                                        if (draft?.content) {
                                            openEditorWorkspace(draft.content, draft.basedOn);
                                        } else {
                                            setViewMode('drafts');
                                        }
                                    } catch (error) {
                                        console.error('Failed to load imported draft:', error);
                                        setViewMode('drafts');
                                    }
                                }
                            }
                        }}
                        onSystemImportComplete={async (result) => {
                            if (result.success && result.systemDraftId) {
                                toast.success(
                                    'System Draft Created',
                                    `Imported ${result.routeCount} routes for ${result.dayType}`
                                );
                                setShowGTFSImport(false);

                                // Load and open the system draft
                                try {
                                    const systemDraft = await getSystemDraft(user.uid, result.systemDraftId);
                                    if (systemDraft) {
                                        setActiveSystemDraft(systemDraft);
                                        setViewMode('system-editor');
                                    }
                                } catch (error) {
                                    console.error('Failed to load system draft:', error);
                                    toast.error('Error', 'Failed to open system draft');
                                }
                            }
                        }}
                    />
                )}
            </div>
        );
    }

    // 2. Active Workspace Views
    return (
        <div className="flex flex-col h-full">
            {/* Navigation Header - hidden for new-schedule since wizard has its own */}
            {viewMode !== 'new-schedule' && (
                <div className="flex items-center gap-2 mb-3 px-4">
                    <button
                        onClick={() => setViewMode('dashboard')}
                        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors"
                    >
                        <ArrowLeft size={14} /> Back to Dashboard
                    </button>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {VIEW_MODE_LABELS[viewMode]}
                    </div>
                </div>
            )}

            <div className="flex-grow overflow-hidden relative bg-white rounded-3xl border-2 border-gray-100 shadow-sm">
                <div className="absolute inset-0">
                    {viewMode === 'new-schedule' && (
                        <NewScheduleWizard
                            onBack={() => setViewMode('dashboard')}
                            onGenerate={(tables) => {
                                const buildResult = buildMasterContentFromTables(tables);
                                if (!buildResult) {
                                    alert('Unable to open editor: multiple routes or day types detected.');
                                    return;
                                }
                                openEditorWorkspace(buildResult.content, { type: 'generated' });
                            }}
                        />
                    )}

                    {viewMode === 'master' && (
                        <MasterScheduleBrowser
                            onCopyToDraft={(content, routeIdentity) => {
                                openEditorWorkspace(content, { type: 'master', id: routeIdentity });
                            }}
                            onClose={() => setViewMode('dashboard')}
                        />
                    )}

                    {viewMode === 'editor' && editorInitialContent && (
                        <ScheduleEditorWorkspace
                            key={currentEditorDraftId || 'single'} // Re-mount when switching drafts
                            initialContent={editorInitialContent}
                            basedOn={editorBasedOn}
                            onClose={() => setViewMode('dashboard')}
                            siblingDrafts={siblingDrafts}
                            currentDraftId={currentEditorDraftId || undefined}
                            onSwitchDraft={handleSwitchDraft}
                        />
                    )}

                    {viewMode === 'system-editor' && activeSystemDraft && (
                        <SystemDraftEditorWorkspace
                            key={activeSystemDraft.id}
                            systemDraft={activeSystemDraft}
                            onClose={() => {
                                setActiveSystemDraft(null);
                                setViewMode('dashboard');
                            }}
                            onDraftUpdated={(updated) => setActiveSystemDraft(updated)}
                        />
                    )}

                    {viewMode === 'drafts' && (
                        <div className="p-8 h-full overflow-auto custom-scrollbar">
                            <div className="max-w-4xl mx-auto">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-gray-900">My Drafts</h2>
                                        <p className="text-gray-500 text-sm">Edit and publish your schedule drafts</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={fetchDrafts}
                                            disabled={draftsLoading}
                                            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                            title="Refresh"
                                        >
                                            <RefreshCw size={20} className={draftsLoading ? 'animate-spin' : ''} />
                                        </button>
                                        {drafts.length > 0 && (
                                            deleteAllConfirm ? (
                                                <div className="flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                                                    <span className="text-sm text-red-700 font-medium">Delete {drafts.length} drafts?</span>
                                                    <button
                                                        onClick={handleDeleteAllDrafts}
                                                        disabled={deletingAll}
                                                        className="px-3 py-1 bg-red-600 text-white text-sm font-bold rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                                                    >
                                                        {deletingAll ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                        {deletingAll ? 'Deleting...' : 'Yes'}
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteAllConfirm(false)}
                                                        disabled={deletingAll}
                                                        className="px-3 py-1 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300 disabled:opacity-50"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setDeleteAllConfirm(true)}
                                                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                                                    title="Delete all drafts"
                                                >
                                                    <Trash2 size={18} />
                                                    Delete All
                                                </button>
                                            )
                                        )}
                                        <button
                                            onClick={() => setViewMode('master')}
                                            className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                                        >
                                            + New Draft
                                        </button>
                                    </div>
                                </div>

                                {/* Loading State */}
                                {draftsLoading && drafts.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-16">
                                        <Loader2 className="text-indigo-500 animate-spin mb-4" size={48} />
                                        <p className="text-gray-500">Loading drafts...</p>
                                    </div>
                                )}

                                {/* Empty State */}
                                {!draftsLoading && drafts.length === 0 && (
                                    <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
                                        <div className="bg-indigo-50 p-6 rounded-full inline-block mb-6">
                                            <Edit3 size={48} className="text-indigo-500" />
                                        </div>
                                        <h3 className="text-xl font-bold text-gray-900 mb-2">No drafts yet</h3>
                                        <p className="text-gray-500 mb-6 max-w-md mx-auto">
                                            Create a draft from the Master Schedule or import from GTFS.
                                        </p>
                                        <div className="flex items-center justify-center gap-3">
                                            <button
                                                onClick={() => setViewMode('master')}
                                                className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                                            >
                                                Browse Master Schedule
                                            </button>
                                            <button
                                                onClick={() => user ? setShowGTFSImport(true) : toast.warning('Sign In Required', 'Please sign in to import from GTFS')}
                                                className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                                            >
                                                Import from GTFS
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* System Drafts Section */}
                                <SystemDraftList
                                    onSelectDraft={(draft) => {
                                        setActiveSystemDraft(draft);
                                        setViewMode('system-editor');
                                    }}
                                    className="mb-8"
                                />

                                {/* Regular Drafts List */}
                                {drafts.length > 0 && (
                                    <div className="space-y-3">
                                        {drafts.map(draft => (
                                            <div
                                                key={draft.id}
                                                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-3 mb-1">
                                                            <h3 className="font-bold text-gray-900 truncate">{draft.name}</h3>
                                                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                                draft.status === 'ready_for_review'
                                                                    ? 'bg-amber-100 text-amber-700'
                                                                    : 'bg-gray-100 text-gray-600'
                                                            }`}>
                                                                {draft.status === 'ready_for_review' ? 'Ready for Review' : draft.status}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-4 text-sm text-gray-500">
                                                            <span>Route {draft.routeNumber}</span>
                                                            <span>{draft.dayType}</span>
                                                            {draft.basedOn?.type && (
                                                                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded">
                                                                    from {draft.basedOn.type}
                                                                </span>
                                                            )}
                                                            <span className="flex items-center gap-1">
                                                                <Clock size={14} />
                                                                {draft.updatedAt?.toLocaleDateString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 ml-4">
                                                        <button
                                                            onClick={() => handleOpenDraft(draft)}
                                                            disabled={loadingDraftId === draft.id}
                                                            className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                                        >
                                                            {loadingDraftId === draft.id ? (
                                                                <Loader2 size={16} className="animate-spin" />
                                                            ) : (
                                                                <Edit3 size={16} />
                                                            )}
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => draft.id && handleDeleteDraft(draft.id)}
                                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="Delete draft"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {viewMode === 'reports' && (
                        <ReportsDashboard onClose={() => setViewMode('dashboard')} />
                    )}

                    {viewMode === 'analytics' && (
                        <AnalyticsDashboard onClose={() => setViewMode('dashboard')} />
                    )}

                    {viewMode === 'performance' && (
                        <PerformanceDashboard onClose={() => setViewMode('dashboard')} />
                    )}

                    {viewMode === 'perf-reports' && (
                        <PerfReportsWorkspace onClose={() => setViewMode('dashboard')} />
                    )}
                </div>
            </div>

            {/* GTFS Import Modal - rendered at root level for all non-dashboard views */}
            {user && (
                <GTFSImportModal
                    isOpen={showGTFSImport}
                    onClose={() => setShowGTFSImport(false)}
                    userId={user.uid}
                    onImportComplete={async (result) => {
                        if (result.success && result.draftId) {
                            const isBulkImport = result.warnings?.some(w => w.includes('Imported') && w.includes('of'));
                            if (isBulkImport) {
                                toast.success('GTFS Import Complete', result.warnings?.[0] || 'Routes imported successfully');
                                setShowGTFSImport(false);
                                setViewMode('drafts');
                                setTimeout(() => fetchDrafts(), 100);
                            } else {
                                toast.success('GTFS Import Complete', `Created draft for ${result.routeIdentity}`);
                                setShowGTFSImport(false);
                                try {
                                    const draft = await getDraft(user.uid, result.draftId);
                                    if (draft?.content) {
                                        setEditorInitialContent(draft.content);
                                        setEditorBasedOn(draft.basedOn);
                                        setViewMode('editor');
                                    } else {
                                        setViewMode('drafts');
                                        setTimeout(() => fetchDrafts(), 100);
                                    }
                                } catch (error) {
                                    console.error('Failed to load imported draft:', error);
                                    setViewMode('drafts');
                                    setTimeout(() => fetchDrafts(), 100);
                                }
                            }
                        }
                    }}
                    onSystemImportComplete={async (result) => {
                        if (result.success && result.systemDraftId) {
                            toast.success(
                                'System Draft Created',
                                `Imported ${result.routeCount} routes for ${result.dayType}`
                            );
                            setShowGTFSImport(false);

                            // Load and open the system draft
                            try {
                                const systemDraft = await getSystemDraft(user.uid, result.systemDraftId);
                                if (systemDraft) {
                                    setActiveSystemDraft(systemDraft);
                                    setViewMode('system-editor');
                                }
                            } catch (error) {
                                console.error('Failed to load system draft:', error);
                                toast.error('Error', 'Failed to open system draft');
                            }
                        }
                    }}
                />
            )}
        </div>
    );
};

