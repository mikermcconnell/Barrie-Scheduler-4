# New Schedule Step 2 Contract Design

Status: Proposed  
Date: March 27, 2026  
Depends on: `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md`
Related: `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md`

---

## 1. Purpose

This document locks the concrete Step 2 contract design before implementation starts.

The design assumes the core analytic outcome of Step 2 is to let the planner review the **median travel time for each route segment by 30-minute time bucket**, then approve the resulting planning contract for later steps.

It answers three practical questions:

1. What exact data objects should the rebuilt Step 2 use?
2. When is an approved runtime contract valid or stale?
3. How should the rebuilt Step 2 screen be split into components?

This is the next design layer under the Step 2 rebuild spec. It is still pre-code planning.

---

## 2. Design Decision Summary

The rebuilt Step 2 will use three top-level objects:

1. **`Step2ReviewInput`**  
   Raw material from Step 1 plus saved planner overrides.

2. **`Step2ReviewResult`**  
   Built review state used to render Step 2 and decide readiness.

3. **`ApprovedRuntimeContract`**  
   Explicit, persisted snapshot created only when the planner approves.

The UI must never invent these objects for itself. They are domain objects first and UI props second.

---

## 3. Core Design Principles

### 3.1 Approval is explicit

The approved runtime contract is not a live memoized view. It is a frozen planner-approved snapshot.

### 3.2 Review state and approved state are separate

The screen may show the latest review result, but the approved contract may be:

- absent
- current
- stale

### 3.3 Troubleshooting is not planning truth

The troubleshooting matrix and fallback diagnostics help explain the data, but they do not define the approved planning contract.

### 3.5 Planning chain resolution is dynamic

The planning chain should not depend primarily on a manually maintained stop-order list or on GTFS.

The preferred long-term design is a dynamic stop-order resolver that:

- uses stop numbers / stop IDs first
- uses stop names second
- derives the planning chain from recent complete observed trips
- prefers midday complete patterns when available
- excludes partial trips from planning truth

Read `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md` for the detailed process and source-ranking rules.

### 3.4 Step 3 and Step 4 trust the approved contract only

If the approved contract is missing or stale, later steps must not proceed as if Step 2 is complete.

---

## 4. Proposed Types

The exact implementation can evolve, but the rebuild should target shapes close to the following.

## 4.1 Step2ReviewInput

```ts
interface Step2ReviewInput {
  routeIdentity: string;
  routeNumber: string;
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  importMode: 'csv' | 'performance';

  performanceConfig?: {
    routeId: string;
    dateRange: { start: string; end: string } | null;
  };

  parsedData: RuntimeData[];
  performanceDiagnostics?: PerformanceRuntimeDiagnostics | null;

  canonicalDirectionStops?: Partial<Record<'North' | 'South', string[]>>;
  canonicalRouteSource?: {
    type: 'master' | 'runtime-derived';
    routeIdentity?: string;
    versionHint?: string;
  };

  plannerOverrides: Step2PlannerOverrides;
}
```

Purpose:

- a full and deterministic input to the Step 2 review builder
- enough information to calculate review output and invalidation fingerprints

---

## 4.2 Step2PlannerOverrides

```ts
interface Step2PlannerOverrides {
  excludedBuckets: string[];
}
```

v1 scope is intentionally small.

Planner overrides should not include ad hoc edits to bands or segment values in this rebuild.

---

## 4.3 Step2ReviewLifecycle

```ts
type Step2ReviewLifecycle =
  | 'idle'
  | 'building'
  | 'reviewable'
  | 'stale'
  | 'error';
```

---

## 4.4 Step2ReadinessStatus

```ts
type Step2ReadinessStatus = 'blocked' | 'warning' | 'ready';
```

---

## 4.5 Step2ApprovalState

```ts
type Step2ApprovalState = 'unapproved' | 'approved' | 'stale';
```

---

## 4.6 Step2ReviewHealth

This should replace the current UI-friendly health object with a slightly stricter domain-level type.

```ts
interface Step2ReviewHealth {
  status: Step2ReadinessStatus;
  blockers: string[];
  warnings: string[];

  expectedDirections: number;
  matchedDirections: string[];

  expectedSegmentCount: number;
  matchedSegmentCount: number;
  missingSegments: string[];

  availableBucketCount: number;
  completeBucketCount: number;
  incompleteBucketCount: number;
  lowConfidenceBucketCount: number;
  repairedBucketCount?: number;
  boundaryBucketCount?: number;
  singleGapBucketCount?: number;
  internalGapBucketCount?: number;
  fragmentedGapBucketCount?: number;

  runtimeSourceSummary: string;
  sampleCountMode?: 'observations' | 'days';
  confidenceThreshold: number;

  importedAt?: string;
  runtimeLogicVersion?: number;
  usesLegacyRuntimeLogic: boolean;
}
```

---

## 4.7 Step2PlanningPayload

This is the generation-relevant planning data from the current review result.

```ts
interface Step2PlanningPayload {
  chartBasis: 'observed-cycle' | 'uploaded-percentiles';
  generationBasis: 'direction-band-summary';

  buckets: TripBucketAnalysis[];
  bands: TimeBand[];
  directionBandSummary: DirectionBandSummary;

  segmentColumns: OrderedSegmentColumn[];
  canonicalDirectionStops?: Partial<Record<'North' | 'South', string[]>>;

  usableBucketCount: number;
  ignoredBucketCount: number;
  usableBandCount: number;
  directions: string[];
}
```

Important change from today:

- `canonicalDirectionStops` must be part of the contract payload, not refetched later during generation
- `buckets` should preserve bucket-level coverage metadata so Step 2 can show whether a bucket is complete, estimated-repaired, boundary-service, internally gapped, or fragmented without re-deriving that diagnosis in the view layer

---

## 4.8 Step2TroubleshootingPayload

```ts
interface Step2TroubleshootingPayload {
  matrixAnalysis: TripBucketAnalysis[];
  matrixSegmentsMap: Record<string, SegmentRawData[]>;
  fallbackWarning?: string | null;
  canRenderFullPath: boolean;
}
```

This is not part of the approved planning contract.

It may be persisted for resume convenience, but downstream build/generation logic must not depend on it.

---

## 4.9 Step2ReviewResult

```ts
interface Step2ReviewResult {
  lifecycle: Step2ReviewLifecycle;

  inputFingerprint: string;
  routeIdentity: string;
  routeNumber: string;
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  importMode: 'csv' | 'performance';

  health: Step2ReviewHealth;
  planning: Step2PlanningPayload;
  troubleshooting: Step2TroubleshootingPayload;

  plannerOverrides: Step2PlannerOverrides;
  approvalEligible: boolean;
}
```

`approvalEligible` is derived:

- `false` when blocked
- `true` when warning or ready

The UI should not recompute it separately.

---

## 4.10 ApprovedRuntimeContract

This replaces the current vague `ApprovedRuntimeModel` idea with a true persisted approval artifact.

```ts
interface ApprovedRuntimeContract {
  schemaVersion: 1;

  routeIdentity: string;
  routeNumber: string;
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  importMode: 'csv' | 'performance';

  inputFingerprint: string;
  approvalState: 'approved';
  readinessStatus: 'warning' | 'ready';

  approvedAt: string;
  approvedBy?: {
    userId?: string;
    displayName?: string;
  };

  acknowledgedWarnings?: string[];

  sourceSnapshot: {
    performanceRouteId?: string;
    performanceDateRange?: { start: string; end: string } | null;
    runtimeLogicVersion?: number;
    importedAt?: string;
    cleanHistoryStartDate?: string;
  };

  planning: Step2PlanningPayload;
  healthSnapshot: Step2ReviewHealth;
}
```

Blocked contracts are not valid contracts and must never be created.

---

## 5. Why a Fingerprint Is Required

The current Step 2 has no strong invalidation key.

That is a major reason approval is weak today.

The rebuilt design requires a stable `inputFingerprint` so the app can prove whether an approved contract still matches the current Step 1/Step 2 inputs.

---

## 6. Fingerprint Design

The fingerprint should be derived from the smallest set of facts that materially change the meaning of approval.

## 6.1 Must include

- route identity
- route number
- day type
- import mode
- performance route selection
- performance date range
- parsed runtime input identity
- runtime logic version when present
- canonical route-chain signature
- planner bucket exclusions

## 6.2 Should not include

- purely visual Step 2 UI state
- expand/collapse state
- chosen display metric P50/P80
- troubleshooting panel open/closed state

## 6.3 Purpose

The fingerprint is not for security. It is for deterministic invalidation.

---

## 7. Approval and Invalidation Rules

## 7.1 Approval creation

Approval is allowed only when:

- review lifecycle = `reviewable`
- readiness status = `warning` or `ready`
- review result is not stale

If readiness = `warning`, approval is still allowed. The warning list should remain visible in Step 2 and should be copied into the approved contract snapshot.

If readiness = `blocked`, the approve action is disabled.

## 7.2 Approval remains valid while

- the current `Step2ReviewResult.inputFingerprint` equals the approved contract fingerprint
- the review result lifecycle is not `stale` or `error`

## 7.3 Approval becomes stale when any of these change

- route number or route identity
- day type
- import mode
- selected performance route
- selected performance date range
- parsed runtime dataset
- canonical planning chain
- runtime logic version
- planner excluded buckets

## 7.4 Approval should not become stale when only these change

- expanded bucket rows
- metric toggle between P50 and P80
- troubleshooting panel state
- chart scroll/selection UI state

## 7.5 Downstream effect of stale approval

When approval becomes stale:

- Step 2 approval state changes to `stale`
- Continue to Step 3 is disabled
- Step 3 and Step 4 must not proceed without re-approval

---

## 8. Save and Resume Rules

## 8.1 What should be persisted

Persist:

- Step2ReviewInput-adjacent scope fields already used by the wizard
- planner overrides
- latest `Step2ReviewResult` only if useful for resume performance
- `ApprovedRuntimeContract`

## 8.2 Restore behavior

On restore:

1. restore raw state
2. rebuild `Step2ReviewResult`
3. compare rebuilt fingerprint to saved approved contract fingerprint
4. mark approval state as:
   - `approved` if still valid
   - `stale` if it no longer matches

The app should not trust a saved approved contract without revalidation.

## 8.3 Duplicate behavior

Project duplication should carry forward:

- planner overrides
- approved runtime contract

But the restored project must still revalidate that contract on load.

---

## 9. Downstream Dependency Rules

These are the contract-level rules for later steps.

## 9.1 Step 3 may use

- `approvedRuntimeContract.planning`
- `config`

Step 3 should not need raw live `analysis` or `bands` as its source of truth.

## 9.2 Step 4 may use

- `approvedRuntimeContract.planning`
- generated schedules
- editor state

Step 4 should not display one contract in its banner while using different live Step 2 data in the editor.

## 9.3 Generation may use

- approved planning buckets
- approved bands
- approved direction band summary
- approved canonical direction stops
- parsed source data if still needed for schedule generation mechanics

But generation must not refetch canonical master data to reconstruct the approved planning contract.

---

## 10. Proposed UI/Component Breakdown

The rebuilt Step 2 should be split into the following components.

## 10.1 `Step2RuntimeReviewScreen`

Top-level composition only.

Owns:

- layout
- wiring child props
- no heavy derivation logic

## 10.2 `RuntimeReviewHeader`

Owns:

- page title
- route/day/source badges
- metric toggle
- approval status badge

## 10.3 `RuntimeReadinessPanel`

Owns:

- blocked / warning / ready summary
- blockers
- warnings
- health counts
- import/runtime-source metadata

Must be visible without opening collapsibles when blocked.

## 10.4 `PlanningBucketsPanel`

Owns:

- chart
- legend
- bucket table
- include/exclude interactions

Likely subcomponents:

- `BucketRuntimeChart`
- `BucketLegend`
- `BucketReviewTable`

## 10.5 `PlanningBandSummaryPanel`

Owns:

- band summary matrix only

This panel is planning truth and should stay distinct from troubleshooting.

## 10.6 `TroubleshootingPanel`

Owns:

- stop-to-stop matrix
- fallback warning state
- explanation text

This must be labeled as diagnostic only.

## 10.7 `RuntimeContractSummaryPanel`

Owns:

- current contract candidate summary
- currently approved contract summary
- stale/current status
- approval timestamp and warning summary when present

This replaces the misleading current “Approved Runtime Model” panel.

## 10.8 `Step2ApprovalFooter`

Owns:

- Back
- Approve / Replace Approval
- Continue to Step 3

This must be the main gate surface.

Continue should be disabled unless:

- approval state = `approved`
- approval is not stale

---

## 11. Logic Placement Rules

## 11.1 Must live outside React view components

- review building
- health evaluation
- approval contract building
- fingerprint generation
- invalidation checks
- canonical planning-chain resolution
- bucket confidence calculations

## 11.2 May live in a controller/hook

- calling the builder
- holding planner override state
- creating approval
- stale-state transitions
- dispatching footer actions

Suggested name:

- `useStep2RuntimeReview`

## 11.3 Must stay in presentational UI

- rendering panels
- routing user actions to callbacks
- local expand/collapse state
- metric toggle state

---

## 12. Proposed File Shape

This is the recommended implementation target, not a locked mandate.

### Domain

- `components/NewSchedule/utils/step2ReviewTypes.ts`
- `components/NewSchedule/utils/step2ReviewBuilder.ts`
- `components/NewSchedule/utils/step2ReviewFingerprint.ts`
- `components/NewSchedule/utils/step2Approval.ts`
- `components/NewSchedule/utils/step2Invalidation.ts`

### Controller

- `components/NewSchedule/hooks/useStep2RuntimeReview.ts`

### UI

- `components/NewSchedule/steps/Step2RuntimeReview.tsx`
- `components/NewSchedule/step2/RuntimeReviewHeader.tsx`
- `components/NewSchedule/step2/RuntimeReadinessPanel.tsx`
- `components/NewSchedule/step2/PlanningBucketsPanel.tsx`
- `components/NewSchedule/step2/PlanningBandSummaryPanel.tsx`
- `components/NewSchedule/step2/TroubleshootingPanel.tsx`
- `components/NewSchedule/step2/RuntimeContractSummaryPanel.tsx`
- `components/NewSchedule/step2/Step2ApprovalFooter.tsx`

### Wizard integration

- `components/NewSchedule/NewScheduleWizard.tsx`
- `components/NewSchedule/utils/wizardProjectState.ts`
- `utils/services/newScheduleProjectService.ts`

---

## 13. Migration Notes From the Current Shape

Current `ApprovedRuntimeModel` can inform the new design, but it should not be reused unchanged.

Main reasons:

- it has no true approval semantics
- it has no fingerprint
- it is partly live-derived and partly persisted
- it does not carry canonical planning-chain data strongly enough
- Step 3 and Step 4 do not rely on it consistently

The rebuild should migrate to `ApprovedRuntimeContract` as the real source of truth.

---

## 14. Contract Design Exit Criteria

This contract design is ready for implementation only when all are accepted:

- [ ] the three-object model (`Input`, `ReviewResult`, `ApprovedRuntimeContract`) is accepted
- [ ] fingerprint-based invalidation is accepted
- [ ] Step 3 and Step 4 dependency rules are accepted
- [ ] the proposed component breakdown is accepted
- [ ] approval and stale-state semantics are accepted

---

## 15. Related Documents

- `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md`
- `docs/plans/2026-03-27-step2-rebuild-plan.md`
- `docs/rules/LOCKED_LOGIC.md`
