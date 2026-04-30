# Route Planner 2 Data Model

## Model Principles

- Project contains routes.
- The current internal type name is `RoutePlanner2Scenario`, but the user-facing product language is “route.”
- A route contains route concept inputs and derived feasibility outputs.
- Derived outputs should be recalculable from inputs.
- Use stable IDs even in local-only v1.
- Keep shapes compatible with future team-scoped Firebase storage.

## Core Types

```typescript
type RoutePlanner2ScenarioStatus = 'draft' | 'review';
type RoutePlanner2StopRole = 'regular' | 'timed' | 'start-terminal' | 'end-terminal';
type RoutePlanner2RuntimeSource = 'observed-proxy' | 'manual' | 'mapbox' | 'fallback' | 'missing';
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
interface RoutePlanner2Scenario {
  id: string;
  name: string;
  status: RoutePlanner2ScenarioStatus;
  alignment: RoutePlanner2RoutePoint[];
  stops: RoutePlanner2Stop[];
  service: RoutePlanner2ServiceAssumptions;
  runtimeEstimates?: RoutePlanner2SegmentRuntime[];
  runtimeOverrides?: Record<string, RoutePlanner2SegmentRuntimeOverride>;
  notes: string;
  feasibility?: RoutePlanner2FeasibilitySummary;
  createdAt: string;
  updatedAt: string;
}
```

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
  confidence: 'high' | 'medium' | 'low' | 'missing';
  distanceKm?: number;
  durationSeconds?: number;
  pathFingerprint?: string;
  updatedAt?: string;
  fallbackReason?: string;
}
```

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

## Future Firebase Shape

V1 does not implement Firebase persistence, but future storage should likely be team-scoped:

```text
teams/{teamId}/routePlanner2Projects/{projectId}
teams/{teamId}/routePlanner2Projects/{projectId}/scenarios/{scenarioId}
```

Large geometry or derived analysis artifacts may move to Firebase Storage later if needed.

## Derived Data Rule

Do not store derived feasibility outputs as the only source of truth. They may be cached, but the route inputs must be enough to recompute them.
