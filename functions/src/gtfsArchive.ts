import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { GO_SOURCE_URL, GO_ZIP_MAX_BYTES, parseRegionalGoZip } from '../../utils/gtfs/regionalGoParser';

export type ArchivedFeedId = 'go' | 'barrie';

export interface ArchiveFeedConfig {
  id: ArchivedFeedId;
  url: string;
  maxBytes: number;
  /** Keeps only what the app compares (GO: Barrie stations) so clients never download the full zip. */
  reduce?: (zip: ArrayBuffer) => unknown;
}

export interface SnapshotRecord {
  feedId: ArchivedFeedId;
  snapshotId: string;
  fetchedAt: string;
  sourceUrl: string;
  etag: string | null;
  lastModified: string | null;
  sha256: string;
  bytes: number;
  feedVersion: string | null;
  feedStartDate: string | null;
  feedEndDate: string | null;
  zipPath: string;
  reducedPath: string | null;
}

export interface FeedArchiveState {
  etag: string | null;
  sha256: string | null;
}

export interface ArchiveStore {
  getState(feedId: ArchivedFeedId): Promise<FeedArchiveState | null>;
  saveSnapshot(record: SnapshotRecord, zip: Buffer, reducedJson: string | null): Promise<void>;
  recordCheck(feedId: ArchivedFeedId, checkedAt: string, state: FeedArchiveState): Promise<void>;
}

export type ArchiveResult =
  | { status: 'archived'; snapshotId: string; feedVersion: string | null }
  | { status: 'unchanged'; reason: 'same-etag' | 'same-content' };

export const ARCHIVE_FEEDS: ArchiveFeedConfig[] = [
  { id: 'go', url: GO_SOURCE_URL, maxBytes: GO_ZIP_MAX_BYTES, reduce: zip => parseRegionalGoZip(zip) },
  { id: 'barrie', url: 'https://www.myridebarrie.ca/gtfs/google_transit.zip', maxBytes: 20 * 1024 * 1024 },
];

const FETCH_TIMEOUT_MS = 120_000;

interface FeedInfo {
  feedVersion: string | null;
  feedStartDate: string | null;
  feedEndDate: string | null;
}

function readFeedInfo(zip: Buffer): FeedInfo {
  const empty: FeedInfo = { feedVersion: null, feedStartDate: null, feedEndDate: null };
  try {
    const files = unzipSync(new Uint8Array(zip), { filter: entry => (entry.name.split('/').pop() ?? '').toLowerCase() === 'feed_info.txt' });
    const bytes = Object.values(files)[0];
    if (!bytes) return empty;
    const [headerLine, valueLine] = new TextDecoder().decode(bytes).split(/\r?\n/);
    if (!headerLine || !valueLine) return empty;
    const headers = headerLine.split(',').map(header => header.trim());
    const values = valueLine.split(',');
    const pick = (name: string): string | null => {
      const index = headers.indexOf(name);
      return index >= 0 ? values[index]?.trim() || null : null;
    };
    return { feedVersion: pick('feed_version'), feedStartDate: pick('feed_start_date'), feedEndDate: pick('feed_end_date') };
  } catch {
    return empty;
  }
}

async function request(url: string, method: 'HEAD' | 'GET', fetchImpl: typeof fetch): Promise<Response> {
  const response = await fetchImpl(url, { method, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${method} ${url} failed with HTTP ${response.status}.`);
  return response;
}

/** Saves a new snapshot only when the publisher's file actually changed. */
export async function archiveFeedIfChanged(
  config: ArchiveFeedConfig,
  store: ArchiveStore,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<ArchiveResult> {
  const checkedAt = now.toISOString();
  const state = await store.getState(config.id);

  const head = await request(config.url, 'HEAD', fetchImpl);
  const headEtag = head.headers.get('etag');
  if (headEtag && state?.etag === headEtag) {
    await store.recordCheck(config.id, checkedAt, state);
    return { status: 'unchanged', reason: 'same-etag' };
  }

  const response = await request(config.url, 'GET', fetchImpl);
  const zip = Buffer.from(await response.arrayBuffer());
  if (!zip.byteLength || zip.byteLength > config.maxBytes) {
    throw new Error(`${config.id} feed has an unexpected size (${zip.byteLength} bytes).`);
  }
  const etag = response.headers.get('etag') ?? headEtag;
  const sha256 = createHash('sha256').update(zip).digest('hex');
  if (state?.sha256 === sha256) {
    await store.recordCheck(config.id, checkedAt, { etag, sha256 });
    return { status: 'unchanged', reason: 'same-content' };
  }

  const reduced = config.reduce ? config.reduce(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer) : null;
  const info = readFeedInfo(zip);
  const snapshotId = `${checkedAt.slice(0, 10).replaceAll('-', '')}-${sha256.slice(0, 8)}`;
  const record: SnapshotRecord = {
    feedId: config.id,
    snapshotId,
    fetchedAt: checkedAt,
    sourceUrl: config.url,
    etag,
    lastModified: response.headers.get('last-modified'),
    sha256,
    bytes: zip.byteLength,
    ...info,
    zipPath: `gtfs-archive/${config.id}/${snapshotId}.zip`,
    reducedPath: reduced ? `gtfs-archive/${config.id}/${snapshotId}.stations.json` : null,
  };
  await store.saveSnapshot(record, zip, reduced ? JSON.stringify(reduced) : null);
  await store.recordCheck(config.id, checkedAt, { etag, sha256 });
  return { status: 'archived', snapshotId, feedVersion: info.feedVersion };
}
