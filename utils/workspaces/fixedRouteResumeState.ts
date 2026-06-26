export interface FixedRouteResumeState {
    hash: string;
    label: string;
    updatedAt: string;
    draftId?: string;
    systemDraftId?: string;
}

const FIXED_ROUTE_RESUME_KEY = 'scheduler4:fixed-route-resume';
export const FIXED_ROUTE_RESUME_UPDATED_EVENT = 'scheduler4:fixed-route-resume-updated';

const getResumeKey = (userId: string): string => `${FIXED_ROUTE_RESUME_KEY}:${userId}`;

const normalizeHash = (hash: string): string => {
    const trimmed = hash.trim();
    if (!trimmed) return '#fixed';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

export const clearLegacyFixedRouteResumeState = (): void => {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.removeItem(FIXED_ROUTE_RESUME_KEY);
    } catch (error) {
        console.warn('Failed to clear legacy fixed-route resume state:', error);
    }
};

export const loadFixedRouteResumeState = (userId: string | null | undefined): FixedRouteResumeState | null => {
    if (typeof window === 'undefined' || !userId) return null;

    try {
        clearLegacyFixedRouteResumeState();
        const raw = window.localStorage.getItem(getResumeKey(userId));
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

export const saveFixedRouteResumeState = (
    state: Omit<FixedRouteResumeState, 'updatedAt'>,
    userId: string | null | undefined,
): void => {
    if (typeof window === 'undefined' || !userId) return;

    try {
        clearLegacyFixedRouteResumeState();
        const savedState = {
            ...state,
            hash: normalizeHash(state.hash),
            updatedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(getResumeKey(userId), JSON.stringify(savedState));
        window.dispatchEvent(new CustomEvent(FIXED_ROUTE_RESUME_UPDATED_EVENT, { detail: savedState }));
    } catch (error) {
        console.warn('Failed to save fixed-route resume state:', error);
    }
};
