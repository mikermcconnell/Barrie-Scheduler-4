import type { Team } from '../masterScheduleTypes';
import type { FeatureFlags } from '../features';
import { featureFlags, isFeatureEnabled } from '../features';
import type { WorkspaceAccessLevel } from '../workspaceAccess';

interface DetourPublisherAccessInput {
    team: Pick<Team, 'inviteCode'> | null | undefined;
    accessLevel: WorkspaceAccessLevel;
    isGlobalAdmin: boolean;
    flags?: FeatureFlags;
}

const BARRIE_TEAM_INVITE_CODE = 'BARRIE';

/** Keeps the Barrie-specific publisher out of partner workspaces while retaining support access. */
export function canAccessDetourPublisher({
    team,
    accessLevel,
    isGlobalAdmin,
    flags = featureFlags,
}: DetourPublisherAccessInput): boolean {
    if (!isFeatureEnabled('fixedDetours', flags)) return false;

    const isBarrieTeam = team?.inviteCode?.trim().toUpperCase() === BARRIE_TEAM_INVITE_CODE;
    return isBarrieTeam || isGlobalAdmin || accessLevel === 'internal' || accessLevel === 'admin';
}
