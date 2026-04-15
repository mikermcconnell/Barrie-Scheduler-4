/**
 * ConnectionsPanel
 *
 * Connection Library panel for the Schedule Editor.
 * Manages team-wide connection targets (GO Trains, College bells, etc.).
 * Opens as a slide-out panel from the editor toolbar.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    X,
    Link2,
    Loader2,
    Settings2,
    Wrench
} from 'lucide-react';
import type { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime,
    RouteConnection,
    RouteConnectionConfig,
    StopInfo
} from '../../utils/connections/connectionTypes';
import { generateConnectionId, parseConnectionTime } from '../../utils/connections/connectionTypes';
import { ConnectionLibraryPanel } from '../NewSchedule/connections/ConnectionLibraryPanel';
import {
    RouteConnectionPanel,
    type OtherRouteOption,
    type OtherRouteConnectionDraft
} from '../NewSchedule/connections/RouteConnectionPanel';
import { AddTargetModal, AddTargetInitialData } from '../NewSchedule/connections/AddTargetModal';
import { ImportRouteModal } from '../NewSchedule/connections/ImportRouteModal';
import { ConnectionAddChooser, ConnectionTemplateSelection } from '../NewSchedule/connections/ConnectionAddChooser';
import { ConnectionStatusPanel } from './ConnectionStatusPanel';
import { Modal } from '../ui/Modal';
import {
    getConnectionLibrary,
    saveConnectionLibrary,
    getRouteConnectionConfig,
    saveRouteConnectionConfig
} from '../../utils/connections/connectionLibraryService';
import { getAllMasterSchedules, getMasterSchedule } from '../../utils/services/masterScheduleService';
import { checkConnections } from '../../utils/connections/connectionOptimizer';
import { appendLibraryChange } from '../../utils/connections/connectionLibraryUtils';
import { alignTemplateInitialDataToLoadedStops } from '../../utils/connections/templateInitialDataUtils';
import { buildRouteConnectionFromTarget } from '../../utils/connections/routeConnectionDefaults';
import { buildRouteTimepointStopOptions } from '../../utils/connections/routeTimepointStops';
import { parseRouteInfo } from '../../utils/config/routeDirectionConfig';

interface ConnectionsPanelProps {
    schedules: MasterRouteTable[];
    routeIdentity: string;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    teamId: string;
    userId: string;
    onLibraryChanged?: (library: ConnectionLibrary | null) => void;
    onClose: () => void;
}

export const ConnectionsPanel: React.FC<ConnectionsPanelProps> = ({
    schedules,
    routeIdentity,
    dayType,
    teamId,
    userId,
    onLibraryChanged,
    onClose
}) => {
    const [connectionLibrary, setConnectionLibrary] = useState<ConnectionLibrary | null>(null);
    const [routeConnectionConfig, setRouteConnectionConfig] = useState<RouteConnectionConfig | null>(null);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
    const [isLoadingConfig, setIsLoadingConfig] = useState(true);
    const [hasLoadedInitialLibrary, setHasLoadedInitialLibrary] = useState(false);
    const [hasLoadedInitialConfig, setHasLoadedInitialConfig] = useState(false);

    const [showChooser, setShowChooser] = useState(false);
    const [showAddTargetModal, setShowAddTargetModal] = useState(false);
    const [showImportRouteModal, setShowImportRouteModal] = useState(false);
    const [showLibraryManagerModal, setShowLibraryManagerModal] = useState(false);
    const [addTargetInitialData, setAddTargetInitialData] = useState<AddTargetInitialData | undefined>();
    const [pendingRouteAttachment, setPendingRouteAttachment] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<ReturnType<typeof checkConnections> | null>(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const [otherRouteOptions, setOtherRouteOptions] = useState<OtherRouteOption[]>([]);
    const currentRouteBaseName = React.useMemo(
        () => routeIdentity.replace(/-(Weekday|Saturday|Sunday)$/i, '').trim(),
        [routeIdentity]
    );
    const routeLabel = React.useMemo(() => (
        routeIdentity.replace(/-(Weekday|Saturday|Sunday)$/i, '')
    ), [routeIdentity]);
    const currentRouteSchedules = React.useMemo(() => (
        schedules.filter(table => {
            const normalizedRouteName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();
            const parsed = parseRouteInfo(normalizedRouteName);
            const candidateBase = parsed.suffixIsDirection ? parsed.baseRoute : normalizedRouteName;
            const hasExplicitDay = /\((Weekday|Saturday|Sunday)\)/i.test(table.routeName);

            return candidateBase === currentRouteBaseName
                && (!hasExplicitDay || table.routeName.toLowerCase().includes(`(${dayType.toLowerCase()})`));
        })
    ), [currentRouteBaseName, dayType, schedules]);
    const availableStops = React.useMemo<StopInfo[]>(() => {
        const stopMap = new Map<string, string>();
        currentRouteSchedules.forEach(table => {
            Object.entries(table.stopIds || {}).forEach(([stopName, code]) => {
                const trimmed = (code || '').trim();
                if (trimmed && !stopMap.has(trimmed)) {
                    stopMap.set(trimmed, stopName);
                }
            });
        });
        return Array.from(stopMap.entries())
            .map(([code, name]) => ({ code, name }))
            .sort((a, b) => {
                const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                return nameCompare !== 0 ? nameCompare : a.code.localeCompare(b.code, undefined, { sensitivity: 'base' });
            });
    }, [currentRouteSchedules]);
    const routeTimepointStops = React.useMemo<StopInfo[]>(
        () => buildRouteTimepointStopOptions(currentRouteSchedules),
        [currentRouteSchedules]
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
        alignTemplateInitialDataToLoadedStops(data, availableStops, currentRouteSchedules)
    ), [availableStops, currentRouteSchedules]);
    const validStopCodes = React.useMemo(() => availableStops.map(stop => stop.code), [availableStops]);
    const materializeRouteConnection = useCallback((connection: Omit<RouteConnection, 'id'>): RouteConnection => ({
        ...connection,
        id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }), []);

    useEffect(() => {
        if (!teamId || validStopCodes.length === 0) {
            setOtherRouteOptions([]);
            return;
        }

        let cancelled = false;

        const loadOtherRouteOptions = async () => {
            try {
                const stopCodeSet = new Set(validStopCodes);
                const entries = await getAllMasterSchedules(teamId);
                const relevantEntries = entries.filter(entry => (
                    entry.id !== routeIdentity && entry.dayType === dayType
                ));

                const results = await Promise.all(
                    relevantEntries.map(async (entry) => {
                        try {
                            const result = await getMasterSchedule(teamId, entry.id as any);
                            return result ? { entry, result } : null;
                        } catch (error) {
                            console.error('Error loading other route connection option:', entry.id, error);
                            return null;
                        }
                    })
                );

                if (cancelled) return;

                const nextOptions = new Map<string, OtherRouteOption>();

                results.forEach(item => {
                    if (!item) return;
                    const routeLabel = item.entry.routeNumber || item.entry.id.replace(/-(Weekday|Saturday|Sunday)$/i, '');
                    const addOptionsForDirection = (
                        direction: 'North' | 'South',
                        table?: MasterRouteTable | null
                    ) => {
                        if (!table) return;
                        Object.entries(table.stopIds || {}).forEach(([stopName, code]) => {
                            const trimmedCode = (code || '').trim();
                            if (!trimmedCode || !stopCodeSet.has(trimmedCode)) return;
                            const key = `${item.entry.id}::${direction}::${trimmedCode}`;
                            if (nextOptions.has(key)) return;
                            nextOptions.set(key, {
                                key,
                                routeIdentity: item.entry.id,
                                routeLabel,
                                direction,
                                stopCode: trimmedCode,
                                stopName
                            });
                        });
                    };

                    addOptionsForDirection('North', item.result.content.northTable);
                    addOptionsForDirection('South', item.result.content.southTable);
                });

                setOtherRouteOptions(Array.from(nextOptions.values()));
            } catch (error) {
                console.error('Error loading other route options:', error);
                if (!cancelled) {
                    setOtherRouteOptions([]);
                }
            }
        };

        loadOtherRouteOptions();

        return () => {
            cancelled = true;
        };
    }, [teamId, routeIdentity, dayType, validStopCodes]);

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

    // Load connection library from Firebase
    useEffect(() => {
        const loadData = async () => {
            setIsLoadingLibrary(true);
            try {
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
            } catch (error) {
                console.error('Error loading connection library:', error);
                setConnectionLibrary({
                    targets: [],
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId
                });
            } finally {
                setIsLoadingLibrary(false);
                setTimeout(() => setHasLoadedInitialLibrary(true), 100);
            }
        };

        loadData();
    }, [teamId, userId]);

    useEffect(() => {
        const loadConfig = async () => {
            setIsLoadingConfig(true);
            try {
                const config = await getRouteConnectionConfig(teamId, routeIdentity);
                setRouteConnectionConfig(config || {
                    routeIdentity,
                    connections: [],
                    optimizationMode: 'hybrid'
                });
            } catch (error) {
                console.error('Error loading route connection config:', error);
                setRouteConnectionConfig({
                    routeIdentity,
                    connections: [],
                    optimizationMode: 'hybrid'
                });
            } finally {
                setIsLoadingConfig(false);
                setTimeout(() => setHasLoadedInitialConfig(true), 100);
            }
        };

        loadConfig();
    }, [teamId, routeIdentity]);

    // Keep parent ScheduleEditor state in sync with panel edits for in-session indicator refresh.
    useEffect(() => {
        if (!onLibraryChanged) return;
        onLibraryChanged(connectionLibrary);
    }, [connectionLibrary, onLibraryChanged]);

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
    }, [teamId, connectionLibrary, isLoadingLibrary, userId, deriveRouteTargetTimes]);

    useEffect(() => {
        if (!teamId || !connectionLibrary || isLoadingLibrary || !hasLoadedInitialLibrary) return;

        const timer = setTimeout(async () => {
            try {
                await saveConnectionLibrary(teamId, connectionLibrary, userId);
            } catch (error) {
                console.error('Error saving connection library:', error);
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [teamId, connectionLibrary, userId, isLoadingLibrary, hasLoadedInitialLibrary]);

    useEffect(() => {
        if (!teamId || !routeConnectionConfig || isLoadingConfig || !hasLoadedInitialConfig) return;

        const timer = setTimeout(async () => {
            try {
                await saveRouteConnectionConfig(teamId, routeIdentity, routeConnectionConfig);
            } catch (error) {
                console.error('Error saving route connection config:', error);
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [teamId, routeIdentity, routeConnectionConfig, isLoadingConfig, hasLoadedInitialConfig]);

    useEffect(() => {
        if (!connectionLibrary || !routeConnectionConfig || schedules.length === 0) {
            setConnectionStatus(null);
            return;
        }

        setIsCheckingStatus(true);
        try {
            setConnectionStatus(checkConnections(schedules, routeConnectionConfig, connectionLibrary));
        } catch (error) {
            console.error('Error checking connections:', error);
            setConnectionStatus(null);
        } finally {
            setIsCheckingStatus(false);
        }
    }, [schedules, connectionLibrary, routeConnectionConfig]);

    const stats = React.useMemo(() => ({
        targetCount: connectionLibrary?.targets.length || 0,
        connectionCount: routeConnectionConfig?.connections.length || 0
    }), [connectionLibrary, routeConnectionConfig]);

    const handleAddConnection = useCallback((connection: Omit<RouteConnection, 'id'>) => {
        if (!routeConnectionConfig) return;
        setRouteConnectionConfig({
            ...routeConnectionConfig,
            connections: [...routeConnectionConfig.connections, materializeRouteConnection(connection)]
        });
    }, [materializeRouteConnection, routeConnectionConfig]);

    const handleAddOtherRouteConnection = useCallback((draft: OtherRouteConnectionDraft) => {
        if (!connectionLibrary || !routeConnectionConfig) return;

        const now = new Date().toISOString();
        const existingTarget = connectionLibrary.targets.find(target => (
            target.type === 'route'
            && target.routeIdentity === draft.routeIdentity
            && target.direction === draft.direction
            && target.stopCode === draft.targetStopCode
        ));

        const routeTarget = existingTarget || {
            id: `target_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: `Route ${draft.routeLabel} (${draft.direction}) • ${draft.targetStopName}`,
            type: 'route' as const,
            routeIdentity: draft.routeIdentity,
            stopCode: draft.targetStopCode,
            stopName: draft.targetStopName,
            direction: draft.direction,
            icon: 'bus' as const,
            color: 'blue',
            defaultEventType: draft.connectionType === 'feed_arriving' ? 'arrival' as const : 'departure' as const,
            createdAt: now,
            updatedAt: now
        };

        if (!existingTarget) {
            setConnectionLibrary(appendLibraryChange({
                ...connectionLibrary,
                targets: [...connectionLibrary.targets, routeTarget],
                updatedAt: now,
                updatedBy: userId
            }, userId, 'add_route_target', `Added route target ${routeTarget.name}`));
        }

        const alreadyAttached = routeConnectionConfig.connections.some(connection => connection.targetId === routeTarget.id);
        if (alreadyAttached) return;

        setRouteConnectionConfig({
            ...routeConnectionConfig,
            connections: [
                ...routeConnectionConfig.connections,
                materializeRouteConnection({
                    targetId: routeTarget.id,
                    connectionType: draft.connectionType,
                    bufferMinutes: draft.bufferMinutes,
                    stopCode: draft.currentStopCode,
                    stopName: draft.currentStopName,
                    priority: routeConnectionConfig.connections.length + 1,
                    enabled: true
                })
            ]
        });
    }, [connectionLibrary, materializeRouteConnection, routeConnectionConfig, userId]);

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
            }
        }

        setShowAddTargetModal(false);
        setPendingRouteAttachment(false);
    }, [connectionLibrary, materializeRouteConnection, pendingRouteAttachment, routeConnectionConfig, routeStopOptions, userId]);

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
            }
        }

        setShowChooser(false);
        setShowAddTargetModal(false);
        setAddTargetInitialData(undefined);
        setPendingRouteAttachment(false);
    }, [connectionLibrary, getTemplateInitialData, materializeRouteConnection, pendingRouteAttachment, routeConnectionConfig, routeStopOptions, userId]);

    return (
        <>
            <div className="w-full lg:w-[420px] lg:min-w-[380px] lg:max-w-[480px] flex-shrink-0 bg-white border-l border-gray-200 z-20 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-blue-600" />
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Connections</h2>
                            <p className="text-xs text-gray-500">Route {routeLabel} • {dayType}</p>
                        </div>
                        {(stats.connectionCount > 0 || stats.targetCount > 0) && (
                            <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                {stats.connectionCount} active • {stats.targetCount} saved
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowLibraryManagerModal(true)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                            <Wrench className="w-3.5 h-3.5" />
                            Manage connections
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>
                </div>

                {isLoadingLibrary || isLoadingConfig ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {stats.connectionCount > 0 && (
                            <ConnectionStatusPanel
                                checkResult={connectionStatus}
                                isLoading={isCheckingStatus}
                                compact
                            />
                        )}

                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 flex items-center justify-between bg-gray-50 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <Settings2 className="w-4 h-4 text-gray-600" />
                                    <span className="font-medium text-gray-900">Route Connections</span>
                                </div>
                                <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                    {stats.connectionCount}
                                </span>
                            </div>
                            <RouteConnectionPanel
                                config={routeConnectionConfig}
                                library={connectionLibrary}
                                availableStops={routeStopOptions}
                                onUpdateConfig={setRouteConnectionConfig}
                                onAddConnection={handleAddConnection}
                                otherRouteOptions={otherRouteOptions}
                                onAddOtherRouteConnection={handleAddOtherRouteConnection}
                                onCreateTarget={() => {
                                    setAddTargetInitialData(undefined);
                                    setPendingRouteAttachment(true);
                                    setShowAddTargetModal(true);
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

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
                <Modal.Header>Connection Library</Modal.Header>
                <Modal.Body className="p-0">
                    <div className="border-b border-gray-100 bg-amber-50 px-6 py-4">
                        <p className="text-sm font-medium text-amber-900">Advanced connection manager</p>
                        <p className="text-xs text-amber-800 mt-1">
                            Use this for team-wide connection maintenance, GTFS refresh, imports, and cleanup. For normal route setup, go back to Route Connections.
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
                        availableStops={availableStops}
                        userId={userId}
                        dayType={dayType}
                        compactAdminMode
                        compactAdminContextLabel={`Route ${routeLabel}`}
                    />
                </Modal.Body>
            </Modal>
        </>
    );
};

export default ConnectionsPanel;
