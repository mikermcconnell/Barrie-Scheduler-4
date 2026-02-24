// Server-side Dwell Cascade Computer — mirrors utils/schedule/dwellCascadeComputer.ts
import type {
  STREETSRecord,
  DwellIncident,
  DwellCascade,
  CascadeAffectedTrip,
  CascadeStopImpact,
  TerminalRecoveryStats,
  DailyCascadeMetrics,
} from './types';
import { OTP_THRESHOLDS, classifyOTP } from './types';

// ─── Internal Types ───────────────────────────────────────────────────

interface BlockTrip {
  tripId: string;
  tripName: string;
  routeId: string;
  routeName: string;
  block: string;
  scheduledTerminalDepartureSec: number;
  records: STREETSRecord[];
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

// ─── Block Trip Sequencing ────────────────────────────────────────────

function buildBlockTripSequences(records: STREETSRecord[]): Map<string, BlockTrip[]> {
  const byBlock = new Map<string, STREETSRecord[]>();
  for (const r of records) {
    const arr = byBlock.get(r.block);
    if (arr) arr.push(r);
    else byBlock.set(r.block, [r]);
  }

  const result = new Map<string, BlockTrip[]>();

  for (const [block, blockRecs] of byBlock) {
    const byTrip = new Map<string, STREETSRecord[]>();
    for (const r of blockRecs) {
      const arr = byTrip.get(r.tripId);
      if (arr) arr.push(r);
      else byTrip.set(r.tripId, [r]);
    }

    const trips: BlockTrip[] = [];
    for (const [tripId, tripRecs] of byTrip) {
      const sorted = [...tripRecs].sort((a, b) => a.routeStopIndex - b.routeStopIndex);
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

    trips.sort((a, b) => a.scheduledTerminalDepartureSec - b.scheduledTerminalDepartureSec);
    result.set(block, trips);
  }

  return result;
}

// ─── Per-Trip Exit Lateness ───────────────────────────────────────────

function computeTripExitLateness(trip: BlockTrip): number | null {
  const maxStopIdx = Math.max(...trip.records.map(r => r.routeStopIndex));

  const eligibleTimepoints = trip.records.filter(r =>
    r.timePoint &&
    r.routeStopIndex < maxStopIdx &&
    r.observedDepartureTime
  );

  if (eligibleTimepoints.length === 0) return null;

  const lastTP = eligibleTimepoints[eligibleTimepoints.length - 1];
  const actualSec = timeToSeconds(lastTP.observedDepartureTime!);
  const scheduledSec = timeToSeconds(lastTP.stopTime);

  let deviation = actualSec - scheduledSec;
  if (deviation < -43200) deviation += 86400;
  if (deviation > 43200) deviation -= 86400;

  return deviation;
}

function getActualFirstTimepointDeparture(trip: BlockTrip): number | null {
  for (const r of trip.records) {
    if (r.timePoint && r.observedDepartureTime) {
      return timeToSeconds(r.observedDepartureTime);
    }
  }
  return null;
}

function computeRecoveryTime(currentTrip: BlockTrip, nextTrip: BlockTrip): number {
  const lastRec = currentTrip.records[currentTrip.records.length - 1];
  const currentEndSec = timeToSeconds(lastRec.arrivalTime);
  const nextStartSec = nextTrip.scheduledTerminalDepartureSec;

  let gap = nextStartSec - currentEndSec;
  if (gap < 0) gap += 86400;
  return gap;
}

// ─── Cascade Tracing ──────────────────────────────────────────────────

function traceCascade(
  incident: DwellIncident,
  incidentTrip: BlockTrip,
  subsequentTrips: BlockTrip[],
  exitLateness: number,
): DwellCascade {
  const cascadedTrips: CascadeAffectedTrip[] = [];
  let carryoverLate = exitLateness;
  const recoveryAvailable = subsequentTrips.length > 0
    ? computeRecoveryTime(incidentTrip, subsequentTrips[0])
    : 0;

  for (let i = 0; i < subsequentTrips.length; i++) {
    const nextTrip = subsequentTrips[i];
    const prevTrip = i === 0 ? incidentTrip : subsequentTrips[i - 1];
    const recovery = i === 0 ? recoveryAvailable : computeRecoveryTime(prevTrip, nextTrip);

    const lateEntering = Math.max(0, carryoverLate - recovery);
    if (lateEntering <= 0) break;

    const actualDepSec = getActualFirstTimepointDeparture(nextTrip);
    const schedDepSec = nextTrip.scheduledTerminalDepartureSec;

    let observedLate: number;
    if (actualDepSec !== null) {
      observedLate = actualDepSec - schedDepSec;
      if (observedLate < -43200) observedLate += 86400;
      if (observedLate > 43200) observedLate -= 86400;
    } else {
      observedLate = lateEntering;
    }

    const otpStatus = classifyOTP(observedLate);
    const recoveredHere = observedLate <= OTP_THRESHOLDS.lateSeconds;

    cascadedTrips.push({
      tripName: nextTrip.tripName,
      routeId: nextTrip.routeId,
      terminalDepartureTime: nextTrip.records[0].terminalDepartureTime,
      observedDepartureSeconds: actualDepSec,
      scheduledDepartureSeconds: schedDepSec,
      lateSeconds: observedLate,
      otpStatus,
      recoveredHere,
    });

    if (recoveredHere) break;

    const nextExitLateness = computeTripExitLateness(nextTrip);
    carryoverLate = nextExitLateness !== null ? Math.max(0, nextExitLateness) : observedLate;
  }

  const blastRadius = cascadedTrips.filter(t => !t.recoveredHere).length;

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
    excessLateSeconds: exitLateness,
    recoveryTimeAvailableSeconds: recoveryAvailable,
    cascadedTrips,
    blastRadius,
    absorbed: cascadedTrips.length === 0,
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
    const absorbedCount = group.filter(c => c.absorbed).length;
    const cascadedCount = group.length - absorbedCount;
    const totalBlast = group.reduce((s, c) => s + c.blastRadius, 0);
    const totalDwell = group.reduce((s, c) => s + c.trackedDwellSeconds, 0);
    const totalExcess = group.reduce((s, c) => s + c.excessLateSeconds, 0);

    results.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: group.length,
      totalTrackedDwellSeconds: totalDwell,
      totalBlastRadius: totalBlast,
      avgBlastRadius: safeDivide(totalBlast, cascadedCount),
      absorbedCount,
      cascadedCount,
      avgExcessLateSeconds: safeDivide(totalExcess, group.length),
    });
  }

  return results.sort((a, b) => b.totalBlastRadius - a.totalBlastRadius || b.cascadedCount - a.cascadedCount);
}

function buildByTerminal(cascades: DwellCascade[], blockTrips: Map<string, BlockTrip[]>): TerminalRecoveryStats[] {
  const terminalMap = new Map<string, { cascades: DwellCascade[]; recoveryTimes: number[] }>();

  for (const c of cascades) {
    const trips = blockTrips.get(c.block);
    if (!trips) continue;

    const tripIdx = trips.findIndex(t => t.tripName === c.tripName);
    if (tripIdx < 0) continue;

    const trip = trips[tripIdx];
    const lastRec = trip.records[trip.records.length - 1];
    const terminalKey = `${lastRec.stopId}||${lastRec.stopName}||${c.routeId}`;

    const entry = terminalMap.get(terminalKey);
    if (entry) {
      entry.cascades.push(c);
      entry.recoveryTimes.push(c.recoveryTimeAvailableSeconds);
    } else {
      terminalMap.set(terminalKey, {
        cascades: [c],
        recoveryTimes: [c.recoveryTimeAvailableSeconds],
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

    const absorbedCount = entry.cascades.filter(c => c.absorbed).length;
    const cascadedCount = entry.cascades.length - absorbedCount;
    const totalExcess = entry.cascades.reduce((s, c) => s + c.excessLateSeconds, 0);
    const totalRecovery = entry.recoveryTimes.reduce((s, r) => s + r, 0);

    results.push({
      stopName: entry.cascades[0].stopName,
      stopId: entry.cascades[0].stopId,
      routeId: first.routeId,
      incidentCount: entry.cascades.length,
      absorbedCount,
      cascadedCount,
      avgScheduledRecoverySeconds: safeDivide(totalRecovery, entry.cascades.length),
      avgExcessLateSeconds: safeDivide(totalExcess, entry.cascades.length),
      sufficientRecovery: absorbedCount >= entry.cascades.length * 0.75,
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
      totalCascades: 0,
      totalAbsorbed: 0,
      avgBlastRadius: 0,
      totalCascadeOTPDamage: 0,
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

    const exitLateness = computeTripExitLateness(incidentTrip);
    if (exitLateness === null || exitLateness <= 0) {
      cascades.push({
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
        excessLateSeconds: exitLateness ?? 0,
        recoveryTimeAvailableSeconds: tripIdx < trips.length - 1
          ? computeRecoveryTime(incidentTrip, trips[tripIdx + 1])
          : 0,
        cascadedTrips: [],
        blastRadius: 0,
        absorbed: true,
      });
      continue;
    }

    const subsequentTrips = trips.slice(tripIdx + 1);
    cascades.push(traceCascade(incident, incidentTrip, subsequentTrips, exitLateness));
  }

  const totalCascades = cascades.filter(c => !c.absorbed).length;
  const totalAbsorbed = cascades.length - totalCascades;
  const cascadedOnly = cascades.filter(c => !c.absorbed);
  const totalDamage = cascades.reduce((s, c) => s + c.blastRadius, 0);

  return {
    cascades,
    byStop: buildByStop(cascades),
    byTerminal: buildByTerminal(cascades, blockTrips),
    totalCascades,
    totalAbsorbed,
    avgBlastRadius: safeDivide(
      cascadedOnly.reduce((s, c) => s + c.blastRadius, 0),
      cascadedOnly.length,
    ),
    totalCascadeOTPDamage: totalDamage,
  };
}
