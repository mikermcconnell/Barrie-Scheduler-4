/**
 * GTFS Import Component
 *
 * Allows importing existing schedules from Barrie Transit's GTFS feed.
 * Can be used standalone (dashboard) or within the New Schedule wizard.
 */

import React, { useState, useEffect } from 'react';
import {
    Database,
    Download,
    Loader2,
    RefreshCw,
    Check,
    AlertCircle,
    ChevronRight,
    Bus,
    Calendar,
    ArrowRight,
    X,
    Settings,
} from 'lucide-react';
import type { ParsedGTFSFeed, GTFSRouteOption, GTFSImportConfig, GTFSImportResult, GTFSImportOptions } from '../utils/gtfsTypes';
import {
    fetchGTFSFeed,
    getAvailableRoutes,
    importRouteFromGTFS,
    importAllRoutesFromGTFS,
    getDefaultGTFSConfig,
    type SystemImportResult,
} from '../utils/gtfsImportService';
import type { DayType } from '../utils/masterScheduleTypes';

interface GTFSImportProps {
    userId: string;
    onImportComplete?: (result: GTFSImportResult) => void;
    onSystemImportComplete?: (result: SystemImportResult) => void;
    onCancel?: () => void;
    showHeader?: boolean;
    className?: string;
}

export const GTFSImport: React.FC<GTFSImportProps> = ({
    userId,
    onImportComplete,
    onSystemImportComplete,
    onCancel,
    showHeader = true,
    className = '',
}) => {
    // State
    const [config, setConfig] = useState<GTFSImportConfig>(getDefaultGTFSConfig());
    const [feed, setFeed] = useState<ParsedGTFSFeed | null>(null);
    const [routes, setRoutes] = useState<GTFSRouteOption[]>([]);
    const [selectedRoute, setSelectedRoute] = useState<GTFSRouteOption | null>(null);
    const [draftName, setDraftName] = useState('');

    // Loading states
    const [isFetching, setIsFetching] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter state
    const [filterDayType, setFilterDayType] = useState<DayType | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSettings, setShowSettings] = useState(false);

    // Import options
    const [timepointsOnly, setTimepointsOnly] = useState(true); // Default: timepoints only

    // Bulk import state
    const [isBulkImporting, setIsBulkImporting] = useState(false);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, currentRoute: '' });

    // System draft import state
    const [isSystemImporting, setIsSystemImporting] = useState(false);
    const [systemImportDayType, setSystemImportDayType] = useState<DayType | null>(null);

    // Import all day types state
    const [isImportingAllDayTypes, setIsImportingAllDayTypes] = useState(false);
    const [allDayTypesProgress, setAllDayTypesProgress] = useState({ current: 0, total: 0, currentDayType: '' });

    // Fetch GTFS feed on mount or when URL changes
    const handleFetchFeed = async () => {
        setIsFetching(true);
        setError(null);

        try {
            const fetchedFeed = await fetchGTFSFeed(config.feedUrl);
            setFeed(fetchedFeed);

            const availableRoutes = getAvailableRoutes(fetchedFeed, config);
            setRoutes(availableRoutes);

            if (availableRoutes.length === 0) {
                setError('No routes found in GTFS feed');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch GTFS feed');
        } finally {
            setIsFetching(false);
        }
    };

    // Auto-fetch on mount
    useEffect(() => {
        handleFetchFeed();
    }, []);

    // Handle route selection
    const handleSelectRoute = (route: GTFSRouteOption) => {
        setSelectedRoute(route);
        setDraftName(`Route ${route.routeShortName} - GTFS Import`);
    };

    // Handle import
    const handleImport = async () => {
        console.log('🚀 handleImport called', { feed: !!feed, selectedRoute, userId });
        if (!feed || !selectedRoute) {
            console.error('❌ Missing feed or selectedRoute');
            return;
        }

        setIsImporting(true);
        setError(null);

        try {
            const importOptions: GTFSImportOptions = { timepointsOnly };
            console.log('📦 Calling importRouteFromGTFS...', importOptions);
            const result = await importRouteFromGTFS(
                feed,
                selectedRoute,
                userId,
                draftName || undefined,
                config,
                importOptions
            );
            console.log('📋 Import result:', result);

            if (result.success) {
                console.log('✅ Import successful, calling onImportComplete');
                onImportComplete?.(result);
            } else {
                console.error('❌ Import failed:', result.error);
                setError(result.error || 'Import failed');
            }
        } catch (err) {
            console.error('❌ Import exception:', err);
            setError(err instanceof Error ? err.message : 'Import failed');
        } finally {
            setIsImporting(false);
        }
    };

    // Handle bulk import of all filtered routes
    const handleImportAll = async () => {
        if (!feed || filteredRoutes.length === 0) return;

        setIsBulkImporting(true);
        setError(null);
        setBulkProgress({ current: 0, total: filteredRoutes.length, currentRoute: '' });

        const importOptions: GTFSImportOptions = { timepointsOnly };
        const results: GTFSImportResult[] = [];
        const allDraftIds: string[] = [];

        for (let i = 0; i < filteredRoutes.length; i++) {
            const route = filteredRoutes[i];
            setBulkProgress({
                current: i + 1,
                total: filteredRoutes.length,
                currentRoute: `Route ${route.routeShortName} (${route.dayType})`
            });

            try {
                const result = await importRouteFromGTFS(
                    feed,
                    route,
                    userId,
                    `Route ${route.routeShortName} - ${route.dayType}`,
                    config,
                    importOptions
                );
                results.push(result);
                if (result.success && result.draftId) {
                    allDraftIds.push(result.draftId);
                }
            } catch (err) {
                console.error(`Failed to import ${route.routeShortName}:`, err);
                results.push({
                    success: false,
                    error: err instanceof Error ? err.message : 'Unknown error'
                });
            }
        }

        setIsBulkImporting(false);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        if (successCount > 0) {
            // Return result with all draft IDs for bulk import
            onImportComplete?.({
                success: true,
                allDraftIds,
                draftId: allDraftIds[0], // First one for backward compat
                warnings: [
                    `Imported ${successCount} of ${filteredRoutes.length} routes`,
                    ...(failCount > 0 ? [`${failCount} routes failed to import`] : [])
                ]
            });
        } else {
            setError(`Failed to import any routes. ${failCount} routes failed.`);
        }
    };

    // Handle import as system draft (all routes for a day type)
    const handleImportAsSystem = async (dayType: DayType) => {
        if (!feed) return;

        setIsSystemImporting(true);
        setSystemImportDayType(dayType);
        setError(null);

        try {
            const importOptions: GTFSImportOptions = { timepointsOnly };
            const result = await importAllRoutesFromGTFS(
                feed,
                dayType,
                userId,
                undefined, // Auto-generate name
                config,
                importOptions
            );

            if (result.success) {
                onSystemImportComplete?.(result);
            } else {
                setError(result.error || 'System import failed');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'System import failed');
        } finally {
            setIsSystemImporting(false);
            setSystemImportDayType(null);
        }
    };

    // Handle import ALL day types as system drafts (Weekday + Saturday + Sunday)
    const handleImportAllDayTypes = async () => {
        if (!feed) return;

        const dayTypesToImport: DayType[] = ['Weekday', 'Saturday', 'Sunday'].filter(
            dt => (routeCountsByDayType[dt as DayType] || 0) > 0
        ) as DayType[];

        if (dayTypesToImport.length === 0) {
            setError('No routes found in any day type');
            return;
        }

        setIsImportingAllDayTypes(true);
        setError(null);
        setAllDayTypesProgress({ current: 0, total: dayTypesToImport.length, currentDayType: '' });

        const importOptions: GTFSImportOptions = { timepointsOnly };
        const results: SystemImportResult[] = [];

        for (let i = 0; i < dayTypesToImport.length; i++) {
            const dayType = dayTypesToImport[i];
            setAllDayTypesProgress({
                current: i + 1,
                total: dayTypesToImport.length,
                currentDayType: dayType
            });

            try {
                const result = await importAllRoutesFromGTFS(
                    feed,
                    dayType,
                    userId,
                    undefined,
                    config,
                    importOptions
                );
                results.push(result);
            } catch (err) {
                results.push({
                    success: false,
                    error: err instanceof Error ? err.message : 'Unknown error'
                });
            }
        }

        setIsImportingAllDayTypes(false);

        const successCount = results.filter(r => r.success).length;
        const totalRoutes = results.reduce((sum, r) => sum + (r.routeCount || 0), 0);

        if (successCount > 0) {
            // Return the last successful result (or first) so it opens in editor
            const lastSuccess = results.filter(r => r.success).pop();
            if (lastSuccess) {
                onSystemImportComplete?.({
                    ...lastSuccess,
                    warnings: [
                        `Created ${successCount} system drafts with ${totalRoutes} total routes`,
                        ...(lastSuccess.warnings || [])
                    ]
                });
            }
        } else {
            setError('Failed to import any day types');
        }
    };

    // Get route counts by day type
    const routeCountsByDayType = routes.reduce((acc, route) => {
        acc[route.dayType] = (acc[route.dayType] || 0) + 1;
        return acc;
    }, {} as Record<DayType, number>);

    // Count available day types
    const availableDayTypes = (['Weekday', 'Saturday', 'Sunday'] as DayType[]).filter(
        dt => (routeCountsByDayType[dt] || 0) > 0
    );

    // Filter routes
    const filteredRoutes = routes.filter(route => {
        if (filterDayType !== 'all' && route.dayType !== filterDayType) return false;
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
                route.routeShortName.toLowerCase().includes(query) ||
                route.routeLongName.toLowerCase().includes(query)
            );
        }
        return true;
    });

    // Group routes by route number for display
    const groupedRoutes = filteredRoutes.reduce((acc, route) => {
        const key = route.routeShortName;
        if (!acc[key]) acc[key] = [];
        acc[key].push(route);
        return acc;
    }, {} as Record<string, GTFSRouteOption[]>);

    return (
        <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${className}`}>
            {/* Header */}
            {showHeader && (
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/20 p-2 rounded-lg">
                            <Database className="text-white" size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Import from GTFS</h2>
                            <p className="text-blue-100 text-sm">
                                Import existing schedules from Barrie Transit
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            title="Settings"
                        >
                            <Settings size={20} />
                        </button>
                        {onCancel && (
                            <button
                                onClick={onCancel}
                                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Settings Panel */}
            {showSettings && (
                <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-medium text-gray-700">Feed URL:</label>
                        <input
                            type="text"
                            value={config.feedUrl}
                            onChange={(e) => setConfig({ ...config, feedUrl: e.target.value })}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            placeholder="https://myridebarrie.ca/gtfs"
                        />
                        <button
                            onClick={handleFetchFeed}
                            disabled={isFetching}
                            className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
                        >
                            {isFetching ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <RefreshCw size={16} />
                            )}
                            Refresh
                        </button>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="p-6">
                {/* Error Display */}
                {error && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                        <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                        <div>
                            <p className="text-red-800 font-medium">Error</p>
                            <p className="text-red-600 text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isFetching && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="text-brand-blue animate-spin mb-4" size={48} />
                        <p className="text-gray-600 font-medium">Fetching GTFS feed...</p>
                        <p className="text-gray-400 text-sm">This may take a moment</p>
                    </div>
                )}

                {/* Route Selection */}
                {!isFetching && routes.length > 0 && !selectedRoute && (
                    <>
                        {/* Filters */}
                        <div className="flex items-center gap-4 mb-6">
                            <div className="flex-1">
                                <input
                                    type="text"
                                    placeholder="Search routes..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-brand-blue"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                {(['all', 'Weekday', 'Saturday', 'Sunday'] as const).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setFilterDayType(type)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                            filterDayType === type
                                                ? 'bg-brand-blue text-white'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        {type === 'all' ? 'All Days' : type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Bulk Import Progress */}
                        {isBulkImporting && (
                            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium text-blue-800">
                                        Importing routes...
                                    </span>
                                    <span className="text-sm text-blue-600">
                                        {bulkProgress.current} / {bulkProgress.total}
                                    </span>
                                </div>
                                <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                                    <div
                                        className="bg-blue-600 h-2 rounded-full transition-all"
                                        style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                                    />
                                </div>
                                <p className="text-sm text-blue-600">{bulkProgress.currentRoute}</p>
                            </div>
                        )}

                        {/* Import System Draft Section */}
                        {!isBulkImporting && !isSystemImporting && !isImportingAllDayTypes && onSystemImportComplete && (
                            <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <Database className="text-purple-600" size={20} />
                                        <p className="font-medium text-gray-800">Import as System Draft</p>
                                        <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                                            Recommended
                                        </span>
                                    </div>
                                    {/* Import All Day Types Button */}
                                    {availableDayTypes.length > 1 && (
                                        <button
                                            onClick={handleImportAllDayTypes}
                                            className="px-4 py-2 bg-purple-700 text-white font-bold rounded-lg hover:bg-purple-800 transition-colors flex items-center gap-2 shadow-md"
                                        >
                                            <Download size={16} />
                                            Import All ({availableDayTypes.length} day types)
                                        </button>
                                    )}
                                </div>
                                <p className="text-sm text-gray-500 mb-3">
                                    Import all routes for a day type together. This enables interline logic between routes like 8A and 8B.
                                </p>
                                <div className="flex gap-2">
                                    {(['Weekday', 'Saturday', 'Sunday'] as DayType[]).map((dt) => {
                                        const count = routeCountsByDayType[dt] || 0;
                                        if (count === 0) return null;
                                        const isImporting = isSystemImporting && systemImportDayType === dt;
                                        return (
                                            <button
                                                key={dt}
                                                onClick={() => handleImportAsSystem(dt)}
                                                disabled={isSystemImporting}
                                                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                                                    isImporting
                                                        ? 'bg-purple-200 text-purple-700'
                                                        : 'bg-purple-600 text-white hover:bg-purple-700'
                                                } disabled:opacity-50`}
                                            >
                                                {isImporting ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <Download size={16} />
                                                )}
                                                {dt} ({count})
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* System Import Progress - Single Day Type */}
                        {isSystemImporting && (
                            <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Loader2 className="text-purple-600 animate-spin" size={20} />
                                    <div>
                                        <p className="font-medium text-purple-800">
                                            Importing {systemImportDayType} System Draft...
                                        </p>
                                        <p className="text-sm text-purple-600">
                                            Processing all routes for {systemImportDayType}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Import All Day Types Progress */}
                        {isImportingAllDayTypes && (
                            <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium text-purple-800">
                                        Importing All Day Types...
                                    </span>
                                    <span className="text-sm text-purple-600">
                                        {allDayTypesProgress.current} / {allDayTypesProgress.total}
                                    </span>
                                </div>
                                <div className="w-full bg-purple-200 rounded-full h-2 mb-2">
                                    <div
                                        className="bg-purple-600 h-2 rounded-full transition-all"
                                        style={{ width: `${(allDayTypesProgress.current / allDayTypesProgress.total) * 100}%` }}
                                    />
                                </div>
                                <div className="flex items-center gap-2 text-sm text-purple-600">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>Processing {allDayTypesProgress.currentDayType} routes...</span>
                                </div>
                            </div>
                        )}

                        {/* Import All Button (legacy - separate drafts) */}
                        {!isBulkImporting && !isSystemImporting && filteredRoutes.length > 1 && !onSystemImportComplete && (
                            <div className="mb-4 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-gray-800">Import All Routes</p>
                                    <p className="text-sm text-gray-500">
                                        Import all {filteredRoutes.length} filtered routes at once
                                    </p>
                                </div>
                                <button
                                    onClick={handleImportAll}
                                    className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                                >
                                    <Download size={18} />
                                    Import All ({filteredRoutes.length})
                                </button>
                            </div>
                        )}

                        {/* Route List */}
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {Object.entries(groupedRoutes).map(([routeNum, routeOptions]) => (
                                <div key={routeNum} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="bg-gray-50 px-4 py-2 flex items-center gap-3">
                                        <Bus className="text-gray-400" size={18} />
                                        <span className="font-bold text-gray-800">Route {routeNum}</span>
                                        {routeOptions[0]?.routeLongName && (
                                            <span className="text-gray-500 text-sm">
                                                - {routeOptions[0].routeLongName}
                                            </span>
                                        )}
                                    </div>
                                    <div className="divide-y divide-gray-100">
                                        {routeOptions.map((route) => (
                                            <button
                                                key={`${route.routeId}-${route.serviceId}`}
                                                onClick={() => handleSelectRoute(route)}
                                                className="w-full px-4 py-3 flex items-center justify-between hover:bg-blue-50 transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Calendar className="text-gray-400" size={16} />
                                                    <span className="font-medium text-gray-700">
                                                        {route.dayType}
                                                    </span>
                                                    {route.isMergedRoute ? (
                                                        <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">
                                                            N + S
                                                        </span>
                                                    ) : route.direction && (
                                                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                                            {route.direction}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {route.isMergedRoute ? (
                                                        <span className="text-sm text-gray-500">
                                                            {route.northTripCount}↑ + {route.southTripCount}↓ trips
                                                        </span>
                                                    ) : (
                                                        <span className="text-sm text-gray-500">
                                                            {route.tripCount} trips
                                                        </span>
                                                    )}
                                                    <ChevronRight className="text-gray-400" size={16} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {filteredRoutes.length === 0 && (
                                <div className="text-center py-8 text-gray-500">
                                    No routes found matching your filters
                                </div>
                            )}
                        </div>

                        <p className="mt-4 text-sm text-gray-500 text-center">
                            {filteredRoutes.length} route/day combinations available
                        </p>
                    </>
                )}

                {/* Selected Route - Confirmation */}
                {selectedRoute && (
                    <div className="space-y-6">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setSelectedRoute(null)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <ArrowRight className="rotate-180" size={20} />
                            </button>
                            <h3 className="text-lg font-bold text-gray-800">Confirm Import</h3>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Route:</span>
                                <span className="font-bold text-gray-800">
                                    {selectedRoute.isMergedRoute
                                        ? selectedRoute.displayName
                                        : `${selectedRoute.routeShortName}${selectedRoute.routeLongName ? ` - ${selectedRoute.routeLongName}` : ''}`
                                    }
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Day Type:</span>
                                <span className="font-medium text-gray-800">{selectedRoute.dayType}</span>
                            </div>
                            {selectedRoute.isMergedRoute ? (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">North Trips:</span>
                                        <span className="font-medium text-gray-800">{selectedRoute.northTripCount}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">South Trips:</span>
                                        <span className="font-medium text-gray-800">{selectedRoute.southTripCount}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-gray-200 pt-2">
                                        <span className="text-gray-600">Total Trips:</span>
                                        <span className="font-bold text-gray-800">{selectedRoute.tripCount}</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Trips:</span>
                                        <span className="font-medium text-gray-800">{selectedRoute.tripCount}</span>
                                    </div>
                                    {selectedRoute.direction && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Direction:</span>
                                            <span className="font-medium text-gray-800">{selectedRoute.direction}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Draft Name
                            </label>
                            <input
                                type="text"
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-brand-blue"
                                placeholder="Enter a name for this draft..."
                            />
                        </div>

                        {/* Stop Import Options */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-gray-800">Timepoints Only</p>
                                    <p className="text-sm text-gray-500">
                                        {timepointsOnly
                                            ? 'Import only scheduled timepoints (recommended for scheduling)'
                                            : 'Import all stops from GTFS feed'
                                        }
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setTimepointsOnly(!timepointsOnly)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        timepointsOnly ? 'bg-brand-blue' : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            timepointsOnly ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setSelectedRoute(null)}
                                className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={isImporting}
                                className="px-6 py-2 bg-brand-blue text-white font-bold rounded-lg hover:brightness-110 shadow-md shadow-blue-500/20 flex items-center gap-2 disabled:opacity-50"
                            >
                                {isImporting ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        Importing...
                                    </>
                                ) : (
                                    <>
                                        <Download size={18} />
                                        Import to Draft
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* No Routes State */}
                {!isFetching && routes.length === 0 && !error && (
                    <div className="text-center py-12">
                        <Database className="mx-auto text-gray-300 mb-4" size={48} />
                        <p className="text-gray-600 font-medium">No routes available</p>
                        <p className="text-gray-400 text-sm">Try refreshing the GTFS feed</p>
                        <button
                            onClick={handleFetchFeed}
                            className="mt-4 px-4 py-2 bg-brand-blue text-white rounded-lg font-medium hover:brightness-110"
                        >
                            <RefreshCw size={16} className="inline mr-2" />
                            Refresh Feed
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Modal wrapper for GTFS Import
 */
interface GTFSImportModalProps extends GTFSImportProps {
    isOpen: boolean;
    onClose: () => void;
}

export const GTFSImportModal: React.FC<GTFSImportModalProps> = ({
    isOpen,
    onClose,
    ...props
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
                <GTFSImport
                    {...props}
                    onCancel={onClose}
                />
            </div>
        </div>
    );
};

export default GTFSImport;
