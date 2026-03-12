# Route Planner Product Brief

> Date: March 11, 2026
> Status: Working draft
> Product fit: Planning-first route concept design within Scheduler 4 Planning Data

## 1. Purpose

Route Planner is a planning workspace for testing proposed route concepts before they move into schedule development.

The feature should allow Transit Staff to:

- start from a blank concept
- load an existing Barrie route, branch, or direction as a starting point
- load a shuttle template for temporary service concepts
- edit alignment, stops, and service assumptions on a map
- estimate scheduling impacts using observed stop-to-stop runtime proxy data
- compare alternatives and select a preferred concept
- hand the preferred concept into downstream schedule work

The feature is intended for planning and concept development. It is not intended to be a GTFS editor, dispatch tool, or production publishing tool.

## 2. Product Position

Route Planner should be the parent workspace. Shuttle Planner should be absorbed into this feature over time as a scenario type or template, not maintained as a permanent separate product.

This means:

- Shuttle planning remains supported
- existing route tweaks remain supported
- the core planning engine is shared across both use cases

The primary planning object should be a `Route Scenario`, not a route record. This keeps the feature focused on testing and comparison rather than formal route maintenance.

## 3. Core Product Direction

The primary use case should be hypothetical planning, while allowing planners to load existing Barrie routes into the map and modify them.

This direction matches how staff typically work:

- start from something real when possible
- test a different alignment or stop pattern
- compare operating impacts quickly
- decide whether the change is worth advancing

If the feature only supports route drawing, it will not be successful. The differentiator is the planning intelligence layer built on observed runtime evidence and later coverage and land use layers.

## 4. Definition of Success

The feature is successful if a planner can create or load a route concept, change the alignment or stop pattern, and immediately understand the operational and rider-facing impact without leaving Scheduler 4.

### Phase 1 success

- A planner can create a blank concept or load an existing Barrie route as a starting template.
- A planner can edit alignment, stops, service pattern, frequency, span, and recovery assumptions in one workspace.
- The tool returns credible runtime, cycle, and bus requirement outputs using observed stop-to-stop proxy data where available.
- The tool shows confidence signals when runtime evidence is weak or incomplete.
- A planner can save multiple scenarios and compare them visually and numerically.
- The preferred scenario can be handed into downstream schedule development with minimal rework.

### Phase 2 success

- A planner can compare scenarios by population and employment coverage.
- The tool shows net gain or loss in population and jobs served.
- Coverage results can be assessed alongside runtime and operating impacts.

### Phase 3 success

- A planner can compare scenarios against land-use-specific demand layers.
- The tool helps staff understand not just how many people are served, but what kinds of destinations and trip generators are improved.
- The tool supports strategic planning decisions about route structure, growth areas, anchor destinations, and access priorities.

## 5. Core User Questions

The feature should help answer the following questions:

- What happens if the route uses this road instead of that road?
- How much runtime does this change add or remove?
- Is the revised concept still workable at the target headway?
- How many buses are required under each option?
- Which segments are driving runtime pressure?
- Where is the data reliable and where is it only a proxy?
- How many residents and jobs gain or lose access under this change?
- Which land uses or major destinations are better served by this option?

## 6. Key Capabilities

### 6.1 Scenario setup

- create a planning project
- create one or more route scenarios
- choose a scenario type:
  - `Shuttle Concept`
  - `Route Concept`
  - `Existing Route Tweak`

### 6.2 Base source loading

- start from a blank concept
- load an existing Barrie route
- load a branch or direction
- load a shuttle starter template

### 6.3 Map authoring

- edit alignment
- edit stops
- define terminals and timed stops
- review context layers and overlays

### 6.4 Runtime intelligence

- use observed stop-to-stop proxy data where available
- compare observed and scheduled runtime
- filter by direction, time period, and day type
- show confidence and sample-size signals
- flag weak or uncertain segments

### 6.5 Planning outputs

- one-way runtime
- cycle time
- buses required
- service hours
- warnings and planning notes
- draft timetable or downstream handoff summary

### 6.6 Market and land use analysis

Phase 2:

- population coverage
- employment coverage
- scenario-to-scenario change analysis

Later phase:

- schools and post-secondary
- hospitals and medical sites
- major retail and employment areas
- industrial lands
- downtown and mixed-use nodes
- growth areas and development pipeline
- GO and regional transfer generators
- equity-priority neighborhoods

## 7. Design Direction

The entire Route Planner experience should be built within the Friendly design theme.

This includes:

- the workspace frame
- the map canvas treatment
- the left and right planning rails
- KPI and warning cards
- scenario comparison surfaces
- runtime confidence panels
- coverage and land use views
- export and handoff screens

The design rule should be:

> operational warmth, not GIS software

The feature should feel like one coherent planning workspace in the same family as the existing Shuttle Planner and On Demand modules, even as more technical analysis layers are added.

## 8. Product Boundaries

Route Planner should not become:

- a GTFS editing tool
- a dispatch tool
- a public trip planner
- a full production schedule editor
- a publishing workflow that bypasses planner review

Route Planner should remain:

- a planning-first workspace for concept testing
- a scenario comparison tool
- a route and service design support tool
- a bridge into downstream schedule work

## 9. Recommended Workspace Structure

### Header

- back
- project name
- scenario picker
- new scenario
- save
- duplicate
- compare toggle
- export or handoff
- status chip

### Left rail

- project and scenario list
- base route source
- stop list
- selected item details

### Center map

- alignment editing
- stop editing
- runtime overlay
- coverage overlay
- future land use overlays

### Right rail tabs

- `Service`
- `Runtime`
- `Coverage`
- `Insights`
- `Output`

### Bottom drawer

- scenario compare table
- before and after deltas
- key findings
- overlay toggles

## 10. Phased Roadmap

| Phase | Focus | Main Outcome |
|------|------|--------------|
| 1 | Route and shuttle scenario editing with runtime intelligence | Staff can test operating feasibility quickly |
| 2 | Population and employment analysis | Staff can compare rider access impacts |
| 3 | Land-use-specific analysis | Staff can support strategic service planning decisions |

## 11. Recommended Product Statement

Route Planner is a planning-first workspace that lets Transit Staff test route concepts, route tweaks, and shuttle concepts on a map, compare them using observed runtime evidence, and understand both operational and rider-facing impacts before moving into schedule development.
