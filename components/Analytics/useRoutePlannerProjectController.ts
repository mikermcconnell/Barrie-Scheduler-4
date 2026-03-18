import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';
import { useToast } from '../contexts/ToastContext';
import {
    buildRouteScenarioSeed,
    createDraftRouteProject,
    syncDraftRouteProjectSource,
    type DraftRouteBaseSourceKind,
    type DraftRoutePlannerMode,
} from '../../utils/route-planner/routePlannerDrafts';
import { deriveRouteProject } from '../../utils/route-planner/routePlannerPlanning';
import { clearRoutePlannerDraft, loadRoutePlannerDraft, saveRoutePlannerDraft } from '../../utils/route-planner/routePlannerDraftStorage';
import {
    buildRoutePlannerSavePayload,
    filterRoutePlannerProjectsByTeam,
    resolveActiveRoutePlannerProject,
} from '../../utils/route-planner/routePlannerProjectControllerHelpers';
import {
    deleteRouteScenario,
    duplicateRouteScenario,
    markPreferredRouteScenario,
    updateRouteScenario,
} from '../../utils/route-planner/routePlannerProjectState';
import { getAllStopsWithCoords, type GtfsStopWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import type { RouteProject, RouteScenario, RouteStop } from '../../utils/route-planner/routePlannerTypes';
import {
    buildRouteStopSignature,
    buildRouteWaypointSignature,
    snapRouteStopsToRoad,
    snapRouteWaypointsToRoad,
} from '../../utils/route-planner/routePlannerRoadSnap';
import {
    deleteRoutePlannerProject,
    getAllRoutePlannerProjects,
    saveRoutePlannerProject,
} from '../../utils/services/routePlannerProjectService';
import { getAllMasterSchedules, getMasterSchedule } from '../../utils/services/masterScheduleService';
import { deriveRoutePlannerMasterServiceSeed, findMostRecentMasterScheduleEntry, type RoutePlannerMasterServiceSeed } from '../../utils/route-planner/routePlannerMasterSchedule';
import type { RouteIdentity } from '../../utils/masterScheduleTypes';

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return 'Unknown error';
}

function inferDraftState(
    project: RouteProject,
    fallbackRouteId: string
): { baseSource: DraftRouteBaseSourceKind; routeId: string } {
    const firstScenario = project.scenarios[0];
    if (firstScenario?.baseSource.kind === 'existing_route') {
        return {
            baseSource: 'existing-route',
            routeId: firstScenario.baseSource.sourceId ?? fallbackRouteId,
        };
    }

    return {
        baseSource: 'blank',
        routeId: fallbackRouteId,
    };
}

function buildBarrieStopsGeoJson(stops: GtfsStopWithCoords[]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: stops.map((stop) => ({
            type: 'Feature',
            properties: {
                stopId: stop.stop_id,
                stopName: stop.stop_name,
            },
            geometry: {
                type: 'Point',
                coordinates: [stop.lon, stop.lat],
            },
        })),
    };
}

function buildCustomStopName(stops: RouteStop[]): string {
    const customCount = stops.filter((stop) => stop.kind === 'custom').length;
    return `Custom Stop ${customCount + 1}`;
}

export interface RoutePlannerProjectController {
    project: RouteProject;
    localDraftProject: RouteProject | null;
    projects: RouteProject[];
    projectError: string | null;
    selectedScenarioId: string | null;
    selectedStopId: string | null;
    selectedScenario: RouteScenario | null;
    selectedStop: RouteStop | null;
    compareMode: boolean;
    canCompare: boolean;
    visibleScenarios: RouteScenario[];
    draftState: { baseSource: DraftRouteBaseSourceKind; routeId: string };
    masterServiceSeed: RoutePlannerMasterServiceSeed | null;
    isLoadingMasterServiceSeed: boolean;
    mapEditMode: 'inspect' | 'route' | 'stop';
    barrieStopsGeoJson: GeoJSON.FeatureCollection;
    isLoadingProjects: boolean;
    isSavingProject: boolean;
    isDuplicatingProject: boolean;
    isDeletingProject: boolean;
    isLocalDraft: boolean;
    setCompareMode: Dispatch<SetStateAction<boolean>>;
    setMapEditMode: Dispatch<SetStateAction<'inspect' | 'route' | 'stop'>>;
    setSelectedScenarioId: Dispatch<SetStateAction<string | null>>;
    setSelectedStopId: Dispatch<SetStateAction<string | null>>;
    updateDraftState: (next: { baseSource: DraftRouteBaseSourceKind; routeId: string }) => void;
    selectProject: (project: RouteProject) => void;
    updateProjectName: (value: string) => void;
    updateProjectDescription: (value: string) => void;
    updateSelectedScenarioName: (value: string) => void;
    updateSelectedScenarioPattern: (value: RouteScenario['pattern']) => void;
    updateSelectedScenarioStatus: (value: RouteScenario['status']) => void;
    updateSelectedScenarioFirstDeparture: (value: string) => void;
    updateSelectedScenarioLastDeparture: (value: string) => void;
    updateSelectedScenarioFrequencyMinutes: (value: number) => void;
    updateSelectedScenarioLayoverMinutes: (value: number) => void;
    updateSelectedScenarioTimingProfile: (value: RouteScenario['timingProfile']) => void;
    updateSelectedScenarioStartTerminalHoldMinutes: (value: number) => void;
    updateSelectedScenarioEndTerminalHoldMinutes: (value: number) => void;
    updateSelectedScenarioCoverageWalkshedMeters: (value: number) => void;
    updateSelectedScenarioNotes: (value: string) => void;
    updateSelectedStopName: (value: string) => void;
    updateSelectedStopRole: (value: RouteStop['role']) => void;
    updateSelectedStopPlannedOffsetMinutes: (value: number | null) => void;
    duplicateSelectedScenario: () => void;
    deleteSelectedScenario: () => void;
    markSelectedScenarioPreferred: () => void;
    handleMapClick: (event: MapMouseEvent) => void;
    handleWaypointDragEnd: (coordinateIndex: number, event: MarkerDragEvent) => void;
    handleStopDragEnd: (stopId: string, event: MarkerDragEvent) => void;
    handleRemoveStop: () => void;
    handleUndoWaypoint: () => void;
    handleClearRoute: () => void;
    handleResetRouteToGtfs: () => void;
    handleSaveProject: () => Promise<void>;
    handleDuplicateProject: () => Promise<void>;
    handleCreateFreshProject: () => void;
    handleDeleteCurrentProject: () => Promise<void>;
}

export function useRoutePlannerProjectController({
    mode,
    userId,
    initialBaseSource,
    initialRouteId,
    teamId,
}: {
    mode: DraftRoutePlannerMode;
    userId: string | null;
    initialBaseSource: DraftRouteBaseSourceKind;
    initialRouteId: string;
    teamId?: string | null;
}): RoutePlannerProjectController {
    const toast = useToast();
    const [projects, setProjects] = useState<RouteProject[]>([]);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [isLoadingProjects, setIsLoadingProjects] = useState(Boolean(userId));
    const [isSavingProject, setIsSavingProject] = useState(false);
    const [isDuplicatingProject, setIsDuplicatingProject] = useState(false);
    const [isDeletingProject, setIsDeletingProject] = useState(false);
    const [localDraftProject, setLocalDraftProject] = useState<RouteProject | null>(() => loadRoutePlannerDraft(mode, teamId));
    const [draftState, setDraftState] = useState<{ baseSource: DraftRouteBaseSourceKind; routeId: string }>(() => ({
        baseSource: initialBaseSource,
        routeId: initialRouteId,
    }));
    const [project, setProject] = useState<RouteProject>(() =>
        loadRoutePlannerDraft(mode, teamId) ?? createDraftRouteProject(mode, initialBaseSource, initialRouteId, teamId)
    );
    const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState(mode === 'existing-route-tweak');
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [mapEditMode, setMapEditMode] = useState<'inspect' | 'route' | 'stop'>('inspect');
    const [masterServiceSeed, setMasterServiceSeed] = useState<RoutePlannerMasterServiceSeed | null>(null);
    const [isLoadingMasterServiceSeed, setIsLoadingMasterServiceSeed] = useState(false);
    const stopRerouteRequestRef = useRef(0);
    const waypointRerouteRequestRef = useRef(0);
    const masterServiceSeedRequestRef = useRef(0);
    const barrieStops = useMemo(() => getAllStopsWithCoords(), []);
    const barrieStopsGeoJson = useMemo(() => buildBarrieStopsGeoJson(barrieStops), [barrieStops]);

    useEffect(() => {
        const loadedProject = loadRoutePlannerDraft(mode, teamId);
        setLocalDraftProject(loadedProject);
        if (loadedProject) {
            setDraftState(inferDraftState(loadedProject, initialRouteId));
            setProject(deriveRouteProject(loadedProject));
            return;
        }

        const starterProject = createDraftRouteProject(mode, initialBaseSource, initialRouteId, teamId);
        setDraftState(inferDraftState(starterProject, initialRouteId));
        setProject(starterProject);
    }, [initialBaseSource, initialRouteId, mode, teamId]);

    useEffect(() => {
        setProject((current) =>
            syncDraftRouteProjectSource(current, mode, draftState.baseSource, draftState.routeId)
        );
    }, [draftState.baseSource, draftState.routeId, mode]);

    useEffect(() => {
        if (draftState.baseSource !== 'existing-route' || !teamId) {
            setMasterServiceSeed(null);
            setIsLoadingMasterServiceSeed(false);
            return;
        }

        const requestId = masterServiceSeedRequestRef.current + 1;
        masterServiceSeedRequestRef.current = requestId;
        setIsLoadingMasterServiceSeed(true);

        void (async () => {
            try {
                const schedules = await getAllMasterSchedules(teamId);
                const latestEntry = findMostRecentMasterScheduleEntry(schedules, draftState.routeId);

                if (!latestEntry) {
                    if (masterServiceSeedRequestRef.current === requestId) {
                        setMasterServiceSeed(null);
                    }
                    return;
                }

                const masterSchedule = await getMasterSchedule(teamId, latestEntry.id as RouteIdentity);
                const nextSeed = masterSchedule
                    ? deriveRoutePlannerMasterServiceSeed(masterSchedule.entry, masterSchedule.content)
                    : null;

                if (masterServiceSeedRequestRef.current !== requestId) return;

                setMasterServiceSeed(nextSeed);
                if (!nextSeed) return;

                setProject((current) =>
                    syncDraftRouteProjectSource(current, mode, draftState.baseSource, draftState.routeId, nextSeed)
                );
            } catch (error) {
                console.error('Failed to load route planner master schedule seed:', error);
                if (masterServiceSeedRequestRef.current === requestId) {
                    setMasterServiceSeed(null);
                }
            } finally {
                if (masterServiceSeedRequestRef.current === requestId) {
                    setIsLoadingMasterServiceSeed(false);
                }
            }
        })();
    }, [draftState.baseSource, draftState.routeId, mode, teamId]);

    const loadProjects = async (preferredProjectId?: string): Promise<void> => {
        if (!userId) {
            setProjects([]);
            setProjectError(null);
            setIsLoadingProjects(false);
            return;
        }

        setIsLoadingProjects(true);
        setProjectError(null);

        try {
            const loadedProjects = filterRoutePlannerProjectsByTeam(
                (await getAllRoutePlannerProjects(userId)).map((entry) => deriveRouteProject(entry)),
                teamId,
            );
            const currentProjectIsLocalDraft = !loadedProjects.some((entry) => entry.id === project.id);
            const nextProject = resolveActiveRoutePlannerProject({
                loadedProjects,
                preferredProjectId,
                currentProject: project,
                currentProjectIsLocalDraft,
                localDraftProject,
            });

            setProjects(loadedProjects);

            if (nextProject) {
                setDraftState(inferDraftState(nextProject, initialRouteId));
                setProject(nextProject);
                return;
            }

            const starterProject = createDraftRouteProject(mode, initialBaseSource, initialRouteId, teamId);
            setDraftState(inferDraftState(starterProject, initialRouteId));
            setProject(starterProject);
        } catch (error) {
            console.error('Failed to load route planner projects:', error);
            setProjects([]);
            setProjectError('Failed to load saved route planner projects.');
        } finally {
            setIsLoadingProjects(false);
        }
    };

    useEffect(() => {
        void loadProjects();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamId, userId]);

    useEffect(() => {
        if (teamId === undefined) return;
        setProject((current) => ({ ...current, teamId: teamId ?? null }));
    }, [teamId]);

    useEffect(() => {
        const preferredScenarioId = project.preferredScenarioId ?? project.scenarios[0]?.id ?? null;
        setSelectedScenarioId((currentValue) =>
            project.scenarios.some((scenario) => scenario.id === currentValue)
                ? currentValue
                : preferredScenarioId
        );
    }, [project]);

    const selectedScenario = useMemo(() =>
        project.scenarios.find((scenario) => scenario.id === selectedScenarioId)
        ?? project.scenarios[0]
        ?? null,
    [project.scenarios, selectedScenarioId]);
    useEffect(() => {
        setSelectedStopId((currentValue) =>
            selectedScenario?.stops.some((stop) => stop.id === currentValue)
                ? currentValue
                : selectedScenario?.stops[0]?.id ?? null
        );
    }, [selectedScenario]);
    const selectedStop =
        selectedScenario?.stops.find((stop) => stop.id === selectedStopId)
        ?? selectedScenario?.stops[0]
        ?? null;
    const compareScenario =
        project.scenarios.find((scenario) => scenario.id !== selectedScenario?.id)
        ?? null;
    const canCompare = Boolean(selectedScenario && compareScenario);
    const visibleScenarios =
        compareMode && selectedScenario && compareScenario
            ? [selectedScenario, compareScenario]
            : selectedScenario
                ? [selectedScenario]
                : [];

    useEffect(() => {
        if (compareMode && !canCompare) {
            setCompareMode(false);
        }
    }, [canCompare, compareMode]);

    const isLocalDraft = !userId || !projects.some((entry) => entry.id === project.id);

    useEffect(() => {
        if (!isLocalDraft) return;
        saveRoutePlannerDraft(mode, project, teamId);
        setLocalDraftProject(project);
    }, [isLocalDraft, mode, project, teamId]);

    const updateDraftState = (next: { baseSource: DraftRouteBaseSourceKind; routeId: string }): void => {
        setDraftState(next);
    };

    const selectProject = (nextProject: RouteProject): void => {
        setDraftState(inferDraftState(nextProject, initialRouteId));
        setProject(deriveRouteProject(nextProject));
        setSelectedScenarioId(nextProject.preferredScenarioId ?? nextProject.scenarios[0]?.id ?? null);
        setCompareMode(mode === 'existing-route-tweak' && nextProject.scenarios.length > 1);
    };

    const updateProjectName = (value: string): void => {
        setProject((current) => ({ ...current, name: value, updatedAt: new Date() }));
    };

    const updateProjectDescription = (value: string): void => {
        setProject((current) => ({ ...current, description: value, updatedAt: new Date() }));
    };

    const updateSelectedScenarioName = (value: string): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            name: value,
        })));
    };

    const updateSelectedScenarioPattern = (value: RouteScenario['pattern']): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            pattern: value,
        })));
    };

    const updateSelectedScenarioStatus = (value: RouteScenario['status']): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            status: value,
        })));
    };

    const updateSelectedScenarioFirstDeparture = (value: string): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            firstDeparture: value,
        })));
    };

    const updateSelectedScenarioLastDeparture = (value: string): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            lastDeparture: value,
        })));
    };

    const updateSelectedScenarioFrequencyMinutes = (value: number): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            frequencyMinutes: Math.max(0, Math.round(value)),
        })));
    };

    const updateSelectedScenarioLayoverMinutes = (value: number): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            layoverMinutes: Math.max(0, Math.round(value)),
        })));
    };

    const updateSelectedScenarioTimingProfile = (value: RouteScenario['timingProfile']): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            timingProfile: value,
        })));
    };

    const updateSelectedScenarioStartTerminalHoldMinutes = (value: number): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            startTerminalHoldMinutes: Math.max(0, Math.round(value)),
        })));
    };

    const updateSelectedScenarioEndTerminalHoldMinutes = (value: number): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            endTerminalHoldMinutes: Math.max(0, Math.round(value)),
        })));
    };

    const updateSelectedScenarioCoverageWalkshedMeters = (value: number): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            coverageWalkshedMeters: Math.max(200, Math.min(1000, Math.round(value))),
        })));
    };

    const updateSelectedScenarioNotes = (value: string): void => {
        if (!selectedScenario) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            notes: value,
        })));
    };

    const updateSelectedStopName = (value: string): void => {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            stops: scenario.stops.map((stop) =>
                stop.id === selectedStop.id
                    ? { ...stop, name: value }
                    : stop
            ),
        })));
    };

    const updateSelectedStopRole = (value: RouteStop['role']): void => {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            stops: scenario.stops.map((stop) =>
                stop.id === selectedStop.id
                    ? { ...stop, role: value }
                    : stop
            ),
        })));
    };

    const updateSelectedStopPlannedOffsetMinutes = (value: number | null): void => {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            stops: scenario.stops.map((stop, index) => {
                const isFirstStop = index === 0;
                const isLastStop = index === scenario.stops.length - 1;
                if (stop.id !== selectedStop.id) return stop;
                if (isFirstStop || isLastStop) {
                    return {
                        ...stop,
                        plannedOffsetMinutes: null,
                    };
                }
                return {
                    ...stop,
                    plannedOffsetMinutes: value === null ? null : Math.max(1, Math.round(value)),
                };
            }),
        })));
    };

    const handleMapClick = (event: MapMouseEvent): void => {
        if (!selectedScenario) return;

        const clickedBarrieStop = event.features?.find((feature) => feature.layer?.id === 'route-planner-barrie-stops');
        if (mapEditMode === 'stop' && clickedBarrieStop) {
            const sourceStopId = typeof clickedBarrieStop.properties?.stopId === 'string' ? clickedBarrieStop.properties.stopId : null;
            if (!sourceStopId) return;
            if (selectedScenario.stops.some((stop) => stop.sourceStopId === sourceStopId)) {
                const existingStop = selectedScenario.stops.find((stop) => stop.sourceStopId === sourceStopId);
                setSelectedStopId(existingStop?.id ?? null);
                return;
            }

            const matchedStop = barrieStops.find((stop) => stop.stop_id === sourceStopId);
            if (!matchedStop) return;

            const stopId = `existing-${sourceStopId}`;
            setSelectedStopId(stopId);
            setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
                ...scenario,
                stops: [
                    ...scenario.stops,
                    {
                        id: stopId,
                        name: matchedStop.stop_name,
                        kind: 'existing',
                        sourceStopId: matchedStop.stop_id,
                        role: scenario.stops.length === 0 ? 'terminal' : 'regular',
                        latitude: matchedStop.lat,
                        longitude: matchedStop.lon,
                        timeLabel: scenario.firstDeparture,
                        plannedOffsetMinutes: null,
                    },
                ],
            })));
            return;
        }

        if (mapEditMode === 'route') {
            const nextCoordinate = [event.lngLat.lng, event.lngLat.lat] as [number, number];
            const nextWaypoints = [...selectedScenario.waypoints, nextCoordinate];
            const nextWaypointSignature = buildRouteWaypointSignature(nextWaypoints);
            setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
                ...scenario,
                waypoints: nextWaypoints,
                geometry: {
                    type: 'LineString',
                    coordinates: nextWaypoints,
                },
            })));

            if (nextWaypoints.length < 2) return;

            const requestId = waypointRerouteRequestRef.current + 1;
            waypointRerouteRequestRef.current = requestId;

            void snapRouteWaypointsToRoad(nextWaypoints, selectedScenario.pattern, nextWaypoints.length - 1)
                .then((snapResult) => {
                    if (waypointRerouteRequestRef.current !== requestId) return;

                    setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => {
                        if (buildRouteWaypointSignature(scenario.waypoints) !== nextWaypointSignature) {
                            return scenario;
                        }

                        return {
                            ...scenario,
                            geometry: {
                                type: 'LineString',
                                coordinates: snapResult.coordinates,
                            },
                        };
                    }));
                })
                .catch(() => {
                    // Fallback geometry is already handled inside the road-snap service.
                });
            return;
        }

        if (mapEditMode === 'stop') {
            const stopId = `custom-${Date.now()}`;
            setSelectedStopId(stopId);
            setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
                ...scenario,
                stops: [
                    ...scenario.stops,
                    {
                        id: stopId,
                        name: buildCustomStopName(scenario.stops),
                        kind: 'custom',
                        role: scenario.stops.length === 0 ? 'terminal' : 'regular',
                        latitude: event.lngLat.lat,
                        longitude: event.lngLat.lng,
                        timeLabel: scenario.firstDeparture,
                        plannedOffsetMinutes: null,
                    },
                ],
            })));
        }
    };

    const handleWaypointDragEnd = (coordinateIndex: number, event: MarkerDragEvent): void => {
        if (!selectedScenario) return;

        const nextWaypoints = selectedScenario.waypoints.map((coordinate, index) =>
            index === coordinateIndex
                ? [event.lngLat.lng, event.lngLat.lat] as [number, number]
                : coordinate
        );
        const nextWaypointSignature = buildRouteWaypointSignature(nextWaypoints);

        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => {
            return {
                ...scenario,
                waypoints: nextWaypoints,
                geometry: {
                    type: 'LineString',
                    coordinates: nextWaypoints,
                },
            };
        }));

        if (nextWaypoints.length < 2) return;

        const requestId = waypointRerouteRequestRef.current + 1;
        waypointRerouteRequestRef.current = requestId;

        void snapRouteWaypointsToRoad(nextWaypoints, selectedScenario.pattern, coordinateIndex)
            .then((snapResult) => {
                if (waypointRerouteRequestRef.current !== requestId) return;

                setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => {
                    if (buildRouteWaypointSignature(scenario.waypoints) !== nextWaypointSignature) {
                        return scenario;
                    }

                    return {
                        ...scenario,
                        geometry: {
                            type: 'LineString',
                            coordinates: snapResult.coordinates,
                        },
                    };
                }));
            })
            .catch(() => {
                // Fallback geometry is already handled inside the road-snap service.
            });
    };

    const handleStopDragEnd = (stopId: string, event: MarkerDragEvent): void => {
        if (!selectedScenario) return;

        const nextStops = selectedScenario.stops.map((stop) =>
            stop.id === stopId
                ? {
                    ...stop,
                    latitude: event.lngLat.lat,
                    longitude: event.lngLat.lng,
                }
                : stop
        );
        const nextStopSignature = buildRouteStopSignature(nextStops);

        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            stops: nextStops,
        })));

        if (nextStops.length < 2) return;

        const requestId = stopRerouteRequestRef.current + 1;
        stopRerouteRequestRef.current = requestId;

        void snapRouteStopsToRoad(nextStops, selectedScenario.pattern)
            .then((snapResult) => {
                if (stopRerouteRequestRef.current !== requestId) return;

                setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => {
                    if (buildRouteStopSignature(scenario.stops) !== nextStopSignature) {
                        return scenario;
                    }

                    return {
                        ...scenario,
                        waypoints: snapResult.stopWaypoints,
                        geometry: {
                            type: 'LineString',
                            coordinates: snapResult.coordinates,
                        },
                    };
                }));
            })
            .catch(() => {
                // Fallback geometry is already handled inside the road-snap service.
            });
    };

    const handleRemoveStop = (): void => {
        if (!selectedScenario || !selectedStopId) return;

        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            stops: scenario.stops.filter((stop) => stop.id !== selectedStopId),
        })));
        setSelectedStopId(null);
    };

    const handleUndoWaypoint = (): void => {
        if (!selectedScenario || selectedScenario.waypoints.length === 0) return;

        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => {
            const nextWaypoints = scenario.waypoints.slice(0, -1) as [number, number][];
            return {
                ...scenario,
                waypoints: nextWaypoints,
                geometry: {
                    type: 'LineString',
                    coordinates: nextWaypoints,
                },
            };
        }));
    };

    const handleResetRouteToGtfs = (): void => {
        if (!selectedScenario) return;
        if (selectedScenario.baseSource.kind !== 'existing_route' || !selectedScenario.baseSource.sourceId) {
            toast.info('GTFS Reset Unavailable', 'Only existing Barrie route templates can be reset to GTFS geometry.');
            return;
        }

        const seed = buildRouteScenarioSeed('existing-route', selectedScenario.baseSource.sourceId, selectedScenario.pattern);
        if (seed.geometry.coordinates.length < 2) {
            toast.warning('GTFS Reset Unavailable', 'No GTFS shape was found for this route template.');
            return;
        }

        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            waypoints: seed.waypoints,
            geometry: seed.geometry,
        })));
        toast.success('Route Reset', `Restored Route ${selectedScenario.baseSource.sourceId} to its GTFS starting shape.`);
    };

    const handleClearRoute = (): void => {
        if (!selectedScenario) return;

        setProject((current) => updateRouteScenario(current, selectedScenario.id, (scenario) => ({
            ...scenario,
            waypoints: [],
            geometry: {
                type: 'LineString',
                coordinates: [],
            },
        })));
    };

    const duplicateSelectedScenario = (): void => {
        if (!selectedScenario) return;
        const duplicated = duplicateRouteScenario(project, selectedScenario.id);
        if (!duplicated) return;
        setProject(duplicated.project);
        setSelectedScenarioId(duplicated.duplicatedScenarioId);
        setCompareMode(true);
    };

    const deleteSelectedScenario = (): void => {
        if (!selectedScenario) return;
        const deleted = deleteRouteScenario(project, selectedScenario.id);
        if (!deleted) return;
        setProject(deleted.project);
        setSelectedScenarioId(deleted.nextSelectedScenarioId);
    };

    const markSelectedScenarioPreferred = (): void => {
        if (!selectedScenario) return;
        setProject((current) => markPreferredRouteScenario(current, selectedScenario.id));
    };

    const handleSaveProject = async (): Promise<void> => {
        if (!userId) {
            toast.warning('Sign In Required', 'Sign in to save route planner projects to Firebase.');
            return;
        }

        setIsSavingProject(true);
        try {
            const wasLocalDraft = isLocalDraft;
            const savedProjectId = await saveRoutePlannerProject(userId, buildRoutePlannerSavePayload(project, {
                teamId,
                preserveProjectId: !isLocalDraft,
            }));
            if (wasLocalDraft) {
                clearRoutePlannerDraft(mode, teamId);
                setLocalDraftProject(null);
            }
            await loadProjects(savedProjectId);
            toast.success('Route Project Saved', wasLocalDraft ? 'Local route study is now saved to your account.' : 'Route project changes synced to Firebase.');
        } catch (error) {
            console.error('Failed to save route project:', error);
            toast.error('Save Failed', getErrorMessage(error));
        } finally {
            setIsSavingProject(false);
        }
    };

    const handleDuplicateProject = async (): Promise<void> => {
        if (!userId) {
            toast.warning('Sign In Required', 'Sign in to duplicate route planner projects.');
            return;
        }

        setIsDuplicatingProject(true);
        try {
            const duplicatedProjectId = await saveRoutePlannerProject(userId, buildRoutePlannerSavePayload(project, {
                teamId,
                preserveProjectId: false,
                nameOverride: `${project.name} (Copy)`,
            }));
            await loadProjects(duplicatedProjectId);
            toast.success('Project Duplicated', 'A new route planning draft is ready.');
        } catch (error) {
            console.error('Failed to duplicate route project:', error);
            toast.error('Duplicate Failed', getErrorMessage(error));
        } finally {
            setIsDuplicatingProject(false);
        }
    };

    const handleCreateFreshProject = (): void => {
        const freshProject = createDraftRouteProject(mode, draftState.baseSource, draftState.routeId, teamId, masterServiceSeed);
        setProject(freshProject);
        setLocalDraftProject(freshProject);
        setDraftState(inferDraftState(freshProject, initialRouteId));
        setSelectedScenarioId(freshProject.preferredScenarioId ?? freshProject.scenarios[0]?.id ?? null);
        setCompareMode(mode === 'existing-route-tweak' && freshProject.scenarios.length > 1);
        toast.success('Fresh Project Ready', 'Started a clean route planning draft.');
    };

    const handleDeleteCurrentProject = async (): Promise<void> => {
        if (isLocalDraft) {
            handleCreateFreshProject();
            return;
        }

        if (!userId) {
            toast.warning('Sign In Required', 'Sign in to manage saved route planner projects.');
            return;
        }

        if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;

        setIsDeletingProject(true);
        try {
            await deleteRoutePlannerProject(userId, project.id);
            await loadProjects();
            toast.success('Project Deleted', 'The saved route project was removed.');
        } catch (error) {
            console.error('Failed to delete route project:', error);
            toast.error('Delete Failed', getErrorMessage(error));
        } finally {
            setIsDeletingProject(false);
        }
    };

    return {
        project,
        localDraftProject,
        projects,
        projectError,
        selectedScenarioId,
        selectedStopId,
        selectedScenario,
        selectedStop,
        compareMode,
        canCompare,
        visibleScenarios,
        draftState,
        masterServiceSeed,
        isLoadingMasterServiceSeed,
        mapEditMode,
        barrieStopsGeoJson,
        isLoadingProjects,
        isSavingProject,
        isDuplicatingProject,
        isDeletingProject,
        isLocalDraft,
        setCompareMode,
        setMapEditMode,
        setSelectedScenarioId,
        setSelectedStopId,
        updateDraftState,
        selectProject,
        updateProjectName,
        updateProjectDescription,
        updateSelectedScenarioName,
        updateSelectedScenarioPattern,
        updateSelectedScenarioStatus,
        updateSelectedScenarioFirstDeparture,
        updateSelectedScenarioLastDeparture,
        updateSelectedScenarioFrequencyMinutes,
        updateSelectedScenarioLayoverMinutes,
        updateSelectedScenarioTimingProfile,
        updateSelectedScenarioStartTerminalHoldMinutes,
        updateSelectedScenarioEndTerminalHoldMinutes,
        updateSelectedScenarioCoverageWalkshedMeters,
        updateSelectedScenarioNotes,
        updateSelectedStopName,
        updateSelectedStopRole,
        updateSelectedStopPlannedOffsetMinutes,
        duplicateSelectedScenario,
        deleteSelectedScenario,
        markSelectedScenarioPreferred,
        handleMapClick,
        handleWaypointDragEnd,
        handleStopDragEnd,
        handleRemoveStop,
        handleUndoWaypoint,
        handleClearRoute,
        handleResetRouteToGtfs,
        handleSaveProject,
        handleDuplicateProject,
        handleCreateFreshProject,
        handleDeleteCurrentProject,
    };
}
