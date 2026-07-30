---
name: review-schedule-auto
description: Auto-activates when modifying schedule generation, runtime analysis, block assignment core, or trip generation logic. Validates locked logic compliance.
---

# Schedule Generation Review

This skill auto-activates when you modify schedule generation code.

## Automatic Validation

When touching these files, I will verify:
- `utils/schedule/scheduleGenerator.ts`
- `utils/ai/runtimeAnalysis.ts`
- `utils/blocks/blockAssignment.ts`
- `utils/blocks/blockAssignmentCore.ts`
- Any file with trip generation logic

## Validation Checklist

### 1. Segment Rounding (LOCKED)

**Rule:** Round each segment BEFORE summing

```typescript
// Search for this pattern - it MUST exist
const roundedSegment = Math.round(segmentTime)
```

**Violation:** `Math.round(segment1 + segment2)` - rounds AFTER summing

### 2. Trip Pairing (LOCKED)

**Rule:** N1+S1, N2+S2 pairs per row

Verify in any table/grid rendering:
```typescript
// Each row should pair:
// - First northbound trip with first southbound trip
// - NOT all northbound, then all southbound
```

### 3. Cycle Time Calculation (LOCKED)

**Rule:** First departure through occupied end. Count the last trip's terminal recovery exactly once.

```typescript
// CORRECT
const occupiedEnd = lastTrip.endTime + (
  lastTrip.isBlockEnd || resolvedEndTimeIncludesRecovery
    ? 0
    : terminalRecovery
)
const cycleTime = occupiedEnd - firstTrip.startTime

// WRONG - sum of durations
const cycleTime = trips.reduce((sum, t) => sum + t.duration, 0)
```

Use the explicit `endTimeIncludesRecovery` flag when present; legacy trips may require terminal-arrival data to resolve it. Never blindly add terminal recovery.

### 4. Band Lookup Logic

**Source of truth:** BandSummary from Step 2 analysis

- Find 30-min bucket containing trip time
- Fall back to closest bucket if no exact match
- Use averaged segment times from bandSummary

## Quick `rg` Commands

```bash
# Check rounding pattern
rg -n "Math\.round" utils/schedule/scheduleGenerator.ts

# Check cycle calculation
rg -n "cycleTime" utils/schedule/scheduleGenerator.ts

# Check band lookup
rg -n "bandSummary|bucket" utils/schedule/scheduleGenerator.ts
```

## Post-Modification

After any changes:

1. Run tests: `npx vitest run`
2. Build check: `npm run build`
3. Manual verify: Generate a test schedule and inspect output

## Red Flags

Stop and investigate if you see:
- Cycle times that equal sum of trip durations
- Rows with N1+N2 instead of N1+S1
- Segment times being summed before rounding
- Band lookup using raw CSV instead of bandSummary
