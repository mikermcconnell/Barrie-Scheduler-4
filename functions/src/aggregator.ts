// Server-side aggregator — mirrors utils/performanceDataAggregator.ts
import {
  STREETSRecord, DailySummary, parseDayType, deriveDayTypeFromDate,
  SystemMetrics, RouteMetrics, HourMetrics, StopMetrics, TripMetrics,
  RouteLoadProfile, LoadProfileStop, DataQuality, OTPBreakdown,
  RouteRidershipHeatmap, RidershipHeatmapTrip, RidershipHeatmapStop,
  classifyOTP, PERFORMANCE_SCHEMA_VERSION,
  OperatorDwellMetrics, DwellIncident, OperatorDwellSummary,
  classifyDwell, DWELL_THRESHOLDS,
  DailySegmentRuntimes, DailySegmentRuntimeEntry, DailyStopSegmentRuntimes, DailyStopSegmentRuntimeEntry, DailyTripStopSegmentRuntimes, DailyTripStopSegmentRuntimeEntry, SegmentRuntimeObservation, TripStopSegmentObservation,
  DailyRuntimePattern, RuntimePatternKind,
  RouteStopDeviationProfile, RouteStopDeviationEntry,
  RouteHourMetrics, PerformanceLoadCapacityConfig,
} from './types';
import { buildDailyCascadeMetrics } from './dwellCascadeComputer';
import {
  DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
  normalizePerformanceLoadCapacityConfig,
  resolvePerformanceLoadCapacity,
} from './performanceLoadCapacity';

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

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeApcDiscrepancyPct(boardings: number, alightings: number): number {
  const baseline = Math.max(boardings, alightings, 1);
  return roundToOneDecimal(safeDivide(Math.abs(boardings - alightings) * 100, baseline));
}

function classifyRouteApcStatus(discrepancyPct: number): 'ok' | 'review' | 'suspect' {
  if (discrepancyPct >= 50) return 'suspect';
  if (discrepancyPct >= 25) return 'review';
  return 'ok';
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
  return r.apcSource > 0 && r.departureLoad >= 0;
}

/** Cap departureLoad values and return sanitization counts.
 *  WARNING: Mutates records in place. Only call once per record set. */
function sanitizeRecords(
  records: STREETSRecord[],
  loadCapacityConfig: PerformanceLoadCapacityConfig,
): { loadCapped: number; apcExcludedFromLoad: number } {
  let loadCapped = 0;
  let apcExcludedFromLoad = 0;

  for (const r of records) {
    const capacity = resolvePerformanceLoadCapacity(loadCapacityConfig, r.vehicleId);
    if (r.departureLoad > capacity) {
      r.departureLoad = capacity;
      loadCapped++;
    }
    if (r.apcSource <= 0) {
      apcExcludedFromLoad++;
    }
  }

  return { loadCapped, apcExcludedFromLoad };
}

function stableHeatmapTripId(record: STREETSRecord): string {
  const sourceTripId = record.tripId?.trim();
  if (sourceTripId) return sourceTripId;
  if (Number.isFinite(record.internalTripId) && record.internalTripId > 0) {
    return `internal:${record.internalTripId}`;
  }
  return `fallback:${JSON.stringify([
    record.vehicleId?.trim() ?? '',
    record.block?.trim() ?? '',
    record.tripName?.trim() ?? '',
    record.terminalDepartureTime?.trim() ?? '',
  ])}`;
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
  const scheduledSeconds = timeToSeconds(r.stopTime);
  const observedSeconds = timeToSeconds(r.observedDepartureTime!);
  let deviationSeconds = observedSeconds - scheduledSeconds;

  if (deviationSeconds <= -MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS) deviationSeconds += 86400;
  else if (deviationSeconds >= MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS) deviationSeconds -= 86400;

  return deviationSeconds;
}

/**
 * Assign each physical stop visit a stable zero-based ordinal within its trip.
 * Duplicate source rows for the same stop and route position share one visit.
 */
function buildStopOccurrenceIndexes(records: STREETSRecord[]): Map<STREETSRecord, number> {
  const result = new Map<STREETSRecord, number>();
  const byTrip = groupBy(records, stableHeatmapTripId);

  for (const tripRecords of byTrip.values()) {
    const uniqueByPosition = new Map<string, STREETSRecord>();
    for (const record of tripRecords) {
      const positionKey = JSON.stringify([record.stopId, record.routeStopIndex]);
      if (!uniqueByPosition.has(positionKey)) uniqueByPosition.set(positionKey, record);
    }

    const occurrenceByPosition = new Map<string, number>();
    const occurrenceCounts = new Map<string, number>();
    const ordered = [...uniqueByPosition.entries()].sort(([, a], [, b]) =>
      a.routeStopIndex - b.routeStopIndex || a.stopId.localeCompare(b.stopId)
    );
    for (const [positionKey, record] of ordered) {
      const occurrenceIndex = occurrenceCounts.get(record.stopId) ?? 0;
      occurrenceCounts.set(record.stopId, occurrenceIndex + 1);
      occurrenceByPosition.set(positionKey, occurrenceIndex);
    }

    for (const record of tripRecords) {
      const positionKey = JSON.stringify([record.stopId, record.routeStopIndex]);
      result.set(record, occurrenceByPosition.get(positionKey) ?? 0);
    }
  }

  return result;
}

function computeOTPFromEligible(eligible: STREETSRecord[]): OTPBreakdown {
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

function buildSystemMetrics(records: STREETSRecord[], eligibleOTP: STREETSRecord[]): SystemMetrics {
  const otp = computeOTPFromEligible(eligibleOTP);
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

function buildRouteMetrics(records: STREETSRecord[], eligibleOTP: STREETSRecord[]): RouteMetrics[] {
  const byRoute = groupBy(records, r => r.routeId);
  const otpByRoute = groupBy(eligibleOTP, r => r.routeId);
  const results: RouteMetrics[] = [];

  for (const [routeId, recs] of byRoute) {
    const otp = computeOTPFromEligible(otpByRoute.get(routeId) ?? []);
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
    const apcDiscrepancyCount = Math.abs(ridership - alightings);
    const apcDiscrepancyPct = computeApcDiscrepancyPct(ridership, alightings);

    results.push({
      routeId,
      routeName,
      otp,
      ridership,
      alightings,
      apcDiscrepancyCount,
      apcDiscrepancyPct,
      apcStatus: classifyRouteApcStatus(apcDiscrepancyPct),
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

function buildHourMetrics(records: STREETSRecord[], eligibleOTP: STREETSRecord[]): HourMetrics[] {
  const byHour = groupBy(records, r => {
    const h = parseInt(r.arrivalTime.split(':')[0], 10);
    return String(h);
  });
  const eligibleByHour = groupBy(eligibleOTP, r => {
    const h = parseInt(r.arrivalTime.split(':')[0], 10);
    return String(h);
  });

  const results: HourMetrics[] = [];

  for (const [hourStr, recs] of byHour) {
    const hour = parseInt(hourStr, 10);
    const otp = computeOTPFromEligible(eligibleByHour.get(hourStr) ?? []);
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

function buildRouteHourMetrics(records: STREETSRecord[], eligibleOTP: STREETSRecord[]): RouteHourMetrics[] {
  const byRouteHour = groupBy(records, r => {
    const h = parseInt(r.arrivalTime.split(':')[0], 10);
    return `${r.routeId}||${h}`;
  });
  const eligibleByRouteHour = groupBy(eligibleOTP, r => {
    const h = parseInt(r.arrivalTime.split(':')[0], 10);
    return `${r.routeId}||${h}`;
  });

  const results: RouteHourMetrics[] = [];

  for (const [key, recs] of byRouteHour) {
    const [routeId, hourStr] = key.split('||');
    const hour = parseInt(hourStr, 10);
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

    const otp = computeOTPFromEligible(eligibleByRouteHour.get(key) ?? []);
    results.push({
      routeId,
      hour,
      avgLoad: safeDivide(loadSum, loadCount),
      boardings,
      alightings,
      ...(otp.total > 0 ? { otp } : {}),
    });
  }

  return results.sort((a, b) => {
    const cmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return a.hour - b.hour;
  });
}

function buildStopMetrics(records: STREETSRecord[], eligibleOTP: STREETSRecord[]): StopMetrics[] {
  const byStop = groupBy(records, r => `${r.stopId}||${r.stopName}`);
  const eligibleByStop = groupBy(eligibleOTP, r => `${r.stopId}||${r.stopName}`);
  const results: StopMetrics[] = [];

  for (const [key, recs] of byStop) {
    const otp = computeOTPFromEligible(eligibleByStop.get(key) ?? []);
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
    const byRoute = new Map<string, {
      boardings: number;
      alightings: number;
      hourlyBoardings: number[];
      hourlyAlightings: number[];
    }>();

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

      const routeExisting = byRoute.get(r.routeId);
      if (routeExisting) {
        routeExisting.boardings += r.boardings;
        routeExisting.alightings += r.alightings;
        if (h >= 0 && h < 24) {
          routeExisting.hourlyBoardings[h] += r.boardings;
          routeExisting.hourlyAlightings[h] += r.alightings;
        }
      } else {
        const hourlyBoardings = new Array(24).fill(0);
        const hourlyAlightings = new Array(24).fill(0);
        if (h >= 0 && h < 24) {
          hourlyBoardings[h] = r.boardings;
          hourlyAlightings[h] = r.alightings;
        }
        byRoute.set(r.routeId, {
          boardings: r.boardings,
          alightings: r.alightings,
          hourlyBoardings,
          hourlyAlightings,
        });
      }
    }

    const [stopId, stopName] = key.split('||');
    const routeBreakdown = Array.from(byRoute.entries())
      .map(([routeId, metrics]) => ({ routeId, ...metrics }))
      .sort((a, b) => {
        const totalCmp = (b.boardings + b.alightings) - (a.boardings + a.alightings);
        if (totalCmp !== 0) return totalCmp;
        return a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
      });

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
      routeBreakdown,
    });
  }

  return results.sort((a, b) => b.boardings - a.boardings);
}

function buildTripMetrics(records: STREETSRecord[], eligibleOTP: STREETSRecord[]): TripMetrics[] {
  const byTrip = groupBy(records, r => r.tripId);
  const otpByTrip = groupBy(eligibleOTP, r => r.tripId);
  const results: TripMetrics[] = [];

  for (const [tripId, recs] of byTrip) {
    const otp = computeOTPFromEligible(otpByTrip.get(tripId) ?? []);
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
    const occurrenceIndexes = buildStopOccurrenceIndexes(recs);

    // Match the same visit across shifted patterns while preserving repeated loop visits.
    const byStopOccurrence = groupBy(
      recs,
      r => JSON.stringify([r.stopId, occurrenceIndexes.get(r) ?? 0]),
    );
    const stops: LoadProfileStop[] = [];

    for (const [, stopRecs] of byStopOccurrence) {
      const routeStopIndex = stopRecs[0].routeStopIndex;
      const occurrenceIndex = occurrenceIndexes.get(stopRecs[0]) ?? 0;
      const byTrip = groupBy(stopRecs, r => r.tripId);

      const tripBoardings: number[] = [];
      const tripAlightings: number[] = [];
      const tripLoads: number[] = [];
      let maxLoad = 0;
      let stopName = '';
      const stopId = stopRecs[0].stopId;
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
        occurrenceIndex,
        avgBoardings: mean(tripBoardings),
        avgAlightings: mean(tripAlightings),
        avgLoad: mean(tripLoads),
        loadObservationCount: tripLoads.length,
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

function buildRidershipHeatmaps(
  records: STREETSRecord[],
  loadCapacityConfig: PerformanceLoadCapacityConfig,
): RouteRidershipHeatmap[] {
  const byRouteDir = groupBy(records, r => `${r.routeId}||${r.direction}`);
  const results: RouteRidershipHeatmap[] = [];

  for (const [key, recs] of byRouteDir) {
    const [routeId, direction] = key.split('||');
    const routeName = recs[0].routeName;
    const occurrenceIndexes = buildStopOccurrenceIndexes(recs);
    const occurrenceKey = (record: STREETSRecord) => JSON.stringify([
      record.stopId,
      occurrenceIndexes.get(record) ?? 0,
    ]);

    const tripMap = new Map<string, RidershipHeatmapTrip>();
    const recordsByTrip = new Map<string, STREETSRecord[]>();

    for (const r of recs) {
      const tripId = stableHeatmapTripId(r);
      if (!tripMap.has(tripId)) {
        tripMap.set(tripId, {
          tripId,
          terminalDepartureTime: r.terminalDepartureTime,
          tripName: r.tripName,
          block: r.block,
          direction: r.direction,
          vehicleId: r.vehicleId,
          capacity: resolvePerformanceLoadCapacity(loadCapacityConfig, r.vehicleId),
        });
      }
      const tripRecs = recordsByTrip.get(tripId);
      if (tripRecs) tripRecs.push(r);
      else recordsByTrip.set(tripId, [r]);
    }
    const patternSignatures = new Set([...recordsByTrip.values()].map(tripRecs => {
      const uniqueOccurrences = new Map<string, STREETSRecord>();
      for (const record of tripRecs) {
        const stopOccurrenceKey = occurrenceKey(record);
        if (!uniqueOccurrences.has(stopOccurrenceKey)) uniqueOccurrences.set(stopOccurrenceKey, record);
      }
      return [...uniqueOccurrences.entries()]
        .sort(([, a], [, b]) => a.routeStopIndex - b.routeStopIndex || a.stopId.localeCompare(b.stopId))
        .map(([stopOccurrenceKey]) => stopOccurrenceKey)
        .join('\u001f');
    }));

    let longestTripRecs: STREETSRecord[] = [];
    let longestStopCount = 0;
    for (const tripRecs of recordsByTrip.values()) {
      const uniqueStops = new Set(tripRecs.map(occurrenceKey));
      if (uniqueStops.size > longestStopCount) {
        longestStopCount = uniqueStops.size;
        longestTripRecs = tripRecs;
      }
    }

    const canonicalIndex = new Map<string, number>();
    for (const r of longestTripRecs) {
      const stopOccurrenceKey = occurrenceKey(r);
      if (!canonicalIndex.has(stopOccurrenceKey)) {
        canonicalIndex.set(stopOccurrenceKey, r.routeStopIndex);
      }
    }

    const stopMap = new Map<string, RidershipHeatmapStop>();
    for (const r of recs) {
      const stopOccurrenceKey = occurrenceKey(r);
      const occurrenceIndex = occurrenceIndexes.get(r) ?? 0;
      if (!stopMap.has(stopOccurrenceKey)) {
        stopMap.set(stopOccurrenceKey, {
          stopName: r.stopName,
          stopId: r.stopId,
          routeStopIndex: canonicalIndex.get(stopOccurrenceKey) ?? r.routeStopIndex,
          occurrenceIndex,
          isTimepoint: r.timePoint,
        });
      } else if (r.timePoint) {
        stopMap.get(stopOccurrenceKey)!.isTimepoint = true;
      }
    }

    const trips = Array.from(tripMap.values())
      .sort((a, b) => timeToSeconds(a.terminalDepartureTime) - timeToSeconds(b.terminalDepartureTime)
        || (a.tripId ?? '').localeCompare(b.tripId ?? ''));
    const stops = Array.from(stopMap.values())
      .sort((a, b) => a.routeStopIndex - b.routeStopIndex);

    const tripIdx = new Map<string, number>();
    trips.forEach((t, i) => tripIdx.set(t.tripId!, i));
    const stopIdx = new Map<string, number>();
    stops.forEach((s, i) => stopIdx.set(JSON.stringify([s.stopId, s.occurrenceIndex ?? 0]), i));

    const cells: ([number, number] | null)[][] = stops.map(() => trips.map((): [number, number] | null => null));

    for (const r of recs) {
      const si = stopIdx.get(occurrenceKey(r));
      const ti = tripIdx.get(stableHeatmapTripId(r));
      if (si === undefined || ti === undefined) continue;
      const existing = cells[si][ti];
      if (existing) {
        existing[0] += r.boardings;
        existing[1] += r.alightings;
      } else {
        cells[si][ti] = [r.boardings, r.alightings];
      }
    }

    results.push({
      routeId,
      routeName,
      direction,
      multipleStopPatterns: patternSignatures.size > 1,
      trips,
      stops,
      cells,
    });
  }

  return results.sort((a, b) => {
    const cmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return a.direction.localeCompare(b.direction);
  });
}

function buildOperatorDwellMetrics(records: STREETSRecord[], date: string): OperatorDwellMetrics {
  const incidents: DwellIncident[] = [];
  const exposureByRouteOperator = new Map<string, { routeId: string; operatorId: string; eligibleTimepointVisits: number }>();

  // STREETS can emit multiple observations for the same trip+stop (terminal arrival/departure passes).
  // Keep the closest-to-schedule observation per trip+stop+routeStopIndex.
  // routeStopIndex is required so loop routes do not collapse repeated visits to the same stop.
  const groups = new Map<string, STREETSRecord[]>();
  for (const r of records) {
    if (r.inBetween || r.isTripper || r.isDetour) continue;
    if (!r.timePoint) continue;
    if (!r.observedArrivalTime || !r.observedDepartureTime) continue;
    const key = `${r.tripId}|${r.stopId}|${r.routeStopIndex}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  for (const recs of groups.values()) {
    const validRecs = recs.filter(record => (
      parseStrictTimeToSeconds(record.observedArrivalTime!) !== null
      && parseStrictTimeToSeconds(record.observedDepartureTime!) !== null
    ));
    if (validRecs.length === 0) continue;

    let chosen = validRecs[0];
    let bestDev = Math.abs(timeToSeconds(chosen.observedDepartureTime!) - timeToSeconds(chosen.stopTime));
    for (let i = 1; i < validRecs.length; i++) {
      const dev = Math.abs(timeToSeconds(validRecs[i].observedDepartureTime!) - timeToSeconds(validRecs[i].stopTime));
      if (dev < bestDev) {
        chosen = validRecs[i];
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

    const exposureKey = `${chosen.routeId}||${chosen.operatorId}`;
    const exposure = exposureByRouteOperator.get(exposureKey);
    if (exposure) exposure.eligibleTimepointVisits += 1;
    else {
      exposureByRouteOperator.set(exposureKey, {
        routeId: chosen.routeId,
        operatorId: chosen.operatorId,
        eligibleTimepointVisits: 1,
      });
    }

    const rawDwell = depSec - arrSec;
    if (rawDwell < 0) continue;

    const schedDepSec = timeToSeconds(chosen.stopTime); // scheduled departure
    const depLatenessSec = Math.max(0, depSec - schedDepSec); // how late vs schedule

    // Gate: only count dwell if departing > 3 min late (matches legacy)
    if (depLatenessSec <= DWELL_THRESHOLDS.lateGateSeconds) continue;

    let dwell: number;
    if (arrSec <= schedDepSec) {
      // On time or early — recovery covers boarding; dwell = departure lateness
      dwell = depLatenessSec;
    } else {
      // Late past scheduled departure — dwell = raw time at stop
      dwell = rawDwell;
    }

    const severity = classifyDwell(dwell);
    if (!severity) continue;

    const trackedDwell = dwell;
    const scheduledArrivalSeconds = timeToSeconds(chosen.arrivalTime);
    let arrivalDeviationSeconds = arrSec - scheduledArrivalSeconds;
    if (arrivalDeviationSeconds < -43200) arrivalDeviationSeconds += 86400;
    if (arrivalDeviationSeconds > 43200) arrivalDeviationSeconds -= 86400;
    const departureDeviationSeconds = depSec - schedDepSec;
    const incidentId = [
      date,
      chosen.tripId,
      chosen.routeId,
      chosen.stopId,
      chosen.routeStopIndex,
      observedDeparture,
    ].map(value => encodeURIComponent(String(value))).join('|');

    incidents.push({
      incidentId,
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
      tripId: chosen.tripId,
      vehicleId: chosen.vehicleId,
      direction: chosen.direction,
      routeStopIndex: chosen.routeStopIndex,
      scheduledArrivalTime: chosen.arrivalTime,
      scheduledDepartureTime: chosen.stopTime,
      arrivalDeviationSeconds,
      departureDeviationSeconds,
      boardings: chosen.boardings,
      alightings: chosen.alightings,
      wheelchairUsageCount: chosen.wheelchairUsageCount,
      departureLoad: chosen.apcSource > 0 ? chosen.departureLoad : null,
      departureLoadReliable: chosen.apcSource > 0,
      stopLat: chosen.stopLat,
      stopLon: chosen.stopLon,
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
      else if (inc.severity === 'high') highCount++;
      // minor events contribute to dwell hours but not incident counts
      totalTrackedDwellSeconds += inc.trackedDwellSeconds;
    }

    const classifiedCount = moderateCount + highCount;
    const reportableDwellSeconds = opIncidents
      .filter(incident => incident.severity === 'moderate' || incident.severity === 'high')
      .reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0);
    const eligibleTimepointVisits = [...exposureByRouteOperator.values()]
      .filter(row => row.operatorId === operatorId)
      .reduce((sum, row) => sum + row.eligibleTimepointVisits, 0);
    byOperator.push({
      operatorId,
      moderateCount,
      highCount,
      totalIncidents: classifiedCount,
      totalTrackedDwellSeconds,
      avgTrackedDwellSeconds: safeDivide(totalTrackedDwellSeconds, opIncidents.length),
      reportableDwellSeconds,
      eligibleTimepointVisits,
      incidentsPer1kEligibleVisits: eligibleTimepointVisits > 0
        ? Math.round(classifiedCount / eligibleTimepointVisits * 1000 * 100) / 100
        : undefined,
    });
  }

  byOperator.sort((a, b) => b.totalIncidents - a.totalIncidents || b.totalTrackedDwellSeconds - a.totalTrackedDwellSeconds);

  const totalTrackedSeconds = incidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);

  // ─── Normalization: stop visits + service hours per operator ───
  const opVisits = new Map<string, number>();
  const opTripTimes = new Map<string, { min: number; max: number }>();
  for (const r of records) {
    if (r.inBetween || r.isTripper || r.isDetour) continue;
    const opId = r.operatorId;
    opVisits.set(opId, (opVisits.get(opId) ?? 0) + 1);

    if (r.observedArrivalTime || r.observedDepartureTime) {
      const obsSec = timeToSeconds(r.observedDepartureTime ?? r.observedArrivalTime!);
      const tripKey = `${opId}||${r.tripId}`;
      const entry = opTripTimes.get(tripKey);
      if (entry) {
        if (obsSec < entry.min) entry.min = obsSec;
        if (obsSec > entry.max) entry.max = obsSec;
      } else {
        opTripTimes.set(tripKey, { min: obsSec, max: obsSec });
      }
    }
  }

  const opServiceSec = new Map<string, number>();
  for (const [tripKey, range] of opTripTimes) {
    const opId = tripKey.split('||')[0];
    opServiceSec.set(opId, (opServiceSec.get(opId) ?? 0) + (range.max - range.min));
  }

  for (const op of byOperator) {
    op.stopVisitCount = opVisits.get(op.operatorId) ?? 0;
    const svcSec = opServiceSec.get(op.operatorId) ?? 0;
    op.serviceHours = Math.round(svcSec / 3600 * 100) / 100;
    op.incidentsPer1kVisits = op.stopVisitCount > 0
      ? Math.round(op.totalIncidents / op.stopVisitCount * 1000 * 100) / 100
      : undefined;
    op.incidentsPer100ServiceHours = op.serviceHours > 0
      ? Math.round(op.totalIncidents / op.serviceHours * 100 * 100) / 100
      : undefined;
  }

  let totalStopVisits = 0;
  for (const v of opVisits.values()) totalStopVisits += v;
  let totalServiceSec = 0;
  for (const v of opServiceSec.values()) totalServiceSec += v;

  const totalServiceHours = Math.round(totalServiceSec / 3600 * 100) / 100;

  const classifiedIncidents = incidents.filter(i => i.severity !== 'minor');
  const classifiedCount = classifiedIncidents.length;
  const totalReportableSeconds = classifiedIncidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);
  const exposureRows = [...exposureByRouteOperator.values()];
  const eligibleTimepointVisits = exposureRows.reduce((sum, row) => sum + row.eligibleTimepointVisits, 0);

  return {
    incidents,
    byOperator,
    totalIncidents: classifiedCount,
    totalTrackedDwellMinutes: Math.round(totalTrackedSeconds / 60 * 10) / 10,
    totalReportableDwellMinutes: Math.round(totalReportableSeconds / 60 * 10) / 10,
    totalStopVisits,
    totalServiceHours,
    incidentsPer1kVisits: totalStopVisits > 0
      ? Math.round(classifiedCount / totalStopVisits * 1000 * 100) / 100
      : undefined,
    incidentsPer100ServiceHours: totalServiceHours > 0
      ? Math.round(classifiedCount / totalServiceHours * 100 * 100) / 100
      : undefined,
    eligibleTimepointVisits,
    incidentsPer1kEligibleVisits: eligibleTimepointVisits > 0
      ? Math.round(classifiedCount / eligibleTimepointVisits * 1000 * 100) / 100
      : undefined,
    exposureByRouteOperator: exposureRows,
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
    if (r.apcSource <= 0) missingAPC++;
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

function getObservedSegmentEndTime(
  to: Pick<STREETSRecord, 'observedArrivalTime' | 'observedDepartureTime'>,
  isTerminalSegmentEnd: boolean,
): string | null {
  return isTerminalSegmentEnd
    ? (to.observedArrivalTime || to.observedDepartureTime)
    : (to.observedDepartureTime || to.observedArrivalTime);
}

function getScheduledControlHoldSeconds(
  stop: Pick<STREETSRecord, 'arrivalTime' | 'stopTime' | 'timePoint'>,
): number {
  if (!stop.timePoint) return 0;

  const schedArrivalSec = parseStrictTimeToSeconds(stop.arrivalTime);
  let schedDepartureSec = parseStrictTimeToSeconds(stop.stopTime);
  if (schedArrivalSec === null || schedDepartureSec === null) return 0;

  if (schedDepartureSec < schedArrivalSec) {
    if (schedArrivalSec - schedDepartureSec >= MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS) {
      schedDepartureSec += 86400;
    } else {
      return 0;
    }
  }

  return Math.max(0, schedDepartureSec - schedArrivalSec);
}

function getActualStopDwellSeconds(
  stop: Pick<STREETSRecord, 'observedArrivalTime' | 'observedDepartureTime'>,
): number {
  if (!stop.observedArrivalTime || !stop.observedDepartureTime) return 0;

  const observedArrivalSec = parseStrictTimeToSeconds(stop.observedArrivalTime);
  let observedDepartureSec = parseStrictTimeToSeconds(stop.observedDepartureTime);
  if (observedArrivalSec === null || observedDepartureSec === null) return 0;

  if (observedDepartureSec < observedArrivalSec) {
    if (observedArrivalSec - observedDepartureSec >= MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS) {
      observedDepartureSec += 86400;
    } else {
      return 0;
    }
  }

  return Math.max(0, observedDepartureSec - observedArrivalSec);
}

function computeObservedSegmentRuntimeSeconds(
  from: Pick<STREETSRecord, 'observedDepartureTime'>,
  to: Pick<STREETSRecord, 'arrivalTime' | 'stopTime' | 'timePoint' | 'observedArrivalTime' | 'observedDepartureTime'>,
  isTerminalSegmentEnd: boolean,
): number | null {
  if (!from.observedDepartureTime) return null;

  const observedSegmentEndTime = getObservedSegmentEndTime(to, isTerminalSegmentEnd);
  if (!observedSegmentEndTime) return null;

  const departureSec = timeToSeconds(from.observedDepartureTime);
  let observedEndSec = timeToSeconds(observedSegmentEndTime);
  if (observedEndSec < departureSec) observedEndSec += 86400;

  let runtimeSec = observedEndSec - departureSec;
  if (runtimeSec <= 0) return null;

  const downstreamDepartureUsed = !!to.observedDepartureTime && observedSegmentEndTime === to.observedDepartureTime;
  if (downstreamDepartureUsed) {
    const scheduledControlHoldSec = getScheduledControlHoldSeconds(to);
    const actualDwellSec = getActualStopDwellSeconds(to);
    const controlHoldToSubtractSec = Math.min(runtimeSec, scheduledControlHoldSec, actualDwellSec);
    runtimeSec -= controlHoldToSubtractSec;
  }

  return runtimeSec > 0 ? runtimeSec : null;
}

interface RuntimeTripPatternInfo {
  patternId: string;
  patternKind: RuntimePatternKind;
  routeId: string;
  direction: string;
  stopIds: string[];
  stopNames: string[];
  routeStopIndexes: number[];
}

function hashRuntimePattern(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getRuntimeEligibleTripRecords(records: STREETSRecord[]): STREETSRecord[] {
  return [...records]
    .filter(r => !r.inBetween && !r.isTripper)
    .sort((a, b) => a.routeStopIndex - b.routeStopIndex);
}

function buildRuntimeTripPatternInfo(sorted: STREETSRecord[]): RuntimeTripPatternInfo | null {
  if (sorted.length < 2) return null;

  const firstRecord = sorted[0];
  const stopIds: string[] = [];
  const stopNames: string[] = [];
  const routeStopIndexes: number[] = [];
  const seenStops = new Set<string>();

  sorted.forEach((record) => {
    if (!record.stopId) return;
    const key = `${record.stopId}|${record.routeStopIndex}`;
    if (seenStops.has(key)) return;
    seenStops.add(key);
    stopIds.push(record.stopId);
    stopNames.push(record.stopName);
    routeStopIndexes.push(record.routeStopIndex);
  });

  if (stopIds.length < 2) return null;

  const patternKind: RuntimePatternKind = sorted.some(record => record.isDetour) ? 'detour' : 'normal';
  const signature = [
    firstRecord.routeId,
    firstRecord.direction,
    patternKind,
    ...stopIds.map((stopId, index) => `${routeStopIndexes[index]}:${stopId}`),
  ].join('|');

  return {
    patternId: `${patternKind}-${hashRuntimePattern(signature)}`,
    patternKind,
    routeId: firstRecord.routeId,
    direction: firstRecord.direction,
    stopIds,
    stopNames,
    routeStopIndexes,
  };
}

function buildRuntimePatterns(records: STREETSRecord[]): DailyRuntimePattern[] {
  const byTrip = groupBy(records, r => r.tripId);
  const patterns = new Map<string, DailyRuntimePattern>();

  for (const tripRecs of byTrip.values()) {
    const pattern = buildRuntimeTripPatternInfo(getRuntimeEligibleTripRecords(tripRecs));
    if (!pattern) continue;

    const existing = patterns.get(pattern.patternId);
    if (existing) {
      existing.tripCount += 1;
    } else {
      patterns.set(pattern.patternId, {
        patternId: pattern.patternId,
        patternKind: pattern.patternKind,
        routeId: pattern.routeId,
        direction: pattern.direction,
        tripCount: 1,
        stopIds: pattern.stopIds,
        stopNames: pattern.stopNames,
        routeStopIndexes: pattern.routeStopIndexes,
      });
    }
  }

  return Array.from(patterns.values()).sort((a, b) => (
    a.routeId.localeCompare(b.routeId, undefined, { numeric: true })
    || a.direction.localeCompare(b.direction)
    || a.patternKind.localeCompare(b.patternKind)
    || b.tripCount - a.tripCount
    || a.patternId.localeCompare(b.patternId)
  ));
}

function buildSegmentRuntimes(records: STREETSRecord[]): DailySegmentRuntimes {
  const byTrip = groupBy(records, r => r.tripId);
  const tripsWithData = new Set<string>();
  const segMap = new Map<string, SegmentRuntimeObservation[]>();

  for (const [tripId, tripRecs] of byTrip) {
    const sorted = [...tripRecs].sort((a, b) => a.routeStopIndex - b.routeStopIndex);
    const timepoints = sorted.filter(r => r.timePoint && !r.isTripper && !r.isDetour && !r.inBetween);
    if (timepoints.length < 2) continue;

    let tripHasData = false;

    for (let i = 0; i < timepoints.length - 1; i++) {
      const from = timepoints[i];
      const to = timepoints[i + 1];
      const isTerminalSegmentEnd = i === timepoints.length - 2;
      const runtimeSec = computeObservedSegmentRuntimeSeconds(from, to, isTerminalSegmentEnd);
      if (runtimeSec === null || runtimeSec > 7200) continue;

      const runtimeMinutes = Math.round(runtimeSec / 60 * 100) / 100;
      const schedSec = timeToSeconds(from.stopTime);
      const totalMin = Math.floor(schedSec / 60);
      const bucketMin = Math.floor(totalMin / 30) * 30;
      const bucketH = Math.floor(bucketMin / 60);
      const bucketM = bucketMin % 60;
      const timeBucket = `${String(bucketH).padStart(2, '0')}:${String(bucketM).padStart(2, '0')}`;

      const segmentName = `${from.stopName} to ${to.stopName}`;
      const key = `${from.routeId}||${from.direction}||${segmentName}`;
      const arr = segMap.get(key);
      const obs: SegmentRuntimeObservation = { runtimeMinutes, timeBucket };
      if (arr) arr.push(obs);
      else segMap.set(key, [obs]);
      tripHasData = true;
    }

    if (tripHasData) tripsWithData.add(tripId);
  }

  const entries: DailySegmentRuntimeEntry[] = [];
  let totalObservations = 0;
  for (const [key, observations] of segMap) {
    const [routeId, direction, segmentName] = key.split('||');
    entries.push({ routeId, direction, segmentName, observations });
    totalObservations += observations.length;
  }

  return { entries, totalObservations, tripsWithData: tripsWithData.size };
}

function buildStopSegmentRuntimes(records: STREETSRecord[]): DailyStopSegmentRuntimes {
  const byTrip = groupBy(records, r => r.tripId);
  const tripsWithData = new Set<string>();
  const segMap = new Map<string, {
    routeId: string;
    direction: string;
    patternId?: string;
    patternKind?: RuntimePatternKind;
    fromStopId: string;
    toStopId: string;
    fromStopName: string;
    toStopName: string;
    fromRouteStopIndex: number;
    toRouteStopIndex: number;
    observations: SegmentRuntimeObservation[];
  }>();

  for (const [tripId, tripRecs] of byTrip) {
    const sorted = getRuntimeEligibleTripRecords(tripRecs);
    const pattern = buildRuntimeTripPatternInfo(sorted);

    if (!pattern || sorted.length < 2) continue;
    let tripHasData = false;

    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const isTerminalSegmentEnd = i === sorted.length - 2;
      if (!from.stopId || !to.stopId || from.stopId === to.stopId) continue;
      if (to.routeStopIndex <= from.routeStopIndex) continue;

      const runtimeSec = computeObservedSegmentRuntimeSeconds(from, to, isTerminalSegmentEnd);
      if (runtimeSec === null || runtimeSec > 3600) continue;

      const runtimeMinutes = Math.round(runtimeSec / 60 * 100) / 100;
      const schedSec = timeToSeconds(from.stopTime);
      const totalMin = Math.floor(schedSec / 60);
      const bucketMin = Math.floor(totalMin / 30) * 30;
      const bucketH = Math.floor(bucketMin / 60);
      const bucketM = bucketMin % 60;
      const timeBucket = `${String(bucketH).padStart(2, '0')}:${String(bucketM).padStart(2, '0')}`;

      const key = `${from.routeId}||${from.direction}||${pattern.patternId}||${from.stopId}||${to.stopId}`;
      const existing = segMap.get(key);
      const obs: SegmentRuntimeObservation = { runtimeMinutes, timeBucket };

      if (existing) {
        existing.observations.push(obs);
      } else {
        segMap.set(key, {
          routeId: from.routeId,
          direction: from.direction,
          patternId: pattern.patternId,
          patternKind: pattern.patternKind,
          fromStopId: from.stopId,
          toStopId: to.stopId,
          fromStopName: from.stopName,
          toStopName: to.stopName,
          fromRouteStopIndex: from.routeStopIndex,
          toRouteStopIndex: to.routeStopIndex,
          observations: [obs],
        });
      }

      tripHasData = true;
    }

    if (tripHasData) tripsWithData.add(tripId);
  }

  const entries: DailyStopSegmentRuntimeEntry[] = [];
  let totalObservations = 0;
  for (const entry of segMap.values()) {
    entries.push({
      routeId: entry.routeId,
      direction: entry.direction,
      patternId: entry.patternId,
      patternKind: entry.patternKind,
      fromStopId: entry.fromStopId,
      toStopId: entry.toStopId,
      fromStopName: entry.fromStopName,
      toStopName: entry.toStopName,
      fromRouteStopIndex: entry.fromRouteStopIndex,
      toRouteStopIndex: entry.toRouteStopIndex,
      segmentName: `${entry.fromStopName} to ${entry.toStopName}`,
      observations: entry.observations,
    });
    totalObservations += entry.observations.length;
  }

  return { entries, totalObservations, tripsWithData: tripsWithData.size };
}

function buildTripStopSegmentRuntimes(records: STREETSRecord[]): DailyTripStopSegmentRuntimes {
  const byTrip = groupBy(records, r => r.tripId);
  const entries: DailyTripStopSegmentRuntimeEntry[] = [];
  let totalObservations = 0;

  for (const [tripId, tripRecs] of byTrip) {
    const sorted = getRuntimeEligibleTripRecords(tripRecs);
    const pattern = buildRuntimeTripPatternInfo(sorted);

    if (!pattern || sorted.length < 2) continue;

    const firstRecord = sorted[0];
    const segments: TripStopSegmentObservation[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const isTerminalSegmentEnd = i === sorted.length - 2;
      if (!from.stopId || !to.stopId || from.stopId === to.stopId) continue;
      if (to.routeStopIndex <= from.routeStopIndex) continue;

      const runtimeSec = computeObservedSegmentRuntimeSeconds(from, to, isTerminalSegmentEnd);
      if (runtimeSec === null || runtimeSec > 3600) continue;

      const runtimeMinutes = Math.round(runtimeSec / 60 * 100) / 100;
      const schedSec = timeToSeconds(from.stopTime);
      const totalMin = Math.floor(schedSec / 60);
      const bucketMin = Math.floor(totalMin / 30) * 30;
      const bucketH = Math.floor(bucketMin / 60);
      const bucketM = bucketMin % 60;
      const timeBucket = `${String(bucketH).padStart(2, '0')}:${String(bucketM).padStart(2, '0')}`;

      segments.push({
        fromStopId: from.stopId,
        toStopId: to.stopId,
        fromRouteStopIndex: from.routeStopIndex,
        toRouteStopIndex: to.routeStopIndex,
        runtimeMinutes,
        timeBucket,
      });
    }

    if (segments.length === 0) continue;

    entries.push({
      tripId,
      tripName: firstRecord.tripName,
      routeId: firstRecord.routeId,
      direction: firstRecord.direction,
      patternId: pattern.patternId,
      patternKind: pattern.patternKind,
      terminalDepartureTime: firstRecord.terminalDepartureTime,
      segments,
    });
    totalObservations += segments.length;
  }

  return { entries, totalObservations, tripsWithData: entries.length };
}

function buildRouteStopDeviations(records: STREETSRecord[]): RouteStopDeviationProfile[] {
  const eligible = otpEligible(records);

  const profileMap = new Map<string, Map<string, { stopName: string; stopId: string; routeStopIndex: number; deviations: number[] }>>();

  for (const r of eligible) {
    const profileKey = `${r.routeId}||${r.direction}`;
    let stopMap = profileMap.get(profileKey);
    if (!stopMap) {
      stopMap = new Map();
      profileMap.set(profileKey, stopMap);
    }

    const deviation = computeDeviation(r);
    const existing = stopMap.get(r.stopId);
    if (existing) {
      existing.deviations.push(deviation);
    } else {
      stopMap.set(r.stopId, {
        stopName: r.stopName,
        stopId: r.stopId,
        routeStopIndex: r.routeStopIndex,
        deviations: [deviation],
      });
    }
  }

  const profiles: RouteStopDeviationProfile[] = [];
  for (const [key, stopMap] of profileMap) {
    const [routeId, direction] = key.split('||');
    const stops: RouteStopDeviationEntry[] = Array.from(stopMap.values())
      .sort((a, b) => a.routeStopIndex - b.routeStopIndex);
    profiles.push({ routeId, direction, stops });
  }

  return profiles.sort((a, b) => {
    const cmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
    if (cmp !== 0) return cmp;
    return a.direction.localeCompare(b.direction);
  });
}

function aggregateSingleDay(
  date: string,
  records: STREETSRecord[],
  loadCapacityConfig: PerformanceLoadCapacityConfig,
): DailySummary {
  const rawDay = records[0].day;
  const dayType = (rawDay === 'SATURDAY' || rawDay === 'SUNDAY' || rawDay === 'MONDAY' ||
    rawDay === 'TUESDAY' || rawDay === 'WEDNESDAY' || rawDay === 'THURSDAY' || rawDay === 'FRIDAY')
    ? parseDayType(rawDay)
    : deriveDayTypeFromDate(date);
  const operationalRecords = records.filter(r => !r.inBetween);
  const sanitization = sanitizeRecords(operationalRecords, loadCapacityConfig);
  const eligibleOTP = otpEligible(operationalRecords);

  const dwellMetrics = buildOperatorDwellMetrics(operationalRecords, date);

  return {
    date,
    dayType,
    system: buildSystemMetrics(operationalRecords, eligibleOTP),
    byRoute: buildRouteMetrics(operationalRecords, eligibleOTP),
    byHour: buildHourMetrics(operationalRecords, eligibleOTP),
    byStop: buildStopMetrics(operationalRecords, eligibleOTP),
    byTrip: buildTripMetrics(operationalRecords, eligibleOTP),
    loadProfiles: buildLoadProfiles(operationalRecords),
    ridershipHeatmaps: buildRidershipHeatmaps(operationalRecords, loadCapacityConfig),
    defaultLoadCapacity: loadCapacityConfig.defaultCapacity,
    loadCapacityConfigVersion: loadCapacityConfig.version,
    byOperatorDwell: dwellMetrics,
    byCascade: buildDailyCascadeMetrics(operationalRecords, dwellMetrics.incidents.filter(i => i.severity !== 'minor')),
    segmentRuntimes: buildSegmentRuntimes(operationalRecords),
    stopSegmentRuntimes: buildStopSegmentRuntimes(operationalRecords),
    tripStopSegmentRuntimes: buildTripStopSegmentRuntimes(operationalRecords),
    runtimePatterns: buildRuntimePatterns(operationalRecords),
    routeStopDeviations: buildRouteStopDeviations(operationalRecords),
    byRouteHour: buildRouteHourMetrics(operationalRecords, eligibleOTP),
    dataQuality: buildDataQuality(records, sanitization),
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  };
}

export function aggregateDailySummaries(
  records: STREETSRecord[],
  loadCapacityConfig: PerformanceLoadCapacityConfig = DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
): DailySummary[] {
  const normalizedLoadCapacityConfig = normalizePerformanceLoadCapacityConfig(loadCapacityConfig);
  const byDate = groupBy(records, r => r.date);
  const dates = Array.from(byDate.keys()).sort();
  const summaries: DailySummary[] = [];

  for (const date of dates) {
    summaries.push(aggregateSingleDay(date, byDate.get(date)!, normalizedLoadCapacityConfig));
  }

  return summaries;
}
