# Architecture Cleanup Plan

> Date: April 10, 2026
> Status: In progress
> Scope: Current structural cleanup priorities identified from the April 2026 systems design review
> Purpose: Persist the architecture cleanup plan, implementation sequence, and progress tracker beyond this chat session

## Why this exists

This file turns the recent systems design review into a trackable execution plan.

It is meant to answer three questions:

1. What should we clean up first?
2. In what order should we implement the cleanup?
3. How do we track progress as the work moves forward?

This is a planning and execution document, not a durable source-of-truth architecture file.
When durable outcomes ship, update the relevant Tier 1 or Tier 2 docs as well:

- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`
- `docs/rules/LOCKED_LOGIC.md` if behavior changes
- `ORCHESTRATOR.md`

---

## Executive summary

The current changes are moving the repo in a better direction overall, but there are still a few structural risks that should be cleaned up before they grow:

1. **Schedule editing has two production-adjacent logic paths** (`ScheduleEditor.tsx` vs `useScheduleEditing.ts`), which creates a high risk of runtime vs tested behavior drift.
2. **Performance snapshot shaping is duplicated across app and Functions**, so overview/report artifacts can drift by runtime.
3. **Optimize logic is centralized but still lives in an awkward shared location and mixes too many responsibilities**.
4. **Add Trip is better centralized, but `addTripPlanner.ts` is growing into a large multi-responsibility module**.
5. **Step 3 route defaults are useful, but the policy currently lives too close to the UI layer**.
6. **The Add Trip modal now depends on broader editor/workspace UI than it should**, which increases coupling and maintenance cost.

---

## Cleanup priorities

### Priority 0 — unify live schedule editing behind one runtime path

**Why first**

This is the highest-risk issue because it affects fragile schedule behavior and can create a mismatch between tested logic and real editor behavior.

**Current problem**

- `components/ScheduleEditor.tsx` still owns live edit and recovery logic.
- `hooks/useScheduleEditing.ts` contains newer behavior, including updated trip recalculation and non-propagating terminal recovery edits.
- The hook is tested, but the editor is still using its own path.

**Target outcome**

- One production editing path for cell edits, recovery edits, trip mutation behavior, and block reassignment triggers.
- Tests validate the same logic path the app actually runs.

**Success criteria**

- `ScheduleEditor.tsx` no longer owns separate schedule-editing business rules.
- `useScheduleEditing.ts` or an extracted domain module becomes the single runtime owner.
- Existing editor behavior is verified against locked logic and regression tests.

---

### Priority 1 — centralize performance artifact shaping

**Why second**

This is the biggest cross-runtime maintenance risk after schedule editing.

**Current problem**

The same overview/report summary shaping exists in more than one place:

- `utils/performanceOverviewSummary.ts`
- `functions/src/index.ts`

The same metadata contract also exists in more than one place:

- `utils/performanceDataTypes.ts`
- `functions/src/types.ts`

There are also multiple writers producing the same storage family:

- browser/app save flow
- ingest
- rebuild
- backfill

**Target outcome**

- One shared summary-shaping implementation for overview/report artifacts.
- Clear ownership of the performance storage contract.
- Lower risk of dashboard/report differences by write path.

**Success criteria**

- Overview/report summary shaping comes from one shared implementation.
- `reportStoragePath` and related metadata are governed by one shared contract.
- App and Functions stop carrying hand-maintained parallel logic where practical.

---

### Priority 2 — move optimize core to a neutral server-shared boundary

**Why third**

The optimize refactor is directionally good, but the current placement still blurs boundaries.

**Current problem**

- `utils/ai/optimizeCore.ts` is really server runtime code.
- `api/optimize.ts` and `functions/src/optimize.ts` are thinner now, but they still duplicate some request parsing and error mapping.
- `api/optimize.ts` depends on pipeline policy currently located under `functions/src/`.

**Target outcome**

- Both API and Functions depend on a neutral shared server module.
- No runtime layer imports from another runtime layer.
- Optimize orchestration is easier to reason about and extend.

**Success criteria**

- Shared optimize runtime code lives in a neutral server-shared location.
- Policy/config helpers used by both runtimes also live there.
- Runtime wrappers are clearly adapters, not partial owners of the workflow.

---

### Priority 3 — split `addTripPlanner.ts` by responsibility

**Why fourth**

The Add Trip flow is improved, but the central planner file is growing quickly and will become hard to change safely.

**Current problem**

`utils/schedule/addTripPlanner.ts` now owns:

- presets and defaults
- directional stop mapping
- preview construction
- block conflict detection
- continuity-gap handling
- mutation/apply behavior
- impact summary shaping

That is too much for one file in a fragile scheduling domain.

**Target outcome**

Break the feature into smaller modules with clearer ownership.

**Suggested split**

- input/default resolution
- preview builder
- block/continuity analysis
- apply/mutation logic
- shared types

**Success criteria**

- `addTripPlanner.ts` is reduced or replaced by focused modules.
- Modal and hook orchestration depend on a clear public surface.
- New Add Trip work no longer defaults to one giant file.

---

### Priority 4 — move Step 3 route defaults into domain/config ownership

**Why fifth**

This is lower risk than the items above, but still worth cleaning up before more route-specific policy accumulates.

**Current problem**

- `components/NewSchedule/utils/step3RouteDefaults.ts` stores route-specific scheduling defaults near the UI.
- `Step3Build.tsx` applies policy through component effects.

**Target outcome**

- Route-default policy lives in a shared schedule/config domain area.
- UI reads and applies policy; it does not own it.

**Success criteria**

- Route default definitions live outside the component area.
- The policy can be reused elsewhere if needed.
- Step 3 remains focused on UI and orchestration.

---

### Priority 5 — reduce Add Trip modal coupling to workspace/editor shell

**Why sixth**

This is the lowest immediate risk, but it will matter more as the editor grows.

**Current problem**

- `AddTripSchedulePreview.tsx` depends on broad editor-facing UI components.
- The modal effectively mounts a mini schedule editor/workspace shell.
- Some grouping and routing logic is duplicated instead of coming from a shared read-only adapter.

**Target outcome**

- The modal uses a lighter read-only preview composition layer.
- Shared route/day grouping logic is reused instead of copied.

**Success criteria**

- The modal preview depends on a narrow read-only preview interface.
- Workspace chrome is not required to render an Add Trip preview.
- Shared route grouping logic has one owner.

---

## Recommended implementation sequence

### Phase 1 — protect the highest-risk scheduling behavior

**Goal**

Unify schedule editing so production runtime behavior and tested behavior match.

**Scope**

- Schedule editor edit/recovery ownership
- runtime vs tested path alignment
- regression coverage for locked schedule behavior touched by the refactor

**Do not expand this phase into**

- Add Trip module decomposition
- broader editor UI cleanup
- Step 3 policy relocation

**Exit criteria**

- one runtime editing path
- passing targeted tests
- manual verification for edit, recovery, and block reassignment behavior

---

### Phase 2 — remove cross-runtime performance artifact drift

**Goal**

Make overview/report artifact shaping come from one shared implementation.

**Scope**

- overview/report summary builders
- metadata contract alignment
- ingest/rebuild/backfill/manual-save consistency

**Do not expand this phase into**

- redesigning the full performance subsystem
- changing dashboard UX
- broad analytics schema changes

**Exit criteria**

- one artifact shaping path
- one clear metadata contract
- verification that all writers produce matching artifact families

---

### Phase 3 — clean up optimize boundaries

**Goal**

Move optimize runtime logic to a neutral shared server boundary and reduce wrapper duplication.

**Scope**

- optimize core location
- pipeline policy location
- adapter simplification
- internal module split if it can be done safely in the same phase

**Do not expand this phase into**

- a full AI subsystem redesign
- model/provider abstraction for its own sake

**Exit criteria**

- neutral shared optimize module ownership
- no awkward runtime-to-runtime imports
- clearer separation between transport, policy, scoring, and orchestration where practical

---

### Phase 4 — reduce growth pressure in Add Trip

**Goal**

Split Add Trip planning into smaller modules without changing planner-facing behavior.

**Scope**

- `addTripPlanner` decomposition
- cleaner public surface for modal/hook usage
- preserve shared preview/apply logic path

**Do not expand this phase into**

- redesigning Add Trip UX
- changing scheduling rules unless explicitly approved

**Exit criteria**

- smaller modules with clear ownership
- preserved behavior and test coverage
- easier future extension for Add Trip rules

---

### Phase 5 — move route policy and simplify preview coupling

**Goal**

Finish lower-risk structural cleanup that improves long-term maintainability.

**Scope**

- Step 3 route defaults relocation
- Add Trip preview boundary cleanup
- route/day grouping reuse where practical

**Exit criteria**

- route policy owned outside UI
- lighter modal preview dependency surface
- reduced duplication in preview composition

---

## Progress tracker

### Overall status board

| Workstream | Priority | Status | Owner | Notes |
|---|---:|---|---|---|
| Unify schedule editing runtime path | P0 | In progress |  | Inline edit/recovery/time-adjust path now routed through `useScheduleEditing`; delete/duplicate/direction still local |
| Centralize performance artifact shaping | P1 | Not started |  | Biggest cross-runtime contract risk |
| Move optimize core to neutral shared boundary | P2 | Not started |  | Good refactor already started |
| Split `addTripPlanner` by responsibility | P3 | Not started |  | Growing module risk |
| Move Step 3 route defaults to domain/config layer | P4 | Not started |  | Useful but lower urgency |
| Reduce Add Trip modal/editor-shell coupling | P5 | Not started |  | Long-term cleanup |

### Phase tracker

| Phase | Goal | Status | Start date | End date | Notes |
|---|---|---|---|---|---|
| 1 | Unify schedule editing path | In progress | 2026-04-10 |  | Inline edit/recovery/time-adjust wiring completed; follow-up still needed for delete/duplicate/direction ownership |
| 2 | Centralize performance artifact shaping | Not started |  |  |  |
| 3 | Clean up optimize boundaries | Not started |  |  |  |
| 4 | Split Add Trip planning modules | Not started |  |  |  |
| 5 | Move route policy and simplify preview coupling | Not started |  |  |  |

### Milestone checklist

- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete

---

## Working rules for this cleanup

### 1. Protect locked logic first

If a cleanup touches:

- `utils/schedule/scheduleGenerator.ts`
- `utils/blocks/blockAssignmentCore.ts`
- `utils/timeUtils.ts`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`

then verification must be stronger than a normal refactor.

### 2. Prefer moving logic before rewriting logic

If the goal is structural cleanup, first improve ownership and boundaries without changing behavior unless a behavior fix is explicitly part of scope.

### 3. Keep runtime adapters thin

- UI should orchestrate and display.
- hooks should orchestrate, not become domain dumping grounds.
- domain modules should own business rules.
- API and Functions should act as runtime adapters over shared server logic.

### 4. Update durable docs only when durable reality changes

When a phase ships, update the right durable file:

- `docs/ARCHITECTURE.md` for module ownership/data flow changes
- `docs/SCHEMA.md` for storage/metadata changes
- `ORCHESTRATOR.md` for lasting repo memory

---

## Verification plan by phase

### Phase 1 verification

- targeted tests for schedule editing behavior
- manual edit/recovery regression checks
- block reassignment sanity checks
- confirm locked logic remains intact

### Phase 2 verification

- compare artifact outputs across manual save, ingest, rebuild, and backfill paths
- verify metadata parity
- verify daily report still reads the expected artifact

### Phase 3 verification

- optimize handler tests
- optimize shared-core tests
- local dev path still delegates correctly
- Functions path still runs correctly

### Phase 4 verification

- Add Trip modal tests
- Add Trip planner tests
- manual same-block, full-cycle, and continuity-gap checks

### Phase 5 verification

- Step 3 route-default tests
- Add Trip preview smoke checks
- confirm no behavior drift from policy relocation

---

## Session log

Use this section to append progress over time.

### 2026-04-10

- Created the initial architecture cleanup plan from the systems design review.
- Initial priority order set to: editing path -> performance artifacts -> optimize boundaries -> Add Trip split -> Step 3 policy -> preview coupling.
- Started Phase 1.
- `ScheduleEditor.tsx` now routes inline cell edits, recovery edits, and +/- time nudges through `hooks/useScheduleEditing.ts`.
- Targeted verification passed:
  - `tests/useScheduleEditing.test.tsx`
  - `tests/ScheduleEditor.integration.test.tsx`
  - `tests/ScheduleEditor.interactions.test.tsx`
  - `npm run build`

---

## Next recommended action

Start with **Phase 1: unify the live schedule editing path**.

That gives the best risk reduction because it addresses the area most likely to create a mismatch between production behavior and the behavior covered by tests.
