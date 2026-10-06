import {
  loadParkingWorkspaceData,
  type ParkingWorkspaceData,
  type ParkingWorkspaceLoadScope,
} from './parkingService';
import { fetchBarriePublicParkingLocations, type PublicParkingLocation } from './publicParkingLocations';

// Saved parking data can change through imports and department edits, so a
// preload is handed out once and expires rather than acting as a shared cache.
const PRELOAD_MAX_AGE_MS = 1000 * 60 * 30;

interface PreloadedWorkspaceData {
  teamId: string;
  createdAt: number;
  promise: Promise<ParkingWorkspaceData | null>;
}

let preloadedWorkspaceData: PreloadedWorkspaceData | null = null;
let publicLocationsPromise: Promise<PublicParkingLocation[]> | null = null;

export function preloadParkingWorkspaceData(teamId: string): void {
  if (
    preloadedWorkspaceData?.teamId === teamId
    && Date.now() - preloadedWorkspaceData.createdAt < PRELOAD_MAX_AGE_MS
  ) {
    return;
  }
  // 'lot-data' loads plate observations and revenue, so it also covers Plate Monitor.
  preloadedWorkspaceData = {
    teamId,
    createdAt: Date.now(),
    promise: loadParkingWorkspaceData(teamId, 'lot-data').catch((): null => null),
  };
}

/**
 * Returns the preloaded data for this team, or a fresh load when there is no
 * usable preload. A failed preload falls back to a normal load.
 */
export function takeParkingWorkspaceData(
  teamId: string,
  scope: ParkingWorkspaceLoadScope,
): Promise<ParkingWorkspaceData> {
  const preload = preloadedWorkspaceData;
  preloadedWorkspaceData = null;
  if (!preload || preload.teamId !== teamId || Date.now() - preload.createdAt >= PRELOAD_MAX_AGE_MS) {
    return loadParkingWorkspaceData(teamId, scope);
  }
  return preload.promise.then(data => {
    if (!data) return loadParkingWorkspaceData(teamId, scope);
    return scope === 'plate-monitor' ? { ...data, revenueSummary: null } : data;
  });
}

/** City lot locations are static reference data, so one fetch serves the session. */
export function getBarriePublicParkingLocations(): Promise<PublicParkingLocation[]> {
  if (!publicLocationsPromise) {
    publicLocationsPromise = fetchBarriePublicParkingLocations().catch(error => {
      publicLocationsPromise = null;
      throw error;
    });
  }
  return publicLocationsPromise;
}

export function resetParkingWorkspacePreloadForTests(): void {
  preloadedWorkspaceData = null;
  publicLocationsPromise = null;
}
