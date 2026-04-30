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
- keep local persistence replaceable
- keep data shapes Firebase-ready
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
- coordinate local persistence when added

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

V1: local state only.

Future: team-scoped Firebase persistence.

The code should avoid coupling UI components directly to Firebase so the local-to-cloud transition is straightforward.

## Integration Rules

- Do not connect Route Planner 2 to downstream scheduling in v1.
- Do not share mutable state with the old Route Planner.
- Do not use old Route Planner docs as binding implementation guidance.
- Do update these docs before changing the module boundary or persistence strategy.
