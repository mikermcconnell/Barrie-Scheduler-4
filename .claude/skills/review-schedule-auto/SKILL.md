---
name: review-schedule-auto
description: Auto-activates when modifying scheduleGenerator.ts, runtimeAnalysis.ts, or trip generation logic. Validates locked logic compliance.
---

# Schedule Generation Review

This skill auto-activates when you modify schedule generation code.

## Automatic Validation

When touching these files, I will verify:
- `scheduleGenerator.ts`
- `runtimeAnalysis.ts`
- `blockAssignment.ts`
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

**Rule:** `Last Trip End - First Trip Start`

```typescript
// CORRECT
const cycleTime = schedule[schedule.length - 1].endTime - schedule[0].startTime

// WRONG - sum of durations
const cycleTime = trips.reduce((sum, t) => sum + t.duration, 0)
```

### 4. Band Lookup Logic

**Source of truth:** BandSummary from Step 2 analysis

- Find 30-min bucket containing trip time
- Fall back to closest bucket if no exact match
- Use averaged segment times from bandSummary

## Quick Grep Commands

```bash
# Check rounding pattern
grep -n "Math.round" utils/schedule/scheduleGenerator.ts

# Check cycle calculation
grep -n "cycleTime" utils/schedule/scheduleGenerator.ts

# Check band lookup
grep -n "bandSummary\|bucket" utils/schedule/scheduleGenerator.ts
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
