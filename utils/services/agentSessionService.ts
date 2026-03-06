import {
    AgentSession,
    normalizeAgentSession,
    sortAgentSessions,
} from '../agentSessions';

const AGENT_SESSION_STORAGE_KEY = 'agent-session-registry:v1';

function getStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.localStorage;
}

export function loadAgentSessions(): AgentSession[] {
    try {
        const storage = getStorage();
        if (!storage) {
            return [];
        }

        const stored = storage.getItem(AGENT_SESSION_STORAGE_KEY);
        if (!stored) {
            return [];
        }

        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        const normalized = parsed
            .map((entry) => normalizeAgentSession(entry))
            .filter((entry): entry is AgentSession => entry !== null);

        return sortAgentSessions(normalized);
    } catch (error) {
        console.error('Failed to load agent sessions:', error);
        return [];
    }
}

export function saveAgentSessions(sessions: AgentSession[]): void {
    try {
        const storage = getStorage();
        if (!storage) {
            return;
        }

        storage.setItem(AGENT_SESSION_STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
        console.error('Failed to save agent sessions:', error);
    }
}

export function createAgentSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `agent-session-${Math.random().toString(36).slice(2, 10)}`;
}
