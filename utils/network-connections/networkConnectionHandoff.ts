import type { DayType } from '../masterScheduleTypes';

const NETWORK_CONNECTION_MASTER_HANDOFF_KEY = 'networkConnections_masterHandoff';
const NETWORK_CONNECTION_EDITOR_HANDOFF_KEY = 'networkConnections_editorHandoff';

export interface NetworkConnectionMasterHandoff {
    routeNumber: string;
    dayType: DayType;
}

export interface NetworkConnectionEditorHandoff {
    draftId: string;
}

export function saveNetworkConnectionMasterHandoff(payload: NetworkConnectionMasterHandoff): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(NETWORK_CONNECTION_MASTER_HANDOFF_KEY, JSON.stringify(payload));
}

export function consumeNetworkConnectionMasterHandoff(): NetworkConnectionMasterHandoff | null {
    if (typeof window === 'undefined') return null;

    const raw = window.sessionStorage.getItem(NETWORK_CONNECTION_MASTER_HANDOFF_KEY);
    if (!raw) return null;

    window.sessionStorage.removeItem(NETWORK_CONNECTION_MASTER_HANDOFF_KEY);

    try {
        const parsed = JSON.parse(raw) as Partial<NetworkConnectionMasterHandoff>;
        if (!parsed.routeNumber || !parsed.dayType) return null;
        if (parsed.dayType !== 'Weekday' && parsed.dayType !== 'Saturday' && parsed.dayType !== 'Sunday') return null;
        return {
            routeNumber: parsed.routeNumber,
            dayType: parsed.dayType,
        };
    } catch {
        return null;
    }
}

export function saveNetworkConnectionEditorHandoff(payload: NetworkConnectionEditorHandoff): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(NETWORK_CONNECTION_EDITOR_HANDOFF_KEY, JSON.stringify(payload));
}

export function consumeNetworkConnectionEditorHandoff(): NetworkConnectionEditorHandoff | null {
    if (typeof window === 'undefined') return null;

    const raw = window.sessionStorage.getItem(NETWORK_CONNECTION_EDITOR_HANDOFF_KEY);
    if (!raw) return null;

    window.sessionStorage.removeItem(NETWORK_CONNECTION_EDITOR_HANDOFF_KEY);

    try {
        const parsed = JSON.parse(raw) as Partial<NetworkConnectionEditorHandoff>;
        if (!parsed.draftId) return null;
        return { draftId: parsed.draftId };
    } catch {
        return null;
    }
}
