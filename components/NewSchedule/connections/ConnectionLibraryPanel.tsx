/**
 * ConnectionLibraryPanel
 *
 * Displays and manages the team's connection target library.
 * Shows manual targets (GO trains, College bells) and route-based targets.
 */

import React, { useState } from 'react';
import {
    Plus,
    Train,
    Clock,
    Bus,
    Trash2,
    Edit2,
    ChevronRight,
    Upload,
    MoreVertical
} from 'lucide-react';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime
} from '../../../utils/connectionTypes';
import { formatConnectionTime } from '../../../utils/connectionTypes';

interface ConnectionLibraryPanelProps {
    library: ConnectionLibrary | null;
    onUpdateLibrary: (library: ConnectionLibrary) => void;
    onAddTarget: () => void;
    onImportRoute: () => void;
    userId: string;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
}

export const ConnectionLibraryPanel: React.FC<ConnectionLibraryPanelProps> = ({
    library,
    onUpdateLibrary,
    onAddTarget,
    onImportRoute,
    userId,
    dayType
}) => {
    const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);
    const [editingTimeId, setEditingTimeId] = useState<string | null>(null);

    if (!library) {
        return (
            <div className="p-4 text-center text-gray-500">
                Loading library...
            </div>
        );
    }

    const targets = library.targets;
    const manualTargets = targets.filter(t => t.type === 'manual');
    const routeTargets = targets.filter(t => t.type === 'route');

    // Delete a target
    const handleDeleteTarget = (targetId: string) => {
        if (!confirm('Delete this connection target?')) return;

        onUpdateLibrary({
            ...library,
            targets: library.targets.filter(t => t.id !== targetId),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        });
    };

    // Toggle time enabled
    const handleToggleTime = (targetId: string, timeId: string) => {
        const target = library.targets.find(t => t.id === targetId);
        if (!target || !target.times) return;

        const updatedTimes = target.times.map(t =>
            t.id === timeId ? { ...t, enabled: !t.enabled } : t
        );

        onUpdateLibrary({
            ...library,
            targets: library.targets.map(t =>
                t.id === targetId ? { ...t, times: updatedTimes, updatedAt: new Date().toISOString() } : t
            ),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        });
    };

    // Delete a time
    const handleDeleteTime = (targetId: string, timeId: string) => {
        const target = library.targets.find(t => t.id === targetId);
        if (!target || !target.times) return;

        onUpdateLibrary({
            ...library,
            targets: library.targets.map(t =>
                t.id === targetId
                    ? { ...t, times: t.times?.filter(tm => tm.id !== timeId), updatedAt: new Date().toISOString() }
                    : t
            ),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        });
    };

    // Get icon for target type
    const getTargetIcon = (target: ConnectionTarget) => {
        if (target.type === 'route') return Bus;
        if (target.icon === 'train') return Train;
        if (target.icon === 'clock') return Clock;
        return Train; // Default
    };

    // Get times for current day type
    const getActiveTimes = (target: ConnectionTarget): ConnectionTime[] => {
        if (!target.times) return [];
        return target.times.filter(t => t.daysActive.includes(dayType));
    };

    return (
        <div className="divide-y divide-gray-100">
            {/* Action buttons */}
            <div className="p-3 flex gap-2">
                <button
                    onClick={onAddTarget}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                >
                    <Plus className="w-4 h-4" />
                    Add Target
                </button>
                <button
                    onClick={onImportRoute}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
                >
                    <Upload className="w-4 h-4" />
                    Import Route
                </button>
            </div>

            {/* Empty state */}
            {targets.length === 0 && (
                <div className="p-8 text-center">
                    <Train className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No connection targets yet</p>
                    <p className="text-xs text-gray-400 mt-1">
                        Add GO Train times, College bells, or import from another route
                    </p>
                </div>
            )}

            {/* Manual targets section */}
            {manualTargets.length > 0 && (
                <div className="p-3">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                        Manual Targets
                    </h4>
                    <div className="space-y-2">
                        {manualTargets.map(target => {
                            const Icon = getTargetIcon(target);
                            const isExpanded = expandedTargetId === target.id;
                            const activeTimes = getActiveTimes(target);

                            return (
                                <div
                                    key={target.id}
                                    className="border border-gray-200 rounded-lg overflow-hidden"
                                >
                                    {/* Target header */}
                                    <button
                                        onClick={() => setExpandedTargetId(isExpanded ? null : target.id)}
                                        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                                    >
                                        <Icon className="w-4 h-4 text-gray-500" />
                                        <div className="flex-1 text-left">
                                            <div className="text-sm font-medium text-gray-900">
                                                {target.name}
                                            </div>
                                            {target.location && (
                                                <div className="text-xs text-gray-500">
                                                    {target.location}
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-400">
                                            {activeTimes.length} times
                                        </span>
                                        <ChevronRight
                                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                        />
                                    </button>

                                    {/* Expanded times */}
                                    {isExpanded && (
                                        <div className="border-t border-gray-100 bg-gray-50 p-2">
                                            {activeTimes.length === 0 ? (
                                                <p className="text-xs text-gray-500 text-center py-2">
                                                    No times for {dayType}
                                                </p>
                                            ) : (
                                                <div className="space-y-1">
                                                    {activeTimes.map(time => (
                                                        <div
                                                            key={time.id}
                                                            className={`flex items-center gap-2 px-2 py-1 rounded ${
                                                                time.enabled ? 'bg-white' : 'bg-gray-100 opacity-50'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={time.enabled}
                                                                onChange={() => handleToggleTime(target.id, time.id)}
                                                                className="w-3.5 h-3.5 rounded text-blue-600"
                                                            />
                                                            <span className="text-sm font-mono text-gray-900">
                                                                {formatConnectionTime(time.time)}
                                                            </span>
                                                            {time.label && (
                                                                <span className="text-xs text-gray-500 flex-1 truncate">
                                                                    {time.label}
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={() => handleDeleteTime(target.id, time.id)}
                                                                className="p-1 text-gray-400 hover:text-red-500"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Target actions */}
                                            <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-gray-200">
                                                <button
                                                    onClick={() => handleDeleteTarget(target.id)}
                                                    className="text-xs text-red-600 hover:text-red-700"
                                                >
                                                    Delete Target
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Route targets section */}
            {routeTargets.length > 0 && (
                <div className="p-3">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                        Route Connections
                    </h4>
                    <div className="space-y-2">
                        {routeTargets.map(target => (
                            <div
                                key={target.id}
                                className="flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg"
                            >
                                <Bus className="w-4 h-4 text-blue-500" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">
                                        {target.name}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {target.routeIdentity} • {target.stopName} • {target.direction}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteTarget(target.id)}
                                    className="p-1 text-gray-400 hover:text-red-500"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConnectionLibraryPanel;
