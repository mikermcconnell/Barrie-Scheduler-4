import { useState, type Dispatch, type SetStateAction } from 'react';
import { ROUTE_DIRECTIONS } from '../../utils/config/routeDirectionConfig';
import {
    useRoutePlannerProjectController,
    type RoutePlannerProjectController,
} from './useRoutePlannerProjectController';
import {
    useShuttlePlannerController,
    type ShuttlePlannerController,
    type ShuttlePlannerWorkspaceSnapshot,
} from './useShuttlePlannerController';

export type RoutePlannerMode = 'shuttle-concept' | 'existing-route-tweak' | 'route-concept';
export type PlannedBaseSourceKind = 'blank' | 'existing-route';

export interface PlannedModeDraftState {
    baseSource: PlannedBaseSourceKind;
    routeId: string;
}

export interface RoutePlannerController {
    selectedMode: RoutePlannerMode;
    plannerSnapshot: ShuttlePlannerWorkspaceSnapshot | null;
    shuttleController: ShuttlePlannerController;
    existingRouteProjectController: RoutePlannerProjectController;
    routeConceptProjectController: RoutePlannerProjectController;
    setSelectedMode: Dispatch<SetStateAction<RoutePlannerMode>>;
}

const ROUTE_OPTIONS = Object.keys(ROUTE_DIRECTIONS).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
);

export function useRoutePlannerController({
    userId,
    teamId,
}: {
    userId: string | null;
    teamId?: string | null;
}): RoutePlannerController {
    const [selectedMode, setSelectedMode] = useState<RoutePlannerMode>('shuttle-concept');
    const [plannerSnapshot, setPlannerSnapshot] = useState<ShuttlePlannerWorkspaceSnapshot | null>(null);

    const shuttleController = useShuttlePlannerController({
        userId,
        teamId,
        onPlannerStateChange: setPlannerSnapshot,
    });

    const existingRouteProjectController = useRoutePlannerProjectController({
        mode: 'existing-route-tweak',
        userId,
        initialBaseSource: 'existing-route',
        initialRouteId: ROUTE_OPTIONS[0] ?? '1',
        teamId,
    });

    const routeConceptProjectController = useRoutePlannerProjectController({
        mode: 'route-concept',
        userId,
        initialBaseSource: 'blank',
        initialRouteId: ROUTE_OPTIONS[0] ?? '1',
        teamId,
    });

    return {
        selectedMode,
        plannerSnapshot,
        shuttleController,
        existingRouteProjectController,
        routeConceptProjectController,
        setSelectedMode,
    };
}
