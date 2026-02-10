/**
 * usePlatformConfig Hook
 *
 * Loads effective platform config (Firestore → fallback to hardcoded defaults).
 * Exposes refresh() for post-edit reloads.
 */

import { useState, useEffect, useCallback } from 'react';
import { getEffectiveConfig, type PlatformConfigDocument } from '../utils/platformConfigService';

export function usePlatformConfig(teamId: string | undefined) {
    const [config, setConfig] = useState<PlatformConfigDocument | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!teamId) {
            setConfig(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const result = await getEffectiveConfig(teamId);
            setConfig(result);
        } catch (error) {
            console.error('Error loading platform config:', error);
        } finally {
            setLoading(false);
        }
    }, [teamId]);

    useEffect(() => {
        load();
    }, [load]);

    const refresh = useCallback(() => load(), [load]);

    return { config, loading, refresh };
}
