# Shuttle Planner PRD

> Date: March 11, 2026
> Status: Draft for implementation planning
> Product fit: Map-first shuttle service planning within Barrie Transit Schedule Builder
> UI companion: `docs/SHUTTLE_PLANNER_UI_SPEC.md`

## 1. Purpose

The Shuttle Planner will let Transit Staff design shuttle services directly on a map, test operating assumptions in real time, and save review-ready scenarios that can move into downstream schedule planning.

This feature is intended for temporary and special-purpose shuttle planning, including:

- construction replacement shuttles
- event shuttles
- station connectors
- seasonal or pilot circulators
- temporary service overlays during service disruptions

The feature is not intended to replace dispatch, AVL, or public trip planning tools.

## 2. Problem Statement

Shuttle concepts are currently difficult to test quickly. Staff typically need to move between maps, spreadsheets, and manual calculations to answer basic planning questions such as:

- Where should the shuttle operate?
- Which stops should it serve?
- Is the route too long for the target frequency?
- How many buses are required?
- What timetable would this concept produce?

This creates friction early in the planning process and makes it harder to compare alternatives.

## 3. Product Goal

Create a map-first planning tool where a user can sketch a shuttle concept, define stops and service rules, and immediately understand whether the concept is operationally viable.

## 4. Definition of Success

The feature is successful if a planner can complete the following workflow without leaving the application:

1. Build a shuttle alignment on a map.
2. Add Barrie Transit stops and custom shuttle stops.
3. Choose an out-and-back or loop service pattern.
4. Define operating assumptions such as span, frequency, recovery, and runtime.
5. Review live operating outputs, including buses required and draft timetable.
6. Save multiple scenarios and compare them visually and numerically.
7. Export or promote the selected concept into downstream planning work.

## 5. Confirmed Product Decisions

The following decisions were confirmed during feature definition:

| Topic | Decision |
|------|----------|
| Primary interaction model | Map-first user input |
| Road handling in v1 | Alignment snaps to roads |
| Stop sources | Both Barrie Transit stops and custom stops |
| Output types | Both map output and timetable output |
| Service patterns | Out-and-back and loop |
| Scenario comparison | Both visual map comparison and metrics comparison |
| Visual reference | Copy the Transit On Demand workspace theme |

## 5A. Visual Direction

The Shuttle Planner should use the Transit On Demand workspace as its direct visual reference. This means the feature should inherit the same overall UI theme rather than introducing a new visual language.

The intended theme includes:

- bright, high-contrast workspace with white cards on soft gray backgrounds
- rounded panel treatments with strong but clean borders
- bold header treatment with visible actions and segmented controls
- color-coded KPI and status cards
- dense but readable information layout
- desktop-first working surface with polished panel hierarchy

The Shuttle Planner should not copy the On Demand workspace structure exactly. Instead, it should apply the same theme to a map-first layout:

- left panel for project, scenario, and stop management
- center panel as the primary map canvas
- right panel for assumptions, metrics, and timetable output

External web inspiration is optional at this stage. It may still help later for specific map interactions, but the baseline design direction is already defined by the existing Transit On Demand workspace.

## 6. Non-Goals

The Shuttle Planner will not include the following in v1:

- live dispatch or vehicle assignment
- AVL or CAD integration
- rider-facing trip planning
- operator run-cutting
- full fixed-route network redesign
- detailed on-demand dispatch logic
- automatic publish to final schedule without planner review

## 7. Primary Users

| User | Role | Primary Need |
|------|------|--------------|
| Transit Planner | Service design | Create and test shuttle concepts quickly |
| Transit Projects Lead | Project planning | Evaluate temporary service options for construction, events, or pilots |
| Operations Manager | Review | Understand service feasibility and compare alternatives |

## 8. Core User Stories

### Route design

- As a planner, I want to draw a shuttle alignment on a map so that I can test a service concept spatially.
- As a planner, I want the route to snap to roads so that the alignment reflects a realistic path.
- As a planner, I want to build either a loop or an out-and-back shuttle so that the tool supports common shuttle formats.

### Stop planning

- As a planner, I want to add existing Barrie Transit stops so that the shuttle can connect cleanly with the current network.
- As a planner, I want to add custom stops so that I can represent temporary terminals, event venues, parking lots, or construction pickup points.
- As a planner, I want to reorder or remove stops easily so that I can refine the concept without rebuilding it.

### Service definition

- As a planner, I want to set service span, frequency, layover, and runtime assumptions so that I can test different operating models.
- As a planner, I want the tool to estimate buses required and cycle time so that I can screen out infeasible options quickly.

### Review and comparison

- As a planner, I want a draft timetable generated from the service assumptions so that I can understand what the concept looks like operationally.
- As a planner, I want to compare scenarios side by side and on the map so that I can choose the most practical option.
- As a manager, I want a summary output with the route map, stop list, and service metrics so that I can review the proposal quickly.

## 9. Core Workflow

1. Open Shuttle Planner workspace.
2. Create a new shuttle project or open an existing one.
3. Select service pattern: out-and-back or loop.
4. Draw or edit the shuttle alignment on the map.
5. Add stops from Barrie Transit stop inventory or create custom stops.
6. Order stops and confirm terminals or anchor points.
7. Enter service assumptions.
8. Review live metrics and generated timetable.
9. Save scenario or duplicate to test an alternative.
10. Compare scenarios.
11. Export the preferred concept or send it to downstream schedule planning.

## 10. Screen and Module Breakdown

### 10.1 Workspace Structure

The Shuttle Planner should be a dedicated top-level workspace, similar to Fixed Route, On Demand, and Performance.

**Proposed workspace file**

- `components/workspaces/ShuttlePlannerWorkspace.tsx`

### 10.2 Primary Screen Layout

The workspace should use a three-pane layout:

| Region | Purpose |
|------|---------|
| Left panel | Project and scenario management, stop list, route settings |
| Center panel | Full map canvas for route and stop editing |
| Right panel | Service assumptions, live metrics, warnings, timetable preview |

### 10.3 Proposed UI Modules

| Module | Responsibility | Proposed Path |
|------|----------------|--------------|
| Shuttle planner workspace | Route-level shell, routing, tab state | `components/workspaces/ShuttlePlannerWorkspace.tsx` |
| Project sidebar | Project/scenario list, duplicate, rename, delete | `components/ShuttlePlanner/ShuttleProjectSidebar.tsx` |
| Map canvas | Draw, edit, snap, hover, select, compare overlays | `components/ShuttlePlanner/ShuttleMapCanvas.tsx` |
| Stop panel | Stop list, stop properties, sequence editing | `components/ShuttlePlanner/ShuttleStopPanel.tsx` |
| Service rules panel | Span, frequency, recovery, runtime assumptions | `components/ShuttlePlanner/ShuttleServicePanel.tsx` |
| Metrics panel | Runtime, distance, buses, hours, validation | `components/ShuttlePlanner/ShuttleMetricsPanel.tsx` |
| Timetable preview | Generated departures and cycle view | `components/ShuttlePlanner/ShuttleTimetablePanel.tsx` |
| Comparison panel | Scenario compare table and overlay toggles | `components/ShuttlePlanner/ShuttleComparisonPanel.tsx` |
| Export modal | Summary export and downstream handoff | `components/ShuttlePlanner/ShuttleExportModal.tsx` |

### 10.4 Reuse Opportunities

The following existing modules and utilities should be reused where possible:

| Existing Asset | Reuse Opportunity |
|------|------------------|
| `components/shared/MapBase.tsx` | Base map container and map lifecycle |
| `components/shared/RouteOverlay.tsx` | Overlay rendering for route geometry |
| `components/shared/StopDotLayer.tsx` | Stop point rendering |
| `utils/gtfs/gtfsShapesLoader.ts` | Barrie route geometry reference if needed |
| `utils/gtfs/gtfsStopLookup.ts` | Existing stop lookup and Barrie stop matching |
| `utils/services/newScheduleProjectService.ts` | Pattern for user-scoped project persistence |
| `utils/services/draftService.ts` | Draft lifecycle pattern |

## 11. Functional Requirements

### 11.1 Map-based route creation

- User can create a new alignment by placing ordered waypoints on the map.
- The alignment snaps to the road network in v1.
- User can insert, move, or delete alignment points.
- User can switch between edit mode and review mode.
- User can toggle between base map and context overlays.

### 11.2 Stop management

- User can add an existing Barrie Transit stop to the shuttle.
- User can create a custom stop with name, description, and coordinates.
- User can drag or move custom stops on the map.
- User can assign stop roles such as terminal, intermediate stop, or timed stop.
- User can reorder stops in the stop list, and the map updates accordingly.

### 11.3 Service definition

- User can choose loop or out-and-back service type.
- User can define service span, first trip, last trip, and target frequency.
- User can define recovery or layover assumptions.
- User can define runtime inputs using either:
  - route-level runtime assumption
  - segment-level runtime assumptions
- User can define different assumptions for peak and off-peak periods in a later phase if needed.

### 11.4 Live metrics

- The tool must calculate route distance.
- The tool must estimate one-way runtime.
- The tool must calculate round-trip cycle time.
- The tool must estimate buses required for the selected headway.
- The tool must estimate daily service hours.
- The tool must warn when the selected frequency is not feasible with the current cycle time or recovery assumptions.

### 11.5 Timetable output

- The tool must generate a draft timetable from the operating assumptions.
- The timetable must align with the selected service pattern.
- The timetable must update when the route, stops, or service inputs change.
- The timetable must be suitable for planner review and downstream schedule work, even if later editing happens elsewhere in the app.

### 11.6 Scenario management

- User can save a shuttle concept as a scenario draft.
- User can duplicate a scenario and modify it without overwriting the source.
- User can compare scenarios on the map.
- User can compare scenarios in a metrics table.
- User can add planner notes and assumptions to each scenario.

### 11.7 Export and handoff

- User can export a concept summary with route map, stop list, assumptions, and metrics.
- User can export timetable output for working use.
- User can promote a selected scenario into a downstream scheduling workflow in a later implementation step.

## 12. Interaction Rules

### 12.1 Alignment rules

- Alignment points must remain ordered.
- The system should preserve route continuity after edits.
- Road snap should prefer drivable geometry over straight-line geometry.
- User edits must remain reversible through undo/redo where practical.

### 12.2 Service pattern rules

- `Loop`: route begins and ends at the same terminal or anchor area.
- `Out-and-back`: route includes an outbound and return path, which may share or differ by segment.
- The UI must make directionality legible on the map and in the stop list.

### 12.3 Stop rules

- Existing Barrie stops keep their source identifiers when selected.
- Custom stops require user-entered names.
- The tool must clearly distinguish Barrie stops from custom stops.
- Timed stops and terminals must be visually distinct.

### 12.4 Timetable rules

- Timetable generation must reflect the selected service pattern.
- Round-trip logic must account for recovery or layover at the appropriate terminal or loop point.
- Runtime edits must update generated departures immediately or near-immediately.

### 12.5 Comparison rules

- Users must be able to turn scenario overlays on and off independently.
- The compare table must include core metrics such as distance, runtime, buses required, and service hours.
- The currently selected base scenario should remain obvious in the UI.

## 13. Data Model

### 13.1 Domain Objects

#### ShuttleProject

Container for one planning exercise. A project may include multiple scenarios.

```ts
interface ShuttleProject {
  id: string;
  name: string;
  description?: string;
  teamId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  preferredScenarioId?: string;
}
```

#### ShuttleScenario

Represents one shuttle concept under a project.

```ts
type ShuttleServicePattern = 'loop' | 'out_and_back';

interface ShuttleScenario {
  id: string;
  projectId: string;
  name: string;
  notes?: string;
  servicePattern: ShuttleServicePattern;
  alignment: ShuttleAlignment;
  stops: ShuttleStop[];
  servicePlan: ShuttleServicePlan;
  metrics?: ShuttleScenarioMetrics;
  timetable?: ShuttleTimetable;
  status: 'draft' | 'ready_for_review';
  createdAt: string;
  updatedAt: string;
}
```

#### ShuttleAlignment

```ts
interface ShuttleAlignment {
  roadSnapMode: 'required';
  geometry: GeoJSON.LineString;
  waypointCount: number;
  source: 'manual_map_input';
}
```

#### ShuttleStop

```ts
type ShuttleStopSource = 'barrie_stop' | 'custom';
type ShuttleStopRole = 'terminal' | 'timed' | 'regular';

interface ShuttleStop {
  id: string;
  source: ShuttleStopSource;
  barrieStopId?: string;
  name: string;
  sequence: number;
  role: ShuttleStopRole;
  latitude: number;
  longitude: number;
  notes?: string;
}
```

#### ShuttleServicePlan

```ts
interface ShuttleServicePlan {
  firstDeparture: string;
  lastDeparture: string;
  frequencyMinutes: number;
  layoverMinutes: number;
  runtimeMode: 'route_level' | 'segment_level';
  routeRuntimeMinutes?: number;
  segmentRuntimeMinutes?: number[];
}
```

#### ShuttleScenarioMetrics

```ts
interface ShuttleScenarioMetrics {
  totalDistanceKm: number;
  estimatedOneWayRuntimeMinutes?: number;
  cycleTimeMinutes: number;
  busesRequired: number;
  dailyServiceHours: number;
  validationWarnings: string[];
}
```

#### ShuttleTimetable

```ts
interface ShuttleTimetable {
  outboundTrips: ShuttleTrip[];
  inboundTrips?: ShuttleTrip[];
  loopTrips?: ShuttleTrip[];
}

interface ShuttleTrip {
  tripId: string;
  departureTime: string;
  arrivalTime: string;
  stopTimes: Array<{
    stopId: string;
    time: string;
  }>;
}
```

### 13.2 Proposed Firestore Pattern

This feature should follow existing app patterns by separating working state from shared outputs.

**User-scoped working state**

```text
users/{userId}/shuttleProjects/{projectId}
users/{userId}/shuttleProjects/{projectId}/scenarios/{scenarioId}
```

**Team-scoped shared outputs**

```text
teams/{teamId}/shuttlePlans/{planId}
teams/{teamId}/shuttlePlans/{planId}/versions/{versionId}
```

This keeps early exploration lightweight while preserving a path to shared reviewed concepts.

## 14. Validation Rules

- A scenario must have at least two stops before timetable generation is enabled.
- An out-and-back scenario must identify the outbound and return order clearly.
- A loop must return to the origin terminal or equivalent end point.
- Custom stops must have coordinates and names.
- Frequency and cycle time must produce a valid bus requirement greater than zero.
- Runtime assumptions must be present before timetable generation.

## 15. Proposed Service Layer and Utility Breakdown

| Area | Proposed Path |
|------|---------------|
| Shuttle types | `utils/shuttle/shuttleTypes.ts` |
| Geometry editing and ordering | `utils/shuttle/shuttleGeometry.ts` |
| Road snap adapter | `utils/shuttle/shuttleRoadSnapService.ts` |
| Stop utilities | `utils/shuttle/shuttleStopUtils.ts` |
| Metrics calculator | `utils/shuttle/shuttleMetrics.ts` |
| Timetable generator | `utils/shuttle/shuttleTimetable.ts` |
| Validation rules | `utils/shuttle/shuttleValidation.ts` |
| Project persistence | `utils/services/shuttleProjectService.ts` |
| Shared/published plans | `utils/services/shuttlePlanService.ts` |

## 16. Phased Implementation Plan

### Phase 1: Domain model and persistence

Objective: establish types, draft persistence, and workspace shell.

Deliverables:

- shuttle domain types
- user-scoped project and scenario service
- empty Shuttle Planner workspace
- project list and scenario management shell

### Phase 2: Map-first route builder

Objective: allow users to create and edit road-snapped shuttle alignments.

Deliverables:

- map canvas component
- waypoint placement and editing
- road snap integration
- stop placement from map interaction
- support for Barrie and custom stops

### Phase 3: Service rules and live metrics

Objective: make the concept operationally useful.

Deliverables:

- service rules panel
- cycle time and bus requirement calculations
- validation warnings
- stop sequencing and terminal logic

### Phase 4: Timetable generation

Objective: produce a draft timetable from the map-defined concept.

Deliverables:

- timetable generation utilities
- timetable preview panel
- loop and out-and-back support
- downstream export shape definition

### Phase 5: Scenario comparison and export

Objective: support decision-making and review.

Deliverables:

- duplicate and compare scenarios
- map overlay comparison
- compare table
- exportable concept summary

### Phase 6: Shared review and downstream integration

Objective: integrate the shuttle planner into the broader app workflow.

Deliverables:

- team-level published shuttle plans
- version history
- optional handoff into schedule editing or report generation

## 17. Acceptance Criteria for v1

The v1 feature will be considered complete when:

- A user can create a shuttle project and save multiple scenarios.
- A user can build a road-snapped loop or out-and-back alignment on the map.
- A user can add both Barrie stops and custom stops.
- A user can define service assumptions and receive live metrics.
- A user can generate a draft timetable from the scenario.
- A user can compare at least two scenarios on the map and in a metrics panel.
- A user can export a review-ready concept summary.

## 18. Risks and Watch Items

| Risk | Why It Matters | Mitigation |
|------|----------------|-----------|
| Road snap complexity | Can expand scope quickly if the routing provider is not constrained | Keep v1 focused on one provider and a small, stable interaction model |
| Timetable credibility | A weak generator reduces planner trust | Keep assumptions explicit and show the math |
| Map editing complexity | Editing geometry and stops can become fragile | Start with ordered waypoints and limited edit modes |
| Data model drift | Early prototypes can bypass draft patterns | Use explicit user project and team publish patterns from the start |
| Scope creep into on-demand | Shuttle planning can drift into dispatch logic | Hold the line on planning-only use cases |

## 19. Recommended Next Step

Use this PRD to define:

1. a UI wireframe for the workspace
2. the shuttle domain types and Firestore schema
3. the implementation sequence for Phase 1 and Phase 2

Once implementation starts, durable outcomes should be copied into:

- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`
