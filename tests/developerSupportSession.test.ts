import { describe, expect, it } from 'vitest';
import {
    isDeveloperSupportSessionActive,
    normalizeDeveloperSupportDuration,
    parseDeveloperSupportSession,
} from '../utils/services/developerSupportSessionService';

const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

describe('developer support session utilities', () => {
    it('defaults to 30 minutes and caps requested access at one hour', () => {
        expect(normalizeDeveloperSupportDuration()).toBe(30);
        expect(normalizeDeveloperSupportDuration(15.2)).toBe(16);
        expect(normalizeDeveloperSupportDuration(90)).toBe(60);
        expect(() => normalizeDeveloperSupportDuration(0)).toThrow(/greater than zero/i);
    });

    it('parses a valid team-scoped edit session with its reason', () => {
        const session = parseDeveloperSupportSession('admin-1', {
            teamId: 'team-123',
            mode: 'edit',
            reason: 'Fix a customer upload',
            createdAt: timestamp('2026-07-09T12:00:00Z'),
            expiresAt: timestamp('2026-07-09T12:30:00Z'),
        });

        expect(session).toMatchObject({
            userId: 'admin-1',
            teamId: 'team-123',
            mode: 'edit',
            reason: 'Fix a customer upload',
        });
        expect(isDeveloperSupportSessionActive(
            session!,
            new Date('2026-07-09T12:15:00Z'),
        )).toBe(true);
        expect(isDeveloperSupportSessionActive(
            session!,
            new Date('2026-07-09T12:30:00Z'),
        )).toBe(false);
    });

    it('rejects edit sessions without a reason and malformed time windows', () => {
        expect(parseDeveloperSupportSession('admin-1', {
            teamId: 'team-123',
            mode: 'edit',
            createdAt: timestamp('2026-07-09T12:00:00Z'),
            expiresAt: timestamp('2026-07-09T12:30:00Z'),
        })).toBeNull();
        expect(parseDeveloperSupportSession('admin-1', {
            teamId: 'team-123',
            mode: 'inspect',
            reason: 'Team inspection',
            createdAt: timestamp('2026-07-09T12:30:00Z'),
            expiresAt: timestamp('2026-07-09T12:00:00Z'),
        })).toBeNull();
    });
});
