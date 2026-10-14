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
  secondsOfService,
  serviceDateOf,
  type GpsDayFile,
  type PingRow,
  type RawFile,
} from './vehiclePositions';

/**
 * Records Barrie Transit's GTFS-RT vehicle positions for the simulator's GPS detour detector
 * (docs/SIMULATOR_FEED.md, "GPS day file"). Two scheduled functions:
 * - recordVehiclePositions: every minute, two samples 30 s apart, one small raw object per minute
 * - compactVehiclePositions: 04:15 daily, merges each finished day into one gzip file
 */

const RAW_PREFIX = 'vehiclePositions/raw/';
const DAY_PREFIX = 'vehiclePositions/days/';
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
  },
);
