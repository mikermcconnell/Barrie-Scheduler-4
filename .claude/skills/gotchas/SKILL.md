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

- [ ] **Cycle time** - Does it span first departure through occupied end, counting terminal recovery exactly once?
  ```typescript
  // RIGHT
  occupiedEnd = lastTrip.endTime + (
    lastTrip.isBlockEnd || resolvedEndTimeIncludesRecovery ? 0 : terminalRecovery
  )
  cycle = occupiedEnd - firstTrip.startTime
  // WRONG
  cycle = sum(allTripDurations)
  ```

- [ ] **TOD optimization path** - Does Generate stay fast, while Refine uses critic/polisher only when policy and runtime allow it?

- [ ] **Time parsing** - Did I handle Excel times >= 1.0?

## Test Checklist

- [ ] Run `npx vitest run tests/timeUtils.test.ts` if touching time parsing
- [ ] Run `npx vitest run` for full test suite
- [ ] Run `npm run build` to catch TypeScript errors

## File-Specific Warnings

| File | Watch Out For |
|------|---------------|
| `utils/schedule/scheduleGenerator.ts` | Segment rounding, band lookup |
| `components/ScheduleEditor.tsx` | Trip pairing, unique React keys |
| `utils/blocks/blockAssignment.ts` | Generated/legacy expected-start matching and direction alternation |
| `utils/blocks/blockAssignmentCore.ts` | Merged-route actual-gap matching, `maxGap`, location continuity, and matching presets |
| `utils/ai/runtimeAnalysis.ts` | Band boundaries, bucket matching |
| `api/optimize.ts` | Generate uses the fast generator path; Refine may use generator → critic → polisher only when multi-phase policy/runtime allow it |

## Common Mistakes

1. **Counting terminal recovery incorrectly** - Respect `isBlockEnd` and resolved `endTimeIncludesRecovery`; add terminal recovery only when neither already closes the occupied span
2. **Off-by-one in stop indexing** - Arrays are 0-indexed, UI is 1-indexed
3. **Duplicate React keys** - Use `${blockId}-${tripIndex}` pattern
4. **Missing band fallback** - Always handle "no exact bucket match"
5. **Hardcoded column indices** - Day types have different layouts

## Before Submitting

Ask yourself:
1. Did I check the locked logic in `docs/rules/LOCKED_LOGIC.md`?
2. Did I run the relevant tests?
3. Could this change affect downstream calculations?
4. Did I test edge cases (empty data, single trip, post-midnight)?
