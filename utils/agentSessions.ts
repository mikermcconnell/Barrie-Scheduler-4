export const AGENT_SESSION_STATUSES = ['active', 'waiting', 'blocked', 'review', 'done'] as const;

export type AgentSessionStatus = typeof AGENT_SESSION_STATUSES[number];

export const AGENT_SESSION_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export type AgentSessionPriority = typeof AGENT_SESSION_PRIORITIES[number];

export type AgentSessionFilter = 'all' | AgentSessionStatus | 'stale';

export interface AgentSession {
    id: string;
    title: string;
    purpose: string;
    currentTask: string;
    lastPrompt: string;
    status: AgentSessionStatus;
    priority: AgentSessionPriority;
    lastUpdatedAt: string;
    lastSummary: string;
    nextAction: string;
    blockedBy: string;
    chatReference: string;
    createdAt: string;
}

export interface AgentSessionDraft {
    title: string;
    purpose: string;
    currentTask: string;
    lastPrompt: string;
    status: AgentSessionStatus;
    priority: AgentSessionPriority;
    lastSummary: string;
    nextAction: string;
    blockedBy: string;
    chatReference: string;
}

export interface AgentSessionRollup {
    total: number;
    active: number;
    blocked: number;
    needsInput: number;
    waiting: number;
    stale: number;
    criticallyStale: number;
    priorityFocus: AgentSession[];
    attentionQueue: AgentSession[];
}

const STATUS_SORT_ORDER: Record<AgentSessionStatus, number> = {
    blocked: 0,
    review: 1,
    active: 2,
    waiting: 3,
    done: 4,
};

const PRIORITY_SORT_ORDER: Record<AgentSessionPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};

const EMPTY_DRAFT: AgentSessionDraft = {
    title: '',
    purpose: '',
    currentTask: '',
    lastPrompt: '',
    status: 'active',
    priority: 'medium',
    lastSummary: '',
    nextAction: '',
    blockedBy: '',
    chatReference: '',
};

export const AGENT_SESSION_STALE_HOURS = 24;
export const AGENT_SESSION_CRITICAL_STALE_HOURS = 48;
const DEFAULT_AGENT_SESSION_TITLE = 'Untitled session';
const AGENT_SESSION_TITLE_MAX_LENGTH = 56;
const AGENT_SESSION_PREVIEW_MAX_LENGTH = 140;

export function createEmptyAgentSessionDraft(): AgentSessionDraft {
    return { ...EMPTY_DRAFT };
}

export function isAgentSessionStatus(value: unknown): value is AgentSessionStatus {
    return typeof value === 'string' && AGENT_SESSION_STATUSES.includes(value as AgentSessionStatus);
}

export function isAgentSessionPriority(value: unknown): value is AgentSessionPriority {
    return typeof value === 'string' && AGENT_SESSION_PRIORITIES.includes(value as AgentSessionPriority);
}

function compactSessionText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function truncateSessionText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    const truncated = value.slice(0, maxLength - 1).trimEnd();
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex >= Math.floor(maxLength * 0.6)) {
        return `${truncated.slice(0, lastSpaceIndex).trimEnd()}…`;
    }
    return `${truncated}…`;
}

function sanitizePromptLead(value: string): string {
    return value
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, '')
        .replace(/^(?:please\s+)?help\s+me\s+/i, '')
        .replace(/^(?:please\s+)?i\s+need\s+you\s+to\s+/i, '')
        .replace(/^(?:please\s+)?let'?s\s+/i, '');
}

export function getAgentSessionDisplayTitle(
    session: Pick<AgentSession, 'title' | 'lastPrompt' | 'currentTask' | 'purpose' | 'chatReference'>
): string {
    const manualTitle = compactSessionText(session.title);
    if (manualTitle) {
        return manualTitle;
    }

    const derivedSource = [session.lastPrompt, session.currentTask, session.purpose, session.chatReference]
        .map((value) => compactSessionText(value))
        .find((value) => value.length > 0);

    if (!derivedSource) {
        return DEFAULT_AGENT_SESSION_TITLE;
    }

    const normalizedSource = sanitizePromptLead(derivedSource);
    const titleSource = normalizedSource || derivedSource;
    return truncateSessionText(titleSource, AGENT_SESSION_TITLE_MAX_LENGTH);
}

export function getAgentSessionPromptPreview(
    session: Pick<AgentSession, 'lastPrompt' | 'currentTask' | 'purpose'>
): string {
    const previewSource = [session.lastPrompt, session.currentTask, session.purpose]
        .map((value) => compactSessionText(value))
        .find((value) => value.length > 0);

    if (!previewSource) {
        return 'No latest prompt captured yet.';
    }

    return truncateSessionText(previewSource, AGENT_SESSION_PREVIEW_MAX_LENGTH);
}

export function normalizeAgentSession(value: unknown): AgentSession | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== 'string') {
        return null;
    }

    const timestamp = typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : new Date().toISOString();
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : timestamp;

    return {
        id: raw.id,
        title: typeof raw.title === 'string' ? raw.title.trim() : '',
        purpose: typeof raw.purpose === 'string' ? raw.purpose.trim() : '',
        currentTask: typeof raw.currentTask === 'string' ? raw.currentTask.trim() : '',
        lastPrompt: typeof raw.lastPrompt === 'string' ? raw.lastPrompt.trim() : '',
        status: isAgentSessionStatus(raw.status) ? raw.status : 'active',
        priority: isAgentSessionPriority(raw.priority) ? raw.priority : 'medium',
        lastUpdatedAt: timestamp,
        lastSummary: typeof raw.lastSummary === 'string' ? raw.lastSummary.trim() : '',
        nextAction: typeof raw.nextAction === 'string' ? raw.nextAction.trim() : '',
        blockedBy: typeof raw.blockedBy === 'string' ? raw.blockedBy.trim() : '',
        chatReference: typeof raw.chatReference === 'string' ? raw.chatReference.trim() : '',
        createdAt,
    };
}

export function getAgentSessionAgeHours(session: Pick<AgentSession, 'lastUpdatedAt'>, now = Date.now()): number {
    const updatedAtMs = Date.parse(session.lastUpdatedAt);
    if (Number.isNaN(updatedAtMs)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, (now - updatedAtMs) / (1000 * 60 * 60));
}

export function isAgentSessionStale(session: Pick<AgentSession, 'lastUpdatedAt'>, now = Date.now()): boolean {
    return getAgentSessionAgeHours(session, now) >= AGENT_SESSION_STALE_HOURS;
}

export function isAgentSessionCriticallyStale(session: Pick<AgentSession, 'lastUpdatedAt'>, now = Date.now()): boolean {
    return getAgentSessionAgeHours(session, now) >= AGENT_SESSION_CRITICAL_STALE_HOURS;
}

export function matchesAgentSessionQuery(session: AgentSession, query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    const haystack = [
        getAgentSessionDisplayTitle(session),
        session.purpose,
        session.currentTask,
        session.lastPrompt,
        session.lastSummary,
        session.nextAction,
        session.blockedBy,
        session.chatReference,
    ]
        .join(' ')
        .toLowerCase();

    return haystack.includes(normalizedQuery);
}

export function filterAgentSessions(
    sessions: AgentSession[],
    filter: AgentSessionFilter,
    query = '',
    now = Date.now()
): AgentSession[] {
    return sessions.filter((session) => {
        const matchesFilter = filter === 'all'
            ? true
            : filter === 'stale'
                ? session.status !== 'done' && isAgentSessionStale(session, now)
                : session.status === filter;

        return matchesFilter && matchesAgentSessionQuery(session, query);
    });
}

export function sortAgentSessions(sessions: AgentSession[], now = Date.now()): AgentSession[] {
    return [...sessions].sort((left, right) => {
        const leftDone = left.status === 'done';
        const rightDone = right.status === 'done';
        if (leftDone !== rightDone) {
            return leftDone ? 1 : -1;
        }

        const leftCriticalStale = isAgentSessionCriticallyStale(left, now);
        const rightCriticalStale = isAgentSessionCriticallyStale(right, now);
        if (leftCriticalStale !== rightCriticalStale) {
            return leftCriticalStale ? -1 : 1;
        }

        const leftStale = isAgentSessionStale(left, now);
        const rightStale = isAgentSessionStale(right, now);
        if (leftStale !== rightStale) {
            return leftStale ? -1 : 1;
        }

        const statusDelta = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
        if (statusDelta !== 0) {
            return statusDelta;
        }

        const priorityDelta = PRIORITY_SORT_ORDER[left.priority] - PRIORITY_SORT_ORDER[right.priority];
        if (priorityDelta !== 0) {
            return priorityDelta;
        }

        return Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt);
    });
}

export function getAgentSessionRollup(sessions: AgentSession[], now = Date.now()): AgentSessionRollup {
    const orderedSessions = sortAgentSessions(sessions, now);
    const activeSessions = orderedSessions.filter((session) => session.status !== 'done');

    return {
        total: orderedSessions.length,
        active: activeSessions.length,
        blocked: activeSessions.filter((session) => session.status === 'blocked').length,
        needsInput: activeSessions.filter((session) => session.status === 'review').length,
        waiting: activeSessions.filter((session) => session.status === 'waiting').length,
        stale: activeSessions.filter((session) => isAgentSessionStale(session, now)).length,
        criticallyStale: activeSessions.filter((session) => isAgentSessionCriticallyStale(session, now)).length,
        priorityFocus: activeSessions.slice(0, 3),
        attentionQueue: activeSessions
            .filter((session) => (
                session.status === 'blocked'
                || session.status === 'review'
                || isAgentSessionStale(session, now)
            ))
            .slice(0, 5),
    };
}

export function buildAgentSessionRollupText(sessions: AgentSession[], now = Date.now()): string {
    const rollup = getAgentSessionRollup(sessions, now);
    const lines: string[] = [];

    lines.push(`Active sessions: ${rollup.active}`);
    lines.push(`Blocked: ${rollup.blocked} | Needs input: ${rollup.needsInput} | Waiting: ${rollup.waiting}`);
    lines.push(`Stale: ${rollup.stale} | Critically stale: ${rollup.criticallyStale}`);

    if (rollup.priorityFocus.length > 0) {
        lines.push('');
        lines.push('Top focus:');
        rollup.priorityFocus.forEach((session, index) => {
            lines.push(`${index + 1}. ${getAgentSessionDisplayTitle(session)} [${session.status}] -> ${session.nextAction}`);
        });
    }

    if (rollup.attentionQueue.length > 0) {
        lines.push('');
        lines.push('Attention queue:');
        rollup.attentionQueue.forEach((session) => {
            lines.push(`- ${getAgentSessionDisplayTitle(session)}: ${session.blockedBy || session.nextAction}`);
        });
    }

    return lines.join('\n');
}
