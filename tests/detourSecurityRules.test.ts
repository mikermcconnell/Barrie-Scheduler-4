import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('detour notice security rules', () => {
    it('scopes notices and both subcollections to Fixed Route team access', () => {
        const rules = readFileSync('firestore.rules', 'utf8');
        const block = rules.match(/match \/detourNotices\/\{noticeId\} \{([\s\S]*?)\/\/ Platform configuration/)?.[1] ?? '';
        expect(block).toContain("canAccessWorkspace(teamId, 'workspaceFixedRoute')");
        expect(block).toMatch(/match \/overlays\/\{overlayId\}/);
        expect(block).toMatch(/match \/publications\/\{publicationId\}/);
        expect(block).toContain('isValidDetourNoticeCreate(teamId)');
        expect(block).toContain('isValidDetourNoticeUpdate(teamId)');
        expect(block).toContain('isValidDetourPublicationCreate(teamId, noticeId)');
        expect(block).toContain('allow update: if false;');
        expect(block).not.toMatch(/isTeamMember\([^)]*\)\s*;/);
        expect(rules).toMatch(/function canAccessWorkspace\(teamId, feature\) \{[\s\S]*isTeamMember\(teamId\)/);
        expect(rules).toMatch(/data\.revision == resource\.data\.revision \+ 1/);
    });
});
