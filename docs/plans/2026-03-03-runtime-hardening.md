# Runtime Data Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden runtime calculations against low-N data by threading observation counts through the pipeline, adding adjacent-band fallback logic, and displaying confidence indicators in the UI.

**Architecture:** Add `n` (observation count) to every segment/bucket cell in the data pipeline. At schedule generation time, check `n >= 10` before trusting a band's segment time; if below threshold, walk to adjacent bands, then fall back to all-band average. UI shows confidence via color coding.

**Tech Stack:** TypeScript, React, existing runtime pipeline (`performanceRuntimeComputer.ts` → `runtimeAnalysis.ts` → `scheduleGenerator.ts` → `Step2Analysis.tsx`)

---

### Task 1: Add `n` to SegmentRawData interface

**Files:**
- Modify: `components/NewSchedule/utils/csvParser.ts:2-5`

**Step 1: Update the SegmentRawData interface**

```typescript
export interface SegmentRawData {
    segmentName: string;
    timeBuckets: Record<string, { p50: number, p80: number, n: number }>;
}
```

**Step 2: Run build to find all breakages**

Run: `npm run build 2>&1 | grep "error TS"`
Expected: May show errors where `{ p50, p80 }` objects are constructed without `n`. Note all locations.

**Step 3: Fix CSV parser `parseRuntimeCSV`**

In `csvParser.ts`, find where `timeBuckets` entries are created during CSV parsing. Add `n: 1` as a default since CSV imports don't have per-cell observation counts (they're already aggregated).

Search for assignments like `timeBuckets[bucket] = { p50: ..., p80: ... }` and add `n: 1`.

**Step 4: Run build to verify**

Run: `npm run build`
Expected: PASS (or remaining errors from Task 2 files)

**Step 5: Commit**

```
git add components/NewSchedule/utils/csvParser.ts
git commit -m "feat(runtime): add observation count (n) to SegmentRawData interface"
```

---

### Task 2: Propagate `n` from performanceRuntimeComputer

**Files:**
- Modify: `utils/performanceRuntimeComputer.ts:118-131`

**Step 1: Update the percentile computation loop to include `n`**

At line 118-131, where `timeBuckets` are built per segment per bucket, the `values` array already contains all observations. Add `n: values.length`:

```typescript
for (const [bucket, values] of bucketMap) {
    allTimeBuckets.add(bucket);
    const sorted = [...values].sort((a, b) => a - b);
    timeBuckets[bucket] = {
        p50: Math.round(percentileInc(sorted, 0.5) * 100) / 100,
        p80: Math.round(percentileInc(sorted, 0.8) * 100) / 100,
        n: sorted.length,
    };
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```
git add utils/performanceRuntimeComputer.ts
git commit -m "feat(runtime): propagate observation count from performance data"
```

---

### Task 3: Add `n` to SegmentDetail and TripBucketAnalysis

**Files:**
- Modify: `utils/ai/runtimeAnalysis.ts:4-8` (SegmentDetail interface)
- Modify: `utils/ai/runtimeAnalysis.ts:85-118` (calculateTotalTripTimes)

**Step 1: Update SegmentDetail interface**

```typescript
export interface SegmentDetail {
    segmentName: string;
    p50: number;
    p80: number;
    n: number; // observation count for this segment in this time bucket
}
```

**Step 2: Update calculateTotalTripTimes to thread `n`**

At lines 90-103, where `details` are pushed, read `n` from the segment's timeBucket:

```typescript
fileData.segments.forEach(seg => {
    const times = seg.timeBuckets[bucket];
    if (times) {
        const roundedP50 = Math.round(times.p50);
        const roundedP80 = Math.round(times.p80);
        sumP50 += roundedP50;
        sumP80 += roundedP80;
        details.push({
            segmentName: seg.segmentName,
            p50: roundedP50,
            p80: roundedP80,
            n: times.n,
        });
    }
});
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```
git add utils/ai/runtimeAnalysis.ts
git commit -m "feat(runtime): thread observation count through SegmentDetail"
```

---

### Task 4: Add `totalN` to BandSegmentAverage and computeDirectionBandSummary

**Files:**
- Modify: `utils/ai/runtimeAnalysis.ts:31-34` (BandSegmentAverage interface)
- Modify: `utils/ai/runtimeAnalysis.ts:225-289` (computeDirectionBandSummary)

**Step 1: Update BandSegmentAverage interface**

```typescript
export interface BandSegmentAverage {
    segmentName: string;
    avgTime: number;
    totalN: number; // total observations across all time slots in this band
}
```

**Step 2: Add MIN_RELIABLE_OBSERVATIONS constant**

At the top of the file (after imports):

```typescript
export const MIN_RELIABLE_OBSERVATIONS = 10;
```

**Step 3: Update computeDirectionBandSummary to accumulate totalN**

In the `avgSegments` computation (lines 262-276), accumulate `n`:

```typescript
const avgSegments = segmentNamesArr.map(segName => {
    let sum = 0;
    let count = 0;
    let totalN = 0;
    bucketsInBand.forEach(bucket => {
        const detail = bucket.details?.find(d => d.segmentName === segName);
        if (detail) {
            sum += detail.p50;
            count++;
            totalN += detail.n;
        }
    });
    return {
        segmentName: segName,
        avgTime: count > 0 ? sum / count : 0,
        totalN,
    };
}).filter(s => s.avgTime > 0);
```

**Step 4: Run build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```
git add utils/ai/runtimeAnalysis.ts
git commit -m "feat(runtime): add totalN to band segment averages for confidence checking"
```

---

### Task 5: Implement adjacent-band fallback in scheduleGenerator

**Files:**
- Modify: `utils/schedule/scheduleGenerator.ts:345-371`

**Step 1: Add getReliableSegmentTime helper**

After the existing `getSegmentTimeFromBand` helper (around line 350), add a new function that implements the full fallback chain:

```typescript
// Hardened segment time lookup with adjacent-band fallback
const getReliableSegmentTime = (fromStop: string, toStop: string, currentDir: string, currentTime: number): { time: number; source: string } => {
    const segmentName = `${fromStop} to ${toStop}`;
    const dirBands = bandSummary[currentDir];

    // Find current band
    const currentBandObj = getBandForTime(currentTime, currentDir);

    if (currentBandObj) {
        const seg = currentBandObj.segments.find(s => s.segmentName === segmentName);
        if (seg && seg.totalN >= 10) {
            return { time: seg.avgTime, source: 'band' };
        }
    }

    // Adjacent band fallback: walk outward from current band
    if (dirBands && currentBandObj) {
        const bandOrder = ['A', 'B', 'C', 'D', 'E'];
        const currentIdx = bandOrder.indexOf(currentBandObj.bandId);

        // Alternate: check one step toward middle, then one step away, expanding
        for (let offset = 1; offset < bandOrder.length; offset++) {
            for (const dir of [1, -1]) { // toward E first, then toward A
                const idx = currentIdx + (offset * dir);
                if (idx < 0 || idx >= bandOrder.length) continue;
                const adjacentBand = dirBands.find(b => b.bandId === bandOrder[idx]);
                if (!adjacentBand) continue;
                const seg = adjacentBand.segments.find(s => s.segmentName === segmentName);
                if (seg && seg.totalN >= 10) {
                    return { time: seg.avgTime, source: `adjacent-${adjacentBand.bandId}` };
                }
            }
        }

        // All-band weighted average: average across ALL bands for this segment
        let totalSum = 0;
        let totalCount = 0;
        dirBands.forEach(b => {
            const seg = b.segments.find(s => s.segmentName === segmentName);
            if (seg && seg.avgTime > 0) {
                totalSum += seg.avgTime * b.timeSlots.length; // Weight by time slot count
                totalCount += b.timeSlots.length;
            }
        });
        if (totalCount > 0) {
            return { time: totalSum / totalCount, source: 'all-band-avg' };
        }
    }

    // Existing raw fallback
    const dirSegments = runtimeData.find(d => d.detectedDirection === currentDir)?.segments || [];
    const rawTime = getRawSegmentRuntime(dirSegments, fromStop, toStop, currentTime);
    return { time: rawTime, source: rawTime === 5 ? 'default-5min' : 'raw-bucket' };
};
```

**Step 2: Replace the existing segment time lookup**

At line 365, replace:
```typescript
let segTime = getSegmentTimeFromBand(fromStop, toStop);

if (segTime === null) {
    segTime = getRawSegmentRuntime(dirSegments, fromStop, toStop, currentTime);
    usedBandData = false;
}
```

With:
```typescript
const reliable = getReliableSegmentTime(fromStop, toStop, currentDir, currentTime);
let segTime: number | null = reliable.time;
if (reliable.source !== 'band') {
    usedBandData = false;
}
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Run schedule generator tests**

Run: `npx vitest run tests/scheduleGenerator.goldenPath.test.ts tests/scheduleGenerator.directionStart.test.ts tests/scheduleGenerator.floating.test.ts`
Expected: All PASS (existing tests use CSV data with n=1, so the fallback should still work since the old path still fires for CSV-sourced data)

**Step 5: Commit**

```
git add utils/schedule/scheduleGenerator.ts
git commit -m "feat(runtime): add adjacent-band fallback with min-N threshold in schedule generator"
```

---

### Task 6: Add confidence indicators to Step2Analysis UI

**Files:**
- Modify: `components/NewSchedule/steps/Step2Analysis.tsx:23-71` (bandSummary aggregation)
- Modify: `components/NewSchedule/steps/Step2Analysis.tsx:157-181` (cell rendering)

**Step 1: Add totalN to the bandSummary aggregation**

In the `SegmentBreakdownMatrix` component, update the `bandSummary` useMemo (lines 25-71):

Update the type at line 27:
```typescript
segmentTotals: Record<string, { sum: number; count: number; totalN: number }>;
```

Update initialization at line 43:
```typescript
summary[band.id].segmentTotals[seg] = { sum: 0, count: 0, totalN: 0 };
```

Update accumulation at lines 57-63:
```typescript
bucket.details?.forEach(detail => {
    const value = viewMetric === 'p50' ? detail.p50 : detail.p80;
    if (bandData.segmentTotals[detail.segmentName]) {
        bandData.segmentTotals[detail.segmentName].sum += value;
        bandData.segmentTotals[detail.segmentName].count += 1;
        bandData.segmentTotals[detail.segmentName].totalN += detail.n;
    }
});
```

**Step 2: Update cell rendering with confidence colors**

At lines 157-181, update the cell rendering:

```tsx
{segmentNames.map(segName => {
    const segData = data.segmentTotals[segName];
    const avgValue = segData && segData.count > 0
        ? segData.sum / segData.count
        : null;
    const isLowN = segData && segData.totalN > 0 && segData.totalN < 10;

    return (
        <td
            key={segName}
            className="px-3 py-3 text-center font-mono"
            style={{
                backgroundColor: band.color + '15',
                borderLeft: `3px solid ${band.color}`
            }}
            title={segData ? `${segData.totalN} observations` : 'No data'}
        >
            {avgValue !== null ? (
                <span className={isLowN ? 'text-amber-600 italic' : 'text-gray-800 font-medium'}>
                    {avgValue.toFixed(0)}{isLowN ? '*' : ''}
                </span>
            ) : (
                <span className="text-gray-300">-</span>
            )}
        </td>
    );
})}
```

**Step 3: Add legend below the table**

After the closing `</table>` tag, add:

```tsx
<div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center gap-4 text-xs text-gray-500">
    <span className="font-medium text-gray-800">16</span> = reliable (n &ge; 10)
    <span className="text-amber-600 italic">8*</span> = low confidence (n &lt; 10)
    <span className="text-gray-300">-</span> = no data
</div>
```

**Step 4: Run build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```
git add components/NewSchedule/steps/Step2Analysis.tsx
git commit -m "feat(runtime): add confidence indicators to segment times by band table"
```

---

### Task 7: Add data quality summary to Step1Upload Data Preview

**Files:**
- Modify: `components/NewSchedule/steps/Step1Upload.tsx:373-402`

This task adds a data quality % to the Data Preview section showing what fraction of segment/band cells have sufficient data. This requires computing the quality from the available runtime data.

**Step 1: Import MIN_RELIABLE_OBSERVATIONS**

Add to imports at top of Step1Upload.tsx:
```typescript
import { MIN_RELIABLE_OBSERVATIONS } from '../../../utils/ai/runtimeAnalysis';
```

Note: This task depends on the runtime data being computed to know segment/band quality. Since this info isn't available at Step 1 (it's computed in Step 2), we should **skip this task** and instead rely on the `segmentDayCount` indicator already added. The confidence indicators in Step 2's table (Task 6) are where the quality signal belongs.

**Step 2: Commit (skip — no changes needed)**

---

### Task 8: Final integration test

**Step 1: Run full build**

Run: `npm run build`
Expected: PASS with no errors

**Step 2: Run all schedule generator tests**

Run: `npx vitest run tests/scheduleGenerator.goldenPath.test.ts tests/scheduleGenerator.directionStart.test.ts tests/scheduleGenerator.floating.test.ts`
Expected: All PASS

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 4: Manual verification**

1. Open the app, go to New Schedule → Create from Performance Data
2. Select a route with limited data
3. In Step 2 Analysis, verify:
   - Low-N cells show amber italic with `*`
   - Hover shows observation count
   - Legend appears below table
4. Proceed to Step 3 Build and verify schedule generates without errors

**Step 5: Final commit (if any cleanup needed)**

```
git add -A -- ':!nul'
git commit -m "feat(runtime): runtime data hardening with min-N threshold and confidence indicators"
```
