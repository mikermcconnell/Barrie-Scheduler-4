import { auth } from './firebase';

type SharedWorkspaceRequest = {
    workspace:
        | 'transitAppMetadata'
        | 'transitAppData'
        | 'performanceMetadata'
        | 'performanceOverview'
        | 'performanceData'
        | 'ridershipTrend'
        | 'strategicPlanRidershipTrend'
        | 'ridershipTrendTod'
        | 'strategicPlanRidershipTod'
        | 'fleetPlan';
    requestingTeamId: string;
    sourceTeamId: string;
    routeId?: string | null;
    dateRange?: { start: string; end: string };
    detailMode?: 'all' | 'overview' | 'otp' | 'ridership' | 'load-profiles' | 'operator-dwell';
};

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'barrie-scheduler-7844a';
const SHARED_WORKSPACE_DATA_URL =
    import.meta.env.VITE_SHARED_WORKSPACE_DATA_URL ||
    `https://us-central1-${PROJECT_ID}.cloudfunctions.net/sharedWorkspaceData`;

export async function requestSharedWorkspaceData<T>(request: SharedWorkspaceRequest): Promise<T | null> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
        throw new Error('Sign in is required to load shared workspace data.');
    }

    const response = await fetch(SHARED_WORKSPACE_DATA_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(request),
    });

    if (response.status === 404) return null;

    const payload = await response.json().catch((): null => null);
    if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load shared workspace data.');
    }

    return (payload?.data ?? null) as T | null;
}
