import { describe, expect, it } from 'vitest';
import {
    AGENT_SESSION_CRITICAL_STALE_HOURS,
    AGENT_SESSION_STALE_HOURS,
    AgentSession,
    buildAgentSessionRollupText,
    filterAgentSessions,
    getAgentSessionAgeHours,
    getAgentSessionDisplayTitle,
    getAgentSessionPromptPreview,
    getAgentSessionRollup,
    isAgentSessionCriticallyStale,
    isAgentSessionStale,
    normalizeAgentSession,
    sortAgentSessions,
} from '../utils/agentSessions';

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
        id: 'session-1',
        title: 'Build dashboard',
        purpose: 'Track active agent work',
        currentTask: 'Implement session registry UI',
        lastPrompt: 'Show the latest prompt directly in the session list',
        status: 'active',
        priority: 'medium',
        lastUpdatedAt: '2026-03-06T12:00:00.000Z',
        lastSummary: 'Initial implementation in progress',
        nextAction: 'Finish filters',
        blockedBy: '',
        chatReference: 'chat://session-1',
        createdAt: '2026-03-06T11:30:00.000Z',
        ...overrides,
    };
}

describe('agentSessions staleness helpers', () => {
    it('marks sessions stale after 24 hours and critical after 48 hours', () => {
        // Arrange
        const now = Date.parse('2026-03-08T12:00:00.000Z');
        const warningSession = createSession({
            lastUpdatedAt: '2026-03-07T11:00:00.000Z',
        });
        const criticalSession = createSession({
            id: 'session-2',
            lastUpdatedAt: '2026-03-06T11:00:00.000Z',
        });

        // Act
        const warningAgeHours = getAgentSessionAgeHours(warningSession, now);
        const warningStale = isAgentSessionStale(warningSession, now);
        const warningCritical = isAgentSessionCriticallyStale(warningSession, now);
        const criticalStale = isAgentSessionStale(criticalSession, now);
        const critical = isAgentSessionCriticallyStale(criticalSession, now);

        // Assert
        expect(warningAgeHours).toBeGreaterThanOrEqual(AGENT_SESSION_STALE_HOURS);
        expect(warningStale).toBe(true);
        expect(warningCritical).toBe(false);
        expect(criticalStale).toBe(true);
        expect(critical).toBe(true);
        expect(AGENT_SESSION_CRITICAL_STALE_HOURS).toBeGreaterThan(AGENT_SESSION_STALE_HOURS);
    });
});

describe('agentSessions filtering and sorting', () => {
    it('filters stale sessions and matches free-text query fields', () => {
        // Arrange
        const now = Date.parse('2026-03-08T12:00:00.000Z');
        const sessions = [
            createSession({
                id: 'active-1',
                title: 'Draft export flow',
                lastPrompt: 'Review the new export flow for edge cases',
                nextAction: 'Wait for user review',
                lastUpdatedAt: '2026-03-08T09:00:00.000Z',
            }),
            createSession({
                id: 'blocked-1',
                status: 'blocked',
                lastPrompt: 'Need a Firestore plan before syncing these sessions',
                blockedBy: 'Need Firestore schema decision',
                lastUpdatedAt: '2026-03-07T08:00:00.000Z',
            }),
            createSession({
                id: 'done-1',
                status: 'done',
                lastUpdatedAt: '2026-03-05T08:00:00.000Z',
            }),
        ];

        // Act
        const staleSessions = filterAgentSessions(sessions, 'stale', '', now);
        const blockerSearch = filterAgentSessions(sessions, 'all', 'firestore', now);

        // Assert
        expect(staleSessions.map((session) => session.id)).toEqual(['blocked-1']);
        expect(blockerSearch.map((session) => session.id)).toEqual(['blocked-1']);
    });

    it('derives an automatic title and prompt preview when manual title is blank', () => {
        // Arrange
        const session = createSession({
            title: '',
            lastPrompt: 'Can you compare every active chat and show the latest prompt directly in the dashboard list?',
        });

        // Act
        const displayTitle = getAgentSessionDisplayTitle(session);
        const promptPreview = getAgentSessionPromptPreview(session);

        // Assert
        expect(displayTitle).toBe('compare every active chat and show the latest prompt…');
        expect(promptPreview).toContain('latest prompt directly in the dashboard list');
    });

    it('sorts critically stale and blocked sessions ahead of lower-priority work', () => {
        // Arrange
        const now = Date.parse('2026-03-08T12:00:00.000Z');
        const sessions = [
            createSession({
                id: 'active-1',
                status: 'active',
                priority: 'high',
                lastUpdatedAt: '2026-03-08T10:00:00.000Z',
            }),
            createSession({
                id: 'review-1',
                status: 'review',
                priority: 'critical',
                lastUpdatedAt: '2026-03-07T10:00:00.000Z',
            }),
            createSession({
                id: 'blocked-1',
                status: 'blocked',
                priority: 'medium',
                lastUpdatedAt: '2026-03-06T08:00:00.000Z',
            }),
            createSession({
                id: 'done-1',
                status: 'done',
                priority: 'critical',
                lastUpdatedAt: '2026-03-08T11:00:00.000Z',
            }),
        ];

        // Act
        const orderedIds = sortAgentSessions(sessions, now).map((session) => session.id);

        // Assert
        expect(orderedIds).toEqual(['blocked-1', 'review-1', 'active-1', 'done-1']);
    });
});

describe('agentSessions normalization', () => {
    it('normalizes persisted session records and defaults invalid enums', () => {
        // Arrange
        const rawSession = {
            id: 'session-42',
            title: '  Cleanup stale sessions  ',
            purpose: '  Keep the dashboard current  ',
            currentTask: '  Touch old threads  ',
            lastPrompt: '  Show the latest prompt in the session list  ',
            status: 'unknown',
            priority: 'urgent',
            lastUpdatedAt: '2026-03-06T14:00:00.000Z',
        };

        // Act
        const normalized = normalizeAgentSession(rawSession);

        // Assert
        expect(normalized).toEqual({
            id: 'session-42',
            title: 'Cleanup stale sessions',
            purpose: 'Keep the dashboard current',
            currentTask: 'Touch old threads',
            lastPrompt: 'Show the latest prompt in the session list',
            status: 'active',
            priority: 'medium',
            lastUpdatedAt: '2026-03-06T14:00:00.000Z',
            lastSummary: '',
            nextAction: '',
            blockedBy: '',
            chatReference: '',
            createdAt: '2026-03-06T14:00:00.000Z',
        });
    });
});

describe('agentSessions rollup', () => {
    it('builds a daily rollup with focus and attention queues', () => {
        // Arrange
        const now = Date.parse('2026-03-08T12:00:00.000Z');
        const sessions = [
            createSession({
                id: 'blocked-1',
                title: '',
                lastPrompt: 'Fix sync issue before the session dashboard loses cloud updates',
                status: 'blocked',
                priority: 'critical',
                blockedBy: 'Waiting on auth token test',
                nextAction: 'Validate auth state and retry',
                lastUpdatedAt: '2026-03-06T08:00:00.000Z',
            }),
            createSession({
                id: 'review-1',
                title: 'Confirm dashboard copy',
                status: 'review',
                priority: 'high',
                nextAction: 'User needs to confirm wording',
                lastUpdatedAt: '2026-03-07T09:00:00.000Z',
            }),
            createSession({
                id: 'active-1',
                title: 'Add sync status badge',
                status: 'active',
                priority: 'medium',
                nextAction: 'Polish the workspace header',
                lastUpdatedAt: '2026-03-08T10:00:00.000Z',
            }),
        ];

        // Act
        const rollup = getAgentSessionRollup(sessions, now);
        const text = buildAgentSessionRollupText(sessions, now);

        // Assert
        expect(rollup.blocked).toBe(1);
        expect(rollup.needsInput).toBe(1);
        expect(rollup.stale).toBe(2);
        expect(rollup.priorityFocus.map((session) => session.id)).toEqual(['blocked-1', 'review-1', 'active-1']);
        expect(rollup.attentionQueue.map((session) => session.id)).toEqual(['blocked-1', 'review-1']);
        expect(text).toContain('Top focus:');
        expect(text).toContain('Fix sync issue before the session dashboard loses… [blocked] -> Validate auth state and retry');
        expect(text).toContain('Attention queue:');
        expect(text).toContain('Confirm dashboard copy: User needs to confirm wording');
    });
});
