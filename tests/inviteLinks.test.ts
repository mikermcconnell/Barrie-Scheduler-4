import { describe, expect, it } from 'vitest';
import {
    buildInviteLink,
    clearInviteCodeFromUrlParts,
    extractInviteCodeFromUrlParts,
    normalizeInviteCode,
} from '../utils/inviteLinks';

describe('invite links', () => {
    it('normalizes valid invite codes', () => {
        expect(normalizeInviteCode(' lane01 ')).toBe('LANE01');
        expect(normalizeInviteCode('abc-123')).toBeNull();
        expect(normalizeInviteCode('TOOLONG')).toBeNull();
    });

    it('extracts invite codes from normal query links', () => {
        expect(extractInviteCodeFromUrlParts('?invite=lane01', '')).toBe('LANE01');
        expect(extractInviteCodeFromUrlParts('?team=onland', '')).toBe('ONLAND');
    });

    it('extracts invite codes from hash join links', () => {
        expect(extractInviteCodeFromUrlParts('', '#/join/lane01')).toBe('LANE01');
        expect(extractInviteCodeFromUrlParts('', '#join?invite=onland')).toBe('ONLAND');
    });

    it('builds a copyable invite link from the current origin', () => {
        expect(buildInviteLink('https://scheduler.example.com/app', 'lane01')).toBe(
            'https://scheduler.example.com/app?invite=LANE01'
        );
    });

    it('can remove invite parameters after a successful join', () => {
        expect(clearInviteCodeFromUrlParts('/app', '?invite=LANE01&x=1', '#fixed')).toEqual({
            pathname: '/app',
            search: '?x=1',
            hash: '#fixed',
        });
        expect(clearInviteCodeFromUrlParts('/app', '', '#/join/LANE01')).toEqual({
            pathname: '/app',
            search: '',
            hash: '',
        });
    });
});
