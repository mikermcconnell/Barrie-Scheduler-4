/**
 * Team Context
 *
 * Provides team state and operations throughout the application.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getUserTeam, joinTeamByInviteCode, getTeamMember, getTeamWithMembers } from '../../utils/services/teamService';
import type { Team, TeamMember, TeamRole, WorkspaceAccessLevel } from '../../utils/masterScheduleTypes';
import { resolveWorkspaceAccessLevel } from '../../utils/workspaceAccess';
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

interface TeamContextType {
    team: Team | null;
    teamMember: TeamMember | null;
    teamRole: TeamRole | null;
    accessLevel: WorkspaceAccessLevel;
    canManageTeam: boolean;
    loading: boolean;
    refreshTeam: () => Promise<void>;
    hasTeam: boolean;
    isDeveloperPreview: boolean;
    developerPreview: DeveloperPreviewSession | null;
    actualTeam: Team | null;
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
    isDeveloperPreview: false,
    developerPreview: null,
    actualTeam: null,
    startDeveloperPreview: async () => { throw new Error('Team context is unavailable.'); },
    stopDeveloperPreview: async () => { },
};

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
    const [developerPreview, setDeveloperPreview] = useState<DeveloperPreviewSession | null>(null);
    const [loading, setLoading] = useState(true);
    const devAuth = getDevAuthConfig();

    const loadTeam = useCallback(async () => {
        if (!user) {
            setActualTeam(null);
            setActualTeamMember(null);
            setActualTeamRole(null);
            setDeveloperPreview(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            let userTeam = await getUserTeam(user.uid);

            const pendingInviteCode = getPendingInviteCode();
            if (pendingInviteCode) {
                try {
                    await joinTeamByInviteCode(
                        user.uid,
                        pendingInviteCode,
                        user.displayName || user.email?.split('@')[0] || 'User',
                        user.email || '',
                    );
                    userTeam = await getUserTeam(user.uid);
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
            setDeveloperPreview(null);
        } finally {
            setLoading(false);
        }
    }, [devAuth.enabled, devAuth.teamInviteCode, user]);

    const refreshTeam = async () => {
        await loadTeam();
    };

    useEffect(() => {
        void loadTeam();
    }, [loadTeam]);

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
    const teamMember = developerPreview?.teamMember
        ?? resolveGlobalAdminHomeTeamMember(actualTeamMember, isGlobalAdmin);
    const teamRole = teamMember?.role ?? actualTeamRole;


    const value: TeamContextType = {
        team,
        teamMember,
        teamRole,
        accessLevel: resolveWorkspaceAccessLevel(teamMember),
        canManageTeam: teamRole === 'owner' || teamRole === 'admin',
        loading,
        refreshTeam,
        hasTeam: team !== null,
        isDeveloperPreview: developerPreview !== null,
        developerPreview,
        actualTeam,
        startDeveloperPreview,
        stopDeveloperPreview,
    };

    return (
        <TeamContext.Provider value={value}>
            {children}
        </TeamContext.Provider>
    );
};
