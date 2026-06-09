import type { RoutePlanner2GtfsImportPattern } from './routePlanner2GtfsImport';

const CACHE_KEY = 'scheduler4:route-planner-2:gtfs-import-patterns:v1';
const CACHE_VERSION = 1;
export const ROUTE_PLANNER_2_GTFS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface RoutePlanner2GtfsImportPatternCacheEntry {
    version: number;
    feedUrl: string | null;
    includeShapes: boolean;
    fetchedAt: number;
    patterns: RoutePlanner2GtfsImportPattern[];
}

export interface RoutePlanner2GtfsImportPatternCacheOptions {
    feedUrl?: string | null;
    includeShapes?: boolean;
    now?: number;
    storage?: Storage | null;
}

function getStorage(storage?: Storage | null): Storage | null {
    if (storage !== undefined) return storage;
    if (typeof window === 'undefined') return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function getCacheFeedUrl(feedUrl?: string | null): string | null {
    return feedUrl?.trim() || null;
}

function isCacheEntry(value: unknown): value is RoutePlanner2GtfsImportPatternCacheEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as RoutePlanner2GtfsImportPatternCacheEntry;
    return entry.version === CACHE_VERSION
        && typeof entry.fetchedAt === 'number'
        && typeof entry.includeShapes === 'boolean'
        && Array.isArray(entry.patterns);
}

function matchesCacheRequest(
    entry: RoutePlanner2GtfsImportPatternCacheEntry,
    options: RoutePlanner2GtfsImportPatternCacheOptions,
): boolean {
    return entry.feedUrl === getCacheFeedUrl(options.feedUrl)
        && entry.includeShapes === (options.includeShapes ?? true);
}

export function loadCachedRoutePlanner2GtfsPatterns(
    options: RoutePlanner2GtfsImportPatternCacheOptions = {},
): RoutePlanner2GtfsImportPattern[] | null {
    const storage = getStorage(options.storage);
    if (!storage) return null;

    try {
        const raw = storage.getItem(CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as unknown;
        if (!isCacheEntry(parsed) || !matchesCacheRequest(parsed, options)) {
            storage.removeItem(CACHE_KEY);
            return null;
        }

        const now = options.now ?? Date.now();
        if (now - parsed.fetchedAt > ROUTE_PLANNER_2_GTFS_CACHE_MAX_AGE_MS) {
            storage.removeItem(CACHE_KEY);
            return null;
        }

        return parsed.patterns;
    } catch {
        try {
            storage.removeItem(CACHE_KEY);
        } catch {
            // Ignore storage cleanup failures.
        }
        return null;
    }
}

export function saveCachedRoutePlanner2GtfsPatterns(
    patterns: RoutePlanner2GtfsImportPattern[],
    options: RoutePlanner2GtfsImportPatternCacheOptions = {},
): void {
    const storage = getStorage(options.storage);
    if (!storage) return;

    const entry: RoutePlanner2GtfsImportPatternCacheEntry = {
        version: CACHE_VERSION,
        feedUrl: getCacheFeedUrl(options.feedUrl),
        includeShapes: options.includeShapes ?? true,
        fetchedAt: options.now ?? Date.now(),
        patterns,
    };

    try {
        storage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
        // Cache is an optimization only; imports should still work without it.
    }
}

export function clearCachedRoutePlanner2GtfsPatterns(storage?: Storage | null): void {
    const resolvedStorage = getStorage(storage);
    if (!resolvedStorage) return;

    try {
        resolvedStorage.removeItem(CACHE_KEY);
    } catch {
        // Ignore storage cleanup failures.
    }
}
