import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { db } from '../firebase';
import type { DeveloperSupportMode } from '../developerPreview';

export const DEFAULT_DEVELOPER_SUPPORT_DURATION_MINUTES = 30;
export const MAX_DEVELOPER_SUPPORT_DURATION_MINUTES = 60;

export interface DeveloperSupportSessionRecord {
    userId: string;
    teamId: string;
    mode: DeveloperSupportMode;
    reason: string;
    startedAt: Date;
    expiresAt: Date;
}

export interface CreateDeveloperSupportSessionInput {
    userId: string;
    teamId: string;
    mode: DeveloperSupportMode;
    reason?: string;
    durationMinutes?: number;
}

export function normalizeDeveloperSupportDuration(durationMinutes?: number): number {
    if (durationMinutes === undefined) return DEFAULT_DEVELOPER_SUPPORT_DURATION_MINUTES;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        throw new Error('Support session duration must be greater than zero.');
    }
    return Math.min(Math.ceil(durationMinutes), MAX_DEVELOPER_SUPPORT_DURATION_MINUTES);
}

export function isDeveloperSupportSessionActive(
    session: Pick<DeveloperSupportSessionRecord, 'startedAt' | 'expiresAt'>,
    now = new Date(),
): boolean {
    return session.startedAt.getTime() <= now.getTime()
        && session.expiresAt.getTime() > now.getTime();
}

function requireNonEmpty(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} is required.`);
    return normalized;
}

function toDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
        const converted = value.toDate();
        return converted instanceof Date && Number.isFinite(converted.getTime()) ? converted : null;
    }
    return null;
}

export function parseDeveloperSupportSession(
    userId: string,
    value: unknown,
): DeveloperSupportSessionRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const startedAt = toDate(data.createdAt);
    const expiresAt = toDate(data.expiresAt);
    if (
        typeof data.teamId !== 'string'
        || (data.mode !== 'inspect' && data.mode !== 'edit')
        || !startedAt
        || !expiresAt
        || expiresAt.getTime() <= startedAt.getTime()
    ) {
        return null;
    }

    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (!reason || reason.length > 500) return null;

    return {
        userId,
        teamId: data.teamId,
        mode: data.mode,
        reason,
        startedAt,
        expiresAt,
    };
}

export async function createDeveloperSupportSession(
    input: CreateDeveloperSupportSessionInput,
): Promise<DeveloperSupportSessionRecord> {
    const userId = requireNonEmpty(input.userId, 'User ID');
    const teamId = requireNonEmpty(input.teamId, 'Team ID');
    if (input.mode !== 'inspect' && input.mode !== 'edit') {
        throw new Error('Invalid developer support mode.');
    }
    const requestedReason = input.reason?.trim() || '';
    if (input.mode === 'edit' && !requestedReason) {
        throw new Error('A reason is required for developer edit access.');
    }
    const reason = requestedReason || 'Team inspection';
    if (reason.length > 500) throw new Error('Support session reason must be 500 characters or fewer.');

    const durationMinutes = normalizeDeveloperSupportDuration(input.durationMinutes);
    const callable = httpsCallable(getFunctions(app), 'developerSupportAccess');
    const response = await callable({
        action: 'start',
        userId,
        teamId,
        mode: input.mode,
        reason,
        durationMinutes,
    });
    const data = response.data as Record<string, unknown>;
    const session = parseDeveloperSupportSession(userId, {
        teamId: data.teamId,
        mode: data.mode,
        reason: data.reason,
        createdAt: typeof data.startedAt === 'string' ? new Date(data.startedAt) : null,
        expiresAt: typeof data.expiresAt === 'string' ? new Date(data.expiresAt) : null,
    });
    if (!session) throw new Error('Developer support service returned an invalid session.');
    return session;
}

export async function getActiveDeveloperSupportSession(
    userId: string,
    now = new Date(),
): Promise<DeveloperSupportSessionRecord | null> {
    const normalizedUserId = requireNonEmpty(userId, 'User ID');
    const sessionRef = doc(db, 'developerSupportSessions', normalizedUserId);
    const snapshot = await getDoc(sessionRef);
    if (!snapshot.exists()) return null;

    const session = parseDeveloperSupportSession(normalizedUserId, snapshot.data());
    if (!session) {
        await deleteDeveloperSupportSession(normalizedUserId);
        return null;
    }
    if (!isDeveloperSupportSessionActive(session, now)) {
        await deleteDeveloperSupportSession(normalizedUserId);
        return null;
    }
    return session;
}

export async function deleteDeveloperSupportSession(userId: string): Promise<void> {
    const normalizedUserId = requireNonEmpty(userId, 'User ID');
    const callable = httpsCallable(getFunctions(app), 'developerSupportAccess');
    await callable({ action: 'stop', userId: normalizedUserId });
}
