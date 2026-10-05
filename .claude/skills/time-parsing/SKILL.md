---
name: time-parsing
description: Use when modifying ANY time parsing, Excel time conversion, or schedule parsing function. MANDATORY test run required.
---

# Time Parsing Skill (CRITICAL)

> **This bug has occurred 3+ times.** Follow this guide exactly.

## The Post-Midnight Bug

Excel represents times as day fractions:
- `0.5` = 12:00 PM (noon)
- `0.75` = 6:00 PM
- `1.02` = 12:30 AM **next day** (the "1" = crossed midnight)

### Fixed-Route Schedule Rule

For fixed-route schedule and service-day parsing, preserve the whole-day offset:

```typescript
// CORRECT for service-day minutes
function excelScheduleTimeToMinutes(value: number): number | null {
  if (Number.isInteger(value)) return null; // date/ID, not a time
  const wholeDays = Math.floor(value);
  const fraction = value % 1;
  return (wholeDays * 1440) + Math.round(fraction * 1440);
}

// WRONG for fixed-route schedules: loses next-day ordering
function excelScheduleTimeToMinutes(value: number): number {
  const fraction = value - Math.floor(value);
  return Math.round(fraction * 1440); // BUG: 1.02 becomes ~29, not ~1469
}
```

Values greater than 1440 minutes are intentional in this domain. Display
formatters may wrap them to a clock time, but stored and compared service-day
minutes must retain the offset.

### Explicit Domain Exceptions

Do not apply the fixed-route rule blindly to every numeric Excel value. A
consumer whose contract is explicitly **time of day only** may normalize to a
0-1439 minute clock or 0-23 hour. Examples include Transit On Demand slot
indexing in `utils/parsers/csvParsers.ts` and hour-of-day reporting in
`utils/performanceDataAggregator.ts`. Confirm the consumer's contract and its
focused tests before choosing either representation.

## Affected Files

| File | Responsibility |
|------|----------------|
| `utils/timeUtils.ts` | Core fixed-route time utilities |
| `utils/parsers/masterScheduleParser.ts` | Legacy schedule import |
| `utils/parsers/masterScheduleParserV2.ts` | Current schedule import and `parseTimeToMinutes` |

## Before You Finish

**MANDATORY:** Run this command:

```bash
npx vitest run tests/timeUtils.test.ts
```

Do NOT mark your task complete until tests pass.

## Test Cases That Must Pass

```typescript
// Normal times
expect(parseTime(0.5)).toBe(720)      // 12:00 PM
expect(parseTime(0.75)).toBe(1080)    // 6:00 PM

// Post-midnight (the bug cases)
expect(parseTime(1.0)).toBeNull()      // pure integer date, not a time
expect(parseTime(1.02083)).toBe(1470)  // 12:30 AM next day
expect(parseTime(1.25)).toBe(1800)     // 6:00 AM next day
```

## Red Flags

If you see any of these patterns, STOP and verify:

- `value * 24 * 60` without checking for >= 1.0
- Schedule times above 1440 being reduced to clock-only minutes
- Schedule times showing "24:30" or similar
- A modulo/fractional conversion used without confirming a time-of-day-only contract

## Quick Reference

| Excel Value | Actual Time | Minutes |
|-------------|-------------|---------|
| 0.25 | 6:00 AM | 360 |
| 0.5 | 12:00 PM | 720 |
| 0.75 | 6:00 PM | 1080 |
| 1.0 | Pure integer/date | `null` |
| 1.02083 | 12:30 AM next day | 1470 |
| 1.25 | 6:00 AM next day | 1800 |
