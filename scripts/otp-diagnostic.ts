/**
 * OTP Diagnostic Script
 * Parses a STREETS CSV and outputs OTP eligibility counts at each filtering stage.
 * Usage: npx tsx scripts/otp-diagnostic.ts "path/to/file.csv"
 */
import * as fs from 'fs';
import { parseRow, validateSchema } from '../utils/performanceDataParser';
import { classifyOTP } from '../utils/performanceDataTypes';
import type { STREETSRecord } from '../utils/performanceDataTypes';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx tsx scripts/otp-diagnostic.ts <csv-path>');
  process.exit(1);
}

// ── Parse CSV ──────────────────────────────────────────────
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
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  return h * 3600 + m * 60 + s;
}

// ── Main ───────────────────────────────────────────────────
const raw = fs.readFileSync(filePath, 'utf-8');
const rawRows = parseCSV(raw);
console.log(`\n=== OTP Diagnostic ===`);
console.log(`File: ${filePath}`);
console.log(`Raw rows: ${rawRows.length}`);

// Validate schema
const headers = Object.keys(rawRows[0] || {});
const schema = validateSchema(headers);
if (!schema.valid) {
  console.error(`Missing columns: ${schema.missing.join(', ')}`);
  process.exit(1);
}

// Parse records
const records: STREETSRecord[] = [];
let skipped = 0;
for (let i = 0; i < rawRows.length; i++) {
  const r = parseRow(rawRows[i], i + 2);
  if (r) records.push(r);
  else skipped++;
}
console.log(`Parsed records: ${records.length} (${skipped} skipped)`);

// Group by date
const byDate = new Map<string, STREETSRecord[]>();
for (const r of records) {
  const arr = byDate.get(r.date) || [];
  arr.push(r);
  byDate.set(r.date, arr);
}

for (const [date, dayRecords] of byDate) {
  console.log(`\n─── ${date} (${dayRecords.length} records) ───`);

  // Stage 1: All records
  const allTimepoints = dayRecords.filter(r => r.timePoint);
  console.log(`  Timepoint records: ${allTimepoints.length}`);

  // Stage 2: Not inBetween
  const notInBetween = allTimepoints.filter(r => !r.inBetween);
  console.log(`  After !inBetween: ${notInBetween.length} (removed ${allTimepoints.length - notInBetween.length})`);

  // Stage 3: Not tripper
  const notTripper = notInBetween.filter(r => !r.isTripper);
  console.log(`  After !isTripper: ${notTripper.length} (removed ${notInBetween.length - notTripper.length})`);

  // Stage 4: Has observedDepartureTime
  const hasDep = notTripper.filter(r => r.observedDepartureTime);
  console.log(`  After has departure: ${hasDep.length} (removed ${notTripper.length - hasDep.length})`);

  // Stage 5: Not last timepoint per trip
  const tripMaxIdx = new Map<string, number>();
  for (const r of dayRecords) {
    if (!r.timePoint) continue;
    const cur = tripMaxIdx.get(r.tripId) || 0;
    if (r.routeStopIndex > cur) tripMaxIdx.set(r.tripId, r.routeStopIndex);
  }
  const notLast = hasDep.filter(r => r.routeStopIndex < (tripMaxIdx.get(r.tripId) || 0));
  console.log(`  After !lastTP: ${notLast.length} (removed ${hasDep.length - notLast.length})`);

  // Stage 6: Dedup by trip+stop
  const seen = new Set<string>();
  const deduped: STREETSRecord[] = [];
  let dupCount = 0;
  for (const r of notLast) {
    const key = `${r.tripId}|${r.stopId}`;
    if (seen.has(key)) { dupCount++; continue; }
    seen.add(key);
    deduped.push(r);
  }
  console.log(`  After dedup: ${deduped.length} (removed ${dupCount} duplicates)`);

  // Final OTP classification
  let onTime = 0, early = 0, late = 0;
  let deviationSum = 0;
  const borderlineLate: { tripName: string; stopName: string; dev: number }[] = [];

  for (const r of deduped) {
    const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
    deviationSum += dev;
    const status = classifyOTP(dev);
    if (status === 'on-time') onTime++;
    else if (status === 'early') early++;
    else {
      late++;
      // Track borderline late (301-360s) to understand boundary effects
      if (dev <= 360) borderlineLate.push({ tripName: r.tripName, stopName: r.stopName, dev });
    }
  }

  const total = deduped.length;
  const otpPct = total > 0 ? (onTime / total) * 100 : 0;

  console.log(`\n  *** OTP Results ***`);
  console.log(`  Eligible: ${total}`);
  console.log(`  On-time:  ${onTime} (${otpPct.toFixed(2)}%)`);
  console.log(`  Early:    ${early} (${total > 0 ? ((early/total)*100).toFixed(2) : 0}%)`);
  console.log(`  Late:     ${late} (${total > 0 ? ((late/total)*100).toFixed(2) : 0}%)`);
  console.log(`  Avg deviation: ${total > 0 ? (deviationSum/total).toFixed(1) : 0}s`);

  if (borderlineLate.length > 0) {
    console.log(`\n  Borderline late (301-360s): ${borderlineLate.length} records`);
    for (const bl of borderlineLate.slice(0, 10)) {
      console.log(`    ${bl.tripName} @ ${bl.stopName}: ${bl.dev}s (${(bl.dev/60).toFixed(1)} min)`);
    }
  }

  // Also compute WITHOUT dedup to see impact
  let onTimeNoDup = 0, earlyNoDup = 0, lateNoDup = 0;
  for (const r of notLast) {
    const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
    const status = classifyOTP(dev);
    if (status === 'on-time') onTimeNoDup++;
    else if (status === 'early') earlyNoDup++;
    else lateNoDup++;
  }
  const totalNoDup = notLast.length;
  const otpNoDup = totalNoDup > 0 ? (onTimeNoDup / totalNoDup) * 100 : 0;
  console.log(`\n  Without dedup: ${totalNoDup} eligible, OTP = ${otpNoDup.toFixed(2)}%`);

  // ── Alternative deviation formulas ──────────────────────
  const formulas: { name: string; devFn: (r: STREETSRecord) => number }[] = [
    { name: 'observedDep - stopTime (current)', devFn: r => timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime) },
    { name: 'observedArr - arrivalTime', devFn: r => timeToSeconds(r.observedArrivalTime!) - timeToSeconds(r.arrivalTime) },
    { name: 'observedDep - arrivalTime', devFn: r => timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.arrivalTime) },
    { name: 'observedArr - stopTime', devFn: r => timeToSeconds(r.observedArrivalTime!) - timeToSeconds(r.stopTime) },
  ];

  // Use notLast (pre-dedup, but with arrival data available)
  const withArrival = notLast.filter(r => r.observedArrivalTime);

  console.log(`\n  ── Alternative formulas (${withArrival.length} records with both times) ──`);
  for (const f of formulas) {
    let ot = 0, ea = 0, la = 0;
    for (const r of withArrival) {
      try {
        const dev = f.devFn(r);
        const s = classifyOTP(dev);
        if (s === 'on-time') ot++;
        else if (s === 'early') ea++;
        else la++;
      } catch { la++; }
    }
    const t = withArrival.length;
    console.log(`  ${f.name}: OTP=${(ot/t*100).toFixed(2)}% (${ot}/${t}) early=${ea} late=${la}`);
  }

  // Check arrivalTime vs stopTime differences
  let diffCount = 0;
  for (const r of deduped) {
    if (r.arrivalTime !== r.stopTime) diffCount++;
  }
  console.log(`\n  Records where arrivalTime != stopTime: ${diffCount}/${deduped.length}`);

  // ── Check detour impact ──────────────────────────────────
  const detourInEligible = deduped.filter(r => r.isDetour).length;
  const nonDetour = deduped.filter(r => !r.isDetour);
  let ndOnTime = 0, ndEarly = 0, ndLate = 0;
  for (const r of nonDetour) {
    const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
    const s = classifyOTP(dev);
    if (s === 'on-time') ndOnTime++;
    else if (s === 'early') ndEarly++;
    else ndLate++;
  }
  console.log(`\n  Detour records in eligible pool: ${detourInEligible}`);
  console.log(`  Without detours: ${nonDetour.length} eligible, OTP=${(ndOnTime/nonDetour.length*100).toFixed(2)}% (${ndOnTime} on-time, ${ndEarly} early, ${ndLate} late)`);

  // ── First timepoint only (terminal departure OTP) ────────
  const tripFirstIdx = new Map<string, number>();
  for (const r of deduped) {
    const cur = tripFirstIdx.get(r.tripId);
    if (cur === undefined || r.routeStopIndex < cur) tripFirstIdx.set(r.tripId, r.routeStopIndex);
  }
  const firstOnly = deduped.filter(r => r.routeStopIndex === tripFirstIdx.get(r.tripId));
  let foOnTime = 0, foEarly = 0, foLate = 0;
  for (const r of firstOnly) {
    const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
    const s = classifyOTP(dev);
    if (s === 'on-time') foOnTime++;
    else if (s === 'early') foEarly++;
    else foLate++;
  }
  console.log(`\n  First TP only (terminal dep): ${firstOnly.length} trips, OTP=${(foOnTime/firstOnly.length*100).toFixed(2)}%`);

  // ── Deviation histogram around boundaries ─────────────────
  const earlyBoundary = deduped.filter(r => {
    const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
    return dev >= -210 && dev <= -150; // around -180 boundary
  }).length;
  const lateBoundary = deduped.filter(r => {
    const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
    return dev >= 270 && dev <= 330; // around 300 boundary
  }).length;
  console.log(`\n  Records near early boundary (-210 to -150): ${earlyBoundary}`);
  console.log(`  Records near late boundary (270 to 330): ${lateBoundary}`);

  // ── Full list of early records with deviations ──────────
  const earlyRecords = deduped
    .map(r => ({ ...r, dev: timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime) }))
    .filter(r => classifyOTP(r.dev) === 'early')
    .sort((a, b) => a.dev - b.dev);
  console.log(`\n  ── All ${earlyRecords.length} early records (sorted by deviation) ──`);
  for (const r of earlyRecords) {
    console.log(`    ${r.dev}s (${(r.dev/60).toFixed(1)}min) | sched=${r.stopTime} obs=${r.observedDepartureTime} | ${r.tripName} @ ${r.stopName}`);
  }

  // ── Threshold sweep to find STREETS match ───────────────
  console.log(`\n  ── Early threshold sweep (finding 34 early) ──`);
  for (let thresh = -180; thresh >= -300; thresh -= 10) {
    let e = 0;
    for (const r of deduped) {
      const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
      if (dev < thresh) e++;
    }
    if (e >= 30 && e <= 40) {
      console.log(`    threshold < ${thresh}s (${(thresh/60).toFixed(1)}min): ${e} early`);
    }
  }
  // Fine-grained around the likely range
  for (let thresh = -200; thresh >= -215; thresh -= 1) {
    let e = 0;
    for (const r of deduped) {
      const dev = timeToSeconds(r.observedDepartureTime!) - timeToSeconds(r.stopTime);
      if (dev < thresh) e++;
    }
    console.log(`    threshold < ${thresh}s (${(thresh/60).toFixed(2)}min): ${e} early`);
  }

  console.log(`\n  STREETS target: 1186 eligible, 34 early, 1118 on-time, 34 late`);
  console.log(`  Difference: eligible ${total - 1186}, OTP ${(otpPct - 94.3).toFixed(2)}pp`);
}
