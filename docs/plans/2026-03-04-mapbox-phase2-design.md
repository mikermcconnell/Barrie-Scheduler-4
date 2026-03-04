# Mapbox GL JS Migration — Phases 2–6: Remaining Maps

**Status**: APPROVED — ready for implementation planning
**Prerequisite**: Phase 1 complete (StudentPassMap + MapBase/MapLabel/DrawControl)
**Scope**: Migrate remaining 9 Leaflet maps (8,631 lines) to Mapbox GL JS

---

## Strategy

1. **Shared components first** — extract reusable Mapbox components before migrating individual maps
2. **Simple → complex** — build confidence on small maps, tackle monsters last
3. **Leaflet removal at the end** — remove all Leaflet packages only after all 9 maps are migrated

---

## Phase 2: Shared Component Library

Extract reusable components that multiple maps need. All shared components live in `components/shared/`.

### New Shared Components

| Component | Purpose | Replaces | Used By (count) |
|-----------|---------|----------|-----------------|
| `ArcLayer` | Curved bezier arcs with optional arrowheads as GeoJSON Source+Layer | `quadraticBezierArc()` + `L.polyline` (duplicated 5x) | CoverageGap, ODFlow, ODPair, ODRoute, TransitApp (5) |
| `RouteOverlay` | GTFS route shape dashed polylines | Repeated GTFS overlay pattern | CoverageGap, Transfers, StopActivity, TransitApp, Cascade (5) |
| `StopDotLayer` | Circle markers for transit stops | `L.circleMarker` stop dot pattern | Headway, StopActivity, TransitApp, Cascade (4) |
| `HeatmapLayer` | Color-scaled circle markers with log binning | Hand-rolled circleMarker heatmaps | TransitApp, StopActivity (2) |
| `LassoControl` | Polygon lasso selection via draw or mouse events | Raw mouse event polygon in StopActivity | StopActivity (1) |

### mapUtils.ts Expansion

Add to existing `components/shared/mapUtils.ts`:
- `quadraticBezierArc(origin, dest, curveDirection, segments)` — returns GeoJSON LineString coordinates
- `arrowheadPoints(tip, bearing, length)` — returns arrowhead barb coordinates
- `fitBoundsToFeatures(map, features, padding)` — shared fitBounds helper
- `toArcGeoJSON(arcs)` — converts arc arrays to GeoJSON FeatureCollection

### Coordinate Convention

All shared components accept `[lat, lng]` (existing data format) and flip internally to `[lng, lat]` for Mapbox. No changes needed in calling code.

### Pane Z-Ordering → Layer Ordering

Leaflet custom panes (`map.createPane()` with z-index) become Mapbox layer declaration order. Layers render bottom-to-top in the order they appear in JSX. This is cleaner and requires no z-index management.

---

## Phase 3: Simple Maps (~1,150 lines)

### 3a. CoverageGapMap (371 lines)
- **Features**: Curved arcs between OD pairs, color-coded by coverage status, GTFS route overlay toggle
- **Shared components used**: ArcLayer, RouteOverlay
- **Migration notes**: Hover dimming → Mapbox `feature-state` or layer filter on hover

### 3b. HeadwayMap (385 lines)
- **Features**: Corridor segments colored by headway severity, junction stop dots at zoom > 14
- **Shared components used**: StopDotLayer (for junction stops)
- **Migration notes**: Corridor polylines become GeoJSON Source+Layer with data-driven `line-color`. Zoom-dependent stop visibility → `minzoom` on layer. Tooltip → Mapbox popup on hover.

### 3c. CascadeRouteMap (395 lines)
- **Features**: GTFS route shape base + trip-colored segments, timepoint stops, custom legend control
- **Shared components used**: RouteOverlay, StopDotLayer
- **Migration notes**: Custom `L.Control` legend → React overlay div (already positioned via CSS). Recovery/bolt markers → `<Marker>` with styled divs.

---

## Phase 4: Medium Maps (~2,720 lines)

### 4a. ODPairMapModal (514 lines)
- **Features**: Single OD pair visualization with animated sequential arc drawing, transfer diamond markers
- **Shared components used**: ArcLayer (base arcs)
- **Migration notes**: **Highest-risk pattern.** SVG `strokeDashoffset` animation → either Mapbox `line-dasharray` with `requestAnimationFrame` stepping, or progressive line segment addition via timer. Sequential leg animation uses setTimeout chain — this pattern transfers directly.
- **Basemap**: CARTO light → `mapbox://styles/mapbox/light-v11`

### 4b. TransfersModule (1,111 lines)
- **Features**: Transfer pair circles, animated hub glow, GTFS route overlay, click-to-isolate stop
- **Shared components used**: RouteOverlay
- **Migration notes**: Dark basemap → `mapbox://styles/mapbox/dark-v11`. Hub glow CSS animation → `<Marker>` with animated div (same pattern as StudentPassMap transfer hub). Dark popup → Mapbox popup with custom className.
- **Basemap**: CARTO dark → `mapbox://styles/mapbox/dark-v11`

### 4c. StopActivityMap (1,095 lines)
- **Features**: 10-bin log-scale heatmap, lasso selection, hourly animation, stop search, GTFS overlay, fullscreen
- **Shared components used**: HeatmapLayer, StopDotLayer, RouteOverlay, LassoControl
- **Migration notes**: Lasso tool is the key challenge. Options: (a) reuse `@mapbox/mapbox-gl-draw` polygon mode, (b) port raw mouse events to Mapbox `map.on()`. Hour slider animation and stop search are React state — transfer directly.

---

## Phase 5: Complex Maps (~3,351 lines)

### 5a. ODFlowMapModule (1,214 lines)
- **Features**: Ranked OD flow arcs, zone markers, 6 custom panes, zoom-dependent rendering modes, label collision avoidance, pulse ring SVG markers
- **Shared components used**: ArcLayer, StopDotLayer
- **Migration notes**: 6 custom panes → Mapbox layer ordering. Zoom modes (overview/corridor/detail) → `minzoom`/`maxzoom` per layer or reactive state. Label collision → Mapbox `text-allow-overlap: false` on symbol layers, or keep manual pixel check via `map.project()`. Pulse SVG → `<Marker>` with CSS animation.

### 5b. TransitAppMap (2,137 lines)
- **Features**: Heatmap, OD arcs with arrowheads, GTFS route + stop overlays, zoom-mode rendering, click-to-isolate, fullscreen, PDF export
- **Shared components used**: ArcLayer, RouteOverlay, StopDotLayer, HeatmapLayer
- **Migration notes**: Largest migration. Consider splitting into sub-components (HeatmapView, ODView, RouteView) that swap based on active tab/mode. Fullscreen → same `requestFullscreen` API. PDF export → `map.getCanvas().toDataURL()` for Mapbox (simpler than Leaflet).

---

## Phase 6: Final Map + Cleanup

### 6a. ODRouteEstimationModule (1,409 lines)
- **Features**: Bar chart markers (SVG HTML), radial gradient glow, flow arcs in custom panes, smart label placement
- **Shared components used**: ArcLayer
- **Migration notes**: Bar chart `L.divIcon` → `<Marker>` with React SVG component. Custom panes → layer ordering. This module is largely a data table with an embedded map — the map portion is moderate complexity.
- **Basemap**: CARTO light → `mapbox://styles/mapbox/light-v11`

### 6b. Remove Leaflet Dependencies
- Remove from `package.json`: `leaflet`, `leaflet-draw`, `leaflet.heat`, `@types/leaflet`, `@types/leaflet-draw`
- Remove any remaining Leaflet CSS imports
- Run `npm install` + `npm run build` to verify clean removal

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| ODPairMapModal arc animation doesn't translate cleanly | High — unique Leaflet SVG trick | Prototype animation approach before full migration. Fallback: instant arc draw (functional, less pretty). |
| Label collision in ODFlowMapModule degrades | Medium — visual quality issue | Try Mapbox symbol layer `text-allow-overlap: false` first. If insufficient, port manual pixel check. |
| TransitAppMap is too large for single migration | High — 2,137 lines, many features | Split into sub-components during migration. Test each feature independently. |
| Mapbox token rate limits in dev | Low — unlikely for single dev | Token already in `.env.local` from Phase 1. |
| Performance regression with many markers | Medium — Leaflet `preferCanvas` was fast | Mapbox GL uses WebGL — should be faster. Use GeoJSON circle layers instead of DOM markers for bulk stops. |

---

## Migration Checklist Per Map

For each map migration:
1. Read full existing component
2. Identify which shared components apply
3. Rewrite using MapBase + shared components
4. Preserve identical props interface (drop-in replacement)
5. `npm run build` — verify no type errors
6. Manual visual verification in dev server
7. Commit with descriptive message
