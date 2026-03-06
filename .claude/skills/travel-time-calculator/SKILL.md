---
name: travel-time-calculator
description: Use when working on segment times, travel times, band lookups, or the scheduleGenerator. Enforces critical calculation rules.
---

## Travel Time Calculation Rules

> **LOCKED LOGIC**: Read `docs/rules/LOCKED_LOGIC.md` first. Detailed notes remain in `.claude/context.md`. These rules MUST NOT be changed without explicit approval.

### The "Option D" Implementation

Travel times come from **BandSummary** (Step 2 analysis), not raw CSV data.

### Lookup Algorithm

When generating a trip at time `T`:

1. **Find Bucket**: Look for 30-min bucket containing `T`
   - Example: 7:00 AM → bucket "07:00 - 07:29"

2. **Fallback to Closest**: If no exact match, find nearest valid bucket
   - Example: 6:00 AM has no data → use "06:30 - 06:59" (Band E)

3. **Get Band**: Find which band (A-E) is assigned to that bucket
   - Bands: A (slowest) → E (fastest)

4. **Look Up Segment Time**: From bandSummary, get the averaged segment time
   - Example: Band A → "Park Place to Veteran's" → 6 min

### Critical Rules

| Rule | Implementation |
|------|----------------|
| **Segment Rounding** | Round each segment to nearest minute BEFORE summing |
| **Source of Truth** | BandSummary averaged times, NOT raw CSV |
| **Missing Data** | Fall back to closest available bucket |

### Debug Output

Console shows band data usage:
```
Trip 3 at 420 mins: {
    band: 'A',
    bandAvgTotal: '47',
    pureTravelTime: 23,
    usedBandData: true  // ← Used Step 2 table data
}
```

If `usedBandData: false`, segment name matching failed—investigate!

### Key Files

- `scheduleGenerator.ts`: Trip generation with band lookup
- `runtimeAnalysis.ts`: Band assignment logic
- `Step2Analysis.tsx`: BandSummary computation
