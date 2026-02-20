#!/usr/bin/env node
/**
 * One-off backfill: recompute missed trips for stored performance summaries.
 *
 * Usage:
 *   node functions/scripts/backfill-missed-trips.mjs --teamId <TEAM_ID> --dry-run
 *   node functions/scripts/backfill-missed-trips.mjs --teamId <TEAM_ID> --apply
 *   node functions/scripts/backfill-missed-trips.mjs --teamId <TEAM_ID> --apply --delete-old
 *
 * Notes:
 * - Requires Firebase Admin credentials (for example: GOOGLE_APPLICATION_CREDENTIALS).
 * - Rewrites Storage JSON and updates teams/{teamId}/performanceData/metadata.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const DEFAULT_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'barrie-scheduler-7844a.firebasestorage.app';
const MATCH_TOLERANCE_MINS = 15;
const MIN_DAY_MATCH_RATIO = 0.25;
const MIN_ROUTE_MATCH_RATIO = 0.1;
const LATE_CLASSIFICATION_WINDOW_MINS = 60;

const ONTARIO_HOLIDAYS = {
  '2025-12-25': 'sunday',
  '2025-12-26': 'sunday',
  '2026-01-01': 'sunday',
  '2026-02-16': 'sunday',
};

function printUsage() {
  console.log(`
Backfill missed trips in stored performance summaries.

Options:
  --teamId <id>     Team ID (default: ${DEFAULT_TEAM_ID})
  --bucket <name>   Firebase Storage bucket (default: ${DEFAULT_BUCKET})
  --dry-run         Preview only (default)
  --apply           Write updated JSON + metadata
  --delete-old      Delete prior storage JSON after successful write (with --apply)
  --help            Show this help
`);
}

function parseArgs(argv) {
  const out = {
    teamId: DEFAULT_TEAM_ID,
    bucket: DEFAULT_BUCKET,
    apply: false,
    deleteOld: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--teamId' && argv[i + 1]) {
      out.teamId = argv[++i];
    } else if (a === '--bucket' && argv[i + 1]) {
      out.bucket = argv[++i];
    } else if (a === '--apply') {
      out.apply = true;
    } else if (a === '--dry-run') {
      out.apply = false;
    } else if (a === '--delete-old') {
      out.deleteOld = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return out;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  values.push(current);
  return values;
}

function parseCsv(raw, mapper) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const hdr = new Map(headers.map((h, i) => [h, i]));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const mapped = mapper(cols, hdr);
    if (mapped) out.push(mapped);
  }
  return out;
}

function toGtfsDate(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}

function normalizeDayType(dayType, dateStr) {
  if (dayType === 'weekday' || dayType === 'saturday' || dayType === 'sunday') return dayType;
  if (dayType === 'SATURDAY') return 'saturday';
  if (dayType === 'SUNDAY') return 'sunday';
  const d = new Date(`${dateStr}T12:00:00`);
  const dow = d.getDay();
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

function calendarMatchesDayType(cal, dayType) {
  if (dayType === 'weekday') return cal.days[0] || cal.days[1] || cal.days[2] || cal.days[3] || cal.days[4];
  if (dayType === 'saturday') return cal.days[5];
  return cal.days[6];
}

function parseTimeToMinutes(raw) {
  const value = String(raw ?? '').trim();
  const m = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || mm < 0 || mm > 59 || h < 0) return null;
  return h * 60 + mm;
}

function minuteOfDay(totalMinutes) {
  return ((totalMinutes % 1440) + 1440) % 1440;
}

function minuteKey(routeId, minute) {
  return `${routeId}|${minute}`;
}

function circularSignedDelta(fromMinute, toMinute) {
  let diff = toMinute - fromMinute;
  while (diff > 720) diff -= 1440;
  while (diff <= -720) diff += 1440;
  return diff;
}

function buildObservedByRoute(trips) {
  const byRoute = new Map();
  for (const t of trips) {
    const mins = parseTimeToMinutes(t.terminalDepartureTime);
    if (mins === null) continue;
    const arr = byRoute.get(t.routeId) || [];
    arr.push({ minute: minuteOfDay(mins), used: false });
    byRoute.set(t.routeId, arr);
  }
  for (const arr of byRoute.values()) {
    arr.sort((a, b) => a.minute - b.minute);
  }
  return byRoute;
}

function findBestObserved(entries, scheduledMinute, predicate, score) {
  let best = null;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].used) continue;
    const delta = circularSignedDelta(scheduledMinute, entries[i].minute);
    if (!predicate(delta)) continue;
    const s = score(delta);
    if (!best || s < best.score) best = { index: i, delta, score: s };
  }
  return best ? { index: best.index, delta: best.delta } : null;
}

function buildObservedKeys(observedTrips) {
  const keys = new Set();
  for (const t of observedTrips) {
    const mins = parseTimeToMinutes(t.terminalDepartureTime);
    if (mins === null) continue;
    keys.add(minuteKey(t.routeId, minuteOfDay(mins)));
  }
  return keys;
}

function hasRouteTimeMatch(routeId, departure, keys) {
  const mins = parseTimeToMinutes(departure);
  if (mins === null) return false;
  for (let offset = -MATCH_TOLERANCE_MINS; offset <= MATCH_TOLERANCE_MINS; offset++) {
    const adj = minuteOfDay(mins + offset);
    if (keys.has(minuteKey(routeId, adj))) return true;
  }
  return false;
}

function countRouteTimeMatches(scheduled, keys) {
  let n = 0;
  for (const s of scheduled) {
    if (hasRouteTimeMatch(s.routeId, s.departure, keys)) n++;
  }
  return n;
}

function evaluateCandidate(scheduled, observedRoutes, observedKeys) {
  const relevantScheduled = scheduled.filter(s => observedRoutes.has(s.routeId));
  const routeStats = new Map();
  let matched = 0;

  for (const s of relevantScheduled) {
    const stats = routeStats.get(s.routeId) || { scheduled: 0, matched: 0 };
    stats.scheduled++;
    const isMatch = hasRouteTimeMatch(s.routeId, s.departure, observedKeys);
    if (isMatch) {
      matched++;
      stats.matched++;
    }
    routeStats.set(s.routeId, stats);
  }

  return {
    relevantScheduled,
    matched,
    matchRatio: relevantScheduled.length > 0 ? (matched / relevantScheduled.length) : 0,
    routeStats,
  };
}

function isBetterServiceCandidate(next, current) {
  if (next.matchRatio !== current.matchRatio) return next.matchRatio > current.matchRatio;
  if (next.matched !== current.matched) return next.matched > current.matched;
  return next.relevantScheduled.length < current.relevantScheduled.length;
}

function isRouteReliable(stats) {
  if (!stats || stats.scheduled <= 0 || stats.matched <= 0) return false;
  return (stats.matched / stats.scheduled) >= MIN_ROUTE_MATCH_RATIO;
}

function loadGtfsState(rootDir) {
  const tripsRaw = readFileSync(path.join(rootDir, 'gtfs', 'trips.txt'), 'utf8');
  const calendarRaw = readFileSync(path.join(rootDir, 'gtfs', 'calendar.txt'), 'utf8');
  const calendarDatesRaw = readFileSync(path.join(rootDir, 'gtfs', 'calendar_dates.txt'), 'utf8');
  const tripIndex = JSON.parse(readFileSync(path.join(rootDir, 'data', 'gtfsTripIndex.json'), 'utf8'));

  const trips = parseCsv(tripsRaw, (cols, hdr) => ({
    routeId: cols[hdr.get('route_id')]?.trim() ?? '',
    serviceId: cols[hdr.get('service_id')]?.trim() ?? '',
    tripId: cols[hdr.get('trip_id')]?.trim() ?? '',
    headsign: cols[hdr.get('trip_headsign')]?.trim() ?? '',
    blockId: cols[hdr.get('block_id')]?.trim() ?? '',
  }));

  const calendar = parseCsv(calendarRaw, (cols, hdr) => ({
    serviceId: cols[hdr.get('service_id')]?.trim() ?? '',
    days: [
      cols[hdr.get('monday')]?.trim() === '1',
      cols[hdr.get('tuesday')]?.trim() === '1',
      cols[hdr.get('wednesday')]?.trim() === '1',
      cols[hdr.get('thursday')]?.trim() === '1',
      cols[hdr.get('friday')]?.trim() === '1',
      cols[hdr.get('saturday')]?.trim() === '1',
      cols[hdr.get('sunday')]?.trim() === '1',
    ],
    startDate: cols[hdr.get('start_date')]?.trim() ?? '',
    endDate: cols[hdr.get('end_date')]?.trim() ?? '',
  }));

  const calendarDates = parseCsv(calendarDatesRaw, (cols, hdr) => {
    const et = Number.parseInt(cols[hdr.get('exception_type')]?.trim() ?? '0', 10);
    if (et !== 1 && et !== 2) return null;
    return {
      serviceId: cols[hdr.get('service_id')]?.trim() ?? '',
      date: cols[hdr.get('date')]?.trim() ?? '',
      exceptionType: et,
    };
  });

  const calendarDatesByDate = new Map();
  for (const cd of calendarDates) {
    const arr = calendarDatesByDate.get(cd.date) || [];
    arr.push(cd);
    calendarDatesByDate.set(cd.date, arr);
  }

  const tripsByService = new Map();
  for (const t of trips) {
    const arr = tripsByService.get(t.serviceId) || [];
    arr.push(t);
    tripsByService.set(t.serviceId, arr);
  }

  return { trips, calendar, calendarDatesByDate, tripsByService, departureIndex: tripIndex };
}

function hasGtfsCoverage(gtfs, dateStr) {
  const gtfsDate = toGtfsDate(dateStr);
  return gtfs.calendar.some(c => gtfsDate >= c.startDate && gtfsDate <= c.endDate);
}

function getTripsForDayType(gtfs, dateStr, dayType) {
  const gtfsDate = toGtfsDate(dateStr);
  const exceptions = gtfs.calendarDatesByDate.get(gtfsDate) || [];
  const activeServices = new Set();

  for (const cal of gtfs.calendar) {
    if (gtfsDate < cal.startDate || gtfsDate > cal.endDate) continue;
    if (!calendarMatchesDayType(cal, dayType)) continue;
    activeServices.add(cal.serviceId);
  }

  for (const ex of exceptions) {
    if (ex.exceptionType === 1) activeServices.add(ex.serviceId);
    else activeServices.delete(ex.serviceId);
  }

  const out = [];
  for (const serviceId of activeServices) {
    const serviceTrips = gtfs.tripsByService.get(serviceId) || [];
    for (const t of serviceTrips) {
      const departure = gtfs.departureIndex[t.tripId];
      if (!departure) continue;
      out.push({
        tripId: t.tripId,
        routeId: t.routeId,
        headsign: t.headsign,
        blockId: t.blockId,
        departure,
        serviceId: t.serviceId,
      });
    }
  }

  return out.sort((a, b) => a.departure.localeCompare(b.departure));
}

function resolveServiceType(dateStr, dayType) {
  return ONTARIO_HOLIDAYS[dateStr] || dayType;
}

function getScheduledTrips(gtfs, dateStr, dayType) {
  return getTripsForDayType(gtfs, dateStr, resolveServiceType(dateStr, dayType));
}

function computeMissedTripsForDay(gtfs, date, dayType, observedTrips) {
  if (!hasGtfsCoverage(gtfs, date)) return null;
  const observedRoutes = new Set(observedTrips.map(t => t.routeId).filter(Boolean));
  if (observedRoutes.size === 0) return null;
  const observedKeys = buildObservedKeys(observedTrips);

  let best = evaluateCandidate(getScheduledTrips(gtfs, date, dayType), observedRoutes, observedKeys);
  if (best.relevantScheduled.length > 0 && best.matchRatio < MIN_DAY_MATCH_RATIO) {
    for (const dt of ['weekday', 'saturday', 'sunday']) {
      const next = evaluateCandidate(getTripsForDayType(gtfs, date, dt), observedRoutes, observedKeys);
      if (isBetterServiceCandidate(next, best)) best = next;
    }
  }

  if (best.relevantScheduled.length === 0 || best.matchRatio < MIN_DAY_MATCH_RATIO) return null;

  const reliableRoutes = new Set();
  for (const [routeId, stats] of best.routeStats.entries()) {
    if (isRouteReliable(stats)) reliableRoutes.add(routeId);
  }
  if (reliableRoutes.size === 0) return null;

  const reliableScheduled = best.relevantScheduled.filter(s => reliableRoutes.has(s.routeId));
  const dayMatched = countRouteTimeMatches(reliableScheduled, observedKeys);
  if (reliableScheduled.length === 0 || (dayMatched / reliableScheduled.length) < MIN_DAY_MATCH_RATIO) return null;

  const observedByRoute = buildObservedByRoute(observedTrips.filter(t => reliableRoutes.has(t.routeId)));
  const scheduledOrdered = [...reliableScheduled].sort((a, b) => {
    const routeCmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (routeCmp !== 0) return routeCmp;
    const aMin = parseTimeToMinutes(a.departure);
    const bMin = parseTimeToMinutes(b.departure);
    if (aMin === null && bMin === null) return 0;
    if (aMin === null) return 1;
    if (bMin === null) return -1;
    return minuteOfDay(aMin) - minuteOfDay(bMin);
  });

  let matchedCount = 0;
  const unmatched = [];
  for (const s of scheduledOrdered) {
    const depRaw = parseTimeToMinutes(s.departure);
    const depMin = depRaw === null ? null : minuteOfDay(depRaw);
    if (depMin === null) {
      unmatched.push({ s, depMin });
      continue;
    }
    const entries = observedByRoute.get(s.routeId) || [];
    const exact = findBestObserved(
      entries,
      depMin,
      (delta) => Math.abs(delta) <= MATCH_TOLERANCE_MINS,
      (delta) => Math.abs(delta),
    );
    if (exact) {
      entries[exact.index].used = true;
      matchedCount++;
      continue;
    }
    unmatched.push({ s, depMin });
  }

  const missedTrips = [];
  let notPerformedCount = 0;
  let lateOver15Count = 0;
  const missedByRoute = new Map();
  for (const { s, depMin } of unmatched) {
    const entries = observedByRoute.get(s.routeId) || [];
    const late = depMin === null
      ? null
      : findBestObserved(
        entries,
        depMin,
        (delta) => delta > MATCH_TOLERANCE_MINS && delta <= LATE_CLASSIFICATION_WINDOW_MINS,
        (delta) => delta,
      );

    if (late) {
      entries[late.index].used = true;
      lateOver15Count++;
      missedTrips.push({
        tripId: s.tripId,
        routeId: s.routeId,
        departure: s.departure,
        headsign: s.headsign,
        blockId: s.blockId,
        serviceId: s.serviceId,
        missType: 'late_over_15',
        lateByMinutes: Math.round(late.delta),
      });
    } else {
      notPerformedCount++;
      missedTrips.push({
        tripId: s.tripId,
        routeId: s.routeId,
        departure: s.departure,
        headsign: s.headsign,
        blockId: s.blockId,
        serviceId: s.serviceId,
        missType: 'not_performed',
      });
    }

    const existing = missedByRoute.get(s.routeId);
    if (existing) {
      existing.count++;
      if (s.departure < existing.earliestDep) existing.earliestDep = s.departure;
    } else {
      missedByRoute.set(s.routeId, { routeId: s.routeId, count: 1, earliestDep: s.departure });
    }
  }

  const totalMissed = missedTrips.length;
  return {
    totalScheduled: scheduledOrdered.length,
    totalMatched: matchedCount,
    totalMissed,
    missedPct: (totalMissed / scheduledOrdered.length) * 100,
    notPerformedCount,
    lateOver15Count,
    byRoute: Array.from(missedByRoute.values()).sort((a, b) => b.count - a.count),
    trips: missedTrips.sort((a, b) => {
      const typeCmp = a.missType.localeCompare(b.missType);
      if (typeCmp !== 0) return typeCmp;
      const routeCmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
      if (routeCmp !== 0) return routeCmp;
      const depCmp = a.departure.localeCompare(b.departure);
      if (depCmp !== 0) return depCmp;
      return a.tripId.localeCompare(b.tripId);
    }),
  };
}

function getTotalRecords(summary) {
  if (typeof summary?.metadata?.totalRecords === 'number') return summary.metadata.totalRecords;
  return (summary?.dailySummaries || []).reduce((acc, d) => acc + (d?.dataQuality?.totalRecords || 0), 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(here, '../..');
  const gtfs = loadGtfsState(rootDir);

  initializeApp({ storageBucket: args.bucket });
  const db = getFirestore();
  const bucket = getStorage().bucket(args.bucket);

  const metadataRef = db.doc(`teams/${args.teamId}/performanceData/metadata`);
  const metadataSnap = await metadataRef.get();
  if (!metadataSnap.exists) {
    throw new Error(`No metadata found for team ${args.teamId}`);
  }

  const metadata = metadataSnap.data();
  const oldStoragePath = metadata?.storagePath;
  if (!oldStoragePath) {
    throw new Error(`Metadata for team ${args.teamId} has no storagePath`);
  }

  const [buf] = await bucket.file(oldStoragePath).download();
  const summary = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(summary.dailySummaries)) {
    throw new Error('Stored summary has no dailySummaries array');
  }

  let changedDays = 0;
  let droppedDays = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  let notPerformedBefore = 0;
  let notPerformedAfter = 0;
  let lateOver15Before = 0;
  let lateOver15After = 0;

  for (const day of summary.dailySummaries) {
    const before = day.missedTrips ? JSON.stringify(day.missedTrips) : '';
    if (day.missedTrips?.totalMissed) {
      totalBefore += day.missedTrips.totalMissed;
      notPerformedBefore += day.missedTrips.notPerformedCount || 0;
      lateOver15Before += day.missedTrips.lateOver15Count || 0;
    }

    const normalizedDayType = normalizeDayType(day.dayType, day.date);
    const observedTrips = Array.isArray(day.byTrip)
      ? day.byTrip.map(t => ({
        routeId: t?.routeId || '',
        terminalDepartureTime: t?.terminalDepartureTime || '',
      }))
      : [];

    const next = computeMissedTripsForDay(gtfs, day.date, normalizedDayType, observedTrips);
    if (next) {
      day.missedTrips = next;
      totalAfter += next.totalMissed;
      notPerformedAfter += next.notPerformedCount || 0;
      lateOver15After += next.lateOver15Count || 0;
    } else {
      if (day.missedTrips) droppedDays++;
      delete day.missedTrips;
    }

    const after = day.missedTrips ? JSON.stringify(day.missedTrips) : '';
    if (before !== after) changedDays++;
  }

  console.log(`Team: ${args.teamId}`);
  console.log(`Storage path: ${oldStoragePath}`);
  console.log(`Days scanned: ${summary.dailySummaries.length}`);
  console.log(`Days changed: ${changedDays}`);
  console.log(`Days with missedTrips removed: ${droppedDays}`);
  console.log(`Total missed trips before: ${totalBefore}`);
  console.log(`  - not performed before: ${notPerformedBefore}`);
  console.log(`  - over 15 min late before: ${lateOver15Before}`);
  console.log(`Total missed trips after:  ${totalAfter}`);
  console.log(`  - not performed after:  ${notPerformedAfter}`);
  console.log(`  - over 15 min late after:  ${lateOver15After}`);

  if (!args.apply) {
    console.log('Dry run complete. No data written. Re-run with --apply to persist.');
    return;
  }

  const timestamp = Date.now().toString();
  const newStoragePath = `teams/${args.teamId}/performanceData/${timestamp}-missed-trips-backfill.json`;
  await bucket.file(newStoragePath).save(JSON.stringify(summary), {
    contentType: 'application/json',
  });

  const dates = summary.dailySummaries
    .map(d => d.date)
    .filter(Boolean)
    .sort();
  const dateRange = dates.length > 0
    ? { start: dates[0], end: dates[dates.length - 1] }
    : (summary.metadata?.dateRange || { start: '', end: '' });

  await metadataRef.set({
    importedAt: FieldValue.serverTimestamp(),
    importedBy: 'missed-trips-backfill',
    storagePath: newStoragePath,
    dateRange,
    dayCount: summary.dailySummaries.length,
    totalRecords: getTotalRecords(summary),
  }, { merge: true });

  if (args.deleteOld && oldStoragePath !== newStoragePath) {
    try {
      await bucket.file(oldStoragePath).delete();
      console.log(`Deleted old storage object: ${oldStoragePath}`);
    } catch (err) {
      console.warn(`Could not delete old storage object ${oldStoragePath}:`, err?.message || err);
    }
  }

  console.log(`Backfill applied. New storage path: ${newStoragePath}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exitCode = 1;
});
