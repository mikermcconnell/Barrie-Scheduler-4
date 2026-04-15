# Connections Simplification Plan

> Date: April 10, 2026
> Status: Phase 2 in progress
> Scope: Simplify the fixed-route Connections experience without breaking the existing data model or optimization engine
> Audience: Product, design, and implementation work for Scheduler 4

## Why this plan exists

The current Connections feature is powerful, but it exposes too much of the underlying data model to the user.

Today, planners often have to think about:

- library targets
- manual vs route targets
- stop codes
- route assignment
- connection type (`meet_departing` / `feed_arriving`)
- buffers
- time lists
- GTFS import paths

That is more complexity than most route-level setup tasks should require.

This plan proposes a phased rollout that keeps the current backend model in place while making the planner-facing workflow much simpler.

---

## Product goal

Make Connections feel like this:

> “What should this route connect to?”

Instead of this:

> “Create and manage connection targets, stop codes, time entries, route configs, and event types.”

---

## Current pain points

Based on the current code and feature docs, the main friction points are:

1. **The library model is too visible too early**
   - `components/connections/ConnectionsPanel.tsx`
   - `components/NewSchedule/connections/ConnectionLibraryPanel.tsx`
   - `components/NewSchedule/connections/AddTargetModal.tsx`

2. **The feature is organized around technical types instead of planner intent**
   - `manual` vs `route`
   - `meet_departing` vs `feed_arriving`

3. **Stop-code thinking leaks into the main workflow**
   - The current model is correctly stop-code based, but the UI often makes that internal detail too visible.

4. **There are too many entry paths**
   - manual add
   - quick templates
   - GTFS import
   - route import
   - library edit

5. **The route-level setup is weaker than the library-level setup**
   - A planner usually wants to configure a route goal, but the UI currently feels more library-first.

---

## Design principles for simplification

### 1. Route-first, library-second
The route editor should be the primary place where planners create and manage connection goals.
The shared library should remain important, but mostly as an implementation detail or advanced/admin surface.

### 2. Phrase everything in planner language
Prefer:
- “arrive before departure”
- “leave after arrival”
- “connect to GO departures”
- “connect with Route 8B at Downtown”

Avoid exposing internal wording unless needed.

### 3. Hide technical fields until needed
Stop codes, source schedule timestamps, target type, and advanced timing overrides should not be first-line fields.

### 4. Use guided flows for common tasks
GO, school bells, route-to-route, and custom events should each have a tailored flow instead of forcing one generic form.

### 5. Preserve the existing model under the hood where possible
This simplification plan assumes we keep the existing `ConnectionLibrary`, `ConnectionTarget`, and `RouteConnectionConfig` model initially, and improve UX first.

---

## Target UX model

## Main mental model

Each route should have a simple list of **connection goals**.

Examples:
- Connect to GO departures at Allandale, 5 min before
- Connect from GO arrivals at Allandale, 3 min after
- Connect to Georgian bells at Georgian College, 5 min before
- Connect with Route 8B at Downtown, 4 min transfer

Each item should appear as one readable card in the route editor.

## Basic card shape

- **Target**: GO departures
- **Place**: Allandale Waterfront GO
- **Rule**: Bus arrives 5 min before departure
- **Applies**: Weekday
- **Status**: Active

Advanced details stay hidden unless expanded.

---

## Proposed phased implementation

## Phase 1 — simplify language and defaults without changing structure

### Goal
Reduce cognitive load immediately while keeping the current architecture and screens mostly intact.

### What changes

1. **Rename planner-facing language**
   - Replace `meet_departing` / `feed_arriving` in the UI with plain-language labels
   - Add one-sentence explanations anywhere the concept appears

2. **Hide stop codes from the default route-level workflow**
   - Show stop names/place names first
   - Keep stop code in advanced details or validation messages only

3. **Improve Add chooser wording**
   - Reframe options by planner intent:
     - GO / rail
     - School / bell times
     - Another bus route
     - Custom event
   - Keep existing template/import plumbing underneath

4. **Add stronger defaults**
   - Auto-select likely stops where possible
   - Pre-fill default timing rules by template type
   - Pre-fill day type from the current route/day context

5. **Make the route-level config read like a sentence**
   - Update `RouteConnectionPanel.tsx` display text so each connection is easier to scan and understand

### Likely files

- `components/NewSchedule/connections/ConnectionAddChooser.tsx`
- `components/NewSchedule/connections/AddTargetModal.tsx`
- `components/NewSchedule/connections/RouteConnectionPanel.tsx`
- `utils/connections/connectionTypes.ts` only if display helpers are added; avoid contract churn if possible

### Success criteria

- A first-time planner can understand the connection type without knowing internal terminology
- The default add flow feels shorter and less technical
- The route connection list reads as plain-language rules

### Risk
Low. Mostly copy, labeling, defaults, and light interaction changes.

---

## Phase 2 — create a route-first “Add connection goal” flow

### Goal
Make route setup the primary UX instead of library management.

### What changes

1. **Route editor becomes the main entry point**
   - Add a simpler route-level “Add connection” action that starts from planner intent

2. **Introduce guided mini-flows by connection type**
   - GO / rail flow
   - school / bell flow
   - route-to-route flow
   - custom event flow

3. **Create-and-assign in one action**
   - When the user creates a connection from the route screen, the system should:
     - create or reuse the underlying library target
     - attach it to the route immediately
   - This should feel like one step to the user

4. **Add a live preview before save**
   - Show which target times/events will be used
   - Show the route-side stop and timing rule in plain language

### Likely files

- `components/connections/ConnectionsPanel.tsx`
- `components/NewSchedule/connections/ConnectionAddChooser.tsx`
- `components/NewSchedule/connections/AddTargetModal.tsx` or a new route-first wizard/modal
- `components/NewSchedule/connections/RouteConnectionPanel.tsx`
- `utils/connections/connectionLibraryUtils.ts`
- `utils/connections/connectionLibraryService.ts` only as needed for create-or-reuse helper paths

### Success criteria

- A planner can add a GO or school connection from the route screen without visiting the library screen first
- The planner does not have to think about target creation vs route assignment as separate steps
- The route-level preview is understandable before save

### Risk
Medium. This changes the user flow, but can still preserve the current model underneath.

---

## Phase 3 — move full library management into an advanced/admin path

### Goal
Keep the shared library powerful without making it the default UX for everyone.

### What changes

1. **Demote library management from the main route workflow**
   - Route editor shows route connection goals first
   - Full library panel becomes:
     - “Manage shared library”
     - “Advanced”
     - or a separate admin panel

2. **Split library use cases**
   - common route setup
   - template import
   - duplicate cleanup
   - global naming maintenance
   - route-target resync and diagnostics

3. **Add clearer maintenance tools**
   - identify targets not used by any route
   - identify targets whose stops do not match loaded schedules
   - identify stale route-derived targets

### Likely files

- `components/connections/ConnectionsPanel.tsx`
- `components/NewSchedule/connections/ConnectionLibraryPanel.tsx`
- `utils/connections/connectionLibraryUtils.ts`

### Success criteria

- Most route planners rarely need the full library manager
- The library manager feels like maintenance/admin, not the main setup flow
- Advanced users still have access to full power

### Risk
Medium. Mostly IA and screen restructuring.

---

## Phase 4 — simplify the underlying model surface exposed to the UI

### Goal
Reduce repeated translation between the domain model and the planner-facing UX.

### What changes

1. **Introduce a route-facing view model**
   - Create a thin presenter/adapter layer that converts:
     - `ConnectionTarget`
     - `RouteConnection`
   - into a planner-facing “ConnectionGoalViewModel”

2. **Centralize plain-language phrasing and preview text**
   - One place to build the human-readable sentence:
     - “Bus arrives 5 min before GO departure at Allandale”

3. **Consolidate default rules**
   - One place for:
     - default stop suggestion rules
     - default before/after behavior
     - default day-type assumptions
     - template-specific setup defaults

### Likely files

- new `utils/connections/*viewModel*` or `*presenter*` module
- `utils/connections/connectionTypes.ts` only if a new UI-facing type is added
- route-level Connections components

### Success criteria

- The UI is not repeatedly rebuilding planner-facing language from low-level fields
- Common defaults are defined in one place
- Future simplification work gets easier instead of harder

### Risk
Medium. This is structural cleanup rather than just UX polish.

---

## Phase 5 — optional deeper product cleanup

### Goal
If needed later, evolve the product from “targets + route config” toward a more explicit “connection goals” product model.

### What changes

Potential future shift:
- planner-facing primary object becomes a `ConnectionGoal`
- library targets remain a reusable shared resource underneath or become more lightweight

This is **not** recommended as the starting phase. It should happen only if the earlier phases still leave too much UX friction.

### Success criteria

- The planner-facing model matches the actual mental model directly
- The internal architecture remains maintainable

### Risk
High. This would likely touch broader storage, service, and optimization assumptions.

---

## Recommended rollout order

### Recommended now

1. **Phase 1** — simplify language and defaults
2. **Phase 2** — route-first add flow with preview
3. **Phase 3** — move library management to advanced/admin
4. **Phase 4** — add route-facing view-model layer
5. **Phase 5** — only if needed later

### Why this order

- It gives immediate UX improvement with low risk first
- It validates the product direction before deeper structural change
- It preserves the current connection data model while the simpler UX is proven

---

## Implementation notes by current component

## `ConnectionsPanel.tsx`

### Current role
Acts as a mixed controller for:
- loading/saving library
- route-target derivation
- modal orchestration
- syncing panel state back to `ScheduleEditor`

### Direction
Over time, this should become more of a route-level workflow shell, with the full library manager de-emphasized.

---

## `ConnectionAddChooser.tsx`

### Current role
A chooser for:
- quick templates
- manual entry
- GTFS import

### Direction
This is the best place to start the UX simplification.
Refocus it around planner intent and make it the entry to the simplified route-first flow.

---

## `AddTargetModal.tsx`

### Current role
A powerful generic target editor with many advanced fields.

### Direction
Keep it for advanced/manual cases, but do not make it the primary experience for common GO / bell / route-to-route setup.

---

## `ConnectionLibraryPanel.tsx`

### Current role
Full shared library manager.

### Direction
Keep it, but move it out of the default path in later phases.
Treat it as management/maintenance, not the main route setup surface.

---

## `RouteConnectionPanel.tsx`

### Current role
Per-route connection configuration.

### Direction
This should become the primary planner-facing surface.
It should read like a list of connection goals, not raw config rows.

---

## What not to do first

- Do **not** start by redesigning the storage model
- Do **not** collapse `ConnectionTarget` and `RouteConnectionConfig` immediately
- Do **not** start with a large backend refactor before validating the simplified route-first UX
- Do **not** force all users through full library management when most only want to configure route-level goals

---

## Suggested verification per phase

### Phase 1
- manual smoke test for adding a common connection
- confirm stop selection still resolves valid stop codes
- confirm wording updates do not break existing config behavior

### Phase 2
- verify create-and-assign works end to end
- verify preview matches saved route config
- verify route-level setup works without visiting full library manager

### Phase 3
- verify advanced/library management still supports editing and import workflows
- verify route editor still reflects library changes correctly

### Phase 4
- unit-test the view-model/presenter layer
- verify sentence rendering and defaults stay consistent across screens

---

## Progress tracker

| Phase | Goal | Status | Notes |
|---|---|---|---|
| 1 | Simplify language and defaults | Complete | Planner-facing wording updated, route add form now auto-suggests matching stops, custom connection modal auto-selects the only available stop, and Step 5 now opens route setup first when saved services already exist; targeted tests, build, and browser smoke passed |
| 2 | Route-first add flow with preview | Complete | Route panel can now create a new goal and auto-attach it to the current route using the existing chooser/modal flow; the custom connection modal now shows a route preview before save; the GO multi-select import path now shows a per-target route attach preview before save |
| 3 | Move library management to advanced/admin | In progress | Three IA slices landed: Step 5 now opens Route Connections first by default, the full saved-service manager now lives behind an explicit advanced modal entry point, and that manager now defaults to route-relevant saved services while keeping maintenance controls collapsed |
| 4 | Add route-facing view-model layer | Proposed | Structural cleanup after UX direction is proven |
| 5 | Optional deeper product-model cleanup | Future | Only if earlier phases are insufficient |

---

## Resume here

### Current status

- **Phase 1 is complete**
- **Phase 2 is complete**
- The route-first add experience now covers both custom goals and multi-target GO imports with route-level preview before save

### Completed work summary

#### Phase 1 completed

- clearer route-level sentence-style wording
- less jargon in the add chooser
- friendlier custom connection modal copy
- smarter default stop selection in the main add flow
- automatic single-stop selection in the custom connection modal
- route-first Step 5 default when the library already has saved services
- clearer route-specific guidance when the current route still needs connection goals

#### Phase 1 validation notes

- `npm run test:smoke` passed
- local preview also confirmed:
  - Fixed Route dashboard opens correctly
  - Master Schedule route detail loads with live route data
- limitation during local smoke:
  - the exact deep Connections editing path was not fully reachable in preview because the available local route draft was stale and the visible system draft opened with no routes
  - that is a local data-state limitation, not a compile/test failure

#### Phase 2 completed so far

Completed in the first Phase 2 slice:
- Route Connections now offers both:
  - **Add saved service**
  - **Create new goal**
- The route-first create path reuses the existing chooser and custom target modal
- When a planner creates a new target from the route panel, the app now:
  - saves the target to the library
  - auto-attaches it to the current route when a matching route stop can be inferred
- Shared defaulting logic now lives in `utils/connections/routeConnectionDefaults.ts`

Completed in the second Phase 2 slice:
- The route-first create flow now shows a pre-save preview in the custom connection modal
- The preview shows:
  - target name
  - suggested route stop
  - timing rule
  - active events for the current day
- Shared preview logic now reuses the same route inference rules as the actual attach-on-save behavior

Completed in the third Phase 2 slice:
- The GO chooser is now route-aware when opened from the route panel
- Multi-GO import copy now reads as saving and adding GO options to the current route, not just importing library targets
- The chooser now explains that selected GO options will be attached to the current route for the active day and that matching route stops will be chosen automatically when possible

Completed in the fourth Phase 2 slice:
- Template-based route-first flows now open in a review-first goal-builder mode inside `AddTargetModal.tsx`
- The modal now uses route-specific titles and save actions like “Save and add to Route X”
- When a route-first template is chosen, library-oriented detail fields are hidden by default behind an “Edit details” action so the planner sees a cleaner review screen first

Completed in the fifth Phase 2 slice:
- The multi-target GO import path now shows a route attach preview for each selected GO option before save
- The chooser now makes the suggested route stop explicit for each selected GO goal
- The planner can review the route stop, timing rule, and active event preview for each selected GO option without leaving the route-first flow

### Latest verification

Most recent successful checks:
- `npx vitest run tests/AddTargetModal.test.tsx tests/ConnectionAddChooser.test.tsx tests/routeConnectionDefaults.test.ts tests/RouteConnectionPanel.test.tsx tests/Step5Connections.test.tsx tests/Step5Connections.routeFirstCreate.test.tsx`
- `npm run build`

Result at last checkpoint:
- tests passed: **21/21**
- build passed
- note: `npx tsc --noEmit` still reports unrelated pre-existing test typing failures outside this connections slice

### Next recommended task

Continue **Phase 3** by moving full library management farther into an advanced/admin path while keeping route-level connection goals as the default planner workflow.

Specifically:
- keep the route panel focused on connection goals and saved-service selection
- continue demoting the full shared library manager into a clearer “advanced” or “manage saved services” path
- preserve existing maintenance power without making it the main entry experience

### Open gap / risk

Still missing for the broader simplification roadmap:
- the advanced manager is now easier to scan, but it still uses the same underlying full-power panel and data model rather than a dedicated saved-service admin surface

Biggest near-term UX risk if left here:
- planners may still perceive the advanced manager as broader than necessary because the underlying panel still mixes saved-service browsing with maintenance operations, even though the maintenance tools now start collapsed and the saved-service groups are clearer

### Phase 3 completed so far

Completed in the first Phase 3 slice:
- Step 5 now opens **Route Connections** first by default whether or not saved services already exist
- The old library-first setup message has been replaced with route-first guidance that tells planners to start from the route panel
- The shared library card is now labeled **Saved Service Library** with an explicit **Advanced** badge
- The library card now explains that it is for shared saved services, imports, GTFS refresh, and maintenance tools, while route setup should usually happen in the route panel first

Completed in the second Phase 3 slice:
- The full saved-service library manager is no longer shown inline in the main Step 5 layout
- Step 5 now uses a lighter **Advanced saved-service tools** card with a **Manage saved services** action
- The full library manager now opens in a dedicated modal so route setup remains the primary surface
- Advanced launch paths like opening the chooser from the library manager or importing from another route now come from that modal path instead of competing with the main route workflow

Completed in the third Phase 3 slice:
- The advanced manager now opens in a more route-friendly compact admin mode
- It defaults to showing saved services that match the current route/day context first
- GTFS refresh, connection timing settings, and recent change history now live under a collapsed **Library maintenance** section instead of leading the modal
- Planners can still switch to all saved services when needed, but the default advanced view now starts closer to “what saved services matter for this route?”

Completed in the fourth Phase 3 slice:
- The advanced manager now shows clearer grouping with quick counts for **Manual saved services** and **Route-derived saved services**
- The old generic headings (`Manual Targets`, `Route Connections`) no longer lead the compact advanced view
- The advanced manager now better answers “what kinds of saved services are available for this route?” before the planner expands individual items

Completed in the fifth Phase 3 slice:
- Saved-service rows in the compact advanced manager now show route/day usefulness badges before expansion
- Planners can now see stop-match status and active-time relevance at a glance without opening each service
- The advanced manager now better supports the quick question “is this saved service useful for the current route/day right now?”

Completed in the sixth Phase 3 slice:
- Saved services in the compact advanced manager are now sorted by route relevance instead of plain name order
- Matching services with active times now rise above non-matching or inactive services when planners switch to the broader “show all saved services” view
- The advanced manager now better prioritizes the items most likely to matter to the current route/day

### Latest verification

Most recent successful checks:
- `npx vitest run tests/ConnectionLibraryPanel.test.tsx tests/Step5Connections.test.tsx tests/Step5Connections.routeFirstCreate.test.tsx`
- `npx vitest run tests/Step5Connections.test.tsx tests/Step5Connections.routeFirstCreate.test.tsx`
- `npx vitest run tests/AddTargetModal.test.tsx tests/ConnectionAddChooser.test.tsx tests/ConnectionLibraryPanel.test.tsx tests/routeConnectionDefaults.test.ts tests/RouteConnectionPanel.test.tsx tests/Step5Connections.test.tsx tests/Step5Connections.routeFirstCreate.test.tsx`
- `npm run build`

Result at current checkpoint:
- tests passed: **24/24**
- build passed

### Next recommended task

Continue **Phase 3** by simplifying the content inside the advanced manager itself.

Specifically:
- consider turning the manual vs route-derived groups into explicit tabs or filters if the list grows large
- consider a stronger visual emphasis for the top route-relevant services if planners still need to scan large lists
- keep import, cleanup, GTFS refresh, and route-derived maintenance available without making the advanced modal feel like the normal route setup path
