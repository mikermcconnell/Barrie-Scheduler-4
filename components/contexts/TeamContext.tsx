/**
 * Team Context
 *
 * Provides team state and operations throughout the application.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
    getUserTeam,
    getUserTeams,
    getTeamsForPermissionManagement,
    joinTeamByInviteCode,
    getTeamMember,
    getTeamWithMembers,
    switchUserTeam,
} from '../../utils/services/teamService';
import type { Team, TeamMember, TeamRole, WorkspaceAccessLevel, WorkspaceAccessOverrides } from '../../utils/masterScheduleTypes';
import { getTeamDefaultWorkspaceGrant, isWorkspaceAccessLevel, resolveWorkspaceAccessLevel } from '../../utils/workspaceAccess';
import { getDevAuthConfig } from '../../utils/dev/devAuth';
import { clearPendingInviteCodeFromUrl, getPendingInviteCode } from '../../utils/inviteLinks';
import {
    createDeveloperPreviewSession,
    resolveGlobalAdminHomeTeamMember,
    type DeveloperPreviewInput,
    type DeveloperPreviewSession,
} from '../../utils/developerPreview';
import {
    createDeveloperSupportSession,
    deleteDeveloperSupportSession,
    getActiveDeveloperSupportSession,
} from '../../utils/services/developerSupportSessionService';

export interface ViewAsMember {
    teamId: string;
    userId: string;
    displayName: string;
    accessLevel: WorkspaceAccessLevel;
    workspaceOverrides?: WorkspaceAccessOverrides;
}

interface TeamContextType {
    team: Team | null;
    teamMember: TeamMember | null;
    teamRole: TeamRole | null;
    accessLevel: WorkspaceAccessLevel;
    canManageTeam: boolean;
    canUseViewAs: boolean;
    viewAsAccessLevel: WorkspaceAccessLevel | null;
    setViewAsAccessLevel: (level: WorkspaceAccessLevel | null) => void;
    viewAsMember: ViewAsMember | null;
    setViewAsMember: (member: TeamMember | null) => void;
    viewAsCandidates: TeamMember[];
    loading: boolean;
    refreshTeam: () => Promise<void>;
    hasTeam: boolean;
    isDeveloperPreview: boolean;
    developerPreview: DeveloperPreviewSession | null;
    actualTeam: Team | null;
    availableTeams: Team[];
    switchTeam: (teamId: string) => Promise<void>;
    startDeveloperPreview: (input: DeveloperPreviewInput) => Promise<DeveloperPreviewSession>;
    stopDeveloperPreview: () => Promise<void>;
}

const fallbackTeamContext: TeamContextType = {
    team: null,
    teamMember: null,
    teamRole: null,
    accessLevel: 'none',
    canManageTeam: false,
    loading: false,
    refreshTeam: async () => { },
    hasTeam: false,
    canUseViewAs: false,
    viewAsAccessLevel: null,
    setViewAsAccessLevel: () => { },
    viewAsMember: null,
    setViewAsMember: () => { },
    viewAsCandidates: [],
    isDeveloperPreview: false,
    developerPreview: null,
    actualTeam: null,
    availableTeams: [],
    switchTeam: async () => { throw new Error('Team context is unavailable.'); },
    startDeveloperPreview: async () => { throw new Error('Team context is unavailable.'); },
    stopDeveloperPreview: async () => { },
};

const VIEW_AS_STORAGE_KEY = 'scheduler.viewAsAccessLevel';
const VIEW_AS_MEMBER_STORAGE_KEY = 'scheduler.viewAsMember';

function readStoredViewAsMember(): ViewAsMember | null {
    try {
        const stored = JSON.parse(window.sessionStorage.getItem(VIEW_AS_MEMBER_STORAGE_KEY) ?? 'null') as Partial<ViewAsMember> | null;
        if (!stored || typeof stored.teamId !== 'string' || typeof stored.userId !== 'string') return null;
        if (!isWorkspaceAccessLevel(stored.accessLevel)) return null;
        return {
            teamId: stored.teamId,
            userId: stored.userId,
            displayName: typeof stored.displayName === 'string' ? stored.displayName : stored.userId,
            accessLevel: stored.accessLevel,
            workspaceOverrides: stored.workspaceOverrides,
        };
    } catch {
        return null;
    }
}

function writeSessionValue(key: string, value: string | null): void {
    try {
        if (value) window.sessionStorage.setItem(key, value);
        else window.sessionStorage.removeItem(key);
    } catch {
        // sessionStorage unavailable; the override just won't persist across reloads.
    }
}

const TeamContext = createContext<TeamContextType>(fallbackTeamContext);

export const useTeam = (): TeamContextType => {
    return useContext(TeamContext);
};

interface TeamProviderProps {
    children: ReactNode;
}

export const TeamProvider: React.FC<TeamProviderProps> = ({ children }) => {
    const { user, isGlobalAdmin } = useAuth();
    const [actualTeam, setActualTeam] = useState<Team | null>(null);
    const [actualTeamMember, setActualTeamMember] = useState<TeamMember | null>(null);
    const [actualTeamRole, setActualTeamRole] = useState<TeamRole | null>(null);
    const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
    const [developerPreview, setDeveloperPreview] = useState<DeveloperPreviewSession | null>(null);
    const [viewAsAccessLevel, setViewAsAccessLevelState] = useState<WorkspaceAccessLevel | null>(() => {
        try {
            const stored = window.sessionStorage.getItem(VIEW_AS_STORAGE_KEY);
            return isWorkspaceAccessLevel(stored) ? stored : null;
        } catch {
            return null;
        }
    });
    const [viewAsMember, setViewAsMemberState] = useState<ViewAsMember | null>(readStoredViewAsMember);
    const [viewAsCandidates, setViewAsCandidates] = useState<TeamMember[]>([]);
    const setViewAsAccessLevel = useCallback((level: WorkspaceAccessLevel | null) => {
        setViewAsAccessLevelState(level);
        writeSessionValue(VIEW_AS_STORAGE_KEY, level);
        setViewAsMemberState(null);
        writeSessionValue(VIEW_AS_MEMBER_STORAGE_KEY, null);
    }, []);
    const [loading, setLoading] = useState(true);
    const devAuth = getDevAuthConfig();

    const loadTeam = useCallback(async (showLoading = true) => {
        if (!user) {
            setActualTeam(null);
            setActualTeamMember(null);
            setActualTeamRole(null);
            setAvailableTeams([]);
            setDeveloperPreview(null);
            setLoading(false);
            return;
        }

        try {
            if (showLoading) setLoading(true);
            let userTeam = await getUserTeam(user.uid);

            const pendingInviteCode = getPendingInviteCode();
            if (pendingInviteCode) {
                try {
                    await joinTeamByInviteCode(
                        user.uid,
                        pendingInviteCode,
                        user.displayName || user.email?.split('@')[0] || 'User',
                        user.email || '',
                        { activate: !userTeam },
                    );
                    if (!userTeam) {
                        userTeam = await getUserTeam(user.uid);
                    }
                } catch (error) {
                    console.error('Error joining team from invite link:', error);
                }
                clearPendingInviteCodeFromUrl();
            }

            if (!userTeam && devAuth.enabled && devAuth.teamInviteCode) {
                await joinTeamByInviteCode(
                    user.uid,
                    devAuth.teamInviteCode,
                    user.displayName || user.email?.split('@')[0] || 'Dev User',
                    user.email || '',
                );
                userTeam = await getUserTeam(user.uid);
            }

            setActualTeam(userTeam);
            try {
                const accessibleTeams = isGlobalAdmin
                    ? await getTeamsForPermissionManagement()
                    : await getUserTeams(user.uid);
                setAvailableTeams(userTeam && !accessibleTeams.some(candidate => candidate.id === userTeam.id)
                    ? [userTeam, ...accessibleTeams]
                    : accessibleTeams);
            } catch (error) {
                // Keep a valid active team usable while a new collection-group
                // rule/index is still propagating or the enumeration is offline.
                console.error('Error loading team memberships:', error);
                setAvailableTeams(userTeam ? [userTeam] : []);
            }
            if (userTeam) {
                const member = await getTeamMember(userTeam.id, user.uid);
                setActualTeamMember(member);
                setActualTeamRole(member?.role ?? null);
            } else {
                setActualTeamMember(null);
                setActualTeamRole(null);
            }
        } catch (error) {
            console.error('Error loading team:', error);
            setActualTeam(null);
            setActualTeamMember(null);
            setActualTeamRole(null);
            setAvailableTeams([]);
            setDeveloperPreview(null);
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [devAuth.enabled, devAuth.teamInviteCode, isGlobalAdmin, user]);

    const refreshTeam = async () => {
        await loadTeam();
    };

    const stopDeveloperPreview = useCallback(async () => {
        // Revoke local effective access immediately, even if the backend delete
        // fails after a claim has been removed or the user has signed out.
        setDeveloperPreview(null);
        if (!user) return;
        try {
            await deleteDeveloperSupportSession(user.uid);
        } catch (error) {
            console.error('Unable to delete developer support session:', error);
        }
    }, [user]);

    const startDeveloperPreview = useCallback(async (input: DeveloperPreviewInput) => {
        if (!user || !isGlobalAdmin) {
            throw new Error('Developer support access requires global admin access.');
        }

        const persistedSession = await createDeveloperSupportSession({
            userId: user.uid,
            teamId: input.team.id,
            mode: input.mode,
            reason: input.reason,
            durationMinutes: input.durationMinutes,
        });
        const session = createDeveloperPreviewSession({
            ...input,
            reason: persistedSession.reason,
        }, persistedSession);
        setDeveloperPreview(session);
        return session;
    }, [isGlobalAdmin, user]);

    const switchTeam = useCallback(async (teamId: string) => {
        if (!user) {
            throw new Error('Sign in before switching teams.');
        }
        if (teamId === actualTeam?.id) {
            if (developerPreview) await stopDeveloperPreview();
            return;
        }

        if (isGlobalAdmin) {
            const membership = await getTeamMember(teamId, user.uid);
            if (!membership) {
                const selectedTeam = availableTeams.find(candidate => candidate.id === teamId);
                if (!selectedTeam) throw new Error('That team is no longer available.');
                const defaultGrant = getTeamDefaultWorkspaceGrant(selectedTeam);

                await startDeveloperPreview({
                    team: selectedTeam,
                    mode: 'inspect',
                    accessLevel: defaultGrant.accessLevel,
                    workspaceOverrides: defaultGrant.workspaceOverrides,
                    role: 'member',
                    displayName: 'Developer support',
                    email: user.email ?? undefined,
                    userId: user.uid,
                    sourceLabel: 'developer support inspection',
                    reason: 'Selected from the active team menu',
                });
                return;
            }
        }

        if (developerPreview) await stopDeveloperPreview();

        await switchUserTeam(user.uid, teamId);
        await loadTeam(false);
    }, [actualTeam?.id, availableTeams, developerPreview, isGlobalAdmin, loadTeam, startDeveloperPreview, stopDeveloperPreview, user]);

    useEffect(() => {
        void loadTeam();
    }, [loadTeam]);

    useEffect(() => {
        if (!isGlobalAdmin && developerPreview) {
            void stopDeveloperPreview();
        }
    }, [developerPreview, isGlobalAdmin, stopDeveloperPreview]);

    useEffect(() => {
        if (!user || !isGlobalAdmin || developerPreview) return;

        let cancelled = false;
        void (async () => {
            try {
                const persistedSession = await getActiveDeveloperSupportSession(user.uid);
                if (!persistedSession || cancelled) return;
                const supportTeam = await getTeamWithMembers(persistedSession.teamId);
                if (!supportTeam || cancelled) {
                    await deleteDeveloperSupportSession(user.uid);
                    return;
                }

                setDeveloperPreview(createDeveloperPreviewSession({
                    team: supportTeam,
                    mode: persistedSession.mode,
                    accessLevel: supportTeam.defaultMemberAccessLevel ?? 'none',
                    workspaceOverrides: supportTeam.defaultMemberWorkspaceOverrides,
                    role: 'member',
                    displayName: 'Developer support',
                    sourceLabel: persistedSession.mode === 'edit'
                        ? 'restored developer edit session'
                        : 'restored team inspection',
                    userId: user.uid,
                    reason: persistedSession.reason,
                }, persistedSession));
            } catch (error) {
                console.error('Unable to restore developer support session:', error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [developerPreview, isGlobalAdmin, user]);

    useEffect(() => {
        if (!developerPreview) return;
        const remainingMs = new Date(developerPreview.expiresAt).getTime() - Date.now();
        if (remainingMs <= 0) {
            void stopDeveloperPreview();
            return;
        }
        const timeout = window.setTimeout(() => {
            void stopDeveloperPreview();
        }, remainingMs);
        return () => window.clearTimeout(timeout);
    }, [developerPreview, stopDeveloperPreview]);

    const team = developerPreview?.team ?? actualTeam;
    const baseTeamMember = developerPreview?.teamMember
        ?? resolveGlobalAdminHomeTeamMember(actualTeamMember, isGlobalAdmin);
    const teamRole = baseTeamMember?.role ?? actualTeamRole;
    const canUseViewAs = isGlobalAdmin || teamRole === 'owner' || teamRole === 'admin';
    const teamId = team?.id ?? null;
    const activeViewAsMember = canUseViewAs && viewAsMember?.teamId === teamId ? viewAsMember : null;
    const activeViewAs = canUseViewAs && !activeViewAsMember ? viewAsAccessLevel : null;
    const teamMember = baseTeamMember && activeViewAsMember
        ? { ...baseTeamMember, accessLevel: activeViewAsMember.accessLevel, workspaceOverrides: activeViewAsMember.workspaceOverrides }
        : baseTeamMember && activeViewAs
            ? { ...baseTeamMember, accessLevel: activeViewAs, workspaceOverrides: undefined }
            : baseTeamMember;

    const setViewAsMember = useCallback((member: TeamMember | null) => {
        const next: ViewAsMember | null = member && teamId
            ? {
                teamId,
                userId: member.userId,
                displayName: member.displayName || member.email || member.userId,
                accessLevel: resolveWorkspaceAccessLevel(member),
                workspaceOverrides: member.workspaceOverrides,
            }
            : null;
        setViewAsMemberState(next);
        writeSessionValue(VIEW_AS_MEMBER_STORAGE_KEY, next ? JSON.stringify(next) : null);
        setViewAsAccessLevelState(null);
        writeSessionValue(VIEW_AS_STORAGE_KEY, null);
    }, [teamId]);

    useEffect(() => {
        if (!canUseViewAs || !teamId) {
            setViewAsCandidates([]);
            return;
        }
        let cancelled = false;
        getTeamWithMembers(teamId)
            .then((teamWithMembers) => {
                if (cancelled) return;
                const members = [...(teamWithMembers?.members ?? [])]
                    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
                setViewAsCandidates(members);
            })
            .catch((error) => {
                console.error('Unable to load team members for view as:', error);
                if (!cancelled) setViewAsCandidates([]);
            });
        return () => {
            cancelled = true;
        };
    }, [canUseViewAs, teamId]);

    const value: TeamContextType = {
        team,
        teamMember,
        teamRole,
        accessLevel: resolveWorkspaceAccessLevel(teamMember),
        canManageTeam: teamRole === 'owner' || teamRole === 'admin',
        canUseViewAs,
        viewAsAccessLevel: activeViewAs,
        setViewAsAccessLevel,
        viewAsMember: activeViewAsMember,
        setViewAsMember,
        viewAsCandidates,
        loading,
        refreshTeam,
        hasTeam: team !== null,
        isDeveloperPreview: developerPreview !== null,
        developerPreview,
        actualTeam,
        availableTeams,
        switchTeam,
        startDeveloperPreview,
        stopDeveloperPreview,
    };

    return (
        <TeamContext.Provider value={value}>
            {children}
        </TeamContext.Provider>
    );
};
