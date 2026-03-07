// GTFS Adapter — reads bundled gtfs/*.txt files into typed arrays
// CSV parsing patterns adapted from studentPassUtils.ts

import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import routesRaw from '../../gtfs/routes.txt?raw';
import stopsRaw from '../../gtfs/stops.txt?raw';
import calendarRaw from '../../gtfs/calendar.txt?raw';
import calendarDatesRaw from '../../gtfs/calendar_dates.txt?raw';

import type {
  GtfsStop,
  GtfsTrip,
  GtfsStopTime,
  GtfsRoute,
  CalendarEntry,
  CalendarDate,
  GtfsData,
} from './types';

// ─── CSV Parsing Helpers ────────────────────────────────────────────

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

function buildHeaderMap(headerLine: string): Map<string, number> {
  const headers = headerLine
    .replace(/^\uFEFF/, '') // Strip BOM
    .split(',')
    .map((h) => h.trim().replace(/"/g, ''));
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(h, i));
  return map;
}

/**
 * Parse GTFS time string "HH:MM:SS" to seconds since midnight.
 * Handles post-midnight values (e.g., "25:10:00" = 90600 seconds).
 */
export function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  return h * 3600 + m * 60 + s;
}

function parseLines(raw: string): string[] {
  return raw.trim().split(/\r?\n/);
}

// ─── Loaders ────────────────────────────────────────────────────────

let cached: GtfsData | null = null;

function loadStops(): GtfsStop[] {
  const lines = parseLines(stopsRaw);
  if (lines.length < 2) return [];

  const hdr = buildHeaderMap(lines[0]);
  const idIdx = hdr.get('stop_id') ?? -1;
  const nameIdx = hdr.get('stop_name') ?? -1;
  const latIdx = hdr.get('stop_lat') ?? -1;
  const lonIdx = hdr.get('stop_lon') ?? -1;

  const results: GtfsStop[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const stopId = cols[idIdx]?.trim();
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (!stopId || isNaN(lat) || isNaN(lon)) continue;
    results.push({
      stopId,
      stopName: cols[nameIdx]?.trim() ?? '',
      lat,
      lon,
    });
  }
  return results;
}

function loadStopTimes(): GtfsStopTime[] {
  const lines = parseLines(stopTimesRaw);
  if (lines.length < 2) return [];

  const hdr = buildHeaderMap(lines[0]);
  const tripIdx = hdr.get('trip_id') ?? -1;
  const arrIdx = hdr.get('arrival_time') ?? -1;
  const depIdx = hdr.get('departure_time') ?? -1;
  const stopIdx = hdr.get('stop_id') ?? -1;
  const seqIdx = hdr.get('stop_sequence') ?? -1;
  const pickupIdx = hdr.get('pickup_type') ?? -1;
  const dropOffIdx = hdr.get('drop_off_type') ?? -1;

  const results: GtfsStopTime[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const tripId = cols[tripIdx]?.trim();
    const stopId = cols[stopIdx]?.trim();
    if (!tripId || !stopId) continue;

    const arrStr = cols[arrIdx]?.trim();
    const depStr = cols[depIdx]?.trim();
    if (!arrStr && !depStr) continue;

    const arrivalTime = arrStr ? parseTimeToSeconds(arrStr) : 0;
    const departureTime = depStr ? parseTimeToSeconds(depStr) : arrivalTime;
    const stopSequence = parseInt(cols[seqIdx], 10) || 0;
    const pickupType = pickupIdx >= 0 ? parseInt(cols[pickupIdx], 10) || 0 : undefined;
    const dropOffType = dropOffIdx >= 0 ? parseInt(cols[dropOffIdx], 10) || 0 : undefined;

    results.push({
      tripId,
      stopId,
      arrivalTime,
      departureTime,
      stopSequence,
      pickupType,
      dropOffType,
    });
  }
  return results;
}

function loadTrips(): GtfsTrip[] {
  const lines = parseLines(tripsRaw);
  if (lines.length < 2) return [];

  const hdr = buildHeaderMap(lines[0]);
  const routeIdx = hdr.get('route_id') ?? -1;
  const svcIdx = hdr.get('service_id') ?? -1;
  const tripIdx = hdr.get('trip_id') ?? -1;
  const dirIdx = hdr.get('direction_id') ?? -1;
  const hsIdx = hdr.get('trip_headsign') ?? -1;
  const shapeIdx = hdr.get('shape_id') ?? -1;

  const results: GtfsTrip[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const tripId = cols[tripIdx]?.trim();
    const routeId = cols[routeIdx]?.trim();
    if (!tripId || !routeId) continue;

    results.push({
      tripId,
      routeId,
      serviceId: cols[svcIdx]?.trim() ?? '',
      directionId: parseInt(cols[dirIdx], 10) || 0,
      headsign: cols[hsIdx]?.trim() ?? '',
      shapeId: cols[shapeIdx]?.trim() || undefined,
    });
  }
  return results;
}

function loadRoutes(): GtfsRoute[] {
  const lines = parseLines(routesRaw);
  if (lines.length < 2) return [];

  const hdr = buildHeaderMap(lines[0]);
  const idIdx = hdr.get('route_id') ?? -1;
  const shortIdx = hdr.get('route_short_name') ?? -1;
  const longIdx = hdr.get('route_long_name') ?? -1;
  const colorIdx = hdr.get('route_color') ?? -1;

  const results: GtfsRoute[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const routeId = cols[idIdx]?.trim();
    if (!routeId) continue;

    results.push({
      routeId,
      routeShortName: cols[shortIdx]?.trim() ?? routeId,
      routeLongName: cols[longIdx]?.trim() || undefined,
      routeColor: cols[colorIdx]?.trim() || undefined,
    });
  }
  return results;
}

function loadCalendar(): CalendarEntry[] {
  const lines = parseLines(calendarRaw);
  if (lines.length < 2) return [];

  const hdr = buildHeaderMap(lines[0]);
  const svcIdx = hdr.get('service_id') ?? -1;
  const startIdx = hdr.get('start_date') ?? -1;
  const endIdx = hdr.get('end_date') ?? -1;

  const dayFields = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const dayIdxs = dayFields.map((d) => hdr.get(d) ?? -1);

  const results: CalendarEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const serviceId = cols[svcIdx]?.trim();
    if (!serviceId) continue;

    const entry: CalendarEntry = {
      serviceId,
      startDate: cols[startIdx]?.trim() ?? '',
      endDate: cols[endIdx]?.trim() ?? '',
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    };

    dayFields.forEach((day, idx) => {
      entry[day] = cols[dayIdxs[idx]]?.trim() === '1';
    });

    results.push(entry);
  }
  return results;
}

function loadCalendarDates(): CalendarDate[] {
  const lines = parseLines(calendarDatesRaw);
  if (lines.length < 2) return [];

  const hdr = buildHeaderMap(lines[0]);
  const svcIdx = hdr.get('service_id') ?? -1;
  const dateIdx = hdr.get('date') ?? -1;
  const typeIdx = hdr.get('exception_type') ?? -1;

  const results: CalendarDate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const serviceId = cols[svcIdx]?.trim();
    if (!serviceId) continue;

    const exceptionType = parseInt(cols[typeIdx], 10);
    if (exceptionType !== 1 && exceptionType !== 2) continue;

    results.push({
      serviceId,
      date: cols[dateIdx]?.trim() ?? '',
      exceptionType: exceptionType as 1 | 2,
    });
  }
  return results;
}

// ─── Public API ─────────────────────────────────────────────────────

/** Load all GTFS data from bundled text files. Results are cached. */
export function loadGtfsData(): GtfsData {
  if (cached) return cached;

  cached = {
    stops: loadStops(),
    trips: loadTrips(),
    stopTimes: loadStopTimes(),
    routes: loadRoutes(),
    calendar: loadCalendar(),
    calendarDates: loadCalendarDates(),
  };

  return cached;
}

/** Clear the GTFS data cache (useful for testing) */
export function clearGtfsCache(): void {
  cached = null;
}
