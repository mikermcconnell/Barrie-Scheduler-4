---
name: fixed-route-pipeline
description: Use when modifying the New Schedule wizard (Steps 1-5), CSV parsing, runtime analysis, schedule generation, or connection handoff. Ensures data flow integrity.
---

## Fixed Route Pipeline

The New Schedule feature follows a strict five-step pipeline followed by protected draft review and publishing. Always respect this data flow.

### Pipeline Flow

```text
Runtime CSV or imported performance history
    ↓
Step 1: Select source → parser/performance computer → RuntimeData
    ↓
Step 2: Analyze and approve → ApprovedRuntimeContract v2
    ↓
Step 3: Configure → cycle, recovery, and blocks
    ↓
Step 4: Generate/edit → scheduleGenerator.ts → MasterRouteTable[]
    ↓
Step 5: Configure/optimize connections
    ↓
Protected draft editor → Save Draft → Submit for Review → Ready → Publish
```

### Key Files

| Step | Component | Utility |
|------|-----------|---------|
| 1 | `Step1Upload.tsx` | `csvParser.ts`, `performanceRuntimeComputer.ts` |
| 2 | `Step2Analysis.tsx` | `runtimeAnalysis.ts`, `step2ReviewBuilder.ts` |
| 3 | `Step3Build.tsx` | `scheduleGenerator.ts` validation |
| 4 | `Step4Schedule.tsx` | `scheduleGenerator.ts` |
| 5 | `Step5Connections.tsx` | `connectionOptimizer.ts` |

### Critical Data Handoffs

1. **Step 1 → Step 2**: parsed or computed `RuntimeData` plus source/canonical-stop evidence.
2. **Step 2 → Wizard state**: a current schema-v2 `ApprovedRuntimeContract`; visible review data alone is never a generation input.
3. **Approved contract → Generator**: only trusted buckets and direction-band summaries from the current contract.
4. **Generator → Step 4**: `MasterRouteTable[]` plus an exact generation-input fingerprint.
5. **Step 4 → Step 5**: edited tables remain bound to the same approved/configured input lineage.
6. **Step 5 → Draft editor**: optimized or unchanged tables; never a direct Master write.

### Rules

- The current `ApprovedRuntimeContract` is the source of truth for travel times; raw, weak, missing, or stale evidence never becomes a generation fallback.
- Review North-start and South-start paired cycles independently; exclusions are orientation-specific.
- State flows down through the wizard, never back up.
- Each step validates before allowing progression.
- Changing source, approval, day type, autofill, or Step 3 configuration invalidates generated output until regeneration.
- Step 4 regularization cannot be applied when its preview contains overlaps.
- Publishing remains in the Draft → Review → Ready → Publish workflow.
