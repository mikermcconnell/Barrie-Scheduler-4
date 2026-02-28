# Pair Route Map Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a map icon to each row in the Pair Route Assignments table that opens a modal with a Leaflet map showing the origin-destination journey, transfer points, and trip summary.

**Architecture:** New `ODPairMapModal` component renders inside a `Modal` (existing base component). The modal contains a Leaflet map with bezier arc(s) between origin/destination (and transfer points), plus an info card. The `ODRouteEstimationModule` gains a new `geocodeCache` prop threaded from the workspace, and manages `selectedPair` state.

**Tech Stack:** React 19, Leaflet 1.9.4 (already installed), lucide-react icons, Tailwind CSS, existing Modal component.

**Design doc:** `docs/plans/2026-02-27-pair-route-map-modal-design.md`

---

### Task 1: Thread geocodeCache prop to ODRouteEstimationModule

**Files:**
- Modify: `components/Analytics/ODMatrixWorkspace.tsx:172-173`
- Modify: `components/Analytics/ODRouteEstimationModule.tsx:38-40`

**Step 1: Update the ODRouteEstimationModule props interface**

In `components/Analytics/ODRouteEstimationModule.tsx`, add the geocodeCache prop:

```typescript
// Add import at top (line ~16 area, with existing odMatrixTypes import)
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

// Update interface (line ~38)
interface ODRouteEstimationModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
}
```

Note: The `ODMatrixDataSummary` import already exists but comes from `odMatrixTypes`. Just add `GeocodeCache` to the same import. Remove the duplicate import from `odMatrixTypes` if one was already there for `ODMatrixDataSummary`.

**Step 2: Destructure the new prop in the component**

In the component function signature (~line 193):

```typescript
export const ODRouteEstimationModule: React.FC<ODRouteEstimationModuleProps> = ({ data, geocodeCache }) => {
```

**Step 3: Pass geocodeCache from the workspace**

In `components/Analytics/ODMatrixWorkspace.tsx`, find the route-estimation case (~line 172-173) and add the prop:

```typescript
case 'route-estimation':
    return <ODRouteEstimationModule data={data} geocodeCache={geocodeCache} />;
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build, no TS errors.

**Step 5: Commit**

```bash
git add components/Analytics/ODMatrixWorkspace.tsx components/Analytics/ODRouteEstimationModule.tsx
git commit -m "feat: thread geocodeCache prop to ODRouteEstimationModule"
```

---

### Task 2: Create ODPairMapModal component

**Files:**
- Create: `components/Analytics/ODPairMapModal.tsx`

**Step 1: Create the modal component**

Create `components/Analytics/ODPairMapModal.tsx` with this content:

```typescript
/**
 * OD Pair Map Modal
 *
 * Shows a Leaflet map with curved arcs for a single OD pair journey.
 * Displays origin/destination markers, transfer point(s), and an info card.
 * Falls back to info-only when geocodes are missing.
 */

import React, { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CheckCircle2, AlertTriangle, XCircle, MapPin } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { fmt } from './AnalyticsShared';
import type { GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import type { ODPairRouteMatch, MatchConfidence } from '../../utils/od-matrix/odRouteEstimation';

interface ODPairMapModalProps {
    pair: ODPairRouteMatch;
    geocodeCache: GeocodeCache | null;
    onClose: () => void;
}

const CONFIDENCE_COLORS: Record<MatchConfidence, string> = {
    high: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    medium: 'text-amber-700 bg-amber-50 border-amber-200',
    low: 'text-orange-700 bg-orange-50 border-orange-200',
    none: 'text-red-700 bg-red-50 border-red-200',
};

const ARC_COLOR = '#2563eb';
const ARC_COLOR_LEG2 = '#7c3aed';

function quadraticBezierArc(
    origin: [number, number],
    dest: [number, number],
    curveDirection: 1 | -1 = 1,
    segments = 16
): [number, number][] {
    const midLat = (origin[0] + dest[0]) / 2;
    const midLon = (origin[1] + dest[1]) / 2;
    const dLat = dest[0] - origin[0];
    const dLon = dest[1] - origin[1];
    const offsetLat = midLat + dLon * 0.18 * curveDirection;
    const offsetLon = midLon - dLat * 0.18 * curveDirection;

    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        points.push([
            u * u * origin[0] + 2 * u * t * offsetLat + t * t * dest[0],
            u * u * origin[1] + 2 * u * t * offsetLon + t * t * dest[1],
        ]);
    }
    return points;
}

function makeCircleMarker(
    latlng: [number, number],
    color: string,
    label: string,
    map: L.Map
): void {
    L.circleMarker(latlng, {
        radius: 7,
        fillColor: color,
        fillOpacity: 0.9,
        color: '#fff',
        weight: 2,
    }).addTo(map);

    L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<div style="
                background: ${color};
                color: #fff;
                font-size: 11px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 10px;
                white-space: nowrap;
                border: 2px solid rgba(255,255,255,0.9);
                box-shadow: 0 1px 4px rgba(0,0,0,0.2);
                transform: translate(-50%, -130%);
            ">${label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        }),
    }).addTo(map);
}

function makeDiamondMarker(
    latlng: [number, number],
    color: string,
    label: string,
    map: L.Map
): void {
    L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<div style="
                width: 14px; height: 14px;
                background: ${color};
                border: 2px solid #fff;
                transform: rotate(45deg) translate(-50%, -50%);
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                position: absolute;
                top: -7px; left: -7px;
            "></div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        }),
    }).addTo(map);

    L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<div style="
                background: ${color};
                color: #fff;
                font-size: 10px;
                font-weight: 600;
                padding: 2px 7px;
                border-radius: 8px;
                white-space: nowrap;
                border: 2px solid rgba(255,255,255,0.9);
                box-shadow: 0 1px 4px rgba(0,0,0,0.2);
                transform: translate(-50%, 10px);
            ">${label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        }),
    }).addTo(map);
}

function resolveGeocode(
    stationName: string,
    geocodeCache: GeocodeCache | null
): GeocodedLocation | null {
    if (!geocodeCache) return null;
    const key = Object.keys(geocodeCache.stations).find(
        k => k.toLowerCase() === stationName.toLowerCase()
    );
    return key ? geocodeCache.stations[key] : null;
}

function ConfidenceIcon({ confidence }: { confidence: MatchConfidence }) {
    if (confidence === 'high') return <CheckCircle2 size={13} />;
    if (confidence === 'none') return <XCircle size={13} />;
    return <AlertTriangle size={13} />;
}

export const ODPairMapModal: React.FC<ODPairMapModalProps> = ({
    pair,
    geocodeCache,
    onClose,
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);

    const originGeo = resolveGeocode(pair.origin, geocodeCache);
    const destGeo = resolveGeocode(pair.destination, geocodeCache);
    const hasCoords = Boolean(originGeo && destGeo);

    // Resolve transfer point coordinates (best effort from geocode cache)
    const transferStops = pair.transfer?.transferStops?.length
        ? pair.transfer.transferStops
        : pair.transfer ? [pair.transfer.viaStop] : [];
    const transferGeos = transferStops
        .map(name => ({ name, geo: resolveGeocode(name, geocodeCache) }))
        .filter((t): t is { name: string; geo: GeocodedLocation } => t.geo !== null);

    const transferRouteNames = pair.transfer?.legs?.length
        ? pair.transfer.legs.map(leg => leg.routeName)
        : pair.transfer ? [pair.transfer.leg1RouteName, pair.transfer.leg2RouteName] : [];

    // Initialize Leaflet map
    useEffect(() => {
        if (!hasCoords || !mapContainerRef.current || mapRef.current) return;
        if (!originGeo || !destGeo) return;

        const map = L.map(mapContainerRef.current, {
            scrollWheelZoom: false,
            zoomSnap: 0.25,
            attributionControl: false,
        });
        mapRef.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            opacity: 0.8,
            crossOrigin: 'anonymous',
        } as L.TileLayerOptions).addTo(map);

        const originLatLng: [number, number] = [originGeo.lat, originGeo.lon];
        const destLatLng: [number, number] = [destGeo.lat, destGeo.lon];

        if (transferGeos.length > 0) {
            // Multi-leg: draw arcs through transfer points
            const waypoints = [originLatLng, ...transferGeos.map(t => [t.geo.lat, t.geo.lon] as [number, number]), destLatLng];

            for (let i = 0; i < waypoints.length - 1; i++) {
                const arc = quadraticBezierArc(waypoints[i], waypoints[i + 1], i % 2 === 0 ? 1 : -1);
                L.polyline(arc, {
                    color: i === 0 ? ARC_COLOR : ARC_COLOR_LEG2,
                    weight: 4,
                    opacity: 0.8,
                }).addTo(map);
            }

            // Transfer markers
            for (const t of transferGeos) {
                makeDiamondMarker([t.geo.lat, t.geo.lon], '#7c3aed', t.name, map);
            }
        } else {
            // Direct: single arc
            const arc = quadraticBezierArc(originLatLng, destLatLng);
            L.polyline(arc, {
                color: ARC_COLOR,
                weight: 4,
                opacity: 0.8,
            }).addTo(map);
        }

        // Origin and destination markers
        makeCircleMarker(originLatLng, '#2563eb', pair.origin, map);
        makeCircleMarker(destLatLng, '#dc2626', pair.destination, map);

        // Fit bounds to all points
        const allPoints: [number, number][] = [originLatLng, destLatLng, ...transferGeos.map(t => [t.geo.lat, t.geo.lon] as [number, number])];
        const bounds = L.latLngBounds(allPoints.map(p => L.latLng(p[0], p[1])));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, [hasCoords, originGeo, destGeo, pair, transferGeos]);

    return (
        <Modal isOpen onClose={onClose} size="lg">
            <Modal.Header>
                <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-violet-500" />
                    <span>{pair.origin}</span>
                    <span className="text-gray-400">→</span>
                    <span>{pair.destination}</span>
                </div>
            </Modal.Header>
            <Modal.Body className="space-y-4">
                {/* Journey count */}
                <p className="text-sm text-gray-500">
                    <span className="font-bold text-gray-900 text-lg">{fmt(pair.journeys)}</span> journeys
                </p>

                {/* Map or fallback */}
                {hasCoords ? (
                    <div
                        ref={mapContainerRef}
                        className="w-full rounded-lg overflow-hidden border border-gray-200"
                        style={{ height: 300 }}
                    />
                ) : (
                    <div className="w-full flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400 text-sm"
                        style={{ height: 200 }}
                    >
                        Coordinates not available. Run geocoding to enable the map view.
                    </div>
                )}

                {/* Info card */}
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <span className="text-gray-500 font-medium">Route</span>
                    <span className="text-gray-800">
                        {pair.transfer
                            ? transferRouteNames.join(' → ')
                            : pair.routeLongName || <span className="text-gray-400 italic">No route matched</span>}
                    </span>

                    <span className="text-gray-500 font-medium">Via</span>
                    <span className="text-gray-800">
                        {transferStops.length > 0
                            ? transferStops.join(' → ')
                            : <span className="text-gray-400">—</span>}
                    </span>

                    <span className="text-gray-500 font-medium">Stops</span>
                    <span className="text-gray-800">
                        {pair.confidence !== 'none' ? `${pair.intermediateStops} intermediate` : '—'}
                    </span>

                    <span className="text-gray-500 font-medium">Confidence</span>
                    <span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border ${CONFIDENCE_COLORS[pair.confidence]}`}>
                            <ConfidenceIcon confidence={pair.confidence} />
                            {pair.confidence}
                        </span>
                    </span>
                </div>
            </Modal.Body>
        </Modal>
    );
};
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build (component not yet used, but should compile).

**Step 3: Commit**

```bash
git add components/Analytics/ODPairMapModal.tsx
git commit -m "feat: add ODPairMapModal component with Leaflet map and journey info"
```

---

### Task 3: Add map icon column to the Pair Route Assignments table

**Files:**
- Modify: `components/Analytics/ODRouteEstimationModule.tsx:505-574`

**Step 1: Add imports and state**

At the top of `ODRouteEstimationModule.tsx`, add the MapPin import (to the existing lucide-react import line ~24):

```typescript
import {
    Upload,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Search,
    Loader2,
    MapPin,
} from 'lucide-react';
```

Add the ODPairMapModal import below the existing imports (~line 36):

```typescript
import { ODPairMapModal } from './ODPairMapModal';
import type { ODPairRouteMatch } from '../../utils/od-matrix/odRouteEstimation';
```

Note: `ODPairRouteMatch` may already be imported via the `estimateRoutes` import. Check if it's in the existing import from `odRouteEstimation`. If not, add it.

**Step 2: Add selectedPair state**

Inside the component function, after the existing `useState` calls (~line 202 area), add:

```typescript
const [selectedPair, setSelectedPair] = useState<ODPairRouteMatch | null>(null);
```

**Step 3: Add map icon column header**

In the `<thead>` section (~line 505-514), add a new `<th>` as the first column:

```typescript
<tr className="border-b border-gray-200">
    <th className="w-10 py-2 px-2"></th>
    <th className="text-left py-2 px-3 text-gray-500 font-medium">Origin</th>
    {/* ... rest unchanged ... */}
</tr>
```

**Step 4: Add map icon cell to each row**

In the `<tbody>` row (~line 528 area), add a new `<td>` as the first cell inside the `<tr>`:

```typescript
<td className="py-2 px-2 text-center">
    <button
        onClick={() => setSelectedPair(m)}
        className="p-1 rounded hover:bg-violet-50 text-gray-400 hover:text-violet-500 transition-colors"
        title="View journey map"
    >
        <MapPin size={16} />
    </button>
</td>
```

**Step 5: Render the modal**

At the very end of the component's return JSX, just before the closing `</div>` (~line 579-580), add:

```typescript
{selectedPair && (
    <ODPairMapModal
        pair={selectedPair}
        geocodeCache={geocodeCache}
        onClose={() => setSelectedPair(null)}
    />
)}
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Clean build, no TS errors.

**Step 7: Manual test**

Run: `npm run dev`
- Navigate to OD Matrix workspace → Route Estimation tab
- Verify map icon appears in first column of every row
- Click a map icon → modal opens with map (if geocoded) or fallback
- Close modal → selectedPair clears
- For a transfer row (e.g., Toronto-Yorkdale → Timmins via NORTH BAY), verify two arc legs and purple diamond transfer marker

**Step 8: Commit**

```bash
git add components/Analytics/ODRouteEstimationModule.tsx
git commit -m "feat: add map icon column to Pair Route Assignments table with modal"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Thread geocodeCache prop | ODMatrixWorkspace.tsx, ODRouteEstimationModule.tsx |
| 2 | Create ODPairMapModal component | ODPairMapModal.tsx (new) |
| 3 | Add map icon column + wire up modal | ODRouteEstimationModule.tsx |
