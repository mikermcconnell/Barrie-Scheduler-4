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
- map-based segment runtime override popovers for planner-entered travel times
- terminal and timed-stop roles
- Mapbox display and click-to-author interactions
- road-snapped display geometry using Mapbox Directions when a token is available, with straight-line fallback
- large-route rendering safeguards: cap interactive stop labels, use Mapbox stop marker layers for dense routes, virtualize the stop-order rail, keep only selected/high-priority stops as draggable HTML markers, and skip automatic road snapping when segment counts are too high for interactive loading
- copy/move contiguous stop ranges between route concepts for service redesign work
- bus-safe out-and-back routes: choosing Out and back automatically marks the far end stop as the bus turnaround before the return path is treated as valid

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
- attach route-family metadata for Barrie merged A/B routes such as 2A+2B, 7A+7B, and 12A+12B so planners see one route family with editable Out/Back direction concepts
- derive family-level runtime, cycle window, recovery, and shared bus need from the imported direction concepts without merging their stop lists or overwriting their 2A/2B-style labels
- allow multiple selected GTFS patterns to import into the same local workspace as separate route concepts
- allow bulk weekday, Saturday, or Sunday import actions that pass every full-route pattern for that day type through the same import adapter
- convert GTFS stops into Route Planner 2 stops
- convert GTFS shapes into editable route-line waypoints
- convert GTFS `stop_times` into scheduled segment runtime evidence when adjacent stop times are available
- attach source metadata so imported concepts are clearly labelled
- cache parsed import patterns in browser storage for seven days; manual refresh bypasses the cache and reloads the feed through `/api/gtfs`

Rules:
- do not create fixed-route schedule drafts
- do not modify GTFS feeds
- do not import old Route Planner controllers or services

### Address Import Adapter

Owns Excel/CSV address extraction, duplicate merging, geocoding, manual-review diagnostics, and conversion into custom Route Planner 2 stops.

Responsibilities:
- parse messy workbook cells into unique civic addresses
- normalize unit-style and range-style addresses into Mapbox-friendly query variants
- geocode address variants with bounded concurrency
- prefer the server-backed `/api/route-planner-geocode` endpoint in production, with client-side Mapbox fallback where the endpoint is unavailable
- keep unresolved addresses in manual review with diagnostics that explain query, source, status, result count, top result, and confidence rejection reason

Rules:
- never expose Mapbox token values in the UI, logs, or diagnostics
- unresolved addresses must not be silently added to the route
- manual review remains planner-controlled; the app may suggest a corrected address but should not override it silently

### Runtime Evidence Adapter

Future-ready adapter for observed proxy data.

Responsibilities:
- match adjacent stops or segments to evidence
- return fallback estimates when evidence is missing
- explain source and confidence per segment

### Map PDF Export Adapter

Owns the map-first export path for planning review.

Responsibilities:
- ask the map canvas to fit the active route and capture the current rendered map
  as an image
- hide editor-only controls, popovers, and transient metrics during capture
- render export-only stop markers and stop callouts through inline SVG text with
  explicit centered baselines before map capture
- draw the PDF header, KPI cards, and legend as vector jsPDF text/shapes with
  `baseline: 'middle'`
- embed the captured map image into the PDF without rasterizing the header

Rules:
- do not recreate the route map with jsPDF drawing primitives when the app map is
  already the source of truth
- do not rely on plain HTML/CSS label pills for captured export labels; text
  baselines can render low under `html2canvas`
- do not rasterize an SVG header into a PNG; it makes the PDF header text and
  metric cards blurry
- when using direct jsPDF text in tight header cards or legends, set the text
  baseline explicitly instead of relying on the default alphabetic baseline

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

`utils/route-planner-2/routePlanner2ProjectPersistence.ts` owns Firebase access. The workspace calls that service instead of importing Firestore directly. Firestore rules allow team members and workspace permission managers to read/write saved route plans. Large geometry or analysis artifacts can move to Firebase Storage later if the Firestore document sizes become a concern.
Deleting a saved route plan must go through the same persistence service so the project document and its `scenarios` subcollection are removed together.

## Integration Rules

- Do not connect Route Planner 2 to downstream scheduling in v1.
- Do not share mutable state with the old Route Planner.
- Do not use old Route Planner docs as binding implementation guidance.
- Do update these docs before changing the module boundary or persistence strategy.
