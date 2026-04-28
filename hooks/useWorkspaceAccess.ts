import { useCallback } from 'react';
import type { FeatureKey } from '../utils/features';
import { useTeam } from '../components/contexts/TeamContext';
import { canAccessWorkspaceFeature } from '../utils/workspaceAccess';

export function useWorkspaceAccess() {
    const { teamMember, accessLevel, loading } = useTeam();

    const canAccess = useCallback(
        (feature: FeatureKey) => canAccessWorkspaceFeature(feature, teamMember),
        [teamMember],
    );

    return {
        accessLevel,
        canAccess,
        loading,
    };
}
