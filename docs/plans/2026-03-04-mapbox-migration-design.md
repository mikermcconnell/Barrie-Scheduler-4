# Mapbox GL JS Migration Design

**Date**: 2026-03-04
**Status**: Phase 1 COMPLETE
**Scope**: All 9 map components (incremental migration)

**Phase 1 Status**: COMPLETE — StudentPassMap migrated, shared MapBase/MapLabel/DrawControl/mapUtils created.
**Next**: Phase 2 — migrate remaining Analytics maps (CoverageGapMap, ODFlowMapModule, etc.).

---

## Problem

Current mapping uses raw Leaflet 1.9.4 with hand-rolled label positioning (`L.divIcon` + CSS transforms). This produces:
- Misaligned labels/backgrounds on markers
- Dated-looking raster basemap tiles (OSM, CARTO, Esri)
- Janky zoom/pan interactions (no 60fps vector rendering)
- Inconsistent styling across 9 map components
- No built-in label collision detection or clustering

The mapping quality is not at a professional level for a transit planning tool.

## Decision

Migrate from Leaflet to **Mapbox GL JS** via `react-map-gl` (Visgl wrapper).

### Why Mapbox
- **Vector tiles**: Crisp labels at every zoom, smooth 60fps pan/zoom
- **Built-in label engine**: Collision detection, priority-based placement — no manual positioning
- **Industry standard**: Most transit agencies use Mapbox for public-facing and internal tools
- **Professional basemaps**: Clean defaults, fully customizable via Mapbox Studio
- **React integration**: `react-map-gl` provides declarative component API
- **Extensible**: deck.gl layers can be added later for heavy data viz (heatmaps, arc layers)
- **Free tier**: 50k map loads/month covers internal tool usage

### What We're Replacing
| Current (Leaflet) | New (Mapbox GL JS) |
|---|---|
| `L.map()` + `useRef` | `<Map>` component from react-map-gl |
| `L.tileLayer()` raster tiles | Mapbox vector tile styles |
| `L.divIcon()` + CSS transforms | `<Marker>` / `<Popup>` components or symbol layers |
| `L.circleMarker()` | Circle layers or `<Marker>` |
| `L.polyline()` | GeoJSON line layers |
| `L.polygon()` + leaflet-draw | `@mapbox/mapbox-gl-draw` or react-map-gl-draw |
| `leaflet.heat` | Mapbox heatmap layer (native) or deck.gl HeatmapLayer |

## Migration Strategy

**Incremental, one component at a time.** No big-bang rewrite.

### Phase 1: Foundation + StudentPassMap (first)
1. Install `mapbox-gl`, `react-map-gl`, `@mapbox/mapbox-gl-draw`
2. Create shared `MapBase` component with:
   - Mapbox token management (env var)
   - Default style, center, zoom for Barrie
   - Consistent zoom controls, attribution
   - Reusable marker/label components
3. Migrate `StudentPassMap` using the shared foundation
4. Validate: labels, polygon drawing, route shapes, transfer overlays

### Phase 2: Remaining Analytics Maps
5. `CoverageGapMap` — arc layers, status coloring
6. `ODFlowMapModule` — ranked arcs, label collision
7. `ODPairMapModal` — sequential arc animation
8. `ODRouteEstimationModule` — route matching overlay
9. `TransitAppMap` — heatmap, OD desire lines (most complex)

### Phase 3: Performance & Mapping Maps
10. `CascadeRouteMap` — deviation markers, timeline points
11. `StopActivityMap` — heatmap, sparklines, hour slider (most complex)
12. `HeadwayMap` — corridor segments, shared route detection

### Phase 4: Cleanup
13. Remove Leaflet dependencies (`leaflet`, `leaflet-draw`, `leaflet.heat`, `@types/leaflet*`)
14. Remove `leafletCanvasGuard.ts`
15. Remove all `spm-*` CSS classes

## Shared MapBase Component

All 9 components (and any future map features) will use a shared `MapBase`:

```tsx
// components/shared/MapBase.tsx
<MapBase
  center={[44.38, -79.69]}  // Barrie default
  zoom={13}
  style="mapbox://styles/mapbox/light-v11"  // or custom style
  interactive={true}
>
  {/* Layers, markers, popups as children */}
</MapBase>
```

**Shared components (Phase 1 — BUILT):**
- `<MapBase>` — react-map-gl wrapper with Barrie defaults, token management
- `<MapLabel>` — styled dark pill labels (sm/md/lg sizes, optional subtitle)
- `<DrawControl>` — polygon drawing via mapbox-gl-draw
- `mapUtils.ts` — `toGeoJSON()` and `toLineGeoJSON()` coordinate helpers

**Shared components (Phase 2 — to build as needed):**
- `<RouteLayer>` — GeoJSON polyline with route color, opacity, dash pattern
- `<StopMarker>` — circle marker with optional label, color by type
- `<WalkingLeg>` — dashed polyline + midpoint walk time label
- `<TransferCallout>` — amber-bordered transfer info with glow animation
- `<MapStyleSwitcher>` — basemap toggle (satellite/light/dark)
- `<HeatmapLayer>` — reusable heatmap with configurable color ramp

This shared foundation ensures every current and future map feature in the app gets consistent, professional-quality rendering.

## Environment Setup

```env
# .env.local
VITE_MAPBOX_TOKEN=pk.xxxxx
```

Token loaded via `import.meta.env.VITE_MAPBOX_TOKEN`.

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Mapbox free tier exceeded | 50k/month is generous for internal tool; monitor usage |
| leaflet-draw feature parity | `@mapbox/mapbox-gl-draw` supports polygon drawing natively |
| Heatmap performance | Mapbox native heatmap layer is GPU-accelerated; better than leaflet.heat |
| Learning curve | react-map-gl has good docs; migrate simplest components first |
| Bundle size increase | Mapbox GL JS is ~200KB gzipped vs Leaflet ~40KB; acceptable for a desktop-first tool |

## Success Criteria

- [ ] Labels render pixel-perfect at all zoom levels (no alignment bugs)
- [ ] Smooth 60fps pan/zoom on all maps
- [ ] Consistent basemap style across all components
- [ ] Polygon drawing works in StudentPassMap
- [ ] All existing map features preserved (routes, markers, overlays, heatmaps)
- [ ] No Leaflet dependencies remain after Phase 4
