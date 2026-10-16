import type { TeamMember, TeamWithMembers } from './masterScheduleTypes';
import {
    WORKSPACE_ACCESS_FEATURES,
    getAllowedWorkspaceFeatures,
    getMemberWorkspaceGrant,
    getTeamDefaultWorkspaceGrant,
    haveSameWorkspaceAccess,
    type WorkspaceAccessFeatureKey,
    type WorkspaceAccessGrant,
    type WorkspaceAccessLevel,
} from './workspaceAccess';
import { findWorkspaceAccessPackage } from './workspaceAccessPackages';

/** Why a workspace is or is not open for a grant. */
export type WorkspaceCellSource = 'level' | 'added' | 'removed' | 'none';

export interface WorkspaceAccessDescription {
    accessLevel: WorkspaceAccessLevel;
    cells: Record<WorkspaceAccessFeatureKey, WorkspaceCellSource>;
    /** Label of the named package with the same access, or null for a custom combination. */
    packageLabel: string | null;
}

export interface MemberAccessRow extends WorkspaceAccessDescription {
    member: TeamMember;
    /** True when the member's access differs from the team package. */
    isException: boolean;
}

export interface TeamAccessRow extends WorkspaceAccessDescription {
    team: TeamWithMembers;
    members: MemberAccessRow[];
}

export type AccessFindingSeverity = 'act' | 'review' | 'note';

export interface AccessFinding {
    id: string;
    severity: AccessFindingSeverity;
    title: string;
    detail: string;
    action: string;
}

export interface TeamAccessOverview {
    teams: TeamAccessRow[];
    findings: AccessFinding[];
}

const SEVERITY_ORDER: Record<AccessFindingSeverity, number> = { act: 0, review: 1, note: 2 };
const TEST_EMAIL_PATTERN = /@example\.(com|org|net)$/i;

const memberName = (member: TeamMember): string => member.displayName || member.email || member.userId;

export function describeWorkspaceAccess(grant: WorkspaceAccessGrant): WorkspaceAccessDescription {
    const base = new Set(getAllowedWorkspaceFeatures(grant.accessLevel));
    const allowed = new Set(getAllowedWorkspaceFeatures(grant.accessLevel, grant.workspaceOverrides));
    const cells = {} as Record<WorkspaceAccessFeatureKey, WorkspaceCellSource>;
    for (const feature of WORKSPACE_ACCESS_FEATURES) {
        if (allowed.has(feature)) cells[feature] = base.has(feature) ? 'level' : 'added';
        else cells[feature] = base.has(feature) ? 'removed' : 'none';
    }
    return {
        accessLevel: grant.accessLevel,
        cells,
        packageLabel: findWorkspaceAccessPackage(grant)?.label ?? null,
    };
}

const listNames = (names: string[]): string => names.length <= 4
    ? names.join(', ')
    : `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`;

/**
 * Builds the scheduler-admin overview: every team and member against every
 * assignable workspace, plus findings that usually need a decision.
 */
export function buildTeamAccessOverview(teams: TeamWithMembers[]): TeamAccessOverview {
    const rows: TeamAccessRow[] = teams.map(team => {
        const teamGrant = getTeamDefaultWorkspaceGrant(team);
        return {
            ...describeWorkspaceAccess(teamGrant),
            team,
            members: team.members.map(member => {
                const grant = getMemberWorkspaceGrant(member);
                return {
                    ...describeWorkspaceAccess(grant),
                    member,
                    isException: !haveSameWorkspaceAccess(grant, teamGrant),
                };
            }),
        };
    });

    const findings: AccessFinding[] = [];
    const internalMembers = rows.flatMap(row => row.members
        .filter(member => member.accessLevel === 'internal' &&
            !Object.values(member.member.workspaceOverrides ?? {}).includes(false))
        .map(member => ({ row, member })));

    const testAccounts = internalMembers.filter(({ member }) => TEST_EMAIL_PATTERN.test(member.member.email ?? ''));
    if (testAccounts.length > 0) {
        findings.push({
            id: 'internal-test-accounts',
            severity: 'act',
            title: `${testAccounts.length} test account${testAccounts.length === 1 ? ' has' : 's have'} full access`,
            detail: listNames(testAccounts.map(({ row, member }) => `${memberName(member.member)} (${row.team.name})`)),
            action: 'Set these accounts to No access, or delete the test teams.',
        });
    }

    const otherInternal = internalMembers.filter(entry => !testAccounts.includes(entry));
    if (otherInternal.length > 0) {
        findings.push({
            id: 'internal-members',
            severity: 'note',
            title: `${otherInternal.length} ${otherInternal.length === 1 ? 'person has' : 'people have'} full (developer) access`,
            detail: listNames(otherInternal.map(({ row, member }) => `${memberName(member.member)} (${row.team.name})`)),
            action: 'Confirm each person should see unfinished workspaces.',
        });
    }

    for (const row of rows) {
        const { team } = row;
        const byEmail = new Map<string, TeamMember[]>();
        for (const { member } of row.members) {
            const email = member.email?.trim().toLowerCase();
            if (!email) continue;
            byEmail.set(email, [...(byEmail.get(email) ?? []), member]);
        }
        for (const [email, duplicates] of byEmail) {
            if (duplicates.length < 2) continue;
            findings.push({
                id: `duplicate:${team.id}:${email}`,
                severity: 'review',
                title: `${memberName(duplicates[0])} is on ${team.name} ${duplicates.length} times`,
                detail: `${duplicates.length} member records share ${email}. The person probably signed in two different ways.`,
                action: 'Ask which sign-in they use and remove the other record.',
            });
        }

        if (row.members.length > 0 && row.members.every(member => member.isException)) {
            findings.push({
                id: `package-unused:${team.id}`,
                severity: 'review',
                title: `No ${team.name} member uses the team package`,
                detail: `The package is ${row.packageLabel ?? 'a custom combination'}, so every member is an exception. New members who join with the invite get the package.`,
                action: 'Change the team package to the access most members should have.',
            });
        }

        if (!row.packageLabel) {
            findings.push({
                id: `package-custom:${team.id}`,
                severity: 'review',
                title: `${team.name} uses a combination no package describes`,
                detail: 'The team package was built from an access level plus workspace overrides that match no named package.',
                action: 'Confirm this access is intended, or apply a named package.',
            });
        }
    }

    const emptyTeams = rows.filter(row => row.members.length === 0).map(row => row.team.name);
    if (emptyTeams.length > 0) {
        findings.push({
            id: 'empty-teams',
            severity: 'note',
            title: `${emptyTeams.length} team${emptyTeams.length === 1 ? ' has' : 's have'} no members`,
            detail: listNames(emptyTeams),
            action: 'Delete teams that are no longer needed.',
        });
    }

    findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { teams: rows, findings };
}
