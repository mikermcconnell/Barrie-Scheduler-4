# Student Transit Pass Generator — Design Document

**Date:** 2026-03-04
**Status:** Approved
**Location:** New "Student Pass" tab in TransitAppWorkspace

---

## Problem

Barrie Transit needs to produce one-page flyers showing how students in a residential zone can reach their high school by transit. Each flyer includes a satellite map with the zone highlighted, the bus route path, boarding/alighting stops, travel time, and step-by-step trip instructions. Currently these are created manually. This tool automates the process using existing GTFS data.

---

## Requirements

| Requirement | Detail |
|-------------|--------|
| School selection | Dropdown of all Barrie high schools. Reusable — any school. |
| Bell times | Configurable per school (morning start, afternoon end) |
| Zone drawing | Draw polygon on Leaflet map. Edit vertices, delete, undo last vertex. |
| Trip finding | Auto-find best GTFS trip: nearest stop in zone → earliest arrival before bell |
| Transfer support | If no direct route, find 1-transfer trips. Show transfer stop, wait time, quality rating. |
| Transfer quality | <5 min = Tight (red), 5-10 min = Good (green), 10-15 min = OK (amber), >15 min = Long (red) |
| Live preview | WYSIWYG flyer preview matching PDF output |
| PDF export | Download as single-page letter-size PDF |

---

## Architecture

### Component Hierarchy

```
TransitAppWorkspace (existing)
  └─ StudentPassModule.tsx          — tab content, orchestrates state
       ├─ StudentPassConfig.tsx     — left panel: school picker, bell times, zone controls, trip result
       ├─ StudentPassMap.tsx        — Leaflet map with satellite tiles, polygon drawing, route overlay
       ├─ StudentPassPreview.tsx    — bottom preview panel, live flyer WYSIWYG
       └─ utils/studentPassUtils.ts — GTFS trip-finding algorithm
```

### New Dependency

- `leaflet-draw` — polygon drawing/editing on Leaflet map

### Data Flow

1. User picks school → geocoded coordinates, bell times set
2. User draws zone polygon → polygon coords stored in state
3. `findBestTrip(polygon, schoolCoords, bellTimes)` queries GTFS:
   - Find stops inside/near polygon (point-in-polygon + 200m buffer)
   - Find nearest stop to school
   - Search direct routes first, then 1-transfer routes
   - Return best option with full trip details
4. Map updates: route polyline, stop markers, transfer point, travel time label
5. Preview panel populates with "In Numbers" + trip instructions
6. Export: html2canvas captures map → jsPDF composes flyer

---

## GTFS Trip-Finding Algorithm

### Input
- `zonePolygon: LatLng[]`
- `schoolCoords: [lat, lon]`
- `morningBellTime: string` (e.g., "08:00")
- `afternoonBellTime: string` (e.g., "14:15")

### Phase 1: Stop Discovery
- Load all GTFS stops via `getAllStopsWithCoords()`
- Filter to stops inside polygon (point-in-polygon test)
- Also include stops within 200m of polygon boundary (walkable buffer)
- Find nearest stop to school via `findNearestStopName()`

### Phase 2: Direct Trip Search
- From `stop_times.txt`: find routes serving both a zone-stop AND the school-stop
- Filter to weekday service via `calendar.txt`
- For each candidate route+direction:
  - Find trips departing zone-stop → arriving school-stop before bell
  - Rank by: latest departure (minimize school wait) → shortest travel time
- If viable direct trip found → use it

### Phase 3: Transfer Trip Search
- Find all routes serving zone stops (Route A candidates)
- Find all routes serving school stop (Route B candidates)
- For each Route A × Route B pair:
  - Find shared stops (transfer points) where both routes stop
  - For each transfer stop:
    - Find Route A trip arriving at transfer stop
    - Find Route B trip departing transfer stop → arriving school before bell
    - Calculate transfer wait = Route B departure - Route A arrival
- Rank transfer options by:
  1. Transfer wait quality (5-10 min = best)
  2. Total travel time
  3. Latest zone departure

### Phase 4: Afternoon Trip (reverse)
- Same algorithm in reverse direction
- Find trip departing school-stop ≥ afternoonBellTime
- Pick earliest departure after bell
- Also capture "next bus" time for the flyer

### Output Type

```typescript
interface StudentPassData {
  school: { name: string; coords: [number, number]; bellStart: string; bellEnd: string };
  zone: { polygon: LatLng[]; stopsInZone: GTFSStop[] };
  tripType: 'direct' | 'transfer';

  // Direct trip fields
  route?: { id: string; name: string; color: string; shape: LatLng[] };
  boardingStop: GTFSStop;
  alightingStop: GTFSStop;

  // Transfer trip fields
  transfer?: {
    routeA: { name: string; color: string; shape: LatLng[] };
    routeB: { name: string; color: string; shape: LatLng[] };
    transferStop: GTFSStop;
    transferWaitMinutes: number;
    transferQuality: 'tight' | 'good' | 'ok' | 'long';
  };

  morningTrip: {
    boardTime: string;
    alightTime: string;
    transferBoardTime?: string;
    arrivalTime: string;
    totalTravelMinutes: number;
  };
  afternoonTrip: {
    boardTime: string;
    transferAlightTime?: string;
    transferBoardTime?: string;
    alightTime: string;
    nextBusTime: string;
    totalTravelMinutes: number;
  };

  frequency: number;
  connectingRoutes: string[];
}
```

---

## UI Design

### Layout: 3-Zone Split

```
┌────────────┬─────────────────────────────────────┐
│            │                                     │
│  CONFIG    │         LEAFLET MAP                 │
│  PANEL     │    (satellite, ~60% height)         │
│  w-72      │                                     │
│  bg-gray-50│    Zone + route + stops overlay      │
│            │                                     │
│            ├─────────────────────────────────────┤
│            │    LIVE FLYER PREVIEW               │
│            │    (collapsible, ~40% height)       │
│            │                                     │
└────────────┴─────────────────────────────────────┘
```

### Config Panel (left sidebar)

- `w-72 bg-gray-50 border-r border-gray-200 overflow-y-auto`
- Sections separated by `border-b border-gray-200 p-4`

**Sections:**
1. **School Picker** — dropdown with all Barrie high schools
2. **Bell Times** — paired HH:MM inputs (morning start, afternoon end)
3. **Zone Controls** — Draw / Edit / Clear / Undo buttons
4. **Zone Info** — appears after drawing: stop count, area size
5. **Trip Result** — appears after calculation: route name, travel time, transfer details
6. **Export Button** — `bg-amber-600 text-white` — disabled until trip calculated

### Map Styling

- **Tiles:** Esri World Imagery (satellite)
- **Zone polygon:** `fillColor: '#3B82F6', fillOpacity: 0.25, color: '#1D4ED8', weight: 2`
- **Route polyline (direct):** GTFS route color, `weight: 5, opacity: 0.9`
- **Route polyline (transfer Route A):** GTFS route color, solid, `weight: 5`
- **Route polyline (transfer Route B):** GTFS route color, `dashArray: '8, 6'`, `weight: 5`
- **Bus stops in zone:** white circles, blue border (`radius: 6, fillColor: '#fff', color: '#3B82F6'`)
- **School marker:** custom `L.divIcon` with distinct pin
- **Transfer stop:** hub-glow animation (amber accent, existing pattern)
- **Travel time label:** `L.divIcon` — `bg-gray-900/90 text-white px-3 py-1 rounded-full font-bold`
- **Floating draw toolbar:** `bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg` — top-right

### Live Flyer Preview

- Container: `bg-white border border-gray-300 rounded-xl shadow-md`
- **Title bar:** `bg-gray-900 text-white px-6 py-3 rounded-t-xl` — school name + "Student Transit Pass"
- **"In Numbers":** `bg-gray-50 border border-gray-200 rounded-lg p-4` — bullet list
- **Transfer row** (when applicable): full-width, shows Route A → Route B, transfer stop, wait badge
- **Trip columns:** `grid grid-cols-2 gap-4` — morning left, afternoon right
- **Collapse toggle:** ChevronUp/ChevronDown to show/hide preview

### Transfer Quality Badges

| Quality | Wait | Tailwind |
|---------|------|----------|
| Tight | <5 min | `bg-red-50 text-red-700 border-red-200` |
| Good | 5-10 min | `bg-emerald-50 text-emerald-700 border-emerald-200` |
| OK | 10-15 min | `bg-amber-50 text-amber-700 border-amber-200` |
| Long | >15 min | `bg-red-50 text-red-700 border-red-200` |

### Interaction States

| State | Display |
|-------|---------|
| Empty | Map centered on Barrie, "Select a school to begin" placeholder |
| School selected | School pin, bell times populated, "Draw a zone to continue" |
| Drawing | Crosshair cursor, floating toolbar active |
| Zone complete | Stops highlighted, auto-calc triggered, loading spinner |
| Trip found (direct) | Route on map, preview populated |
| Trip found (transfer) | Both routes drawn, transfer stop glowing, preview with transfer details |
| No trip found | Warning card: "No transit route connects this zone to [School] before the bell" |

---

## PDF Export

1. `html2canvas` captures Leaflet map div (with overlays)
2. `jsPDF` portrait letter-size page:
   - Title bar: gray-900 background, white text (school name)
   - Map image: centered, ~55% of page height
   - "In Numbers" panel: jsPDF text/shapes (not screenshot — cleaner print)
   - Transfer row (if applicable): route color dots + arrow + details
   - Trip columns: two-column text layout
   - Footer: "Barrie Transit" + date
3. Save as `[SchoolName]-Student-Transit-Pass.pdf`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `components/Analytics/StudentPassModule.tsx` | Create — tab content, state orchestration |
| `components/Analytics/StudentPassConfig.tsx` | Create — left config panel |
| `components/Analytics/StudentPassMap.tsx` | Create — Leaflet map with drawing |
| `components/Analytics/StudentPassPreview.tsx` | Create — live flyer preview |
| `utils/transit-app/studentPassUtils.ts` | Create — GTFS trip-finding algorithm |
| `components/Analytics/TransitAppWorkspace.tsx` | Modify — add "Student Pass" tab to TAB_CONFIG |
| `package.json` | Modify — add `leaflet-draw` dependency |

---

## Not in Scope

- Multi-transfer trips (2+ transfers)
- Saving/loading zone configurations to Firebase
- Multiple zones per school
- Real-time schedule data (uses static GTFS only)
- School geocoding API (schools defined in config list)
