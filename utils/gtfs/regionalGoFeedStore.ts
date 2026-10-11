import type { RegionalGoFeed } from '../regional-transit/types';

const DATABASE_NAME = 'scheduler4-regional-go';
const DATABASE_VERSION = 1;
const FEED_STORE = 'feeds';
const FEED_KEY = 'barrie-stations';

/** Parsed station subset, tied to the exact published GTFS version (ETag/Last-Modified) it came from. */
interface StoredRegionalGoFeed {
    key: string;
    version: string;
    feed: RegionalGoFeed;
}

function getIndexedDb(factory?: IDBFactory): IDBFactory | null {
    if (factory) return factory;
    return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
    });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(FEED_STORE)) {
                request.result.createObjectStore(FEED_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
        request.onblocked = () => reject(new Error('Browser storage is blocked by another open app window.'));
    });
}

async function withFeedStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, factory?: IDBFactory): Promise<T | null> {
    const indexedDb = getIndexedDb(factory);
    if (!indexedDb) return null;
    const database = await openDatabase(indexedDb);
    try {
        return await requestResult(operation(database.transaction(FEED_STORE, mode).objectStore(FEED_STORE)));
    } finally {
        database.close();
    }
}

/** Returns the stored feed only when it was parsed from exactly this published version. */
export async function loadStoredRegionalGoFeed(version: string, factory?: IDBFactory): Promise<RegionalGoFeed | null> {
    try {
        const stored = await withFeedStore<StoredRegionalGoFeed | undefined>('readonly', store => store.get(FEED_KEY), factory);
        return stored && stored.version === version && Array.isArray(stored.feed?.stopTimes) ? stored.feed : null;
    } catch {
        return null;
    }
}

export async function saveStoredRegionalGoFeed(version: string, feed: RegionalGoFeed, factory?: IDBFactory): Promise<void> {
    try {
        await withFeedStore('readwrite', store => store.put({ key: FEED_KEY, version, feed } satisfies StoredRegionalGoFeed), factory);
    } catch {
        // Storage is an optimization only; the next load parses the download again.
    }
}
