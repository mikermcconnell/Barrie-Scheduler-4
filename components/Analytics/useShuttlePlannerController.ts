import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';
import { useToast } from '../contexts/ToastContext';
import { deleteShuttleProject, getAllShuttleProjects, saveShuttleProject } from '../../utils/services/shuttleProjectService';
import { createLocalStarterProject, LOCAL_STARTER_SHUTTLE_PROJECT_ID } from '../../utils/shuttle/shuttleSeedData';
import { deriveShuttleProject, deriveShuttleScenario } from '../../utils/shuttle/shuttlePlanning';
import { snapShuttleWaypointsToRoad } from '../../utils/shuttle/shuttleRoadSnapService';
import { getAllStopsWithCoords, type GtfsStopWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import type { ShuttleProject, ShuttleScenario, ShuttleStop } from '../../utils/shuttle/shuttleTypes';

export type MapEditMode = 'inspect' | 'route' | 'stop';
export type RouteSnapState = 'idle' | 'snapping' | 'snapped' | 'fallback';

export interface ShuttlePlannerWorkspaceSnapshot {
    projectId: string;
    projectName: string;
    projectDescription?: string;
    scenarioCount: number;
    selectedScenarioId: string | null;
    selectedScenarioName: string | null;
    compareMode: boolean;
    mapEditMode: MapEditMode;
}

const scenarioAccentOrder: ShuttleScenario['accent'][] = ['indigo', 'emerald', 'amber', 'cyan'];

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return 'Unknown error';
}

function createPlannerStarterProject(teamId?: string | null): ShuttleProject {
    return deriveShuttleProject(createLocalStarterProject(teamId ?? null));
}

function buildCustomStopName(stops: ShuttleStop[]): string {
    const customCount = stops.filter((stop) => stop.kind === 'custom').length;
    return `Custom Stop ${customCount + 1}`;
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

function buildScenarioCopy(scenario: ShuttleScenario, existingCount: number): ShuttleScenario {
    const accentIndex = scenarioAccentOrder.indexOf(scenario.accent);
    const nextAccent = scenarioAccentOrder[(accentIndex + 1 + existingCount) % scenarioAccentOrder.length];
    const suffix = existingCount + 1;

    return deriveShuttleScenario({
        ...scenario,
        id: `${scenario.id}-copy-${Date.now()}`,
        name: `${scenario.name} Option ${suffix}`,
        accent: nextAccent,
        notes: `${scenario.notes} Duplicate for alternative testing.`,
        stops: scenario.stops.map((stop) => ({
            ...stop,
            id: `${stop.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        })),
    });
}

function downloadTextFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function buildProjectExport(project: ShuttleProject, scenarios: ShuttleScenario[]): string {
    const sections = scenarios.map((scenario) => {
        const stops = scenario.stops.map((stop, index) =>
            `${index + 1}. ${stop.name} (${stop.kind}, ${stop.role}) ${stop.timeLabel}`
        ).join('\n');
        const warnings = scenario.warnings.length > 0
            ? scenario.warnings.map((warning) => `- ${warning}`).join('\n')
            : '- No warnings';

        return [
            `## ${scenario.name}`,
            '',
            `- Pattern: ${scenario.pattern}`,
            `- Distance: ${scenario.distanceKm} km`,
            `- Runtime: ${scenario.runtimeMinutes} min`,
            `- Cycle Time: ${scenario.cycleMinutes} min`,
            `- Buses Required: ${scenario.busesRequired}`,
            `- Service Hours: ${scenario.serviceHours}`,
            `- Span: ${scenario.firstDeparture} to ${scenario.lastDeparture}`,
            `- Frequency: Every ${scenario.frequencyMinutes} min`,
            '',
            '### Stops',
            stops,
            '',
            '### Warnings',
            warnings,
            '',
            '### Sample Departures',
            scenario.departures.slice(0, 8).map((departure) => `- ${departure}`).join('\n'),
            '',
        ].join('\n');
    }).join('\n');

    return [
        `# ${project.name}`,
        '',
        project.description ?? 'No description provided.',
        '',
        `Exported: ${new Date().toLocaleString()}`,
        '',
        sections,
    ].join('\n');
}

function getEditableCoordinates(scenario: ShuttleScenario): [number, number][] {
    return scenario.waypoints;
}

export interface ShuttlePlannerController {
    projects: ShuttleProject[];
    projectError: string | null;
    isLoadingProjects: boolean;
    isSavingProject: boolean;
    isDuplicatingProject: boolean;
    isDeletingProject: boolean;
    routeSnapState: RouteSnapState;
    currentProject: ShuttleProject;
    selectedScenarioId: string | null;
    selectedStopId: string | null;
    compareMode: boolean;
    mapEditMode: MapEditMode;
    barrieStopsGeoJson: GeoJSON.FeatureCollection;
    selectedScenario: ShuttleScenario | null;
    selectedStop: ShuttleStop | null;
    visibleScenarios: ShuttleScenario[];
    canCompare: boolean;
    isLocalDraft: boolean;
    setCompareMode: React.Dispatch<React.SetStateAction<boolean>>;
    setMapEditMode: React.Dispatch<React.SetStateAction<MapEditMode>>;
    setSelectedScenarioId: React.Dispatch<React.SetStateAction<string | null>>;
    setSelectedStopId: React.Dispatch<React.SetStateAction<string | null>>;
    selectProject: (project: ShuttleProject) => void;
    updateSelectedScenario: (updater: (scenario: ShuttleScenario) => ShuttleScenario) => void;
    updateScenarioField: <K extends keyof ShuttleScenario>(field: K, value: ShuttleScenario[K]) => void;
    updateProjectField: <K extends keyof ShuttleProject>(field: K, value: ShuttleProject[K]) => void;
    handleMapClick: (event: MapMouseEvent) => void;
    handleWaypointDragEnd: (coordinateIndex: number, event: MarkerDragEvent) => void;
    handleStopDragEnd: (stopId: string, event: MarkerDragEvent) => void;
    handleRemoveStop: () => void;
    handleUndoWaypoint: () => void;
    handleClearRoute: () => void;
    handleSaveProject: () => Promise<void>;
    handleDuplicateProject: () => Promise<void>;
    handleDuplicateScenario: () => void;
    handleDeleteScenario: () => void;
    handleMarkPreferredScenario: () => void;
    handleCreateFreshProject: () => void;
    handleDeleteCurrentProject: () => Promise<void>;
    handleExport: () => void;
}

export function useShuttlePlannerController({
    userId,
    teamId,
    onPlannerStateChange,
}: {
    userId: string | null;
    teamId?: string | null;
    onPlannerStateChange?: (snapshot: ShuttlePlannerWorkspaceSnapshot) => void;
}): ShuttlePlannerController {
    const toast = useToast();
    const routeSnapRequestRef = useRef(0);
    const [projects, setProjects] = useState<ShuttleProject[]>([]);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [isLoadingProjects, setIsLoadingProjects] = useState(Boolean(userId));
    const [isSavingProject, setIsSavingProject] = useState(false);
    const [isDuplicatingProject, setIsDuplicatingProject] = useState(false);
    const [isDeletingProject, setIsDeletingProject] = useState(false);
    const [routeSnapState, setRouteSnapState] = useState<RouteSnapState>('idle');
    const [currentProject, setCurrentProject] = useState<ShuttleProject>(() => createPlannerStarterProject(teamId ?? null));
    const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState(false);
    const [mapEditMode, setMapEditMode] = useState<MapEditMode>('inspect');
    const barrieStops = useMemo(() => getAllStopsWithCoords(), []);
    const barrieStopsGeoJson = useMemo(() => buildBarrieStopsGeoJson(barrieStops), [barrieStops]);

    const loadProjects = async (preferredProjectId?: string): Promise<void> => {
        if (!userId) {
            setProjects([]);
            setProjectError(null);
            setCurrentProject(createPlannerStarterProject(teamId ?? null));
            setIsLoadingProjects(false);
            return;
        }

        setIsLoadingProjects(true);
        setProjectError(null);

        try {
            const loadedProjects = (await getAllShuttleProjects(userId)).map((project) => deriveShuttleProject(project));
            setProjects(loadedProjects);

            if (loadedProjects.length === 0) {
                setCurrentProject(createPlannerStarterProject(teamId ?? null));
                return;
            }

            const nextProject =
                loadedProjects.find((project) => project.id === preferredProjectId)
                ?? loadedProjects.find((project) => project.id === currentProject.id)
                ?? loadedProjects[0];

            setCurrentProject(nextProject);
        } catch (error) {
            console.error('Failed to load shuttle projects:', error);
            setProjects([]);
            setProjectError('Failed to load saved shuttle projects.');
            setCurrentProject(createPlannerStarterProject(teamId ?? null));
        } finally {
            setIsLoadingProjects(false);
        }
    };

    useEffect(() => {
        void loadProjects();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, teamId]);

    useEffect(() => {
        const preferredScenarioId = currentProject.preferredScenarioId ?? currentProject.scenarios[0]?.id ?? null;
        setSelectedScenarioId((currentValue) =>
            currentProject.scenarios.some((scenario) => scenario.id === currentValue)
                ? currentValue
                : preferredScenarioId
        );
    }, [currentProject]);

    useEffect(() => {
        const activeScenario =
            currentProject.scenarios.find((scenario) => scenario.id === selectedScenarioId)
            ?? currentProject.scenarios[0]
            ?? null;

        setSelectedStopId((currentValue) =>
            activeScenario?.stops.some((stop) => stop.id === currentValue)
                ? currentValue
                : activeScenario?.stops[0]?.id ?? null
        );
    }, [currentProject, selectedScenarioId]);

    const selectedScenario =
        currentProject.scenarios.find((scenario) => scenario.id === selectedScenarioId)
        ?? currentProject.scenarios[0]
        ?? null;
    const compareScenario =
        currentProject.scenarios.find((scenario) => scenario.id !== selectedScenario?.id)
        ?? null;
    const canCompare = Boolean(selectedScenario && compareScenario);
    const visibleScenarios =
        compareMode && selectedScenario && compareScenario
            ? [selectedScenario, compareScenario]
            : selectedScenario
                ? [selectedScenario]
                : [];
    const selectedStop =
        selectedScenario?.stops.find((stop) => stop.id === selectedStopId)
        ?? selectedScenario?.stops[0]
        ?? null;
    const isLocalDraft = currentProject.id === LOCAL_STARTER_SHUTTLE_PROJECT_ID;
    const selectedScenarioKey = selectedScenario?.id ?? null;
    const selectedScenarioPattern = selectedScenario?.pattern ?? null;
    const selectedScenarioWaypointSignature = selectedScenario ? JSON.stringify(selectedScenario.waypoints) : '';

    const updateCurrentProject = (updater: (project: ShuttleProject) => ShuttleProject): void => {
        setCurrentProject((project) => deriveShuttleProject(updater(project)));
    };

    const updateSelectedScenario = (updater: (scenario: ShuttleScenario) => ShuttleScenario): void => {
        if (!selectedScenario) return;

        updateCurrentProject((project) => ({
            ...project,
            preferredScenarioId: selectedScenario.id,
            scenarios: project.scenarios.map((scenario) =>
                scenario.id === selectedScenario.id
                    ? deriveShuttleScenario(updater(scenario))
                    : scenario
            ),
        }));
    };

    useEffect(() => {
        const scenarioWaypoints = selectedScenarioWaypointSignature
            ? JSON.parse(selectedScenarioWaypointSignature) as [number, number][]
            : [];

        if (!selectedScenarioKey || scenarioWaypoints.length < 2 || !selectedScenarioPattern) {
            setRouteSnapState('idle');
            return;
        }

        let cancelled = false;
        const requestId = routeSnapRequestRef.current + 1;
        routeSnapRequestRef.current = requestId;
        setRouteSnapState('snapping');

        const timeout = window.setTimeout(() => {
            void snapShuttleWaypointsToRoad(scenarioWaypoints, selectedScenarioPattern)
                .then((snapResult) => {
                    if (cancelled || routeSnapRequestRef.current !== requestId) return;

                    setCurrentProject((project) => {
                        let scenarioChanged = false;
                        const scenarios = project.scenarios.map((scenario) => {
                            if (scenario.id !== selectedScenarioKey) return scenario;

                            const currentSignature = JSON.stringify(scenario.geometry.coordinates);
                            const nextSignature = JSON.stringify(snapResult.coordinates);
                            if (currentSignature === nextSignature) return scenario;

                            scenarioChanged = true;
                            return deriveShuttleScenario({
                                ...scenario,
                                geometry: {
                                    type: 'LineString',
                                    coordinates: snapResult.coordinates,
                                },
                            });
                        });

                        return scenarioChanged ? { ...project, scenarios } : project;
                    });
                    setRouteSnapState(snapResult.source === 'mapbox' ? 'snapped' : 'fallback');
                });
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(timeout);
        };
    }, [selectedScenarioKey, selectedScenarioPattern, selectedScenarioWaypointSignature]);

    useEffect(() => {
        if (compareMode && !canCompare) {
            setCompareMode(false);
        }
    }, [canCompare, compareMode]);

    useEffect(() => {
        onPlannerStateChange?.({
            projectId: currentProject.id,
            projectName: currentProject.name,
            projectDescription: currentProject.description,
            scenarioCount: currentProject.scenarios.length,
            selectedScenarioId: selectedScenario?.id ?? null,
            selectedScenarioName: selectedScenario?.name ?? null,
            compareMode,
            mapEditMode,
        });
    }, [
        compareMode,
        currentProject.description,
        currentProject.id,
        currentProject.name,
        currentProject.scenarios.length,
        mapEditMode,
        onPlannerStateChange,
        selectedScenario?.id,
        selectedScenario?.name,
    ]);

    const selectProject = (project: ShuttleProject): void => {
        setCurrentProject(project);
        setSelectedScenarioId(project.preferredScenarioId ?? project.scenarios[0]?.id ?? null);
        setSelectedStopId(project.scenarios[0]?.stops[0]?.id ?? null);
        setCompareMode(false);
        setMapEditMode('inspect');
    };

    const updateScenarioField = <K extends keyof ShuttleScenario>(field: K, value: ShuttleScenario[K]): void => {
        updateSelectedScenario((scenario) => ({
            ...scenario,
            [field]: value,
        }));
    };

    const updateProjectField = <K extends keyof ShuttleProject>(field: K, value: ShuttleProject[K]): void => {
        updateCurrentProject((project) => ({
            ...project,
            [field]: value,
        }));
    };

    const handleMapClick = (event: MapMouseEvent): void => {
        if (!selectedScenario) return;

        const clickedBarrieStop = event.features?.find((feature) => feature.layer?.id === 'shuttle-barrie-stops');
        if (mapEditMode === 'stop' && clickedBarrieStop) {
            const barrieStopId = typeof clickedBarrieStop.properties?.stopId === 'string' ? clickedBarrieStop.properties.stopId : null;
            const stopName = typeof clickedBarrieStop.properties?.stopName === 'string' ? clickedBarrieStop.properties.stopName : 'Barrie Stop';
            if (!barrieStopId) return;

            if (selectedScenario.stops.some((stop) => stop.barrieStopId === barrieStopId)) {
                toast.info('Stop Already Added', `${stopName} is already part of this shuttle concept.`);
                return;
            }

            const matchedStop = barrieStops.find((stop) => stop.stop_id === barrieStopId);
            if (!matchedStop) return;

            const stopId = `barrie-${barrieStopId}`;
            setSelectedStopId(stopId);
            updateSelectedScenario((scenario) => ({
                ...scenario,
                stops: [
                    ...scenario.stops,
                    {
                        id: stopId,
                        name: matchedStop.stop_name,
                        kind: 'barrie',
                        barrieStopId: matchedStop.stop_id,
                        role: scenario.stops.length === 0 ? 'terminal' : 'regular',
                        latitude: matchedStop.lat,
                        longitude: matchedStop.lon,
                        timeLabel: scenario.firstDeparture,
                    },
                ],
            }));
            return;
        }

        const nextCoordinate = [event.lngLat.lng, event.lngLat.lat] as [number, number];

        if (mapEditMode === 'route') {
            const editableCoordinates = getEditableCoordinates(selectedScenario);
            updateSelectedScenario((scenario) => ({
                ...scenario,
                geometry: {
                    type: 'LineString',
                    coordinates: [...editableCoordinates, nextCoordinate],
                },
                waypoints: [...editableCoordinates, nextCoordinate],
            }));
            return;
        }

        if (mapEditMode === 'stop') {
            const stopId = `custom-${Date.now()}`;
            setSelectedStopId(stopId);
            updateSelectedScenario((scenario) => {
                const nextStop: ShuttleStop = {
                    id: stopId,
                    name: buildCustomStopName(scenario.stops),
                    kind: 'custom',
                    role: scenario.stops.length === 0 ? 'terminal' : 'regular',
                    latitude: event.lngLat.lat,
                    longitude: event.lngLat.lng,
                    timeLabel: scenario.firstDeparture,
                };

                return {
                    ...scenario,
                    stops: [...scenario.stops, nextStop],
                };
            });
        }
    };

    const handleWaypointDragEnd = (coordinateIndex: number, event: MarkerDragEvent): void => {
        if (!selectedScenario) return;
        const editableCoordinates = getEditableCoordinates(selectedScenario);
        const nextWaypoints: [number, number][] = editableCoordinates.map((coordinate, index) =>
            index === coordinateIndex
                ? [event.lngLat.lng, event.lngLat.lat]
                : coordinate
        );
        updateSelectedScenario((scenario) => ({
            ...scenario,
            waypoints: nextWaypoints,
            geometry: {
                type: 'LineString',
                coordinates: nextWaypoints,
            },
        }));
    };

    const handleStopDragEnd = (stopId: string, event: MarkerDragEvent): void => {
        updateSelectedScenario((scenario) => ({
            ...scenario,
            stops: scenario.stops.map((stop) =>
                stop.id === stopId
                    ? {
                        ...stop,
                        latitude: event.lngLat.lat,
                        longitude: event.lngLat.lng,
                    }
                    : stop
            ),
        }));
    };

    const handleRemoveStop = (): void => {
        if (!selectedStopId) return;

        updateSelectedScenario((scenario) => ({
            ...scenario,
            stops: scenario.stops.filter((stop) => stop.id !== selectedStopId),
        }));
        setSelectedStopId(null);
    };

    const handleUndoWaypoint = (): void => {
        if (!selectedScenario || getEditableCoordinates(selectedScenario).length === 0) return;
        const nextWaypoints = getEditableCoordinates(selectedScenario).slice(0, -1) as [number, number][];

        updateSelectedScenario((scenario) => ({
            ...scenario,
            waypoints: nextWaypoints,
            geometry: {
                type: 'LineString',
                coordinates: nextWaypoints,
            },
        }));
    };

    const handleClearRoute = (): void => {
        updateSelectedScenario((scenario) => ({
            ...scenario,
            waypoints: [],
            geometry: {
                type: 'LineString',
                coordinates: [],
            },
        }));
    };

    const buildSavePayload = (nameOverride?: string) => ({
        id: isLocalDraft ? undefined : currentProject.id,
        name: nameOverride ?? currentProject.name,
        description: currentProject.description,
        teamId: currentProject.teamId ?? teamId ?? null,
        preferredScenarioId: selectedScenarioId ?? currentProject.preferredScenarioId ?? currentProject.scenarios[0]?.id ?? null,
        scenarios: currentProject.scenarios,
    });

    const handleSaveProject = async (): Promise<void> => {
        if (!userId) {
            toast.warning('Sign In Required', 'Sign in to save shuttle projects to Firebase.');
            return;
        }

        setIsSavingProject(true);
        try {
            const savedProjectId = await saveShuttleProject(userId, buildSavePayload());
            await loadProjects(savedProjectId);
            toast.success('Shuttle Project Saved', isLocalDraft ? 'Starter project is now saved to your account.' : 'Project changes synced to Firebase.');
        } catch (error) {
            console.error('Failed to save shuttle project:', error);
            toast.error('Save Failed', getErrorMessage(error));
        } finally {
            setIsSavingProject(false);
        }
    };

    const handleDuplicateProject = async (): Promise<void> => {
        if (!userId) {
            toast.warning('Sign In Required', 'Sign in to duplicate shuttle projects.');
            return;
        }

        setIsDuplicatingProject(true);
        try {
            const duplicatedProjectId = await saveShuttleProject(userId, buildSavePayload(`${currentProject.name} (Copy)`));
            await loadProjects(duplicatedProjectId);
            toast.success('Project Duplicated', 'A new shuttle planning draft is ready.');
        } catch (error) {
            console.error('Failed to duplicate shuttle project:', error);
            toast.error('Duplicate Failed', getErrorMessage(error));
        } finally {
            setIsDuplicatingProject(false);
        }
    };

    const handleDuplicateScenario = (): void => {
        if (!selectedScenario) return;

        const scenarioCopy = buildScenarioCopy(selectedScenario, currentProject.scenarios.length);
        updateCurrentProject((project) => ({
            ...project,
            preferredScenarioId: scenarioCopy.id,
            scenarios: [...project.scenarios, scenarioCopy],
        }));
        setSelectedScenarioId(scenarioCopy.id);
        setSelectedStopId(scenarioCopy.stops[0]?.id ?? null);
        setCompareMode(true);
        toast.success('Scenario Added', `${scenarioCopy.name} is ready for comparison.`);
    };

    const handleDeleteScenario = (): void => {
        if (!selectedScenario) return;
        if (currentProject.scenarios.length <= 1) {
            toast.warning('Last Scenario', 'Keep at least one scenario in the project. Start a new project to work from a clean slate.');
            return;
        }

        if (!window.confirm(`Delete scenario "${selectedScenario.name}"?`)) return;

        const remainingScenarios = currentProject.scenarios.filter((scenario) => scenario.id !== selectedScenario.id);
        const nextScenario = remainingScenarios[0] ?? null;

        updateCurrentProject((project) => ({
            ...project,
            preferredScenarioId: nextScenario?.id ?? null,
            scenarios: remainingScenarios,
        }));
        setSelectedScenarioId(nextScenario?.id ?? null);
        setSelectedStopId(nextScenario?.stops[0]?.id ?? null);
        toast.success('Scenario Deleted', 'Project options were updated.');
    };

    const handleMarkPreferredScenario = (): void => {
        if (!selectedScenario) return;

        updateCurrentProject((project) => ({
            ...project,
            preferredScenarioId: selectedScenario.id,
        }));
        toast.success('Preferred Scenario Updated', `${selectedScenario.name} is now the default scenario for this project.`);
    };

    const handleCreateFreshProject = (): void => {
        const freshProject = createPlannerStarterProject(teamId ?? null);
        setCurrentProject(freshProject);
        setSelectedScenarioId(freshProject.preferredScenarioId ?? freshProject.scenarios[0]?.id ?? null);
        setSelectedStopId(freshProject.scenarios[0]?.stops[0]?.id ?? null);
        setCompareMode(false);
        setMapEditMode('inspect');
        toast.success('Fresh Project Ready', 'Started a clean local shuttle project.');
    };

    const handleDeleteCurrentProject = async (): Promise<void> => {
        if (isLocalDraft) {
            handleCreateFreshProject();
            return;
        }

        if (!userId) {
            toast.warning('Sign In Required', 'Sign in to manage saved shuttle projects.');
            return;
        }

        if (!window.confirm(`Delete project "${currentProject.name}"? This cannot be undone.`)) return;

        setIsDeletingProject(true);
        try {
            await deleteShuttleProject(userId, currentProject.id);
            await loadProjects();
            toast.success('Project Deleted', 'The saved shuttle project was removed.');
        } catch (error) {
            console.error('Failed to delete shuttle project:', error);
            toast.error('Delete Failed', getErrorMessage(error));
        } finally {
            setIsDeletingProject(false);
        }
    };

    const handleExport = (): void => {
        const scenariosToExport = compareMode ? visibleScenarios : (selectedScenario ? [selectedScenario] : []);
        if (scenariosToExport.length === 0) {
            toast.warning('Nothing To Export', 'Select or create a scenario first.');
            return;
        }

        const safeName = currentProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        downloadTextFile(`${safeName || 'shuttle-project'}-summary.md`, buildProjectExport(currentProject, scenariosToExport));
        toast.success('Export Ready', 'Downloaded a shuttle planning summary for review.');
    };

    return {
        projects,
        projectError,
        isLoadingProjects,
        isSavingProject,
        isDuplicatingProject,
        isDeletingProject,
        routeSnapState,
        currentProject,
        selectedScenarioId,
        selectedStopId,
        compareMode,
        mapEditMode,
        barrieStopsGeoJson,
        selectedScenario,
        selectedStop,
        visibleScenarios,
        canCompare,
        isLocalDraft,
        setCompareMode,
        setMapEditMode,
        setSelectedScenarioId,
        setSelectedStopId,
        selectProject,
        updateSelectedScenario,
        updateScenarioField,
        updateProjectField,
        handleMapClick,
        handleWaypointDragEnd,
        handleStopDragEnd,
        handleRemoveStop,
        handleUndoWaypoint,
        handleClearRoute,
        handleSaveProject,
        handleDuplicateProject,
        handleDuplicateScenario,
        handleDeleteScenario,
        handleMarkPreferredScenario,
        handleCreateFreshProject,
        handleDeleteCurrentProject,
        handleExport,
    };
}
