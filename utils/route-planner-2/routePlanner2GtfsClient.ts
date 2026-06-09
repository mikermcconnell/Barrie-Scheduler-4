import { buildRoutePlanner2GtfsImportPatterns, type RoutePlanner2GtfsImportPattern } from './routePlanner2GtfsImport';
import {
    loadCachedRoutePlanner2GtfsPatterns,
    saveCachedRoutePlanner2GtfsPatterns,
} from './routePlanner2GtfsCache';

export interface LoadRoutePlanner2GtfsPatternsOptions {
    feedUrl?: string;
    fetchImpl?: typeof fetch;
    forceRefresh?: boolean;
    cacheStorage?: Storage | null;
    now?: number;
}

export async function loadRoutePlanner2GtfsImportPatterns(
    options: LoadRoutePlanner2GtfsPatternsOptions = {},
): Promise<RoutePlanner2GtfsImportPattern[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const includeShapes = true;
    if (!options.forceRefresh) {
        const cachedPatterns = loadCachedRoutePlanner2GtfsPatterns({
            feedUrl: options.feedUrl,
            includeShapes,
            storage: options.cacheStorage,
            now: options.now,
        });
        if (cachedPatterns) return cachedPatterns;
    }

    const params = new URLSearchParams({ includeShapes: 'true' });
    if (options.feedUrl) params.set('url', options.feedUrl);

    const response = await fetchImpl(`/api/gtfs?${params.toString()}`);
    if (!response.ok) {
        throw new Error('GTFS routes could not be loaded. Please try again.');
    }

    const feed = await response.json();
    const patterns = buildRoutePlanner2GtfsImportPatterns(feed);
    saveCachedRoutePlanner2GtfsPatterns(patterns, {
        feedUrl: options.feedUrl,
        includeShapes,
        storage: options.cacheStorage,
        now: options.now,
    });
    return patterns;
}
