import type {
    Team,
    TeamMember,
    TeamRole,
    WorkspaceAccessLevel,
    WorkspaceAccessOverrides,
} from './masterScheduleTypes';

export type DeveloperSupportMode = 'inspect' | 'edit';

export interface DeveloperPreviewInput {
    team: Team;
    mode: DeveloperSupportMode;
    accessLevel: WorkspaceAccessLevel;
    workspaceOverrides?: WorkspaceAccessOverrides;
    role?: TeamRole;
    displayName: string;
    email?: string;
    sourceLabel: string;
    userId?: string;
    /** Required for edit sessions and recorded in the support-session document. */
    reason?: string;
    /** Defaults to 30 minutes and is capped at 60 minutes. */
    durationMinutes?: number;
}

export interface DeveloperPreviewSession {
    team: Team;
    teamMember: TeamMember;
    mode: DeveloperSupportMode;
    sourceLabel: string;
    reason: string;
    startedAt: string;
    expiresAt: string;
    readOnly: boolean;
}

export interface DeveloperPreviewTiming {
    startedAt: Date;
    expiresAt: Date;
}

/**
 * Builds the effective client identity for a time-limited support session.
 * Inspect mode mirrors the selected profile but is always read-only. Edit mode
 * uses an internal owner-like identity; backend rules remain authoritative.
 */
export function createDeveloperPreviewSession(
    input: DeveloperPreviewInput,
    timing: DeveloperPreviewTiming,
): DeveloperPreviewSession {
    const isEdit = input.mode === 'edit';
    const requestedReason = input.reason?.trim() || '';
    if (isEdit && !requestedReason) {
        throw new Error('A reason is required for developer edit access.');
    }
    const reason = requestedReason || 'Team inspection';

    return {
        team: input.team,
        mode: input.mode,
        sourceLabel: input.sourceLabel,
        reason,
        startedAt: timing.startedAt.toISOString(),
        expiresAt: timing.expiresAt.toISOString(),
        readOnly: !isEdit,
        teamMember: {
            id: `developer-support:${input.team.id}`,
            userId: input.userId ?? 'developer-support',
            role: isEdit ? 'owner' : (input.role ?? 'member'),
            accessLevel: isEdit ? 'internal' : input.accessLevel,
            workspaceOverrides: isEdit ? undefined : input.workspaceOverrides,
            joinedAt: new Date(timing.startedAt),
            displayName: input.displayName,
            email: input.email ?? 'developer-support@scheduler.local',
        },
    };
}
