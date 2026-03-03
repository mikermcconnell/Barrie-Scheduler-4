# OD Zone Detail Panel — Design Doc

**Date:** 2026-03-03
**Status:** Approved
**File:** `components/Analytics/TransitAppMap.tsx`

---

## Problem

When clicking a zone on the OD map, spider mode filters arcs but:
- No auto-zoom to the zone's connected pairs
- No structured info panel showing top flows and zone stats
- Hard to understand a single zone's travel patterns at a glance

## Solution

Enhance the existing `isolatedZone` spider mode with:
1. **Auto-zoom** to bounding box of selected zone's OD pairs
2. **Right slide-out panel** (~320px) with zone summary and top flows table
3. **Map styling** — selected zone highlight, dimmed non-connected zones

## Design Details

### 1. Auto-Zoom on Zone Click

When `isolatedZone` changes to a non-null value:
- Compute `L.latLngBounds` from all `filteredPairs` that touch that zone (origins + destinations)
- Include the zone's own coordinates
- Call `map.fitBounds(bounds, { padding: [40, 360, 40, 40] })` — extra right padding for panel
- Store previous map center/zoom to restore on deselect

When `isolatedZone` clears:
- Restore previous view (or fit to Barrie bounds)

### 2. Zone Detail Panel (right side)

**Trigger:** `isolatedZone !== null`
**Width:** 320px, absolute positioned over the right side of the map area
**Animation:** slide-in from right with CSS transition

**Content top-to-bottom:**

1. **Header row** — Zone name (from `getZoneName`), close (×) button
2. **Summary stats** (4 compact metric cards):
   - Total trips (sum of all pairs touching this zone)
   - Unique connections (count of distinct connected zones)
   - Avg distance (mean haversine km)
   - Peak time period (hour bin with max trips, if hourly data available)
3. **Top flows table** — toggle between 10/20 rows:
   - Rank (colored dot matching arc color)
   - Zone name (other end of the pair)
   - Direction indicator (→ outbound, ← inbound)
   - Trip count
   - % of zone's total trips
4. **Hover row** → highlight corresponding arc on map (reuse existing `highlightArc` pattern)
5. **Click row** → zoom to that specific O-D pair and show popup

### 3. Map Styling When Zone Selected

- **Selected zone:** bright ring stroke (2px white + 3px brand color), elevated z-index
- **Connected arcs:** rank-colored as today (already works via spider filter)
- **Non-connected zones:** opacity drops to 0.15 (already partially done)

### 4. Data Flow

```
isolatedZone (coordKey string)
    ↓
filteredPairs (already filters to pairs touching zone via Step 7 in useMemo)
    ↓
zonePanelData (new useMemo):
    - zoneName: getZoneName(lat, lon)
    - totalTrips: sum of pair.count
    - connections: unique other-end zones
    - avgDistKm: mean haversine
    - peakTimePeriod: argmax over hourlyBins (if available)
    - topFlows: sorted pairs with rank, name, direction, count, pct
```

No new props needed. All data derived from existing state + `filteredPairs`.

### 5. Layout

```
┌─────────────────────────────────────────────────────┐
│ [Controls row 1]                                    │
│ [Filters row 2]                                     │
│ [Stats bar]                                         │
├──────────────────────────────────┬──────────────────┤
│                                  │ ── Zone Panel ── │
│   MAP (leaflet)                  │ [Zone Name]  [×] │
│   auto-zoomed to                 │                  │
│   zone extents                   │ 142 trips        │
│                                  │ 12 connections   │
│                                  │ 4.2 km avg       │
│                                  │ Peak: PM         │
│                                  │                  │
│                                  │ Top 10 ▾ 20      │
│                                  │ 1. Downtown  89  │
│                                  │ 2. Allandale 67  │
│                                  │ 3. South End 34  │
│                                  │ ...              │
├──────────────────────────────────┴──────────────────┤
│ [Legend / Table below]                              │
└─────────────────────────────────────────────────────┘
```

The map container and panel are siblings inside a flex row. When panel is visible, map gets `flex-1` and panel gets `w-80`.

## Implementation Scope

**Single file:** `TransitAppMap.tsx`
**New state:** `prevMapView` (center/zoom for restore)
**New memo:** `zonePanelData`
**New JSX:** `ZoneDetailPanel` section (inline, not a separate component)
**CSS:** Tailwind only, transition for slide-in

## Out of Scope

- Separate component file (not needed for this size)
- Zone comparison (selecting multiple zones)
- Export zone data to PDF (can add later)
