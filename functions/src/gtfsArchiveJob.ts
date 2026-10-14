import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ARCHIVE_FEEDS, archiveFeedIfChanged, type ArchiveStore } from './gtfsArchive';
import { addArchivedScheduleFeed } from './gtfsScheduleArchive';

const ARCHIVE_COLLECTION = 'gtfsArchive';

const firestoreStore: ArchiveStore = {
  async getState(feedId) {
    const snapshot = await admin.firestore().collection(ARCHIVE_COLLECTION).doc(feedId).get();
    const data = snapshot.data();
    return data ? { etag: data.etag ?? null, sha256: data.sha256 ?? null } : null;
  },
  async saveSnapshot(record, zip, reducedJson) {
    const bucket = getStorage().bucket();
    await bucket.file(record.zipPath).save(zip, { contentType: 'application/zip', resumable: false });
    if (record.reducedPath && reducedJson !== null) {
      await bucket.file(record.reducedPath).save(reducedJson, { contentType: 'application/json', resumable: false });
    }
    await admin.firestore().collection(ARCHIVE_COLLECTION).doc(record.feedId).collection('snapshots').doc(record.snapshotId).set(record);
    if (record.feedId === 'barrie') {
      // Missed-trip matching reads this, so a new board takes effect without a deploy.
      try {
        const feedVersion = await addArchivedScheduleFeed(bucket, zip, record.snapshotId);
        console.info('Added Barrie schedule to missed-trip bundle', { feedVersion, snapshotId: record.snapshotId });
      } catch (error) {
        console.error('Could not add Barrie schedule to missed-trip bundle', { snapshotId: record.snapshotId, error });
      }
    }
  },
  async recordCheck(feedId, checkedAt, state) {
    await admin.firestore().collection(ARCHIVE_COLLECTION).doc(feedId).set({ lastCheckedAt: checkedAt, etag: state.etag, sha256: state.sha256 }, { merge: true });
  },
};

export const archiveGtfsFeeds = onSchedule(
  {
    schedule: 'every day 04:30',
    timeZone: 'America/Toronto',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '1GiB',
    retryCount: 2,
  },
  async () => {
    const failures: string[] = [];
    for (const config of ARCHIVE_FEEDS) {
      try {
        const result = await archiveFeedIfChanged(config, firestoreStore);
        console.info('GTFS archive check complete', { feed: config.id, ...result });
      } catch (error) {
        console.error('GTFS archive check failed', { feed: config.id, error });
        failures.push(config.id);
      }
    }
    if (failures.length) throw new Error(`GTFS archive failed for: ${failures.join(', ')}`);
  },
);
