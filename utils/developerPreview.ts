import type {
    Team,
    TeamMember,
    TeamRole,
    WorkspaceAccessLevel,
    WorkspaceAccessOverrides,
} from './masterScheduleTypes';

export interface DeveloperPreviewInput {
    team: Team;
    accessLevel: WorkspaceAccessLevel;
    workspaceOverrides?: WorkspaceAccessOverrides;
    role?: TeamRole;
    displayName: string;
    email?: string;
    sourceLabel: string;
    userId?: string;
    readOnly?: boolean;
}

export interface DeveloperPreviewSession {
    team: Team;
    teamMember: TeamMember;
    sourceLabel: string;
    startedAt: string;
    readOnly: boolean;
}

export function createDeveloperPreviewSession(input: DeveloperPreviewInput): DeveloperPreviewSession {
    const now = new Date().toISOString();

    return {
        team: input.team,
        sourceLabel: input.sourceLabel,
        startedAt: now,
        readOnly: input.readOnly ?? true,
        teamMember: {
            id: `developer-preview:${input.team.id}`,
            userId: input.userId ?? 'developer-preview',
            role: input.role ?? 'member',
            accessLevel: input.accessLevel,
            workspaceOverrides: input.workspaceOverrides,
            joinedAt: new Date(now),
            displayName: input.displayName,
            email: input.email ?? 'developer-preview@scheduler.local',
        },
    };
}
