/**
 * System Draft Editor Workspace
 *
 * Manages editing of system-wide drafts containing ALL routes for a day type.
 *
 * Key differences from ScheduleEditorWorkspace:
 * - Loads ALL routes for a day type at once
 * - Route switching is instant (no data fetching)
 * - Auto-save saves the entire system
 * - Publishing publishes each route to its master entry
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Bus, Search, X, Check, ChevronRight, ArrowLeft, Calendar, Layers } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { ScheduleEditor } from '../ScheduleEditor';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';
import type { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';
import type { DayType } from '../../utils/masterScheduleTypes';
import type { SystemDraft, SystemDraftRoute, SystemDraftBasedOn } from '../../utils/schedule/scheduleTypes';
import { saveSystemDraft, getSystemDraftRouteNumbers } from '../../utils/services/systemDraftService';
import { buildDuplicateDraftName } from '../../utils/services/draftNaming';
import { publishSystemDraft } from '../../utils/services/publishService';
import {
    buildSystemBaselinesFromGTFSFeed,
    fetchGTFSFeed,
    DEFAULT_GTFS_URL,
} from '../../utils/gtfs/gtfsImportService';

interface SystemDraftEditorWorkspaceProps {
    systemDraft: SystemDraft;
    onClose: () => void;
    onDraftUpdated?: (draft: SystemDraft) => void;
    onOpenDrafts?: () => void;
    onNewDraft?: () => void;
}

/**
 * Convert SystemDraftRoutes to MasterRouteTable[] for the current route.
 */
const getTablesForRoute = (routes: SystemDraftRoute[], routeNumber: string): MasterRouteTable[] => {
    const route = routes.find(r => r.routeNumber === routeNumber);
    if (!route) return [];

    const tables: MasterRouteTable[] = [];
    if (route.northTable && (route.northTable.trips.length > 0 || route.northTable.stops.length > 0)) {
        tables.push(route.northTable);
    }
    if (route.southTable && (route.southTable.trips.length > 0 || route.southTable.stops.length > 0)) {
        tables.push(route.southTable);
    }
    return tables;
};

/**
 * Update a specific route's tables in the routes array.
 */
const updateRouteInRoutes = (
    routes: SystemDraftRoute[],
    routeNumber: string,
    newTables: MasterRouteTable[]
): SystemDraftRoute[] => {
    return routes.map(route => {
        if (route.routeNumber !== routeNumber) return route;

        // Find north and south tables from newTables
        let northTable = route.northTable;
        let southTable = route.southTable;

        newTables.forEach(table => {
            if (table.routeName.includes('(North)') || table.routeName.includes('North')) {
                northTable = table;
            } else if (table.routeName.includes('(South)') || table.routeName.includes('South')) {
                southTable = table;
            } else if (newTables.length === 1) {
                // Single table - treat as north
                northTable = table;
            }
        });

        return { ...route, northTable, southTable };
    });
};

/**
 * Get ALL MasterRouteTables from all routes.
 */
const getAllTablesFromRoutes = (routes: SystemDraftRoute[]): MasterRouteTable[] => {
    const tables: MasterRouteTable[] = [];
    for (const route of routes) {
        if (route.northTable && (route.northTable.trips.length > 0 || route.northTable.stops.length > 0)) {
            tables.push(route.northTable);
        }
        if (route.southTable && (route.southTable.trips.length > 0 || route.southTable.stops.length > 0)) {
            tables.push(route.southTable);
        }
    }
    return tables;
};

/**
 * Update routes with modified tables (after interline processing).
 * Matches tables back to routes by routeName prefix.
 */
const updateRoutesFromTables = (
    routes: SystemDraftRoute[],
    modifiedTables: MasterRouteTable[]
): SystemDraftRoute[] => {
    // Build a map of routeName -> table for quick lookup
    const tableMap = new Map<string, MasterRouteTable>();
    for (const table of modifiedTables) {
        tableMap.set(table.routeName, table);
    }

    return routes.map(route => {
        const northKey = route.northTable?.routeName;
        const southKey = route.southTable?.routeName;

        return {
            ...route,
            northTable: northKey && tableMap.has(northKey) ? tableMap.get(northKey)! : route.northTable,
            southTable: southKey && tableMap.has(southKey) ? tableMap.get(southKey)! : route.southTable
        };
    });
};

export const SystemDraftEditorWorkspace: React.FC<SystemDraftEditorWorkspaceProps> = ({
    systemDraft: initialDraft,
    onClose,
    onDraftUpdated,
    onOpenDrafts,
    onNewDraft
}) => {
    const { user } = useAuth();
    const { team } = useTeam();
    const toast = useToast();
    const userId = user?.uid ?? null;

    // System-level state
    const [draftId, setDraftId] = useState<string>(initialDraft.id);
    const [draftName, setDraftName] = useState<string>(initialDraft.name);
    const [dayType] = useState<DayType>(initialDraft.dayType);
    const [basedOn] = useState<SystemDraftBasedOn | undefined>(initialDraft.basedOn);

    // All routes state - using undo/redo for the entire system
    const {
        state: allRoutes,
        set: setAllRoutes,
        undo,
        redo,
        canUndo,
        canRedo
    } = useUndoRedo<SystemDraftRoute[]>(initialDraft.routes, { maxHistory: 50 });

    // Current route selection
    const [currentRouteNumber, setCurrentRouteNumber] = useState<string>(
        initialDraft.routes[0]?.routeNumber || ''
    );

    // Auto-save state
    const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(initialDraft.updatedAt || null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [storagePath, setStoragePath] = useState<string | undefined>(initialDraft.storagePath);
    const [compareBaseline, setCompareBaseline] = useState<MasterRouteTable[] | null>(null);
    const [compareBaselineLabel, setCompareBaselineLabel] = useState<string | undefined>(undefined);
    const originalRoutesSnapshotRef = useRef<SystemDraftRoute[]>(initialDraft.routes);

    // Sidebar state
    const [routeSearch, setRouteSearch] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);
    const hasInitializedAutoSaveRef = useRef(false);
    const hasPendingChangesRef = useRef(false);
    const changeVersionRef = useRef(0);
    const savedVersionRef = useRef(0);
    const previousRoutesRef = useRef(allRoutes);
    const previousDraftNameRef = useRef(initialDraft.name);
    const userRef = useRef(user);
    const allRoutesRef = useRef(allRoutes);
    const draftNameRef = useRef(draftName);
    const draftIdRef = useRef(draftId);
    const storagePathRef = useRef(storagePath);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    useEffect(() => {
        allRoutesRef.current = allRoutes;
    }, [allRoutes]);

    useEffect(() => {
        draftNameRef.current = draftName;
    }, [draftName]);

    useEffect(() => {
        draftIdRef.current = draftId;
    }, [draftId]);

    useEffect(() => {
        storagePathRef.current = storagePath;
    }, [storagePath]);

    // Get route numbers for sidebar
    const routeNumbers = useMemo(() => getSystemDraftRouteNumbers(allRoutes), [allRoutes]);
    const routeNumbersKey = useMemo(() => routeNumbers.join('|'), [routeNumbers]);

    // Filter routes for sidebar
    const filteredRouteNumbers = useMemo(() => {
        if (!routeSearch) return routeNumbers;
        const query = routeSearch.toLowerCase();
        return routeNumbers.filter(r => r.toLowerCase().includes(query));
    }, [routeNumbers, routeSearch]);

    useEffect(() => {
        let cancelled = false;

        const loadCompareBaseline = async () => {
            const shouldUseGtfsBaseline = (
                basedOn?.type === 'gtfs'
                || (
                    dayType === 'Sunday'
                    && draftName.toLowerCase().includes('boxing day')
                )
            );

            if (!shouldUseGtfsBaseline) {
                if (!cancelled) {
                    setCompareBaseline(null);
                    setCompareBaselineLabel(undefined);
                }
                return;
            }

            try {
                const feedUrl = basedOn.gtfsFeedUrl || DEFAULT_GTFS_URL;
                const feed = await fetchGTFSFeed(feedUrl);
                const baseline = buildSystemBaselinesFromGTFSFeed(feed, dayType, routeNumbers);

                if (!cancelled) {
                    setCompareBaseline(baseline);
                    setCompareBaselineLabel(baseline.length > 0 ? 'GTFS' : undefined);
                }
            } catch (error) {
                console.error('Failed to load GTFS compare baseline for system draft:', error);
                if (!cancelled) {
                    setCompareBaseline(null);
                    setCompareBaselineLabel(undefined);
                }
            }
        };

        void loadCompareBaseline();

        return () => {
            cancelled = true;
        };
    }, [basedOn?.gtfsFeedUrl, basedOn?.type, dayType, draftName, routeNumbersKey]);

    // Get current route's tables
    const currentTables = useMemo(
        () => getTablesForRoute(allRoutes, currentRouteNumber),
        [allRoutes, currentRouteNumber]
    );

    // Original tables for comparison (from initial load)
    const originalTables = useMemo(
        () => getTablesForRoute(originalRoutesSnapshotRef.current, currentRouteNumber),
        [currentRouteNumber]
    );

    // Handle route table changes from ScheduleEditor
    const handleSchedulesChange = useCallback((newTables: MasterRouteTable[]) => {
        const updatedRoutes = updateRouteInRoutes(allRoutes, currentRouteNumber, newTables);
        setAllRoutes(updatedRoutes);
    }, [allRoutes, currentRouteNumber, setAllRoutes]);

    // Save the entire system draft
    const saveDraftNow = useCallback(async (options?: { suppressStatusUpdates?: boolean }): Promise<string | null> => {
        const activeUser = userRef.current;
        if (!activeUser) {
            if (mountedRef.current && !options?.suppressStatusUpdates) {
                setAutoSaveStatus('error');
            }
            return null;
        }

        try {
            if (mountedRef.current && !options?.suppressStatusUpdates) {
                setAutoSaveStatus('saving');
            }
            const versionAtSave = changeVersionRef.current;
            const newDraftId = await saveSystemDraft(activeUser.uid, {
                id: draftIdRef.current,
                name: draftNameRef.current,
                dayType,
                routes: allRoutesRef.current,
                status: 'draft',
                createdBy: activeUser.uid,
                basedOn,
                storagePath: storagePathRef.current
            });
            savedVersionRef.current = Math.max(savedVersionRef.current, versionAtSave);
            const stillDirty = changeVersionRef.current > savedVersionRef.current;
            draftIdRef.current = newDraftId;
            hasPendingChangesRef.current = stillDirty;

            if (mountedRef.current) {
                setDraftId(newDraftId);
                setLastSaved(new Date());
                setHasUnsavedChanges(stillDirty);
                if (!options?.suppressStatusUpdates) {
                    setAutoSaveStatus(stillDirty ? 'idle' : 'saved');
                }
            }

            // Notify parent of update
            if (mountedRef.current) {
                onDraftUpdated?.({
                    id: newDraftId,
                    name: draftNameRef.current,
                    dayType,
                    routes: allRoutesRef.current,
                    status: 'draft',
                    createdBy: activeUser.uid,
                    basedOn,
                    storagePath: storagePathRef.current,
                    createdAt: initialDraft.createdAt,
                    updatedAt: new Date(),
                    routeCount: allRoutesRef.current.length
                });
            }

            return newDraftId;
        } catch (error) {
            console.error('System draft save failed:', error);
            if (mountedRef.current && !options?.suppressStatusUpdates) {
                setAutoSaveStatus('error');
            }
            return null;
        }
    }, [basedOn, dayType, initialDraft.createdAt, onDraftUpdated]);

    // Auto-save effect
    useEffect(() => {
        if (!userId) return;

        if (!hasInitializedAutoSaveRef.current) {
            hasInitializedAutoSaveRef.current = true;
            previousRoutesRef.current = allRoutes;
            previousDraftNameRef.current = draftName;
            hasPendingChangesRef.current = changeVersionRef.current > savedVersionRef.current;
            setHasUnsavedChanges(hasPendingChangesRef.current);
            return;
        }

        const routesChanged = previousRoutesRef.current !== allRoutes;
        const draftNameChanged = previousDraftNameRef.current !== draftName;

        if (!routesChanged && !draftNameChanged) {
            return;
        }

        previousRoutesRef.current = allRoutes;
        previousDraftNameRef.current = draftName;

        changeVersionRef.current += 1;
        const isDirty = changeVersionRef.current > savedVersionRef.current;

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        hasPendingChangesRef.current = isDirty;
        setHasUnsavedChanges(isDirty);

        if (!isDirty) {
            return;
        }

        setAutoSaveStatus(prev => (prev === 'saved' || prev === 'error') ? 'idle' : prev);

        saveTimerRef.current = setTimeout(() => {
            void saveDraftNow();
        }, 10000);
    }, [allRoutes, draftName, saveDraftNow, userId]);

    // Cleanup on unmount
    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;

            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }

            if (hasPendingChangesRef.current && userRef.current) {
                void saveDraftNow({ suppressStatusUpdates: true });
            }
        };
    }, [saveDraftNow]);

    // Handle manual save
    const handleSaveVersion = async () => {
        await saveDraftNow();
    };

    const handleDuplicateDraft = async () => {
        if (!user) {
            toast?.error('Duplicate Failed', 'Sign in to duplicate drafts.');
            return;
        }

        try {
            setAutoSaveStatus('saving');
            const duplicatedName = buildDuplicateDraftName(draftName);
            const newDraftId = await saveSystemDraft(user.uid, {
                name: duplicatedName,
                dayType,
                routes: allRoutesRef.current,
                status: 'draft',
                createdBy: user.uid,
                basedOn,
            });

            setDraftId(newDraftId);
            setDraftName(duplicatedName);
            setStoragePath(undefined);
            setLastSaved(new Date());
            draftIdRef.current = newDraftId;
            draftNameRef.current = duplicatedName;
            storagePathRef.current = undefined;
            savedVersionRef.current = changeVersionRef.current;
            setHasUnsavedChanges(false);
            setAutoSaveStatus('saved');

            onDraftUpdated?.({
                id: newDraftId,
                name: duplicatedName,
                dayType,
                routes: allRoutesRef.current,
                status: 'draft',
                createdBy: user.uid,
                basedOn,
                storagePath: undefined,
                createdAt: initialDraft.createdAt,
                updatedAt: new Date(),
                routeCount: allRoutesRef.current.length
            });

            toast?.success('Duplicated', 'Opened a duplicated system draft copy.');
        } catch (error) {
            console.error('System draft duplicate failed:', error);
            setAutoSaveStatus('error');
            toast?.error('Duplicate Failed', 'Unable to duplicate the current system draft.');
        }
    };

    // Handle publish - publishes all routes
    const handlePublish = async () => {
        if (!user || !team) {
            toast?.warning('Team Required', 'Join a team to publish schedules');
            return;
        }

        // Save before publishing
        await saveDraftNow();

        setIsPublishing(true);
        try {
            const result = await publishSystemDraft({
                teamId: team.id,
                userId: user.uid,
                publisherName: user.displayName || user.email || 'User',
                systemDraftId: draftIdRef.current,
                routes: allRoutesRef.current,
                dayType
            });

            if (result.success) {
                toast?.success(
                    'Published',
                    `Published ${result.publishedCount} routes to master schedules`
                );
            } else {
                toast?.error('Publish Failed', result.error || 'Unable to publish');
            }
        } catch (error) {
            console.error('Publish failed:', error);
            toast?.error('Publish Failed', 'Unable to publish system draft');
        } finally {
            setIsPublishing(false);
        }
    };

    // Handle route switching
    const handleSwitchRoute = (routeNumber: string) => {
        setCurrentRouteNumber(routeNumber);
    };

    // Get trip count for a route
    const getRouteTripCount = (routeNumber: string): number => {
        const route = allRoutes.find(r => r.routeNumber === routeNumber);
        if (!route) return 0;
        return route.northTable.trips.length + route.southTable.trips.length;
    };

    // Get total trip count
    const totalTripCount = allRoutes.reduce((total, route) =>
        total + route.northTable.trips.length + route.southTable.trips.length, 0
    );

    return (
        <div className="h-full flex">
            {/* Route Sidebar */}
            <div className="w-64 min-w-[256px] bg-white border-r border-gray-200 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-3 border-b border-gray-100 bg-gradient-to-r from-indigo-600 to-blue-600">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-white">
                            <Layers size={16} />
                            <span className="font-medium text-sm">System Draft</span>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white/70 hover:text-white text-xs flex items-center gap-1"
                        >
                            <ArrowLeft size={12} />
                            Back
                        </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-white/80 text-xs">
                        <Calendar size={12} />
                        <span>{dayType}</span>
                        <span className="text-white/50">|</span>
                        <span>{allRoutes.length} routes</span>
                        <span className="text-white/50">|</span>
                        <span>{totalTripCount} trips</span>
                    </div>
                </div>

                {/* Search */}
                <div className="p-2 border-b border-gray-100">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search routes..."
                            value={routeSearch}
                            onChange={e => setRouteSearch(e.target.value)}
                            className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        />
                        {routeSearch && (
                            <button
                                onClick={() => setRouteSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Route List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredRouteNumbers.length === 0 ? (
                        <div className="px-4 py-6 text-center text-gray-400 text-sm">
                            No routes match your search
                        </div>
                    ) : (
                        filteredRouteNumbers.map(routeNum => {
                            const isSelected = routeNum === currentRouteNumber;
                            const tripCount = getRouteTripCount(routeNum);
                            return (
                                <button
                                    key={routeNum}
                                    onClick={() => handleSwitchRoute(routeNum)}
                                    className={`w-full px-3 py-2.5 flex items-center justify-between text-left border-b border-gray-100 transition-colors ${
                                        isSelected
                                            ? 'bg-indigo-100 border-l-4 border-l-indigo-600'
                                            : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Bus size={14} className={isSelected ? 'text-indigo-600' : 'text-gray-400'} />
                                        <span className={`font-bold ${isSelected ? 'text-indigo-700' : 'text-gray-700'}`}>
                                            Route {routeNum}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400">
                                            {tripCount} trips
                                        </span>
                                        {isSelected && (
                                            <Check size={14} className="text-indigo-600" />
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1 min-w-0">
                {currentTables.length > 0 ? (
                    <ScheduleEditor
                        schedules={currentTables}
                        connectionScopeSchedules={getAllTablesFromRoutes(allRoutes)}
                        exportScopeSchedules={getAllTablesFromRoutes(allRoutes)}
                        onSchedulesChange={handleSchedulesChange}
                        originalSchedules={originalTables}
                        masterBaseline={compareBaseline}
                        compareBaselineLabel={compareBaselineLabel}
                        draftName={draftName}
                        onRenameDraft={setDraftName}
                        onOpenDrafts={onOpenDrafts}
                        onNewDraft={onNewDraft}
                        onDuplicateDraft={handleDuplicateDraft}
                        autoSaveStatus={autoSaveStatus}
                        lastSaved={lastSaved}
                        hasUnsavedChanges={hasUnsavedChanges}
                        onSaveVersion={handleSaveVersion}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        undo={undo}
                        redo={redo}
                        hideAutoSave={false}
                        onPublish={handlePublish}
                        publishLabel={`Publish All (${allRoutes.length} routes)`}
                        publishDisabled={!user || !team}
                        isPublishing={isPublishing}
                        hideSidebar={true}
                        teamId={team?.id}
                        userId={user?.uid}
                        uploaderName={user?.displayName || user?.email || 'Unknown'}
                        showSuccessToast={(msg) => toast?.success('Success', msg)}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <Bus size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Select a route to edit</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
