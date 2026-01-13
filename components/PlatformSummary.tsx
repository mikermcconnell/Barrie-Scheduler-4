/**
 * Platform Summary Component
 *
 * Displays platform utilization across all transit hubs for a selected day type.
 * Shows hub cards with platform breakdown, peak counts, and conflict alerts.
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Bus, MapPin } from 'lucide-react';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';
import {
    aggregatePlatformData,
    formatMinutesToTime,
    type HubAnalysis,
    type PlatformAnalysis,
    type ConflictWindow
} from '../utils/platformAnalysis';
import type { MasterScheduleEntry, MasterScheduleContent, RouteIdentity, DayType } from '../utils/masterScheduleTypes';

interface PlatformSummaryProps {
    dayType: DayType;
    schedules: MasterScheduleEntry[];
    contentCache: Map<RouteIdentity, MasterScheduleContent>;
}

export const PlatformSummary: React.FC<PlatformSummaryProps> = ({
    dayType,
    schedules,
    contentCache
}) => {
    const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set());

    // Aggregate analysis from all loaded schedules for this dayType
    const hubAnalyses = useMemo(() => {
        const relevantSchedules: MasterScheduleContent[] = [];
        const routeNumbers: string[] = [];

        for (const entry of schedules) {
            if (entry.dayType === dayType) {
                const content = contentCache.get(entry.id as RouteIdentity);
                if (content) {
                    relevantSchedules.push(content);
                    routeNumbers.push(entry.routeNumber);
                }
            }
        }

        if (relevantSchedules.length === 0) {
            return [];
        }

        return aggregatePlatformData(relevantSchedules, routeNumbers);
    }, [schedules, dayType, contentCache]);

    const toggleHub = (hubName: string) => {
        setExpandedHubs(prev => {
            const next = new Set(prev);
            if (next.has(hubName)) {
                next.delete(hubName);
            } else {
                next.add(hubName);
            }
            return next;
        });
    };

    // Check if any schedules are loaded
    const loadedScheduleCount = schedules.filter(s =>
        s.dayType === dayType && contentCache.has(s.id as RouteIdentity)
    ).length;

    const totalSchedulesForDayType = schedules.filter(s => s.dayType === dayType).length;

    if (loadedScheduleCount === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <MapPin size={48} className="mb-4 opacity-50" />
                <p className="text-lg font-medium">No schedules loaded for {dayType}</p>
                <p className="text-sm mt-2">
                    {totalSchedulesForDayType > 0
                        ? `Click on route tabs (400, 100, etc.) to load ${totalSchedulesForDayType} available schedule(s)`
                        : 'No schedules have been uploaded for this day type yet'}
                </p>
            </div>
        );
    }

    // Summary stats
    const totalVisits = hubAnalyses.reduce((sum, h) => sum + h.totalDailyVisits, 0);
    const totalConflicts = hubAnalyses.reduce((sum, h) => sum + h.totalConflictWindows, 0);
    const hubsWithConflicts = hubAnalyses.filter(h => h.conflictCount > 0).length;

    return (
        <div className="space-y-6">
            {/* Explanation Header */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-1">How Platform Summary Works</h3>
                <p className="text-sm text-blue-700">
                    This view shows how many buses are at each hub platform throughout the day.
                    A <strong>"visit"</strong> is when a bus arrives and departs from a platform.
                    <strong> "Conflicts"</strong> occur when multiple buses need the same platform at the same time.
                </p>
            </div>

            {/* Summary Bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-6 flex-wrap">
                        <div className="flex items-center gap-2">
                            <Bus className="text-gray-400" size={20} />
                            <span className="text-sm text-gray-600">
                                <span className="font-bold text-gray-900">{totalVisits}</span> total platform visits
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <MapPin className="text-gray-400" size={20} />
                            <span className="text-sm text-gray-600">
                                <span className="font-bold text-gray-900">{hubAnalyses.length}</span> hubs analyzed
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock className="text-gray-400" size={20} />
                            <span className="text-sm text-gray-600">
                                <span className="font-bold text-gray-900">{loadedScheduleCount}</span> of {totalSchedulesForDayType} routes loaded
                            </span>
                        </div>
                    </div>
                    {totalConflicts > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full">
                            <AlertTriangle className="text-red-500" size={16} />
                            <span className="text-sm font-medium text-red-700">
                                {totalConflicts} conflict{totalConflicts !== 1 ? 's' : ''} at {hubsWithConflicts} hub{hubsWithConflicts !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Hub Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {hubAnalyses.map(hub => (
                    <HubCard
                        key={hub.hubName}
                        hub={hub}
                        isExpanded={expandedHubs.has(hub.hubName)}
                        onToggle={() => toggleHub(hub.hubName)}
                    />
                ))}
            </div>
        </div>
    );
};

// Hub Card Component
interface HubCardProps {
    hub: HubAnalysis;
    isExpanded: boolean;
    onToggle: () => void;
}

const HubCard: React.FC<HubCardProps> = ({ hub, isExpanded, onToggle }) => {
    const activePlatforms = hub.platforms.filter(p => p.totalVisits > 0);
    const peakPlatform = hub.platforms.length > 0
        ? hub.platforms.reduce((max, p) => p.peakCount > (max?.peakCount || 0) ? p : max, hub.platforms[0])
        : null;

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            {/* Header */}
            <div
                className={`p-4 border-b cursor-pointer transition-colors ${
                    hub.conflictCount > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200'
                }`}
                onClick={onToggle}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isExpanded ? (
                            <ChevronDown size={18} className="text-gray-400" />
                        ) : (
                            <ChevronRight size={18} className="text-gray-400" />
                        )}
                        <h3 className="font-bold text-gray-900">{hub.hubName}</h3>
                    </div>
                    <span className="text-sm text-gray-600">
                        {hub.platforms.length} platform{hub.platforms.length !== 1 ? 's' : ''}
                    </span>
                </div>
                {hub.conflictCount > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-red-600 text-sm">
                        <AlertTriangle size={14} />
                        <span className="font-medium">
                            {hub.totalConflictWindows} overlap{hub.totalConflictWindows !== 1 ? 's' : ''} detected
                        </span>
                    </div>
                )}
                {/* Quick stats */}
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                    <span>{hub.totalDailyVisits} visits/day</span>
                    {peakPlatform && peakPlatform.peakCount > 0 && (
                        <span>Peak: {peakPlatform.peakCount} buses at {peakPlatform.platformId}</span>
                    )}
                </div>
            </div>

            {/* Platform List (expandable) */}
            {isExpanded && (
                <div className="divide-y divide-gray-100">
                    {hub.platforms.map(platform => (
                        <PlatformRow key={platform.platformId} platform={platform} />
                    ))}
                </div>
            )}

            {/* Collapsed preview */}
            {!isExpanded && activePlatforms.length > 0 && (
                <div className="p-3 bg-gray-50/50">
                    <div className="flex flex-wrap gap-1">
                        {activePlatforms.slice(0, 6).map(platform => (
                            <div
                                key={platform.platformId}
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                    platform.hasConflict
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-gray-100 text-gray-700'
                                }`}
                            >
                                {platform.platformId}: {platform.totalVisits}
                            </div>
                        ))}
                        {activePlatforms.length > 6 && (
                            <div className="px-2 py-1 rounded text-xs text-gray-500">
                                +{activePlatforms.length - 6} more
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="p-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600 flex justify-between">
                <span>Total: {hub.totalDailyVisits} visits</span>
                <span className="text-xs text-gray-400">Click to {isExpanded ? 'collapse' : 'expand'}</span>
            </div>
        </div>
    );
};

// Platform Row Component
interface PlatformRowProps {
    platform: PlatformAnalysis;
}

const PlatformRow: React.FC<PlatformRowProps> = ({ platform }) => {
    const [showDetails, setShowDetails] = useState(false);

    if (platform.totalVisits === 0) {
        return (
            <div className="p-3 flex items-center gap-3 opacity-50">
                <div className="w-16 font-mono font-semibold text-gray-400">
                    {platform.platformId}
                </div>
                <div className="flex-1 text-xs text-gray-400 italic">No scheduled visits</div>
            </div>
        );
    }

    return (
        <div className={`${platform.hasConflict ? 'bg-red-50/50' : ''}`}>
            <div
                className="p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setShowDetails(!showDetails)}
            >
                {/* Platform ID */}
                <div className="w-16 font-mono font-semibold text-gray-700 flex items-center gap-1">
                    {platform.hasConflict && <AlertTriangle className="text-red-500" size={12} />}
                    {platform.platformId}
                </div>

                {/* Route badges */}
                <div className="flex flex-wrap gap-1 flex-1">
                    {platform.routes.map(route => (
                        <span
                            key={route}
                            className="px-2 py-0.5 rounded text-xs font-bold"
                            style={{
                                backgroundColor: getRouteColor(route),
                                color: getRouteTextColor(route)
                            }}
                        >
                            {route}
                        </span>
                    ))}
                </div>

                {/* Metrics */}
                <div className="text-right min-w-[80px]">
                    <div className={`text-sm font-semibold ${
                        platform.hasConflict ? 'text-red-600' : 'text-gray-900'
                    }`}>
                        Peak: {platform.peakCount}
                    </div>
                    <div className="text-xs text-gray-500">
                        {platform.totalVisits} visit{platform.totalVisits !== 1 ? 's' : ''}
                    </div>
                </div>
            </div>

            {/* Expanded details */}
            {showDetails && (
                <div className="px-3 pb-3 space-y-2">
                    {/* Peak windows */}
                    {platform.peakWindows.length > 0 && (
                        <div className="text-xs">
                            <div className="font-medium text-gray-600 mb-1">Peak times ({platform.peakCount} buses):</div>
                            <div className="flex flex-wrap gap-1">
                                {platform.peakWindows.slice(0, 5).map((window, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                        {formatMinutesToTime(window.startMin)} - {formatMinutesToTime(window.endMin)}
                                    </span>
                                ))}
                                {platform.peakWindows.length > 5 && (
                                    <span className="px-2 py-0.5 text-gray-500">
                                        +{platform.peakWindows.length - 5} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Conflict windows */}
                    {platform.conflictWindows.length > 0 && (
                        <div className="text-xs">
                            <div className="font-medium text-red-600 mb-1">
                                Overlaps ({'>'}{platform.capacity} bus{platform.capacity !== 1 ? 'es' : ''}):
                            </div>
                            <div className="space-y-1">
                                {platform.conflictWindows.slice(0, 5).map((window, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded">
                                            {formatMinutesToTime(window.startMin)} - {formatMinutesToTime(window.endMin)}
                                        </span>
                                        <span className="text-gray-500">
                                            {window.busCount} buses
                                        </span>
                                    </div>
                                ))}
                                {platform.conflictWindows.length > 5 && (
                                    <span className="text-gray-500">
                                        +{platform.conflictWindows.length - 5} more conflicts
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PlatformSummary;
