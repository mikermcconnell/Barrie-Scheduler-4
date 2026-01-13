---
name: gotchas
description: Proactively use when making changes to core schedule logic, trip generation, or time calculations. Pre-flight checklist.
---

# Pre-Flight Checklist

Before completing ANY task that touches schedule logic, verify:

## Locked Logic Checklist

- [ ] **Segment rounding** - Did I round BEFORE summing?
  ```typescript
  // RIGHT
  total = Math.round(seg1) + Math.round(seg2)
  // WRONG
  total = Math.round(seg1 + seg2)
  ```

- [ ] **Trip pairing** - Are rows N1+S1 (not N1+N2)?
  ```
  Row 1: North Trip 1 | South Trip 1  ✓
  Row 1: North Trip 1 | North Trip 2  ✗
  ```

- [ ] **Cycle time** - Is it `lastEnd - firstStart`?
  ```typescript
  // RIGHT
  cycle = trips[trips.length-1].endTime - trips[0].startTime
  // WRONG
  cycle = sum(allTripDurations)
  ```

- [ ] **Time parsing** - Did I handle Excel times >= 1.0?

## Test Checklist

- [ ] Run `npx vitest run tests/timeUtils.test.ts` if touching time parsing
- [ ] Run `npx vitest run` for full test suite
- [ ] Run `npm run build` to catch TypeScript errors

## File-Specific Warnings

| File | Watch Out For |
|------|---------------|
| `scheduleGenerator.ts` | Segment rounding, band lookup |
| `ScheduleEditor.tsx` | Trip pairing, unique React keys |
| `blockAssignment.ts` | Time proximity (1-min tolerance), direction alternation |
| `runtimeAnalysis.ts` | Band boundaries, bucket matching |
| `api/optimize.ts` | Double-pass pattern (Generator → Critic) |

## Common Mistakes

1. **Adding recovery twice** - `endTime` already includes recovery in generated schedules
2. **Off-by-one in stop indexing** - Arrays are 0-indexed, UI is 1-indexed
3. **Duplicate React keys** - Use `${blockId}-${tripIndex}` pattern
4. **Missing band fallback** - Always handle "no exact bucket match"
5. **Hardcoded column indices** - Day types have different layouts

## Before Submitting

Ask yourself:
1. Did I check the locked logic in `context.md`?
2. Did I run the relevant tests?
3. Could this change affect downstream calculations?
4. Did I test edge cases (empty data, single trip, post-midnight)?
