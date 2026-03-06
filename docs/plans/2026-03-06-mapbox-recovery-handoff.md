# Mapbox Migration Recovery Handoff

Date: 2026-03-06

## Current status

- Build is green as of this note: `npm run build`
- Leaflet maps remaining: `1`
- Remaining Leaflet file:
  - `components/Analytics/TransitAppMap.tsx`

## Completed in this session

- Confirmed the phase tracker doc was stale and reconciled it with the codebase.
- Verified `ODPairMapModal` was already migrated to Mapbox.
- Migrated the transfer-point heatmap inside `components/Analytics/ODRouteEstimationModule.tsx` from Leaflet to Mapbox.
- Migrated `components/Analytics/ODFlowMapModule.tsx` from Leaflet to Mapbox.
- Updated `docs/plans/2026-03-04-mapbox-phase2-design.md` to reflect the real migration state:
  - `ODPairMapModal`: complete
  - `TransfersModule`: complete
  - `StopActivityMap`: complete
  - `ODFlowMapModule`: complete
  - `ODRouteEstimationModule`: complete
  - only `TransitAppMap` remains

## Important repo state

- `components/Analytics/TransitAppMap.tsx` was only explored, not migrated.
- I briefly started editing `TransitAppMap`, then reverted those partial changes before writing this note.
- The repository is back to a buildable state.

## Verified files changed this session

- `components/Analytics/ODFlowMapModule.tsx`
- `components/Analytics/ODRouteEstimationModule.tsx`
- `docs/plans/2026-03-04-mapbox-phase2-design.md`

## TransitAppMap migration notes

### What still uses Leaflet

- Map creation/destruction is still imperative in `TransitAppMap.tsx`
- Layer rebuilds still happen via Leaflet layer groups for:
  - heatmap
  - OD lines
  - GTFS routes
  - GTFS stops
  - coverage gap clusters
- Arc highlighting still depends on stored Leaflet path refs (`odLineGroupsRef`)

### Safe findings from inspection

- PDF export in `TransitAppMap` does **not** capture the map DOM or canvas.
- `exportPDF()` is table/data-driven only, so the map migration does not need special PDF canvas handling.

### Highest-risk hotspots in `TransitAppMap`

1. Imperative Leaflet lifecycle:
   - map init/destroy
   - layer add/remove on every state change
2. OD rendering logic:
   - all-zones overview/corridor/detail modes
   - viewport-capped arc rendering
   - arrowheads
   - rank badges
3. Interaction coupling:
   - hover highlighting via stored Leaflet paths
   - click-to-isolate spider mode
   - popup/tooltip behavior
4. Filter semantics:
   - time/day/season count logic
   - corridor route filter
   - bidirectional merge logic
   - coordinate-key identity based on `toFixed(4)`

## Recommended next step

Migrate `components/Analytics/TransitAppMap.tsx` by preserving the existing filter pipeline and export logic, but replacing only the map runtime with:

- `MapBase`
- `HeatmapDotLayer`
- `ArcLayer`
- `RouteOverlay`
- `StopDotLayer`
- Mapbox `Marker` / `Popup`
- Mapbox fit/resize effects in place of Leaflet `invalidateSize()` / layer rebuilds

## Suggested migration order for TransitAppMap

1. Keep all current filtering and table logic unchanged.
2. Replace map init + layer refs with `MapBase` and `MapRef`.
3. Port heatmap mode first.
4. Port OD mode next:
   - arcs
   - zones
   - isolate mode
   - hover/click highlight
5. Reattach GTFS routes, GTFS stops, and coverage clusters.
6. Reconnect fullscreen + fit-bounds behavior.
7. Run `npm run build`.
8. Manual verification.

## Quick recovery command

If resuming later, start from:

`components/Analytics/TransitAppMap.tsx`

and verify remaining Leaflet usage with:

`rg -n "import L from 'leaflet'|leaflet/dist/leaflet.css" components/Analytics components/Performance components/Mapping`
