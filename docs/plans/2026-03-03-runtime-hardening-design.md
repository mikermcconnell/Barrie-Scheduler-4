# Runtime Data Hardening Design

**Date:** 2026-03-03
**Problem:** With limited STREETS data (especially < 1 month), some segment/band cells have very few or zero observations, producing unreliable runtime calculations that skew schedule generation.

## Design Decisions

- **Min-N threshold:** 10 observations per segment/band cell
- **Fallback strategy:** Adjacent band first, then all-band average
- **Approach:** Observation-count propagation through the full pipeline (Approach A)

## Data Model Changes

### `performanceRuntimeComputer.ts` — SegmentRawData

Add observation count per time bucket:

```typescript
// Before
timeBuckets[bucket]: { p50: number; p80: number }

// After
timeBuckets[bucket]: { p50: number; p80: number; n: number }
```

### `runtimeAnalysis.ts` — BandSummary / SegmentBreakdownMatrix

Add `totalN` (sum of observation counts) per segment per band:

```typescript
// segmentTotals in SegmentBreakdownMatrix aggregation
segmentTotals[segName]: { sum: number; count: number; totalN: number }
```

- `count` = number of time slots in this band that have data for this segment
- `totalN` = total raw observations across all those time slots

### Constant

```typescript
export const MIN_RELIABLE_OBSERVATIONS = 10;
```

## Fallback Chain (scheduleGenerator.ts)

New fallback order when getting a segment time:

1. **Band segment time** — `getSegmentTimeFromBand()` checks `totalN >= 10`. If reliable, use it.
2. **Adjacent band** — Walk toward middle bands (E→D→C or A→B→C) looking for the same segment with `totalN >= 10`.
3. **All-band segment average** — Weighted average of the segment across all bands, using all available data regardless of n.
4. **Raw time bucket lookup** — Existing `getRawSegmentRuntime()` fallback.
5. **Hard fallback: 5 min** — Last resort (should never hit with real data).

Each fallback step is logged for traceability.

## UI Confidence Indicators (Step2Analysis.tsx)

### Segment Times by Band Table

| Cell State | Visual Treatment |
|-----------|-----------------|
| `totalN >= 10` | Default (green-tinted text) — reliable |
| `0 < totalN < 10` | Amber text, italic, `*` suffix, tooltip shows n |
| `totalN = 0` | Gray dash `-` (existing) |

### Data Preview (Step1Upload.tsx)

Add a summary line when a route is selected:
> "87% of segment/band cells have sufficient data (n >= 10)"

This gives an at-a-glance quality signal before entering the analysis step.

## Files Affected

| File | Change |
|------|--------|
| `utils/performanceRuntimeComputer.ts` | Add `n` to timeBucket output |
| `utils/ai/runtimeAnalysis.ts` | Thread `totalN` through band summaries |
| `utils/schedule/scheduleGenerator.ts` | New fallback chain with n-check + adjacent band |
| `components/NewSchedule/steps/Step2Analysis.tsx` | Confidence coloring on segment cells |
| `components/NewSchedule/steps/Step1Upload.tsx` | Data quality summary in preview |

## Not in Scope

- Retroactive backfill of segmentRuntimes for old imports (requires raw STREETS data)
- Per-cell editing/override of runtime values
- Configurable min-N threshold in UI (hardcoded at 10 for now)
