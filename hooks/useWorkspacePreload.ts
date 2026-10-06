import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../components/contexts/TeamContext';
import { useWorkspaceAccess } from './useWorkspaceAccess';
import { isFeatureEnabled } from '../utils/features';

const PRELOAD_DELAY_MS = 2000;

type NetworkInformationLike = { saveData?: boolean; effectiveType?: string };

function isConstrainedConnection(): boolean {
    if (typeof navigator === 'undefined') return false;
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    return !!connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '');
}

function whenIdle(callback: () => void): () => void {
    let idleHandle: number | null = null;
    const timer = window.setTimeout(() => {
        if (typeof window.requestIdleCallback === 'function') {
            idleHandle = window.requestIdleCallback(callback, { timeout: 5000 });
        } else {
            callback();
        }
    }, PRELOAD_DELAY_MS);
    return () => {
        window.clearTimeout(timer);
        if (idleHandle !== null) window.cancelIdleCallback?.(idleHandle);
    };
}

const swallow = (): void => undefined;

/**
 * Background-loads the workspaces a user is most likely to open next, once per
 * team per session: the Operations dashboard's default Ridership view and the
 * Parking workspaces. Only data the user can already access is requested.
 */
export function useWorkspacePreload(enabled: boolean, currentView: string): void {
    const queryClient = useQueryClient();
    const { team } = useTeam();
    const { canAccess } = useWorkspaceAccess();
    const preloadedTeamIdRef = useRef<string | null>(null);
    const currentViewRef = useRef(currentView);
    currentViewRef.current = currentView;

    const canPreloadRidership = canAccess('workspaceOperations') && isFeatureEnabled('operationsPerformanceDashboard');
    const canPreloadParking = canAccess('workspaceParking');

    useEffect(() => {
        const teamId = team?.id;
        if (!enabled || !teamId || preloadedTeamIdRef.current === teamId) return undefined;
        if (!canPreloadRidership && !canPreloadParking) return undefined;
        if (isConstrainedConnection()) return undefined;

        return whenIdle(() => {
            preloadedTeamIdRef.current = teamId;

            if (canPreloadRidership) {
                const performanceTeamId = team.dataSourceTeamIds?.performance || teamId;
                // Loaded on demand so the data services stay out of the startup bundle.
                void import('./usePerformanceData')
                    .then(({ prefetchOperationsRidership }) => prefetchOperationsRidership(queryClient, performanceTeamId, teamId))
                    .catch(swallow);
                void import('../components/workspaces/OperationsWorkspace').catch(swallow);
                void import('../components/Performance/PerformanceDashboard').catch(swallow);
                void import('../components/Performance/PerformanceWorkspace').catch(swallow);
                void import('../components/Performance/RidershipModule').catch(swallow);
            }

            // An open Parking workspace is already loading its own data.
            if (canPreloadParking && currentViewRef.current !== 'parking') {
                void import('../utils/parking/parkingWorkspacePreload')
                    .then(({ preloadParkingWorkspaceData, getBarriePublicParkingLocations }) => {
                        preloadParkingWorkspaceData(teamId);
                        return getBarriePublicParkingLocations();
                    })
                    .catch(swallow);
                void import('../components/workspaces/ParkingWorkspace').catch(swallow);
                void import('../components/workspaces/ParkingDataWorkspace').catch(swallow);
            }
        });
    }, [canPreloadParking, canPreloadRidership, enabled, queryClient, team]);
}
