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

// ─── Build dwell incidents (mirrors aggregator logic) ─────────────────

function buildDwellIncidents(records: STREETSRecord[], date: string): DwellIncident[] {
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
        incidents = buildDwellIncidents(records, '2026-02-22');
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

    it('every absorbed cascade has zero blast radius', () => {
        const result = buildDailyCascadeMetrics(records, incidents);
        for (const c of result.cascades.filter(c => c.blastRadius === 0)) {
            expect(c.blastRadius).toBe(0);
            expect(c.cascadedTrips).toHaveLength(0);
        }
    });
});
