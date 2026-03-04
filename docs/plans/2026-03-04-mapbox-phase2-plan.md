# Mapbox Migration Phase 2: Shared Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the shared Mapbox component library that all 9 remaining map migrations depend on.

**Architecture:** Extract duplicated Leaflet patterns (arcs, route overlays, stop dots, heatmaps, lasso) into reusable react-map-gl components in `components/shared/`. Pure math functions go into `mapUtils.ts`. Each component accepts `[lat, lng]` data and handles the Mapbox `[lng, lat]` flip internally.

**Tech Stack:** react-map-gl/mapbox, mapbox-gl, TypeScript, React 19, Tailwind CSS

**Design doc:** `docs/plans/2026-03-04-mapbox-phase2-design.md`

---

## Task 1: Expand mapUtils.ts with Arc and Geometry Utilities

**Files:**
- Modify: `components/shared/mapUtils.ts`

These are pure math functions extracted from 5 duplicate copies across the codebase. No Leaflet or Mapbox dependencies — just coordinate geometry.

**Step 1: Add the arc and geometry utilities**

Add to the existing `mapUtils.ts` (which already has `toGeoJSON` and `toLineGeoJSON`):

```ts
/**
 * Generate a quadratic bezier arc between two [lat, lng] points.
 * Returns array of [lat, lng] points along the curve.
 * Extracted from CoverageGapMap, ODFlowMapModule, ODPairMapModal,
 * ODRouteEstimationModule, TransitAppMap (5 duplicate copies).
 */
export function quadraticBezierArc(
    origin: [number, number],
    dest: [number, number],
    curveDirection: 1 | -1 = 1,
    segments: number = 16
): [number, number][] {
    const midLat = (origin[0] + dest[0]) / 2;
    const midLon = (origin[1] + dest[1]) / 2;
    const dLat = dest[0] - origin[0];
    const dLon = dest[1] - origin[1];
    const offsetLat = midLat + dLon * 0.2 * curveDirection;
    const offsetLon = midLon - dLat * 0.2 * curveDirection;

    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        const lat = u * u * origin[0] + 2 * u * t * offsetLat + t * t * dest[0];
        const lon = u * u * origin[1] + 2 * u * t * offsetLon + t * t * dest[1];
        points.push([lat, lon]);
    }
    return points;
}

/**
 * Generate arrowhead barb coordinates for the tip of an arc.
 * Returns array of polyline coordinate arrays for the barbs.
 * Input/output in [lat, lng] format.
 */
export function arrowheadPoints(
    arcPoints: [number, number][],
    sizeDeg: number = 0.004
): [number, number][][] {
    const n = arcPoints.length;
    if (n < 2) return [];
    const tip = arcPoints[n - 1];
    const prev = arcPoints[n - 2];
    const dx = tip[1] - prev[1];
    const dy = tip[0] - prev[0];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return [];
    const ux = dx / len;
    const uy = dy / len;

    const barb1: [number, number] = [
        tip[0] - uy * sizeDeg + ux * sizeDeg * 0.5,
        tip[1] - ux * sizeDeg - uy * sizeDeg * 0.5,
    ];
    const barb2: [number, number] = [
        tip[0] - uy * sizeDeg - ux * sizeDeg * 0.5,
        tip[1] - ux * sizeDeg + uy * sizeDeg * 0.5,
    ];

    return [[barb1, tip, barb2]];
}

/**
 * Convert an array of arcs (each an array of [lat, lng] points) to a
 * GeoJSON FeatureCollection of LineStrings with per-feature properties.
 */
export function toArcGeoJSON(
    arcs: { points: [number, number][]; properties?: Record<string, unknown> }[]
): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: arcs.map((arc) => ({
            type: 'Feature',
            properties: arc.properties ?? {},
            geometry: {
                type: 'LineString',
                coordinates: arc.points.map(toGeoJSON),
            },
        })),
    };
}

/**
 * Convert arrowhead barbs to GeoJSON FeatureCollection.
 * Each barb set becomes a LineString feature.
 */
export function toArrowheadGeoJSON(
    barbs: [number, number][][]
): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: barbs.map((barbLine) => ({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: barbLine.map(toGeoJSON),
            },
        })),
    };
}

/**
 * Ray-casting point-in-polygon test.
 * Extracted from StopActivityMap lasso selection.
 */
export function pointInPolygon(
    lat: number,
    lon: number,
    polygon: [number, number][]
): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > lon) !== (yj > lon)) &&
            (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * 6-stop heat color interpolation (indigo → blue → cyan → yellow → orange → red).
 * Extracted from TransitAppMap. Input: normalized 0–1 value. Output: CSS rgb() string.
 */
export function heatColor(t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    const stops: Array<{ t: number; rgb: [number, number, number] }> = [
        { t: 0.00, rgb: [37, 52, 148] },
        { t: 0.25, rgb: [14, 116, 255] },
        { t: 0.50, rgb: [6, 182, 212] },
        { t: 0.70, rgb: [250, 204, 21] },
        { t: 0.85, rgb: [249, 115, 22] },
        { t: 1.00, rgb: [220, 38, 38] },
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (clamped >= a.t && clamped <= b.t) {
            const local = (clamped - a.t) / Math.max(0.0001, (b.t - a.t));
            const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * local);
            const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * local);
            const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * local);
            return `rgb(${r},${g},${bl})`;
        }
    }
    const last = stops[stops.length - 1].rgb;
    return `rgb(${last[0]},${last[1]},${last[2]})`;
}
```

**Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds. New exports are available but not yet consumed.

**Step 3: Commit**

```bash
git add components/shared/mapUtils.ts
git commit -m "feat(map): add shared arc, arrowhead, heatColor, and pointInPolygon utilities

Extracted from 5+ duplicate implementations across Leaflet map components.
Pure math functions with no Leaflet/Mapbox dependency. All use [lat, lng] convention."
```

---

## Task 2: Create RouteOverlay Component

**Files:**
- Create: `components/shared/RouteOverlay.tsx`

Replaces the repeated GTFS route shape rendering pattern used in CoverageGapMap, TransfersModule, StopActivityMap, TransitAppMap, and CascadeRouteMap. Wraps `loadGtfsRouteShapes()` output into react-map-gl `Source`/`Layer` pairs.

**Step 1: Create the component**

```tsx
// components/shared/RouteOverlay.tsx
import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface RouteShape {
    /** Route short name (e.g. "1", "8A") */
    routeShortName: string;
    /** Hex color without '#' prefix (e.g. "FF0000") */
    routeColor: string;
    /** Array of [lat, lng] coordinate pairs */
    points: [number, number][];
}

export interface RouteOverlayProps {
    /** Array of route shapes to render */
    shapes: RouteShape[];
    /** Line opacity. Defaults to 0.5. */
    opacity?: number;
    /** Line weight. Defaults to 3. */
    weight?: number;
    /** Whether to use dashed lines. Defaults to true. */
    dashed?: boolean;
    /** Unique ID prefix to avoid Source/Layer collisions. Defaults to 'route-overlay'. */
    idPrefix?: string;
}

/**
 * Renders GTFS route shapes as dashed polylines on a Mapbox map.
 * Drop-in replacement for the repeated Leaflet pattern:
 *   loadGtfsRouteShapes() → L.polyline with dashArray
 *
 * Usage:
 * ```tsx
 * <MapBase>
 *   <RouteOverlay shapes={loadGtfsRouteShapes()} />
 * </MapBase>
 * ```
 */
export const RouteOverlay: React.FC<RouteOverlayProps> = ({
    shapes,
    opacity = 0.5,
    weight = 3,
    dashed = true,
    idPrefix = 'route-overlay',
}) => {
    const geoJSONData = useMemo(() => {
        const features: GeoJSON.Feature[] = shapes.map((shape, i) => ({
            type: 'Feature',
            properties: {
                color: shape.routeColor.startsWith('#') ? shape.routeColor : `#${shape.routeColor}`,
                name: shape.routeShortName,
                index: i,
            },
            geometry: {
                type: 'LineString',
                coordinates: shape.points.map(toGeoJSON),
            },
        }));
        return { type: 'FeatureCollection' as const, features };
    }, [shapes]);

    const layerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-lines`,
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': weight,
            'line-opacity': opacity,
            ...(dashed ? { 'line-dasharray': [6, 4] } : {}),
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
    }), [idPrefix, weight, opacity, dashed]);

    if (shapes.length === 0) return null;

    return (
        <Source id={`${idPrefix}-src`} type="geojson" data={geoJSONData}>
            <Layer {...layerStyle} />
        </Source>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add components/shared/RouteOverlay.tsx
git commit -m "feat(map): add shared RouteOverlay component for GTFS route shapes

Renders route shapes as dashed polylines with data-driven colors.
Replaces duplicated Leaflet pattern in 5 map components."
```

---

## Task 3: Create StopDotLayer Component

**Files:**
- Create: `components/shared/StopDotLayer.tsx`

Renders transit stops as circle markers on Mapbox maps. Used by HeadwayMap, StopActivityMap, TransitAppMap, CascadeRouteMap.

**Step 1: Create the component**

```tsx
// components/shared/StopDotLayer.tsx
import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface StopPoint {
    /** Unique stop identifier */
    id: string;
    /** Latitude */
    lat: number;
    /** Longitude */
    lon: number;
    /** Optional display name */
    name?: string;
}

export interface StopDotLayerProps {
    /** Stops to render */
    stops: StopPoint[];
    /** Circle radius in pixels. Defaults to 4. */
    radius?: number;
    /** Fill color. Defaults to '#6B7280' (gray-500). */
    color?: string;
    /** Fill opacity. Defaults to 0.8. */
    opacity?: number;
    /** Outline color. Defaults to '#374151' (gray-700). */
    outlineColor?: string;
    /** Outline width. Defaults to 1. */
    outlineWidth?: number;
    /** Minimum zoom to show stops. Defaults to 0 (always visible). */
    minZoom?: number;
    /** Unique ID prefix. Defaults to 'stop-dots'. */
    idPrefix?: string;
    /** Callback when a stop is clicked. */
    onClick?: (stop: StopPoint) => void;
}

/**
 * Renders transit stops as circle markers.
 * Uses a GeoJSON circle layer for WebGL-accelerated rendering of many stops.
 *
 * Usage:
 * ```tsx
 * <MapBase>
 *   <StopDotLayer stops={allStops} radius={5} minZoom={14} />
 * </MapBase>
 * ```
 */
export const StopDotLayer: React.FC<StopDotLayerProps> = ({
    stops,
    radius = 4,
    color = '#6B7280',
    opacity = 0.8,
    outlineColor = '#374151',
    outlineWidth = 1,
    minZoom = 0,
    idPrefix = 'stop-dots',
}) => {
    const geoJSONData = useMemo((): GeoJSON.FeatureCollection => ({
        type: 'FeatureCollection',
        features: stops.map((stop) => ({
            type: 'Feature',
            properties: { id: stop.id, name: stop.name ?? '' },
            geometry: {
                type: 'Point',
                coordinates: toGeoJSON([stop.lat, stop.lon]),
            },
        })),
    }), [stops]);

    const layerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-circles`,
        type: 'circle',
        minzoom: minZoom,
        paint: {
            'circle-radius': radius,
            'circle-color': color,
            'circle-opacity': opacity,
            'circle-stroke-color': outlineColor,
            'circle-stroke-width': outlineWidth,
        },
    }), [idPrefix, radius, color, opacity, outlineColor, outlineWidth, minZoom]);

    if (stops.length === 0) return null;

    return (
        <Source id={`${idPrefix}-src`} type="geojson" data={geoJSONData}>
            <Layer {...layerStyle} />
        </Source>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add components/shared/StopDotLayer.tsx
git commit -m "feat(map): add shared StopDotLayer for transit stop circle markers

WebGL-accelerated circle layer via GeoJSON Source. Supports minZoom,
custom colors, and outline styling. Used by 4 map components."
```

---

## Task 4: Create HeatmapDotLayer Component

**Files:**
- Create: `components/shared/HeatmapDotLayer.tsx`

Renders data points as color-scaled circles with log-binning. Replaces the hand-rolled circleMarker heatmaps in TransitAppMap and StopActivityMap.

**Step 1: Create the component**

```tsx
// components/shared/HeatmapDotLayer.tsx
import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface HeatmapBin {
    fill: string;
    fillOpacity: number;
    radius: number;
    label: string;
}

export interface HeatmapPoint {
    lat: number;
    lon: number;
    value: number;
    id: string;
    [key: string]: unknown;
}

export interface HeatmapDotLayerProps {
    /** Data points with values */
    points: HeatmapPoint[];
    /** Bin definitions (index 0 = zero/minimum, higher indices = higher values) */
    bins: readonly HeatmapBin[];
    /** Function to assign a bin index (0-based) to each point's value.
     *  If not provided, uses log-scale assignment against max value. */
    assignBin?: (value: number, allValues: number[]) => number;
    /** Outline color. Defaults to '#374151'. */
    outlineColor?: string;
    /** Unique ID prefix. Defaults to 'heatmap-dots'. */
    idPrefix?: string;
}

/** Default log-scale bin assignment matching StopActivityMap pattern */
function defaultAssignBin(value: number, allValues: number[], binCount: number): number {
    if (value === 0) return 0;
    const nonZero = allValues.filter(a => a > 0);
    if (nonZero.length === 0) return 0;
    const logMax = Math.log(Math.max(...nonZero) + 1);
    if (logMax === 0) return value > 0 ? 1 : 0;
    const t = Math.log(value + 1) / logMax;
    const bin = Math.ceil(t * (binCount - 1));
    return Math.max(1, Math.min(binCount - 1, bin));
}

/**
 * Renders data points as color/size-scaled circles using log-scale binning.
 * Replaces hand-rolled L.circleMarker heatmaps in TransitAppMap and StopActivityMap.
 *
 * Uses data-driven Mapbox expressions for circle-radius and circle-color,
 * so all rendering happens on the GPU.
 *
 * Usage:
 * ```tsx
 * <MapBase>
 *   <HeatmapDotLayer points={stopMetrics} bins={BINS} />
 * </MapBase>
 * ```
 */
export const HeatmapDotLayer: React.FC<HeatmapDotLayerProps> = ({
    points,
    bins,
    assignBin,
    outlineColor = '#374151',
    idPrefix = 'heatmap-dots',
}) => {
    const geoJSONData = useMemo((): GeoJSON.FeatureCollection => {
        const allValues = points.map(p => p.value);
        return {
            type: 'FeatureCollection',
            features: points.map((pt) => {
                const bin = assignBin
                    ? assignBin(pt.value, allValues)
                    : defaultAssignBin(pt.value, allValues, bins.length);
                return {
                    type: 'Feature',
                    properties: { id: pt.id, value: pt.value, bin },
                    geometry: {
                        type: 'Point',
                        coordinates: toGeoJSON([pt.lat, pt.lon]),
                    },
                };
            }),
        };
    }, [points, bins.length, assignBin]);

    // Build data-driven expressions from bin definitions
    const radiusExpr: mapboxgl.Expression = useMemo(() => {
        const stops: (string | number)[] = [];
        bins.forEach((b, i) => { stops.push(i, b.radius); });
        return ['interpolate', ['linear'], ['get', 'bin'], ...stops];
    }, [bins]);

    const colorExpr: mapboxgl.Expression = useMemo(() => {
        const cases: (mapboxgl.Expression | string)[] = [];
        bins.forEach((b, i) => {
            cases.push(['==', ['get', 'bin'], i], b.fill === 'transparent' ? 'rgba(0,0,0,0)' : b.fill);
        });
        return ['case', ...cases, bins[bins.length - 1].fill];
    }, [bins]);

    const opacityExpr: mapboxgl.Expression = useMemo(() => {
        const stops: (string | number)[] = [];
        bins.forEach((b, i) => { stops.push(i, b.fillOpacity); });
        return ['interpolate', ['linear'], ['get', 'bin'], ...stops];
    }, [bins]);

    const layerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-circles`,
        type: 'circle',
        paint: {
            'circle-radius': radiusExpr,
            'circle-color': colorExpr,
            'circle-opacity': opacityExpr,
            'circle-stroke-color': outlineColor,
            'circle-stroke-width': ['case', ['==', ['get', 'bin'], 0], 1.5, 1],
            'circle-stroke-opacity': ['case', ['==', ['get', 'bin'], 0], 0.4, 0.8],
        },
    }), [idPrefix, radiusExpr, colorExpr, opacityExpr, outlineColor]);

    if (points.length === 0) return null;

    return (
        <Source id={`${idPrefix}-src`} type="geojson" data={geoJSONData}>
            <Layer {...layerStyle} />
        </Source>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add components/shared/HeatmapDotLayer.tsx
git commit -m "feat(map): add shared HeatmapDotLayer with log-scale binning

GPU-accelerated circle layer with data-driven radius, color, and opacity
expressions. Replaces hand-rolled L.circleMarker heatmaps in 2 components."
```

---

## Task 5: Create LassoControl Component

**Files:**
- Create: `components/shared/LassoControl.tsx`

Polygon lasso selection tool for Mapbox maps. Replaces the raw mouse event pattern in StopActivityMap. Uses Mapbox's `map.unproject()` instead of Leaflet's `containerPointToLatLng()`.

**Step 1: Create the component**

```tsx
// components/shared/LassoControl.tsx
import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useMap, Source, Layer } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import { toGeoJSON, pointInPolygon } from './mapUtils';

export interface LassoControlProps {
    /** Whether lasso mode is active */
    active: boolean;
    /** Called when user completes a lasso selection. Receives polygon as [lat, lng][] */
    onComplete: (polygon: [number, number][]) => void;
    /** Called when lasso is cleared/cancelled */
    onClear?: () => void;
    /** Lasso line color. Defaults to '#f59e0b' (amber). */
    color?: string;
}

/**
 * Polygon lasso selection tool for Mapbox maps.
 * When active, captures mouse drag as a freehand polygon.
 * Returns polygon coordinates in [lat, lng] format.
 *
 * Usage:
 * ```tsx
 * <MapBase>
 *   <LassoControl
 *     active={lassoMode}
 *     onComplete={(polygon) => {
 *       const hits = stops.filter(s => pointInPolygon(s.lat, s.lon, polygon));
 *       setSelected(hits);
 *     }}
 *   />
 * </MapBase>
 * ```
 */
export const LassoControl: React.FC<LassoControlProps> = ({
    active,
    onComplete,
    onClear,
    color = '#f59e0b',
}) => {
    const { current: map } = useMap();
    const drawingRef = useRef<[number, number][] | null>(null);
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);

    // Disable map dragging when lasso is active
    useEffect(() => {
        if (!map) return;
        if (active) {
            map.getMap().dragPan.disable();
        } else {
            map.getMap().dragPan.enable();
            setPolygon(null);
            drawingRef.current = null;
            onClear?.();
        }
        return () => { map.getMap().dragPan.enable(); };
    }, [active, map, onClear]);

    const onMouseDown = useCallback((e: mapboxgl.MapMouseEvent) => {
        if (!active) return;
        e.preventDefault();
        drawingRef.current = [[e.lngLat.lat, e.lngLat.lng]];
        setPolygon(null);
    }, [active]);

    const onMouseMove = useCallback((e: mapboxgl.MapMouseEvent) => {
        if (!drawingRef.current) return;
        drawingRef.current.push([e.lngLat.lat, e.lngLat.lng]);
        setPolygon([...drawingRef.current]);
    }, []);

    const onMouseUp = useCallback(() => {
        const points = drawingRef.current;
        drawingRef.current = null;
        if (!points || points.length < 3) {
            setPolygon(null);
            return;
        }
        setPolygon(points);
        onComplete(points);
    }, [onComplete]);

    // Attach map event listeners
    useEffect(() => {
        if (!map) return;
        const m = map.getMap();
        m.on('mousedown', onMouseDown);
        m.on('mousemove', onMouseMove);
        m.on('mouseup', onMouseUp);
        return () => {
            m.off('mousedown', onMouseDown);
            m.off('mousemove', onMouseMove);
            m.off('mouseup', onMouseUp);
        };
    }, [map, onMouseDown, onMouseMove, onMouseUp]);

    // Render the lasso polygon as a GeoJSON layer
    const geoJSON = React.useMemo((): GeoJSON.FeatureCollection | null => {
        if (!polygon || polygon.length < 2) return null;
        const ring = [...polygon, polygon[0]]; // close the ring
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'Polygon',
                    coordinates: [ring.map(p => toGeoJSON(p))],
                },
            }],
        };
    }, [polygon]);

    if (!geoJSON) return null;

    return (
        <Source id="lasso-polygon" type="geojson" data={geoJSON}>
            <Layer
                id="lasso-fill"
                type="fill"
                paint={{ 'fill-color': color, 'fill-opacity': 0.1 }}
            />
            <Layer
                id="lasso-line"
                type="line"
                paint={{
                    'line-color': color,
                    'line-width': 2,
                    'line-dasharray': [6, 4],
                }}
            />
        </Source>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add components/shared/LassoControl.tsx
git commit -m "feat(map): add shared LassoControl for freehand polygon selection

Replaces raw mouse event lasso in StopActivityMap. Uses Mapbox map events
and renders selection polygon as GeoJSON fill+line layers."
```

---

## Task 6: Create ArcLayer Component

**Files:**
- Create: `components/shared/ArcLayer.tsx`

Renders curved bezier arcs between origin-destination pairs. This is the highest-reuse component — used by 5 of the 9 maps.

**Step 1: Create the component**

```tsx
// components/shared/ArcLayer.tsx
import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { quadraticBezierArc, arrowheadPoints, toArcGeoJSON, toArrowheadGeoJSON } from './mapUtils';

export interface ArcData {
    /** Origin point [lat, lng] */
    origin: [number, number];
    /** Destination point [lat, lng] */
    dest: [number, number];
    /** Arc color (CSS color string) */
    color: string;
    /** Arc line width. Defaults to 2. */
    width?: number;
    /** Arc opacity. Defaults to 0.7. */
    opacity?: number;
    /** Curve direction: 1 = left, -1 = right. Defaults to 1. */
    curveDirection?: 1 | -1;
    /** Number of segments in the bezier curve. Defaults to 16. */
    segments?: number;
    /** Optional properties to attach to the GeoJSON feature */
    properties?: Record<string, unknown>;
}

export interface ArcLayerProps {
    /** Array of arcs to render */
    arcs: ArcData[];
    /** Whether to show arrowheads at arc tips. Defaults to false. */
    showArrowheads?: boolean;
    /** Arrowhead size in degrees. Defaults to 0.004. */
    arrowheadSize?: number;
    /** Default line width if not set per-arc. Defaults to 2. */
    defaultWidth?: number;
    /** Default opacity if not set per-arc. Defaults to 0.7. */
    defaultOpacity?: number;
    /** Unique ID prefix. Defaults to 'arcs'. */
    idPrefix?: string;
}

/**
 * Renders curved bezier arcs between OD pairs with optional arrowheads.
 * Replaces L.polyline + quadraticBezierArc pattern duplicated across 5 components.
 *
 * Usage:
 * ```tsx
 * <MapBase>
 *   <ArcLayer
 *     arcs={[
 *       { origin: [44.38, -79.69], dest: [44.40, -79.70], color: '#ef4444' },
 *     ]}
 *     showArrowheads
 *   />
 * </MapBase>
 * ```
 */
export const ArcLayer: React.FC<ArcLayerProps> = ({
    arcs,
    showArrowheads = false,
    arrowheadSize = 0.004,
    defaultWidth = 2,
    defaultOpacity = 0.7,
    idPrefix = 'arcs',
}) => {
    const { arcGeoJSON, arrowGeoJSON } = useMemo(() => {
        const arcFeatures = arcs.map((arc) => ({
            points: quadraticBezierArc(
                arc.origin,
                arc.dest,
                arc.curveDirection ?? 1,
                arc.segments ?? 16
            ),
            properties: {
                color: arc.color,
                width: arc.width ?? defaultWidth,
                opacity: arc.opacity ?? defaultOpacity,
                ...arc.properties,
            },
        }));

        const arcGJ = toArcGeoJSON(arcFeatures);

        let arrowGJ: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
        if (showArrowheads) {
            const allBarbs = arcFeatures.flatMap((f) =>
                arrowheadPoints(f.points, arrowheadSize)
            );
            arrowGJ = toArrowheadGeoJSON(allBarbs);
            // Copy color from corresponding arc
            arrowGJ.features.forEach((f, i) => {
                if (i < arcs.length) {
                    f.properties = { color: arcs[i].color, width: (arcs[i].width ?? defaultWidth) + 1 };
                }
            });
        }

        return { arcGeoJSON: arcGJ, arrowGeoJSON: arrowGJ };
    }, [arcs, showArrowheads, arrowheadSize, defaultWidth, defaultOpacity]);

    const arcLayerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-lines`,
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': ['get', 'opacity'],
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
    }), [idPrefix]);

    const arrowLayerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-arrows`,
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
        },
        layout: {
            'line-cap': 'round',
        },
    }), [idPrefix]);

    if (arcs.length === 0) return null;

    return (
        <>
            <Source id={`${idPrefix}-src`} type="geojson" data={arcGeoJSON}>
                <Layer {...arcLayerStyle} />
            </Source>
            {showArrowheads && arrowGeoJSON.features.length > 0 && (
                <Source id={`${idPrefix}-arrows-src`} type="geojson" data={arrowGeoJSON}>
                    <Layer {...arrowLayerStyle} />
                </Source>
            )}
        </>
    );
};
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add components/shared/ArcLayer.tsx
git commit -m "feat(map): add shared ArcLayer for curved OD arcs with arrowheads

Composes quadraticBezierArc + arrowheadPoints into a declarative component.
Data-driven color/width/opacity via Mapbox expressions. Used by 5 maps."
```

---

## Task 7: Create Shared Component Index

**Files:**
- Create: `components/shared/index.ts`

Barrel export for all shared map components to simplify imports.

**Step 1: Create the index file**

```ts
// components/shared/index.ts
export { MapBase } from './MapBase';
export type { MapBaseProps } from './MapBase';

export { MapLabel } from './MapLabel';
export type { MapLabelProps } from './MapLabel';

export { DrawControl } from './DrawControl';
export type { DrawControlProps } from './DrawControl';

export { RouteOverlay } from './RouteOverlay';
export type { RouteOverlayProps, RouteShape } from './RouteOverlay';

export { StopDotLayer } from './StopDotLayer';
export type { StopDotLayerProps, StopPoint } from './StopDotLayer';

export { HeatmapDotLayer } from './HeatmapDotLayer';
export type { HeatmapDotLayerProps, HeatmapBin, HeatmapPoint } from './HeatmapDotLayer';

export { ArcLayer } from './ArcLayer';
export type { ArcLayerProps, ArcData } from './ArcLayer';

export { LassoControl } from './LassoControl';
export type { LassoControlProps } from './LassoControl';

export {
    toGeoJSON,
    toLineGeoJSON,
    quadraticBezierArc,
    arrowheadPoints,
    toArcGeoJSON,
    toArrowheadGeoJSON,
    pointInPolygon,
    heatColor,
} from './mapUtils';
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add components/shared/index.ts
git commit -m "feat(map): add barrel export index for shared map components"
```

---

## Task 8: Build Verification and Smoke Test

**Files:**
- No file changes — verification only

**Step 1: Full build**

```bash
npm run build
```

Expected: Clean build with no errors or warnings related to new shared components.

**Step 2: Check for unused imports in new files**

```bash
npx tsc --noEmit
```

Expected: No type errors.

**Step 3: Verify all exports resolve**

Quick check that the barrel export works by searching for any circular dependency warnings in the build output.

---

## Summary

| Task | Component | Lines | Replaces |
|------|-----------|-------|----------|
| 1 | mapUtils.ts expansion | ~130 new lines | 5 copies of arc math, heatColor, pointInPolygon |
| 2 | RouteOverlay | ~80 lines | GTFS overlay pattern in 5 maps |
| 3 | StopDotLayer | ~80 lines | L.circleMarker stop dots in 4 maps |
| 4 | HeatmapDotLayer | ~110 lines | Hand-rolled heatmaps in 2 maps |
| 5 | LassoControl | ~120 lines | Raw mouse lasso in StopActivityMap |
| 6 | ArcLayer | ~130 lines | Curved arcs + arrowheads in 5 maps |
| 7 | Index barrel export | ~30 lines | Simplifies imports |
| 8 | Build verification | 0 lines | Confidence check |

**After this phase**, each individual map migration (Phases 3–6) becomes a composition exercise: replace Leaflet init with `<MapBase>`, swap `L.polyline`/`L.circleMarker` calls with `<ArcLayer>`/`<RouteOverlay>`/`<StopDotLayer>`, and remove the Leaflet imports.
