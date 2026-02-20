// Server-side aggregator — mirrors utils/performanceDataAggregator.ts
import {
  STREETSRecord, DailySummary, parseDayType, deriveDayTypeFromDate,
  SystemMetrics, RouteMetrics, HourMetrics, StopMetrics, TripMetrics,
  RouteLoadProfile, LoadProfileStop, DataQuality, OTPBreakdown,
  classifyOTP, PERFORMANCE_SCHEMA_VERSION,
} from './types';

function timeToSeconds(time: string): number {
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  return h * 3600 + m * 60 + s;
}

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

  for (const r of records) {
    totalBoardings += r.boardings;
    totalAlightings += r.alightings;
    loadSum += r.departureLoad;
    if (r.departureLoad > peakLoad) peakLoad = r.departureLoad;
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
    avgSystemLoad: safeDivide(loadSum, records.length),
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
    const trips = new Set<string>();
    const wheelchairTrips = new Set<string>();
    let routeName = '';
    for (const r of recs) {
      ridership += r.boardings;
      alightings += r.alightings;
      loadSum += r.departureLoad;
      if (r.departureLoad > maxLoad) maxLoad = r.departureLoad;
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
      avgLoad: safeDivide(loadSum, recs.length),
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

    for (const r of recs) {
      boardings += r.boardings;
      alightings += r.alightings;
      loadSum += r.departureLoad;
    }

    results.push({
      hour,
      otp,
      boardings,
      alightings,
      avgLoad: safeDivide(loadSum, recs.length),
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
    const routes = new Set<string>();
    let lat = 0;
    let lon = 0;
    let isTimepoint = false;
    const hBoard = new Array(24).fill(0);
    const hAlight = new Array(24).fill(0);

    for (const r of recs) {
      boardings += r.boardings;
      alightings += r.alightings;
      loadSum += r.departureLoad;
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
      avgLoad: safeDivide(loadSum, recs.length),
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
      if (r.departureLoad > maxLoad) maxLoad = r.departureLoad;
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
        for (const r of tripRecs) {
          b += r.boardings;
          a += r.alightings;
          if (r.departureLoad > load) load = r.departureLoad;
          if (!stopName) {
            stopName = r.stopName;
            stopId = r.stopId;
          }
          if (r.timePoint) isTimepoint = true;
        }
        tripBoardings.push(b);
        tripAlightings.push(a);
        tripLoads.push(load);
        if (load > maxLoad) maxLoad = load;
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

function buildDataQuality(records: STREETSRecord[]): DataQuality {
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
    loadCapped: 0,
    apcExcludedFromLoad: 0,
  };
}

function aggregateSingleDay(date: string, records: STREETSRecord[]): DailySummary {
  const rawDay = records[0].day;
  const dayType = (rawDay === 'SATURDAY' || rawDay === 'SUNDAY' || rawDay === 'MONDAY' ||
    rawDay === 'TUESDAY' || rawDay === 'WEDNESDAY' || rawDay === 'THURSDAY' || rawDay === 'FRIDAY')
    ? parseDayType(rawDay)
    : deriveDayTypeFromDate(date);

  return {
    date,
    dayType,
    system: buildSystemMetrics(records),
    byRoute: buildRouteMetrics(records),
    byHour: buildHourMetrics(records),
    byStop: buildStopMetrics(records),
    byTrip: buildTripMetrics(records),
    loadProfiles: buildLoadProfiles(records),
    dataQuality: buildDataQuality(records),
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
