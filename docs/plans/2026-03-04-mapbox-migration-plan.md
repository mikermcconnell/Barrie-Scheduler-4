# Mapbox GL JS Migration — Phase 1: Foundation + StudentPassMap

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace StudentPassMap's Leaflet implementation with Mapbox GL JS via react-map-gl, establishing a shared MapBase foundation that all 9 map components will reuse.

**Architecture:** Shared `MapBase` React component wraps `react-map-gl` `<Map>` with Barrie defaults. Reusable sub-components (`MapLabel`, `RouteLayer`, `DrawControl`) eliminate hand-rolled Leaflet hacks. StudentPassMap is rebuilt as a composition of these shared pieces.

**Tech Stack:** `mapbox-gl`, `react-map-gl/mapbox`, `@mapbox/mapbox-gl-draw`, TypeScript, React 19

**Design doc:** `docs/plans/2026-03-04-mapbox-migration-design.md`

---

## Task 1: Install Mapbox Dependencies

**Files:**
- Modify: `package.json`
- Create: `.env.local` (if not exists — **do NOT commit this file**)

**Step 1: Install packages**

```bash
npm install mapbox-gl react-map-gl @mapbox/mapbox-gl-draw
npm install -D @types/mapbox-gl
```

**Step 2: Add Mapbox token to environment**

Create or update `.env.local`:
```
VITE_MAPBOX_TOKEN=pk.your_token_here
```

Verify `.env.local` is in `.gitignore`. If not, add it.

**Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add mapbox-gl, react-map-gl, mapbox-gl-draw dependencies"
```

---

## Task 2: Create Shared MapBase Component

**Files:**
- Create: `components/shared/MapBase.tsx`

This component is the foundation for ALL map components in the app (current 9 + future). Every map will use `<MapBase>` instead of raw Leaflet initialization.

**Step 1: Create the shared directory and component**

```tsx
// components/shared/MapBase.tsx
import React from 'react';
import Map from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

/** Barrie, ON city center */
const BARRIE_CENTER = { longitude: -79.69, latitude: 44.38 };

export interface MapBaseProps {
    /** Initial longitude. Defaults to Barrie center. */
    longitude?: number;
    /** Initial latitude. Defaults to Barrie center. */
    latitude?: number;
    /** Initial zoom level. Defaults to 13. */
    zoom?: number;
    /** Mapbox style URL. Defaults to light-v11. */
    mapStyle?: string;
    /** Whether the map is interactive (pan/zoom). Defaults to true. */
    interactive?: boolean;
    /** Additional CSS class for the container div. */
    className?: string;
    /** Inline styles for the container div. */
    style?: React.CSSProperties;
    /** Child components (Markers, Sources, Layers, Controls). */
    children?: React.ReactNode;
    /** Callback when map finishes loading. */
    onLoad?: () => void;
}

/**
 * Shared map foundation for all map components.
 * Wraps react-map-gl with Barrie defaults and consistent styling.
 *
 * Usage:
 * ```tsx
 * <MapBase zoom={14} mapStyle="mapbox://styles/mapbox/satellite-streets-v12">
 *   <Source id="route" type="geojson" data={routeGeoJson}>
 *     <Layer type="line" paint={{ 'line-color': '#f00', 'line-width': 3 }} />
 *   </Source>
 *   <Marker longitude={-79.69} latitude={44.38}>
 *     <MapLabel text="School Name" />
 *   </Marker>
 * </MapBase>
 * ```
 */
export const MapBase: React.FC<MapBaseProps> = ({
    longitude = BARRIE_CENTER.longitude,
    latitude = BARRIE_CENTER.latitude,
    zoom = 13,
    mapStyle = 'mapbox://styles/mapbox/light-v11',
    interactive = true,
    className,
    style,
    children,
    onLoad,
}) => {
    return (
        <Map
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{ longitude, latitude, zoom }}
            mapStyle={mapStyle}
            interactive={interactive}
            style={{ width: '100%', height: '100%', minHeight: 300, ...style }}
            className={className}
            onLoad={onLoad}
            scrollZoom={{ speed: 0.5, smooth: true }}
            dragRotate={false}
            pitchWithRotate={false}
        >
            {children}
        </Map>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds. `MapBase` is importable but not yet used.

**Step 3: Commit**

```bash
git add components/shared/MapBase.tsx
git commit -m "feat(map): add shared MapBase component with Barrie defaults"
```

---

## Task 3: Create MapLabel Component

**Files:**
- Create: `components/shared/MapLabel.tsx`

Replaces all `L.divIcon` + CSS transform label hacks with a clean React component.

**Step 1: Create the component**

```tsx
// components/shared/MapLabel.tsx
import React from 'react';

export interface MapLabelProps {
    /** Primary text to display. */
    text: string;
    /** Optional secondary line below the main text. */
    subtitle?: string;
    /** Size variant. Defaults to 'md'. */
    size?: 'sm' | 'md' | 'lg';
    /** Border color override. Defaults to white. */
    borderColor?: string;
    /** Background color override. Defaults to dark gray. */
    bgColor?: string;
}

const SIZE_CLASSES = {
    sm: 'text-[11px] px-2 py-0.5 font-semibold',
    md: 'text-xs px-2.5 py-1 font-bold',
    lg: 'text-[13px] px-4 py-1.5 font-extrabold',
} as const;

/**
 * Styled map label for use inside react-map-gl <Marker> components.
 * Renders a dark pill with white text — no manual CSS transforms needed.
 *
 * Usage:
 * ```tsx
 * <Marker longitude={lon} latitude={lat} anchor="bottom">
 *   <MapLabel text="Barrie North Collegiate" size="lg" />
 * </Marker>
 * ```
 */
export const MapLabel: React.FC<MapLabelProps> = ({
    text,
    subtitle,
    bgColor = '#111827',
    borderColor = 'rgba(255,255,255,0.85)',
    size = 'md',
}) => {
    return (
        <div
            className={`${SIZE_CLASSES[size]} whitespace-nowrap rounded leading-tight`}
            style={{
                background: bgColor,
                color: 'white',
                border: `1.5px solid ${borderColor}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
        >
            <div>{text}</div>
            {subtitle && (
                <div className="text-[10px] font-medium text-gray-300 mt-0.5">{subtitle}</div>
            )}
        </div>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add components/shared/MapLabel.tsx
git commit -m "feat(map): add shared MapLabel component for map markers"
```

---

## Task 4: Create DrawControl Component

**Files:**
- Create: `components/shared/DrawControl.tsx`

Wraps `@mapbox/mapbox-gl-draw` for polygon drawing via `react-map-gl`'s `useControl` hook. Used by StudentPassMap for service area drawing.

**Step 1: Create the component**

```tsx
// components/shared/DrawControl.tsx
import { useControl } from 'react-map-gl/mapbox';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

export interface DrawControlProps {
    /** Called when a polygon is created. Receives array of [lng, lat] coordinate pairs. */
    onCreate?: (coords: [number, number][]) => void;
    /** Called when a polygon is edited. Receives updated [lng, lat] coordinate pairs. */
    onUpdate?: (coords: [number, number][]) => void;
    /** Called when a polygon is deleted. */
    onDelete?: () => void;
    /** Position of the draw controls on the map. Defaults to 'top-right'. */
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    /** Polygon fill color. Defaults to blue. */
    fillColor?: string;
    /** Polygon line color. Defaults to blue. */
    lineColor?: string;
}

function extractCoords(e: { features: GeoJSON.Feature[] }): [number, number][] | null {
    const feature = e.features[0];
    if (!feature || feature.geometry.type !== 'Polygon') return null;
    // mapbox-gl-draw returns [lng, lat], keep that format
    return (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
}

/**
 * Polygon draw control for react-map-gl maps.
 * Wraps @mapbox/mapbox-gl-draw via useControl hook.
 *
 * NOTE: Callbacks return coordinates as [longitude, latitude] (Mapbox convention).
 * If your data model uses [lat, lng], flip them in the callback.
 *
 * Usage:
 * ```tsx
 * <MapBase>
 *   <DrawControl
 *     onCreate={(coords) => console.log('Polygon drawn', coords)}
 *     onDelete={() => console.log('Polygon deleted')}
 *   />
 * </MapBase>
 * ```
 */
export const DrawControl: React.FC<DrawControlProps> = ({
    onCreate,
    onUpdate,
    onDelete,
    position = 'top-right',
    fillColor = '#3B82F6',
    lineColor = '#1D4ED8',
}) => {
    useControl(
        () => {
            const draw = new MapboxDraw({
                displayControlsDefault: false,
                controls: { polygon: true, trash: true },
                defaultMode: 'simple_select',
                styles: [
                    // Polygon fill
                    {
                        id: 'gl-draw-polygon-fill',
                        type: 'fill',
                        filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                        paint: { 'fill-color': fillColor, 'fill-opacity': 0.25 },
                    },
                    // Polygon outline
                    {
                        id: 'gl-draw-polygon-stroke',
                        type: 'line',
                        filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                        paint: { 'line-color': lineColor, 'line-width': 2 },
                    },
                    // Vertex points
                    {
                        id: 'gl-draw-point',
                        type: 'circle',
                        filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
                        paint: { 'circle-radius': 5, 'circle-color': lineColor },
                    },
                ],
            });
            return draw;
        },
        {
            position,
        },
        // Event handlers
        {
            onCreate: (e: { features: GeoJSON.Feature[] }) => {
                const coords = extractCoords(e);
                if (coords && onCreate) onCreate(coords);
            },
            onUpdate: (e: { features: GeoJSON.Feature[] }) => {
                const coords = extractCoords(e);
                if (coords && onUpdate) onUpdate(coords);
            },
            onDelete: () => {
                if (onDelete) onDelete();
            },
        }
    );

    return null;
};
```

> **Note:** `@mapbox/mapbox-gl-draw` may not have TS types bundled. If build fails with type errors, add a declaration file `types/mapbox-gl-draw.d.ts`:
> ```ts
> declare module '@mapbox/mapbox-gl-draw' {
>     const MapboxDraw: any;
>     export default MapboxDraw;
> }
> ```

**Step 2: Verify build**

```bash
npm run build
```

Fix any type issues with the mapbox-gl-draw declaration if needed.

**Step 3: Commit**

```bash
git add components/shared/DrawControl.tsx
git commit -m "feat(map): add shared DrawControl for polygon drawing"
```

---

## Task 5: Rewrite StudentPassMap with Mapbox GL JS

**Files:**
- Rewrite: `components/Analytics/StudentPassMap.tsx` (489 lines → estimated ~350 lines)

This is the main migration task. Replace all Leaflet code with react-map-gl components using the shared foundation. **The props interface (`StudentPassMapProps`) stays identical** — this is a drop-in replacement.

**Important coordinate convention:** Mapbox uses `[longitude, latitude]` while the existing code uses `[latitude, longitude]`. All coordinate conversions must be handled carefully.

**Step 1: Read the full current file**

Read `components/Analytics/StudentPassMap.tsx` end-to-end. Understand every feature:
- School pin marker + label (lines 189-213)
- Zone stop markers (lines 223-245)
- Walking leg polylines + labels (lines 248-281, 395-415, 422-432, 469-479)
- Boarding stop marker (lines 283-296)
- GTFS route shape polylines (lines 299-312, 435-466)
- Transfer hub glow + callout (lines 315-374)
- Travel time labels on route segments (lines 349-392)
- Polygon drawing via leaflet-draw (lines 107-166)

**Step 2: Rewrite the component**

Replace the entire file. Key mappings from Leaflet → Mapbox:

| Leaflet pattern | Mapbox replacement |
|---|---|
| `L.map()` + `useRef` | `<MapBase>` component |
| `L.circleMarker()` | `<Marker>` with styled div, or circle layer via `<Source>`+`<Layer>` |
| `L.divIcon()` + CSS transforms | `<Marker>` + `<MapLabel>` |
| `L.polyline()` | `<Source type="geojson">` + `<Layer type="line">` |
| `L.polygon()` via leaflet-draw | `<DrawControl>` component |
| `L.tileLayer()` satellite | `mapStyle="mapbox://styles/mapbox/satellite-streets-v12"` |
| Injected `<style>` tag (MAP_STYLES) | Remove entirely — Tailwind + inline styles on Marker children |

**Coordinate flip helper** (add at top of file):
```tsx
/** Convert [lat, lng] to GeoJSON [lng, lat] */
const toGeoJSON = (latLng: [number, number]): [number, number] => [latLng[1], latLng[0]];
```

**GeoJSON line builder** (add at top of file):
```tsx
function toLineGeoJSON(points: [number, number][]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: points.map(toGeoJSON),
            },
        }],
    };
}
```

**Key implementation notes:**
- The `onPolygonComplete` callback expects `[lat, lng][]` — DrawControl returns `[lng, lat][]`, so flip in the callback
- Route shapes from `result.routeShapes` have `points` as `[lat, lng][]` — flip for GeoJSON sources
- Use `<Marker anchor="bottom">` for labels that should appear above pins
- Transfer hub glow animation: use CSS `@keyframes` on a div inside `<Marker>`
- Walking legs use dashed lines: `'line-dasharray': [4, 8]`
- Each `<Source>` needs a unique `id` — use descriptive names like `route-shape-0`, `walk-to-stop`, etc.

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Manual verification**

Open dev server (`npm run dev`), navigate to Student Pass workspace:
- [ ] Map renders with satellite basemap
- [ ] School marker + label displays correctly (no alignment issues!)
- [ ] Polygon drawing works, triggers `onPolygonComplete`
- [ ] Route shapes render with correct colors
- [ ] Walking leg dashed lines appear
- [ ] Transfer hub renders for multi-leg trips
- [ ] Travel time labels appear on route segments
- [ ] Afternoon return trip elements render
- [ ] Zoom/pan is smooth (60fps)
- [ ] Deleting polygon triggers `onPolygonClear`

**Step 5: Commit**

```bash
git add components/Analytics/StudentPassMap.tsx
git commit -m "feat(map): migrate StudentPassMap from Leaflet to Mapbox GL JS

Uses shared MapBase, MapLabel, and DrawControl components.
All existing features preserved: school markers, route shapes,
walking legs, transfer hubs, polygon drawing.

Part of incremental Leaflet → Mapbox migration (Phase 1).
See docs/plans/2026-03-04-mapbox-migration-design.md"
```

---

## Task 6: Verify No Regressions in StudentPassModule

**Files:**
- Read: `components/Analytics/StudentPassModule.tsx` (imports StudentPassMap)
- Read: `tests/studentPassModule.recalculation.test.tsx`

**Step 1: Check that StudentPassModule still compiles**

The parent component imports `StudentPassMap` and passes the same props. Since we preserved the `StudentPassMapProps` interface, no changes should be needed.

```bash
npm run build
```

**Step 2: Run existing tests**

```bash
npx vitest run tests/studentPassModule.recalculation.test.tsx
npx vitest run tests/studentPassUtils.test.ts
```

Expected: All pass. These tests exercise the data logic, not the map rendering, so they should be unaffected.

**Step 3: Commit (only if fixes were needed)**

---

## Task 7: Update Documentation

**Files:**
- Modify: `docs/plans/2026-03-04-mapbox-migration-design.md` — mark Phase 1 complete
- Modify: `.claude/CLAUDE.md` — update Danger Zones table if needed

**Step 1: Update design doc**

Add to the top of the design doc:
```markdown
**Phase 1 Status**: COMPLETE — StudentPassMap migrated, shared MapBase/MapLabel/DrawControl created.
**Next**: Phase 2 — migrate remaining Analytics maps.
```

**Step 2: Commit**

```bash
git add docs/plans/2026-03-04-mapbox-migration-design.md
git commit -m "docs: mark Mapbox migration Phase 1 complete"
```

---

## Summary

| Task | What | Estimated Complexity |
|------|------|---------------------|
| 1 | Install dependencies | Trivial |
| 2 | Create MapBase | Small — new file, ~70 lines |
| 3 | Create MapLabel | Small — new file, ~50 lines |
| 4 | Create DrawControl | Medium — mapbox-gl-draw integration, ~100 lines |
| 5 | Rewrite StudentPassMap | Large — 489 lines rewritten, coordinate flips, all features |
| 6 | Verify no regressions | Small — run build + tests |
| 7 | Update docs | Trivial |

**Critical watch items:**
- Coordinate convention: Leaflet = `[lat, lng]`, Mapbox = `[lng, lat]`. Every coordinate must be flipped.
- `onPolygonComplete` callback expects `[lat, lng][]` — flip DrawControl output before calling it.
- Mapbox token must be in `.env.local` and NOT committed to git.
- `@mapbox/mapbox-gl-draw` may need a `.d.ts` declaration file for TypeScript.
