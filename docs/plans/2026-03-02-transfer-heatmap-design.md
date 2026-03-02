# Transfer Heatmap Design

**Date:** 2026-03-02
**Scope:** Add interactive transfer point heatmap to Routes & Transfers tab

## Summary

An interactive Leaflet map showing transfer point volume — circle markers at each transfer stop, sized and color-graded by total passenger journeys transferring there. Clicking a marker shows a popup with connecting routes and top pairs.

## Data Pipeline

1. Filter `routeEstimation.matches` for entries with `transfer !== undefined`
2. Extract `transfer.transferStops` (intermediate stop names) from each
3. Aggregate by stop: `{ stopName, totalJourneys, pairCount, connectingRoutes }`
4. Geocode each stop via `geocodeCache.stations[name]` lookup
5. Graceful fallback: skip stops that can't be geocoded

## Visual Design

- **Leaflet map** with CartoDB Light basemap, raw `L.map()` ref pattern
- **Circle markers** (`L.circleMarker`) per transfer stop:
  - Radius: proportional to volume (8px min, 30px max)
  - Color: heat gradient — amber (low) → deep violet (high)
  - Border: 2px white stroke
- **Popup on click**: stop name, total journeys, pair count, connecting routes
- **Container**: 400px `ChartCard` wrapper, subtitle with transfer counts
- **Placement**: Between Route Distribution chart and Station Match table

## Tab Rename

`Route Assignment` → `Routes & Transfers` in `ODMatrixWorkspace.tsx` TAB_CONFIG

## Files Modified

| File | Change |
|------|--------|
| `ODRouteEstimationModule.tsx` | Add transfer heatmap map section |
| `ODMatrixWorkspace.tsx` | Rename tab label |
