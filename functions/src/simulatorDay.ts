/**
 * Simulator day feed — one service day of STREETS stop visits shaped for the City Simulator's
 * "replay yesterday" view. See docs/SIMULATOR_FEED.md.
 *
 * The types below are a published contract mirrored in City Simulator 2 (`src/data/streetsDay.ts`).
 * Change both together and bump SIMULATOR_DAY_SCHEMA on any breaking change.
 *
 * This module is pure: no Firebase access. Publication lives in simulatorDayPublish.ts.
 */
import { strFromU8, unzipSync } from 'fflate';
import { resolvePerformanceLoadCapacity } from './performanceLoadCapacity';
import type { PerformanceLoadCapacityConfig, STREETSRecord } from './types';

export const SIMULATOR_DAY_SCHEMA = 1;

export type SimulatorDayType = 'weekday' | 'saturday' | 'sunday';

/** GTFS feed_info for the feed a day was matched against (dates are YYYYMMDD, as in GTFS). */
export interface SimulatorFeedInfo {
  version: string | null;
  start: string | null;
  end: string | null;
}

/**
 * One stop visit:
 * [stopId, routeStopIndex, schedArr, schedDep, obsArr, obsDep, boardings, alightings, load, flags]
 *
 * Times are seconds after midnight of the service day on the GTFS clock (late trips exceed 24h).
 * stopId is the GTFS stop_id when it resolved, else `streets:<STREETS StopID>`. obsArr/obsDep are
 * null where AVL missed the visit. load is passengers on board leaving the stop, null when the APC
 * reading isn't trustworthy. Boardings/alightings include InBetween updates at the same position.
 */
export type SimulatorVisit = [
  stopId: string,
  routeStopIndex: number,
  schedArr: number,
  schedDep: number,
  obsArr: number | null,
  obsDep: number | null,
  boardings: number,
  alightings: number,
  load: number | null,
  flags: number,
];

export const VISIT_TIMEPOINT = 1;
/** Only passenger counts were reported here (no operational stop event): ignore its times. */
export const VISIT_PASSENGER_ONLY = 2;

export type SimulatorTripMatch = 'trip-id' | 'first-stop-time';

export interface SimulatorTrip {
  /** STREETS TripID. */
  id: string;
  gtfsTripId: string | null;
  match: SimulatorTripMatch | null;
  routeId: string;
  routeName: string;
  direction: string;
  tripName: string;
  block: string;
  vehicle: string;
  /** Scheduled departure from the first terminal. */
  start: number;
  detour: boolean;
  tripper: boolean;
  /** Ordered by routeStopIndex. */
  visits: SimulatorVisit[];
}

export interface SimulatorDayQuality {
  rows: number;
  inBetweenRows: number;
  duplicateRows: number;
  missingAvl: number;
  missingApc: number;
  loadCapped: number;
  trips: number;
  tripsMatched: number;
}

export interface SimulatorUnresolvedStop {
  name: string;
  /** As exported by STREETS: rounded to about 1 km. */
  lat: number;
  lon: number;
}

export interface SimulatorDay {
  schema: typeof SIMULATOR_DAY_SCHEMA;
  serviceDate: string;
  dayType: SimulatorDayType;
  generatedAt: string;
  source: { kind: 'streets-csv'; name: string; sha256: string };
  gtfs: SimulatorFeedInfo & { covers: boolean; origin: string };
  quality: SimulatorDayQuality;
  trips: SimulatorTrip[];
  /**
   * Each stop that did not resolve to GTFS, keyed by its visit id (`streets:<StopID>`): mostly
   * temporary detour stops. STREETS exports coordinates rounded to 2 decimals (about 1 km), so the
   * name (e.g. "Temporary Stop - Leacock at Broadfoot") is what locates the stop; lat/lon only narrow
   * the search. Optional and additive (readers of schema 1 ignore it).
   */
  stops?: Record<string, SimulatorUnresolvedStop>;
}

/** Days available to replay, newest first (what the feed index returns). */
export interface SimulatorDayIndexEntry {
  date: string;
  dayType: SimulatorDayType;
  gtfsVersion: string | null;
  trips: number;
  tripsMatched: number;
}

// ---------- time helpers ----------

/** Seconds after midnight from "H:MM[:SS]", an Excel day fraction, or a date-time (its time part). */
export function parseClockSeconds(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round((n - Math.floor(n)) * 86400);
}

/** Puts a clock time on the same day as `base` (handles trips crossing midnight). */
const near = (t: number, base: number) => t + 86400 * Math.round((base - t) / 86400);

function dayTypeOf(date: string, dayColumn: string): SimulatorDayType {
  const col = dayColumn.trim().toUpperCase();
  if (col.startsWith('SAT')) return 'saturday';
  if (col.startsWith('SUN')) return 'sunday';
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow === 6 ? 'saturday' : dow === 0 ? 'sunday' : 'weekday';
}

// ---------- GTFS index for matching ----------

export interface SimulatorGtfsIndex {
  feed: SimulatorFeedInfo;
  /** STREETS stop id → GTFS stop_id (by id, else by stop_code). */
  stop: (id: string) => string | null;
  /** Trip ids running on the service date. */
  activeTrip: (id: string) => boolean;
  /** `${stop_id}|${seconds}` → [trip_id, route short name] for active trips' first departures. */
  byFirstStop: Map<string, [string, string][]>;
  firstDep: Map<string, number>;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

/** Calls `row` for each record of a GTFS table, reading only the named columns. */
function eachRow(text: string | undefined, columns: string[], row: (values: string[]) => void): void {
  if (!text) return;
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  const idx = columns.map(c => header.indexOf(c));
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = splitCsvLine(lines[i]);
    row(idx.map(j => (j >= 0 ? values[j] ?? '' : '')));
  }
}

function activeServiceIds(calendar: string | undefined, calendarDates: string | undefined, date: string): Set<string> {
  const day = date.replaceAll('-', '');
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const out = new Set<string>();
  eachRow(calendar, ['service_id', 'start_date', 'end_date', weekday], ([id, start, end, runs]) => {
    if (start <= day && day <= end && runs === '1') out.add(id);
  });
  eachRow(calendarDates, ['service_id', 'date', 'exception_type'], ([id, d, type]) => {
    if (d !== day) return;
    if (type === '1') out.add(id);
    else out.delete(id);
  });
  return out;
}

/** Builds the matching index for one service date from a GTFS zip. */
export function indexGtfsZip(zip: Uint8Array, date: string): SimulatorGtfsIndex {
  const files = unzipSync(zip);
  const text = (name: string) => {
    const key = Object.keys(files).find(k => (k.split('/').pop() ?? '').toLowerCase() === name);
    return key ? strFromU8(files[key]) : undefined;
  };

  let feed: SimulatorFeedInfo = { version: null, start: null, end: null };
  eachRow(text('feed_info.txt'), ['feed_version', 'feed_start_date', 'feed_end_date'], ([version, start, end]) => {
    if (!feed.version && !feed.start) feed = { version: version || null, start: start || null, end: end || null };
  });

  const stopIds = new Set<string>();
  const byCode = new Map<string, string>();
  eachRow(text('stops.txt'), ['stop_id', 'stop_code'], ([id, code]) => {
    stopIds.add(id);
    if (code && !byCode.has(code)) byCode.set(code, id);
  });

  const routeName = new Map<string, string>();
  eachRow(text('routes.txt'), ['route_id', 'route_short_name'], ([id, name]) => routeName.set(id, name || id));

  const services = activeServiceIds(text('calendar.txt'), text('calendar_dates.txt'), date);
  const active = new Map<string, string>();
  eachRow(text('trips.txt'), ['trip_id', 'route_id', 'service_id'], ([trip, route, service]) => {
    if (services.has(service)) active.set(trip, routeName.get(route) ?? route);
  });

  const first = new Map<string, { seq: number; stop: string; dep: number }>();
  eachRow(text('stop_times.txt'), ['trip_id', 'stop_sequence', 'stop_id', 'departure_time', 'arrival_time'], ([trip, seq, stop, dep, arr]) => {
    if (!active.has(trip)) return;
    const n = Number(seq);
    const cur = first.get(trip);
    if (!cur || n < cur.seq) first.set(trip, { seq: n, stop, dep: parseClockSeconds(dep || arr) ?? 0 });
  });

  const byFirstStop = new Map<string, [string, string][]>();
  const firstDep = new Map<string, number>();
  for (const [trip, f] of first) {
    const key = `${f.stop}|${f.dep}`;
    const list = byFirstStop.get(key);
    if (list) list.push([trip, active.get(trip)!]);
    else byFirstStop.set(key, [[trip, active.get(trip)!]]);
    firstDep.set(trip, f.dep);
  }

  return {
    feed,
    stop: id => (stopIds.has(id) ? id : byCode.get(id) ?? null),
    activeTrip: id => active.has(id),
    byFirstStop,
    firstDep,
  };
}

export interface ArchivedGtfsSnapshot {
  snapshotId: string;
  zipPath: string;
  fetchedAt: string;
  feedStartDate: string | null;
  feedEndDate: string | null;
}

/**
 * The archived feed for a service date: the newest snapshot whose range covers it, else the newest
 * snapshot overall (the day is then marked as not covered rather than left unmatched).
 */
export function selectGtfsSnapshot(snapshots: ArchivedGtfsSnapshot[], date: string): { snapshot: ArchivedGtfsSnapshot; covers: boolean } | null {
  const day = date.replaceAll('-', '');
  const newestFirst = [...snapshots].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const covering = newestFirst.find(s => s.feedStartDate && s.feedEndDate && s.feedStartDate <= day && day <= s.feedEndDate);
  if (covering) return { snapshot: covering, covers: true };
  return newestFirst[0] ? { snapshot: newestFirst[0], covers: false } : null;
}

// ---------- building days ----------

interface Visit {
  stopId: string;
  idx: number;
  schedArr: number;
  schedDep: number;
  obsArr: number | null;
  obsDep: number | null;
  on: number;
  off: number;
  load: number | null;
  timepoint: boolean;
  passengerOnly: boolean;
}

export interface BuildSimulatorDayOptions {
  serviceDate: string;
  gtfs: SimulatorGtfsIndex | null;
  gtfsOrigin: string;
  gtfsCovers: boolean;
  loadCapacity: PerformanceLoadCapacityConfig;
  source: { name: string; sha256: string };
  generatedAt?: string;
}

function tripKeyOf(r: STREETSRecord): string {
  if (r.tripId?.trim()) return r.tripId.trim();
  if (Number.isFinite(r.internalTripId) && r.internalTripId > 0) return `internal:${r.internalTripId}`;
  return JSON.stringify([r.vehicleId, r.block, r.tripName, r.terminalDepartureTime]);
}

/**
 * Builds one service day from parsed STREETS records (records for other dates are ignored).
 * Follows the Operations Dashboard rules: duplicate terminal observations keep the one closest to
 * schedule, InBetween rows are passenger-only, loads need APCSource > 0 and are capped at the
 * vehicle's configured capacity. Operator identity is never copied.
 */
export function buildSimulatorDay(records: STREETSRecord[], options: BuildSimulatorDayOptions): SimulatorDay {
  const { serviceDate, gtfs } = options;
  const rows = records.filter(r => r.date === serviceDate);
  const quality: SimulatorDayQuality = {
    rows: rows.length, inBetweenRows: 0, duplicateRows: 0, missingAvl: 0, missingApc: 0, loadCapped: 0, trips: 0, tripsMatched: 0,
  };

  const byTrip = new Map<string, STREETSRecord[]>();
  for (const r of rows) {
    const key = tripKeyOf(r);
    const list = byTrip.get(key);
    if (list) list.push(r);
    else byTrip.set(key, [r]);
  }

  const trips: SimulatorTrip[] = [];
  for (const [tripKey, tripRows] of byTrip) {
    const head = tripRows.find(r => !r.inBetween) ?? tripRows[0];
    const start = parseClockSeconds(head.terminalDepartureTime) ?? parseClockSeconds(head.stopTime) ?? 0;
    const time = (raw: string | null) => {
      const t = parseClockSeconds(raw);
      return t === null ? null : near(t, start);
    };

    const visits = new Map<string, Visit>();
    const passengerOnlyRows: STREETSRecord[] = [];
    for (const r of tripRows) {
      if (r.inBetween) {
        quality.inBetweenRows++;
        passengerOnlyRows.push(r);
        continue;
      }
      const key = `${r.stopId}|${r.routeStopIndex}`;
      const schedDep = time(r.stopTime) ?? 0;
      const obsDep = time(r.observedDepartureTime);
      const prev = visits.get(key);
      if (prev) {
        quality.duplicateRows++;
        const prevOff = prev.obsDep === null ? Infinity : Math.abs(prev.obsDep - prev.schedDep);
        const off = obsDep === null ? Infinity : Math.abs(obsDep - schedDep);
        if (off >= prevOff) continue;
      }
      let load: number | null = r.apcSource > 0 && r.departureLoad >= 0 ? r.departureLoad : null;
      const capacity = resolvePerformanceLoadCapacity(options.loadCapacity, r.vehicleId);
      if (load !== null && load > capacity) {
        load = capacity;
        quality.loadCapped++;
      }
      visits.set(key, {
        stopId: r.stopId.trim(),
        idx: r.routeStopIndex,
        schedArr: time(r.arrivalTime) ?? schedDep,
        schedDep,
        obsArr: time(r.observedArrivalTime),
        obsDep,
        on: r.boardings,
        off: r.alightings,
        load,
        timepoint: r.timePoint,
        passengerOnly: false,
      });
    }
    for (const r of passengerOnlyRows) {
      const key = `${r.stopId}|${r.routeStopIndex}`;
      const v = visits.get(key);
      if (v) {
        v.on += r.boardings;
        v.off += r.alightings;
        continue;
      }
      const t = time(r.stopTime) ?? 0;
      visits.set(key, {
        stopId: r.stopId.trim(), idx: r.routeStopIndex, schedArr: t, schedDep: t, obsArr: null, obsDep: null,
        on: r.boardings, off: r.alightings, load: null, timepoint: false, passengerOnly: true,
      });
    }

    const ordered = [...visits.values()].sort((a, b) => a.idx - b.idx);
    const operational = ordered.filter(v => !v.passengerOnly);
    if (!operational.length) continue; // passenger-only trips aren't trip evidence
    for (const v of operational) {
      if (v.obsArr === null && v.obsDep === null) quality.missingAvl++;
      if (v.load === null) quality.missingApc++;
    }

    // Same trip id first, else the active trip leaving the same first stop at the same time.
    let gtfsTripId: string | null = null;
    let match: SimulatorTripMatch | null = null;
    const sourceId = head.tripId?.trim() ?? '';
    if (gtfs && sourceId && gtfs.activeTrip(sourceId)) {
      gtfsTripId = sourceId;
      match = 'trip-id';
    } else if (gtfs) {
      const firstStop = gtfs.stop(operational[0].stopId);
      if (firstStop) {
        const dep = operational[0].schedDep;
        const routeName = head.routeName?.trim().toLowerCase();
        const routeId = head.routeId?.trim().toLowerCase();
        for (const t of [dep, dep + 86400, start, start + 86400]) {
          const candidates = gtfs.byFirstStop.get(`${firstStop}|${t}`);
          if (!candidates) continue;
          const pick = candidates.find(([, name]) => name.toLowerCase() === routeName || name.toLowerCase() === routeId)
            ?? (candidates.length === 1 ? candidates[0] : null);
          if (pick) {
            gtfsTripId = pick[0];
            match = 'first-stop-time';
            break;
          }
        }
      }
    }
    // Put the trip on the GTFS clock (a 00:30 trip may be 24:30 in the feed).
    const gtfsStart = gtfsTripId !== null ? gtfs?.firstDep.get(gtfsTripId) : undefined;
    const shift = gtfsStart === undefined ? 0 : 86400 * Math.round((gtfsStart - start) / 86400);
    const sh = (t: number | null) => (t === null ? null : t + shift);

    quality.trips++;
    if (gtfsTripId) quality.tripsMatched++;
    trips.push({
      id: sourceId || tripKey,
      gtfsTripId,
      match,
      routeId: head.routeId?.trim() ?? '',
      routeName: head.routeName?.trim() ?? '',
      direction: head.direction?.trim() ?? '',
      tripName: head.tripName?.trim() ?? '',
      block: head.block?.trim() ?? '',
      vehicle: head.vehicleId?.trim() ?? '',
      start: start + shift,
      detour: tripRows.some(r => r.isDetour),
      tripper: head.isTripper,
      visits: ordered.map((v): SimulatorVisit => [
        (gtfs?.stop(v.stopId)) ?? `streets:${v.stopId}`,
        v.idx,
        v.schedArr + shift,
        v.schedDep + shift,
        sh(v.obsArr),
        sh(v.obsDep),
        v.on,
        v.off,
        v.load,
        (v.timepoint ? VISIT_TIMEPOINT : 0) | (v.passengerOnly ? VISIT_PASSENGER_ONLY : 0),
      ]),
    });
  }
  trips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  // Where the unresolved (mostly temporary detour) stops are, so consumers can place them.
  const stops: Record<string, SimulatorUnresolvedStop> = {};
  for (const r of rows) {
    const id = r.stopId.trim();
    if (!id || gtfs?.stop(id)) continue;
    const key = `streets:${id}`;
    if (key in stops) continue;
    stops[key] = {
      name: r.stopName?.trim() ?? '',
      lat: Number.isFinite(r.stopLat) ? r.stopLat : 0,
      lon: Number.isFinite(r.stopLon) ? r.stopLon : 0,
    };
  }

  return {
    schema: SIMULATOR_DAY_SCHEMA,
    serviceDate,
    dayType: dayTypeOf(serviceDate, rows[0]?.day ?? ''),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: { kind: 'streets-csv', ...options.source },
    gtfs: { ...(gtfs?.feed ?? { version: null, start: null, end: null }), covers: options.gtfsCovers, origin: options.gtfsOrigin },
    quality,
    trips,
    ...(Object.keys(stops).length ? { stops } : {}),
  };
}

// ---------- publication bookkeeping (pure parts) ----------

/** Where the feed stores one day's generation. */
export function simulatorDayStoragePath(teamId: string, date: string, generation: string): string {
  return `teams/${teamId}/performanceViews/simulator-days/${date}/${generation}.json`;
}

export interface SimulatorDayPointer extends SimulatorDayIndexEntry {
  storagePath: string;
  sourceRevision: string;
  importId: string;
  generatedAt: string;
}

/**
 * Same-day corrections replace a day; an older import finishing late must not overwrite a newer one.
 * Revisions are Scheduler 4's sortable performance source revisions.
 */
export function shouldReplaceSimulatorDay(existing: Pick<SimulatorDayPointer, 'sourceRevision'> | undefined, incomingRevision: string): boolean {
  return !existing || existing.sourceRevision <= incomingRevision;
}

/** Keeps the same history window as detailed performance data, measured from the newest day. */
export const SIMULATOR_DAY_RETENTION_DAYS = 380;

export function expiredSimulatorDays(dates: string[]): string[] {
  if (!dates.length) return [];
  const newest = [...dates].sort().at(-1)!;
  const cutoff = new Date(`${newest}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - SIMULATOR_DAY_RETENTION_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return dates.filter(d => d < cutoffDate);
}

export function simulatorDayIndex(days: Record<string, SimulatorDayPointer>): SimulatorDayIndexEntry[] {
  return Object.values(days)
    .map(({ date, dayType, gtfsVersion, trips, tripsMatched }) => ({ date, dayType, gtfsVersion, trips, tripsMatched }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
