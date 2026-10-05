---
name: travel-time-calculator
description: Use when working on segment times, travel times, band lookups, or the scheduleGenerator. Enforces critical calculation rules.
---

## Travel Time Calculation Rules

> **LOCKED LOGIC**: Read `docs/rules/LOCKED_LOGIC.md` first. Detailed notes remain in `.claude/context.md`. These rules MUST NOT be changed without explicit approval.

### Current Trusted-Runtime Implementation

New Schedule Steps 3 and 4 consume the current approved Step 2 runtime
contract. Review evidence is not scheduling input merely because it is visible
in Step 2.

### Lookup Algorithm

When generating a trip at time `T`:

1. **Choose the approved source orientation** for the trip or paired cycle.
   - Performance imports key a two-leg pair to its approved cycle-start orientation.
   - Uploaded CSV imports key each trip to its own start direction.

2. **Find Exact Bucket**: Look for the eligible approved 30-minute bucket containing `T`.
   - Example: 7:00 AM → bucket "07:00 - 07:29"

3. **Nearest Approved Fallback**: If no exact match exists, use the nearest
   eligible approved bucket from that same direction/orientation.
   - Measure distance around the 24-hour clock.
   - Prefer the earlier bucket when equally near.

4. **Look Up Every Canonical Segment** in that selected approved bucket and use
   its approved P50 runtime.

5. **Fail Closed** if the orientation has no eligible approved bucket or the
   selected bucket lacks any canonical segment. Do not cross orientations or
   use review-only, raw, adjacent-band, all-band-average, or default values.

### Critical Rules

| Rule | Implementation |
|------|----------------|
| **Segment Rounding** | Round each segment to nearest minute BEFORE summing |
| **Source of Truth** | Current Step 2 `ApprovedRuntimeContract` v2 |
| **Nearest fallback** | Eligible approved bucket from the same direction/orientation only |
| **Missing data** | Throw `MissingApprovedRuntimeError`; do not synthesize a runtime |

### Provenance

Generated trips record each segment source in `runtimeSourceBreakdown` as
`approved-exact-bucket` or
`approved-nearest-bucket[used-for-requested]`. Treat any raw/default source in
a strict wizard-generated trip as a defect.

### Key Files

- `utils/schedule/scheduleGenerator.ts`: strict bucket selection and generation
- `utils/ai/runtimeEvidenceEligibility.ts`: bucket eligibility
- `utils/ai/runtimeAnalysis.ts`: analysis and band assignment
- `components/NewSchedule/NewScheduleWizard.tsx`: approval gate and strict generator call
- `components/NewSchedule/steps/Step2Analysis.tsx`: runtime review UI

### Verification

```bash
npx vitest run tests/scheduleGenerator.canonicalTravelTimes.test.ts tests/scheduleGenerator.lockedLogic.test.ts tests/runtimeEvidenceEligibility.test.ts
```
