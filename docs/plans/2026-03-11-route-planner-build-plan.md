# Route Planner Build Plan

> Date: March 11, 2026
> Goal: Evolve the current Shuttle Planner prototype into a broader Route Planner workspace without losing momentum on near-term delivery

## 1. Current Code Position

The current starting point is the Shuttle Planner prototype inside Planning Data.

Current workspace files:

- `components/Analytics/AnalyticsDashboard.tsx`
- `components/Analytics/RoutePlannerWorkspace.tsx`
- `components/Analytics/ShuttlePlannerWorkspace.tsx`

Current domain and service files:

- `utils/shuttle/shuttleTypes.ts`
- `utils/shuttle/shuttleSeedData.ts`
- `utils/shuttle/shuttlePlanning.ts`
- `utils/shuttle/shuttleRoadSnapService.ts`
- `utils/services/shuttleProjectService.ts`

Shared route-planner scaffold:

- `utils/route-planner/routePlannerTypes.ts`
- `utils/route-planner/routePlannerPlanning.ts`
- `tests/routePlannerPlanning.test.ts`
- `components/Analytics/useShuttlePlannerController.ts`

Current runtime intelligence foundation:

- `components/Mapping/CorridorSpeedMap.tsx`
- `utils/gtfs/corridorSpeed.ts`
- `hooks/usePerformanceData.ts`

## 2. Strategic Build Direction

Do not replace Shuttle Planner immediately.

Instead:

1. finish the current Shuttle Planner enough to make it a usable planning workflow
2. extract shared planning logic from the shuttle-specific implementation
3. introduce Route Planner as the parent workspace
4. keep Shuttle as a scenario type or starter mode inside the broader planner

This approach keeps delivery moving while avoiding a throwaway prototype.

## 3. Recommended Delivery Phases

### Phase 0: Stabilize the current Shuttle Planner shell

Objective:

- turn the current prototype into a working scenario editor with real persistence

Primary tasks:

- wire `components/Analytics/ShuttlePlannerWorkspace.tsx` fully to `utils/services/shuttleProjectService.ts`
- complete save, load, duplicate, rename, and delete flows
- confirm seeded starter logic and cloud project logic coexist cleanly
- keep the current Friendly theme intact

Definition of done:

- planner projects persist reliably
- scenarios can be saved and reopened
- the current prototype can support internal product review

Current status:

- largely in place
- save, load, duplicate, and delete flows are already wired for signed-in users
- remaining work is validation, cleanup, and keeping the docs aligned with implementation

### Phase 1: Replace placeholder runtime logic with a reusable route-planning engine

Objective:

- move from distance-based placeholder estimates to a route-planning calculation layer that can grow into Route Planner

Primary tasks:

- extract shuttle-specific derivation logic from `utils/shuttle/shuttlePlanning.ts`
- create a broader route-scenario calculation layer
- define runtime sourcing modes:
  - observed proxy data
  - manual override
  - fallback estimate
- reuse `utils/gtfs/corridorSpeed.ts` patterns for stop-to-stop observed runtime matching
- keep low-confidence and no-data warnings visible in the UI

Definition of done:

- runtime outputs are based on a structured and explainable engine
- the same engine can support both shuttle and route concepts

Current status:

- initial shared types and planning scaffold now exist
- Shuttle Planner derivation now routes through the shared planning layer while preserving shuttle-specific outputs
- shuttle-specific UI is not migrated yet
- the next step is to start moving more UI consumers and runtime intelligence inputs onto the shared layer

### Phase 2: Generalize the workspace from Shuttle Planner to Route Planner

Objective:

- introduce the broader workspace without losing shuttle support

Primary tasks:

- create a new Route Planner workspace component
- keep or wrap `ShuttlePlannerWorkspace.tsx` temporarily during migration
- introduce a neutral scenario model such as `RouteScenario`
- add scenario types:
  - `Route Concept`
  - `Existing Route Tweak`
  - `Shuttle Concept`
- add a base source loader:
  - blank concept
  - existing Barrie route
  - route branch or direction
  - shuttle template

Likely files:

- new: `components/Analytics/RoutePlannerWorkspace.tsx`
- new: `utils/route-planner/routePlannerTypes.ts`
- new: `utils/route-planner/routePlannerPlanning.ts`
- existing shuttle files either wrapped, migrated, or deprecated gradually

Definition of done:

- Route Planner becomes the main product surface
- Shuttle becomes one supported scenario type

Current status:

- initial `RoutePlannerWorkspace.tsx` shell now exists
- Planning Data now exposes a Route Planner entry point
- Shuttle Concept is the first live mode inside that shell
- the shell now exposes all three planned modes through a visible mode strip
- the parent shell now owns a shared planning snapshot sourced from Shuttle Concept
- the parent shell now also owns neutral base-source state for the planned route modes
- Shuttle Concept persistence, selection, and editing state now flow through a reusable controller hook
- Route Planner now instantiates that controller and renders Shuttle Concept through a presentational workspace view
- broader route-concept and existing-route-tweak draft UI flows now run through neutral draft project controllers
- Route Planner state ownership is now consolidated in `components/Analytics/useRoutePlannerController.ts`
- planned route-mode drafts now persist locally through `utils/route-planner/routePlannerDraftStorage.ts`
- planned route-mode scenario management now runs through `components/Analytics/useRoutePlannerProjectController.ts`
- local route-project state utilities now exist in `utils/route-planner/routePlannerProjectState.ts`
- Firebase-backed route-project persistence now exists in `utils/services/routePlannerProjectService.ts`
- planned route-mode map authoring now supports alignment clicks, draggable waypoints, undo, and clear actions in `components/Analytics/RoutePlannerWorkspace.tsx`
- planned route-mode map authoring now also supports stop placement, Barrie stop pickup, draggable stop markers, and selected-stop editing in `components/Analytics/RoutePlannerWorkspace.tsx`
- planned route modes now also consume shared Corridor Speed stop-to-stop runtime evidence with day-type and time-period filters, matched-segment counts, and segment-level fallback disclosure in `components/Analytics/RoutePlannerWorkspace.tsx`
- planned route modes now also expose markdown project-summary export and preferred-scenario scheduling handoff export through `utils/route-planner/routePlannerOutputs.ts` and `components/Analytics/RoutePlannerWorkspace.tsx`
- planned route modes now also expose editable service-definition controls through `components/Analytics/useRoutePlannerProjectController.ts` and `components/Analytics/RoutePlannerWorkspace.tsx`
- planned route modes now also expose reusable stop-by-stop timetable preview generation through `utils/route-planner/routePlannerTimetable.ts` and surface that preview in both the workspace and exports
- planned route modes now also support interior stop timing anchors through `utils/route-planner/routePlannerPlanning.ts`, `components/Analytics/useRoutePlannerProjectController.ts`, and `components/Analytics/RoutePlannerWorkspace.tsx`
- planned route modes now also expose route-wide timing structure review and schedule-structure warnings through `components/Analytics/RoutePlannerWorkspace.tsx` and `utils/route-planner/routePlannerPlanning.ts`
- planned route modes now also expose explicit timing-profile selection, start/end terminal hold assumptions, and schedule-ready stop / anchor validation through `utils/route-planner/routePlannerPlanning.ts`, `components/Analytics/useRoutePlannerProjectController.ts`, `components/Analytics/RoutePlannerWorkspace.tsx`, and `utils/route-planner/routePlannerOutputs.ts`
- planned route modes now also expose a starter coverage workflow with configurable walkshed assumptions and a local strategic market layer for Barrie hubs and schools through `utils/route-planner/routePlannerCoverage.ts`, `utils/route-planner/routePlannerCoverageSeed.ts`, `components/Analytics/useRoutePlannerProjectController.ts`, and `components/Analytics/RoutePlannerWorkspace.tsx`

### Phase 3: Add real map authoring and stop editing

Objective:

- make the map a true editing surface

Primary tasks:

- add waypoint creation and editing
- add route geometry editing
- add stop insertion, movement, and deletion
- support ordered stop updates
- keep map interactions consistent with the Friendly design approach

Definition of done:

- planners can build and edit concepts directly on the map instead of only adjusting seeded scenarios

### Phase 4: Add runtime intelligence views and scenario comparison

Objective:

- connect the planner to observed Barrie runtime evidence in a usable planning workflow

Primary tasks:

- reuse `hooks/usePerformanceData.ts` query patterns
- adapt stop-to-stop runtime logic from `utils/gtfs/corridorSpeed.ts`
- support direction, day type, and period filters
- show runtime confidence and low-data warnings
- expand compare mode from current shuttle compare into baseline-vs-option analysis

Definition of done:

- a planner can test road choice and stop-pattern changes against observed proxy runtimes

### Phase 5: Add coverage analysis

Objective:

- measure rider-facing impact, not just operating impact

Primary tasks:

- add population coverage
- add employment coverage
- add configurable walkshed assumptions
- add baseline vs scenario delta reporting

Definition of done:

- a planner can see who gains and loses access from a route change

### Phase 6: Add land-use-specific analysis

Objective:

- support stronger strategic planning decisions

Primary tasks:

- add schools
- add hospitals
- add major employment and retail nodes
- add growth areas and development pipeline
- add GO and regional transfer generators
- add equity-priority layers where available

Definition of done:

- the tool can evaluate route concepts against actual destination types and strategic planning priorities

## 4. Key Refactoring Principles

- Do not throw away the current Shuttle Planner shell if it can be migrated.
- Keep the Friendly design theme stable during backend and logic refactors.
- Separate scenario storage, planning calculations, and UI concerns early.
- Keep runtime logic explainable and auditable.
- Preserve scenario comparison as a first-class workflow.

## 5. Recommended File Strategy

### Keep for near-term use

- `components/Analytics/ShuttlePlannerWorkspace.tsx`
- `utils/services/shuttleProjectService.ts`
- `utils/shuttle/shuttleSeedData.ts`

### Likely to refactor or split

- `utils/shuttle/shuttlePlanning.ts`
- `utils/shuttle/shuttleTypes.ts`

### Reuse as planning intelligence foundation

- `utils/gtfs/corridorSpeed.ts`
- `hooks/usePerformanceData.ts`
- `components/Mapping/CorridorSpeedMap.tsx`

## 6. Suggested Implementation Order

1. finish persistence in the current Shuttle Planner
2. harden the runtime calculation model
3. introduce shared route-planner types and calculation utilities
4. create Route Planner workspace shell
5. migrate shuttle flows into scenario-type logic
6. add existing-route loading
7. add real map editing
8. add runtime intelligence views
9. add coverage analysis
10. add land-use-specific analysis

## 7. Immediate Next Step

The next practical build step is now:

- replace the starter strategic market layer with a real population / employment dataset on top of the now-runtime-aware, service-editable, timing-structured, and exportable route-study workflow

After that, the next architecture step should be:

- add first-pass land-use-specific analysis layers after the demographic coverage workflow is stable

## 8. Documentation Maintenance

These planning docs should be updated alongside implementation work.

- Update `docs/ROUTE_PLANNER_PRD.md` when scope, success criteria, or feature boundaries change.
- Update `docs/ROUTE_PLANNER_UI_SPEC.md` when layout, modules, or interaction patterns change.
- Update this build plan when implementation order, architecture, or file strategy changes.
- Update `docs/plans/2026-03-11-shuttle-planner-status.md` when the current-state summary no longer matches the code.
