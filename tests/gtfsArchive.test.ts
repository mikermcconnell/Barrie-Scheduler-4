// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { archiveFeedIfChanged, type ArchiveFeedConfig, type ArchiveStore, type FeedArchiveState, type SnapshotRecord } from '../functions/src/gtfsArchive';

function zipOf(version: string): Buffer {
  const info = `feed_publisher_name,feed_start_date,feed_end_date,feed_version\r\nTest,20260929,20261127,${version}\r\n`;
  return Buffer.from(zipSync({ 'feed_info.txt': strToU8(info), 'stops.txt': strToU8('stop_id\r\nAD\r\n') }));
}

function fakeStore(initial: FeedArchiveState | null = null) {
  let state = initial;
  const saved: { record: SnapshotRecord; zip: Buffer; reduced: string | null }[] = [];
  const store: ArchiveStore = {
    getState: async () => state,
    saveSnapshot: async (record, zip, reduced) => { saved.push({ record, zip, reduced }); },
    recordCheck: async (_id, _at, next) => { state = next; },
  };
  return { store, saved, get state() { return state; } };
}

function fakeFetch(zip: Buffer, etag: string | null) {
  const headers = new Headers({ 'last-modified': 'Mon, 05 Oct 2026 18:00:24 GMT' });
  if (etag) headers.set('etag', etag);
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => ({
    ok: true,
    status: 200,
    headers,
    arrayBuffer: async () => init?.method === 'HEAD' ? new ArrayBuffer(0) : zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
  }) as unknown as Response);
}

const config: ArchiveFeedConfig = { id: 'go', url: 'https://example.test/feed.zip', maxBytes: 1024 * 1024, reduce: () => ({ reduced: true }) };
const now = new Date('2026-10-06T08:30:00.000Z');

describe('archiveFeedIfChanged', () => {
  it('archives a new feed with its version, dates and reduced copy', async () => {
    const backing = fakeStore();
    const result = await archiveFeedIfChanged(config, backing.store, fakeFetch(zipOf('V1'), '"abc"') as unknown as typeof fetch, now);

    expect(result).toMatchObject({ status: 'archived', feedVersion: 'V1' });
    expect(backing.saved).toHaveLength(1);
    const { record, reduced } = backing.saved[0];
    expect(record).toMatchObject({
      feedId: 'go', etag: '"abc"', feedVersion: 'V1', feedStartDate: '20260929', feedEndDate: '20261127',
      zipPath: expect.stringMatching(/^gtfs-archive\/go\/20261006-[0-9a-f]{8}\.zip$/),
      reducedPath: expect.stringMatching(/\.stations\.json$/),
    });
    expect(reduced).toBe('{"reduced":true}');
    expect(backing.state).toEqual({ etag: '"abc"', sha256: record.sha256 });
  });

  it('does not download again when the ETag is unchanged', async () => {
    const backing = fakeStore({ etag: '"abc"', sha256: 'x' });
    const fetchSpy = fakeFetch(zipOf('V1'), '"abc"');
    const result = await archiveFeedIfChanged(config, backing.store, fetchSpy as unknown as typeof fetch, now);

    expect(result).toEqual({ status: 'unchanged', reason: 'same-etag' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(backing.saved).toHaveLength(0);
  });

  it('skips a re-published identical file whose ETag changed', async () => {
    const backing = fakeStore();
    await archiveFeedIfChanged(config, backing.store, fakeFetch(zipOf('V1'), '"abc"') as unknown as typeof fetch, now);
    const result = await archiveFeedIfChanged(config, backing.store, fakeFetch(zipOf('V1'), '"new-tag"') as unknown as typeof fetch, now);

    expect(result).toEqual({ status: 'unchanged', reason: 'same-content' });
    expect(backing.saved).toHaveLength(1);
    expect(backing.state?.etag).toBe('"new-tag"');
  });

  it('archives again when the content changes', async () => {
    const backing = fakeStore();
    await archiveFeedIfChanged(config, backing.store, fakeFetch(zipOf('V1'), '"abc"') as unknown as typeof fetch, now);
    const result = await archiveFeedIfChanged(config, backing.store, fakeFetch(zipOf('V2'), '"def"') as unknown as typeof fetch, new Date('2026-11-30T08:30:00.000Z'));

    expect(result).toMatchObject({ status: 'archived', feedVersion: 'V2' });
    expect(backing.saved.map(item => item.record.feedVersion)).toEqual(['V1', 'V2']);
  });

  it('archives feeds without an ETag and without a reduced copy', async () => {
    const backing = fakeStore();
    const result = await archiveFeedIfChanged({ ...config, id: 'barrie', reduce: undefined }, backing.store, fakeFetch(zipOf('B1'), null) as unknown as typeof fetch, now);

    expect(result.status).toBe('archived');
    expect(backing.saved[0].record).toMatchObject({ etag: null, reducedPath: null });
    expect(backing.saved[0].reduced).toBeNull();
  });

  it('rejects oversized downloads and failed requests without saving', async () => {
    const backing = fakeStore();
    await expect(archiveFeedIfChanged({ ...config, maxBytes: 10 }, backing.store, fakeFetch(zipOf('V1'), '"abc"') as unknown as typeof fetch, now)).rejects.toThrow(/unexpected size/);
    const failing = vi.fn(async () => ({ ok: false, status: 503, headers: new Headers() }) as unknown as Response);
    await expect(archiveFeedIfChanged(config, backing.store, failing as unknown as typeof fetch, now)).rejects.toThrow(/HTTP 503/);
    expect(backing.saved).toHaveLength(0);
  });
});
