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
    Plus
} from 'lucide-react';
import type { MasterRouteTable } from '../../utils/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime
} from '../../utils/connectionTypes';
import { generateConnectionId, parseConnectionTime } from '../../utils/connectionTypes';
import { ConnectionLibraryPanel } from '../NewSchedule/connections/ConnectionLibraryPanel';
import { AddTargetModal, AddTargetInitialData } from '../NewSchedule/connections/AddTargetModal';
import { ImportRouteModal } from '../NewSchedule/connections/ImportRouteModal';
import { ConnectionAddChooser, ConnectionTemplateSelection } from '../NewSchedule/connections/ConnectionAddChooser';
import {
    getConnectionLibrary,
    saveConnectionLibrary
} from '../../utils/connectionLibraryService';
import { getMasterSchedule } from '../../utils/masterScheduleService';
import { appendLibraryChange } from '../../utils/connectionLibraryUtils';

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
    // State
    const [connectionLibrary, setConnectionLibrary] = useState<ConnectionLibrary | null>(null);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
    const [hasLoadedInitial, setHasLoadedInitial] = useState(false);

    // Modals
    const [showChooser, setShowChooser] = useState(false);
    const [showAddTargetModal, setShowAddTargetModal] = useState(false);
    const [showImportRouteModal, setShowImportRouteModal] = useState(false);
    const [addTargetInitialData, setAddTargetInitialData] = useState<AddTargetInitialData | undefined>();
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
        for (const table of schedules) {
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
    }, [schedules]);
    const validStopCodes = React.useMemo(() => {
        const codes = new Set<string>();
        schedules.forEach(table => {
            Object.values(table.stopIds || {}).forEach(code => {
                const trimmed = (code || '').trim();
                if (trimmed) codes.add(trimmed);
            });
        });
        return Array.from(codes);
    }, [schedules]);

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
                // Mark initial load complete to prevent auto-save from firing immediately
                setTimeout(() => setHasLoadedInitial(true), 100);
            }
        };

        loadData();
    }, [teamId, userId]);

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

    // Target count for header badge
    const targetCount = connectionLibrary?.targets.length || 0;

    // Handlers
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
    }, [connectionLibrary, userId]);

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
    }, [connectionLibrary, getTemplateInitialData, userId]);

    return (
        <>
            {/* Panel */}
            <div className="w-full lg:w-[420px] lg:min-w-[380px] lg:max-w-[480px] flex-shrink-0 bg-white border-l border-gray-200 z-20 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-blue-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Connection Library</h2>
                        {targetCount > 0 && (
                            <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                {targetCount}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowChooser(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add Connection
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>
                </div>

                {/* Loading state */}
                {isLoadingLibrary ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto">
                        {/* Connection Library - displayed directly without accordion */}
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
                    </div>
                )}
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
        </>
    );
};

export default ConnectionsPanel;
