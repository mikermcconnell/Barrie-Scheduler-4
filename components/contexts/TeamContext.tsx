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
import {
    createDeveloperPreviewSession,
    type DeveloperPreviewInput,
    type DeveloperPreviewSession,
} from '../../utils/developerPreview';

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
    startDeveloperPreview: (input: DeveloperPreviewInput) => void;
    stopDeveloperPreview: () => void;
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
    startDeveloperPreview: () => { },
    stopDeveloperPreview: () => { },
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

    useEffect(() => {
        if (!isGlobalAdmin && developerPreview) {
            setDeveloperPreview(null);
        }
    }, [developerPreview, isGlobalAdmin]);

    const startDeveloperPreview = (input: DeveloperPreviewInput) => {
        if (!isGlobalAdmin) {
            throw new Error('Developer Preview Mode requires global admin access.');
        }
        setDeveloperPreview(createDeveloperPreviewSession(input));
    };

    const stopDeveloperPreview = () => {
        setDeveloperPreview(null);
    };

    const team = developerPreview?.team ?? actualTeam;
    const teamMember = developerPreview?.teamMember ?? actualTeamMember;
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
