import React from 'react';
import {
    CalendarDays,
    Check,
    Cloud,
    CloudOff,
    Copy,
    Download,
    FileText,
    FolderOpen,
    GanttChart,
    History,
    Link2,
    Loader2,
    Maximize2,
    Minimize2,
    MoreHorizontal,
    Pencil,
    Plus,
    Redo2,
    Sparkles,
    Timer,
    Undo2,
} from 'lucide-react';
import { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import { AutoSaveStatus } from '../../hooks/useAutoSave';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';

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
    draftName?: string;
    onRenameDraft?: (newName: string) => void;
    onOpenDrafts?: () => void;
    onNewDraft?: () => void;
    onDuplicateDraft?: () => void;
    onExport?: () => void;
    onClose?: () => void;
    isFullScreen?: boolean;
    onToggleFullScreen?: () => void;
    bands?: TimeBandDisplay[];
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    hideAutoSave?: boolean;
    onPublish?: () => void;
    publishLabel?: string;
    isPublishing?: boolean;
    publishDisabled?: boolean;
    onOpenConnections?: () => void;
    onOpenAiReview?: () => void;
    onOpenTimetable?: () => void;
    hideRouteIdentity?: boolean;
    compactTools?: boolean;
    /** Label for the exact schedule this draft was copied or generated from. */
    sourceLabel?: string;
    /** Number of detected changes from the source schedule. */
    changeCount?: number;
    /** Number of warnings that still need planner attention. */
    warningCount?: number;
    /** Opens the review/change summary. When present, this is the single primary header action. */
    onReviewChanges?: () => void;
    reviewChangesDisabled?: boolean;
}

const closeParentMenu = (target: HTMLElement) => {
    target.closest('details')?.removeAttribute('open');
};

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
    routeGroupName,
    dayLabel,
    subView,
    onViewChange,
    onSaveVersion,
    autoSaveStatus,
    lastSaved,
    hasUnsavedChanges,
    draftName,
    onRenameDraft,
    onOpenDrafts,
    onNewDraft,
    onDuplicateDraft,
    onExport,
    isFullScreen,
    onToggleFullScreen,
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
    onOpenTimetable,
    hideRouteIdentity = false,
    compactTools = false,
    sourceLabel,
    changeCount,
    warningCount,
    onReviewChanges,
    reviewChangesDisabled = false,
}) => {
    const [isRenamingDraft, setIsRenamingDraft] = React.useState(false);
    const [renameDraftValue, setRenameDraftValue] = React.useState(draftName || '');

    React.useEffect(() => {
        setRenameDraftValue(draftName || '');
    }, [draftName]);

    const handleDraftRename = () => {
        const nextName = renameDraftValue.trim();
        if (nextName && onRenameDraft) onRenameDraft(nextName);
        else setRenameDraftValue(draftName || '');
        setIsRenamingDraft(false);
    };

    const menuActionClass = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
    const activeViewLabel = subView === 'editor' ? 'Schedule' : subView === 'timeline' ? 'Timeline' : 'Travel Times';

    const saveStatus = !hideAutoSave && (
        <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-gray-600" aria-live="polite">
            {autoSaveStatus === 'saving' && <><Loader2 size={13} className="animate-spin text-blue-500" /> Saving</>}
            {autoSaveStatus === 'saved' && <><Cloud size={13} className="text-emerald-600" /> Saved</>}
            {autoSaveStatus === 'error' && (
                <>
                    <CloudOff size={13} className="text-red-600" />
                    <span className="text-red-700">Save error</span>
                    <button
                        type="button"
                        onClick={() => onSaveVersion()}
                        className="rounded px-1.5 py-0.5 font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                    >
                        Retry
                    </button>
                </>
            )}
            {autoSaveStatus === 'idle' && hasUnsavedChanges && <><span className="h-2 w-2 rounded-full bg-amber-400" /> Unsaved</>}
            {autoSaveStatus === 'idle' && !hasUnsavedChanges && <><Check size={13} className="text-gray-400" /> Ready</>}
            {lastSaved && autoSaveStatus === 'saved' && (
                <span className="sr-only">Last saved {lastSaved.toLocaleTimeString()}</span>
            )}
        </div>
    );

    return (
        <header className={`sticky top-0 z-60 border-b border-gray-200 bg-white shadow-sm ${compactTools ? 'px-3 py-1' : 'px-4 py-2'}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                {!hideRouteIdentity && !compactTools && (
                    <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold shadow-sm ring-1 ring-black/5"
                        style={{ backgroundColor: getRouteColor(routeGroupName), color: getRouteTextColor(routeGroupName) }}
                        aria-label={`Route ${routeGroupName}`}
                    >
                        {routeGroupName}
                    </div>
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-extrabold text-gray-900">
                            Route {routeGroupName} <span className="font-semibold text-gray-400">/</span> {dayLabel}
                        </h2>
                        {sourceLabel && (
                            <span className="max-w-56 truncate rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600" title={sourceLabel}>
                                From {sourceLabel}
                            </span>
                        )}
                        {typeof changeCount === 'number' && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                                {changeCount} change{changeCount === 1 ? '' : 's'}
                            </span>
                        )}
                        {typeof warningCount === 'number' && warningCount > 0 && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                {warningCount} warning{warningCount === 1 ? '' : 's'}
                            </span>
                        )}
                    </div>

                    {draftName && !compactTools && (
                        <div className="mt-0.5">
                            {isRenamingDraft && onRenameDraft ? (
                                <input
                                    autoFocus
                                    value={renameDraftValue}
                                    onChange={(event) => setRenameDraftValue(event.target.value)}
                                    onBlur={handleDraftRename}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') handleDraftRename();
                                        if (event.key === 'Escape') {
                                            setRenameDraftValue(draftName);
                                            setIsRenamingDraft(false);
                                        }
                                    }}
                                    aria-label="Draft name"
                                    className="w-full max-w-sm rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-gray-800 outline-none ring-2 ring-blue-100"
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onRenameDraft && setIsRenamingDraft(true)}
                                    disabled={!onRenameDraft}
                                    className="inline-flex max-w-sm items-center gap-1 truncate text-xs font-medium text-gray-500 hover:text-gray-800 disabled:cursor-default"
                                    title={onRenameDraft ? 'Rename draft' : undefined}
                                >
                                    <span className="truncate">{draftName}</span>
                                    {onRenameDraft && <Pencil size={11} />}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {saveStatus}

                {onUndo && onRedo && (
                    <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5" aria-label="Edit history">
                        <button type="button" onClick={onUndo} disabled={!canUndo} className="rounded-md p-1.5 text-gray-600 hover:bg-white disabled:opacity-35" title="Undo (Ctrl+Z)" aria-label="Undo">
                            <Undo2 size={15} />
                        </button>
                        <button type="button" onClick={onRedo} disabled={!canRedo} className="rounded-md p-1.5 text-gray-600 hover:bg-white disabled:opacity-35" title="Redo (Ctrl+Y)" aria-label="Redo">
                            <Redo2 size={15} />
                        </button>
                    </div>
                )}

                <details className="relative">
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                        {subView === 'editor' ? <FileText size={14} /> : subView === 'timeline' ? <GanttChart size={14} /> : <Timer size={14} />}
                        {activeViewLabel}
                    </summary>
                    <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                        <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">View</div>
                        {([
                            ['editor', 'Schedule', FileText],
                            ['timeline', 'Timeline', GanttChart],
                            ['matrix', 'Travel Times', Timer],
                        ] as const).map(([view, label, Icon]) => (
                            <button
                                key={view}
                                type="button"
                                onClick={(event) => { onViewChange(view); closeParentMenu(event.currentTarget); }}
                                className={`${menuActionClass} ${subView === view ? 'bg-blue-50 text-blue-800' : ''}`}
                                aria-current={subView === view ? 'page' : undefined}
                            >
                                <Icon size={15} /> {label}
                            </button>
                        ))}
                    </div>
                </details>

                <details className="relative">
                    <summary className="flex cursor-pointer list-none items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" aria-label="More schedule actions" title="More actions">
                        <MoreHorizontal size={17} />
                    </summary>
                    <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-60 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                        <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Draft actions</div>
                        {onSaveVersion && <button type="button" onClick={(event) => { onSaveVersion(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><History size={15} /> Save now</button>}
                        {onOpenDrafts && <button type="button" onClick={(event) => { onOpenDrafts(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><FolderOpen size={15} /> Drafts</button>}
                        {onNewDraft && <button type="button" onClick={(event) => { onNewDraft(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><Plus size={15} /> New draft</button>}
                        {onDuplicateDraft && <button type="button" onClick={(event) => { onDuplicateDraft(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><Copy size={15} /> Duplicate</button>}
                        {onExport && <button type="button" onClick={(event) => { onExport(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><Download size={15} /> Export draft</button>}
                        {onOpenTimetable && <button type="button" onClick={(event) => { onOpenTimetable(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><CalendarDays size={15} /> Timetable</button>}
                        {(onOpenConnections || onOpenAiReview || onToggleFullScreen) && <div className="my-1 border-t border-gray-100" />}
                        {onOpenConnections && <button type="button" onClick={(event) => { onOpenConnections(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><Link2 size={15} /> Connections</button>}
                        {onOpenAiReview && <button type="button" onClick={(event) => { onOpenAiReview(); closeParentMenu(event.currentTarget); }} className={menuActionClass}><Sparkles size={15} /> AI review</button>}
                        {onToggleFullScreen && <button type="button" onClick={(event) => { onToggleFullScreen(); closeParentMenu(event.currentTarget); }} className={menuActionClass}>{isFullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />} {isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}</button>}
                    </div>
                </details>

                {onReviewChanges ? (
                    <button
                        type="button"
                        onClick={onReviewChanges}
                        disabled={reviewChangesDisabled}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                    >
                        Review Changes{typeof changeCount === 'number' && changeCount > 0 ? ` (${changeCount})` : ''}
                    </button>
                ) : onPublish ? (
                    <button
                        type="button"
                        onClick={onPublish}
                        disabled={publishDisabled || isPublishing}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    >
                        {isPublishing ? 'Publishing…' : publishLabel}
                    </button>
                ) : null}
            </div>
        </header>
    );
};
