import { gunzipSync, gzipSync } from 'node:zlib';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  FEED_URL,
  GPS_DAY_SCHEMA,
  clockLabel,
  compactDay,
  decodePings,
  isQuietHours,
  mergeToday,
  secondsOfService,
  serviceDateOf,
  type GpsDayFile,
  type PingRow,
  type RawFile,
  type TodayFile,
} from './vehiclePositions';

/**
 * Records Barrie Transit's GTFS-RT vehicle positions for the simulator's GPS detour detector
 * (docs/SIMULATOR_FEED.md, "GPS day file"). Two scheduled functions:
 * - recordVehiclePositions: every minute, two samples 30 s apart, one small raw object per minute
 * - snapshotVehiclePositions: every 5 minutes, merges today's raw objects so far into one gzip file,
 *   so the hosted simulator reads one file plus a few minutes instead of hundreds of objects
 * - compactVehiclePositions: 04:15 daily, merges each finished day into one gzip file
 */

const RAW_PREFIX = 'vehiclePositions/raw/';
const DAY_PREFIX = 'vehiclePositions/days/';
const TODAY_PREFIX = 'vehiclePositions/today/';
const PARALLEL_DOWNLOADS = 16;
const FETCH_TIMEOUT_MS = 10_000;
const SAMPLE_GAP_MS = 30_000;

async function fetchFeed(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn('Vehicle positions fetch failed', { status: res.status });
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    console.warn('Vehicle positions fetch failed', { error: String(error) });
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const recordVehiclePositions = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'America/Toronto',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    // Most of each run is the 30 s sample gap; a fractional vCPU keeps that wait cheap.
    cpu: 'gcf_gen1',
    retryCount: 0,
  },
  async () => {
    const started = Date.now();
    if (isQuietHours(started)) return;
    const serviceDate = serviceDateOf(started);
    const rows: PingRow[] = [];
    const fetches: number[] = [];
    for (let i = 0; i < 2; i++) {
      if (i > 0) await sleep(SAMPLE_GAP_MS);
      const at = Date.now();
      const buf = await fetchFeed();
      if (!buf) continue;
      try {
        rows.push(...decodePings(buf, at));
        fetches.push(secondsOfService(at, serviceDate));
      } catch (error) {
        console.warn('Vehicle positions decode failed', { error: String(error) });
      }
    }
    if (!fetches.length) return;
    const file: RawFile = { schema: GPS_DAY_SCHEMA, serviceDate, fetches, rows };
    try {
      await getStorage()
        .bucket()
        .file(`${RAW_PREFIX}${serviceDate}/${clockLabel(started)}.json`)
        .save(JSON.stringify(file), { contentType: 'application/json', resumable: false });
    } catch (error) {
      // Never throw: a retry would only add a late duplicate of data the next run records anyway.
      console.error('Vehicle positions write failed', { error: String(error) });
    }
  },
);

export const snapshotVehiclePositions = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'America/Toronto',
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
    retryCount: 0,
  },
  async () => {
    const now = Date.now();
    if (isQuietHours(now)) return;
    const serviceDate = serviceDateOf(now);
    const bucket = getStorage().bucket();
    const target = bucket.file(`${TODAY_PREFIX}${serviceDate}.json.gz`);
    let existing: TodayFile | null = null;
    // 0 = "must not exist yet": a concurrent writer makes the save fail instead of losing rows.
    let generation = 0;
    const [exists] = await target.exists();
    if (exists) {
      const [meta] = await target.getMetadata();
      generation = Number(meta.generation);
      const [buf] = await target.download();
      existing = JSON.parse(gunzipSync(buf).toString('utf8')) as TodayFile;
    }
    const merged = new Set(existing?.merged ?? []);
    const [files] = await bucket.getFiles({ prefix: `${RAW_PREFIX}${serviceDate}/` });
    const fresh = files.filter((f) => !merged.has(f.name.split('/').pop()!));
    if (!fresh.length) return;
    const raws: { name: string; file: RawFile }[] = [];
    for (let i = 0; i < fresh.length; i += PARALLEL_DOWNLOADS) {
      await Promise.all(
        fresh.slice(i, i + PARALLEL_DOWNLOADS).map(async (f) => {
          const [buf] = await f.download();
          raws.push({ name: f.name.split('/').pop()!, file: JSON.parse(buf.toString('utf8')) as RawFile });
        }),
      );
    }
    const today = mergeToday(serviceDate, existing, raws);
    try {
      await target.save(gzipSync(JSON.stringify(today)), {
        contentType: 'application/json',
        resumable: false,
        preconditionOpts: { ifGenerationMatch: generation },
      });
    } catch (error) {
      // Never throw: the next run merges the same objects again.
      console.warn('Vehicle positions snapshot write failed', { serviceDate, error: String(error) });
    }
  },
);

export const compactVehiclePositions = onSchedule(
  {
    schedule: 'every day 04:15',
    timeZone: 'America/Toronto',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '1GiB',
    retryCount: 2,
  },
  async () => {
    const bucket = getStorage().bucket();
    const today = serviceDateOf(Date.now());
    const [files] = await bucket.getFiles({ prefix: RAW_PREFIX });
    const byDate = new Map<string, typeof files>();
    for (const f of files) {
      const date = f.name.slice(RAW_PREFIX.length).split('/')[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today) continue;
      byDate.set(date, [...(byDate.get(date) ?? []), f]);
    }
    for (const [date, objects] of [...byDate].sort()) {
      const raws: RawFile[] = [];
      for (const o of objects) {
        const [buf] = await o.download();
        raws.push(JSON.parse(buf.toString('utf8')) as RawFile);
      }
      // Idempotent: a day file left by an earlier run is merged, not replaced.
      const dayFile = bucket.file(`${DAY_PREFIX}${date}.json.gz`);
      let existing: GpsDayFile | null = null;
      if ((await dayFile.exists())[0]) {
        const [buf] = await dayFile.download();
        existing = JSON.parse(gunzipSync(buf).toString('utf8')) as GpsDayFile;
      }
      const day = compactDay(date, raws, existing);
      // contentEncoding stays unset so a download returns the gzip bytes as stored.
      await dayFile.save(gzipSync(JSON.stringify(day)), { contentType: 'application/json', resumable: false });
      await Promise.all(objects.map((o) => o.delete()));
      console.info('Compacted vehicle positions', { date, objects: objects.length, pings: day.pings.length, fetches: day.fetches.length });
    }
    // Finished days are in their day file now: drop their "today so far" snapshots.
    const [snapshots] = await bucket.getFiles({ prefix: TODAY_PREFIX });
    await Promise.all(snapshots.filter((f) => f.name.slice(TODAY_PREFIX.length, TODAY_PREFIX.length + 10) < today).map((f) => f.delete({ ignoreNotFound: true })));
  },
);
