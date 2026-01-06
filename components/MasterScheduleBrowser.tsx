/**
 * Master Schedule Browser - Excel-like Tabbed Interface
 *
 * Main UI for viewing all route schedules with tabbed navigation.
 * Includes Overview tab with service hours and route-specific schedule views.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Loader2,
    Edit3,
    History,
    Trash2,
    CalendarOff,
    LayoutGrid,
    Table as TableIcon,
    Maximize2,
    Minimize2
} from 'lucide-react';
import { useTeam } from './TeamContext';
import { useToast } from './ToastContext';
import { TeamManagement } from './TeamManagement';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import {
    getAllMasterSchedules,
    getMasterSchedule,
    deleteMasterSchedule,
    loadForTweaker
} from '../utils/masterScheduleService';
import type {
    MasterScheduleEntry,
    MasterScheduleContent,
    RouteIdentity,
    DayType
} from '../utils/masterScheduleTypes';
import { buildRouteIdentity } from '../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/masterScheduleParser';
import { buildRoundTripView } from '../utils/masterScheduleParser';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';
import { PlatformSummary } from './PlatformSummary';

// Constants
const ROUTE_ORDER = ['400', '100', '101', '2', '7', '8A', '8B', '12'] as const;
const DAY_TYPES: DayType[] = ['Weekday', 'Saturday', 'Sunday'];
const ANNUAL_MULTIPLIERS: Record<DayType, number> = {
    Weekday: 252,
    Saturday: 52,
    Sunday: 61,
};

interface MasterScheduleBrowserProps {
    onLoadToTweaker?: (schedules: MasterRouteTable[]) => void;
    onClose?: () => void;
}

// Helper: Calculate trip duration handling midnight rollover
function getTripDuration(startTime: number, endTime: number): number {
    if (endTime >= startTime) {
        return endTime - startTime;
    }
    // Trip crosses midnight - add 24 hours (1440 minutes) to endTime
    return (endTime + 1440) - startTime;
}

// Helper: Calculate daily service hours from schedule content (sum of all cycle times)
function calculateDailyServiceHours(content: MasterScheduleContent): number {
    const allTrips = [...content.northTable.trips, ...content.southTable.trips];
    if (allTrips.length === 0) return 0;

    // Sum of cycle times (endTime - startTime) for each trip, handling midnight rollover
    let totalCycleMinutes = 0;
    allTrips.forEach(trip => {
        const duration = getTripDuration(trip.startTime, trip.endTime);
        if (duration > 0 && duration < 1440) { // Sanity check: less than 24 hours
            totalCycleMinutes += duration;
        }
    });

    return totalCycleMinutes / 60; // Convert minutes to hours
}

// Helper: Format time from minutes
function formatTimeFromMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// Helper: Format hours for display with comma separators
function formatHours(hours: number): string {
    return hours.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'h';
}

export const MasterScheduleBrowser: React.FC<MasterScheduleBrowserProps> = ({
    onLoadToTweaker,
    onClose
}) => {
    const { team, hasTeam } = useTeam();
    const toast = useToast();

    // State
    const [selectedRoute, setSelectedRoute] = useState<string | 'overview' | 'platforms'>('overview');
    const [selectedDayType, setSelectedDayType] = useState<DayType>('Weekday');
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [schedules, setSchedules] = useState<MasterScheduleEntry[]>([]);
    const [contentCache, setContentCache] = useState<Map<RouteIdentity, MasterScheduleContent>>(new Map());
    const [loading, setLoading] = useState(true);
    const [loadingContent, setLoadingContent] = useState(false);

    // Version History State
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [selectedRouteIdentity, setSelectedRouteIdentity] = useState<RouteIdentity | null>(null);
    const [selectedCurrentVersion, setSelectedCurrentVersion] = useState<number>(1);

    const loadSchedules = useCallback(async () => {
        if (!team) return;

        setLoading(true);
        try {
            const data = await getAllMasterSchedules(team.id);
            setSchedules(data);
        } catch (error) {
            console.error('Error loading master schedules:', error);
            toast?.error('Failed to load master schedules');
        } finally {
            setLoading(false);
        }
    }, [team, toast]);

    // Load all schedules on mount
    useEffect(() => {
        if (hasTeam && team) {
            loadSchedules();
        } else {
            setLoading(false);
        }
    }, [hasTeam, team, loadSchedules]);

    const loadContentIfNeeded = useCallback(async (routeIdentity: RouteIdentity) => {
        if (contentCache.has(routeIdentity) || !team) return;

        setLoadingContent(true);
        try {
            const result = await getMasterSchedule(team.id, routeIdentity);
            if (result) {
                setContentCache(prev => new Map(prev).set(routeIdentity, result.content));
            }
        } catch (error) {
            console.error('Error loading schedule content:', error);
        } finally {
            setLoadingContent(false);
        }
    }, [contentCache, team]);

    // Lazy load content when route+dayType changes
    useEffect(() => {
        if (selectedRoute !== 'overview' && selectedRoute !== 'platforms' && team) {
            const routeIdentity = buildRouteIdentity(selectedRoute, selectedDayType);
            loadContentIfNeeded(routeIdentity);
        }
    }, [selectedRoute, selectedDayType, team, loadContentIfNeeded]);

    // Preload all content for overview tab to show accurate service hours
    useEffect(() => {
        if (selectedRoute === 'overview' && team && schedules.length > 0) {
            // Load all schedule content in parallel
            schedules.forEach(entry => {
                const routeIdentity = buildRouteIdentity(entry.routeNumber, entry.dayType);
                loadContentIfNeeded(routeIdentity);
            });
        }
    }, [selectedRoute, team, schedules, loadContentIfNeeded]);

    // Handlers
    const handleDelete = async (routeIdentity: RouteIdentity, routeNumber: string, dayType: DayType) => {
        if (!team) return;

        if (!confirm(`Delete ${routeNumber} (${dayType})? This will remove all versions.`)) {
            return;
        }

        try {
            await deleteMasterSchedule(team.id, routeIdentity);
            toast?.success('Schedule deleted');
            // Remove from cache
            setContentCache(prev => {
                const newCache = new Map(prev);
                newCache.delete(routeIdentity);
                return newCache;
            });
            await loadSchedules();
        } catch (error) {
            console.error('Error deleting schedule:', error);
            toast?.error('Failed to delete schedule');
        }
    };

    const handleLoadToTweaker = async (routeIdentity: RouteIdentity) => {
        if (!team) return;

        try {
            const tables = await loadForTweaker(team.id, routeIdentity);
            if (onLoadToTweaker) {
                onLoadToTweaker(tables);
                toast?.success('Loading into Schedule Tweaker...');
                // Note: Don't call onClose() here - let the parent handle view switching to tweaker
            } else {
                toast?.error('Load to Tweaker not configured');
            }
        } catch (error) {
            console.error('Error loading to tweaker:', error);
            toast?.error('Failed to load schedule');
        }
    };

    const handleShowHistory = (routeIdentity: RouteIdentity, currentVersion: number) => {
        setSelectedRouteIdentity(routeIdentity);
        setSelectedCurrentVersion(currentVersion);
        setShowVersionHistory(true);
    };

    const handleHistoryClose = () => {
        setShowVersionHistory(false);
        setSelectedRouteIdentity(null);
        loadSchedules();
    };

    // Data organization
    const organizedSchedules = ROUTE_ORDER.reduce((acc, route) => {
        acc[route] = {
            Weekday: schedules.find(s => s.routeNumber === route && s.dayType === 'Weekday'),
            Saturday: schedules.find(s => s.routeNumber === route && s.dayType === 'Saturday'),
            Sunday: schedules.find(s => s.routeNumber === route && s.dayType === 'Sunday'),
        };
        return acc;
    }, {} as Record<string, Record<DayType, MasterScheduleEntry | undefined>>);

    // No Team State
    if (!hasTeam) {
        return (
            <div className="p-8">
                <TeamManagement onClose={onClose} />
            </div>
        );
    }

    // Version History Panel
    if (showVersionHistory && selectedRouteIdentity && team) {
        return (
            <VersionHistoryPanel
                teamId={team.id}
                routeIdentity={selectedRouteIdentity}
                currentVersion={selectedCurrentVersion}
                onClose={handleHistoryClose}
            />
        );
    }

    // Helper: Calculate service hours from content (sum of cycle times, handles midnight rollover)
    const calculateServiceHours = (content: MasterScheduleContent | undefined): number => {
        if (!content) return 0;

        let totalCycleMinutes = 0;

        // Sum cycle time for all trips (North + South)
        const allTrips = [...content.northTable.trips, ...content.southTable.trips];
        allTrips.forEach(trip => {
            const duration = getTripDuration(trip.startTime, trip.endTime);
            if (duration > 0 && duration < 1440) { // Sanity check: less than 24 hours
                totalCycleMinutes += duration;
            }
        });

        return totalCycleMinutes / 60; // Convert to hours
    };

    // ========== RENDER OVERVIEW TAB ==========
    const renderOverview = () => {
        const rows = ROUTE_ORDER.map(route => {
            const routeSchedules = organizedSchedules[route];
            const weekdayEntry = routeSchedules.Weekday;
            const saturdayEntry = routeSchedules.Saturday;
            const sundayEntry = routeSchedules.Sunday;

            // Get content from cache to calculate actual service hours
            const weekdayContent = weekdayEntry ? contentCache.get(buildRouteIdentity(route, 'Weekday')) : undefined;
            const saturdayContent = saturdayEntry ? contentCache.get(buildRouteIdentity(route, 'Saturday')) : undefined;
            const sundayContent = sundayEntry ? contentCache.get(buildRouteIdentity(route, 'Sunday')) : undefined;

            // Calculate actual service hours from trip data, or estimate from tripCount if not loaded
            const weekdayDaily = weekdayContent
                ? calculateServiceHours(weekdayContent)
                : (weekdayEntry ? weekdayEntry.tripCount * 0.5 : 0); // Fallback estimate
            const saturdayDaily = saturdayContent
                ? calculateServiceHours(saturdayContent)
                : (saturdayEntry ? saturdayEntry.tripCount * 0.5 : 0);
            const sundayDaily = sundayContent
                ? calculateServiceHours(sundayContent)
                : (sundayEntry ? sundayEntry.tripCount * 0.5 : 0);

            // Annual calculations per day type
            const weekdayAnnual = weekdayDaily * ANNUAL_MULTIPLIERS.Weekday;
            const saturdayAnnual = saturdayDaily * ANNUAL_MULTIPLIERS.Saturday;
            const sundayAnnual = sundayDaily * ANNUAL_MULTIPLIERS.Sunday;
            const totalAnnual = weekdayAnnual + saturdayAnnual + sundayAnnual;

            return {
                route,
                weekdayDaily: weekdayEntry ? weekdayDaily : null,
                weekdayAnnual: weekdayEntry ? weekdayAnnual : null,
                saturdayDaily: saturdayEntry ? saturdayDaily : null,
                saturdayAnnual: saturdayEntry ? saturdayAnnual : null,
                sundayDaily: sundayEntry ? sundayDaily : null,
                sundayAnnual: sundayEntry ? sundayAnnual : null,
                totalAnnual: totalAnnual > 0 ? totalAnnual : null,
                // Track if data is estimated vs actual
                weekdayEstimated: weekdayEntry && !weekdayContent,
                saturdayEstimated: saturdayEntry && !saturdayContent,
                sundayEstimated: sundayEntry && !sundayContent,
            };
        });

        const totals = rows.reduce((acc, row) => ({
            weekdayDaily: acc.weekdayDaily + (row.weekdayDaily || 0),
            weekdayAnnual: acc.weekdayAnnual + (row.weekdayAnnual || 0),
            saturdayDaily: acc.saturdayDaily + (row.saturdayDaily || 0),
            saturdayAnnual: acc.saturdayAnnual + (row.saturdayAnnual || 0),
            sundayDaily: acc.sundayDaily + (row.sundayDaily || 0),
            sundayAnnual: acc.sundayAnnual + (row.sundayAnnual || 0),
            totalAnnual: acc.totalAnnual + (row.totalAnnual || 0),
        }), { weekdayDaily: 0, weekdayAnnual: 0, saturdayDaily: 0, saturdayAnnual: 0, sundayDaily: 0, sundayAnnual: 0, totalAnnual: 0 });

        return (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">System Overview</h2>
                    <p className="text-sm text-gray-600 mt-1">Service hours across all routes (daily and annual)</p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="sticky top-0 z-10 bg-gray-50">
                            {/* Day Type Headers */}
                            <tr className="border-b border-gray-200">
                                <th rowSpan={2} className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase bg-gray-50">Route</th>
                                <th colSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-blue-50">Weekday</th>
                                <th colSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-amber-50">Saturday</th>
                                <th colSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-purple-50">Sunday</th>
                                <th rowSpan={2} className="px-4 py-2 text-center text-xs font-semibold text-gray-700 uppercase border-l border-gray-200 bg-green-50">Total<br/>Annual</th>
                            </tr>
                            {/* Daily/Annual Sub-Headers */}
                            <tr className="border-b border-gray-200 text-[10px]">
                                <th className="px-2 py-1 text-center font-medium text-gray-500 border-l border-gray-200 bg-blue-50/50">Daily</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 bg-blue-50/50">Annual</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 border-l border-gray-200 bg-amber-50/50">Daily</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 bg-amber-50/50">Annual</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 border-l border-gray-200 bg-purple-50/50">Daily</th>
                                <th className="px-2 py-1 text-center font-medium text-gray-500 bg-purple-50/50">Annual</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {rows.map(row => (
                                <tr key={row.route} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shadow-sm"
                                                style={{
                                                    backgroundColor: getRouteColor(row.route),
                                                    color: getRouteTextColor(row.route)
                                                }}
                                            >
                                                {row.route}
                                            </div>
                                            <span className="font-semibold text-gray-900 text-sm">Route {row.route}</span>
                                        </div>
                                    </td>
                                    {/* Weekday */}
                                    <td className={`px-2 py-3 text-center text-sm border-l border-gray-100 ${row.weekdayEstimated ? 'text-gray-400 italic' : 'text-gray-900'}`} title={row.weekdayEstimated ? 'Estimated - loading...' : undefined}>
                                        {row.weekdayDaily !== null ? formatHours(row.weekdayDaily) : '--'}
                                    </td>
                                    <td className={`px-2 py-3 text-center text-sm ${row.weekdayEstimated ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                                        {row.weekdayAnnual !== null ? formatHours(row.weekdayAnnual) : '--'}
                                    </td>
                                    {/* Saturday */}
                                    <td className={`px-2 py-3 text-center text-sm border-l border-gray-100 ${row.saturdayEstimated ? 'text-gray-400 italic' : 'text-gray-900'}`} title={row.saturdayEstimated ? 'Estimated - loading...' : undefined}>
                                        {row.saturdayDaily !== null ? formatHours(row.saturdayDaily) : '--'}
                                    </td>
                                    <td className={`px-2 py-3 text-center text-sm ${row.saturdayEstimated ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                                        {row.saturdayAnnual !== null ? formatHours(row.saturdayAnnual) : '--'}
                                    </td>
                                    {/* Sunday */}
                                    <td className={`px-2 py-3 text-center text-sm border-l border-gray-100 ${row.sundayEstimated ? 'text-gray-400 italic' : 'text-gray-900'}`} title={row.sundayEstimated ? 'Estimated - loading...' : undefined}>
                                        {row.sundayDaily !== null ? formatHours(row.sundayDaily) : '--'}
                                    </td>
                                    <td className={`px-2 py-3 text-center text-sm ${row.sundayEstimated ? 'text-gray-300 italic' : 'text-gray-600'}`}>
                                        {row.sundayAnnual !== null ? formatHours(row.sundayAnnual) : '--'}
                                    </td>
                                    {/* Total Annual */}
                                    <td className="px-2 py-3 text-center text-sm font-bold text-gray-900 border-l border-gray-200 bg-green-50/30">
                                        {row.totalAnnual !== null ? formatHours(row.totalAnnual) : '--'}
                                    </td>
                                </tr>
                            ))}
                            {/* Totals Row */}
                            <tr className="bg-gray-100 font-bold">
                                <td className="px-4 py-3 text-gray-900">TOTAL</td>
                                <td className="px-2 py-3 text-center text-gray-900 border-l border-gray-200">{formatHours(totals.weekdayDaily)}</td>
                                <td className="px-2 py-3 text-center text-gray-700">{formatHours(totals.weekdayAnnual)}</td>
                                <td className="px-2 py-3 text-center text-gray-900 border-l border-gray-200">{formatHours(totals.saturdayDaily)}</td>
                                <td className="px-2 py-3 text-center text-gray-700">{formatHours(totals.saturdayAnnual)}</td>
                                <td className="px-2 py-3 text-center text-gray-900 border-l border-gray-200">{formatHours(totals.sundayDaily)}</td>
                                <td className="px-2 py-3 text-center text-gray-700">{formatHours(totals.sundayAnnual)}</td>
                                <td className="px-2 py-3 text-center text-gray-900 border-l border-gray-200 bg-green-100">{formatHours(totals.totalAnnual)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="p-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
                    Annual multipliers: Weekday × {ANNUAL_MULTIPLIERS.Weekday} days | Saturday × {ANNUAL_MULTIPLIERS.Saturday} days | Sunday × {ANNUAL_MULTIPLIERS.Sunday} days
                </div>
            </div>
        );
    };

    // ========== RENDER SCHEDULE CARD VIEW ==========
    const renderScheduleCard = () => {
        const routeIdentity = buildRouteIdentity(selectedRoute as string, selectedDayType);
        const entry = schedules.find(s => s.id === routeIdentity);
        const content = contentCache.get(routeIdentity);

        // No schedule exists
        if (!entry) {
            return (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <CalendarOff className="mx-auto mb-4 text-gray-300" size={48} />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Schedule Needed</h3>
                    <p className="text-gray-600">
                        No schedule has been uploaded for Route {selectedRoute} on {selectedDayType}.
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                        Upload from New Schedule wizard or Schedule Tweaker to add this schedule.
                    </p>
                </div>
            );
        }

        // Loading content
        if (loadingContent && !content) {
            return (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Loader2 className="animate-spin text-brand-green mx-auto" size={32} />
                </div>
            );
        }

        // Calculate metrics
        const dailyHours = content ? calculateDailyServiceHours(content) : null;
        const allStartTimes = content ? [
            ...content.northTable.trips.map(t => t.startTime),
            ...content.southTable.trips.map(t => t.startTime)
        ] : [];
        const allEndTimes = content ? [
            ...content.northTable.trips.map(t => t.endTime),
            ...content.southTable.trips.map(t => t.endTime)
        ] : [];
        const firstTrip = allStartTimes.length > 0 ? Math.min(...allStartTimes) : null;
        const lastTrip = allEndTimes.length > 0 ? Math.max(...allEndTimes) : null;

        return (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Card Header */}
                <div
                    className="p-6 text-white"
                    style={{ backgroundColor: getRouteColor(selectedRoute as string) }}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold">Route {selectedRoute}</h2>
                            <p className="text-sm opacity-90">{selectedDayType} Schedule</p>
                        </div>
                        <div className="text-right">
                            <div className="text-sm opacity-90">Version</div>
                            <div className="text-2xl font-bold">v{entry.currentVersion}</div>
                        </div>
                    </div>
                </div>

                {/* Card Content */}
                <div className="p-6 space-y-6">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Trips</div>
                            <div className="text-2xl font-bold text-gray-900">{entry.tripCount}</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Service Hours</div>
                            <div className="text-2xl font-bold text-gray-900">
                                {dailyHours !== null ? formatHours(dailyHours) : '--'}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">First Trip</div>
                            <div className="text-lg font-semibold text-gray-900">
                                {firstTrip !== null ? formatTimeFromMinutes(firstTrip) : '--'}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Last Trip</div>
                            <div className="text-lg font-semibold text-gray-900">
                                {lastTrip !== null ? formatTimeFromMinutes(lastTrip) : '--'}
                            </div>
                        </div>
                    </div>

                    {/* Details */}
                    <div className="border-t border-gray-200 pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Stops</span>
                            <span className="font-medium text-gray-900">
                                {entry.northStopCount}N + {entry.southStopCount}S
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Last Updated</span>
                            <span className="font-medium text-gray-900">
                                {new Intl.DateTimeFormat('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                }).format(entry.updatedAt)}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Updated By</span>
                            <span className="font-medium text-gray-900">{entry.uploaderName}</span>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-gray-200">
                        {onLoadToTweaker && (
                            <button
                                onClick={() => handleLoadToTweaker(routeIdentity)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-green text-white rounded-lg hover:brightness-110 font-semibold"
                            >
                                <Edit3 size={16} />
                                Load to Tweaker
                            </button>
                        )}
                        <button
                            onClick={() => handleShowHistory(routeIdentity, entry.currentVersion)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold flex items-center gap-2"
                        >
                            <History size={16} />
                            Version History
                        </button>
                        <button
                            onClick={() => handleDelete(routeIdentity, selectedRoute as string, selectedDayType)}
                            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 font-semibold"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ========== RENDER TABLE VIEW ==========
    const renderScheduleTable = () => {
        const routeIdentity = buildRouteIdentity(selectedRoute as string, selectedDayType);
        const entry = schedules.find(s => s.id === routeIdentity);
        const content = contentCache.get(routeIdentity);

        if (!entry || !content) {
            return renderScheduleCard(); // Fallback to card view
        }

        // Build round-trip view (pairs North + South trips by block)
        const combined = buildRoundTripView(content.northTable, content.southTable);

        // Determine which stops have recovery times (to show R column)
        const stopsWithRecovery = new Set<string>();
        combined.rows.forEach(row => {
            row.trips.forEach(trip => {
                if (trip.recoveryTimes) {
                    Object.entries(trip.recoveryTimes).forEach(([stop, time]) => {
                        if (time && time > 0) stopsWithRecovery.add(stop);
                    });
                }
            });
        });

        // Simple cell renderer - just departure time
        const renderStopCell = (trip: MasterTrip | undefined, stopName: string, hasRecovery: boolean, rowKey: string) => {
            if (!trip) {
                return (
                    <React.Fragment key={`empty-${rowKey}-${stopName}`}>
                        <td className="py-2 px-2 border-r border-gray-100 text-center"></td>
                        {hasRecovery && <td className="py-2 px-1 border-r border-gray-100 text-center"></td>}
                    </React.Fragment>
                );
            }

            const departTime = trip.stops[stopName];
            const recoveryTime = trip.recoveryTimes?.[stopName] || 0;

            return (
                <React.Fragment key={`${trip.id}-${stopName}`}>
                    <td className="py-2 px-2 border-r border-gray-100 text-center text-sm text-gray-900">
                        {departTime || ''}
                    </td>
                    {hasRecovery && (
                        <td className="py-2 px-1 border-r border-gray-100 text-center text-xs text-green-600 font-medium">
                            {recoveryTime > 0 ? recoveryTime : ''}
                        </td>
                    )}
                </React.Fragment>
            );
        };

        const tableContent = (
            <div className="overflow-auto flex-1 min-h-0" style={{ maxHeight: isFullScreen ? 'calc(100vh - 120px)' : undefined }}>
                    <table className="w-full border-collapse" style={{ fontSize: '12px' }}>
                        <thead className="sticky top-0 z-40 bg-gray-50 shadow-sm">
                            <tr>
                                <th className="p-3 border-b border-gray-200 bg-gray-50 sticky left-0 z-50 text-xs font-semibold text-gray-600 uppercase text-center">Block</th>

                                {/* North Stops */}
                                {combined.northStops.map((stop) => (
                                    <React.Fragment key={`n-h-${stop}`}>
                                        <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-[11px] font-semibold text-gray-700 uppercase whitespace-nowrap" title={stop}>
                                            {stop}
                                        </th>
                                        {stopsWithRecovery.has(stop) && (
                                            <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-[10px] font-medium text-gray-400">R</th>
                                        )}
                                    </React.Fragment>
                                ))}

                                {/* South Stops */}
                                {combined.southStops.map((stop) => (
                                    <React.Fragment key={`s-h-${stop}`}>
                                        <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-[11px] font-semibold text-gray-700 uppercase whitespace-nowrap" title={stop}>
                                            {stop}
                                        </th>
                                        {stopsWithRecovery.has(stop) && (
                                            <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-[10px] font-medium text-gray-400">R</th>
                                        )}
                                    </React.Fragment>
                                ))}

                                <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-xs font-medium text-gray-500">Trav</th>
                                <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-xs font-medium text-gray-500">Rec</th>
                                <th className="p-2 border-b border-gray-200 bg-gray-50 text-center text-xs font-medium text-gray-500">Cycle</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-gray-100">
                            {combined.rows.map((row, rowIdx) => {
                                const northTrip = row.trips.find(t => t.direction === 'North');
                                const southTrip = row.trips.find(t => t.direction === 'South');

                                // Calculate travel time from actual trip duration minus recovery (handle midnight rollover)
                                const northDuration = northTrip ? getTripDuration(northTrip.startTime, northTrip.endTime) : 0;
                                const southDuration = southTrip ? getTripDuration(southTrip.startTime, southTrip.endTime) : 0;
                                const totalRec = (northTrip?.recoveryTime || 0) + (southTrip?.recoveryTime || 0);
                                const cycleTime = northDuration + southDuration;
                                const totalTravel = cycleTime - totalRec;

                                return (
                                    <tr key={`${row.blockId}-${rowIdx}`} className={`hover:bg-gray-50 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                                        <td className="p-3 border-r border-gray-200 sticky left-0 bg-white font-bold text-gray-900 text-center z-30">
                                            {row.blockId}
                                        </td>

                                        {/* North Stop Times */}
                                        {combined.northStops.map((stop) => renderStopCell(northTrip, stop, stopsWithRecovery.has(stop), `${row.blockId}-${rowIdx}`))}

                                        {/* South Stop Times */}
                                        {combined.southStops.map((stop) => renderStopCell(southTrip, stop, stopsWithRecovery.has(stop), `${row.blockId}-${rowIdx}`))}

                                        {/* Summary Columns */}
                                        <td className="py-2 px-2 text-center text-sm text-gray-600">{totalTravel}</td>
                                        <td className="py-2 px-2 text-center text-sm text-gray-600">{totalRec}</td>
                                        <td className="py-2 px-2 text-center text-sm font-medium text-gray-900">{cycleTime}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                            {(() => {
                                // Calculate totals (handle midnight rollover)
                                let sumTravel = 0, sumRec = 0, sumCycle = 0;
                                combined.rows.forEach(row => {
                                    const northTrip = row.trips.find(t => t.direction === 'North');
                                    const southTrip = row.trips.find(t => t.direction === 'South');
                                    const northDuration = northTrip ? getTripDuration(northTrip.startTime, northTrip.endTime) : 0;
                                    const southDuration = southTrip ? getTripDuration(southTrip.startTime, southTrip.endTime) : 0;
                                    const totalRec = (northTrip?.recoveryTime || 0) + (southTrip?.recoveryTime || 0);
                                    const cycleTime = northDuration + southDuration;
                                    sumTravel += cycleTime - totalRec;
                                    sumRec += totalRec;
                                    sumCycle += cycleTime;
                                });
                                const serviceHours = (sumCycle / 60).toFixed(1);
                                const northColCount = combined.northStops.length + combined.northStops.filter(s => stopsWithRecovery.has(s)).length;
                                const southColCount = combined.southStops.length + combined.southStops.filter(s => stopsWithRecovery.has(s)).length;

                                return (
                                    <tr>
                                        <td className="p-3 border-r border-gray-200 sticky left-0 bg-gray-100 font-bold text-gray-900 text-center z-30">
                                            TOTAL
                                        </td>
                                        <td colSpan={northColCount + southColCount} className="p-3 text-right text-sm font-medium text-gray-600 pr-4">
                                            Service Hours: <span className="text-gray-900 font-bold">{serviceHours}h</span>
                                        </td>
                                        <td className="py-2 px-2 text-center text-sm font-bold text-gray-700">{sumTravel}</td>
                                        <td className="py-2 px-2 text-center text-sm font-bold text-gray-700">{sumRec}</td>
                                        <td className="py-2 px-2 text-center text-sm font-bold text-gray-900">{sumCycle}</td>
                                    </tr>
                                );
                            })()}
                        </tfoot>
                    </table>
                </div>
            );

        // Render full-screen view
        if (isFullScreen) {
            return (
                <div className="fixed inset-0 z-[100] bg-white flex flex-col">
                    {/* Full-screen header */}
                    <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">Route {selectedRoute} - {selectedDayType}</h2>
                            <p className="text-sm text-gray-600">Version {entry.currentVersion} • {entry.tripCount} trips • Read-only view</p>
                        </div>
                        <div className="flex gap-2">
                            {onLoadToTweaker && (
                                <button
                                    onClick={() => handleLoadToTweaker(routeIdentity)}
                                    className="px-4 py-2 bg-brand-green text-white rounded-lg hover:brightness-110 font-semibold flex items-center gap-2"
                                >
                                    <Edit3 size={16} />
                                    Load to Tweaker
                                </button>
                            )}
                            <button
                                onClick={() => handleShowHistory(routeIdentity, entry.currentVersion)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold flex items-center gap-2"
                            >
                                <History size={16} />
                                History
                            </button>
                            <button
                                onClick={() => setIsFullScreen(false)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold flex items-center gap-2"
                            >
                                <Minimize2 size={16} />
                                Exit Full Screen
                            </button>
                        </div>
                    </div>
                    {tableContent}
                </div>
            );
        }

        // Normal view
        return (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-full flex flex-col">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Route {selectedRoute} - {selectedDayType}</h2>
                        <p className="text-sm text-gray-600">Version {entry.currentVersion} • {entry.tripCount} trips • Read-only view</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsFullScreen(true)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold flex items-center gap-2"
                            title="Full Screen"
                        >
                            <Maximize2 size={16} />
                        </button>
                        {onLoadToTweaker && (
                            <button
                                onClick={() => handleLoadToTweaker(routeIdentity)}
                                className="px-4 py-2 bg-brand-green text-white rounded-lg hover:brightness-110 font-semibold flex items-center gap-2"
                            >
                                <Edit3 size={16} />
                                Load to Tweaker
                            </button>
                        )}
                        <button
                            onClick={() => handleShowHistory(routeIdentity, entry.currentVersion)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold"
                        >
                            <History size={16} />
                        </button>
                    </div>
                </div>
                {tableContent}
            </div>
        );
    };

    // ========== MAIN RENDER ==========
    return (
        <div className="p-8 max-w-7xl mx-auto h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between flex-shrink-0">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Master Schedule</h1>
                    <p className="text-gray-600">Source of truth for all route schedules</p>
                </div>

                {/* View Mode Toggle (only shown when a specific route is selected, not overview or platforms) */}
                {selectedRoute !== 'overview' && selectedRoute !== 'platforms' && (
                    <div className="bg-gray-100/80 p-1 rounded-lg flex items-center">
                        <button
                            onClick={() => setViewMode('card')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                                viewMode === 'card'
                                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                        >
                            <LayoutGrid size={14} /> Card
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                                viewMode === 'table'
                                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                        >
                            <TableIcon size={14} /> Table
                        </button>
                    </div>
                )}
            </div>

            {/* Route Tabs */}
            <div className="bg-gray-100/80 p-1 rounded-lg flex items-center gap-1 mb-4 overflow-x-auto flex-shrink-0">
                <button
                    onClick={() => setSelectedRoute('overview')}
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
                        selectedRoute === 'overview'
                            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                    }`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setSelectedRoute('platforms')}
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
                        selectedRoute === 'platforms'
                            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                    }`}
                >
                    Platforms
                </button>
                {ROUTE_ORDER.map(route => (
                    <button
                        key={route}
                        onClick={() => setSelectedRoute(route)}
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
                            selectedRoute === route
                                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                        }`}
                        style={selectedRoute === route ? {
                            borderBottom: `3px solid ${getRouteColor(route)}`
                        } : undefined}
                    >
                        <div
                            className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
                            style={{
                                backgroundColor: getRouteColor(route),
                                color: getRouteTextColor(route)
                            }}
                        >
                            {route}
                        </div>
                        {route}
                    </button>
                ))}
            </div>

            {/* Day Type Sub-Tabs (shown for routes and platforms, not overview) */}
            {selectedRoute !== 'overview' && (
                <div className="mb-4 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-gray-900">
                            {selectedRoute === 'platforms' ? 'Platform Summary' : `Route ${selectedRoute}`}
                        </h2>
                        <span className="text-gray-400">•</span>
                        <div className="bg-gray-100/80 p-1 rounded-lg flex items-center">
                            {DAY_TYPES.map(dayType => (
                                <button
                                    key={dayType}
                                    onClick={() => setSelectedDayType(dayType)}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                                        selectedDayType === dayType
                                            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                                    }`}
                                >
                                    {dayType}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-12 flex-1">
                    <Loader2 className="animate-spin text-brand-green" size={32} />
                </div>
            )}

            {/* Content Area - fills remaining height */}
            {!loading && (
                <div className="flex-1 min-h-0 overflow-hidden">
                    {selectedRoute === 'overview' && <div className="h-full overflow-y-auto">{renderOverview()}</div>}
                    {selectedRoute === 'platforms' && (
                        <div className="h-full overflow-y-auto">
                            <PlatformSummary
                                dayType={selectedDayType}
                                schedules={schedules}
                                contentCache={contentCache}
                            />
                        </div>
                    )}
                    {selectedRoute !== 'overview' && selectedRoute !== 'platforms' && viewMode === 'card' && <div className="h-full overflow-y-auto">{renderScheduleCard()}</div>}
                    {selectedRoute !== 'overview' && selectedRoute !== 'platforms' && viewMode === 'table' && renderScheduleTable()}
                </div>
            )}
        </div>
    );
};
