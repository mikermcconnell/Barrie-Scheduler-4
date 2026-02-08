
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
    Link2
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
    // Connections panel
    onOpenConnections?: () => void;
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
    publishDisabled = false,
    onOpenConnections
}) => {
    return (
        <div className="bg-white border-b border-gray-200 px-3 md:px-4 py-2.5 sticky top-0 z-60 shadow-sm">
            <div className="flex items-center gap-3">
                {/* Route Identity */}
                <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
                    <div
                        className="w-11 h-11 rounded-xl flex flex-col items-center justify-center shadow-sm ring-1 ring-black/5"
                        style={{
                            backgroundColor: getRouteColor(routeGroupName),
                            color: getRouteTextColor(routeGroupName)
                        }}
                    >
                        <span className="text-[11px] uppercase font-bold opacity-90 leading-none">Route</span>
                        <span className="text-lg font-bold leading-none mt-0.5">{routeGroupName.replace(/\D/g, '')}</span>
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-base md:text-lg font-bold text-gray-900 leading-tight truncate">{dayLabel} Schedule</h2>
                    </div>
                </div>

                {/* Time Bands - hidden on smaller screens */}
                {bands && bands.length > 0 && (
                    <>
                        <div className="hidden xl:block h-8 w-px bg-gray-200"></div>
                        <div className="hidden xl:flex items-center gap-3">
                            <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Time Bands</span>
                            {bands.map(band => (
                                <div key={band.id} className="flex items-center gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                                    <span className="text-sm font-semibold text-gray-700">{band.id}</span>
                                    <span className="text-sm text-gray-600">{band.avg.toFixed(0)}m</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <div className="h-8 w-px bg-gray-200"></div>

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

                {/* Connections Button */}
                {onOpenConnections && (
                    <>
                        <div className="h-8 w-px bg-gray-200" />
                        <button
                            onClick={onOpenConnections}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-100 text-green-800 hover:bg-green-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 flex-shrink-0"
                            title="Configure external connections (GO Train, College)"
                        >
                            <Link2 size={14} /> Connections
                        </button>
                    </>
                )}

                {/* Undo/Redo Buttons */}
                {onUndo && onRedo && (
                    <>
                        <div className="h-8 w-px bg-gray-200" />
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
                    </>
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

                {/* Spacer */}
                <div className="flex-1" />

                {/* Save Status - compact inline */}
                {!hideAutoSave && (
                    <div className="flex items-center gap-1.5 text-sm font-medium flex-shrink-0">
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

                {/* Publish Button */}
                {onPublish && (
                    <button
                        onClick={onPublish}
                        disabled={publishDisabled || isPublishing}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 flex-shrink-0"
                    >
                        {isPublishing ? 'Publishing...' : publishLabel}
                    </button>
                )}

                {/* Route stats summary */}
                <RouteSummary table={summaryTable} orientation="header" />
            </div>
        </div>
    );
};
