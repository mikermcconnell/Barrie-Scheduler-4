/**
 * Team Context
 *
 * Provides team state and operations throughout the application.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { getUserTeam } from '../../utils/services/teamService';
import type { Team } from '../../utils/masterScheduleTypes';

interface TeamContextType {
    team: Team | null;
    loading: boolean;
    refreshTeam: () => Promise<void>;
    hasTeam: boolean;
}

const TeamContext = createContext<TeamContextType | undefined>(undefined);

export const useTeam = (): TeamContextType => {
    const context = useContext(TeamContext);
    if (!context) {
        throw new Error('useTeam must be used within a TeamProvider');
    }
    return context;
};

interface TeamProviderProps {
    children: ReactNode;
}

export const TeamProvider: React.FC<TeamProviderProps> = ({ children }) => {
    const { user } = useAuth();
    const [team, setTeam] = useState<Team | null>(null);
    const [loading, setLoading] = useState(true);

    const loadTeam = async () => {
        if (!user) {
            setTeam(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const userTeam = await getUserTeam(user.uid);
            setTeam(userTeam);
        } catch (error) {
            console.error('Error loading team:', error);
            setTeam(null);
        } finally {
            setLoading(false);
        }
    };

    const refreshTeam = async () => {
        await loadTeam();
    };

    useEffect(() => {
        loadTeam();
    }, [user]);

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
