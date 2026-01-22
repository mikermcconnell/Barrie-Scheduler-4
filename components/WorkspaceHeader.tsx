
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
    GanttChart
} from 'lucide-react';
import { MasterRouteTable } from '../utils/masterScheduleParser';
import { AutoSaveStatus } from '../hooks/useAutoSave';
import { RouteSummary } from './RouteSummary';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';

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
    publishDisabled = false
}) => {
    return (
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-60 transition-all shadow-sm">
            {/* Left Section: File Menu & Route Info */}
            <div className="flex items-center gap-4">

                    {/* Route Identity */}
                <div className="flex items-center gap-3">
                    <div
                        className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shadow-sm ring-1 ring-black/5"
                        style={{
                            backgroundColor: getRouteColor(routeGroupName),
                            color: getRouteTextColor(routeGroupName)
                        }}
                    >
                        <span className="text-[10px] uppercase font-bold opacity-80 leading-none">Route</span>
                        <span className="text-xl font-bold leading-none mt-0.5">{routeGroupName.replace(/\D/g, '')}</span>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 leading-tight">{dayLabel} Schedule</h2>
                    </div>
                </div>

                {/* Time Bands - Always visible */}
                {bands && bands.length > 0 && (
                    <>
                        <div className="h-8 w-px bg-gray-200 mx-2"></div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Time Bands</span>
                            {bands.map(band => (
                                <div key={band.id} className="flex items-center gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                                    <span className="text-xs font-medium text-gray-600">{band.id}</span>
                                    <span className="text-xs text-gray-400">{band.avg.toFixed(0)}m</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <div className="h-8 w-px bg-gray-200 mx-2"></div>

                {/* View Toggles (Segmented Control) */}
                <div className="bg-gray-100/80 p-1 rounded-lg flex items-center">
                    <button
                        onClick={() => onViewChange('editor')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${subView === 'editor'
                            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                    >
                        <FileText size={14} /> Schedule
                    </button>
                    <button
                        onClick={() => onViewChange('timeline')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${subView === 'timeline'
                            ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                    >
                        <GanttChart size={14} /> Timeline
                    </button>
                    <button
                        onClick={() => onViewChange('matrix')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${subView === 'matrix'
                            ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                    >
                        <Timer size={14} /> Travel Times
                    </button>
                </div>

                {/* Undo/Redo Buttons */}
                {onUndo && onRedo && (
                    <>
                        <div className="h-8 w-px bg-gray-200" />
                        <div className="flex items-center gap-1">
                            <button
                                onClick={onUndo}
                                disabled={!canUndo}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                title="Undo (Ctrl+Z)"
                            >
                                <Undo2 size={16} />
                            </button>
                            <button
                                onClick={onRedo}
                                disabled={!canRedo}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                title="Redo (Ctrl+Y)"
                            >
                                <Redo2 size={16} />
                            </button>
                        </div>
                    </>
                )}

                {/* Fullscreen Toggle */}
                {onToggleFullScreen && (
                    <button
                        onClick={onToggleFullScreen}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                        title={isFullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    >
                        {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                )}
            </div>

            {/* Right Section: Actions & Stats */}
            <div className="flex items-center gap-4">

                {/* Save Controls - hidden when parent handles autosave */}
                {!hideAutoSave && (
                    <>
                        <div className="flex items-center gap-4 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                            {!draftName && (
                                <>
                                    <button
                                        onClick={() => {
                                            const label = window.prompt('Enter a label for this version (optional):');
                                            onSaveVersion(label || undefined);
                                        }}
                                        className="flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-gray-600 hover:text-blue-600 hover:bg-blue-50/80 rounded transition-all active:scale-95"
                                        title="Save a named version"
                                    >
                                        <History size={14} />
                                        Save Version
                                    </button>

                                    <div className="h-4 w-px bg-gray-200"></div>
                                </>
                            )}

                            {/* Auto-save Status */}
                            <div className="flex items-center gap-1.5 text-xs font-medium min-w-[100px] justify-end">
                                {autoSaveStatus === 'saving' && (
                                    <div className="flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin text-blue-500" />
                                        <span className="text-blue-600">Saving...</span>
                                    </div>
                                )}
                                {autoSaveStatus === 'saved' && (
                                    <div className="flex items-center gap-1.5 group cursor-help relative">
                                        <Cloud size={12} className="text-emerald-500" />
                                        <span className="text-emerald-600">Saved</span>
                                        {lastSaved && (
                                            <div className="absolute top-full right-0 mt-1 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                                Last saved: {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {autoSaveStatus === 'error' && (
                                    <div className="flex items-center gap-1.5">
                                        <CloudOff size={12} className="text-red-500" />
                                        <span className="text-red-600">Error</span>
                                    </div>
                                )}
                                {autoSaveStatus === 'idle' && hasUnsavedChanges && (
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                        <span className="text-amber-600">Unsaved</span>
                                    </div>
                                )}
                                {autoSaveStatus === 'idle' && !hasUnsavedChanges && (
                                    <div className="flex items-center gap-1.5 opacity-50">
                                        <Check size={12} className="text-gray-400" />
                                        <span className="text-gray-400">Ready</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="h-8 w-px bg-gray-200"></div>
                    </>
                )}

                {onPublish && (
                    <>
                        <button
                            onClick={onPublish}
                            disabled={publishDisabled || isPublishing}
                            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPublishing ? 'Publishing...' : publishLabel}
                        </button>
                        <div className="h-8 w-px bg-gray-200"></div>
                    </>
                )}

                {/* Stats */}
                {/* Stats - Hide in RoundTrip view as it has its own metrics header */}
                {!isRoundTrip && <RouteSummary table={summaryTable} orientation="header" />}
            </div>
        </div>
    );
};
