
import React from 'react';
import {
    FileText,
    Timer,
    History,
    Loader2,
    Cloud,
    CloudOff,
    Check,
    Download,
    Maximize2,
    Minimize2,
    Undo2,
    Redo2,
    GanttChart,
    Link2,
    Sparkles,
    FolderOpen,
    Pencil,
    Plus,
    Copy
} from 'lucide-react';
import { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import { AutoSaveStatus } from '../../hooks/useAutoSave';
import { RouteSummary } from '../RouteSummary';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';

// Time Band type
interface TimeBandDisplay {
    id: string;
    color: string;
    avg: number;
}

interface WorkspaceHeaderProps {
    routeGroupName: string;
    dayLabel: string;
    isRoundTrip: boolean;
    subView: 'editor' | 'matrix' | 'timeline';
    onViewChange: (view: 'editor' | 'matrix' | 'timeline') => void;
    onSaveVersion: (label?: string) => void;
    autoSaveStatus: AutoSaveStatus;
    lastSaved: Date | null;
    hasUnsavedChanges: boolean;
    summaryTable: MasterRouteTable;
    // New file management props
    draftName?: string;
    onRenameDraft?: (newName: string) => void;
    onOpenDrafts?: () => void;
    onNewDraft?: () => void;
    onDuplicateDraft?: () => void;
    onExport?: () => void;
    onClose?: () => void;
    // Fullscreen
    isFullScreen?: boolean;
    onToggleFullScreen?: () => void;
    // Time bands
    bands?: TimeBandDisplay[];
    // Undo/Redo
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    // Hide autosave when parent handles it
    hideAutoSave?: boolean;
    // Publish action
    onPublish?: () => void;
    publishLabel?: string;
    isPublishing?: boolean;
    publishDisabled?: boolean;
    // Connections panel
    onOpenConnections?: () => void;
    // AI review panel
    onOpenAiReview?: () => void;
    // Preview-specific compact mode
    hideRouteIdentity?: boolean;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
    routeGroupName,
    dayLabel,
    isRoundTrip,
    subView,
    onViewChange,
    onSaveVersion,
    autoSaveStatus,
    lastSaved,
    hasUnsavedChanges,
    summaryTable,
    draftName,
    onRenameDraft,
    onOpenDrafts,
    onNewDraft,
    onDuplicateDraft,
    onExport,
    onClose,
    isFullScreen,
    onToggleFullScreen,
    bands,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    hideAutoSave,
    onPublish,
    publishLabel = 'Publish',
    isPublishing = false,
    publishDisabled = false,
    onOpenConnections,
    onOpenAiReview,
    hideRouteIdentity = false
}) => {
    const [isRenamingDraft, setIsRenamingDraft] = React.useState(false);
    const [renameDraftValue, setRenameDraftValue] = React.useState(draftName || '');
    const exportButtonTitle = draftName ? `Export "${draftName}" to Excel` : 'Export this draft to Excel';

    React.useEffect(() => {
        setRenameDraftValue(draftName || '');
    }, [draftName]);

    const handleDraftRename = () => {
        const nextName = renameDraftValue.trim();
        if (nextName && onRenameDraft) {
            onRenameDraft(nextName);
        } else {
            setRenameDraftValue(draftName || '');
        }
        setIsRenamingDraft(false);
    };

    return (
        <div className="bg-white border-b border-gray-200 px-3 md:px-4 py-2.5 sticky top-0 z-60 shadow-sm">
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        {!hideRouteIdentity && (
                            <div
                                className="w-11 h-11 rounded-xl flex flex-col items-center justify-center shadow-sm ring-1 ring-black/5 flex-shrink-0"
                                style={{
                                    backgroundColor: getRouteColor(routeGroupName),
                                    color: getRouteTextColor(routeGroupName)
                                }}
                            >
                                <span className="text-[11px] uppercase font-bold opacity-90 leading-none">Route</span>
                                <span className="text-lg font-bold leading-none mt-0.5">{routeGroupName.replace(/\D/g, '')}</span>
                            </div>
                        )}

                        <div className="min-w-0">
                            <h2 className="text-base md:text-lg font-bold text-gray-900 leading-tight truncate">
                                {dayLabel} Schedule
                            </h2>

                            {draftName && (
                                <div className="mt-1">
                                    {isRenamingDraft && onRenameDraft ? (
                                        <input
                                            autoFocus
                                            value={renameDraftValue}
                                            onChange={(e) => setRenameDraftValue(e.target.value)}
                                            onBlur={handleDraftRename}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleDraftRename();
                                                if (e.key === 'Escape') {
                                                    setRenameDraftValue(draftName);
                                                    setIsRenamingDraft(false);
                                                }
                                            }}
                                            className="w-full max-w-[360px] rounded-md border border-blue-200 px-2.5 py-1.5 text-sm font-semibold text-gray-800 outline-none ring-2 ring-blue-100"
                                        />
                                    ) : (
                                        <button
                                            onClick={() => onRenameDraft && setIsRenamingDraft(true)}
                                            disabled={!onRenameDraft}
                                            className="flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-gray-50"
                                            title={onRenameDraft ? 'Rename draft' : undefined}
                                        >
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                                Draft
                                            </span>
                                            <span className="max-w-[320px] truncate text-gray-700">{draftName}</span>
                                            {onRenameDraft && <Pencil size={12} className="text-gray-400 flex-shrink-0" />}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                        {/* Undo/Redo Buttons */}
                        {onUndo && onRedo && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                    onClick={onUndo}
                                    disabled={!canUndo}
                                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                    title="Undo (Ctrl+Z)"
                                >
                                    <Undo2 size={16} />
                                </button>
                                <button
                                    onClick={onRedo}
                                    disabled={!canRedo}
                                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                    title="Redo (Ctrl+Y)"
                                >
                                    <Redo2 size={16} />
                                </button>
                            </div>
                        )}

                        {/* Fullscreen Toggle */}
                        {onToggleFullScreen && (
                            <button
                                onClick={onToggleFullScreen}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 flex-shrink-0"
                                title={isFullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
                            >
                                {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </button>
                        )}

                        {/* Save Status - compact inline */}
                        {!hideAutoSave && (
                            <div className="flex items-center gap-1.5 text-sm font-medium flex-shrink-0 px-2">
                                {autoSaveStatus === 'saving' && (
                                    <>
                                        <Loader2 size={12} className="animate-spin text-blue-500" />
                                        <span className="text-blue-700">Saving...</span>
                                    </>
                                )}
                                {autoSaveStatus === 'saved' && (
                                    <div className="flex items-center gap-1.5 group cursor-help relative">
                                        <Cloud size={12} className="text-emerald-500" />
                                        <span className="text-emerald-700">Saved</span>
                                        {lastSaved && (
                                            <div className="absolute top-full right-0 mt-1 bg-gray-800 text-white text-[11px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                                Last saved: {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {autoSaveStatus === 'error' && (
                                    <>
                                        <CloudOff size={12} className="text-red-500" />
                                        <span className="text-red-600">Error</span>
                                    </>
                                )}
                                {autoSaveStatus === 'idle' && hasUnsavedChanges && (
                                    <>
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                        <span className="text-amber-600">Unsaved</span>
                                    </>
                                )}
                                {autoSaveStatus === 'idle' && !hasUnsavedChanges && (
                                    <div className="flex items-center gap-1.5 opacity-50">
                                        <Check size={12} className="text-gray-400" />
                                        <span className="text-gray-500">Ready</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {onSaveVersion && (
                            <button
                                onClick={() => onSaveVersion()}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 flex items-center gap-2 flex-shrink-0"
                                title="Save draft now"
                            >
                                <History size={14} />
                                Save now
                            </button>
                        )}

                        {onOpenDrafts && (
                            <button
                                onClick={onOpenDrafts}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 flex items-center gap-2 flex-shrink-0"
                                title="Open drafts"
                            >
                                <FolderOpen size={14} />
                                Drafts
                            </button>
                        )}

                        {onNewDraft && (
                            <button
                                onClick={onNewDraft}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 flex items-center gap-2 flex-shrink-0"
                                title="Create a new draft"
                            >
                                <Plus size={14} />
                                New draft
                            </button>
                        )}

                        {onDuplicateDraft && (
                            <button
                                onClick={onDuplicateDraft}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 flex items-center gap-2 flex-shrink-0"
                                title="Duplicate the current draft"
                            >
                                <Copy size={14} />
                                Duplicate
                            </button>
                        )}

                        {onExport && (
                            <button
                                onClick={onExport}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 flex items-center gap-2 flex-shrink-0"
                                title={exportButtonTitle}
                            >
                                <Download size={14} />
                                Export Draft
                            </button>
                        )}

                        {onPublish && (
                            <button
                                onClick={onPublish}
                                disabled={publishDisabled || isPublishing}
                                className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 flex-shrink-0"
                            >
                                {isPublishing ? 'Publishing...' : publishLabel}
                            </button>
                        )}

                        <div className="hidden 2xl:block">
                            <RouteSummary table={summaryTable} orientation="header" />
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* View Toggles (Segmented Control) */}
                    <div className="bg-gray-100/80 p-1 rounded-lg flex items-center flex-shrink-0">
                        <button
                            onClick={() => onViewChange('editor')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${subView === 'editor'
                                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200/50'
                                }`}
                        >
                            <FileText size={14} /> Schedule
                        </button>
                        <button
                            onClick={() => onViewChange('timeline')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${subView === 'timeline'
                                ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-black/5'
                                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200/50'
                                }`}
                        >
                            <GanttChart size={14} /> Timeline
                        </button>
                        <button
                            onClick={() => onViewChange('matrix')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${subView === 'matrix'
                                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5'
                                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200/50'
                                }`}
                        >
                            <Timer size={14} /> Travel Times
                        </button>
                    </div>

                    {onOpenConnections && (
                        <button
                            onClick={onOpenConnections}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-100 text-green-800 hover:bg-green-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 flex-shrink-0"
                            title="Configure external connections (GO Train, College)"
                        >
                            <Link2 size={14} /> Connections
                        </button>
                    )}

                    {onOpenAiReview && (
                        <button
                            onClick={onOpenAiReview}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold bg-violet-100 text-violet-800 hover:bg-violet-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 flex-shrink-0"
                            title="Open AI Review"
                        >
                            <Sparkles size={14} /> AI Review
                        </button>
                    )}

                    {/* Time Bands - hidden on smaller screens */}
                    {bands && bands.length > 0 && (
                        <div className="hidden xl:flex items-center gap-3 pl-2">
                            <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Time Bands</span>
                            {bands.map(band => (
                                <div key={band.id} className="flex items-center gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                                    <span className="text-sm font-semibold text-gray-700">{band.id}</span>
                                    <span className="text-sm text-gray-600">{band.avg.toFixed(0)}m</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
