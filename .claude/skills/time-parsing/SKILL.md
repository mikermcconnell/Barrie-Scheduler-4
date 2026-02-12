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

### The Fix

For values >= 1.0, extract the fractional part:

```typescript
// CORRECT
function excelTimeToMinutes(value: number): number {
  const fractional = value >= 1 ? value - Math.floor(value) : value;
  return Math.round(fractional * 24 * 60);
}

// WRONG - treats 1.02 as 24+ hours
function excelTimeToMinutes(value: number): number {
  return Math.round(value * 24 * 60); // BUG: 1.02 → 1469 minutes!
}
```

## Affected Files

| File | Lines | Function |
|------|-------|----------|
| `utils/timeUtils.ts` | 18-26 | Core time utilities |
| `utils/parsers/masterScheduleParser.ts` | 119-129 | Schedule import |
| `utils/parsers/masterScheduleParserV2.ts` | 55-84 | `parseTimeToMinutes` |
| `utils/parsers/masterScheduleParserV2.ts` | 425 | `isExcelTime` check |

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
expect(parseTime(1.0)).toBe(0)        // 12:00 AM
expect(parseTime(1.02083)).toBe(30)   // 12:30 AM
expect(parseTime(1.25)).toBe(360)     // 6:00 AM
```

## Red Flags

If you see any of these patterns, STOP and verify:

- `value * 24 * 60` without checking for >= 1.0
- Time values > 1440 minutes (24 hours)
- Schedule times showing "24:30" or similar
- Missing `Math.floor()` or modulo operation on Excel times

## Quick Reference

| Excel Value | Actual Time | Minutes |
|-------------|-------------|---------|
| 0.25 | 6:00 AM | 360 |
| 0.5 | 12:00 PM | 720 |
| 0.75 | 6:00 PM | 1080 |
| 1.0 | 12:00 AM | 0 |
| 1.02083 | 12:30 AM | 30 |
| 1.25 | 6:00 AM | 360 |
