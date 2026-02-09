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
    ConnectionTime,
    RouteConnectionConfig,
    RouteConnection,
    OptimizationMode,
    OptimizationResult,
    StopInfo
} from '../../../utils/connectionTypes';
import { generateConnectionId, parseConnectionTime } from '../../../utils/connectionTypes';
import { ConnectionLibraryPanel } from '../connections/ConnectionLibraryPanel';
import { RouteConnectionPanel } from '../connections/RouteConnectionPanel';
import { OptimizationPanel } from '../connections/OptimizationPanel';
import { AddTargetModal, AddTargetInitialData } from '../connections/AddTargetModal';
import { ImportRouteModal } from '../connections/ImportRouteModal';
import { ConnectionAddChooser, ConnectionTemplateSelection } from '../connections/ConnectionAddChooser';
import { ConnectionStatusPanel } from '../../connections/ConnectionStatusPanel';
import { getConnectionLibrary, saveConnectionLibrary } from '../../../utils/connectionLibraryService';
import { getMasterSchedule } from '../../../utils/masterScheduleService';
import { optimizeForConnections, checkConnections, ConnectionCheckResult } from '../../../utils/connectionOptimizer';
import { appendLibraryChange } from '../../../utils/connectionLibraryUtils';

interface Step5Props {
    schedules: MasterRouteTable[];
    connectionScopeSchedules?: MasterRouteTable[];
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
    connectionScopeSchedules,
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
    const [showChooser, setShowChooser] = useState(false);
    const [showAddTargetModal, setShowAddTargetModal] = useState(false);
    const [showImportRouteModal, setShowImportRouteModal] = useState(false);
    const [addTargetInitialData, setAddTargetInitialData] = useState<AddTargetInitialData | undefined>();
    const [expandedSection, setExpandedSection] = useState<'library' | 'config' | 'optimize' | null>('library');
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionCheckResult | null>(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const validationSchedules = connectionScopeSchedules || schedules;

    const deriveRouteTargetTimes = useCallback((
        table: MasterRouteTable,
        stopName: string,
        dayType: 'Weekday' | 'Saturday' | 'Sunday'
    ): ConnectionTime[] => {
        const normalizeTripMinutes = (rawMinutes: number, tripStartTime: number) => {
            if (rawMinutes >= 1440) return rawMinutes;
            if (tripStartTime >= 1440) return rawMinutes + 1440;
            if (tripStartTime < 210) return rawMinutes + 1440;
            return rawMinutes;
        };

        const uniqueTimes = new Set<number>();

        for (const trip of table.trips) {
            const stopMinutes = trip.stopMinutes?.[stopName];
            if (stopMinutes !== undefined) {
                uniqueTimes.add(stopMinutes);
                continue;
            }
            const timeStr = trip.stops?.[stopName];
            if (!timeStr) continue;
            const parsed = parseConnectionTime(timeStr);
            if (parsed === 0 && !/^12:00/i.test(timeStr) && !/^0?0:00/i.test(timeStr)) continue;
            uniqueTimes.add(normalizeTripMinutes(parsed, trip.startTime));
        }

        const sortedTimes = Array.from(uniqueTimes).sort((a, b) => a - b);
        return sortedTimes.map(time => ({
            id: generateConnectionId(),
            time,
            daysActive: [dayType],
            enabled: true
        }));
    }, []);

    const getTemplateInitialData = useCallback((data: AddTargetInitialData): AddTargetInitialData => {
        const name = (data.name || '').toLowerCase();
        const location = (data.location || '').toLowerCase();
        const isGoTemplate = data.icon === 'train' && (
            name.includes('go')
            || location.includes('go')
            || name.includes('allandale')
            || location.includes('allandale')
        );
        if (!isGoTemplate) return data;

        const wantsBarrieSouth = name.includes('barrie south') || location.includes('barrie south');
        const wantsAllandale = name.includes('allandale') || location.includes('allandale');

        const stopMap = new Map<string, string>(); // code -> name
        for (const table of validationSchedules) {
            Object.entries(table.stopIds || {}).forEach(([stopName, code]) => {
                const normalizedName = stopName.toLowerCase();
                const isBarrieSouthMatch = normalizedName.includes('barrie south')
                    && (normalizedName.includes('terminal') || normalizedName.includes('go'));
                const isAllandaleMatch = normalizedName.includes('allandale')
                    && (normalizedName.includes('terminal') || normalizedName.includes('go'));
                const stationMatch = wantsBarrieSouth
                    ? isBarrieSouthMatch
                    : wantsAllandale
                        ? isAllandaleMatch
                        : (isBarrieSouthMatch || isAllandaleMatch);
                if (stationMatch && code) {
                    stopMap.set(code, stopName);
                }
            });
        }

        const matchedStops = Array.from(stopMap.entries())
            .map(([code, stopName]) => ({ code, name: stopName, enabled: true }));

        if (matchedStops.length === 0) return data;

        return {
            ...data,
            stops: matchedStops,
            stopCode: matchedStops[0].code,
            autoPopulateStops: true
        };
    }, [validationSchedules]);

    const validStopCodes = React.useMemo(() => {
        const codes = new Set<string>();
        validationSchedules.forEach(table => {
            Object.values(table.stopIds || {}).forEach(code => {
                const trimmed = (code || '').trim();
                if (trimmed) codes.add(trimmed);
            });
        });
        return Array.from(codes);
    }, [validationSchedules]);
    const routeLocalStopCodeCount = React.useMemo(() => {
        const codes = new Set<string>();
        schedules.forEach(table => {
            Object.values(table.stopIds || {}).forEach(code => {
                const trimmed = (code || '').trim();
                if (trimmed) codes.add(trimmed);
            });
        });
        return codes.size;
    }, [schedules]);
    const isMasterValidationScopeActive = Boolean(connectionScopeSchedules && connectionScopeSchedules.length > schedules.length);

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

    // Resolve route-based targets from master schedules (cache derived times)
    useEffect(() => {
        if (!teamId || !connectionLibrary || isLoadingLibrary) return;

        const routeTargets = connectionLibrary.targets.filter(
            target => target.type === 'route' && target.routeIdentity
        );
        if (routeTargets.length === 0) return;

        let cancelled = false;

        const resolveRouteTargets = async () => {
            const uniqueRouteIds = Array.from(new Set(routeTargets.map(t => t.routeIdentity)));
            const scheduleResults = await Promise.all(
                uniqueRouteIds.map(async (routeId) => {
                    if (!routeId) return [routeId, null] as const;
                    try {
                        const result = await getMasterSchedule(teamId, routeId as any);
                        return [routeId, result] as const;
                    } catch (error) {
                        console.error('Error loading master schedule for connection target:', routeId, error);
                        return [routeId, null] as const;
                    }
                })
            );

            const scheduleMap = new Map(scheduleResults);
            let changed = false;

            const updatedTargets = connectionLibrary.targets.map(target => {
                if (target.type !== 'route' || !target.routeIdentity) return target;
                const schedule = scheduleMap.get(target.routeIdentity);
                if (!schedule) return target;

                const sourceUpdatedAt = schedule.entry.updatedAt.toISOString();
                const table = target.direction === 'South'
                    ? schedule.content.southTable
                    : schedule.content.northTable;
                if (!table) return target;

                const stopNameFromCode = target.stopCode
                    ? Object.entries(table.stopIds || {}).find(([, code]) => code === target.stopCode)?.[0]
                    : undefined;
                const resolvedStopName = stopNameFromCode || target.stopName;
                const resolvedStopCode = target.stopCode || (resolvedStopName ? table.stopIds?.[resolvedStopName] : '');

                if (!resolvedStopName || !resolvedStopCode) return target;

                const cacheValid = target.sourceScheduleUpdatedAt === sourceUpdatedAt
                    && target.times
                    && target.times.length > 0;

                if (cacheValid) {
                    if (target.stopName !== resolvedStopName || target.stopCode !== resolvedStopCode) {
                        changed = true;
                        return { ...target, stopName: resolvedStopName, stopCode: resolvedStopCode };
                    }
                    return target;
                }

                const derivedTimes = deriveRouteTargetTimes(table, resolvedStopName, schedule.entry.dayType);
                if (derivedTimes.length === 0) {
                    if (target.sourceScheduleUpdatedAt !== sourceUpdatedAt || target.stopName !== resolvedStopName || target.stopCode !== resolvedStopCode) {
                        changed = true;
                        return { ...target, stopName: resolvedStopName, stopCode: resolvedStopCode, sourceScheduleUpdatedAt: sourceUpdatedAt };
                    }
                    return target;
                }

                changed = true;
                return {
                    ...target,
                    stopName: resolvedStopName,
                    stopCode: resolvedStopCode,
                    times: derivedTimes,
                    sourceScheduleUpdatedAt: sourceUpdatedAt,
                    updatedAt: new Date().toISOString()
                };
            });

            if (!changed || cancelled) return;

            setConnectionLibrary({
                ...connectionLibrary,
                targets: updatedTargets,
                updatedAt: new Date().toISOString(),
                updatedBy: userId
            });
        };

        resolveRouteTargets();

        return () => {
            cancelled = true;
        };
    }, [teamId, connectionLibrary, isLoadingLibrary, setConnectionLibrary, userId, deriveRouteTargetTimes]);

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

    // Get available stops from schedules (with codes)
    const availableStops: StopInfo[] = React.useMemo(() => {
        const stopMap = new Map<string, string>(); // code -> name
        schedules.forEach(table => {
            if (table.stopIds) {
                Object.entries(table.stopIds).forEach(([name, code]) => {
                    if (code && !stopMap.has(code)) {
                        stopMap.set(code, name);
                    }
                });
            }
        });
        return Array.from(stopMap.entries())
            .map(([code, name]) => ({ code, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
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

        setConnectionLibrary(appendLibraryChange({
            ...connectionLibrary,
            targets: [...connectionLibrary.targets, newTarget],
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        }, userId, 'add_target', `Added ${newTarget.name}`));

        setShowAddTargetModal(false);
    }, [connectionLibrary, setConnectionLibrary, userId]);

    const handleImportGoGtfsTargets = useCallback((templates: ConnectionTemplateSelection[]) => {
        if (!connectionLibrary) return;

        const now = new Date().toISOString();
        const normalizedTemplates = templates
            .map(template => getTemplateInitialData(template))
            .filter(template => (template.name || '').trim().length > 0)
            .filter(template => (template.stopCode || '').trim().length > 0)
            .filter(template => Array.isArray(template.times) && template.times.length > 0);

        if (normalizedTemplates.length === 0) {
            setShowChooser(false);
            return;
        }

        const manualTargetsByName = new Map(
            connectionLibrary.targets
                .filter(target => target.type === 'manual')
                .map(target => [target.name.trim().toLowerCase(), target] as const)
        );

        const nextTargets = [...connectionLibrary.targets];
        let createdCount = 0;
        let updatedCount = 0;

        for (const template of normalizedTemplates) {
            const effectiveStopCodes = (template.stops || [])
                .filter(stop => stop.enabled)
                .map(stop => stop.code)
                .filter(code => !!code.trim());
            const primaryStopCode = effectiveStopCodes[0] || (template.stopCode || '').trim();
            if (!primaryStopCode) continue;

            const normalizedName = (template.name || '').trim().toLowerCase();
            const existing = manualTargetsByName.get(normalizedName);
            const incoming: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'> = {
                name: (template.name || '').trim(),
                type: 'manual',
                location: template.location?.trim() || undefined,
                stopCode: primaryStopCode,
                ...(template.autoPopulateStops && effectiveStopCodes.length > 0
                    ? {
                        stopCodes: effectiveStopCodes,
                        autoPopulateStops: true
                    }
                    : {}),
                icon: template.icon,
                times: template.times,
                color: template.icon === 'clock' ? 'teal' : 'green',
                defaultEventType: template.defaultEventType || 'departure'
            };

            if (existing) {
                const updatedTarget: ConnectionTarget = {
                    ...existing,
                    ...incoming,
                    id: existing.id,
                    createdAt: existing.createdAt,
                    updatedAt: now
                };
                const index = nextTargets.findIndex(target => target.id === existing.id);
                if (index >= 0) {
                    nextTargets[index] = updatedTarget;
                    updatedCount += 1;
                }
                manualTargetsByName.set(normalizedName, updatedTarget);
            } else {
                const newTarget: ConnectionTarget = {
                    ...incoming,
                    id: `target_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    createdAt: now,
                    updatedAt: now
                };
                nextTargets.push(newTarget);
                manualTargetsByName.set(normalizedName, newTarget);
                createdCount += 1;
            }
        }

        if (createdCount === 0 && updatedCount === 0) {
            setShowChooser(false);
            return;
        }

        const total = createdCount + updatedCount;
        setConnectionLibrary(appendLibraryChange({
            ...connectionLibrary,
            targets: nextTargets,
            updatedAt: now,
            updatedBy: userId
        }, userId, 'import_go_gtfs', `Imported ${total} GO target(s): ${createdCount} new, ${updatedCount} updated`));

        setShowChooser(false);
        setShowAddTargetModal(false);
        setAddTargetInitialData(undefined);
    }, [connectionLibrary, getTemplateInitialData, setConnectionLibrary, userId]);

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

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-900">
                    <p className="font-semibold">Validation Debug</p>
                    <p>
                        Scope: {isMasterValidationScopeActive ? 'Master + Route' : 'Route only'}.
                        Loaded stop codes: {validStopCodes.length}. Current route stop codes: {routeLocalStopCodeCount}.
                    </p>
                </div>
            </div>

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
                            onAddTarget={() => setShowChooser(true)}
                            onImportRoute={() => setShowImportRouteModal(true)}
                            schedules={schedules}
                            validStopCodes={validStopCodes}
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
            <ConnectionAddChooser
                isOpen={showChooser}
                onClose={() => setShowChooser(false)}
                onSelectManual={() => {
                    setAddTargetInitialData(undefined);
                    setShowChooser(false);
                    setShowAddTargetModal(true);
                }}
                onSelectTemplate={(data) => {
                    setAddTargetInitialData(getTemplateInitialData(data));
                    setShowChooser(false);
                    setShowAddTargetModal(true);
                }}
                onSelectGtfsImport={handleImportGoGtfsTargets}
                dayType={dayType}
            />

            <AddTargetModal
                isOpen={showAddTargetModal}
                onClose={() => {
                    setShowAddTargetModal(false);
                    setAddTargetInitialData(undefined);
                }}
                onAdd={handleAddTarget}
                dayType={dayType}
                existingTargetNames={connectionLibrary?.targets.map(t => t.name) || []}
                validStopCodes={validStopCodes}
                defaultQualityWindowSettings={connectionLibrary?.qualityWindowSettings}
                initialData={addTargetInitialData}
            />

            <ImportRouteModal
                isOpen={showImportRouteModal}
                onClose={() => setShowImportRouteModal(false)}
                onImport={handleAddTarget}
                teamId={teamId}
                currentRouteIdentity={routeIdentity}
                existingTargetNames={connectionLibrary?.targets.map(t => t.name) || []}
            />
        </div>
    );
};

export default Step5Connections;
