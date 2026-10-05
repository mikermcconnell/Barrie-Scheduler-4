import type { RegionalGoFeed } from '../regional-transit/types';
import { loadStoredRegionalGoFeed, saveStoredRegionalGoFeed } from './regionalGoFeedStore';

const SOURCE_URL = 'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip';
const CACHE_AGE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 45_000;
const ZIP_MAX_BYTES = 50 * 1024 * 1024;
let cachedFeed: RegionalGoFeed | undefined;
let latestRequest = 0;

/**
 * Public static rail data only; never reuses legacy fallback data. The parsed station subset is stored
 * locally, but reused only when the server confirms the same published version (ETag/Last-Modified).
 */
export async function fetchRegionalGoFeed(options: { forceRefresh?: boolean; signal?: AbortSignal } = {}): Promise<RegionalGoFeed> {
    if (options.signal?.aborted) throw new Error('GO schedule request was cancelled.');
    const cacheAge = cachedFeed ? Date.now() - Date.parse(cachedFeed.fetchedAt) : Infinity;
    if (!options.forceRefresh && cachedFeed && cacheAge >= 0 && cacheAge < CACHE_AGE_MS) return cachedFeed;

    const request = ++latestRequest;
    const controller = new AbortController();
    let worker: Worker | undefined;
    let timedOut = false;
    let rejectCancelled: ((reason: Error) => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
    const abort = () => {
        controller.abort();
        worker?.terminate();
        rejectCancelled?.(new Error(timedOut ? 'GO schedule request timed out. Please try again.' : 'GO schedule request was cancelled.'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; abort(); }, TIMEOUT_MS);
    try {
        const feed = await Promise.race([
            (async () => {
                const response = await fetch(SOURCE_URL, { signal: controller.signal, cache: 'no-cache', credentials: 'omit' });
                if (!response.ok) throw new Error(`GO schedule could not be loaded (HTTP ${response.status}). Please try again.`);
                const version = response.headers.get('etag') || response.headers.get('last-modified');
                const stored = version ? await loadStoredRegionalGoFeed(version) : null;
                if (stored) {
                    // Same published file: skip reading and re-parsing the 19 MB body.
                    void response.body?.cancel().catch((): void => undefined);
                    return { ...stored, fetchedAt: new Date().toISOString() };
                }
                const declaredLength = Number(response.headers.get('content-length'));
                if (declaredLength > ZIP_MAX_BYTES) throw new Error('GO schedule data is invalid (ZIP size).');
                const buffer = await response.arrayBuffer();
                if (controller.signal.aborted) throw new Error('GO schedule request was cancelled.');
                if (!buffer.byteLength || buffer.byteLength > ZIP_MAX_BYTES) throw new Error('GO schedule data is invalid (ZIP size).');
                const parsed = await new Promise<RegionalGoFeed>((resolve, reject) => {
                    worker = new Worker(new URL('./regionalGoWorker.ts', import.meta.url), { type: 'module' });
                    worker.onmessage = (event: MessageEvent<{ feed?: RegionalGoFeed; error?: string }>) => {
                        if (event.data.error) reject(new Error(event.data.error.startsWith('GO schedule data is invalid')
                            ? event.data.error : 'GO schedule data is invalid. Please refresh or try again later.'));
                        else if (event.data.feed) resolve(event.data.feed);
                        else reject(new Error('GO schedule data is invalid (worker response).'));
                    };
                    worker.onerror = () => reject(new Error('GO schedule data is invalid (processing failed). Please try again.'));
                    worker.postMessage(buffer, [buffer]);
                });
                if (version) void saveStoredRegionalGoFeed(version, parsed);
                return parsed;
            })(),
            cancelled,
        ]);
        if (request === latestRequest) cachedFeed = feed;
        return feed;
    } catch (error) {
        if (controller.signal.aborted) throw new Error(timedOut ? 'GO schedule request timed out. Please try again.' : 'GO schedule request was cancelled.');
        if (error instanceof Error && (error.message.startsWith('GO schedule data is invalid') || error.message.startsWith('GO schedule could not be loaded'))) throw error;
        // Do not expose arbitrary server/network bodies or credentials in an error.
        throw new Error('GO schedule could not be loaded. Check your connection and try again.');
    } finally {
        clearTimeout(timeout);
        worker?.terminate();
        options.signal?.removeEventListener('abort', abort);
    }
}
