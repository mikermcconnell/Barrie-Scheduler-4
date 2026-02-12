/**
 * ConnectionLibraryPanel
 *
 * Displays and manages the team's connection target library.
 * Shows manual targets (GO trains, College bells) and route-based targets.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    Plus,
    Train,
    Clock,
    Bus,
    Trash2,
    Edit2,
    ChevronRight,
    Upload,
    RefreshCw,
    Filter
} from 'lucide-react';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime,
    ConnectionEventType,
    ConnectionQualityWindowSettings
} from '../../../utils/connections/connectionTypes';
import {
    formatConnectionTime,
    DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS
} from '../../../utils/connections/connectionTypes';
import { fetchGoTransitGTFS, getCachedData, getCacheAge } from '../../../utils/gtfs/goTransitService';
import {
    appendLibraryChange,
    getTargetCoverageSummary,
    targetHasActiveTimesForDay,
    targetMatchesLoadedStops
} from '../../../utils/connections/connectionLibraryUtils';
import { AddTargetModal } from './AddTargetModal';

interface ConnectionLibraryPanelProps {
    library: ConnectionLibrary | null;
    onUpdateLibrary: (library: ConnectionLibrary) => void;
    onAddTarget: () => void;
    onImportRoute: () => void;
    schedules?: MasterRouteTable[];
    validStopCodes?: string[];
    userId: string;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
}

const validateQualitySettings = (settings: ConnectionQualityWindowSettings): string => {
    if (settings.goodMin < 0 || settings.excellentMin < 0 || settings.excellentMax < 0 || settings.goodMax < 0) {
        return 'Values must be 0 or greater';
    }
    if (!(settings.goodMin <= settings.excellentMin)) {
        return 'Good minimum must be less than or equal to Excellent minimum';
    }
    if (!(settings.excellentMin <= settings.excellentMax)) {
        return 'Excellent minimum must be less than or equal to Excellent maximum';
    }
    if (!(settings.excellentMax <= settings.goodMax)) {
        return 'Excellent maximum must be less than or equal to Good maximum';
    }
    return '';
};

export const ConnectionLibraryPanel: React.FC<ConnectionLibraryPanelProps> = ({
    library,
    onUpdateLibrary,
    onAddTarget,
    onImportRoute,
    schedules = [],
    validStopCodes,
    userId,
    dayType
}) => {
    const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);
    const [editingTarget, setEditingTarget] = useState<ConnectionTarget | null>(null);
    const [showMatchingOnly, setShowMatchingOnly] = useState(false);
    const [isRefreshingGtfs, setIsRefreshingGtfs] = useState(false);
    const [gtfsStatusMessage, setGtfsStatusMessage] = useState<string>('');
    const [qualityDraft, setQualityDraft] = useState<ConnectionQualityWindowSettings>(
        library?.qualityWindowSettings || DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS
    );

    const targets = library?.targets || [];
    const qualitySettings = library?.qualityWindowSettings || DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS;
    const gtfsCache = getCachedData();
    const gtfsCacheAge = getCacheAge();

    const displayedTargets = useMemo(() => {
        if (!showMatchingOnly) return targets;
        return targets.filter(target =>
            targetMatchesLoadedStops(target, validStopCodes || [])
            && targetHasActiveTimesForDay(target, dayType)
        );
    }, [targets, showMatchingOnly, validStopCodes, dayType]);

    const manualTargets = displayedTargets.filter(t => t.type === 'manual');
    const routeTargets = displayedTargets.filter(t => t.type === 'route');

    useEffect(() => {
        setQualityDraft(qualitySettings);
    }, [qualitySettings.excellentMin, qualitySettings.excellentMax, qualitySettings.goodMin, qualitySettings.goodMax]);

    const qualityError = useMemo(() => validateQualitySettings(qualityDraft), [qualityDraft]);

    const applyLibraryUpdate = (
        nextLibrary: ConnectionLibrary,
        action: string,
        details?: string
    ) => {
        const withAudit = appendLibraryChange(nextLibrary, userId, action, details);
        onUpdateLibrary(withAudit);
    };

    // Delete a target
    const handleDeleteTarget = (targetId: string) => {
        if (!library) return;
        if (!confirm('Delete this connection target?')) return;

        applyLibraryUpdate({
            ...library,
            targets: library.targets.filter(t => t.id !== targetId),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, 'delete_target', `Deleted target ${targetId}`);
    };

    const handleEditRouteTarget = (target: ConnectionTarget) => {
        if (!library) return;
        const nextName = window.prompt('Edit connection name', target.name)?.trim();
        if (!nextName || nextName === target.name) return;

        const normalized = nextName.toLowerCase();
        const duplicate = library.targets.some(
            t => t.id !== target.id && t.name.trim().toLowerCase() === normalized
        );
        if (duplicate) {
            alert('A target with this name already exists');
            return;
        }

        applyLibraryUpdate({
            ...library,
            targets: library.targets.map(t =>
                t.id === target.id
                    ? { ...t, name: nextName, updatedAt: new Date().toISOString() }
                    : t
            ),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, 'rename_target', `Renamed ${target.name} to ${nextName}`);
    };

    const handleSaveQualitySettings = () => {
        if (!library) return;
        if (qualityError) return;
        applyLibraryUpdate({
            ...library,
            qualityWindowSettings: qualityDraft,
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, 'update_library_timing_settings');
    };

    // Toggle time enabled
    const handleToggleTime = (targetId: string, timeId: string) => {
        if (!library) return;
        const target = library.targets.find(t => t.id === targetId);
        if (!target || !target.times) return;

        const updatedTimes = target.times.map(t =>
            t.id === timeId ? { ...t, enabled: !t.enabled } : t
        );

        applyLibraryUpdate({
            ...library,
            targets: library.targets.map(t =>
                t.id === targetId ? { ...t, times: updatedTimes, updatedAt: new Date().toISOString() } : t
            ),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, 'toggle_time_enabled', `Target ${targetId}`);
    };

    // Delete a time
    const handleDeleteTime = (targetId: string, timeId: string) => {
        if (!library) return;
        const target = library.targets.find(t => t.id === targetId);
        if (!target || !target.times) return;

        applyLibraryUpdate({
            ...library,
            targets: library.targets.map(t =>
                t.id === targetId
                    ? { ...t, times: t.times?.filter(tm => tm.id !== timeId), updatedAt: new Date().toISOString() }
                    : t
            ),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, 'delete_time', `Target ${targetId}, time ${timeId}`);
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

    const editingInitialData = editingTarget ? {
        name: editingTarget.name,
        location: editingTarget.location,
        stopCode: editingTarget.stopCode,
        icon: (editingTarget.icon === 'clock' ? 'clock' : 'train') as 'train' | 'clock',
        defaultEventType: editingTarget.defaultEventType || 'departure',
        times: editingTarget.times,
        autoPopulateStops: editingTarget.autoPopulateStops,
        qualityWindowSettings: editingTarget.qualityWindowSettings,
        stops: (editingTarget.stopCodes || (editingTarget.stopCode ? [editingTarget.stopCode] : []))
            .map(code => ({
                code,
                name: `Stop ${code}`,
                enabled: true
            }))
    } : undefined;

    const handleSaveEditedTarget = (updated: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!library) return;
        if (!editingTarget) return;
        applyLibraryUpdate({
            ...library,
            targets: library.targets.map(t =>
                t.id === editingTarget.id
                    ? {
                        ...t,
                        ...updated,
                        updatedAt: new Date().toISOString()
                    }
                    : t
            ),
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, 'edit_target', `Edited target ${editingTarget.id}`);
        setEditingTarget(null);
    };

    const handleValidateCoverage = (target: ConnectionTarget) => {
        const summary = getTargetCoverageSummary(target, schedules, dayType);
        const lines = [
            `Target: ${target.name}`,
            `Day: ${dayType}`,
            `Matching stop codes: ${summary.matchingStopCodes.length}`,
            `Matching routes: ${summary.matchingRoutes.length}`,
            `Active times for day: ${summary.activeTimesCount}`
        ];
        if (summary.matchingRoutes.length > 0) {
            lines.push('', `Routes: ${summary.matchingRoutes.join(', ')}`);
        }
        alert(lines.join('\n'));
    };

    const updateTargetTimes = (
        targetId: string,
        updater: (times: ConnectionTime[]) => ConnectionTime[],
        action: string
    ) => {
        if (!library) return;
        const target = library.targets.find(t => t.id === targetId);
        if (!target?.times || target.times.length === 0) return;

        const updatedTargets = library.targets.map(t => {
            if (t.id !== targetId) return t;
            return {
                ...t,
                times: updater(t.times || []),
                updatedAt: new Date().toISOString()
            };
        });

        applyLibraryUpdate({
            ...library,
            targets: updatedTargets,
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, action, `Target ${targetId}`);
    };

    const handleBulkSetEventType = (targetId: string, eventType: 'departure' | 'arrival') => {
        updateTargetTimes(targetId, times => times.map(time => ({ ...time, eventType })), 'bulk_set_event_type');
    };

    const handleBulkSetDefaultInheritance = (targetId: string) => {
        updateTargetTimes(targetId, times => times.map(time => ({ ...time, eventType: undefined as ConnectionEventType | undefined })), 'bulk_set_default_inheritance');
    };

    const shiftTime = (minutes: number, delta: number) => {
        const next = minutes + delta;
        if (next < 0) return 0;
        if (next > 2160) return 2160;
        return next;
    };

    const handleBulkShiftTimes = (targetId: string, delta: number) => {
        updateTargetTimes(targetId, times => times.map(time => ({ ...time, time: shiftTime(time.time, delta) })), 'bulk_shift_times');
    };

    const handleRefreshGtfs = async () => {
        try {
            setIsRefreshingGtfs(true);
            setGtfsStatusMessage('');
            await fetchGoTransitGTFS();
            setGtfsStatusMessage('GTFS cache refreshed.');
        } catch (error) {
            console.error('Failed to refresh GTFS cache:', error);
            const details = error instanceof Error ? ` ${error.message}` : '';
            setGtfsStatusMessage(`Failed to refresh GTFS cache.${details}`);
        } finally {
            setIsRefreshingGtfs(false);
        }
    };

    return (
        <div className="divide-y divide-gray-100">
            {!library && (
                <div className="p-4 text-center text-gray-500">
                    Loading library...
                </div>
            )}
            {library && (
                <>
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

            <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 border-b border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>
                        GTFS cache: {gtfsCache?.fetchedAt ? new Date(gtfsCache.fetchedAt).toLocaleString() : 'Not cached'}
                        {gtfsCacheAge ? ` (${gtfsCacheAge})` : ''}
                    </span>
                    <button
                        onClick={handleRefreshGtfs}
                        disabled={isRefreshingGtfs}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3 h-3 ${isRefreshingGtfs ? 'animate-spin' : ''}`} />
                        Refresh GTFS
                    </button>
                </div>
                {gtfsStatusMessage && (
                    <p className={`mt-1 text-[11px] ${gtfsStatusMessage.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
                        {gtfsStatusMessage}
                    </p>
                )}
            </div>

            {/* Timing quality settings */}
            <div className="p-3 bg-gray-50/60">
                <h4 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">
                    Connection Timing Settings
                </h4>
                <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-gray-600">
                        Good Min
                        <input
                            type="number"
                            min={0}
                            value={qualityDraft.goodMin}
                            onChange={(e) => setQualityDraft({ ...qualityDraft, goodMin: Number(e.target.value || 0) })}
                            className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                        />
                    </label>
                    <label className="text-xs text-gray-600">
                        Excellent Min
                        <input
                            type="number"
                            min={0}
                            value={qualityDraft.excellentMin}
                            onChange={(e) => setQualityDraft({ ...qualityDraft, excellentMin: Number(e.target.value || 0) })}
                            className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                        />
                    </label>
                    <label className="text-xs text-gray-600">
                        Excellent Max
                        <input
                            type="number"
                            min={0}
                            value={qualityDraft.excellentMax}
                            onChange={(e) => setQualityDraft({ ...qualityDraft, excellentMax: Number(e.target.value || 0) })}
                            className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                        />
                    </label>
                    <label className="text-xs text-gray-600">
                        Good Max
                        <input
                            type="number"
                            min={0}
                            value={qualityDraft.goodMax}
                            onChange={(e) => setQualityDraft({ ...qualityDraft, goodMax: Number(e.target.value || 0) })}
                            className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                        />
                    </label>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">
                    Excellent: {qualityDraft.excellentMin}-{qualityDraft.excellentMax} min early.
                    Good: {qualityDraft.goodMin}-{qualityDraft.excellentMin} and {qualityDraft.excellentMax}-{qualityDraft.goodMax} min early.
                    Outside that is bad.
                </p>
                {qualityError && (
                    <p className="text-[11px] text-red-600 mt-1">{qualityError}</p>
                )}
                <div className="flex justify-end mt-2">
                    <button
                        onClick={handleSaveQualitySettings}
                        disabled={!!qualityError}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Save Settings
                    </button>
                </div>
            </div>

            <div className="px-3 py-2 flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                    <input
                        type="checkbox"
                        checked={showMatchingOnly}
                        onChange={(e) => setShowMatchingOnly(e.target.checked)}
                    />
                    <Filter className="w-3 h-3" />
                    Show only targets matching loaded route/day
                </label>
                <span className="text-xs text-gray-500">
                    {displayedTargets.length}/{targets.length}
                </span>
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
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                                    !time.eventType
                                                                        ? 'bg-gray-100 text-gray-700'
                                                                        : time.eventType === 'arrival'
                                                                            ? 'bg-indigo-100 text-indigo-700'
                                                                            : 'bg-emerald-100 text-emerald-700'
                                                                }`}
                                                                title={!time.eventType
                                                                    ? `Inherits ${target.defaultEventType === 'arrival' ? 'Arrival' : 'Departure'} default`
                                                                    : time.eventType === 'arrival' ? 'Arrival event' : 'Departure event'}
                                                            >
                                                                {!time.eventType ? 'DEF' : time.eventType === 'arrival' ? 'ARR' : 'DEP'}
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
                                                    onClick={() => handleValidateCoverage(target)}
                                                    className="text-xs text-indigo-600 hover:text-indigo-700"
                                                >
                                                    Validate Coverage
                                                </button>
                                                <button
                                                    onClick={() => handleBulkSetEventType(target.id, 'departure')}
                                                    className="text-xs text-emerald-600 hover:text-emerald-700"
                                                >
                                                    All DEP
                                                </button>
                                                <button
                                                    onClick={() => handleBulkSetEventType(target.id, 'arrival')}
                                                    className="text-xs text-indigo-600 hover:text-indigo-700"
                                                >
                                                    All ARR
                                                </button>
                                                <button
                                                    onClick={() => handleBulkSetDefaultInheritance(target.id)}
                                                    className="text-xs text-gray-600 hover:text-gray-800"
                                                >
                                                    All DEF
                                                </button>
                                                <button
                                                    onClick={() => handleBulkShiftTimes(target.id, -1)}
                                                    className="text-xs text-gray-600 hover:text-gray-800"
                                                >
                                                    Shift -1
                                                </button>
                                                <button
                                                    onClick={() => handleBulkShiftTimes(target.id, 1)}
                                                    className="text-xs text-gray-600 hover:text-gray-800"
                                                >
                                                    Shift +1
                                                </button>
                                                <button
                                                    onClick={() => setEditingTarget(target)}
                                                    className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                                >
                                                    <Edit2 className="w-3 h-3" />
                                                    Edit Target
                                                </button>
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
                            <React.Fragment key={target.id}>
                                <div className="flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg">
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
                                        onClick={() => handleEditRouteTarget(target)}
                                        className="p-1 text-gray-400 hover:text-blue-600"
                                        title="Edit name"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleValidateCoverage(target)}
                                        className="p-1 text-gray-400 hover:text-indigo-600"
                                        title="Validate coverage"
                                    >
                                        <Filter className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteTarget(target.id)}
                                        className="p-1 text-gray-400 hover:text-red-500"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            )}

            {library.changeLog && library.changeLog.length > 0 && (
                <div className="p-3">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                        Recent Changes
                    </h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                        {library.changeLog.slice(0, 8).map(entry => (
                            <div key={entry.id} className="text-[11px] text-gray-600 bg-gray-50 rounded px-2 py-1">
                                <span className="font-semibold">v{entry.version}</span> {entry.action}
                                {entry.details ? ` - ${entry.details}` : ''}
                                <span className="text-gray-400 ml-1">
                                    ({new Date(entry.timestamp).toLocaleString()})
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Edit manual target modal */}
            {editingTarget && editingTarget.type === 'manual' && (
                <AddTargetModal
                    isOpen={!!editingTarget}
                    onClose={() => setEditingTarget(null)}
                    onAdd={handleSaveEditedTarget}
                    dayType={dayType}
                    existingTargetNames={library.targets.filter(t => t.id !== editingTarget.id).map(t => t.name)}
                    validStopCodes={validStopCodes}
                    defaultQualityWindowSettings={library.qualityWindowSettings || DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS}
                    initialData={editingInitialData}
                    mode="edit"
                />
            )}
                </>
            )}
        </div>
    );
};

export default ConnectionLibraryPanel;
