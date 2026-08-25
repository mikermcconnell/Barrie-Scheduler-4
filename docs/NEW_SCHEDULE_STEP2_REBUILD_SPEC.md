# New Schedule Wizard Step 2 Rebuild Spec

Status: Proposed  
Date: March 27, 2026  
Audience: Engineers working on the New Schedule wizard rebuild before implementation starts
Context entrypoint: `docs/new-schedule-step2/README.md`

---

## 1. Purpose

This document defines the clean-slate rebuild of **Step 2: Runtime Review** in the New Schedule wizard.

The goal is to replace the current Step 2 with a contract-first workflow that produces one trusted runtime model for downstream schedule building and generation.

Internal workflow note: Step 2 should not force a separate human decision gate. It may auto-approve the current review when the user continues, while still saving the same durable runtime contract for Step 3 and Step 4.

This is a pre-implementation spec. It defines the target behavior, architecture, boundaries, and edge-case handling that future code must satisfy.

For the proposed Step 2 object model, invalidation rules, and component breakdown, also read `docs/NEW_SCHEDULE_STEP2_CONTRACT_DESIGN.md`.

---

## 2. Problem Statement

The current Step 2 has valuable logic and test coverage, but the overall structure is not reliable enough to serve as the long-term foundation for the wizard.

Current issues:

- Step 2 presents itself as a gate, but the internal flow should be a safe review-and-continue workflow instead of a separate decision gate.
- The so-called approved runtime model is not captured as a durable contract clearly enough.
- Planning data and troubleshooting data are mixed together in one UI-heavy step.
- Important readiness logic lives partly in orchestration code and partly in view code.
- Canonical route-chain loading and Step 2 derivation happen in multiple places.
- Downstream steps depend on Step 2 outputs, but the Step 2 contract is not explicit enough.

Because this app is not live yet, the long-term solution is to rebuild Step 2 cleanly rather than continue patching the current structure.

---

## 3. Design Goals

The rebuilt Step 2 must:

1. Let the planner see the **P50 median travel time for each route segment by 30-minute time bucket**.
2. Let the planner inspect that data in route order using the approved planning chain.
3. Let the planner switch to P80 without changing median-based band membership.
4. Produce a **single approved runtime contract** for later steps.
5. Allow internal auto-approval on continue instead of requiring a separate decision gate.
6. Separate **planning truth** from **diagnostic/troubleshooting views**.
7. Use readiness rules to stop only genuinely blocked data from continuing.
8. Keep locked schedule logic intact.
9. Preserve the runtime-analysis edge cases already proven by tests.
10. Be understandable enough that future Step 2 work does not require reverse-engineering UI code.

---

## 4. Primary User Outcome

Step 2 must first succeed as an analysis tool.

The planner’s core job-to-be-done is:

> Import runtime data for a route and day type, then review the median travel time for each route segment across 30-minute time buckets in route order.

In practical terms, Step 2 must first answer:

- What is the median travel time for each segment?
- How does that change by half hour?
- Which buckets are complete and trustworthy?
- Which data should be excluded before schedule generation?

After that review is complete, Step 2 should save a valid runtime contract for later steps without adding an extra approval decision.

---

## 5. Non-Goals

This rebuild does **not** attempt to:

- redesign the entire New Schedule wizard
- change locked schedule generation rules
- redesign Step 3 schedule configuration behavior beyond its dependency on Step 2
- add broad new planning features unrelated to runtime review
- solve the broader 4-step vs 5-step product-flow naming mismatch in this pass

---

## 6. Core Analytic Acceptance Criteria

Step 2 must allow the planner to:

1. import runtime or performance data for a selected route and day type
2. see the route’s segments in planning order
3. see **P50 median travel time** for each segment by **30-minute bucket**
4. switch to **P80 reliable time** without changing median-based bands
5. see full bucket totals and segment-level breakdowns together
6. see incomplete or low-confidence buckets clearly flagged
7. exclude bad buckets from the planning model
8. save the reviewed runtime model for downstream steps

If the rebuild does not satisfy these analytic outcomes, it has not met the Step 2 goal even if the approval flow is clean.

---

## 7. Definition of Success

Step 2 is successful only when the planner leaves the step with a **generation-ready runtime model saved as an approved contract**.

That means all of the following are true:

1. The route, day type, and import mode are known.
2. The canonical route chain for planning is resolved, or the system has clearly determined why it cannot be resolved.
3. Runtime evidence has been analyzed into buckets, bands, and direction summaries.
4. Bucket health is known:
   - complete vs incomplete
   - confidence level
   - route-chain match status
   - source quality
5. The planner can review and intentionally exclude bad buckets.
6. The system can determine whether the step is:
   - blocked
   - warning
   - ready
7. The current runtime model is approved automatically as part of continuing when it is not blocked.
8. Step 3 and Step 4 consume only the approved runtime model, not ad hoc re-derived substitutes.

Short version:

> Step 2 succeeds when it produces one trusted runtime contract that downstream steps can use without re-deriving or second-guessing it.

---

## 8. Step 2 Product Role

Step 2 is the wizard’s **runtime contract review**.

It is not just an analysis dashboard. It is the point where the system turns imported runtime evidence into a reviewed planning model.

Upstream:

- Step 1 chooses the source data and route/day scope.

Downstream:

- Step 3 configures service using the approved Step 2 model.
- Step 4 generates and edits the schedule from that approved model.

If Step 2 is weak, every later step inherits ambiguity.

---

## 9. Planner Workflow

The rebuilt Step 2 flow must follow this sequence.

### 9.1 Enter Step 2

Inputs arrive from Step 1:

- import mode: `csv` or `performance`
- route selection
- day type
- parsed runtime data or computed performance runtime data
- performance diagnostics when applicable

### 9.2 Resolve Planning Route Chain

The system determines the canonical planning chain.

Priority:

1. current route’s master schedule chain, when safe and valid
2. runtime-derived route chain fallback, when master chain is unavailable or unsafe

Rules:

- bidirectional routes require both directions for a canonical master-derived planning chain
- loop routes may use one-sided chains
- stale canonical data from another route must never be reused

### 9.3 Build Runtime Review Result

The system computes:

- runtime buckets
- bucket totals
- observed cycle totals when available
- banding
- direction summaries
- coverage and confidence
- health status
- troubleshooting dataset

### 9.4 Planner Review

The planner can:

- inspect data health
- inspect bucket chart and detailed table
- inspect band summary
- inspect troubleshooting matrix
- exclude or restore buckets from the planning model

### 9.5 Contract Approval

For this internal tool, approval is a contract-saving step, not a separate decision gate.

Continuing from Step 2 may create or replace the persisted runtime contract snapshot automatically when readiness is not blocked.

### 9.6 Continue

The wizard may continue once the runtime contract is valid for the current Step 1 inputs and readiness is not blocked.

---

## 10. State Model

The rebuilt Step 2 must use explicit state rather than implicit UI conditions.

### 10.1 Review Lifecycle State

- `idle` — Step 2 has not been entered yet
- `building` — runtime review is being constructed
- `reviewable` — review data exists and can be inspected
- `stale` — Step 2 data exists but has been invalidated by upstream changes
- `error` — runtime review could not be built

### 10.2 Readiness State

- `blocked`
- `warning`
- `ready`

### 10.3 Approval State

- `unapproved`
- `approved`

### 10.4 Continue Rule

The step may continue only when:

- lifecycle state is `reviewable`
- readiness state is `ready` or `warning`
- the current review can produce an approved contract for the current Step 1 inputs

If readiness is `warning`, continue is still allowed, but the warning reasons must stay visible in Step 2 health/review surfaces and be captured in the approved contract snapshot.

If readiness is `blocked`, continue is unavailable.

---

## 11. Domain Boundaries

The rebuild must separate Step 2 into three clear domains.

### 11.1 Runtime Review Domain

Owns planning truth:

- canonical segment columns
- route-chain matching
- bucket calculations
- banding
- health evaluation
- approved runtime artifact creation

This domain must be pure or near-pure and testable without React.

### 11.2 Troubleshooting Domain

Owns diagnostic surfaces:

- fine stop-to-stop matrix
- fallback warnings
- diagnostic path explanations

This domain helps the planner understand issues but does not define the approved planning contract.

### 11.3 Step 2 UI Domain

Owns:

- presenting the review result
- handling planner actions
- approval interaction
- navigation gating

The UI should orchestrate, not invent business rules.

---

## 12. Inputs and Outputs

## 12.1 Step 2 Inputs

The runtime review builder must accept a structured input object containing:

- route number / route identity
- day type
- import mode
- parsed runtime data
- performance diagnostics when applicable
- canonical direction stops if available
- planner bucket overrides

Planner overrides are limited in v1 to:

- exclude bucket
- restore bucket

## 12.2 Step 2 Outputs

The builder must produce a `RuntimeReviewResult`.

Minimum contents:

- canonical planning segment columns
- planning buckets
- bands
- direction band summary
- health report
- troubleshooting dataset
- readiness status
- approval eligibility

Continuing from Step 2 must produce an `ApprovedRuntimeContract` when the current review is not blocked.

---

## 13. Approved Runtime Contract

The approved contract is the only Step 2 artifact that later steps may trust.

Minimum fields:

- route identity
- route number
- day type
- import mode
- source provenance
- chart basis
- canonical segment columns
- approved buckets
- approved bands
- direction band summary
- health snapshot
- readiness status at approval time
- approval timestamp
- approval version / schema version

The contract must be treated as:

- a persisted snapshot
- invalidatable when Step 1 inputs change
- the sole runtime source for Step 3 and Step 4

---

## 14. Readiness Rules

## 14.1 Blocked

Blocked means the planner cannot continue.

Blocked conditions include:

- no runtime analysis buckets built
- no matching performance days found for the selected scope
- missing expected directions for bidirectional planning
- zero complete cycle buckets
- no usable route-chain match for planning

## 14.2 Warning

Warning means approval is allowed, but the warning reasons must remain visible and traceable in the saved approval.

Warning examples:

- legacy runtime logic import
- legacy pre-fix history excluded by the clean-history cutoff
- low-confidence buckets exist
- fallback runtime source is in use
- unmatched segments exist outside the approved planning subset
- estimated repaired buckets are present
- boundary-service buckets remain excluded from normal banding

## 14.3 Ready

Ready means:

- the route chain is valid for planning
- at least one complete usable bucket exists
- usable bands exist
- no blocking data-health issues remain

---

## 15. Planner Actions

The rebuilt Step 2 supports these planner actions in v1:

1. Exclude bucket
2. Restore bucket
3. Expand bucket details
4. Switch displayed metric between P50 and P80
5. Switch between planning summary and troubleshooting view
6. Approve runtime contract
7. Replace approval after changes
8. Review whether a bucket is fully observed, boundary-service, internally broken, fragmented, or estimated-repaired

Not in v1:

- manual band reassignment
- direct segment-time editing inside Step 2
- freeform planner notes on individual buckets

Those can be added later if still needed.

---

## 16. Metric Rules

The rebuilt Step 2 must preserve the currently established runtime rules.

### 16.1 Chart Basis

- Performance imports prefer full observed cycle totals when day-level cycle evidence exists.
- CSV imports use uploaded bucket totals.

### 16.2 Banding Basis

- Band assignment is based on median/P50 bucket totals.
- P80 view changes displayed values only.
- P80 view does not change band membership or colors.

### 16.3 Coverage Rule

- Incomplete buckets remain visible.
- Incomplete buckets are unbanded.
- Incomplete buckets do not contribute to band averages, legend averages, direction summaries, or approved generation inputs.
- Step 2 should classify incomplete buckets so planners can distinguish:
  - boundary-service / short-turn buckets
  - isolated single-gap buckets
  - internal cycle gaps
  - fragmented coverage gaps
- Boundary-service and fragmented buckets should stay visible but remain excluded from banding by default.
- Step 2 may apply a limited estimated repair when a bucket has a very small internal gap and the missing segment(s) are present in the nearest complete buckets on both sides.
- Any repaired bucket must remain visibly marked as estimated in both Data Health and bucket review details.

### 16.4 Confidence Rule

- Performance imports use the 5-day threshold.
- For bidirectional performance data, North-start and South-start cycles are displayed, excluded, and evaluated independently. Opposite legs must preserve terminal continuity where the evidence exposes it and must hand off within 30 minutes. Each approved 30-minute start bucket must have five distinct complete same-day cycles. Generation uses the exact approved bucket when available and otherwise the nearest eligible approved bucket from the same start orientation.
- CSV imports use the 10-observation threshold and require positive finite P50/P80 values for every planning segment.

### 16.5 Locked Logic Rule

Segment totals must continue to respect locked rounding and all other locked logic constraints documented in `docs/rules/LOCKED_LOGIC.md`.

---

## 17. Troubleshooting View Rules

The troubleshooting view exists to explain the evidence, not to define planning truth.

Rules:

- it should follow the full route path in bus order when a valid path can be confirmed
- it may use finer stop-to-stop legs than the planning chain
- it must not quietly present partial or short-turn patterns as the main route path
- when a valid full troubleshooting path cannot be confirmed, the troubleshooting table is replaced with a warning state

Troubleshooting data must be modeled separately from the approved planning contract.

---

## 18. Edge Cases the Rebuild Must Handle

The rebuild must explicitly support these cases.

### 18.1 Route and Direction Cases

- base-route selection should match suffix-as-direction routes like `2`, `7`, and `12`
- explicit variant selections like `12A` should remain exact-match
- blank raw directions may still be inferred from trip names where safe
- one-sided master tables for bidirectional routes are unsafe
- loop routes may remain one-sided

### 18.2 Coverage Cases

- one direction missing entirely
- some segments never matched to the canonical chain
- zero complete cycle buckets
- different bucket availability by direction
- partial-day evidence that must not count as complete cycles

### 18.3 Runtime Source Cases

- stop-level data present
- trip-leg fallback only
- coarse fallback only
- mixed-source imports
- legacy runtime logic metadata
- clean-history cutoff excluding older legacy days

### 18.4 Barrie-Specific Matching Cases

- stop-name alias drift across hubs and terminals
- Route 7 handoff bridge between outbound end and return start
- non-contiguous or branched stop-index graphs
- fine stop-level legs that must be rebuilt onto canonical master-stop legs

### 18.5 Wizard State Cases

- resume saved project
- stale approved contract after Step 1 changes
- planner excludes enough buckets that approval becomes impossible
- Step 2 contract exists but no longer matches current Step 1 scope

---

## 19. Proposed Module Shape

The rebuild should keep a modular-monolith shape inside the existing app.

Recommended boundaries:

### 19.1 Review Builder

Example responsibility:

- build the full Step 2 runtime review result from Step 1 inputs

Likely file area:

- `components/NewSchedule/utils/` or `utils/new-schedule/`

### 19.2 Health Evaluator

Example responsibility:

- determine readiness status
- list blockers and warnings
- determine approval eligibility

### 19.3 Approval Contract Builder

Example responsibility:

- convert current review result plus planner overrides into the persisted approved contract

### 19.4 Step 2 Screen Components

Example responsibility:

- data health panel
- bucket chart/table
- troubleshooting panel
- approval footer

### 19.5 Navigation Gate

Example responsibility:

- prevent Step 3 entry unless approved contract is valid

This boundary may remain in `NewScheduleWizard.tsx`, but it must consume explicit Step 2 state rather than infer readiness from loose conditions.

---

## 20. Persistence Rules

The approved runtime contract must be persisted both locally and in project saves.

Rules:

- save the latest approved contract snapshot
- restore it on resume
- validate that it still matches the current Step 1 inputs
- invalidate it if route, day type, import mode, or source review inputs change materially

Restoring an old contract without revalidation is not allowed.

---

## 21. UX Requirements

The Step 2 UI must make these points obvious:

1. whether the route is blocked, warning, or ready
2. why it has that status
3. what the planner can do to resolve issues
4. what buckets are excluded from planning
5. whether the planner has approved the model
6. whether later steps are using the approved model or are waiting for approval

The step footer should carry the primary action.

Recommended footer actions:

- `Back`
- `Continue to Step 3`

The Continue action should create or replace the approved runtime contract when the current review is ready or warning, and should remain disabled only when the review is blocked or missing.
The in-page Step 2 approval strip is not required for this internal tool; warnings should be communicated through Data Health / review content instead of a duplicate acknowledgement banner.

---

## 22. Testing Requirements

The rebuild must be test-led.

Minimum test layers:

### 22.1 Pure Domain Tests

- review builder
- health evaluator
- approval builder
- invalidation logic

### 22.2 UI Integration Tests

- blocked state disables continue
- warning state can continue without a separate acknowledgement control
- continue creates or refreshes the approved contract
- changing Step 1 inputs invalidates approval
- troubleshooting fallback state renders correctly

### 22.3 Wizard Flow Tests

- Step 3 cannot proceed without a valid runtime contract
- Step 4 consumes only the approved contract
- resume correctly restores or invalidates approval

---

## 23. Acceptance Checklist

The Step 2 rebuild is not done until all are true:

- [ ] Step 2 has an explicit runtime review state model
- [ ] Step 2 auto-approves the current contract on continue for this internal workflow
- [ ] `blocked` truly prevents progress
- [ ] `warning` remains continuable while warning reasons stay visible and persisted in the contract snapshot
- [ ] Step 3 depends on the approved contract only
- [ ] Step 4 depends on the approved contract only
- [ ] troubleshooting data is separated from the planning contract
- [ ] canonical route-chain resolution happens in one clear place
- [ ] stale approval invalidation is implemented
- [ ] save/resume behavior preserves and revalidates approval
- [ ] Step 2 domain logic is testable without React
- [ ] existing proven edge cases remain covered

---

## 24. Implementation Direction

This spec intentionally recommends a **full Step 2 architecture restart**, but not a reckless rewrite of unrelated wizard functionality.

Preserve:

- locked runtime and schedule logic
- canonical matching rules already proven by tests
- performance runtime edge-case handling already established in current code

Rebuild:

- Step 2 contract
- Step 2 state machine
- Step 2 gating behavior
- Step 2 approval flow
- Step 2 UI composition

---

## 25. Related Source Areas

Current files most relevant to the rebuild:

- `components/NewSchedule/NewScheduleWizard.tsx`
- `components/NewSchedule/steps/Step2Analysis.tsx`
- `components/NewSchedule/utils/wizardState.ts`
- `components/NewSchedule/utils/wizardProjectState.ts`
- `utils/ai/runtimeAnalysis.ts`
- `utils/performanceRuntimeComputer.ts`
- `utils/runtimeSegmentMatching.ts`
- `components/NewSchedule/steps/Step3Build.tsx`
- `components/NewSchedule/steps/Step4Schedule.tsx`

Related durable docs:

- `docs/new-schedule-step2/README.md`
- `docs/rules/LOCKED_LOGIC.md`
- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `ORCHESTRATOR.md`
