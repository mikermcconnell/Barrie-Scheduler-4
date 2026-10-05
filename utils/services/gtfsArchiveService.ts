import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { getBytes, ref } from 'firebase/storage';
import { db, storage } from '../firebase';
import { validateRegionalGoFeed } from '../gtfs/regionalGoParser';
import type { RegionalGoFeed } from '../regional-transit/types';

export type ArchivedFeedId = 'go' | 'barrie';

export interface GtfsSnapshotSummary {
    feedId: ArchivedFeedId;
    snapshotId: string;
    fetchedAt: string;
    feedVersion: string | null;
    feedStartDate: string | null;
    feedEndDate: string | null;
    bytes: number;
    reducedPath: string | null;
}

export interface GtfsArchiveStatus {
    lastCheckedAt: string | null;
    snapshots: GtfsSnapshotSummary[];
}

const ARCHIVE_COLLECTION = 'gtfsArchive';
const MAX_SNAPSHOTS = 50;

function text(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

export async function listGtfsSnapshots(feedId: ArchivedFeedId): Promise<GtfsArchiveStatus> {
    const feedDoc = doc(db, ARCHIVE_COLLECTION, feedId);
    const [feedSnapshot, snapshots] = await Promise.all([
        getDoc(feedDoc),
        getDocs(query(collection(feedDoc, 'snapshots'), orderBy('fetchedAt', 'desc'), limit(MAX_SNAPSHOTS))),
    ]);
    return {
        lastCheckedAt: text(feedSnapshot.data()?.lastCheckedAt),
        snapshots: snapshots.docs.flatMap(item => {
            const data = item.data();
            const fetchedAt = text(data.fetchedAt);
            if (!fetchedAt) return [];
            return [{
                feedId,
                snapshotId: item.id,
                fetchedAt,
                feedVersion: text(data.feedVersion),
                feedStartDate: text(data.feedStartDate),
                feedEndDate: text(data.feedEndDate),
                bytes: typeof data.bytes === 'number' ? data.bytes : 0,
                reducedPath: text(data.reducedPath),
            }];
        }),
    };
}

/** Loads the saved Barrie-station subset of a GO snapshot (about 300 KB, not the full zip). */
export async function loadGoStationSnapshot(snapshot: GtfsSnapshotSummary): Promise<RegionalGoFeed> {
    if (!snapshot.reducedPath) throw new Error('This snapshot has no station data to compare.');
    const bytes = await getBytes(ref(storage, snapshot.reducedPath));
    return validateRegionalGoFeed(JSON.parse(new TextDecoder().decode(bytes)));
}
