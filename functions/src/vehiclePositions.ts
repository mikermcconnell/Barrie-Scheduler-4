import { transit_realtime } from 'gtfs-realtime-bindings';

// Re-exported so tests (resolved from the repo root) can encode feeds without a second install.
export { transit_realtime };

/**
 * Pure helpers for the GPS day file the simulator reads (docs/SIMULATOR_FEED.md, "GPS day file"):
 * decode one GTFS-RT vehicle-positions fetch into ping rows, assign each ping to a service date,
 * and merge many fetches into one deduplicated day.
 */

export const FEED_URL = 'https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb';
export const GPS_DAY_SCHEMA = 1;
export const TIME_ZONE = 'America/Toronto';

/** Local times before this hour belong to the previous service date (no service overnight). */
const SERVICE_DAY_START_HOUR = 4;
/** Pings older than this, or this far in the future, are stale or clock errors (Trip Planner rule). */
const MAX_AGE_S = 5 * 60;
const MAX_FUTURE_S = 120;

/** [serviceDate, t, vehicleId, tripId, routeId, lat, lon, bearing] */
export type PingRow = [string, number, string, string | null, string | null, number, number, number | null];

/** What one recorder invocation writes: the pings of its fetches and when each fetch happened. */
export interface RawFile {
  schema: typeof GPS_DAY_SCHEMA;
  serviceDate: string;
  /** Seconds since the service date's local midnight, one per feed fetch (coverage). */
  fetches: number[];
  rows: PingRow[];
}

/** [t, vehicleId, tripId, routeId, lat, lon, bearing] */
export type GpsPing = [number, string, string | null, string | null, number, number, number | null];

export interface GpsDayFile {
  schema: typeof GPS_DAY_SCHEMA;
  serviceDate: string;
  feedUrl: string;
  fetches: number[];
  pings: GpsPing[];
}

/**
 * Today so far (vehiclePositions/today/<date>.json.gz): the day file of the raw objects merged so
 * far, plus their object names, so a reader adds only the raw objects written since.
 */
export interface TodayFile extends GpsDayFile {
  /** Raw object names (HHMMSS.json) already merged. Clock names wrap at midnight, so not "merged through". */
  merged: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Midnight at the start of a date in Toronto (ms). The offset is read at midnight itself, not noon:
 * on the fall-back day the two differ. Toronto is UTC-4 or UTC-5, so one of the two candidates fits.
 */
export function serviceMidnight(date: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  for (const hours of [4, 5]) {
    const ms = utc + hours * 3600_000;
    const l = localParts(ms);
    if (l.date === date && l.hour === 0 && l.minute === 0) return ms;
  }
  throw new Error(`No local midnight found for ${date}`);
}

/** Toronto wall-clock parts of an instant. */
function localParts(ms: number) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, second: +p.second };
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Service date of an instant when the feed names none: local date, with 00:00–04:00 on the previous day. */
export function serviceDateOf(ms: number): string {
  const l = localParts(ms);
  return l.hour < SERVICE_DAY_START_HOUR ? addDays(l.date, -1) : l.date;
}

/** Seconds since the service date's local midnight (exceeds 86,400 after midnight). */
export function secondsOfService(ms: number, serviceDate: string): number {
  return Math.round((ms - serviceMidnight(serviceDate)) / 1000);
}

/** Wall-clock HHMMSS in Toronto, for object names. */
export function clockLabel(ms: number): string {
  const l = localParts(ms);
  return `${pad(l.hour)}${pad(l.minute)}${pad(l.second)}`;
}

/** True between 01:45 and 04:30 local, when no buses run. */
export function isQuietHours(ms: number): boolean {
  const l = localParts(ms);
  const m = l.hour * 60 + l.minute;
  return m >= 105 && m < 270;
}

const toNumber = (v: unknown): number => (typeof v === 'number' ? v : v && typeof (v as { toNumber?: () => number }).toNumber === 'function' ? (v as { toNumber: () => number }).toNumber() : Number(v));

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Ping rows from one vehicle-positions payload; entities without a fresh position and time are dropped. */
export function decodePings(buf: Uint8Array, fetchedAtMs: number): PingRow[] {
  const feed = transit_realtime.FeedMessage.decode(buf);
  const out: PingRow[] = [];
  for (const entity of feed.entity) {
    const v = entity.vehicle;
    if (!v?.position || v.timestamp === null || v.timestamp === undefined) continue;
    const ts = toNumber(v.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const ms = ts * 1000;
    if (fetchedAtMs - ms > MAX_AGE_S * 1000 || ms - fetchedAtMs > MAX_FUTURE_S * 1000) continue;
    const { latitude, longitude, bearing } = v.position;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const startDate = v.trip?.startDate;
    const serviceDate = startDate && /^\d{8}$/.test(startDate) ? `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6)}` : serviceDateOf(ms);
    const vehicleId = v.vehicle?.id || v.vehicle?.label || entity.id;
    if (!vehicleId) continue;
    out.push([
      serviceDate,
      secondsOfService(ms, serviceDate),
      vehicleId,
      v.trip?.tripId || null,
      v.trip?.routeId || null,
      round6(latitude),
      round6(longitude),
      typeof bearing === 'number' && Number.isFinite(bearing) ? Math.round(bearing) : null,
    ]);
  }
  return out;
}

/**
 * Merges raw files into one day: rows re-based to the file's date, deduplicated on (vehicle, t)
 * and sorted by vehicle then time; fetch times merged and sorted.
 */
export function compactDay(serviceDate: string, files: Pick<RawFile, 'fetches' | 'rows'>[], existing?: GpsDayFile | null): GpsDayFile {
  const base = serviceMidnight(serviceDate);
  const seen = new Set<string>();
  const pings: GpsPing[] = [];
  const add = (p: GpsPing) => {
    const k = `${p[1]}|${p[0]}`;
    if (seen.has(k)) return;
    seen.add(k);
    pings.push(p);
  };
  for (const p of existing?.pings ?? []) add(p);
  const fetches = new Set<number>(existing?.fetches ?? []);
  for (const f of files) {
    for (const t of f.fetches) fetches.add(t);
    for (const [date, t, vehicleId, tripId, routeId, lat, lon, bearing] of f.rows) {
      const shift = date === serviceDate ? 0 : Math.round((serviceMidnight(date) - base) / 1000);
      add([t + shift, vehicleId, tripId, routeId, lat, lon, bearing]);
    }
  }
  pings.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] - b[0]));
  return { schema: GPS_DAY_SCHEMA, serviceDate, feedUrl: FEED_URL, fetches: [...fetches].sort((a, b) => a - b), pings };
}

/** Adds raw objects (by name) to today's snapshot; objects already merged are skipped. */
export function mergeToday(serviceDate: string, existing: TodayFile | null, raws: { name: string; file: Pick<RawFile, 'fetches' | 'rows'> }[]): TodayFile {
  const merged = new Set(existing?.merged ?? []);
  const fresh = raws.filter((r) => !merged.has(r.name));
  for (const r of fresh) merged.add(r.name);
  return { ...compactDay(serviceDate, fresh.map((r) => r.file), existing), merged: [...merged].sort() };
}
