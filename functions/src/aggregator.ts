// Server-side aggregator — mirrors utils/performanceDataAggregator.ts
import {
  STREETSRecord, DailySummary, parseDayType, deriveDayTypeFromDate,
  SystemMetrics, RouteMetrics, HourMetrics, StopMetrics, TripMetrics,
  RouteLoadProfile, LoadProfileStop, DataQuality, OTPBreakdown,
  classifyOTP, PERFORMANCE_SCHEMA_VERSION, DEFAULT_LOAD_CAP,
  OperatorDwellMetrics, DwellIncident, OperatorDwellSummary,
  classifyDwell, DWELL_THRESHOLDS,
} from './types';
import { buildDailyCascadeMetrics } from './dwellCascadeComputer';

function timeToSeconds(time: string): number {
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  return h * 3600 + m * 60 + s;
}

function parseStrictTimeToSeconds(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  const m = normalized.match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  const sec = m[3] ? Number.parseInt(m[3], 10) : 0;
  if (!Number.isFinite(h) || h < 0) return null;
  return h * 3600 + min * 60 + sec;
}

const MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS = 12 * 3600;

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function mean(values: number[]): number {
  return safeDivide(values.reduce((a, b) => a + b, 0), values.length);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function isLoadReliable(r: STREETSRecord): boolean {
  // APC-backed zero load is valid and must be kept in averages (e.g. terminals).
  return r.apcSource !== 0 && r.departureLoad >= 0;
}

/** Cap departureLoad values and return sanitization counts.
 *  WARNING: Mutates records in place. Only call once per record set. */
function sanitizeRecords(records: STREETSRecord[]): { loadCapped: number; apcExcludedFromLoad: number } {
  let loadCapped = 0;
  let apcExcludedFromLoad = 0;

  for (const r of records) {
    if (r.departureLoad > DEFAULT_LOAD_CAP) {
      r.departureLoad = DEFAULT_LOAD_CAP;
      loadCapped++;
    }
    if (r.apcSource === 0) {
      apcExcludedFromLoad++;
    }
  }

  return { loadCapped, apcExcludedFromLoad };
}

function otpEligible(records: STREETSRecord[]): STREETSRecord[] {
  // Find max routeStopIndex per trip across ALL records (last stop, not last TP).
  // A timepoint that is the last TP but not the last stop is still eligible for OTP.
  const tripMaxIdx = new Map<string, number>();
  for (const r of records) {
    const cur = tripMaxIdx.get(r.tripId) || 0;
    if (r.routeStopIndex > cur) tripMaxIdx.set(r.tripId, r.routeStopIndex);
  }

  // Collect eligible records, then dedup by trip+stop keeping closest to schedule.
  // At terminals, STREETS can emit multiple observations for the same trip+stop.
  const groups = new Map<string, STREETSRecord[]>();
  for (const r of records) {
    if (!r.timePoint || r.inBetween || r.isTripper) continue;
    if (!r.observedDepartureTime) continue;
    // Exclude last stop per trip
    if (r.routeStopIndex >= (tripMaxIdx.get(r.tripId) || 0)) continue;
    const key = `${r.tripId}|${r.stopId}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const result: STREETSRecord[] = [];
  for (const recs of groups.values()) {
    if (recs.length === 1) {
      result.push(recs[0]);
      continue;
    }

    // Keep record with smallest absolute deviation from scheduled time.
    let best = recs[0];
    let bestDev = Math.abs(timeToSeconds(best.observedDepartureTime!) - timeToSeconds(best.stopTime));
    for (let i = 1; i < recs.length; i++) {
      const dev = Math.abs(timeToSeconds(recs[i].observedDepartureTime!) - timeToSeconds(recs[i].stopTime));
      if (dev < bestDev) {
        best = recs[i];
        bestDev = dev;
      }
    }
    result.push(best);
  }

  return result;
}

function computeDeviation(r: STREETSRecord): number {
  return timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
}

function computeOTP(records: STREETSRecord[]): OTPBreakdown {
  const eligible = otpEligible(records);
  const total = eligible.length;

  if (total === 0) {
    return {
      total: 0, onTime: 0, early: 0, late: 0,
      onTimePercent: 0, earlyPercent: 0, latePercent: 0,
      avgDeviationSeconds: 0,
    };
  }

  let onTime = 0;
  let early = 0;
  let late = 0;
  let deviationSum = 0;

  for (const r of eligible) {
    const dev = computeDeviation(r);
    deviationSum += dev;
    const status = classifyOTP(dev);
    if (status === 'on-time') onTime++;
    else if (status === 'early') early++;
    else late++;
  }

  return {
    total,
    onTime,
    early,
    late,
    onTimePercent: (onTime / total) * 100,
    earlyPercent: (early / total) * 100,
    latePercent: (late / total) * 100,
    avgDeviationSeconds: deviationSum / total,
  };
}

function buildSystemMetrics(records: STREETSRecord[]): SystemMetrics {
  const otp = computeOTP(records);
  let totalBoardings = 0;
  let totalAlightings = 0;
  let peakLoad = 0;
  let loadSum = 0;
  const vehicles = new Set<string>();
  const trips = new Set<string>();
  const wheelchairTrips = new Set<string>();
  let loadCount = 0;

  for (const r of records) {
    totalBoardings += r.boardings;
    totalAlightings += r.alightings;
    if (isLoadReliable(r)) {
      loadSum += r.departureLoad;
      loadCount++;
      if (r.departureLoad > peakLoad) peakLoad = r.departureLoad;
    }
    vehicles.add(r.vehicleId);
    trips.add(r.tripId);
    if (r.wheelchairUsageCount > 0) wheelchairTrips.add(r.tripId);
  }

  return {
    otp,
    totalRidership: totalBoardings,
    totalBoardings,
    totalAlightings,
    vehicleCount: vehicles.size,
    tripCount: trips.size,
    wheelchairTrips: wheelchairTrips.size,
    avgSystemLoad: safeDivide(loadSum, loadCount),
    peakLoad,
  };
}

function buildRouteMetrics(records: STREETSRecord[]): RouteMetrics[] {
  const byRoute = groupBy(records, r => r.routeId);
  const results: RouteMetrics[] = [];

  for (const [routeId, recs] of byRoute) {
    const otp = computeOTP(recs);
    let ridership = 0;
    let alightings = 0;
    let maxLoad = 0;
    let loadSum = 0;
    let loadCount = 0;
    const trips = new Set<string>();
    const wheelchairTrips = new Set<string>();
    let routeName = '';
    for (const r of recs) {
      ridership += r.boardings;
      alightings += r.alightings;
      if (isLoadReliable(r)) {
        loadSum += r.departureLoad;
        loadCount++;
        if (r.departureLoad > maxLoad) maxLoad = r.departureLoad;
      }
      trips.add(r.tripId);
      if (r.wheelchairUsageCount > 0) wheelchairTrips.add(r.tripId);
      if (!routeName) routeName = r.routeName;
    }

    // Compute service hours: sum of (last stop time - first stop time) per trip
    const byTrip = groupBy(recs, r => r.tripId);
    let serviceSeconds = 0;
    for (const [, tripRecs] of byTrip) {
      const ordered = [...tripRecs].sort((a, b) => a.routeStopIndex - b.routeStopIndex);
      let minTime = Infinity;
      let maxTime = -Infinity;
      let previousTime: number | null = null;
      for (const r of ordered) {
        let t = timeToSeconds(r.arrivalTime);
        if (previousTime !== null) {
          while (t < previousTime) t += 86400;
        }
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
        previousTime = t;
      }
      if (minTime < Infinity && maxTime > -Infinity) {
        serviceSeconds += maxTime - minTime;
      }
    }
    const tripCount = trips.size;
    const serviceHours = serviceSeconds / 3600;

    results.push({
      routeId,
      routeName,
      otp,
      ridership,
      alightings,
      tripCount,
      serviceHours,
      avgLoad: safeDivide(loadSum, loadCount),
      maxLoad,
      avgDeviationSeconds: otp.avgDeviationSeconds,
      wheelchairTrips: wheelchairTrips.size,
    });
  }

  return results.sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }));
}

function buildHourMetrics(records: STREETSRecord[]): HourMetrics[] {
  const byHour = groupBy(records, r => {
    const h = parseInt(r.arrivalTime.split(':')[0], 10);
    return String(h);
  });

  const results: HourMetrics[] = [];

  for (const [hourStr, recs] of byHour) {
    const hour = parseInt(hourStr, 10);
    const otp = computeOTP(recs);
    let boardings = 0;
    let alightings = 0;
    let loadSum = 0;
    let loadCount = 0;

    for (const r of recs) {
      boardings += r.boardings;
      alightings += r.alightings;
      if (isLoadReliable(r)) {
        loadSum += r.departureLoad;
        loadCount++;
      }
    }

    results.push({
      hour,
      otp,
      boardings,
      alightings,
      avgLoad: safeDivide(loadSum, loadCount),
    });
  }

  return results.sort((a, b) => a.hour - b.hour);
}

function buildStopMetrics(records: STREETSRecord[]): StopMetrics[] {
  const byStop = groupBy(records, r => `${r.stopId}||${r.stopName}`);
  const results: StopMetrics[] = [];

  for (const [key, recs] of byStop) {
    const otp = computeOTP(recs);
    let boardings = 0;
    let alightings = 0;
    let loadSum = 0;
    let loadCount = 0;
    const routes = new Set<string>();
    let lat = 0;
    let lon = 0;
    let isTimepoint = false;
    const hBoard = new Array(24).fill(0);
    const hAlight = new Array(24).fill(0);

    for (const r of recs) {
      boardings += r.boardings;
      alightings += r.alightings;
      if (isLoadReliable(r)) {
        loadSum += r.departureLoad;
        loadCount++;
      }
      routes.add(r.routeId);
      if (!lat) { lat = r.stopLat; lon = r.stopLon; }
      if (r.timePoint) isTimepoint = true;
      const h = parseInt(r.arrivalTime.split(':')[0], 10);
      if (h >= 0 && h < 24) {
        hBoard[h] += r.boardings;
        hAlight[h] += r.alightings;
      }
    }

    const [stopId, stopName] = key.split('||');

    results.push({
      stopName,
      stopId,
      lat,
      lon,
      isTimepoint,
      otp,
      boardings,
      alightings,
      avgLoad: safeDivide(loadSum, loadCount),
      routeCount: routes.size,
      routes: Array.from(routes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      hourlyBoardings: hBoard,
      hourlyAlightings: hAlight,
    });
  }

  return results.sort((a, b) => b.boardings - a.boardings);
}

function buildTripMetrics(records: STREETSRecord[]): TripMetrics[] {
  const byTrip = groupBy(records, r => r.tripId);
  const results: TripMetrics[] = [];

  for (const [tripId, recs] of byTrip) {
    const otp = computeOTP(recs);
    let boardings = 0;
    let maxLoad = 0;
    let tripName = '';
    let block = '';
    let routeId = '';
    let routeName = '';
    let direction = '';
    let terminalDepartureTime = '';

    for (const r of recs) {
      boardings += r.boardings;
      if (isLoadReliable(r) && r.departureLoad > maxLoad) maxLoad = r.departureLoad;
      if (!tripName) {
        tripName = r.tripName;
        block = r.block;
        routeId = r.routeId;
        routeName = r.routeName;
        direction = r.direction;
        terminalDepartureTime = r.terminalDepartureTime;
      }
    }

    results.push({
      tripId,
      tripName,
      block,
      routeId,
      routeName,
      direction,
      terminalDepartureTime,
      otp,
      boardings,
      maxLoad,
    });
  }

  return results.sort((a, b) => {
    const cmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return timeToSeconds(a.terminalDepartureTime) - timeToSeconds(b.terminalDepartureTime);
  });
}

function buildLoadProfiles(records: STREETSRecord[]): RouteLoadProfile[] {
  const byRouteDir = groupBy(records, r => `${r.routeId}||${r.direction}`);
  const results: RouteLoadProfile[] = [];

  for (const [key, recs] of byRouteDir) {
    const [routeId, direction] = key.split('||');
    const routeName = recs[0].routeName;

    const tripIds = new Set<string>();
    for (const r of recs) tripIds.add(r.tripId);
    const tripCount = tripIds.size;

    const byStopIdx = groupBy(recs, r => String(r.routeStopIndex));
    const stops: LoadProfileStop[] = [];

    for (const [idxStr, stopRecs] of byStopIdx) {
      const routeStopIndex = parseInt(idxStr, 10);
      const byTrip = groupBy(stopRecs, r => r.tripId);

      const tripBoardings: number[] = [];
      const tripAlightings: number[] = [];
      const tripLoads: number[] = [];
      let maxLoad = 0;
      let stopName = '';
      let stopId = '';
      let isTimepoint = false;

      for (const [, tripRecs] of byTrip) {
        let b = 0;
        let a = 0;
        let load = 0;
        let hasReliableLoad = false;
        for (const r of tripRecs) {
          b += r.boardings;
          a += r.alightings;
          if (isLoadReliable(r) && (!hasReliableLoad || r.departureLoad > load)) {
            load = r.departureLoad;
            hasReliableLoad = true;
          }
          if (!stopName) {
            stopName = r.stopName;
            stopId = r.stopId;
          }
          if (r.timePoint) isTimepoint = true;
        }
        tripBoardings.push(b);
        tripAlightings.push(a);
        if (hasReliableLoad) {
          tripLoads.push(load);
          if (load > maxLoad) maxLoad = load;
        }
      }

      stops.push({
        stopName,
        stopId,
        routeStopIndex,
        avgBoardings: mean(tripBoardings),
        avgAlightings: mean(tripAlightings),
        avgLoad: mean(tripLoads),
        maxLoad,
        isTimepoint,
      });
    }

    stops.sort((a, b) => a.routeStopIndex - b.routeStopIndex);
    results.push({ routeId, routeName, direction, tripCount, stops });
  }

  return results.sort((a, b) => {
    const cmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return a.direction.localeCompare(b.direction);
  });
}

function buildOperatorDwellMetrics(records: STREETSRecord[], date: string): OperatorDwellMetrics {
  const incidents: DwellIncident[] = [];

  // STREETS can emit multiple observations for the same trip+stop (terminal arrival/departure passes).
  // Keep the closest-to-schedule observation per trip+stop+routeStopIndex.
  // routeStopIndex is required so loop routes do not collapse repeated visits to the same stop.
  const groups = new Map<string, STREETSRecord[]>();
  for (const r of records) {
    if (!r.timePoint) continue;
    if (!r.observedArrivalTime || !r.observedDepartureTime) continue;
    const key = `${r.tripId}|${r.stopId}|${r.routeStopIndex}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  for (const recs of groups.values()) {
    let chosen = recs[0];
    let bestDev = Math.abs(timeToSeconds(chosen.observedDepartureTime!) - timeToSeconds(chosen.stopTime));
    for (let i = 1; i < recs.length; i++) {
      const dev = Math.abs(timeToSeconds(recs[i].observedDepartureTime!) - timeToSeconds(recs[i].stopTime));
      if (dev < bestDev) {
        chosen = recs[i];
        bestDev = dev;
      }
    }

    const observedArrival = chosen.observedArrivalTime;
    const observedDeparture = chosen.observedDepartureTime;
    if (!observedArrival || !observedDeparture) continue;

    const arrSec = parseStrictTimeToSeconds(observedArrival);
    let depSec = parseStrictTimeToSeconds(observedDeparture);
    if (arrSec === null || depSec === null) continue;
    if (depSec < arrSec) {
      if (arrSec - depSec >= MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS) depSec += 86400;
      else continue;
    }

    const rawDwell = depSec - arrSec;
    if (rawDwell < 0) continue;

    const severity = classifyDwell(rawDwell);
    if (!severity) continue;

    const trackedDwell = rawDwell - DWELL_THRESHOLDS.boardingAllowanceSeconds;

    incidents.push({
      operatorId: chosen.operatorId,
      date,
      routeId: chosen.routeId,
      routeName: chosen.routeName,
      stopName: chosen.stopName,
      stopId: chosen.stopId,
      tripName: chosen.tripName,
      block: chosen.block,
      observedArrivalTime: observedArrival,
      observedDepartureTime: observedDeparture,
      rawDwellSeconds: rawDwell,
      trackedDwellSeconds: trackedDwell,
      severity,
    });
  }

  const opMap = new Map<string, DwellIncident[]>();
  for (const inc of incidents) {
    const arr = opMap.get(inc.operatorId);
    if (arr) arr.push(inc);
    else opMap.set(inc.operatorId, [inc]);
  }

  const byOperator: OperatorDwellSummary[] = [];
  for (const [operatorId, opIncidents] of opMap) {
    let moderateCount = 0;
    let highCount = 0;
    let totalTrackedDwellSeconds = 0;

    for (const inc of opIncidents) {
      if (inc.severity === 'moderate') moderateCount++;
      else highCount++;
      totalTrackedDwellSeconds += inc.trackedDwellSeconds;
    }

    byOperator.push({
      operatorId,
      moderateCount,
      highCount,
      totalIncidents: opIncidents.length,
      totalTrackedDwellSeconds,
      avgTrackedDwellSeconds: safeDivide(totalTrackedDwellSeconds, opIncidents.length),
    });
  }

  byOperator.sort((a, b) => b.totalIncidents - a.totalIncidents || b.totalTrackedDwellSeconds - a.totalTrackedDwellSeconds);

  const totalTrackedSeconds = incidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);

  return {
    incidents,
    byOperator,
    totalIncidents: incidents.length,
    totalTrackedDwellMinutes: Math.round(totalTrackedSeconds / 60 * 10) / 10,
  };
}

function buildDataQuality(
  records: STREETSRecord[],
  sanitization: { loadCapped: number; apcExcludedFromLoad: number }
): DataQuality {
  let inBetweenFiltered = 0;
  let missingAVL = 0;
  let missingAPC = 0;
  let detourRecords = 0;
  let tripperRecords = 0;

  for (const r of records) {
    if (r.inBetween) inBetweenFiltered++;
    if (r.observedArrivalTime === null) missingAVL++;
    if (r.apcSource === 0) missingAPC++;
    if (r.isDetour) detourRecords++;
    if (r.isTripper) tripperRecords++;
  }

  return {
    totalRecords: records.length,
    inBetweenFiltered,
    missingAVL,
    missingAPC,
    detourRecords,
    tripperRecords,
    loadCapped: sanitization.loadCapped,
    apcExcludedFromLoad: sanitization.apcExcludedFromLoad,
  };
}

function aggregateSingleDay(date: string, records: STREETSRecord[]): DailySummary {
  const rawDay = records[0].day;
  const dayType = (rawDay === 'SATURDAY' || rawDay === 'SUNDAY' || rawDay === 'MONDAY' ||
    rawDay === 'TUESDAY' || rawDay === 'WEDNESDAY' || rawDay === 'THURSDAY' || rawDay === 'FRIDAY')
    ? parseDayType(rawDay)
    : deriveDayTypeFromDate(date);
  const sanitization = sanitizeRecords(records);

  const dwellMetrics = buildOperatorDwellMetrics(records, date);

  return {
    date,
    dayType,
    system: buildSystemMetrics(records),
    byRoute: buildRouteMetrics(records),
    byHour: buildHourMetrics(records),
    byStop: buildStopMetrics(records),
    byTrip: buildTripMetrics(records),
    loadProfiles: buildLoadProfiles(records),
    byOperatorDwell: dwellMetrics,
    byCascade: buildDailyCascadeMetrics(records, dwellMetrics.incidents),
    dataQuality: buildDataQuality(records, sanitization),
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  };
}

export function aggregateDailySummaries(records: STREETSRecord[]): DailySummary[] {
  const byDate = groupBy(records, r => r.date);
  const dates = Array.from(byDate.keys()).sort();
  const summaries: DailySummary[] = [];

  for (const date of dates) {
    summaries.push(aggregateSingleDay(date, byDate.get(date)!));
  }

  return summaries;
}
