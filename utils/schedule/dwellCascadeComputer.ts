// Dwell Cascade Computer
// Traces how dwell incidents propagate through a block's trip chain,
// attributing downstream OTP damage back to the originating dwell.

import type {
  STREETSRecord,
  DwellIncident,
  DwellCascade,
  CascadeAffectedTrip,
  CascadeTimepointObs,
  CascadeStopImpact,
  TerminalRecoveryStats,
  DailyCascadeMetrics,
} from '../performanceDataTypes';
import { OTP_THRESHOLDS } from '../performanceDataTypes';

// ─── Internal Types ───────────────────────────────────────────────────

interface BlockTrip {
  tripId: string;
  tripName: string;
  routeId: string;
  routeName: string;
  block: string;
  scheduledTerminalDepartureSec: number;
  records: STREETSRecord[]; // sorted by routeStopIndex
}

// ─── Helpers ──────────────────────────────────────────────────────────

function timeToSeconds(time: string): number {
  const normalized = time.trim();
  if (normalized.includes(':')) {
    const parts = normalized.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
    return h * 3600 + m * 60 + s;
  }
  const dec = parseFloat(normalized);
  if (isNaN(dec) || dec < 0) return 0;
  const wholeDays = Math.floor(dec);
  const dayFraction = dec - wholeDays;
  return wholeDays * 86400 + Math.round(dayFraction * 86400);
}

function safeDivide(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function computeObservedDeviationSeconds(
  scheduledTime: string,
  observedTime: string | null | undefined,
): number | null {
  if (!observedTime) return null;
  const scheduledSec = timeToSeconds(scheduledTime);
  const observedSec = timeToSeconds(observedTime);
  let dev = observedSec - scheduledSec;
  if (dev < -43200) dev += 86400;
  if (dev > 43200) dev -= 86400;
  return dev;
}

function computeAttributedDelaySeconds(
  rawDeviationSeconds: number | null,
  baselineLateSeconds: number,
): number | null {
  if (rawDeviationSeconds === null) return null;
  return Math.max(0, rawDeviationSeconds - baselineLateSeconds);
}

/** Pick a canonical row when STREETS emits duplicates for the same stop pass. */
function chooseCanonicalStopRecord(records: STREETSRecord[]): STREETSRecord {
  let chosen = records[0];
  let bestDev = chosen.observedDepartureTime
    ? Math.abs(timeToSeconds(chosen.observedDepartureTime) - timeToSeconds(chosen.stopTime))
    : Number.POSITIVE_INFINITY;

  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    const dev = rec.observedDepartureTime
      ? Math.abs(timeToSeconds(rec.observedDepartureTime) - timeToSeconds(rec.stopTime))
      : Number.POSITIVE_INFINITY;
    if (dev < bestDev) {
      chosen = rec;
      bestDev = dev;
    }
  }

  return chosen;
}

/** Deduplicate repeated observations for the same stop pass within a trip. */
function dedupeTripRecords(tripRecs: STREETSRecord[]): STREETSRecord[] {
  const byStopPass = new Map<string, STREETSRecord[]>();
  for (const r of tripRecs) {
    const key = `${r.routeStopIndex}|${r.stopId}`;
    const arr = byStopPass.get(key);
    if (arr) arr.push(r);
    else byStopPass.set(key, [r]);
  }

  const deduped: STREETSRecord[] = [];
  for (const group of byStopPass.values()) {
    deduped.push(group.length === 1 ? group[0] : chooseCanonicalStopRecord(group));
  }
  return deduped;
}

function findIncidentRecord(incidentTrip: BlockTrip, incident: DwellIncident): STREETSRecord | null {
  const exact = incidentTrip.records.find((rec) =>
    rec.stopId === incident.stopId
    && rec.observedDepartureTime === incident.observedDepartureTime,
  );
  if (exact) return exact;

  const byStop = incidentTrip.records.find(rec => rec.stopId === incident.stopId);
  return byStop ?? null;
}

// ─── Block Trip Sequencing ────────────────────────────────────────────

/** Group records by block, then by trip within each block, sorted by scheduled departure. */
function buildBlockTripSequences(records: STREETSRecord[]): Map<string, BlockTrip[]> {
  // Group by block
  const byBlock = new Map<string, STREETSRecord[]>();
  for (const r of records) {
    const arr = byBlock.get(r.block);
    if (arr) arr.push(r);
    else byBlock.set(r.block, [r]);
  }

  const result = new Map<string, BlockTrip[]>();

  for (const [block, blockRecs] of byBlock) {
    // Group by tripId within block
    const byTrip = new Map<string, STREETSRecord[]>();
    for (const r of blockRecs) {
      const arr = byTrip.get(r.tripId);
      if (arr) arr.push(r);
      else byTrip.set(r.tripId, [r]);
    }

    const trips: BlockTrip[] = [];
    for (const [tripId, tripRecs] of byTrip) {
      const sorted = dedupeTripRecords(tripRecs)
        .sort((a, b) => a.routeStopIndex - b.routeStopIndex);
      const first = sorted[0];
      trips.push({
        tripId,
        tripName: first.tripName,
        routeId: first.routeId,
        routeName: first.routeName,
        block: first.block,
        scheduledTerminalDepartureSec: timeToSeconds(first.terminalDepartureTime),
        records: sorted,
      });
    }

    // Sort trips by scheduled terminal departure (handles post-midnight via raw seconds)
    trips.sort((a, b) => a.scheduledTerminalDepartureSec - b.scheduledTerminalDepartureSec);
    result.set(block, trips);
  }

  return result;
}

/**
 * Compute recovery time between two consecutive trips in a block.
 * Returns both scheduled (based on timetable) and observed (based on AVL) recovery.
 * Observed uses the actual departure time from the last stop; falls back to scheduled
 * when observedDepartureTime is null.
 */
function computeRecoveryTime(currentTrip: BlockTrip, nextTrip: BlockTrip): { scheduled: number; observed: number } {
  const lastRec = currentTrip.records[currentTrip.records.length - 1];
  const scheduledEndSec = timeToSeconds(lastRec.arrivalTime);
  const nextStartSec = nextTrip.scheduledTerminalDepartureSec;

  let scheduledGap = nextStartSec - scheduledEndSec;
  if (scheduledGap < 0) scheduledGap += 86400; // overnight wrap

  // Observed: use actual departure from last stop (when bus actually left terminal)
  const observedEndSec = lastRec.observedDepartureTime
    ? timeToSeconds(lastRec.observedDepartureTime)
    : scheduledEndSec; // fallback to scheduled
  let observedGap = nextStartSec - observedEndSec;
  if (observedGap < 0) observedGap += 86400;

  return { scheduled: scheduledGap, observed: observedGap };
}

// ─── Cascade Tracing (Pure AVL Forward Walk) ─────────────────────────

interface TracedTripSummary {
  trip: CascadeAffectedTrip | null;
  observedTimepointCount: number;
}

function buildTracedTrip(
  trip: BlockTrip,
  baselineLateSeconds: number,
  options: {
    phase: 'same-trip' | 'later-trip';
    scheduledRecoverySeconds: number;
    observedRecoverySeconds?: number;
    startAfterRouteStopIndex?: number;
  },
): TracedTripSummary {
  const maxStopIdx = Math.max(...trip.records.map(r => r.routeStopIndex));
  const timepointRecords = trip.records.filter((r) => {
    if (!r.timePoint || r.routeStopIndex >= maxStopIdx) return false;
    if (options.startAfterRouteStopIndex !== undefined && r.routeStopIndex <= options.startAfterRouteStopIndex) {
      return false;
    }
    return true;
  });

  const timepoints: CascadeTimepointObs[] = [];
  let lateCount = 0;
  let affectedCount = 0;
  let observedTimepointCount = 0;
  let tripBackUnderThresholdStop: string | null = null;
  let tripRecoveredAtStop: string | null = null;

  for (const rec of timepointRecords) {
    let deviationSeconds: number | null = null;
    let rawDeviationSeconds: number | null = null;
    let isLate = false;

    if (rec.observedDepartureTime) {
      observedTimepointCount++;
      rawDeviationSeconds = computeObservedDeviationSeconds(rec.stopTime, rec.observedDepartureTime);
      deviationSeconds = computeAttributedDelaySeconds(rawDeviationSeconds, baselineLateSeconds);

      if ((deviationSeconds ?? 0) > 0) {
        affectedCount++;
      }

      if ((deviationSeconds ?? 0) > OTP_THRESHOLDS.lateSeconds) {
        isLate = true;
        lateCount++;
      } else if (tripBackUnderThresholdStop === null) {
        tripBackUnderThresholdStop = rec.stopName;
      }

      if ((deviationSeconds ?? 0) === 0) {
        tripRecoveredAtStop = rec.stopName;
      }
    }

    timepoints.push({
      stopName: rec.stopName,
      stopId: rec.stopId,
      routeStopIndex: rec.routeStopIndex,
      scheduledDeparture: rec.stopTime,
      observedDeparture: rec.observedDepartureTime ?? null,
      deviationSeconds,
      rawDeviationSeconds,
      isLate,
      boardings: rec.boardings,
    });

    if (tripRecoveredAtStop !== null) {
      break;
    }
  }

  if (observedTimepointCount === 0) {
    return {
      trip: null,
      observedTimepointCount,
    };
  }

  let tripLateSeconds = 0;
  for (const tp of timepoints) {
    if ((tp.deviationSeconds ?? 0) > 0) {
      tripLateSeconds += tp.deviationSeconds;
    }
  }

  return {
    trip: {
      phase: options.phase,
      tripName: trip.tripName,
      tripId: trip.tripId,
      routeId: trip.routeId,
      routeName: trip.routeName,
      terminalDepartureTime: trip.records[0].terminalDepartureTime,
      scheduledRecoverySeconds: options.scheduledRecoverySeconds,
      observedRecoverySeconds: options.observedRecoverySeconds,
      timepoints,
      lateTimepointCount: lateCount,
      affectedTimepointCount: affectedCount,
      backUnderThresholdAtStop: tripBackUnderThresholdStop,
      recoveredAtStop: tripRecoveredAtStop,
      otpStatus: lateCount > 0 ? 'late' : 'on-time',
      backUnderThresholdHere: tripBackUnderThresholdStop !== null,
      recoveredHere: tripRecoveredAtStop !== null,
      lateSeconds: tripLateSeconds,
    },
    observedTimepointCount,
  };
}

function traceCascade(
  incident: DwellIncident,
  incidentTrip: BlockTrip,
  subsequentTrips: BlockTrip[],
): DwellCascade {
  let sameTripImpact: CascadeAffectedTrip | null = null;
  let sameTripObserved = false;
  const cascadedTrips: CascadeAffectedTrip[] = [];
  let chainBroken = false;
  let backUnderThresholdAtTrip: string | null = null;
  let backUnderThresholdAtStop: string | null = null;
  let recoveredAtTrip: string | null = null;
  let recoveredAtStop: string | null = null;
  const incidentRecord = findIncidentRecord(incidentTrip, incident);
  const baselineArrivalDeviation = incidentRecord
    ? computeObservedDeviationSeconds(incidentRecord.arrivalTime, incidentRecord.observedArrivalTime)
    : null;
  const baselineLateSeconds = Math.max(0, baselineArrivalDeviation ?? 0);

  // Recovery time available = gap between incident trip end and next trip start
  const topRecovery = subsequentTrips.length > 0
    ? computeRecoveryTime(incidentTrip, subsequentTrips[0])
    : { scheduled: 0, observed: 0 };
  const recoveryTimeAvailableSeconds = topRecovery.scheduled;
  const observedRecoverySeconds = topRecovery.observed;

  if (incidentRecord) {
    const sameTripSummary = buildTracedTrip(incidentTrip, baselineLateSeconds, {
      phase: 'same-trip',
      scheduledRecoverySeconds: 0,
      startAfterRouteStopIndex: incidentRecord.routeStopIndex,
    });

    sameTripObserved = sameTripSummary.observedTimepointCount > 0;
    sameTripImpact = sameTripSummary.trip;

    if (sameTripImpact?.backUnderThresholdHere) {
      backUnderThresholdAtTrip = incidentTrip.tripName;
      backUnderThresholdAtStop = sameTripImpact.backUnderThresholdAtStop ?? null;
    }

    if (sameTripImpact?.recoveredHere) {
      recoveredAtTrip = incidentTrip.tripName;
      recoveredAtStop = sameTripImpact.recoveredAtStop;
      chainBroken = true;
    }
  }

  for (let i = 0; i < subsequentTrips.length; i++) {
    if (chainBroken) break;

    const nextTrip = subsequentTrips[i];
    const prevTrip = i === 0 ? incidentTrip : subsequentTrips[i - 1];
    const recoveryResult = computeRecoveryTime(prevTrip, nextTrip);

    const tripSummary = buildTracedTrip(nextTrip, baselineLateSeconds, {
      phase: 'later-trip',
      scheduledRecoverySeconds: recoveryResult.scheduled,
      observedRecoverySeconds: recoveryResult.observed,
    });

    if (!tripSummary.trip) {
      continue;
    }

    cascadedTrips.push(tripSummary.trip);

    if (!backUnderThresholdAtTrip && tripSummary.trip.backUnderThresholdHere) {
      backUnderThresholdAtTrip = nextTrip.tripName;
      backUnderThresholdAtStop = tripSummary.trip.backUnderThresholdAtStop ?? null;
    }

    if (tripSummary.trip.recoveredHere) {
      recoveredAtTrip = nextTrip.tripName;
      recoveredAtStop = tripSummary.trip.recoveredAtStop;
      chainBroken = true;
    }
  }

  // Remove trailing trips with no attributable delay.
  while (cascadedTrips.length > 0) {
    const last = cascadedTrips[cascadedTrips.length - 1];
    if (last.affectedTimepointCount === 0 && !last.backUnderThresholdHere && !last.recoveredHere) {
      cascadedTrips.pop();
    } else {
      break;
    }
  }

  // Compute aggregate metrics
  let blastRadius = 0;
  let totalLateSeconds = 0;
  for (const trip of cascadedTrips) {
    blastRadius += trip.lateTimepointCount;
    totalLateSeconds += trip.lateSeconds;
  }

  return {
    date: incident.date,
    block: incident.block,
    routeId: incident.routeId,
    routeName: incident.routeName,
    stopName: incident.stopName,
    stopId: incident.stopId,
    tripName: incident.tripName,
    operatorId: incident.operatorId,
    observedDepartureTime: incident.observedDepartureTime,
    trackedDwellSeconds: incident.trackedDwellSeconds,
    severity: incident.severity,
    baselineLateSeconds,
    sameTripImpact,
    sameTripObserved,
    cascadedTrips,
    blastRadius,
    affectedTripCount: cascadedTrips.filter(trip => trip.affectedTimepointCount > 0).length,
    backUnderThresholdAtTrip,
    backUnderThresholdAtStop,
    recoveredAtTrip,
    recoveredAtStop,
    totalLateSeconds,
    recoveryTimeAvailableSeconds,
    observedRecoverySeconds,
  };
}

// ─── Summary Builders ─────────────────────────────────────────────────

function buildByStop(cascades: DwellCascade[]): CascadeStopImpact[] {
  const map = new Map<string, DwellCascade[]>();
  for (const c of cascades) {
    const key = `${c.stopId}||${c.stopName}||${c.routeId}`;
    const arr = map.get(key);
    if (arr) arr.push(c);
    else map.set(key, [c]);
  }

  const results: CascadeStopImpact[] = [];
  for (const [, group] of map) {
    const first = group[0];
    const cascaded = group.filter(c => c.blastRadius > 0);
    const nonCascaded = group.length - cascaded.length;
    const totalBlast = group.reduce((s, c) => s + c.blastRadius, 0);
    const totalDwell = group.reduce((s, c) => s + c.trackedDwellSeconds, 0);
    const totalLate = cascaded.reduce((s, c) => s + c.totalLateSeconds, 0);

    results.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: group.length,
      totalTrackedDwellSeconds: totalDwell,
      totalBlastRadius: totalBlast,
      avgBlastRadius: safeDivide(totalBlast, cascaded.length),
      cascadedCount: cascaded.length,
      nonCascadedCount: nonCascaded,
      avgTotalLateSeconds: safeDivide(totalLate, cascaded.length),
    });
  }

  return results.sort((a, b) => b.totalBlastRadius - a.totalBlastRadius || b.cascadedCount - a.cascadedCount);
}

function buildByTerminal(cascades: DwellCascade[], blockTrips: Map<string, BlockTrip[]>): TerminalRecoveryStats[] {
  const terminalMap = new Map<string, { cascades: DwellCascade[]; scheduledRecoveries: number[]; observedRecoveries: number[] }>();

  for (const c of cascades) {
    const trips = blockTrips.get(c.block);
    if (!trips) continue;

    const tripIdx = trips.findIndex(t => t.tripName === c.tripName);
    if (tripIdx < 0) continue;

    const trip = trips[tripIdx];
    const lastRec = trip.records[trip.records.length - 1];
    const terminalKey = `${lastRec.stopId}||${lastRec.stopName}||${c.routeId}`;

    const nextTrip = tripIdx < trips.length - 1 ? trips[tripIdx + 1] : null;
    const recoveryResult = nextTrip ? computeRecoveryTime(trip, nextTrip) : { scheduled: 0, observed: 0 };

    const entry = terminalMap.get(terminalKey);
    if (entry) {
      entry.cascades.push(c);
      entry.scheduledRecoveries.push(recoveryResult.scheduled);
      entry.observedRecoveries.push(recoveryResult.observed);
    } else {
      terminalMap.set(terminalKey, {
        cascades: [c],
        scheduledRecoveries: [recoveryResult.scheduled],
        observedRecoveries: [recoveryResult.observed],
      });
    }
  }

  const results: TerminalRecoveryStats[] = [];
  for (const [, entry] of terminalMap) {
    const first = entry.cascades[0];
    const trips = blockTrips.get(first.block);
    if (!trips) continue;

    const tripIdx = trips.findIndex(t => t.tripName === first.tripName);
    if (tripIdx < 0) continue;

    const trip = trips[tripIdx];
    const lastRec = trip.records[trip.records.length - 1];

    const cascadedCount = entry.cascades.filter(c => c.blastRadius > 0).length;
    const nonCascadedCount = entry.cascades.length - cascadedCount;
    const totalScheduledRecovery = entry.scheduledRecoveries.reduce((s, r) => s + r, 0);
    const totalObservedRecovery = entry.observedRecoveries.reduce((s, r) => s + r, 0);
    const totalLate = entry.cascades.reduce((s, c) => s + c.totalLateSeconds, 0);

    results.push({
      stopName: lastRec.stopName,
      stopId: lastRec.stopId,
      routeId: first.routeId,
      incidentCount: entry.cascades.length,
      absorbedCount: nonCascadedCount,
      cascadedCount,
      avgScheduledRecoverySeconds: safeDivide(totalScheduledRecovery, entry.cascades.length),
      avgObservedRecoverySeconds: safeDivide(totalObservedRecovery, entry.cascades.length),
      avgExcessLateSeconds: safeDivide(totalLate, entry.cascades.length),
      sufficientRecovery: nonCascadedCount >= entry.cascades.length * 0.75,
    });
  }

  return results.sort((a, b) => b.cascadedCount - a.cascadedCount || a.absorbedCount - b.absorbedCount);
}

// ─── Main Entry Point ─────────────────────────────────────────────────

export function buildDailyCascadeMetrics(
  records: STREETSRecord[],
  dwellIncidents: DwellIncident[],
): DailyCascadeMetrics {
  if (dwellIncidents.length === 0) {
    return {
      cascades: [],
      byStop: [],
      byTerminal: [],
      totalCascaded: 0,
      totalNonCascaded: 0,
      avgBlastRadius: 0,
      totalBlastRadius: 0,
    };
  }

  const blockTrips = buildBlockTripSequences(records);
  const cascades: DwellCascade[] = [];

  for (const incident of dwellIncidents) {
    const trips = blockTrips.get(incident.block);
    if (!trips) continue;

    const tripIdx = trips.findIndex(t => t.tripName === incident.tripName);
    if (tripIdx < 0) continue;

    const incidentTrip = trips[tripIdx];
    const subsequentTrips = trips.slice(tripIdx + 1);
    cascades.push(traceCascade(incident, incidentTrip, subsequentTrips));
  }

  const cascadedOnly = cascades.filter(c => c.blastRadius > 0);
  const totalBlast = cascades.reduce((s, c) => s + c.blastRadius, 0);

  return {
    cascades,
    byStop: buildByStop(cascades),
    byTerminal: buildByTerminal(cascades, blockTrips),
    totalCascaded: cascadedOnly.length,
    totalNonCascaded: cascades.length - cascadedOnly.length,
    avgBlastRadius: safeDivide(totalBlast, cascadedOnly.length),
    totalBlastRadius: totalBlast,
  };
}
