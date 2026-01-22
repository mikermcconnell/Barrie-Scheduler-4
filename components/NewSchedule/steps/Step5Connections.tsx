/**
 * Step 5: Connection Optimization
 *
 * Allows users to optimize schedules to connect with external services
 * (GO Trains, Georgian College bells) and other bus routes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Link2,
    Plus,
    Settings2,
    Play,
    RotateCcw,
    ChevronDown,
    ChevronUp,
    Train,
    Clock,
    Bus,
    AlertCircle,
    CheckCircle2,
    Info
} from 'lucide-react';
import type { MasterRouteTable } from '../../../utils/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    RouteConnectionConfig,
    RouteConnection,
    OptimizationMode,
    OptimizationResult
} from '../../../utils/connectionTypes';
import { formatConnectionTime } from '../../../utils/connectionTypes';
import { ConnectionLibraryPanel } from '../connections/ConnectionLibraryPanel';
import { RouteConnectionPanel } from '../connections/RouteConnectionPanel';
import { OptimizationPanel } from '../connections/OptimizationPanel';
import { AddTargetModal } from '../connections/AddTargetModal';
import { ImportRouteModal } from '../connections/ImportRouteModal';
import { ConnectionStatusPanel } from '../../connections/ConnectionStatusPanel';
import { getConnectionLibrary, saveConnectionLibrary } from '../../../utils/connectionLibraryService';
import { optimizeForConnections, checkConnections, ConnectionCheckResult } from '../../../utils/connectionOptimizer';

interface Step5Props {
    schedules: MasterRouteTable[];
    routeIdentity: string;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';

    // Connection state (lifted to wizard)
    connectionLibrary: ConnectionLibrary | null;
    setConnectionLibrary: (lib: ConnectionLibrary) => void;
    routeConnectionConfig: RouteConnectionConfig | null;
    setRouteConnectionConfig: (config: RouteConnectionConfig) => void;

    // Optimization callbacks
    onOptimize: (result: OptimizationResult) => void;
    onReset: () => void;

    // Team context
    teamId: string;
    userId: string;
}

export const Step5Connections: React.FC<Step5Props> = ({
    schedules,
    routeIdentity,
    dayType,
    connectionLibrary,
    setConnectionLibrary,
    routeConnectionConfig,
    setRouteConnectionConfig,
    onOptimize,
    onReset,
    teamId,
    userId
}) => {
    // Local UI state
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
    const [showAddTargetModal, setShowAddTargetModal] = useState(false);
    const [showImportRouteModal, setShowImportRouteModal] = useState(false);
    const [expandedSection, setExpandedSection] = useState<'library' | 'config' | 'optimize' | null>('library');
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionCheckResult | null>(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);

    // Load connection library from Firebase on mount
    useEffect(() => {
        if (!teamId || connectionLibrary) return;

        const loadLibrary = async () => {
            setIsLoadingLibrary(true);
            try {
                const library = await getConnectionLibrary(teamId);
                if (library) {
                    setConnectionLibrary(library);
                } else {
                    // Initialize empty library
                    setConnectionLibrary({
                        targets: [],
                        updatedAt: new Date().toISOString(),
                        updatedBy: userId
                    });
                }
            } catch (error) {
                console.error('Error loading connection library:', error);
                // Initialize empty library on error
                setConnectionLibrary({
                    targets: [],
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId
                });
            } finally {
                setIsLoadingLibrary(false);
            }
        };

        loadLibrary();
    }, [teamId, connectionLibrary, setConnectionLibrary, userId]);

    // Save library to Firebase when it changes
    useEffect(() => {
        if (!teamId || !connectionLibrary || isLoadingLibrary) return;

        const saveLibrary = async () => {
            try {
                await saveConnectionLibrary(teamId, connectionLibrary, userId);
            } catch (error) {
                console.error('Error saving connection library:', error);
            }
        };

        // Debounce save
        const timer = setTimeout(saveLibrary, 1000);
        return () => clearTimeout(timer);
    }, [teamId, connectionLibrary, userId, isLoadingLibrary]);

    // Initialize empty config if needed
    useEffect(() => {
        if (!routeConnectionConfig) {
            setRouteConnectionConfig({
                routeIdentity,
                connections: [],
                optimizationMode: 'hybrid'
            });
        }
    }, [routeIdentity, routeConnectionConfig, setRouteConnectionConfig]);

    // Check connection status whenever schedules, config, or library changes
    useEffect(() => {
        if (!connectionLibrary || !routeConnectionConfig || schedules.length === 0) {
            setConnectionStatus(null);
            return;
        }

        setIsCheckingStatus(true);
        try {
            const result = checkConnections(schedules, routeConnectionConfig, connectionLibrary);
            setConnectionStatus(result);
        } catch (error) {
            console.error('Error checking connections:', error);
            setConnectionStatus(null);
        } finally {
            setIsCheckingStatus(false);
        }
    }, [schedules, connectionLibrary, routeConnectionConfig]);

    // Get stop names from current schedules
    const availableStops = React.useMemo(() => {
        const stops = new Set<string>();
        schedules.forEach(table => {
            table.stops.forEach(stop => stops.add(stop));
        });
        return Array.from(stops);
    }, [schedules]);

    // Count statistics
    const stats = React.useMemo(() => {
        const targetCount = connectionLibrary?.targets.length || 0;
        const connectionCount = routeConnectionConfig?.connections.length || 0;
        const enabledCount = routeConnectionConfig?.connections.filter(c => c.enabled).length || 0;
        return { targetCount, connectionCount, enabledCount };
    }, [connectionLibrary, routeConnectionConfig]);

    // Handle adding a new target
    const handleAddTarget = useCallback((target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!connectionLibrary) return;

        const newTarget: ConnectionTarget = {
            ...target,
            id: `target_${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        setConnectionLibrary({
            ...connectionLibrary,
            targets: [...connectionLibrary.targets, newTarget],
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        });

        setShowAddTargetModal(false);
    }, [connectionLibrary, setConnectionLibrary, userId]);

    // Handle adding a connection
    const handleAddConnection = useCallback((connection: Omit<RouteConnection, 'id'>) => {
        if (!routeConnectionConfig) return;

        const newConnection: RouteConnection = {
            ...connection,
            id: `conn_${Date.now()}`
        };

        setRouteConnectionConfig({
            ...routeConnectionConfig,
            connections: [...routeConnectionConfig.connections, newConnection]
        });
    }, [routeConnectionConfig, setRouteConnectionConfig]);

    // Handle optimization mode change
    const handleModeChange = useCallback((mode: OptimizationMode) => {
        if (!routeConnectionConfig) return;
        setRouteConnectionConfig({
            ...routeConnectionConfig,
            optimizationMode: mode
        });
    }, [routeConnectionConfig, setRouteConnectionConfig]);

    // Handle running optimization
    const handleRunOptimization = useCallback(async () => {
        if (!connectionLibrary || !routeConnectionConfig || schedules.length === 0) return;

        setIsOptimizing(true);
        try {
            const result = optimizeForConnections(
                schedules,
                routeConnectionConfig,
                connectionLibrary,
                routeConnectionConfig.optimizationMode || 'hybrid'
            );

            setOptimizationResult(result);
            onOptimize(result);
        } catch (error) {
            console.error('Optimization error:', error);
        } finally {
            setIsOptimizing(false);
        }
    }, [connectionLibrary, routeConnectionConfig, schedules, onOptimize]);

    // Handle reset
    const handleReset = useCallback(() => {
        setOptimizationResult(null);
        onReset();
    }, [onReset]);

    // Check if we can optimize
    const canOptimize = stats.enabledCount > 0 && schedules.length > 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-blue-600" />
                        Connection Optimization
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Optimize trip times to connect with GO Trains, Georgian College, and other routes
                    </p>
                </div>

                {/* Quick stats */}
                <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-gray-600">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <span>{stats.targetCount} targets</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-600">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span>{stats.enabledCount} active</span>
                    </div>
                </div>
            </div>

            {/* Connection Status Panel - shows current state */}
            <ConnectionStatusPanel
                checkResult={connectionStatus}
                isLoading={isCheckingStatus}
                onConfigureClick={() => setExpandedSection('config')}
            />

            {/* Info banner if no connections */}
            {stats.targetCount === 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-blue-900">Get started with connections</p>
                        <p className="text-sm text-blue-700 mt-1">
                            Add connection targets (GO Train times, Georgian College bells, or other routes)
                            to the library, then configure which ones this route should connect to.
                        </p>
                    </div>
                </div>
            )}

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Connection Library */}
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <button
                        onClick={() => setExpandedSection(expandedSection === 'library' ? null : 'library')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Train className="w-4 h-4 text-gray-600" />
                            <span className="font-medium text-gray-900">Connection Library</span>
                            <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                {stats.targetCount}
                            </span>
                        </div>
                        {expandedSection === 'library' ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                    </button>

                    {expandedSection === 'library' && (
                        <ConnectionLibraryPanel
                            library={connectionLibrary}
                            onUpdateLibrary={setConnectionLibrary}
                            onAddTarget={() => setShowAddTargetModal(true)}
                            onImportRoute={() => setShowImportRouteModal(true)}
                            userId={userId}
                            dayType={dayType}
                        />
                    )}
                </div>

                {/* Right: Route Connections */}
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <button
                        onClick={() => setExpandedSection(expandedSection === 'config' ? null : 'config')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Settings2 className="w-4 h-4 text-gray-600" />
                            <span className="font-medium text-gray-900">Route Connections</span>
                            <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                {stats.connectionCount}
                            </span>
                        </div>
                        {expandedSection === 'config' ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                    </button>

                    {expandedSection === 'config' && (
                        <RouteConnectionPanel
                            config={routeConnectionConfig}
                            library={connectionLibrary}
                            availableStops={availableStops}
                            onUpdateConfig={setRouteConnectionConfig}
                            onAddConnection={handleAddConnection}
                        />
                    )}
                </div>
            </div>

            {/* Optimization Panel */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button
                    onClick={() => setExpandedSection(expandedSection === 'optimize' ? null : 'optimize')}
                    className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <Play className="w-4 h-4 text-gray-600" />
                        <span className="font-medium text-gray-900">Optimize Schedule</span>
                        {!canOptimize && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                Add connections first
                            </span>
                        )}
                    </div>
                    {expandedSection === 'optimize' ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                </button>

                {expandedSection === 'optimize' && (
                    <OptimizationPanel
                        schedules={schedules}
                        config={routeConnectionConfig}
                        library={connectionLibrary}
                        mode={routeConnectionConfig?.optimizationMode || 'hybrid'}
                        onModeChange={handleModeChange}
                        onOptimize={handleRunOptimization}
                        onReset={handleReset}
                        result={optimizationResult}
                        isOptimizing={isOptimizing}
                        canOptimize={canOptimize}
                    />
                )}
            </div>

            {/* Skip notice */}
            <div className="text-center text-sm text-gray-500">
                <p>
                    Connection optimization is optional. You can proceed to export without optimizing.
                </p>
            </div>

            {/* Modals */}
            <AddTargetModal
                isOpen={showAddTargetModal}
                onClose={() => setShowAddTargetModal(false)}
                onAdd={handleAddTarget}
                dayType={dayType}
            />

            <ImportRouteModal
                isOpen={showImportRouteModal}
                onClose={() => setShowImportRouteModal(false)}
                onImport={handleAddTarget}
                teamId={teamId}
                currentRouteIdentity={routeIdentity}
            />
        </div>
    );
};

export default Step5Connections;
