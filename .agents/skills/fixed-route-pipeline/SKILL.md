---
name: fixed-route-pipeline
description: Use when modifying the New Schedule wizard, CSV/performance parsing, runtime approval, or schedule generation. Ensures data flow integrity.
---

## Fixed Route Pipeline

The New Schedule build flow has four core steps followed by an optional
connections step. Always respect this data flow and the trusted-runtime gate.

### Pipeline Flow

```
Uploaded runtime CSV or selected Performance data
    ↓
Step 1: Select/import source → RuntimeData
    ↓
Step 2: Review + approve → ApprovedRuntimeContract v2
    ↓
Step 3: Configure → User sets cycle time, recovery mode, blocks
    ↓
Step 4: Generate/edit → scheduleGenerator.ts → MasterRouteTable[]
    ↓
Step 5: Add/review connections
```

### Key Files

| Step | Component | Utility |
|------|-----------|---------|
| 1 | `components/NewSchedule/steps/Step1Upload.tsx` | `components/NewSchedule/utils/csvParser.ts` |
| 2 | `components/NewSchedule/steps/Step2Analysis.tsx` | `utils/ai/runtimeAnalysis.ts`, `utils/ai/runtimeEvidenceEligibility.ts` |
| 3 | `components/NewSchedule/steps/Step3Build.tsx` | `components/NewSchedule/utils/step2ApprovedRuntimeModelAdapter.ts` |
| 4 | `components/NewSchedule/steps/Step4Schedule.tsx` | `utils/schedule/scheduleGenerator.ts` |
| 5 | `components/NewSchedule/steps/Step5Connections.tsx` | `utils/connections/` |

### Critical Data Handoffs

1. **Step 1 → Step 2**: parsed runtime observations and source metadata.
2. **Step 2 review → approval**: visible `reviewBuckets` remain separate from trusted `approvedBuckets`; approval produces a current `ApprovedRuntimeContract` schema v2.
3. **Approval → Step 3/4**: stale or missing approval blocks navigation, generation, export, and Master upload.
4. **Wizard → generator**: pass only the approved planning buckets, bands, direction summary, canonical stop order, and start-orientation buckets from the current contract.
5. **Generator → Step 4**: `MasterRouteTable[]` with per-segment `runtimeSourceBreakdown` provenance.

### Rules

- `docs/rules/LOCKED_LOGIC.md` owns eligibility and generation behavior.
- Strict wizard generation uses an eligible approved bucket. It never falls
  back to raw CSV segments, another orientation, unapproved data, or a default
  runtime.
- Use the exact approved half-hour bucket when available. Otherwise use the
  nearest eligible approved bucket from the same direction/start orientation,
  measured around the 24-hour clock with the earlier bucket winning a tie.
- Performance imports reuse the approved paired-cycle start bucket for both
  legs. Uploaded CSV evidence remains keyed to each trip start.
- If no eligible same-orientation bucket exists, or the chosen bucket lacks a
  canonical segment, generation fails closed with
  `MissingApprovedRuntimeError`.
- State flows down through the wizard; each step validates before progression.
