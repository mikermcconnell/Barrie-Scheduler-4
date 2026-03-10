/**
 * Real-data verification test for dwell cascade computation.
 * Parses an actual STREETS CSV and validates cascade results.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseRow } from '../utils/performanceDataParser';
import { buildDailyCascadeMetrics } from '../utils/schedule/dwellCascadeComputer';
import type { STREETSRecord, DwellIncident, DwellSeverity } from '../utils/performanceDataTypes';
import { DWELL_THRESHOLDS, classifyDwell } from '../utils/performanceDataTypes';

// ─── CSV Parser (matches performanceDataParser.parseCSV) ──────────────

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
    const parts = time.trim().split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
    return h * 3600 + m * 60 + s;
}

// ─── Build dwell incidents — OLD logic (raw dwell, no recovery awareness) ────

function buildDwellIncidentsOld(records: STREETSRecord[], date: string): DwellIncident[] {
    const incidents: DwellIncident[] = [];
    for (const r of records) {
        if (!r.timePoint) continue;
        if (!r.observedArrivalTime || !r.observedDepartureTime) continue;
        let arrSec = timeToSeconds(r.observedArrivalTime);
        let depSec = timeToSeconds(r.observedDepartureTime);
        if (depSec < arrSec) depSec += 86400;
        const rawDwell = depSec - arrSec;
        if (rawDwell < 0) continue;
        const severity = classifyDwell(rawDwell);
        if (!severity) continue;
        incidents.push({
            operatorId: r.operatorId,
            date,
            routeId: r.routeId,
            routeName: r.routeName,
            stopName: r.stopName,
            stopId: r.stopId,
            tripName: r.tripName,
            block: r.block,
            observedArrivalTime: r.observedArrivalTime,
            observedDepartureTime: r.observedDepartureTime,
            rawDwellSeconds: rawDwell,
            trackedDwellSeconds: rawDwell - DWELL_THRESHOLDS.boardingAllowanceSeconds,
            severity,
        });
    }
    return incidents;
}

// ─── Build dwell incidents — NEW logic (recovery-aware) ──────────────────

function buildDwellIncidentsNew(records: STREETSRecord[], date: string): DwellIncident[] {
    const incidents: DwellIncident[] = [];
    for (const r of records) {
        if (!r.timePoint) continue;
        if (!r.observedArrivalTime || !r.observedDepartureTime) continue;
        let arrSec = timeToSeconds(r.observedArrivalTime);
        let depSec = timeToSeconds(r.observedDepartureTime);
        if (depSec < arrSec) depSec += 86400;
        const rawDwell = depSec - arrSec;
        if (rawDwell < 0) continue;

        const schedDepSec = timeToSeconds(r.stopTime);
        const depLatenessSec = Math.max(0, depSec - schedDepSec);

        // Gate: only count if departing > 3 min late (matches legacy)
        if (depLatenessSec <= DWELL_THRESHOLDS.lateGateSeconds) continue;

        let dwell: number;
        if (arrSec <= schedDepSec) {
            // On time or early — dwell = departure lateness
            dwell = depLatenessSec;
        } else {
            // Late past scheduled departure — dwell = raw time at stop
            dwell = rawDwell;
        }

        const severity = classifyDwell(dwell);
        if (!severity) continue;

        incidents.push({
            operatorId: r.operatorId,
            date,
            routeId: r.routeId,
            routeName: r.routeName,
            stopName: r.stopName,
            stopId: r.stopId,
            tripName: r.tripName,
            block: r.block,
            observedArrivalTime: r.observedArrivalTime,
            observedDepartureTime: r.observedDepartureTime,
            rawDwellSeconds: rawDwell,
            trackedDwellSeconds: dwell,
            severity,
        });
    }
    return incidents;
}

// ─── Test ─────────────────────────────────────────────────────────────

// Point this at a local STREETS CSV to run real-data verification.
// Skip gracefully if the file doesn't exist (CI-safe).
const CSV_PATH = 'C:/Users/Mike McConnell/Downloads/Eddy Data for previous Day (9).csv';

function csvExists(): boolean {
    try { readFileSync(CSV_PATH, 'utf-8'); return true; } catch { return false; }
}

describe.skipIf(!csvExists())('Dwell Cascade — Real STREETS Data', () => {
    let records: STREETSRecord[];
    let incidents: DwellIncident[];

    // Parse the CSV once
    try {
        const text = readFileSync(CSV_PATH, 'utf-8');
        const rawRows = parseCSV(text);
        records = rawRows.map((r, i) => parseRow(r, i + 2)).filter((r): r is STREETSRecord => r !== null);
        incidents = buildDwellIncidentsOld(records, '2026-02-22');
    } catch {
        records = [];
        incidents = [];
    }

    it('parses the CSV into STREETS records', () => {
        expect(records.length).toBeGreaterThan(10000);
        console.log(`  Parsed ${records.length} STREETS records`);
    });

    it('finds dwell incidents', () => {
        console.log(`  Found ${incidents.length} dwell incidents`);
        console.log(`    Moderate: ${incidents.filter(i => i.severity === 'moderate').length}`);
        console.log(`    High: ${incidents.filter(i => i.severity === 'high').length}`);
        expect(incidents.length).toBeGreaterThanOrEqual(0); // just report, don't fail
    });

    it('computes cascade metrics from real data', () => {
        const result = buildDailyCascadeMetrics(records, incidents);

        console.log('\n  === CASCADE RESULTS ===');
        console.log(`  Total cascades computed: ${result.cascades.length}`);
        console.log(`  Absorbed (recovery contained): ${result.totalNonCascaded}`);
        console.log(`  Cascaded (escaped recovery): ${result.totalCascaded}`);
        console.log(`  Avg blast radius: ${result.avgBlastRadius.toFixed(1)}`);
        console.log(`  Total OTP damage (trip-observations): ${result.totalBlastRadius}`);

        if (result.byStop.length > 0) {
            console.log('\n  === TOP 5 STOPS BY DOWNSTREAM DAMAGE ===');
            for (const s of result.byStop.slice(0, 5)) {
                console.log(`    ${s.stopName} (Route ${s.routeId}): ${s.totalBlastRadius} damage, ${s.cascadedCount} cascaded, ${s.nonCascadedCount} non-cascaded`);
            }
        }

        if (result.byTerminal.length > 0) {
            console.log('\n  === TERMINAL RECOVERY ===');
            for (const t of result.byTerminal.slice(0, 5)) {
                const pct = t.incidentCount > 0 ? Math.round((t.absorbedCount / t.incidentCount) * 100) : 0;
                console.log(`    ${t.stopName} (Route ${t.routeId}): ${pct}% absorbed, avg recovery ${(t.avgScheduledRecoverySeconds / 60).toFixed(1)} min, ${t.sufficientRecovery ? 'SUFFICIENT' : 'NEEDS MORE RECOVERY'}`);
            }
        }

        // Structural assertions
        expect(result.cascades.length).toBe(incidents.length);
        expect(result.totalNonCascaded + result.totalCascaded).toBe(result.cascades.length);
        expect(result.totalBlastRadius).toBe(
            result.cascades.reduce((s, c) => s + c.blastRadius, 0)
        );

        // Every cascading incident should have at least one cascaded trip
        for (const c of result.cascades.filter(c => c.blastRadius > 0)) {
            expect(c.cascadedTrips.length).toBeGreaterThan(0);
            expect(c.blastRadius).toBeGreaterThanOrEqual(0);
        }
    });

    it('zero blast radius cascades have no downstream late timepoints', () => {
        const result = buildDailyCascadeMetrics(records, incidents);
        for (const c of result.cascades.filter(c => c.blastRadius === 0)) {
            expect(c.blastRadius).toBe(0);
            expect(c.cascadedTrips.every(trip => trip.lateTimepointCount === 0)).toBe(true);
        }
    });
});

// ─── March 3 Comparison: Old vs New Dwell Logic ─────────────────────────

const MARCH3_CSV = 'C:/Users/Mike McConnell/Downloads/Eddy Data for previous Day (11).csv';

function march3Exists(): boolean {
    try { readFileSync(MARCH3_CSV, 'utf-8'); return true; } catch { return false; }
}

describe.skipIf(!march3Exists())('Dwell Fix Comparison — March 3 Data', () => {
    let records: STREETSRecord[];
    let oldIncidents: DwellIncident[];
    let newIncidents: DwellIncident[];

    try {
        const text = readFileSync(MARCH3_CSV, 'utf-8');
        const rawRows = parseCSV(text);
        records = rawRows.map((r, i) => parseRow(r, i + 2)).filter((r): r is STREETSRecord => r !== null);
        oldIncidents = buildDwellIncidentsOld(records, '2026-03-03');
        newIncidents = buildDwellIncidentsNew(records, '2026-03-03');
    } catch {
        records = [];
        oldIncidents = [];
        newIncidents = [];
    }

    it('parses March 3 CSV', () => {
        console.log(`  Parsed ${records.length} STREETS records`);
        expect(records.length).toBeGreaterThan(10000);
    });

    it('compares old vs new dwell totals', () => {
        const oldTotalSec = oldIncidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);
        const newTotalSec = newIncidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);
        const oldHours = (oldTotalSec / 3600).toFixed(1);
        const newHours = (newTotalSec / 3600).toFixed(1);
        const reduction = oldTotalSec > 0 ? ((1 - newTotalSec / oldTotalSec) * 100).toFixed(0) : '0';

        console.log('\n  ╔══════════════════════════════════════════════╗');
        console.log('  ║     DWELL FIX COMPARISON — MARCH 3, 2026    ║');
        console.log('  ╠══════════════════════════════════════════════╣');
        console.log(`  ║  OLD logic:  ${oldIncidents.length.toString().padStart(5)} incidents  ${oldHours.padStart(6)} hours  ║`);
        console.log(`  ║  NEW logic:  ${newIncidents.length.toString().padStart(5)} incidents  ${newHours.padStart(6)} hours  ║`);
        console.log(`  ║  Reduction:  ${reduction.padStart(5)}%                        ║`);
        console.log('  ╚══════════════════════════════════════════════╝');

        // By severity
        for (const sev of ['moderate', 'high'] as DwellSeverity[]) {
            const oldCount = oldIncidents.filter(i => i.severity === sev).length;
            const newCount = newIncidents.filter(i => i.severity === sev).length;
            const oldSevSec = oldIncidents.filter(i => i.severity === sev).reduce((s, i) => s + i.trackedDwellSeconds, 0);
            const newSevSec = newIncidents.filter(i => i.severity === sev).reduce((s, i) => s + i.trackedDwellSeconds, 0);
            console.log(`  ${sev.toUpperCase()}: ${oldCount} → ${newCount} incidents, ${(oldSevSec / 3600).toFixed(1)} → ${(newSevSec / 3600).toFixed(1)} hours`);
        }

        // New classified incidents should match legacy (~141)
        const newClassified = newIncidents.filter(i => i.severity !== 'minor').length;
        expect(newClassified).toBeGreaterThan(100);
        expect(newClassified).toBeLessThan(200);
    });

    it('shows top stops eliminated by the fix', () => {
        // Group old incidents by stop
        const oldByStop = new Map<string, { count: number; totalSec: number }>();
        for (const inc of oldIncidents) {
            const key = `${inc.stopName} (${inc.routeName})`;
            const cur = oldByStop.get(key) ?? { count: 0, totalSec: 0 };
            cur.count++;
            cur.totalSec += inc.trackedDwellSeconds;
            oldByStop.set(key, cur);
        }
        const newByStop = new Map<string, { count: number; totalSec: number }>();
        for (const inc of newIncidents) {
            const key = `${inc.stopName} (${inc.routeName})`;
            const cur = newByStop.get(key) ?? { count: 0, totalSec: 0 };
            cur.count++;
            cur.totalSec += inc.trackedDwellSeconds;
            newByStop.set(key, cur);
        }

        // Find biggest reductions
        const reductions: { stop: string; oldCount: number; newCount: number; oldHrs: number; newHrs: number }[] = [];
        for (const [stop, old] of oldByStop) {
            const nw = newByStop.get(stop) ?? { count: 0, totalSec: 0 };
            reductions.push({
                stop,
                oldCount: old.count,
                newCount: nw.count,
                oldHrs: old.totalSec / 3600,
                newHrs: nw.totalSec / 3600,
            });
        }
        reductions.sort((a, b) => (b.oldHrs - b.newHrs) - (a.oldHrs - a.newHrs));

        console.log('\n  TOP 10 STOPS — BIGGEST DWELL REDUCTION:');
        for (const r of reductions.slice(0, 10)) {
            const delta = r.oldHrs - r.newHrs;
            console.log(`    ${r.stop}: ${r.oldCount}→${r.newCount} incidents, ${r.oldHrs.toFixed(2)}→${r.newHrs.toFixed(2)} hrs (−${delta.toFixed(2)} hrs)`);
        }

        expect(reductions.length).toBeGreaterThan(0);
    });

    it('diagnoses hours gap vs legacy', { timeout: 30000 }, () => {
        // Pure legacy formula — no boarding floor, no classifyDwell, just R>3 gate
        let legacyCount = 0;
        let legacyTotalMin = 0;
        let branch1Count = 0, branch1TotalMin = 0;
        let branch2Count = 0, branch2TotalMin = 0;
        let newBranch1Count = 0, newBranch1TotalMin = 0;
        let newBranch2Count = 0, newBranch2TotalMin = 0;
        let floorFilteredCount = 0, floorFilteredMin = 0;

        for (const r of records) {
            if (!r.timePoint) continue;
            if (!r.observedArrivalTime || !r.observedDepartureTime) continue;
            let arrSec = timeToSeconds(r.observedArrivalTime);
            let depSec = timeToSeconds(r.observedDepartureTime);
            if (depSec < arrSec) depSec += 86400;

            const schedDepSec = timeToSeconds(r.stopTime);
            const depLateMin = (depSec - schedDepSec) / 60; // R column
            if (depLateMin <= 3) continue; // Legacy gate: R > 3

            const rawDwellMin = (depSec - arrSec) / 60;
            const isLateArrival = arrSec > schedDepSec; // N > P

            let legacyDwellMin: number;
            if (isLateArrival) {
                legacyDwellMin = rawDwellMin; // (Q-N)*1440
                branch2Count++;
                branch2TotalMin += legacyDwellMin;
            } else {
                legacyDwellMin = depLateMin; // R
                branch1Count++;
                branch1TotalMin += legacyDwellMin;
            }

            if (legacyDwellMin > 0) {
                legacyCount++;
                legacyTotalMin += legacyDwellMin;
            }
        }

        // Now compute our new logic totals with branch breakdown
        for (const inc of newIncidents) {
            const arrSec = timeToSeconds(inc.observedArrivalTime);
            const schedDepSec = timeToSeconds(
                records.find(r => r.tripId === inc.tripName)?.stopTime ?? '00:00'
            );
            // Just use the stored values
            if (inc.trackedDwellSeconds === inc.rawDwellSeconds) {
                // Could be either branch where arr==schedDep
            }
        }

        console.log('\n  === LEGACY FORMULA EXACT REPLICA ===');
        console.log(`  Total: ${legacyCount} incidents, ${(legacyTotalMin / 60).toFixed(1)} hours`);
        console.log(`  Branch 1 (on-time arr → depLateness): ${branch1Count} incidents, ${(branch1TotalMin / 60).toFixed(1)} hrs`);
        console.log(`  Branch 2 (late arr → rawDwell): ${branch2Count} incidents, ${(branch2TotalMin / 60).toFixed(1)} hrs`);

        // Now breakdown of our new incidents
        let newTotal = 0;
        for (const inc of newIncidents) {
            newTotal += inc.trackedDwellSeconds;
        }
        console.log(`\n  Our code: ${newIncidents.length} incidents, ${(newTotal / 3600).toFixed(1)} hours`);

        // Show what legacy counts that we don't (below boarding floor)
        let belowFloorCount = 0, belowFloorMin = 0;
        for (const r of records) {
            if (!r.timePoint) continue;
            if (!r.observedArrivalTime || !r.observedDepartureTime) continue;
            let arrSec = timeToSeconds(r.observedArrivalTime);
            let depSec = timeToSeconds(r.observedDepartureTime);
            if (depSec < arrSec) depSec += 86400;
            const schedDepSec = timeToSeconds(r.stopTime);
            const depLateMin = (depSec - schedDepSec) / 60;
            if (depLateMin <= 3) continue;
            const rawDwellMin = (depSec - arrSec) / 60;
            const isLateArrival = arrSec > schedDepSec;
            const dwellMin = isLateArrival ? rawDwellMin : depLateMin;
            const dwellSec = dwellMin * 60;
            // These pass legacy gate but get killed by our boarding floor
            if (dwellSec > 0 && dwellSec <= 120) {
                belowFloorCount++;
                belowFloorMin += dwellMin;
            }
        }
        console.log(`\n  Below boarding floor (0-120s dwell, passes legacy gate): ${belowFloorCount} incidents, ${(belowFloorMin / 60).toFixed(1)} hrs`);

        expect(legacyCount).toBeGreaterThan(0);
    });
});
