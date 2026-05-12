# Route Planner 2 Architecture

## Boundary

Route Planner 2 is intentionally isolated from the old Route Planner implementation.

Do not import from old Route Planner controllers, draft storage, project services, or map editing utilities unless a future design explicitly approves a shared extraction.

Current shell:
- `components/Analytics/RoutePlanner2Workspace.tsx`
- `components/Analytics/route-planner-2/RoutePlanner2MapCanvas.tsx`
- `utils/route-planner-2/routePlanner2RoadSnap.ts`

Expected future folders:
- `components/Analytics/route-planner-2/`
- `utils/route-planner-2/`

## Architecture Goals

- keep UI composition separate from domain calculations
- keep map authoring separate from feasibility logic
- keep persistence isolated behind Route Planner 2 services
- make runtime assumptions explainable

## Suggested Module Slices

### Workspace Shell

Owns high-level layout and selected project/route state.

Possible files:
- `RoutePlanner2Workspace.tsx`
- `route-planner-2/RoutePlanner2Header.tsx`
- `route-planner-2/RoutePlanner2LeftRail.tsx`
- `route-planner-2/RoutePlanner2Map.tsx`
- `route-planner-2/RoutePlanner2RightRail.tsx`

### Project Controller

Owns project and route operations.

Responsibilities:
- create route
- duplicate route
- delete route
- rename project/route
- select active route
- mark preferred route
- coordinate team-scoped persistence through the Route Planner 2 persistence service

### Map Authoring State

Owns editable alignment and stops.

Responsibilities:
- route points
- stop placement
- stop ordering
- selected map object
- terminal and timed-stop roles
- Mapbox display and click-to-author interactions
- road-snapped display geometry using Mapbox Directions when a token is available, with straight-line fallback
- copy/move contiguous stop ranges between route concepts for service redesign work
- bus-safe out-and-back routes: no implicit U-turn or 3-point turn; a planner must mark a bus turnaround stop before the return path is treated as valid

### Feasibility Engine

Pure calculation layer.

Inputs:
- ordered stops
- alignment distance or segment estimates
- service assumptions
- runtime evidence where available

Outputs:
- one-way runtime
- cycle time
- buses required
- confidence
- warnings


### GTFS Template Import Adapter

Owns conversion from GTFS route patterns into Route Planner 2 scenarios.

Responsibilities:
- fetch or receive parsed GTFS feed data
- group trips into selectable full-route patterns and filter out partial/short-turn patterns
- allow multiple selected GTFS patterns to import into the same local workspace as separate route concepts
- convert GTFS stops into Route Planner 2 stops
- convert GTFS shapes into editable route-line waypoints
- convert GTFS `stop_times` into scheduled segment runtime evidence when adjacent stop times are available
- attach source metadata so imported concepts are clearly labelled

Rules:
- do not create fixed-route schedule drafts
- do not modify GTFS feeds
- do not import old Route Planner controllers or services

### Runtime Evidence Adapter

Future-ready adapter for observed proxy data.

Responsibilities:
- match adjacent stops or segments to evidence
- return fallback estimates when evidence is missing
- explain source and confidence per segment

## Data Flow

```text
Project state
  └─ selected route
      ├─ map authoring state
      ├─ service assumptions
      └─ runtime evidence request
             ↓
      feasibility engine
             ↓
      KPI cards, warnings, comparison table, summary
```

## Persistence Strategy

Current: team-scoped Firestore save/load.

Projects are saved under:

```text
teams/{teamId}/routePlanner2Projects/{projectId}
teams/{teamId}/routePlanner2Projects/{projectId}/scenarios/{scenarioId}
```

`utils/route-planner-2/routePlanner2ProjectPersistence.ts` owns Firebase access. The workspace calls that service instead of importing Firestore directly. Large geometry or analysis artifacts can move to Firebase Storage later if the Firestore document sizes become a concern.

## Integration Rules

- Do not connect Route Planner 2 to downstream scheduling in v1.
- Do not share mutable state with the old Route Planner.
- Do not use old Route Planner docs as binding implementation guidance.
- Do update these docs before changing the module boundary or persistence strategy.
