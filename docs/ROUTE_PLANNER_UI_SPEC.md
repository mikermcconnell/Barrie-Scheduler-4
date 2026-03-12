# Route Planner UI Spec

> Date: March 11, 2026
> Status: Draft
> Visual direction: Friendly design theme
> Product companion: `docs/ROUTE_PLANNER_PRD.md`

## 1. Intent

This document translates the Route Planner product direction into a concrete workspace structure for design and implementation.

The Route Planner should feel like a natural extension of the current Scheduler 4 planning surfaces. It should keep the warm, high-contrast, rounded visual language already established in the Shuttle Planner and On Demand workspaces, while expanding the interaction model to support route concepts, runtime intelligence, and later rider-impact analysis.

## 2. Design Thesis

Build a map-first planning workspace that feels operational and approachable, not technical for its own sake.

The workspace should:

- make the map the center of gravity
- keep actions obvious and grouped
- make selected scenario state easy to understand
- surface metrics and warnings without crowding the map
- allow technical analysis layers without losing the Friendly design feel

## 3. Primary Screen

### 3.1 Desktop layout

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Workspace Header                                                           │
│ Back | Project | Scenario | Save | Duplicate | Compare | Export | Status   │
├───────────────┬───────────────────────────────────────┬─────────────────────┤
│ Left Rail     │ Map Canvas                            │ Right Rail          │
│               │                                       │                     │
│ Project List  │ Route alignment and stops             │ Service tab         │
│ Scenario List │ Existing route overlays               │ Runtime tab         │
│ Base Source   │ Runtime / coverage / land-use views   │ Coverage tab        │
│ Stop List     │ Selection and compare overlays        │ Insights tab        │
│ Selected Item │                                       │ Output tab          │
├───────────────┴───────────────────────────────────────┴─────────────────────┤
│ Compare Drawer / Key Deltas / Findings / Overlay Toggles                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Narrow viewport layout

On narrower widths, the interface should shift to:

1. header
2. map
3. segmented content toggle
4. stacked detail panel

Recommended narrow-screen tabs:

- `Stops`
- `Service`
- `Runtime`
- `Compare`

The map should remain visible near the top of the viewport. Avoid pushing the map below long forms.

## 4. Friendly Theme Rules

### 4.1 Visual system

Use the Friendly design theme across the full experience:

- soft gray workspace background
- white primary cards
- rounded-2xl and rounded-3xl panels
- clear borders
- compact pill-based controls
- tinted KPI and warning blocks
- strong but uncluttered action hierarchy

### 4.2 Design rule

The visual rule should be:

> operational warmth, not GIS software

This means:

- no flat admin styling
- no heavy analyst-tool chrome
- no scattered floating map controls
- no visual break between planning, runtime, and coverage views

## 5. Workspace Header

### 5.1 Content

The header should include:

- back navigation
- editable project name
- planner mode strip
- scenario switcher
- scenario type badge
- save action
- duplicate action
- compare toggle
- export or handoff action
- status chip

### 5.2 Layout rules

- Project name should be visually dominant.
- Planner modes should be visible near the top of the workspace, not hidden in a menu.
- Actions should be grouped into compact bordered clusters.
- Compare mode should be visibly active when enabled.
- Status should be readable at a glance.

## 6. Left Rail

### 6.1 Purpose

The left rail manages planning objects. It should answer:

- what project am I in
- which scenario is selected
- what did this scenario start from
- what stops and objects are part of it

### 6.2 Sections

#### Project and scenario panel

Contents:

- project list or current project summary
- scenario list
- add scenario
- duplicate scenario
- rename
- delete
- preferred scenario indicator

Current implementation state:

- Shuttle Concept now emits a shared planning snapshot upward to the Route Planner shell
- planned modes can display the active project and selected scenario context even before their full editors are built
- the Shuttle Concept workspace now reads from a separate controller hook, which is the first step toward a neutral Route Planner controller
- the Route Planner shell now owns that controller instance for Shuttle Concept and passes it into a presentational shuttle workspace view
- Route Planner state is now consolidated inside `components/Analytics/useRoutePlannerController.ts`

#### Base source panel

Contents:

- blank concept
- existing Barrie route
- branch or direction
- shuttle template

Current implementation state:

- the parent Route Planner controller now holds base-source setup state for the planned `Existing Route Tweak` and `Route Concept` modes
- current base-source options exposed in the shell are `Blank Concept` and `Existing Barrie Route`
- both planned modes now render neutral draft project, scenario, pattern, and notes state through `useRoutePlannerDraftController.ts`
- those planned-mode drafts now persist locally so shell-level route concept work survives remounts
- those planned-mode shells now also expose scenario selection, duplication, preferred-scenario marking, and compare-ready metrics through a neutral project controller
- those planned-mode shells now expose route-study save, reopen, duplicate, delete, and local-vs-cloud status controls in the header action area
- those planned-mode shells now expose a first map authoring surface for route alignment editing, including inspect vs edit-alignment mode, ordered waypoint handles, undo, and clear actions
- those planned-mode shells now expose stop editing in the same map surface, including Barrie stop selection, custom stop placement, draggable stop markers, and selected-stop detail editing
- those planned-mode shells now expose an observed runtime proxy card with STREETS-backed stop-to-stop evidence, day-type and time-period selectors, matched-segment counts, and segment-level fallback disclosure
- those planned-mode shells now expose a first output layer with project-summary export and preferred-scenario scheduling handoff export
- those planned-mode shells now expose editable service-definition fields for scenario name, pattern, status, span, frequency, and layover
- those planned-mode shells now also expose timing-profile selection plus start/end terminal hold inputs inside the service-definition card
- those planned-mode shells now expose a stop-by-stop timetable preview for the first departures of the preferred scenario
- those planned-mode shells now expose interior stop timing anchors in the selected-stop editor so timed stops can shape the timetable
- those planned-mode shells now expose a route-wide timing structure card that shows which stops are anchored, interpolated, or missing timed-stop anchors
- those planned-mode shells now also surface schedule-ready validation for terminal roles and invalid anchor order inside the same warning layer
- those planned-mode shells now also expose a starter coverage card with walkshed controls, strategic point counts, and compare deltas for Barrie hubs and schools

#### Stop list panel

Contents:

- ordered stop list
- stop source badge
- stop role badge
- reorder controls
- add stop action

#### Selected object panel

Contents vary by selection:

- selected stop details
- selected segment details
- terminal or timed-stop properties

## 7. Map Canvas

### 7.1 Role

The map is the primary authoring and comparison surface. It should dominate the workspace visually while staying clean and readable.

### 7.2 Core layers

| Layer | Purpose |
|------|---------|
| Active route alignment | Main concept geometry |
| Route stops | Ordered stop markers |
| Terminal markers | Start/end emphasis |
| Existing Barrie stops | Selectable context |
| Existing route overlay | Starting-template context |
| Compare scenario overlay | Alternate option display |
| Runtime overlay | Segment performance view |
| Coverage overlay | Population / jobs walkshed view in Phase 2 |
| Land-use overlay | Strategic analysis layers in later phase |

### 7.3 Map modes

- `Inspect`
- `Edit Alignment`
- `Edit Stops`
- `Runtime View`
- `Coverage View`
- `Land Use View` later

### 7.4 Map controls

Controls should be consolidated and quiet. Required controls include:

- mode switcher
- compare overlay toggle
- reset extent
- basemap or context toggle if needed
- clear selection

## 8. Right Rail

### 8.1 Purpose

The right rail should turn map edits into planning meaning. It is where the selected scenario becomes operationally legible.

### 8.2 Tab structure

Recommended tabs:

- `Service`
- `Runtime`
- `Coverage`
- `Insights`
- `Output`

### 8.3 Tab responsibilities

#### Service

- scenario type
- service pattern
- first trip
- last trip
- frequency
- recovery or layover
- route notes

#### Runtime

- one-way runtime
- cycle time
- buses required
- direction filter
- day type and period filter
- confidence signal
- segment-level runtime detail where available
- observed-vs-fallback source badges by stop pair

#### Coverage

Phase 2:

- population served
- jobs served
- net gain or loss vs baseline
- walkshed assumptions

#### Insights

- warnings
- tradeoffs
- slow segments
- low-confidence segments
- planner notes

#### Output

- summary metrics
- draft timetable or handoff summary
- export actions
- markdown project-study export
- markdown preferred-scenario scheduling handoff export
- stop-by-stop timetable preview table

## 9. Compare Drawer

The compare drawer should sit below the main workspace and expand when compare mode is enabled.

It should include:

- baseline vs option table
- key deltas
- runtime change
- bus requirement change
- coverage change in later phases
- quick narrative findings

The compare drawer should feel like part of the same workspace, not a modal or secondary report view.

## 10. Scenario Types

The Route Planner shell should expose all three scenario types even before each one is fully implemented.

Current implementation state:

- `Shuttle Concept` is live
- `Existing Route Tweak` is visible in the shell as a planned mode with a neutral draft controller
- `Route Concept` is visible in the shell as a planned mode with a neutral draft controller
- both planned modes now support local scenario workflow, saved route studies, map authoring, stop editing, and observed runtime evidence inside the shell

### Route Concept

Use when a user is creating a new route structure or major redesign option.

UI emphasis:

- blank start
- corridor testing
- multiple alignment options

### Existing Route Tweak

Use when a user is modifying an existing Barrie route.

UI emphasis:

- load from current route
- baseline comparison
- clear before and after deltas

### Shuttle Concept

Use when a user is creating a temporary or special-purpose service.

UI emphasis:

- loop or out-and-back defaults
- temporary service notes
- simplified setup

## 11. Future Analysis Layers

When later phases are added, the interface should keep the same Friendly layout and card hierarchy.

Do not introduce a different visual language for:

- population and employment coverage
- land-use-specific overlays
- strategic planning views

These layers should feel like extensions of the same Route Planner workspace.
