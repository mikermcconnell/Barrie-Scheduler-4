/**
 * usePlatformConfig Hook
 *
 * Loads effective platform config (Firestore → fallback to hardcoded defaults).
 * Exposes refresh() for post-edit reloads.
 */

import { useState, useEffect, useCallback } from 'react';
import {
    buildDefaultPlatformConfig,
    getEffectiveConfig,
    getPlatformConfigErrorMessage,
    type PlatformConfigDocument
} from '../utils/platform/platformConfigService';

export function usePlatformConfig(teamId: string | undefined) {
    const [config, setConfig] = useState<PlatformConfigDocument | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!teamId) {
            setConfig(null);
            setLoading(false);
            setError(null);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await getEffectiveConfig(teamId);
            setConfig(result);
        } catch (error) {
            console.error('Error loading platform config:', error);
            setConfig(buildDefaultPlatformConfig());
            setError(getPlatformConfigErrorMessage(error, 'load'));
        } finally {
            setLoading(false);
        }
    }, [teamId]);

    useEffect(() => {
        load();
    }, [load]);

    const refresh = useCallback(() => load(), [load]);

    return { config, loading, error, refresh };
}
