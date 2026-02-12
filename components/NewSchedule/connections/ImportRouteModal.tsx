/**
 * ImportRouteModal
 *
 * Modal for importing route-to-route connections from the master schedule.
 */

import React, { useState, useEffect } from 'react';
import {
    X,
    Bus,
    Loader2,
    Search,
    AlertCircle
} from 'lucide-react';
import type {
    ConnectionTarget,
    ConnectionTargetType
} from '../../../utils/connectionTypes';
import type { DayType, MasterRouteTable } from '../../../utils/masterScheduleParser';
import type { RouteIdentity } from '../../../utils/masterScheduleTypes';
import { getAllMasterSchedules, getMasterSchedule } from '../../../utils/masterScheduleService';

interface ImportRouteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>) => void;
    teamId: string;
    currentRouteIdentity: string; // Exclude current route from selection
    existingTargetNames: string[];
}

interface RouteOption {
    routeIdentity: RouteIdentity;
    routeNumber: string;
    dayType: DayType;
    tripCount: number;
}

export const ImportRouteModal: React.FC<ImportRouteModalProps> = ({
    isOpen,
    onClose,
    onImport,
    teamId,
    currentRouteIdentity,
    existingTargetNames
}) => {
    const [routes, setRoutes] = useState<RouteOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Selected route details
    const [selectedRoute, setSelectedRoute] = useState<RouteOption | null>(null);
    const [routeData, setRouteData] = useState<{
        northTable?: MasterRouteTable;
        southTable?: MasterRouteTable;
    } | null>(null);
    const [isLoadingRoute, setIsLoadingRoute] = useState(false);

    // Form state
    const [selectedDirection, setSelectedDirection] = useState<'North' | 'South'>('North');
    const [selectedStop, setSelectedStop] = useState('');

    // Load available routes
    useEffect(() => {
        if (!isOpen) return;

        const loadRoutes = async () => {
            try {
                setIsLoading(true);
                setError('');

                const schedules = await getAllMasterSchedules(teamId);
                const routeOptions: RouteOption[] = schedules
                    .filter(s => s.id !== currentRouteIdentity)
                    .map(s => ({
                        routeIdentity: s.id as RouteIdentity,
                        routeNumber: s.routeNumber,
                        dayType: s.dayType,
                        tripCount: s.tripCount || 0
                    }));

                setRoutes(routeOptions);
            } catch (err) {
                console.error('Error loading routes:', err);
                setError('Failed to load routes');
            } finally {
                setIsLoading(false);
            }
        };

        loadRoutes();
    }, [isOpen, teamId, currentRouteIdentity]);

    // Load route details when selected
    useEffect(() => {
        if (!selectedRoute) {
            setRouteData(null);
            return;
        }

        const loadRouteData = async () => {
            try {
                setIsLoadingRoute(true);
                const result = await getMasterSchedule(teamId, selectedRoute.routeIdentity);
                if (result) {
                    setRouteData({
                        northTable: result.content.northTable,
                        southTable: result.content.southTable
                    });
                    // Default to first stop
                    const stops = result.content.northTable?.stops || [];
                    if (stops.length > 0) {
                        setSelectedStop(stops[0]);
                    }
                }
            } catch (err) {
                console.error('Error loading route data:', err);
                setError('Failed to load route details');
            } finally {
                setIsLoadingRoute(false);
            }
        };

        loadRouteData();
    }, [selectedRoute, teamId]);

    if (!isOpen) return null;

    // Filter routes by search
    const filteredRoutes = routes.filter(r =>
        r.routeNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.routeIdentity.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Get stops for selected direction
    const activeTable = selectedDirection === 'North'
        ? routeData?.northTable
        : routeData?.southTable;
    const activeStopIds = activeTable?.stopIds || {};
    const availableStops = (activeTable?.stops || []).map(stopName => ({
        name: stopName,
        code: activeStopIds[stopName] || ''
    }));

    // Handle import
    const handleImport = () => {
        if (!selectedRoute || !selectedStop) {
            setError('Please select a route and stop');
            return;
        }

        const normalizedName = `route ${selectedRoute.routeNumber} (${selectedDirection})`.toLowerCase();
        if (existingTargetNames.some(existing => existing.trim().toLowerCase() === normalizedName)) {
            setError('A target with this name already exists');
            return;
        }

        const stopCode = availableStops.find(stop => stop.name === selectedStop)?.code || '';
        if (!stopCode) {
            setError('Selected stop is missing a stop code');
            return;
        }

        onImport({
            name: `Route ${selectedRoute.routeNumber} (${selectedDirection})`,
            type: 'route' as ConnectionTargetType,
            routeIdentity: selectedRoute.routeIdentity,
            stopCode,
            stopName: selectedStop,
            direction: selectedDirection,
            icon: 'bus',
            color: 'blue'
        });

        // Reset and close
        setSelectedRoute(null);
        setSelectedDirection('North');
        setSelectedStop('');
        setSearchQuery('');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                        Import Route Connection
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {/* Loading */}
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : routes.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <Bus className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                            <p>No other routes available</p>
                        </div>
                    ) : (
                        <>
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search routes..."
                                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>

                            {/* Route list */}
                            {!selectedRoute ? (
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {filteredRoutes.map(route => (
                                        <button
                                            key={route.routeIdentity}
                                            onClick={() => setSelectedRoute(route)}
                                            className="w-full flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-left"
                                        >
                                            <Bus className="w-5 h-5 text-blue-500" />
                                            <div className="flex-1">
                                                <div className="font-medium text-gray-900">
                                                    Route {route.routeNumber}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {route.dayType} • {route.tripCount} trips
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                /* Route configuration */
                                <div className="space-y-4">
                                    {/* Selected route */}
                                    <div className="flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                                        <Bus className="w-5 h-5 text-blue-600" />
                                        <div className="flex-1">
                                            <div className="font-medium text-blue-900">
                                                Route {selectedRoute.routeNumber}
                                            </div>
                                            <div className="text-xs text-blue-700">
                                                {selectedRoute.dayType}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setSelectedRoute(null)}
                                            className="text-sm text-blue-600 hover:text-blue-700"
                                        >
                                            Change
                                        </button>
                                    </div>

                                    {isLoadingRoute ? (
                                        <div className="flex items-center justify-center py-4">
                                            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                                        </div>
                                    ) : (
                                        <>
                                            {/* Direction */}
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    Direction
                                                </label>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedDirection('North');
                                                            const stops = routeData?.northTable?.stops || [];
                                                            if (stops.length > 0) setSelectedStop(stops[0]);
                                                        }}
                                                        className={`flex-1 px-3 py-2 rounded-lg border ${
                                                            selectedDirection === 'North'
                                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        North
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSelectedDirection('South');
                                                            const stops = routeData?.southTable?.stops || [];
                                                            if (stops.length > 0) setSelectedStop(stops[0]);
                                                        }}
                                                        className={`flex-1 px-3 py-2 rounded-lg border ${
                                                            selectedDirection === 'South'
                                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        South
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Stop */}
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    Connection Stop
                                                </label>
                        <select
                            value={selectedStop}
                            onChange={(e) => setSelectedStop(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {availableStops.map(stop => (
                                <option key={stop.name} value={stop.name}>
                                    {stop.name}{stop.code ? ` (#${stop.code})` : ''}
                                </option>
                            ))}
                        </select>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    Select the stop where connections will be made
                                                </p>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={!selectedRoute || !selectedStop || isLoadingRoute}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Import Connection
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImportRouteModal;
