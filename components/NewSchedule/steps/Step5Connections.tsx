/**
 * Step 5: Connection Optimization
 *
 * Allows users to optimize schedules to connect with external services
 * (GO Trains, Georgian College bells) and other bus routes.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Link2,
    Plus,
    Settings2,
    Play,
    RotateCcw,
    ChevronDown,
    ChevronUp,
    Clock,
    Bus,
    AlertCircle,
    CheckCircle2,
    Info,
    Wrench
} from 'lucide-react';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime,
    RouteConnectionConfig,
    RouteConnection,
    OptimizationMode,
    OptimizationResult,
    StopInfo
} from '../../../utils/connections/connectionTypes';
import { generateConnectionId, parseConnectionTime } from '../../../utils/connections/connectionTypes';
import { ConnectionLibraryPanel } from '../connections/ConnectionLibraryPanel';
import { RouteConnectionPanel } from '../connections/RouteConnectionPanel';
import { OptimizationPanel } from '../connections/OptimizationPanel';
import { AddTargetModal, AddTargetInitialData } from '../connections/AddTargetModal';
import { ImportRouteModal } from '../connections/ImportRouteModal';
import { ConnectionAddChooser, ConnectionTemplateSelection } from '../connections/ConnectionAddChooser';
import { ConnectionStatusPanel } from '../../connections/ConnectionStatusPanel';
import { Modal } from '../../ui/Modal';
import { getConnectionLibrary, saveConnectionLibrary } from '../../../utils/connections/connectionLibraryService';
import { getMasterSchedule } from '../../../utils/services/masterScheduleService';
import { optimizeForConnections, checkConnections, ConnectionCheckResult } from '../../../utils/connections/connectionOptimizer';
import { appendLibraryChange } from '../../../utils/connections/connectionLibraryUtils';
import { alignTemplateInitialDataToLoadedStops } from '../../../utils/connections/templateInitialDataUtils';
import { buildRouteConnectionFromTarget } from '../../../utils/connections/routeConnectionDefaults';
import { buildRouteTimepointStopOptions } from '../../../utils/connections/routeTimepointStops';

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
    const [pendingRouteAttachment, setPendingRouteAttachment] = useState(false);
    const [expandedSection, setExpandedSection] = useState<'config' | 'optimize' | null>('config');
    const [showLibraryManagerModal, setShowLibraryManagerModal] = useState(false);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionCheckResult | null>(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const validationSchedules = connectionScopeSchedules || schedules;
    const hasAutoPickedSection = useRef(false);
    const routeLabel = React.useMemo(() => (
        routeIdentity.replace(/-(Weekday|Saturday|Sunday)$/i, '')
    ), [routeIdentity]);

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
    const routeTimepointStops = React.useMemo<StopInfo[]>(
        () => buildRouteTimepointStopOptions(schedules),
        [schedules]
    );
    const routeStopOptions = React.useMemo<StopInfo[]>(() => {
        const optionMap = new Map(routeTimepointStops.map(stop => [stop.code, stop] as const));

        (routeConnectionConfig?.connections || []).forEach(connection => {
            const code = connection.stopCode?.trim();
            if (!code || optionMap.has(code)) return;

            optionMap.set(code, {
                code,
                name: connection.stopName
                    || availableStops.find(stop => stop.code === code)?.name
                    || `Stop ${code}`
            });
        });

        return Array.from(optionMap.values());
    }, [availableStops, routeConnectionConfig, routeTimepointStops]);
    const getTemplateInitialData = useCallback((data: AddTargetInitialData): AddTargetInitialData => (
        alignTemplateInitialDataToLoadedStops(data, availableStops, validationSchedules)
    ), [availableStops, validationSchedules]);
    const materializeRouteConnection = useCallback((connection: Omit<RouteConnection, 'id'>): RouteConnection => ({
        ...connection,
        id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }), []);

    // Count statistics
    const stats = React.useMemo(() => {
        const targetCount = connectionLibrary?.targets.length || 0;
        const connectionCount = routeConnectionConfig?.connections.length || 0;
        const enabledCount = routeConnectionConfig?.connections.filter(c => c.enabled).length || 0;
        return { targetCount, connectionCount, enabledCount };
    }, [connectionLibrary, routeConnectionConfig]);

    useEffect(() => {
        if (hasAutoPickedSection.current) return;
        if (!connectionLibrary || !routeConnectionConfig) return;

        setExpandedSection('config');
        hasAutoPickedSection.current = true;
    }, [connectionLibrary, routeConnectionConfig]);

    // Handle adding a new target
    const handleAddTarget = useCallback((
        target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>,
        routeAttachmentConfig?: {
            stopCode: string;
            stopName?: string;
            connectionType: 'meet_departing' | 'feed_arriving';
            bufferMinutes: number;
        }
    ) => {
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

        if (pendingRouteAttachment && routeConnectionConfig) {
            const nextConnection = routeAttachmentConfig
                ? {
                    targetId: newTarget.id,
                    connectionType: routeAttachmentConfig.connectionType,
                    bufferMinutes: routeAttachmentConfig.bufferMinutes,
                    stopCode: routeAttachmentConfig.stopCode,
                    stopName: routeAttachmentConfig.stopName,
                    priority: routeConnectionConfig.connections.length + 1,
                    enabled: true
                }
                : buildRouteConnectionFromTarget(
                    newTarget,
                    routeStopOptions,
                    routeConnectionConfig.connections.length + 1
                );
            if (nextConnection) {
                setRouteConnectionConfig({
                    ...routeConnectionConfig,
                    connections: [...routeConnectionConfig.connections, materializeRouteConnection(nextConnection)]
                });
                setExpandedSection('config');
            }
        }

        setShowAddTargetModal(false);
        setPendingRouteAttachment(false);
    }, [connectionLibrary, materializeRouteConnection, pendingRouteAttachment, routeConnectionConfig, routeStopOptions, setConnectionLibrary, setRouteConnectionConfig, userId]);

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
        const attachedTargets: ConnectionTarget[] = [];
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
                attachedTargets.push(updatedTarget);
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
                attachedTargets.push(newTarget);
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

        if (pendingRouteAttachment && routeConnectionConfig) {
            const existingTargetIds = new Set(routeConnectionConfig.connections.map(connection => connection.targetId));
            const newConnections = [...routeConnectionConfig.connections];

            attachedTargets.forEach(target => {
                if (existingTargetIds.has(target.id)) return;
                const candidate = buildRouteConnectionFromTarget(target, routeStopOptions, newConnections.length + 1);
                if (!candidate) return;
                existingTargetIds.add(target.id);
                newConnections.push(materializeRouteConnection(candidate));
            });

            if (newConnections.length !== routeConnectionConfig.connections.length) {
                setRouteConnectionConfig({
                    ...routeConnectionConfig,
                    connections: newConnections
                });
                setExpandedSection('config');
            }
        }

        setShowChooser(false);
        setShowAddTargetModal(false);
        setAddTargetInitialData(undefined);
        setPendingRouteAttachment(false);
    }, [connectionLibrary, getTemplateInitialData, materializeRouteConnection, pendingRouteAttachment, routeConnectionConfig, routeStopOptions, setConnectionLibrary, setRouteConnectionConfig, userId]);

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
                        Set connection goals for Route {routeLabel} on {dayType}, then optimize trip times to match them
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
                        <p className="text-sm font-medium text-blue-900">Start in Route Connections</p>
                        <p className="text-sm text-blue-700 mt-1">
                            Create a new goal directly from the route panel first. Open the saved service library only if
                            you need shared imports, bulk maintenance, or route-to-route library work.
                        </p>
                    </div>
                </div>
            )}
            {stats.targetCount > 0 && stats.connectionCount === 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-green-900">Saved services are ready for this route</p>
                        <p className="text-sm text-green-700 mt-1">
                            Choose which saved services Route {routeLabel} should connect with on {dayType}.
                            The route setup panel opens first so you can start there.
                        </p>
                    </div>
                </div>
            )}

            <div className="space-y-6">
                {/* Route Connections */}
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <button
                        onClick={() => setExpandedSection(expandedSection === 'config' ? null : 'config')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Settings2 className="w-4 h-4 text-gray-600" />
                                <span className="font-medium text-gray-900">Route Connections</span>
                            </div>
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
                            availableStops={routeStopOptions}
                            onUpdateConfig={setRouteConnectionConfig}
                            onAddConnection={handleAddConnection}
                            onCreateTarget={() => {
                                    setAddTargetInitialData(undefined);
                                    setPendingRouteAttachment(true);
                                    setShowAddTargetModal(true);
                                }}
                            />
                        )}
                </div>

                {/* Advanced saved-service tools */}
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 rounded-lg bg-amber-100 p-2 text-amber-700">
                                    <Wrench className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium text-gray-900">Advanced saved-service tools</p>
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-600 bg-gray-200 px-1.5 py-0.5 rounded">
                                            Advanced
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Manage the shared saved-service library only when you need imports, GTFS refresh, cleanup, or team-wide maintenance.
                                    </p>
                                </div>
                            </div>
                            <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                {stats.targetCount}
                            </span>
                        </div>

                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                            <p className="text-xs text-amber-900">
                                Most route setup can stay in <span className="font-semibold">Route Connections</span>. Open the library manager only when you need the deeper shared-service tools.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => setShowLibraryManagerModal(true)}
                                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
                            >
                                <Wrench className="w-4 h-4" />
                                Manage saved services
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowLibraryManagerModal(false);
                                    setShowImportRouteModal(true);
                                }}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                <Bus className="w-4 h-4" />
                                Import from route
                            </button>
                        </div>
                    </div>
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
                onClose={() => {
                    setShowChooser(false);
                    setPendingRouteAttachment(false);
                }}
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
                routeAttachmentContext={pendingRouteAttachment ? {
                    routeLabel: `Route ${routeLabel}`,
                    availableStops: routeStopOptions
                } : undefined}
            />

            <AddTargetModal
                isOpen={showAddTargetModal}
                onClose={() => {
                    setShowAddTargetModal(false);
                    setAddTargetInitialData(undefined);
                    setPendingRouteAttachment(false);
                }}
                onAdd={handleAddTarget}
                dayType={dayType}
                existingTargetNames={connectionLibrary?.targets.map(t => t.name) || []}
                validStopCodes={validStopCodes}
                availableStops={availableStops}
                routeStopOptions={routeStopOptions}
                defaultQualityWindowSettings={connectionLibrary?.qualityWindowSettings}
                initialData={addTargetInitialData}
                routeAttachmentPreview={pendingRouteAttachment ? {
                    routeLabel: `Route ${routeLabel}`,
                    dayType
                } : undefined}
            />

            <ImportRouteModal
                isOpen={showImportRouteModal}
                onClose={() => setShowImportRouteModal(false)}
                onImport={handleAddTarget}
                teamId={teamId}
                currentRouteIdentity={routeIdentity}
                existingTargetNames={connectionLibrary?.targets.map(t => t.name) || []}
            />

            <Modal
                isOpen={showLibraryManagerModal}
                onClose={() => setShowLibraryManagerModal(false)}
                size="xl"
                zIndex="high"
                className="max-h-[92vh]"
            >
                <Modal.Header>Saved Service Library</Modal.Header>
                <Modal.Body className="p-0">
                    <div className="border-b border-gray-100 bg-amber-50 px-6 py-4">
                        <p className="text-sm font-medium text-amber-900">
                            Advanced shared-service manager
                        </p>
                        <p className="text-xs text-amber-800 mt-1">
                            Use this for team-wide saved-service maintenance, GTFS refresh, imports, and cleanup. For normal route setup, go back to the Route Connections panel.
                        </p>
                    </div>
                    <ConnectionLibraryPanel
                        library={connectionLibrary}
                        onUpdateLibrary={setConnectionLibrary}
                        onAddTarget={() => {
                            setShowLibraryManagerModal(false);
                            setShowChooser(true);
                        }}
                        onImportRoute={() => {
                            setShowLibraryManagerModal(false);
                            setShowImportRouteModal(true);
                        }}
                        schedules={schedules}
                        validStopCodes={validStopCodes}
                        userId={userId}
                        dayType={dayType}
                        compactAdminMode
                        compactAdminContextLabel={`Route ${routeLabel}`}
                    />
                </Modal.Body>
            </Modal>
        </div>
    );
};

export default Step5Connections;
