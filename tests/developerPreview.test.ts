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

describe('developer preview', () => {
    it('builds a synthetic team member without changing the source team', () => {
        const preview = createDeveloperPreviewSession({
            team,
            accessLevel: 'transit-app-only',
            workspaceOverrides: { workspaceOperations: true },
            displayName: 'WATT invite user',
            sourceLabel: 'Team default',
        });

        expect(preview.team).toBe(team);
        expect(preview.teamMember.id).toBe('developer-preview:team-123');
        expect(preview.teamMember.role).toBe('member');
        expect(preview.teamMember.accessLevel).toBe('transit-app-only');
        expect(preview.teamMember.workspaceOverrides).toEqual({ workspaceOperations: true });
        expect(preview.sourceLabel).toBe('Team default');
    });

    it('can mimic a selected user role and identity', () => {
        const preview = createDeveloperPreviewSession({
            team,
            accessLevel: 'internal',
            role: 'admin',
            displayName: 'Mike',
            email: 'mike@example.com',
            sourceLabel: 'Selected user',
            userId: 'real-user-id',
        });

        expect(preview.teamMember.userId).toBe('real-user-id');
        expect(preview.teamMember.role).toBe('admin');
        expect(preview.teamMember.displayName).toBe('Mike');
        expect(preview.teamMember.email).toBe('mike@example.com');
    });
});
