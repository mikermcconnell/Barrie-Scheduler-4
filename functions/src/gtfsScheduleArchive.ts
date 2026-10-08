import { unzipSync } from 'fflate';
import { buildScheduleFeed, mergeScheduleFeeds, type ScheduleBundle } from '../../utils/gtfs/gtfsScheduleBundle';
import { getPackagedScheduleBundle, setScheduleBundle } from './gtfsScheduleIndex';

/**
 * Keeps missed-trip matching current without a code deploy: each archived Barrie feed
 * is added to a schedule bundle in Storage, and imports merge it over the packaged one.
 */
export const ARCHIVED_SCHEDULE_PATH = 'gtfs-archive/barrie/schedule-feeds.json';
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const NEEDED_FILES = ['calendar.txt', 'calendar_dates.txt', 'trips.txt', 'stop_times.txt', 'feed_info.txt'];

interface StorageFile {
  exists(): Promise<[boolean]>;
  download(): Promise<[Buffer]>;
  save(data: string, options: { contentType: string; resumable: boolean }): Promise<unknown>;
}

export interface ScheduleBucket {
  file(path: string): StorageFile;
}

let lastRefreshAt = 0;

async function readArchivedBundle(bucket: ScheduleBucket): Promise<ScheduleBundle | null> {
  const file = bucket.file(ARCHIVED_SCHEDULE_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [content] = await file.download();
  return JSON.parse(content.toString('utf8')) as ScheduleBundle;
}

/** Adds a newly archived Barrie feed zip to the Storage schedule bundle. */
export async function addArchivedScheduleFeed(bucket: ScheduleBucket, zip: Buffer, snapshotId: string): Promise<string> {
  const entries = unzipSync(new Uint8Array(zip), {
    filter: entry => NEEDED_FILES.includes((entry.name.split('/').pop() ?? '').toLowerCase()),
  });
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    files[(name.split('/').pop() ?? '').toLowerCase()] = new TextDecoder().decode(bytes);
  }
  const feed = buildScheduleFeed(files, snapshotId);
  const existing = await readArchivedBundle(bucket);
  const bundle: ScheduleBundle = { feeds: mergeScheduleFeeds(existing?.feeds ?? [], [feed]) };
  await bucket.file(ARCHIVED_SCHEDULE_PATH).save(JSON.stringify(bundle), { contentType: 'application/json', resumable: false });
  return feed.feedVersion;
}

/**
 * Merges archived feeds over the packaged ones before missed-trip matching.
 * Checks Storage at most every 30 minutes per instance; keeps the current schedule on failure.
 */
export async function refreshScheduleFromArchive(bucket: ScheduleBucket, now = Date.now()): Promise<void> {
  if (now - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  try {
    const archived = await readArchivedBundle(bucket);
    const packaged = getPackagedScheduleBundle();
    setScheduleBundle({ feeds: mergeScheduleFeeds(packaged.feeds, archived?.feeds ?? []) });
    lastRefreshAt = now;
  } catch (error) {
    console.warn('Archived GTFS schedules unavailable; using packaged schedules.', error);
  }
}
