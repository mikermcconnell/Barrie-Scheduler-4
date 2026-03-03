# Load Profile Module Review Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 issues identified in code review of the load profiles module — ranging from a critical OTP averaging bug to export labeling and defensive guards.

**Architecture:** All fixes are localized to 3 UI files and 1 aggregator. No schema changes needed. The critical fix (#1) replaces average-of-percentages with sum-of-raw-counts using the existing `OTPBreakdown` fields. Issue #3 (average-of-averages for avgLoad) is documented as a known approximation since a proper fix would require a schema change that isn't worth the complexity. Issue #5 uses `routeStopDeviations` already on `DailySummary`.

**Tech Stack:** TypeScript, React, ExcelJS, Vitest

---

### Task 1: Fix OTP averaging-percentages bug in RoutePerformanceReport

**Files:**
- Modify: `components/Performance/reports/RoutePerformanceReport.tsx:44-69`
- Test: `tests/performanceDataAggregator.test.ts` (existing — verifies aggregator is correct; this is a UI consumer fix)

**Context:** Lines 52-55 compute multi-day OTP as `avg(dailyPercent)`. The `RouteMetrics.otp` field is an `OTPBreakdown` with `.total`, `.onTime`, `.early`, `.late` raw counts. Use those.

**Step 1: Fix routeKPI OTP computation**

Replace the averaging-percentages approach in `routeKPI` (lines 52-55) with sum-of-counts:

```typescript
// Inside routeKPI useMemo, replace lines 52-55:
const mergedOtp = routeDays.reduce(
    (acc, r) => ({
        total: acc.total + r.otp.total,
        onTime: acc.onTime + r.otp.onTime,
        early: acc.early + r.otp.early,
        late: acc.late + r.otp.late,
    }),
    { total: 0, onTime: 0, early: 0, late: 0 }
);
// Then in the return:
return {
    otp: mergedOtp.total > 0 ? Math.round(mergedOtp.onTime / mergedOtp.total * 1000) / 10 : 0,
    earlyPct: mergedOtp.total > 0 ? Math.round(mergedOtp.early / mergedOtp.total * 1000) / 10 : 0,
    latePct: mergedOtp.total > 0 ? Math.round(mergedOtp.late / mergedOtp.total * 1000) / 10 : 0,
    // ... rest unchanged
};
```

**Step 2: Fix timepointOTP section similarly**

The `timepointOTP` useMemo (lines 73-113) also averages percentages across days. Accumulate raw counts per stop instead:

Change the `stopMap` value type to accumulate `{ total, onTime, early, late, deviationWeightedSum }` and compute percentages at the end.

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```
fix: use raw OTP counts instead of averaging percentages in route report
```

---

### Task 2: Fix OTP averaging-percentages bug in reportExporter

**Files:**
- Modify: `components/Performance/reports/reportExporter.ts:55-59` (exportWeeklySummary)
- Modify: `components/Performance/reports/reportExporter.ts:84-106` (route scorecard)
- Modify: `components/Performance/reports/reportExporter.ts:191-198` (exportRoutePerformance)

**Step 1: Fix exportWeeklySummary system OTP (lines 55-59)**

Replace averaging-percentages with raw count sums. The `DailySummary.system.otp` has raw counts:

```typescript
const totals = filteredDays.reduce(
    (acc, d) => ({
        total: acc.total + d.system.otp.total,
        onTime: acc.onTime + d.system.otp.onTime,
        early: acc.early + d.system.otp.early,
        late: acc.late + d.system.otp.late,
    }),
    { total: 0, onTime: 0, early: 0, late: 0 }
);
const otp = totals.total > 0 ? Math.round(totals.onTime / totals.total * 1000) / 10 : 0;
const early = totals.total > 0 ? Math.round(totals.early / totals.total * 1000) / 10 : 0;
const late = totals.total > 0 ? Math.round(totals.late / totals.total * 1000) / 10 : 0;
```

**Step 2: Fix route scorecard OTP (lines 84-106)**

Change the `routeMap` to accumulate `otp: { total, onTime, early, late }` instead of `otp: number[]`. Compute percentages when building the final rows.

**Step 3: Fix exportRoutePerformance OTP (line 196)**

The `avgField(r => r.otp.onTimePercent)` pattern is the same bug. Use raw counts from `routeDays`:

```typescript
const mergedOtp = routeDays.reduce(
    (acc, d) => ({
        total: acc.total + d.route.otp.total,
        onTime: acc.onTime + d.route.otp.onTime,
        early: acc.early + d.route.otp.early,
        late: acc.late + d.route.otp.late,
    }),
    { total: 0, onTime: 0, early: 0, late: 0 }
);
summary.addRow(['OTP%', mergedOtp.total > 0 ? Math.round(mergedOtp.onTime / mergedOtp.total * 1000) / 10 : 0]);
summary.addRow(['Early%', mergedOtp.total > 0 ? Math.round(mergedOtp.early / mergedOtp.total * 1000) / 10 : 0]);
summary.addRow(['Late%', mergedOtp.total > 0 ? Math.round(mergedOtp.late / mergedOtp.total * 1000) / 10 : 0]);
```

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```
fix: use raw OTP counts in Excel exporters to avoid averaging-percentages error
```

---

### Task 3: Add Date and Direction columns to Stop Performance export

**Files:**
- Modify: `components/Performance/reports/reportExporter.ts:208-226`

**Step 1: Add Date and Direction to header and rows**

```typescript
// Line 210: add Date + Direction to header
const stopHeader = stopSheet.addRow(['Date', 'Direction', 'Stop', 'Timepoint', 'Boardings', 'Alightings', 'Avg Load', 'Max Load']);

// Lines 213-225: add date + direction to each row
for (const { day } of routeDays) {
    for (const lp of day.loadProfiles) {
        if (lp.routeId !== routeId) continue;
        for (const stop of lp.stops) {
            stopSheet.addRow([
                day.date, lp.direction, stop.stopName, stop.isTimepoint ? 'Yes' : 'No',
                Math.round(stop.avgBoardings * lp.tripCount),
                Math.round(stop.avgAlightings * lp.tripCount),
                stop.avgLoad, stop.maxLoad,
            ]);
        }
    }
}
```

Note: Use `routeDays` (already filtered + has `day` reference) instead of `filteredDays` to ensure correct scoping.

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```
fix: add Date and Direction columns to Stop Performance Excel export
```

---

### Task 4: Fix timepointOTP to use route-specific deviation data

**Files:**
- Modify: `components/Performance/reports/RoutePerformanceReport.tsx:72-113`

**Context:** `DailySummary.routeStopDeviations` is a `RouteStopDeviationProfile[]` with `{ routeId, direction, stops: RouteStopDeviationEntry[] }`. Each stop entry has `deviations: number[]` (raw deviation seconds per OTP-eligible observation). This is already route+direction specific.

**Step 1: Rewrite timepointOTP to use routeStopDeviations**

Replace the current heuristic that filters `day.byStop` (system-wide) with route-specific data:

```typescript
const timepointOTP = useMemo(() => {
    if (!activeRoute) return [];
    const stopMap = new Map<string, {
        stopName: string; total: number; onTime: number; early: number; late: number;
        deviationSum: number; boardings: number;
    }>();

    for (const day of filteredDays) {
        // Use route-specific deviation profiles
        const profiles = (day.routeStopDeviations ?? []).filter(p => p.routeId === activeRoute);
        // Get timepoint stop IDs from load profiles for this route
        const routeProfiles = day.loadProfiles.filter(lp => lp.routeId === activeRoute);
        const timepointIds = new Set(
            routeProfiles.flatMap(lp => lp.stops.filter(s => s.isTimepoint).map(s => s.stopId))
        );

        for (const profile of profiles) {
            for (const stop of profile.stops) {
                if (!timepointIds.has(stop.stopId)) continue;
                const existing = stopMap.get(stop.stopId) || {
                    stopName: stop.stopName, total: 0, onTime: 0, early: 0, late: 0,
                    deviationSum: 0, boardings: 0,
                };
                for (const dev of stop.deviations) {
                    existing.total++;
                    existing.deviationSum += dev;
                    const status = classifyOTP(dev);
                    if (status === 'on-time') existing.onTime++;
                    else if (status === 'early') existing.early++;
                    else existing.late++;
                }
                stopMap.set(stop.stopId, existing);
            }
        }

        // Still accumulate boardings from byStop for display
        for (const stop of day.byStop) {
            if (!timepointIds.has(stop.stopId)) continue;
            const existing = stopMap.get(stop.stopId);
            if (existing) existing.boardings += stop.boardings;
        }
    }

    return Array.from(stopMap.values())
        .filter(s => s.total > 0)
        .map(s => ({
            stopName: s.stopName,
            otp: Math.round(s.onTime / s.total * 1000) / 10,
            early: Math.round(s.early / s.total * 1000) / 10,
            late: Math.round(s.late / s.total * 1000) / 10,
            avgDeviation: Math.round(s.deviationSum / s.total),
            boardings: s.boardings,
        }))
        .sort((a, b) => a.otp - b.otp);
}, [filteredDays, activeRoute]);
```

**Step 2: Add import for classifyOTP**

```typescript
import { classifyOTP } from '../../../utils/performanceDataTypes';
```

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```
fix: use route-specific deviation data for timepoint OTP instead of system-wide
```

---

### Task 5: Document avgLoad average-of-averages as known approximation

**Files:**
- Modify: `components/Performance/LoadProfileModule.tsx:96-99`

**Context:** A proper weighted average requires adding `reliableLoadTripCount` to `LoadProfileStop` — a schema change that propagates to Firebase, the aggregator, the Cloud Functions mirror, and all consumers. The approximation is close enough (same route usually has similar APC coverage day-to-day). Document it instead.

**Step 1: Add a comment at the averaging point**

```typescript
// Note: This is an unweighted average-of-averages across days. A proper weighted
// average would require per-stop reliable-load-trip counts on LoadProfileStop.
// Accepted as close-enough approximation since same-route APC coverage is stable day-to-day.
avgLoad: Math.round(s.sumLoad / s.sampleCount),
```

**Step 2: Fix tripCount subtitle to clarify it's cumulative**

In the chart subtitle (line 322), change from `(${activeProfile.tripCount} trips)` to:
```typescript
subtitle={`${activeProfile.routeName} — avg passenger load at each stop (${activeProfile.tripCount} trips across ${filtered.length} day${filtered.length !== 1 ? 's' : ''})`}
```

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```
docs: document avgLoad approximation and clarify trip count label
```

---

### Task 6: Add sanitizeRecords mutation comment

**Files:**
- Modify: `utils/performanceDataAggregator.ts:111-112`

**Step 1: Add precondition comment**

```typescript
/** Cap departureLoad values and return sanitization counts.
 *  WARNING: Mutates records in place. Only call once per record set. */
function sanitizeRecords(records: STREETSRecord[]): { loadCapped: number; apcExcludedFromLoad: number } {
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```
docs: document sanitizeRecords mutation precondition
```

---

### Task 7: Add sampleCount zero guard in LoadProfileModule

**Files:**
- Modify: `components/Performance/LoadProfileModule.tsx:97-99`

**Step 1: Use safeDivide-style guard**

```typescript
avgBoardings: s.sampleCount > 0 ? Math.round(s.sumBoardings / s.sampleCount) : 0,
avgAlightings: s.sampleCount > 0 ? Math.round(s.sumAlightings / s.sampleCount) : 0,
avgLoad: s.sampleCount > 0 ? Math.round(s.sumLoad / s.sampleCount) : 0,
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```
fix: add zero guard for sampleCount division in LoadProfileModule
```

---

## Execution Notes

- Tasks 1-2 are the critical OTP fix (same pattern, different files)
- Task 3 is a quick export fix
- Task 4 is the most complex — switches data source for timepoint OTP
- Tasks 5-7 are minor documentation/defensive fixes
- All tasks are independent — can be parallelized
- No new test files needed; existing tests cover the aggregator correctness
- Run `npm run build` after each task as verification
