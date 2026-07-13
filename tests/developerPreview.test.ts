import { describe, expect, it } from 'vitest';
import { createDeveloperPreviewSession } from '../utils/developerPreview';
import type { Team } from '../utils/masterScheduleTypes';

const team: Team = {
    id: 'team-123',
    name: 'WATT',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'admin-user',
    inviteCode: 'WATT26',
    defaultMemberAccessLevel: 'transit-app-only',
};

const timing = {
    startedAt: new Date('2026-07-09T12:00:00Z'),
    expiresAt: new Date('2026-07-09T12:30:00Z'),
};

describe('developer preview', () => {
    it('builds a read-only inspection identity without changing the source team', () => {
        const preview = createDeveloperPreviewSession({
            team,
            mode: 'inspect',
            accessLevel: 'transit-app-only',
            workspaceOverrides: { workspaceOperations: true },
            displayName: 'WATT invite user',
            sourceLabel: 'Team default',
        }, timing);

        expect(preview.team).toBe(team);
        expect(preview.mode).toBe('inspect');
        expect(preview.readOnly).toBe(true);
        expect(preview.reason).toBe('Team inspection');
        expect(preview.teamMember.id).toBe('developer-support:team-123');
        expect(preview.teamMember.role).toBe('member');
        expect(preview.teamMember.accessLevel).toBe('transit-app-only');
        expect(preview.teamMember.workspaceOverrides).toEqual({ workspaceOperations: true });
        expect(preview.expiresAt).toBe('2026-07-09T12:30:00.000Z');
    });

    it('uses internal owner-like UI access for an explicit edit session', () => {
        const preview = createDeveloperPreviewSession({
            team,
            mode: 'edit',
            accessLevel: 'transit-app-only',
            role: 'member',
            displayName: 'Mike',
            email: 'mike@example.com',
            sourceLabel: 'Developer edit',
            userId: 'real-user-id',
            reason: ' Investigate an upload issue ',
        }, timing);

        expect(preview.readOnly).toBe(false);
        expect(preview.teamMember.userId).toBe('real-user-id');
        expect(preview.teamMember.role).toBe('owner');
        expect(preview.teamMember.accessLevel).toBe('internal');
        expect(preview.reason).toBe('Investigate an upload issue');
    });
});
