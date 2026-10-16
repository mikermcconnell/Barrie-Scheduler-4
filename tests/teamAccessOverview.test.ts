import { describe, expect, it } from 'vitest';
import type { TeamMember, TeamWithMembers } from '../utils/masterScheduleTypes';
import { buildTeamAccessOverview, describeWorkspaceAccess } from '../utils/teamAccessOverview';

const member = (id: string, accessLevel: TeamMember['accessLevel'], extra: Partial<TeamMember> = {}): TeamMember => ({
    id,
    userId: id,
    role: 'member',
    accessLevel,
    joinedAt: new Date(0),
    displayName: id,
    email: `${id}@barrie.ca`,
    ...extra,
});

const team = (id: string, members: TeamMember[], extra: Partial<TeamWithMembers> = {}): TeamWithMembers => ({
    id,
    name: id,
    createdAt: new Date(0),
    createdBy: 'owner',
    inviteCode: id.toUpperCase(),
    defaultMemberAccessLevel: 'planner',
    members,
    memberCount: members.length,
    ...extra,
});

describe('describeWorkspaceAccess', () => {
    it('separates access from the level, added overrides, and removed overrides', () => {
        const access = describeWorkspaceAccess({
            accessLevel: 'transit-app-only',
            workspaceOverrides: { workspaceOperations: true, analyticsTransitApp: false },
        });

        expect(access.cells.workspaceOperations).toBe('added');
        expect(access.cells.analyticsTransitApp).toBe('removed');
        expect(access.cells.workspaceFixedRoute).toBe('none');
        expect(access.packageLabel).toBe('Operations dashboards');
    });

    it('names the matching package and reports custom combinations as null', () => {
        expect(describeWorkspaceAccess({ accessLevel: 'planner' }).packageLabel).toBe('Barrie planner');
        expect(describeWorkspaceAccess({
            accessLevel: 'transit-app-only',
            workspaceOverrides: { workspaceOperations: true, workspaceFixedRoute: true },
        }).packageLabel).toBeNull();
    });
});

describe('buildTeamAccessOverview', () => {
    it('marks members whose access differs from the team package as exceptions', () => {
        const { teams } = buildTeamAccessOverview([
            team('barrie', [member('analyst', 'planner'), member('clerk', 'parking')]),
        ]);

        expect(teams[0].members.map(row => row.isException)).toEqual([false, true]);
    });

    it('flags test accounts with full access before other findings', () => {
        const { findings } = buildTeamAccessOverview([
            team('preview', [member('lane03', 'internal', { role: 'owner', email: 'lane03@example.com' })]),
            team('barrie', [member('mike', 'internal')], { defaultMemberAccessLevel: 'internal' }),
        ]);

        expect(findings[0]).toMatchObject({ id: 'internal-test-accounts', severity: 'act' });
        expect(findings[0].detail).toContain('lane03 (preview)');
        expect(findings.find(finding => finding.id === 'internal-members')?.detail).toBe('mike (barrie)');
    });

    it('flags duplicate member emails, unused team packages, custom packages, and empty teams', () => {
        const { findings } = buildTeamAccessOverview([
            team('barrie', [
                member('jason-a', 'planner', { email: 'jason@barrie.ca' }),
                member('jason-b', 'planner', { email: 'Jason@barrie.ca' }),
            ], { defaultMemberAccessLevel: 'production' }),
            team('watt', [], {
                defaultMemberAccessLevel: 'transit-app-only',
                defaultMemberWorkspaceOverrides: { workspaceOperations: true, workspaceFixedRoute: true },
            }),
        ]);
        const ids = findings.map(finding => finding.id);

        expect(ids).toContain('duplicate:barrie:jason@barrie.ca');
        expect(ids).toContain('package-unused:barrie');
        expect(ids).toContain('package-custom:watt');
        expect(ids).toContain('empty-teams');
        expect(ids).not.toContain('package-unused:watt');
    });

    it('reports nothing for a team whose members all follow a named package', () => {
        const { findings } = buildTeamAccessOverview([
            team('parking', [member('clerk', 'parking')], { defaultMemberAccessLevel: 'parking' }),
        ]);

        expect(findings).toEqual([]);
    });
});
