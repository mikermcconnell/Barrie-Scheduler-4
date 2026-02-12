/**
 * ScheduleSidebar Component
 *
 * Extracted from ScheduleEditor.tsx to handle:
 * - Route list with day pickers
 * - Upload to Master button
 * - Interline/Compare action buttons
 * - Undo/Redo buttons
 */

import React from 'react';
import {
    ChevronDown,
    ChevronRight,
    ArrowLeft,
    ArrowRight,
    Undo2,
    Redo2,
    GitCompare,
    Upload,
    Database
} from 'lucide-react';
import { getRouteColor, getRouteTextColor } from '../utils/config/routeColors';
import type { DayType } from '../utils/masterScheduleTypes';

export interface ConsolidatedRoute {
    name: string;
    days: Record<string, unknown>;
}

export interface ScheduleSidebarProps {
    // Route navigation
    consolidatedRoutes: ConsolidatedRoute[];
    activeRouteIdx: number;
    activeDay: string;
    onRouteSelect: (idx: number) => void;
    onDaySelect: (day: string) => void;

    // Actions
    onClose?: () => void;
    onUploadRoute?: (routeNumber: string, dayType: DayType) => void;
    onBulkUpload?: () => void;
    onShowComparison?: () => void;
    onShowInterlineConfig?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;

    // Display options
    readOnly?: boolean;
    teamId?: string;
    routesForUploadCount?: number;
    subView?: 'editor' | 'matrix' | 'timeline';
    hasOriginalSchedules?: boolean;
}

export const ScheduleSidebar: React.FC<ScheduleSidebarProps> = ({
    consolidatedRoutes,
    activeRouteIdx,
    activeDay,
    onRouteSelect,
    onDaySelect,
    onClose,
    onUploadRoute,
    onBulkUpload,
    onShowComparison,
    onShowInterlineConfig,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
    readOnly = false,
    teamId,
    routesForUploadCount = 0,
    subView = 'editor',
    hasOriginalSchedules = false
}) => {
    return (
        <div className="w-80 min-w-[320px] flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden z-20">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-wider">
                    {readOnly ? 'Master Schedule' : 'Route Tweaker'}
                </h2>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-xs text-blue-600 flex items-center gap-1"
                    >
                        <ArrowLeft size={10} /> Back
                    </button>
                )}
            </div>

            {/* Route List */}
            <div className="overflow-y-auto custom-scrollbar flex-grow p-4 space-y-2">
                {consolidatedRoutes.map((route, i) => (
                    <div key={route.name} className="space-y-1">
                        <button
                            onClick={() => onRouteSelect(i)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex justify-between items-center ${
                                i === activeRouteIdx
                                    ? 'bg-blue-50 text-blue-800'
                                    : 'text-gray-600 hover:bg-gray-50'
                            }`}
                            style={
                                i === activeRouteIdx
                                    ? {
                                          backgroundColor: getRouteColor(route.name),
                                          color: getRouteTextColor(route.name)
                                      }
                                    : undefined
                            }
                        >
                            Route {route.name}
                            {i === activeRouteIdx ? (
                                <ChevronDown size={14} />
                            ) : (
                                <ChevronRight size={14} />
                            )}
                        </button>

                        {i === activeRouteIdx && (
                            <div className="pl-3 space-y-1">
                                {['Weekday', 'Saturday', 'Sunday']
                                    .filter(d => Object.keys(route.days).includes(d))
                                    .map(day => (
                                        <div key={day} className="flex items-center gap-1">
                                            <button
                                                onClick={() => onDaySelect(day)}
                                                className={`flex-1 text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 ${
                                                    activeDay === day
                                                        ? 'bg-blue-100 font-bold text-blue-800'
                                                        : 'text-gray-500 hover:bg-gray-50'
                                                }`}
                                            >
                                                <div
                                                    className={`w-1.5 h-1.5 rounded-full ${
                                                        activeDay === day ? 'bg-blue-600' : 'bg-gray-300'
                                                    }`}
                                                />
                                                {day}
                                            </button>
                                            {teamId && !readOnly && onUploadRoute && (
                                                <button
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        onUploadRoute(route.name, day as DayType);
                                                    }}
                                                    className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                                                    title={`Upload Route ${route.name} (${day}) to Master`}
                                                >
                                                    <Upload size={12} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer Actions - hidden in readOnly mode */}
            {!readOnly && (
                <div className="border-t border-gray-100">
                    {/* Upload to Master Button */}
                    {teamId && onBulkUpload && (
                        <div className="p-3 border-b border-gray-100">
                            <button
                                onClick={onBulkUpload}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                            >
                                <Database size={16} />
                                Upload to Master
                            </button>
                            <p className="text-xs text-gray-500 text-center mt-2">
                                {routesForUploadCount} route{routesForUploadCount !== 1 ? 's' : ''} available
                            </p>
                        </div>
                    )}

                    {/* Editor Actions */}
                    {subView === 'editor' && (
                        <div className="p-4 flex gap-2 justify-center">
                            <button
                                onClick={onUndo}
                                disabled={!canUndo}
                                className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                                title="Undo (Ctrl+Z)"
                            >
                                <Undo2 size={16} />
                            </button>
                            <button
                                onClick={onRedo}
                                disabled={!canRedo}
                                className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                                title="Redo (Ctrl+Y)"
                            >
                                <Redo2 size={16} />
                            </button>
                            <div className="w-px bg-gray-200 mx-1" />
                            <button
                                onClick={onShowComparison}
                                disabled={!hasOriginalSchedules}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                title="Compare with original"
                            >
                                <GitCompare size={14} /> Compare
                            </button>
                            <button
                                onClick={onShowInterlineConfig}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm font-medium"
                                title="Configure route interlining"
                            >
                                <ArrowRight size={14} /> Interline
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
