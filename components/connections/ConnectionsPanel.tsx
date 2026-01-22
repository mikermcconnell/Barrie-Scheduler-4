/**
 * ConnectionsPanel
 *
 * Full connections panel for the Schedule Editor.
 * Combines status display with configuration and optimization controls.
 * Opens as a slide-out panel from the editor toolbar.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    X,
    Link2,
    Train,
    Settings2,
    Play,
    ChevronDown,
    ChevronUp,
    Loader2,
    Plus
} from 'lucide-react';
import type { MasterRouteTable } from '../../utils/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    RouteConnectionConfig,
    RouteConnection,
    OptimizationMode,
    OptimizationResult
} from '../../utils/connectionTypes';
import { ConnectionStatusPanel } from './ConnectionStatusPanel';
import { ConnectionLibraryPanel } from '../NewSchedule/connections/ConnectionLibraryPanel';
import { RouteConnectionPanel } from '../NewSchedule/connections/RouteConnectionPanel';
import { OptimizationPanel } from '../NewSchedule/connections/OptimizationPanel';
import { AddTargetModal } from '../NewSchedule/connections/AddTargetModal';
import { ImportRouteModal } from '../NewSchedule/connections/ImportRouteModal';
import {
    getConnectionLibrary,
    saveConnectionLibrary,
    getRouteConnectionConfig,
    saveRouteConnectionConfig
} from '../../utils/connectionLibraryService';
import { checkConnections, ConnectionCheckResult } from '../../utils/connectionOptimizer';

interface ConnectionsPanelProps {
    schedules: MasterRouteTable[];
    routeIdentity: string;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    teamId: string;
    userId: string;
    onClose: () => void;
    onSchedulesChange: (schedules: MasterRouteTable[]) => void;
    showSuccessToast?: (msg: string) => void;
}

export const ConnectionsPanel: React.FC<ConnectionsPanelProps> = ({
    schedules,
    routeIdentity,
    dayType,
    teamId,
    userId,
    onClose,
    onSchedulesChange,
    showSuccessToast
}) => {
    // State
    const [connectionLibrary, setConnectionLibrary] = useState<ConnectionLibrary | null>(null);
    const [routeConnectionConfig, setRouteConnectionConfig] = useState<RouteConnectionConfig | null>(null);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
    const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionCheckResult | null>(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const [hasLoadedInitial, setHasLoadedInitial] = useState(false);

    // Modals
    const [showAddTargetModal, setShowAddTargetModal] = useState(false);
    const [showImportRouteModal, setShowImportRouteModal] = useState(false);

    // Accordion state
    const [expandedSection, setExpandedSection] = useState<'library' | 'config' | 'optimize' | null>('config');

    // Load connection library and route config from Firebase
    useEffect(() => {
        const loadData = async () => {
            setIsLoadingLibrary(true);
            try {
                // Load library
                const library = await getConnectionLibrary(teamId);
                if (library) {
                    setConnectionLibrary(library);
                } else {
                    setConnectionLibrary({
                        targets: [],
                        updatedAt: new Date().toISOString(),
                        updatedBy: userId
                    });
                }

                // Load route config
                const config = await getRouteConnectionConfig(teamId, routeIdentity);
                if (config) {
                    setRouteConnectionConfig(config);
                } else {
                    setRouteConnectionConfig({
                        routeIdentity,
                        connections: [],
                        optimizationMode: 'hybrid'
                    });
                }
            } catch (error) {
                console.error('Error loading connection data:', error);
                setConnectionLibrary({
                    targets: [],
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId
                });
                setRouteConnectionConfig({
                    routeIdentity,
                    connections: [],
                    optimizationMode: 'hybrid'
                });
            } finally {
                setIsLoadingLibrary(false);
                // Mark initial load complete to prevent auto-save from firing immediately
                setTimeout(() => setHasLoadedInitial(true), 100);
            }
        };

        loadData();
    }, [teamId, routeIdentity, userId]);

    // Save library when it changes (only after initial load)
    useEffect(() => {
        if (!teamId || !connectionLibrary || isLoadingLibrary || !hasLoadedInitial) return;

        const timer = setTimeout(async () => {
            try {
                await saveConnectionLibrary(teamId, connectionLibrary, userId);
            } catch (error) {
                console.error('Error saving connection library:', error);
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [teamId, connectionLibrary, userId, isLoadingLibrary, hasLoadedInitial]);

    // Save route config when it changes (only after initial load)
    useEffect(() => {
        if (!teamId || !routeConnectionConfig || isLoadingLibrary || !hasLoadedInitial) return;

        const timer = setTimeout(async () => {
            try {
                await saveRouteConnectionConfig(teamId, routeIdentity, routeConnectionConfig);
            } catch (error) {
                console.error('Error saving route connection config:', error);
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [teamId, routeIdentity, routeConnectionConfig, isLoadingLibrary, hasLoadedInitial]);

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

    // Get available stops from schedules
    const availableStops = useMemo(() => {
        const stops = new Set<string>();
        schedules.forEach(table => {
            table.stops.forEach(stop => stops.add(stop));
        });
        return Array.from(stops);
    }, [schedules]);

    // Stats
    const stats = useMemo(() => {
        const targetCount = connectionLibrary?.targets.length || 0;
        const connectionCount = routeConnectionConfig?.connections.length || 0;
        const enabledCount = routeConnectionConfig?.connections.filter(c => c.enabled).length || 0;
        return { targetCount, connectionCount, enabledCount };
    }, [connectionLibrary, routeConnectionConfig]);

    // Handlers
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
    }, [connectionLibrary, userId]);

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
    }, [routeConnectionConfig]);

    const handleModeChange = useCallback((mode: OptimizationMode) => {
        if (!routeConnectionConfig) return;
        setRouteConnectionConfig({
            ...routeConnectionConfig,
            optimizationMode: mode
        });
    }, [routeConnectionConfig]);

    const handleOptimizationComplete = useCallback((result: OptimizationResult) => {
        setOptimizationResult(result);
        onSchedulesChange(result.optimizedSchedules);
        showSuccessToast?.(`Optimization complete: ${result.summary.connectionsMet} of ${result.summary.totalConnections} connections met`);
    }, [onSchedulesChange, showSuccessToast]);

    const handleReset = useCallback(() => {
        if (optimizationResult) {
            onSchedulesChange(optimizationResult.originalSchedules);
            setOptimizationResult(null);
            showSuccessToast?.('Schedule reset to original');
        }
    }, [optimizationResult, onSchedulesChange, showSuccessToast]);

    const canOptimize = stats.enabledCount > 0 && schedules.length > 0;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/20 z-[70]"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl z-[71] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-blue-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Connections</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Loading state */}
                {isLoadingLibrary ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto">
                        {/* Connection Status Panel */}
                        <div className="p-4 border-b border-gray-200 bg-gray-50/50">
                            <ConnectionStatusPanel
                                checkResult={connectionStatus}
                                isLoading={isCheckingStatus}
                                compact
                            />
                        </div>

                        {/* Connection Library Section */}
                        <div className="border-b border-gray-200">
                            <button
                                onClick={() => setExpandedSection(expandedSection === 'library' ? null : 'library')}
                                className="w-full px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Train className="w-4 h-4 text-gray-600" />
                                    <span className="font-medium text-gray-900">Connection Library</span>
                                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
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

                        {/* Route Connections Section */}
                        <div className="border-b border-gray-200">
                            <button
                                onClick={() => setExpandedSection(expandedSection === 'config' ? null : 'config')}
                                className="w-full px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Settings2 className="w-4 h-4 text-gray-600" />
                                    <span className="font-medium text-gray-900">Route Connections</span>
                                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
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

                        {/* Optimization Section */}
                        <div className="border-b border-gray-200">
                            <button
                                onClick={() => setExpandedSection(expandedSection === 'optimize' ? null : 'optimize')}
                                className="w-full px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Play className="w-4 h-4 text-gray-600" />
                                    <span className="font-medium text-gray-900">Optimize</span>
                                    {!canOptimize && (
                                        <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                            Configure connections first
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
                                    onOptimize={handleOptimizationComplete}
                                    onReset={handleReset}
                                    result={optimizationResult}
                                    isOptimizing={false}
                                    canOptimize={canOptimize}
                                />
                            )}
                        </div>
                    </div>
                )}
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
        </>
    );
};

export default ConnectionsPanel;
