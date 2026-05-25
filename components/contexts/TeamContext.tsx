/**
 * Team Context
 *
 * Provides team state and operations throughout the application.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getUserTeam, joinTeamByInviteCode, getTeamMember } from '../../utils/services/teamService';
import type { Team, TeamMember, TeamRole, WorkspaceAccessLevel } from '../../utils/masterScheduleTypes';
import { resolveWorkspaceAccessLevel } from '../../utils/workspaceAccess';
import { getDevAuthConfig } from '../../utils/dev/devAuth';
import { clearPendingInviteCodeFromUrl, getPendingInviteCode } from '../../utils/inviteLinks';

interface TeamContextType {
    team: Team | null;
    teamMember: TeamMember | null;
    teamRole: TeamRole | null;
    accessLevel: WorkspaceAccessLevel;
    canManageTeam: boolean;
    loading: boolean;
    refreshTeam: () => Promise<void>;
    hasTeam: boolean;
}

const fallbackTeamContext: TeamContextType = {
    team: null,
    teamMember: null,
    teamRole: null,
    accessLevel: 'production',
    canManageTeam: false,
    loading: false,
    refreshTeam: async () => { },
    hasTeam: false
};

const TeamContext = createContext<TeamContextType>(fallbackTeamContext);

export const useTeam = (): TeamContextType => {
    return useContext(TeamContext);
};

interface TeamProviderProps {
    children: ReactNode;
}

export const TeamProvider: React.FC<TeamProviderProps> = ({ children }) => {
    const { user } = useAuth();
    const [team, setTeam] = useState<Team | null>(null);
    const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
    const [teamRole, setTeamRole] = useState<TeamRole | null>(null);
    const [loading, setLoading] = useState(true);
    const devAuth = getDevAuthConfig();

    const loadTeam = useCallback(async () => {
        if (!user) {
            setTeam(null);
            setTeamMember(null);
            setTeamRole(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            let userTeam = await getUserTeam(user.uid);

            const pendingInviteCode = getPendingInviteCode();
            if (pendingInviteCode) {
                if (!userTeam) {
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

            setTeam(userTeam);
            if (userTeam) {
                const member = await getTeamMember(userTeam.id, user.uid);
                setTeamMember(member);
                setTeamRole(member?.role ?? null);
            } else {
                setTeamMember(null);
                setTeamRole(null);
            }
        } catch (error) {
            console.error('Error loading team:', error);
            setTeam(null);
            setTeamMember(null);
            setTeamRole(null);
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


    const value: TeamContextType = {
        team,
        teamMember,
        teamRole,
        accessLevel: resolveWorkspaceAccessLevel(teamMember),
        canManageTeam: teamRole === 'owner' || teamRole === 'admin',
        loading,
        refreshTeam,
        hasTeam: team !== null
    };

    return (
        <TeamContext.Provider value={value}>
            {children}
        </TeamContext.Provider>
    );
};
