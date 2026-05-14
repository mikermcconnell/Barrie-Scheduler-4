# Route Planner 2 Data Model

## Model Principles

- Project contains routes.
- The current internal type name is `RoutePlanner2Scenario`, but the user-facing product language is “route.”
- A route contains route concept inputs and derived feasibility outputs.
- Derived outputs should be recalculable from inputs.
- Use stable IDs so projects and scenarios can be saved independently.
- Keep Firestore documents small enough for current route concepts; move large artifacts to Storage later if needed.

## Core Types

```typescript
type RoutePlanner2ScenarioStatus = 'draft' | 'review';
type RoutePlanner2RouteShape = 'one-way' | 'closed-loop' | 'out-and-back';
type RoutePlanner2StopRole = 'regular' | 'timed' | 'start-terminal' | 'end-terminal' | 'turnaround';
type RoutePlanner2RuntimeSource =
  | 'observed-proxy'
  | 'observed-scheduled-blend'
  | 'scheduled-proxy'
  | 'partial-scheduled-proxy'
  | 'manual'
  | 'mapbox'
  | 'fallback'
  | 'missing';
type RoutePlanner2RuntimeSourceMode = 'gtfs' | 'mapbox';
```

## Project

```typescript
interface RoutePlanner2Project {
  id: string;
  name: string;
  status: 'local-draft' | 'local-saved' | 'archived';
  selectedScenarioId: string;
  preferredScenarioId?: string;
  scenarios: RoutePlanner2Scenario[];
  createdAt: string;
  updatedAt: string;
}
```

`preferredScenarioId` is the single source of truth for the preferred route. A route should not also carry a separate `preferred` status.

## Route / Scenario Internal Type

```typescript
type RoutePlanner2ScenarioSource =
  | { type: 'blank' }
  | {
      type: 'gtfs';
      routeId?: string;
      routeShortName?: string;
      routeLongName?: string;
      serviceId?: string;
      directionId?: number;
      tripHeadsign?: string;
      shapeId?: string;
      feedVersion?: string;
      importedAt?: string;
    };

interface RoutePlanner2Scenario {
  id: string;
  name: string;
  status: RoutePlanner2ScenarioStatus;
  routeShape: RoutePlanner2RouteShape;
  source?: RoutePlanner2ScenarioSource;
  alignment: RoutePlanner2RoutePoint[];
  stops: RoutePlanner2Stop[];
  turnaroundStopId?: string;
  service: RoutePlanner2ServiceAssumptions;
  runtimeSourceMode?: RoutePlanner2RuntimeSourceMode;
  runtimeEstimates?: RoutePlanner2SegmentRuntime[];
  runtimeOverrides?: Record<string, RoutePlanner2SegmentRuntimeOverride>;
  notes: string;
  feasibility?: RoutePlanner2FeasibilitySummary;
  createdAt: string;
  updatedAt: string;
}
```

`routeShape` defaults to `one-way` for new local draft routes and for older saved local data that does not yet include the field.

## Route Point

```typescript
interface RoutePlanner2RoutePoint {
  id: string;
  lat: number;
  lng: number;
  sequence: number;
  afterStopId?: string;
  beforeStopId?: string;
  segmentSequence?: number;
}
```

Route shape meaning:
- `one-way`: stop sequence is used as drawn.
- `closed-loop`: stop sequence is used as drawn, then the last stop connects back to Stop 1.
- `out-and-back`: stop sequence runs from Stop 1 to the bus turnaround stop, then returns in reverse order to Stop 1. Choosing Out and back automatically marks the far end stop as the turnaround.

`turnaroundStopId` is used only for out-and-back routes. It must point to a stop marked with role `turnaround`; the route type control sets this automatically to the far end stop unless a specific turnaround is supplied.

When `afterStopId` and `beforeStopId` are present, the route point is a route-line waypoint between two adjacent stops. `segmentSequence` orders multiple waypoints within that stop-to-stop segment. V1 creates waypoints by clicking the route line, then dragging the `+` handle to bend the path.

## Stop

```typescript
interface RoutePlanner2Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
  role: RoutePlanner2StopRole;
  source: 'custom' | 'barrie-stop';
  stopCode?: string;
  notes?: string;
}
```

## Service Assumptions

```typescript
interface RoutePlanner2ServiceAssumptions {
  firstTripTime: string;
  lastTripTime: string;
  frequencyMinutes: number;
  startTerminalLayoverMinutes: number;
  endTerminalLayoverMinutes: number;
  intermediateStopDwellSeconds: number;
  dayType?: 'weekday' | 'saturday' | 'sunday';
  planningPeriod?: 'all-day' | 'am-peak' | 'midday' | 'pm-peak' | 'evening';
}
```

Terminal layover fields are planning assumptions for v1 concept feasibility. They are not fixed-route schedule recovery rules.
Intermediate stop dwell is an optional planning allowance added for non-terminal stops only. It stays separate from terminal layover/recovery.

## Feasibility Summary

```typescript
interface RoutePlanner2FeasibilitySummary {
  oneWayRuntimeMinutes: number | null;
  segmentRuntimeMinutes: number | null;
  dwellTimeMinutes: number;
  intermediateStopCount: number;
  cycleTimeMinutes: number | null;
  busesRequired: number | null;
  recoveryTimeMinutes: number | null;
  recoveryPercent: number | null;
  confidence: 'high' | 'medium' | 'low' | 'not-ready';
  segmentSummaries: RoutePlanner2SegmentRuntime[];
  warnings: RoutePlanner2Warning[];
}
```

## Segment Runtime

```typescript
interface RoutePlanner2SegmentRuntime {
  id: string;
  fromStopId: string;
  toStopId: string;
  runtimeMinutes: number | null;
  source: RoutePlanner2RuntimeSource;
  sampleSize?: number;
  scheduledRuntimeMinutes?: number;
  observedRuntimeMinutes?: number;
  matchQuality?: 'exact-code' | 'name' | 'nearby' | 'unmatched';
  matchedFromStopId?: string;
  matchedToStopId?: string;
  matchedRoutes?: string[];
  confidence: 'high' | 'medium' | 'low' | 'missing';
  distanceKm?: number;
  durationSeconds?: number;
  pathFingerprint?: string;
  updatedAt?: string;
  fallbackReason?: string;
}
```

Runtime source values:
- `manual`: planner-entered segment/runtime override.
- `observed-proxy`: observed stop-to-stop runtime evidence.
- `observed-scheduled-blend`: blended estimate from scheduled and observed runtime evidence.
- `scheduled-proxy`: scheduled stop-to-stop runtime evidence.
- `mapbox`: Mapbox Directions estimate for the shaped stop-to-stop path.
- `fallback`: distance/default-speed estimate when stronger evidence is unavailable.
- `missing`: no usable runtime estimate yet.

`runtimeSourceMode` defaults to `mapbox` for new route concepts. In `mapbox` mode, GTFS evidence is ignored and segment runtime uses Mapbox estimates when available, then fallback assumptions. In `gtfs` mode, scheduled GTFS evidence is allowed to outrank Mapbox. Manual overrides remain planner-controlled and still outrank automatic sources.

Runtime evidence fields disclose how automatic estimates were produced:
- `scheduledRuntimeMinutes`: scheduled stop-to-stop runtime used as evidence.
- `observedRuntimeMinutes`: observed stop-to-stop runtime used as evidence.
- `matchQuality`: stop matching method: exact stop code, normalized name, nearby coordinate, or unmatched.
- `matchedFromStopId` / `matchedToStopId`: matched GTFS stop IDs used for evidence.
- `matchedRoutes`: route IDs that contributed matching runtime evidence.

`recoveryTimeMinutes` is the spare time between the estimated full runtime and the scheduled cycle window created by the selected frequency and required buses. Example: 24 minutes of estimated full runtime at 30-minute frequency with 1 bus leaves 6 minutes of recovery. `recoveryPercent` is recovery time divided by estimated full runtime.

Mapbox-derived estimates are cached against a `pathFingerprint` built from the current stop and waypoint coordinates. If the planner moves a stop or line waypoint, stale segment estimates are ignored until the segment is recalculated.

Manual segment overrides are stored separately from Mapbox estimates so automatic recalculation does not erase planner-entered runtime assumptions.

```typescript
interface RoutePlanner2SegmentRuntimeOverride {
  runtimeMinutes: number;
  notes?: string;
  updatedAt: string;
}
```

## Warning

```typescript
interface RoutePlanner2Warning {
  id: string;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  action?: string;
}
```

## Firebase Shape

Route Planner 2 projects are saved in team-scoped Firestore documents:

```text
teams/{teamId}/routePlanner2Projects/{projectId}
teams/{teamId}/routePlanner2Projects/{projectId}/scenarios/{scenarioId}
```

The project document stores metadata such as name, selected route, preferred route, scenario order, scenario count, timestamps, and updatedBy. Each scenario document stores the editable route concept inputs and cached runtime/feasibility outputs.

Large geometry or derived analysis artifacts may move to Firebase Storage later if needed.

## Derived Data Rule

Do not store derived feasibility outputs as the only source of truth. They may be cached, but the route inputs must be enough to recompute them.
