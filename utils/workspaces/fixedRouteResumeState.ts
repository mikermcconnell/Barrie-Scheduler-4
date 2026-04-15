export interface FixedRouteResumeState {
    hash: string;
    label: string;
    updatedAt: string;
    draftId?: string;
    systemDraftId?: string;
}

const FIXED_ROUTE_RESUME_KEY = 'scheduler4:fixed-route-resume';

const normalizeHash = (hash: string): string => {
    const trimmed = hash.trim();
    if (!trimmed) return '#fixed';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

export const loadFixedRouteResumeState = (): FixedRouteResumeState | null => {
    if (typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(FIXED_ROUTE_RESUME_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as FixedRouteResumeState;
        if (!parsed?.hash || !parsed?.label) return null;

        return {
            ...parsed,
            hash: normalizeHash(parsed.hash),
        };
    } catch (error) {
        console.warn('Failed to load fixed-route resume state:', error);
        return null;
    }
};

export const saveFixedRouteResumeState = (state: Omit<FixedRouteResumeState, 'updatedAt'>): void => {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(FIXED_ROUTE_RESUME_KEY, JSON.stringify({
            ...state,
            hash: normalizeHash(state.hash),
            updatedAt: new Date().toISOString(),
        }));
    } catch (error) {
        console.warn('Failed to save fixed-route resume state:', error);
    }
};
