/**
 * Diagnostic test: WHY are dwell cascades not cascading to other trips?
 *
 * Traces every dwell incident through the cascade gates and reports
 * exactly where each one gets blocked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseRow } from '../utils/performanceDataParser';
import type { STREETSRecord, DwellIncident, DwellSeverity } from '../utils/performanceDataTypes';
import { DWELL_THRESHOLDS, classifyDwell } from '../utils/performanceDataTypes';

// ─── CSV Parser ──────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, unknown>[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let c = 0; c < lines[i].length; c++) {
            const ch = lines[i][c];
            if (ch === '"') {
                if (inQuotes && lines[i][c + 1] === '"') { current += '"'; c++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) { values.push(current); current = ''; }
            else current += ch;
        }
        values.push(current);
        const row: Record<string, unknown> = {};
        for (let h = 0; h < headers.length; h++) row[headers[h]] = values[h] ?? '';
        rows.push(row);
    }
    return rows;
}

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

// ─── Build dwell incidents (mirrors aggregator logic) ────────────────

function buildDwellIncidents(records: STREETSRecord[], date: string): DwellIncident[] {
    const MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS = 3600;
    const incidents: DwellIncident[] = [];

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
        if (recs.length > 1) {
            let bestDev = Math.abs(timeToSeconds(chosen.observedDepartureTime!) - timeToSeconds(chosen.stopTime));
            for (let i = 1; i < recs.length; i++) {
                const dev = Math.abs(timeToSeconds(recs[i].observedDepartureTime!) - timeToSeconds(recs[i].stopTime));
                if (dev < bestDev) { chosen = recs[i]; bestDev = dev; }
            }
        }

        const observedArrival = chosen.observedArrivalTime!;
        const observedDeparture = chosen.observedDepartureTime!;
        let arrSec = timeToSeconds(observedArrival);
        let depSec = timeToSeconds(observedDeparture);

        if (depSec < arrSec) {
            if (arrSec - depSec >= MIDNIGHT_ROLLOVER_MIN_GAP_SECONDS) depSec += 86400;
            else continue;
        }

        const rawDwell = depSec - arrSec;
        if (rawDwell < 0) continue;
        const severity = classifyDwell(rawDwell);
        if (!severity) continue;

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
            trackedDwellSeconds: rawDwell - DWELL_THRESHOLDS.boardingAllowanceSeconds,
            severity,
        });
    }
    return incidents;
}

// ─── Replicate cascade internals for diagnosis ───────────────────────

interface BlockTrip {
    tripId: string;
    tripName: string;
    routeId: string;
    routeName: string;
    block: string;
    scheduledTerminalDepartureSec: number;
    records: STREETSRecord[];
}

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
        if (dev < bestDev) { chosen = rec; bestDev = dev; }
    }
    return chosen;
}

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
        trips.sort((a, b) => a.scheduledTerminalDepartureSec - b.scheduledTerminalDepartureSec);
        result.set(block, trips);
    }
    return result;
}

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

function computeRecoveryTime(currentTrip: BlockTrip, nextTrip: BlockTrip): number {
    const lastRec = currentTrip.records[currentTrip.records.length - 1];
    const currentEndSec = timeToSeconds(lastRec.arrivalTime);
    const nextStartSec = nextTrip.scheduledTerminalDepartureSec;
    let gap = nextStartSec - currentEndSec;
    if (gap < 0) gap += 86400;
    return gap;
}

// ─── Diagnostic Categories ───────────────────────────────────────────

type GateReason =
    | 'BLOCK_NOT_FOUND'
    | 'TRIP_NOT_FOUND'
    | 'EXIT_LATENESS_NULL'
    | 'EXIT_LATENESS_ZERO_OR_NEGATIVE'
    | 'LAST_TRIP_IN_BLOCK'
    | 'RECOVERY_ABSORBED'
    | 'CASCADED';

interface DiagnosticResult {
    incident: DwellIncident;
    gate: GateReason;
    exitLateness: number | null;
    recoveryTimeSec: number | null;
    subsequentTripsInBlock: number;
    cascadedTripCount: number;
    detail: string;
}

// ─── Test ─────────────────────────────────────────────────────────────

const CSV_PATH = 'C:/Users/Mike McConnell/Downloads/Eddy Data for previous Day (10).csv';

function csvExists(): boolean {
    try { readFileSync(CSV_PATH, 'utf-8'); return true; } catch { return false; }
}

describe.skipIf(!csvExists())('Cascade Diagnostic — Why Not Cascading?', () => {
    let records: STREETSRecord[];
    let incidents: DwellIncident[];
    let blockTrips: Map<string, BlockTrip[]>;
    let diagnostics: DiagnosticResult[];

    // Parse once
    try {
        const text = readFileSync(CSV_PATH, 'utf-8');
        const rawRows = parseCSV(text);
        records = rawRows.map((r, i) => parseRow(r, i + 2)).filter((r): r is STREETSRecord => r !== null);
        incidents = buildDwellIncidents(records, '2026-02-24');
        blockTrips = buildBlockTripSequences(records);
        diagnostics = [];
    } catch {
        records = [];
        incidents = [];
        blockTrips = new Map();
        diagnostics = [];
    }

    it('runs gate-by-gate diagnostic on every dwell incident', () => {
        diagnostics = [];

        for (const inc of incidents) {
            const trips = blockTrips.get(inc.block);

            // Gate 1: Block not found
            if (!trips) {
                diagnostics.push({
                    incident: inc,
                    gate: 'BLOCK_NOT_FOUND',
                    exitLateness: null,
                    recoveryTimeSec: null,
                    subsequentTripsInBlock: 0,
                    cascadedTripCount: 0,
                    detail: `Block "${inc.block}" not in STREETS records. Available blocks: ${[...blockTrips.keys()].slice(0, 5).join(', ')}...`,
                });
                continue;
            }

            // Gate 2: Trip not found in block
            const tripIdx = trips.findIndex(t => t.tripName === inc.tripName);
            if (tripIdx < 0) {
                diagnostics.push({
                    incident: inc,
                    gate: 'TRIP_NOT_FOUND',
                    exitLateness: null,
                    recoveryTimeSec: null,
                    subsequentTripsInBlock: trips.length,
                    cascadedTripCount: 0,
                    detail: `Trip "${inc.tripName}" not found in block "${inc.block}". Block has trips: ${trips.map(t => t.tripName).join(', ')}`,
                });
                continue;
            }

            const incidentTrip = trips[tripIdx];
            const exitLateness = computeTripExitLateness(incidentTrip);
            const subsequentTrips = trips.slice(tripIdx + 1);
            const recoveryTime = subsequentTrips.length > 0
                ? computeRecoveryTime(incidentTrip, subsequentTrips[0])
                : null;

            // Gate 3: No observed data at exit timepoint
            if (exitLateness === null) {
                // Dig deeper: why no observed data?
                const maxStopIdx = Math.max(...incidentTrip.records.map(r => r.routeStopIndex));
                const allTP = incidentTrip.records.filter(r => r.timePoint && r.routeStopIndex < maxStopIdx);
                const withObs = allTP.filter(r => r.observedDepartureTime);

                diagnostics.push({
                    incident: inc,
                    gate: 'EXIT_LATENESS_NULL',
                    exitLateness: null,
                    recoveryTimeSec: recoveryTime,
                    subsequentTripsInBlock: subsequentTrips.length,
                    cascadedTripCount: 0,
                    detail: `No observed departure at any eligible timepoint. Trip has ${incidentTrip.records.length} records, ${allTP.length} eligible TPs, ${withObs.length} with observed departures.`,
                });
                continue;
            }

            // Gate 4: Trip exited on-time (lateness ≤ 0)
            if (exitLateness <= 0) {
                diagnostics.push({
                    incident: inc,
                    gate: 'EXIT_LATENESS_ZERO_OR_NEGATIVE',
                    exitLateness,
                    recoveryTimeSec: recoveryTime,
                    subsequentTripsInBlock: subsequentTrips.length,
                    cascadedTripCount: 0,
                    detail: `Trip exited ${(exitLateness / 60).toFixed(1)} min from schedule at last TP. Dwell of ${(inc.rawDwellSeconds / 60).toFixed(1)} min was recovered within the trip. Stop: ${inc.stopName}`,
                });
                continue;
            }

            // Gate 5: Last trip in block
            if (subsequentTrips.length === 0) {
                diagnostics.push({
                    incident: inc,
                    gate: 'LAST_TRIP_IN_BLOCK',
                    exitLateness,
                    recoveryTimeSec: null,
                    subsequentTripsInBlock: 0,
                    cascadedTripCount: 0,
                    detail: `Trip exited ${(exitLateness / 60).toFixed(1)} min late but it's the last trip in block "${inc.block}". No downstream trips to cascade into.`,
                });
                continue;
            }

            // Gate 6: Recovery absorbed
            const lateEntering = Math.max(0, exitLateness - (recoveryTime ?? 0));
            if (lateEntering <= 0) {
                diagnostics.push({
                    incident: inc,
                    gate: 'RECOVERY_ABSORBED',
                    exitLateness,
                    recoveryTimeSec: recoveryTime,
                    subsequentTripsInBlock: subsequentTrips.length,
                    cascadedTripCount: 0,
                    detail: `Trip exited ${(exitLateness / 60).toFixed(1)} min late, but recovery time of ${((recoveryTime ?? 0) / 60).toFixed(1)} min absorbed it. Surplus: ${(((recoveryTime ?? 0) - exitLateness) / 60).toFixed(1)} min.`,
                });
                continue;
            }

            // If we get here: cascade SHOULD fire
            diagnostics.push({
                incident: inc,
                gate: 'CASCADED',
                exitLateness,
                recoveryTimeSec: recoveryTime,
                subsequentTripsInBlock: subsequentTrips.length,
                cascadedTripCount: subsequentTrips.length, // actual count determined by traceCascade
                detail: `CASCADED! Exit ${(exitLateness / 60).toFixed(1)} min late, recovery ${((recoveryTime ?? 0) / 60).toFixed(1)} min, entering next trip ${(lateEntering / 60).toFixed(1)} min late. ${subsequentTrips.length} downstream trips available.`,
            });
        }

        // ─── Report ──────────────────────────────────────────────────
        const gateCounts: Record<GateReason, number> = {
            BLOCK_NOT_FOUND: 0,
            TRIP_NOT_FOUND: 0,
            EXIT_LATENESS_NULL: 0,
            EXIT_LATENESS_ZERO_OR_NEGATIVE: 0,
            LAST_TRIP_IN_BLOCK: 0,
            RECOVERY_ABSORBED: 0,
            CASCADED: 0,
        };

        for (const d of diagnostics) {
            gateCounts[d.gate]++;
        }

        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║     DWELL CASCADE DIAGNOSTIC REPORT                    ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║  Total STREETS records:        ${records.length.toString().padStart(6)}`);
        console.log(`║  Total dwell incidents:         ${incidents.length.toString().padStart(6)}`);
        console.log(`║  Unique blocks in data:         ${blockTrips.size.toString().padStart(6)}`);
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log('║  GATE BREAKDOWN (why incidents don\'t cascade):          ║');
        console.log('╠──────────────────────────────────────────────────────────╣');
        console.log(`║  1. Block not found:            ${gateCounts.BLOCK_NOT_FOUND.toString().padStart(6)}  (data mismatch)`);
        console.log(`║  2. Trip not found in block:    ${gateCounts.TRIP_NOT_FOUND.toString().padStart(6)}  (data mismatch)`);
        console.log(`║  3. Exit lateness = null:       ${gateCounts.EXIT_LATENESS_NULL.toString().padStart(6)}  (no AVL data)`);
        console.log(`║  4. Exit lateness ≤ 0:          ${gateCounts.EXIT_LATENESS_ZERO_OR_NEGATIVE.toString().padStart(6)}  (recovered in-trip)`);
        console.log(`║  5. Last trip in block:         ${gateCounts.LAST_TRIP_IN_BLOCK.toString().padStart(6)}  (nothing downstream)`);
        console.log(`║  6. Recovery absorbed:          ${gateCounts.RECOVERY_ABSORBED.toString().padStart(6)}  (layover ate delay)`);
        console.log(`║  7. ACTUALLY CASCADED:          ${gateCounts.CASCADED.toString().padStart(6)}  ✓`);
        console.log('╚══════════════════════════════════════════════════════════╝');

        // Show sample details for the dominant gate
        const dominantGate = (Object.entries(gateCounts) as [GateReason, number][])
            .filter(([g]) => g !== 'CASCADED')
            .sort((a, b) => b[1] - a[1])[0];

        if (dominantGate && dominantGate[1] > 0) {
            console.log(`\n── Top blocker: ${dominantGate[0]} (${dominantGate[1]} incidents) ──`);
            const samples = diagnostics.filter(d => d.gate === dominantGate[0]).slice(0, 5);
            for (const s of samples) {
                console.log(`  Route ${s.incident.routeId} | Block ${s.incident.block} | ${s.incident.tripName}`);
                console.log(`    ${s.detail}`);
            }
        }

        // Show details of gate 4 (recovered in-trip) — most interesting
        if (gateCounts.EXIT_LATENESS_ZERO_OR_NEGATIVE > 0) {
            const recovered = diagnostics.filter(d => d.gate === 'EXIT_LATENESS_ZERO_OR_NEGATIVE');
            const avgDwell = recovered.reduce((s, d) => s + d.incident.rawDwellSeconds, 0) / recovered.length;
            const avgExit = recovered.reduce((s, d) => s + (d.exitLateness ?? 0), 0) / recovered.length;
            console.log(`\n── Gate 4 Analysis: Recovered In-Trip (${recovered.length} incidents) ──`);
            console.log(`  Avg raw dwell: ${(avgDwell / 60).toFixed(1)} min`);
            console.log(`  Avg exit lateness: ${(avgExit / 60).toFixed(1)} min (negative = early)`);
            console.log(`  These buses dwelled excessively but made up time before their last timepoint.`);

            // Show the ones with the BIGGEST dwells that still didn't cascade
            const bigDwellNoCascade = recovered
                .sort((a, b) => b.incident.rawDwellSeconds - a.incident.rawDwellSeconds)
                .slice(0, 5);
            console.log(`  Biggest dwells that STILL didn't cascade:`);
            for (const s of bigDwellNoCascade) {
                console.log(`    ${(s.incident.rawDwellSeconds / 60).toFixed(1)} min dwell → exited ${(s.exitLateness! / 60).toFixed(1)} min from schedule | ${s.incident.stopName} | Route ${s.incident.routeId}`);
            }
        }

        // Show details of gate 6 (recovery absorbed)
        if (gateCounts.RECOVERY_ABSORBED > 0) {
            const absorbed = diagnostics.filter(d => d.gate === 'RECOVERY_ABSORBED');
            const avgRecovery = absorbed.reduce((s, d) => s + (d.recoveryTimeSec ?? 0), 0) / absorbed.length;
            const avgExit = absorbed.reduce((s, d) => s + (d.exitLateness ?? 0), 0) / absorbed.length;
            console.log(`\n── Gate 6 Analysis: Recovery Absorbed (${absorbed.length} incidents) ──`);
            console.log(`  Avg exit lateness: ${(avgExit / 60).toFixed(1)} min late`);
            console.log(`  Avg recovery time: ${(avgRecovery / 60).toFixed(1)} min`);
            console.log(`  These trips exited late, but the layover before the next trip absorbed the delay.`);

            const samples = absorbed.sort((a, b) => (b.exitLateness ?? 0) - (a.exitLateness ?? 0)).slice(0, 5);
            console.log(`  Closest to cascading (most exit lateness):`);
            for (const s of samples) {
                console.log(`    Exit ${(s.exitLateness! / 60).toFixed(1)} min late, recovery ${((s.recoveryTimeSec ?? 0) / 60).toFixed(1)} min | Route ${s.incident.routeId} Block ${s.incident.block}`);
            }
        }

        // Show details of CASCADED ones
        if (gateCounts.CASCADED > 0) {
            console.log(`\n── Gate 7: ACTUALLY CASCADED (${gateCounts.CASCADED} incidents) ──`);
            const cascaded = diagnostics.filter(d => d.gate === 'CASCADED');
            for (const s of cascaded.slice(0, 10)) {
                console.log(`  Route ${s.incident.routeId} | Block ${s.incident.block} | ${s.incident.tripName}`);
                console.log(`    ${s.detail}`);
            }
        }

        // Block structure overview
        console.log('\n── Block Structure Overview ──');
        const blockSizes = [...blockTrips.entries()].map(([b, t]) => ({ block: b, trips: t.length }));
        blockSizes.sort((a, b) => b.trips - a.trips);
        const avgTripsPerBlock = blockSizes.reduce((s, b) => s + b.trips, 0) / blockSizes.length;
        const singleTripBlocks = blockSizes.filter(b => b.trips === 1).length;
        console.log(`  Total blocks: ${blockSizes.length}`);
        console.log(`  Avg trips per block: ${avgTripsPerBlock.toFixed(1)}`);
        console.log(`  Single-trip blocks: ${singleTripBlocks} (${Math.round(singleTripBlocks / blockSizes.length * 100)}%)`);
        console.log(`  Top 5 blocks by trip count:`);
        for (const b of blockSizes.slice(0, 5)) {
            console.log(`    Block ${b.block}: ${b.trips} trips`);
        }

        // Report which blocks have incidents
        const blocksWithIncidents = new Set(incidents.map(i => i.block));
        const blocksWithCascadeIncidents = new Set(
            diagnostics.filter(d => d.gate === 'CASCADED').map(d => d.incident.block)
        );
        console.log(`\n  Blocks with dwell incidents: ${blocksWithIncidents.size}`);
        console.log(`  Blocks with actual cascades: ${blocksWithCascadeIncidents.size}`);

        expect(diagnostics.length).toBe(incidents.length);
    });

    it('traces cascade step-by-step for top incidents', () => {
        // Find the highest-blast-radius incidents (the ones with trackedDwellSeconds >= 300 that cascaded)
        const cascadedIncidents = diagnostics
            .filter(d => d.gate === 'CASCADED' && d.incident.trackedDwellSeconds >= 300)
            .sort((a, b) => b.incident.trackedDwellSeconds - a.incident.trackedDwellSeconds);

        // Deduplicate by block+tripName (same incident can appear multiple times from multiple dwell stops)
        const seen = new Set<string>();
        const unique = cascadedIncidents.filter(d => {
            const key = `${d.incident.block}|${d.incident.tripName}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        console.log(`\n${'='.repeat(80)}`);
        console.log('STEP-BY-STEP CASCADE TRACE FOR TOP INCIDENTS');
        console.log('='.repeat(80));

        for (const diag of unique.slice(0, 8)) {
            const inc = diag.incident;
            const trips = blockTrips.get(inc.block)!;
            const tripIdx = trips.findIndex(t => t.tripName === inc.tripName);
            const incidentTrip = trips[tripIdx];
            const subsequentTrips = trips.slice(tripIdx + 1);

            const exitLateness = computeTripExitLateness(incidentTrip);

            console.log(`\n${'─'.repeat(80)}`);
            console.log(`Route ${inc.routeId} | Block ${inc.block} | ${inc.tripName}`);
            console.log(`  Dwell: ${(inc.trackedDwellSeconds / 60).toFixed(1)} min at ${inc.stopName}`);
            console.log(`  Exit lateness: ${exitLateness !== null ? (exitLateness / 60).toFixed(1) + ' min' : 'NULL'}`);
            console.log(`  Subsequent trips in block: ${subsequentTrips.length}`);

            // Step through cascade like the algorithm does
            let carryoverLate = exitLateness!;
            const firstRecovery = subsequentTrips.length > 0
                ? computeRecoveryTime(incidentTrip, subsequentTrips[0])
                : 0;

            for (let i = 0; i < Math.min(subsequentTrips.length, 6); i++) {
                const nextTrip = subsequentTrips[i];
                const prevTrip = i === 0 ? incidentTrip : subsequentTrips[i - 1];
                const recovery = i === 0 ? firstRecovery : computeRecoveryTime(prevTrip, nextTrip);

                const lateEntering = Math.max(0, carryoverLate - recovery);

                console.log(`\n  [Trip ${i + 1}] ${nextTrip.tripName} (Route ${nextTrip.routeId})`);
                console.log(`    carryoverLate: ${(carryoverLate / 60).toFixed(1)} min`);
                console.log(`    recovery: ${(recovery / 60).toFixed(1)} min`);
                console.log(`    lateEntering: ${(lateEntering / 60).toFixed(1)} min`);

                if (lateEntering <= 0) {
                    console.log(`    → BREAK: recovery absorbed the delay`);
                    break;
                }

                // Check actual departure
                const actualDepSec = (() => {
                    for (const r of nextTrip.records) {
                        if (r.timePoint && r.observedDepartureTime) {
                            return timeToSeconds(r.observedDepartureTime);
                        }
                    }
                    return null;
                })();
                const schedDepSec = nextTrip.scheduledTerminalDepartureSec;

                let observedLate: number;
                if (actualDepSec !== null) {
                    observedLate = actualDepSec - schedDepSec;
                    if (observedLate < -43200) observedLate += 86400;
                    if (observedLate > 43200) observedLate -= 86400;
                    console.log(`    observedLate at first TP: ${(observedLate / 60).toFixed(1)} min (from AVL)`);
                } else {
                    observedLate = lateEntering;
                    console.log(`    observedLate at first TP: ${(observedLate / 60).toFixed(1)} min (estimated, no AVL)`);
                }

                const recoveredHere = observedLate <= 300; // OTP_THRESHOLDS.lateSeconds
                console.log(`    recoveredHere: ${recoveredHere} (observedLate ${(observedLate / 60).toFixed(1)} min ${recoveredHere ? '≤' : '>'} 5.0 min threshold)`);

                if (recoveredHere) {
                    console.log(`    → BREAK: recovered (departure within OTP threshold)`);
                    break;
                }

                // Exit lateness for this trip
                const nextExitLateness = computeTripExitLateness(nextTrip);
                const newCarryover = nextExitLateness !== null ? Math.max(0, nextExitLateness) : observedLate;
                console.log(`    exitLateness of this trip: ${nextExitLateness !== null ? (nextExitLateness / 60).toFixed(1) + ' min' : 'NULL'}`);
                console.log(`    newCarryover: ${(newCarryover / 60).toFixed(1)} min`);

                if (nextExitLateness !== null && nextExitLateness <= 0) {
                    console.log(`    ⚠ EXIT LATENESS ≤ 0: Trip started late but RECOVERED by last timepoint!`);
                    console.log(`    → Next iteration: carryover=0, will break on lateEntering check`);
                }

                carryoverLate = newCarryover;
            }
        }
    });
});
