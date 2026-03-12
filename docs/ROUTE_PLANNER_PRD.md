# Route Planner PRD

> Date: March 11, 2026
> Status: Draft for implementation
> Product fit: Planning-first route concept design within Scheduler 4 Planning Data
> Companion docs:
> - `docs/ROUTE_PLANNER_UI_SPEC.md`
> - `docs/plans/2026-03-11-route-planner-build-plan.md`

## 1. Purpose

Route Planner will let Transit Staff create, test, and compare route concepts inside Scheduler 4 before moving into downstream schedule development.

The feature should support:

- hypothetical route concepts
- existing route tweaks
- shuttle concepts as a route type or scenario template

The feature should help staff answer operational and planning questions in one place, instead of switching between maps, spreadsheets, and manual runtime assumptions.

## 2. Problem Statement

Early route planning work is fragmented. Staff often need to:

- draw concepts separately from schedule calculations
- estimate runtime using rough assumptions
- compare alternatives manually
- assess rider impact in a separate GIS workflow

This slows down concept development and makes it harder to compare options on a consistent basis.

## 3. Product Goal

Create a map-first planning workspace where a user can build or load a route concept, adjust the alignment and stop pattern, test runtime and service assumptions, and compare options before moving the preferred concept into schedule work.

## 4. Product Position

Route Planner should be the parent workspace. Shuttle Planner should be absorbed into this feature over time as a scenario type or template.

This means:

- the long-term product is one planning workspace
- shuttle planning remains supported
- fixed-route concept testing remains supported
- the core scenario, map, and runtime engine is shared

Current implementation state:

- Route Planner now exists as the Planning Data entry point
- Shuttle Concept is the first live mode inside the shared workspace
- Existing Route Tweak and Route Concept are visible in the shell and now run through neutral draft project controllers
- the parent Route Planner controller now receives a shared project and scenario snapshot from Shuttle Concept
- the parent Route Planner controller now also owns base-source setup state for the planned route modes
- Shuttle Concept state is now driven through a reusable controller hook instead of keeping that logic inline in the view component
- Route Planner now instantiates that Shuttle Concept controller directly and passes it into the shuttle view
- Route Planner state ownership now sits behind a dedicated `useRoutePlannerController.ts` hook rather than ad hoc state inside the workspace component
- planned route-mode drafts now persist locally through `routePlannerDraftStorage.ts`
- planned route modes now also have a neutral project controller with selected-scenario state, duplicate/delete actions, preferred-scenario marking, and compare-ready draft metrics
- planned route modes now support Firebase-backed project save, duplicate, delete, and reopen flows through `routePlannerProjectService.ts`
- planned route modes now support map-based alignment drafting with ordered waypoint editing inside the Route Planner shell
- planned route modes now support stop editing with Barrie stop pickup, custom stop placement, drag editing, and stop detail management inside the same shell
- planned route modes now also consume Corridor Speed / STREETS stop-to-stop runtime proxy data for saved studies, with day-type and time-period filters plus partial-coverage fallback warnings
- planned route modes now also support markdown route-study summary export and preferred-scenario scheduling handoff export from the runtime-aware display project
- planned route modes now also expose editable service-definition fields for scenario name, pattern, status, span, frequency, and layover inside the neutral Route Planner shell
- planned route modes now also generate stop-by-stop timetable previews for the first departures and include that structure in the exportable handoff
- planned route modes now also support interior stop timing anchors so timed stops can shape the timetable instead of relying only on even spacing
- planned route modes now also surface schedule-structure warnings when timed stops are still interpolated or when manual anchors are applied to regular stops

## 5. Primary Users

| User | Role | Primary Need |
|------|------|--------------|
| Transit Planner | Service design | Test route concepts quickly and credibly |
| Transit Projects Lead | Project planning | Evaluate route options for restructures, pilots, and temporary services |
| Operations Manager | Review | Understand runtime, cycle, and feasibility impacts |

## 6. Definition of Success

The feature is successful if a planner can create or load a route concept, change it, and immediately understand the operational and rider-facing impact without leaving Scheduler 4.

### Phase 1 success

- A planner can start from a blank concept, an existing Barrie route, or a shuttle template.
- A planner can edit alignment, stops, service pattern, frequency, span, and recovery assumptions.
- The tool returns credible runtime, cycle, and bus requirement outputs using observed stop-to-stop proxy data where available.
- The tool shows confidence signals when runtime evidence is weak.
- The planner can save multiple scenarios and compare them clearly.
- The preferred scenario can be handed into downstream schedule work with minimal rework.

### Phase 2 success

- A planner can compare scenarios by population and employment coverage.
- The tool shows gain or loss in population and jobs served.
- Coverage results can be reviewed alongside operating impacts.

### Phase 3 success

- A planner can compare scenarios against land-use-specific layers.
- The tool helps staff understand what types of destinations and trip generators are improved.

## 7. Non-Goals

Route Planner will not include the following in initial phases:

- full GTFS editing
- public trip planning
- dispatch or vehicle assignment
- operator run-cutting
- automatic publishing without planner review

## 8. Core User Stories

### Scenario setup

- As a planner, I want to start from a blank concept or an existing route so that I can work from the right baseline.
- As a planner, I want to save multiple scenarios so that I can compare alternatives without overwriting previous work.

### Map authoring

- As a planner, I want to edit route alignment on a map so that I can test roadway choices directly.
- As a planner, I want to add, remove, and reorder stops so that I can test different stopping patterns.

### Runtime intelligence

- As a planner, I want runtime estimates to use observed stop-to-stop proxy data where available so that the outputs are more credible than distance-based assumptions.
- As a planner, I want to see confidence and sample-size indicators so that I know where the numbers are strong and where they are only proxies.

### Review and comparison

- As a planner, I want to compare route scenarios on the map and in a metrics table so that I can choose the most practical option.
- As a manager, I want a summary output with assumptions, runtime, buses required, and key findings so that I can review the proposal quickly.

### Rider impact

- As a planner, I want to compare scenarios by market coverage so that I can understand who gains or loses access from a route change.
- As a planner, I want to review future land-use-specific layers so that strategic route decisions reflect destination type and growth context.

## 9. Core Workflow

1. Open Route Planner.
2. Create a project or open an existing project.
3. Create a scenario.
4. Choose a scenario type:
   - `Route Concept`
   - `Existing Route Tweak`
   - `Shuttle Concept`
5. Start from a blank concept, existing route, or template.
6. Edit alignment and stops.
7. Enter service assumptions.
8. Review runtime intelligence, warnings, and outputs.
9. Compare against other scenarios.
10. Review coverage and land-use impacts in later phases.
11. Save or hand off the preferred scenario into downstream schedule work.

## 10. Functional Requirements

### 10.1 Scenario management

- User can create, save, duplicate, rename, and delete projects and scenarios.
- User can mark a preferred scenario.
- User can store notes and planning assumptions with each scenario.

### 10.2 Base route loading

- User can start from a blank concept.
- User can load an existing Barrie route.
- User can load a direction or branch where supported.
- User can start from a shuttle template.

### 10.3 Alignment and stop editing

- User can create and edit route geometry on a map.
- User can add existing Barrie stops and custom stops.
- User can move, remove, and reorder stops.
- User can define terminal and timed-stop roles.

### 10.4 Service definition

- User can choose a pattern appropriate to the scenario type.
- User can define first trip, last trip, headway, and recovery assumptions.
- User can review outputs that update when the route or assumptions change.

### 10.5 Runtime intelligence

- The tool must estimate one-way runtime.
- The tool must estimate cycle time.
- The tool must estimate buses required.
- The tool must use observed stop-to-stop proxy data where available.
- The tool must show confidence or low-data conditions.
- The tool must support direction, period, and day-type filters where relevant.
- The tool must show segment-by-segment evidence, including where observed runtime was used versus fallback estimation.

### 10.6 Scenario comparison

- User can compare scenarios on the map.
- User can compare scenarios in a metrics table.
- User can review key deltas between a baseline and an option.

### 10.7 Coverage and land use

Phase 2:

- The tool must calculate population and employment within configurable walksheds.
- The tool must show scenario-to-scenario changes in coverage.

Later phase:

- The tool should support land-use-specific overlays such as schools, hospitals, GO, growth areas, and employment nodes.

### 10.8 Handoff

- User can export a route concept summary with map, stops, assumptions, and key metrics.
- User can export a preferred-scenario scheduling handoff brief with runtime source, stops, departures, and warnings.
- User can review and export a stop-by-stop timetable preview for the preferred scenario.
- User can set interior stop timing anchors so schedule structure follows key timed stops.
- User can move a preferred concept into downstream schedule work in a later implementation step.

## 11. Data and Intelligence Principles

- Observed runtime evidence should be used where available.
- The tool should prefer explainable planning logic over black-box scoring.
- Confidence and sample size should be visible to the user.
- Scenario comparison should be a first-class workflow, not an afterthought.

## 12. Design Direction

The entire Route Planner experience should use the Friendly design theme already established in Scheduler 4.

This means:

- bright workspace framing
- white rounded cards with visible borders
- strong header and action groups
- tinted KPI and warning cards
- quiet map chrome
- clear selected-state styling

The product should feel like one coherent planning workspace rather than a separate GIS tool.
