---
name: fixed-route-pipeline
description: Use when modifying the New Schedule wizard (Step1-4), CSV parsing, runtime analysis, or schedule generation. Ensures data flow integrity.
---

## Fixed Route Pipeline

The New Schedule feature follows a strict 4-step pipeline. Always respect this data flow.

### Pipeline Flow

```
CSV Files (North.csv, South.csv)
    ↓
Step 1: Upload → csvParser.ts → RuntimeData
    ↓
Step 2: Analyze → runtimeAnalysis.ts → TripBucketAnalysis[] + BandSummary[]
    ↓
Step 3: Configure → User sets cycle time, recovery mode, blocks
    ↓
Step 4: Generate → scheduleGenerator.ts → MasterTrip[] → Display
```

### Key Files

| Step | Component | Utility |
|------|-----------|---------|
| 1 | `Step1Upload.tsx` | `csvParser.ts` |
| 2 | `Step2Analysis.tsx` | `runtimeAnalysis.ts` |
| 3 | `Step3Build.tsx` | - |
| 4 | `Step4Schedule.tsx` | `scheduleGenerator.ts` |

### Critical Data Handoffs

1. **Step1 → Step2**: `runtimeData` (parsed segments with times per 30-min bucket)
2. **Step2 → Wizard State**: `analysis[]` (trip buckets) + `bandSummary[]` (averaged segment times per band)
3. **Wizard → Generator**: `bandSummary` computed **synchronously** at generation time (not from state)
4. **Generator → Step4**: `MasterRouteTable[]` with trips
5. **Step4 Display**: `analysis`, `segmentNames`, `bands` passed through ScheduleEditor → TravelTimeGrid

### Rules

- **BandSummary is source of truth** for travel times (not raw CSV data)
- If a segment isn't in BandSummary, fall back to raw CSV
- State flows DOWN through the wizard, never back up
- Each step validates before allowing progression
