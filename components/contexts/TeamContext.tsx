/**
 * Team Context
 *
 * Provides team state and operations throughout the application.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getUserTeam, joinTeamByInviteCode } from '../../utils/services/teamService';
import type { Team } from '../../utils/masterScheduleTypes';
import { getDevAuthConfig } from '../../utils/dev/devAuth';

interface TeamContextType {
    team: Team | null;
    loading: boolean;
    refreshTeam: () => Promise<void>;
    hasTeam: boolean;
}

const fallbackTeamContext: TeamContextType = {
    team: null,
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
    const [loading, setLoading] = useState(true);
    const devAuth = getDevAuthConfig();

    const loadTeam = useCallback(async () => {
        if (!user) {
            setTeam(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            let userTeam = await getUserTeam(user.uid);

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
        } catch (error) {
            console.error('Error loading team:', error);
            setTeam(null);
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
