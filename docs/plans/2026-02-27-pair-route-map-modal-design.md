# Pair Route Map Modal

**Date:** 2026-02-27
**Status:** Approved
**Component:** ODRouteEstimationModule (Pair Route Assignments table)

## Summary

Add a map icon column to the Pair Route Assignments table. Clicking the icon opens a modal with a Leaflet map showing the origin-destination journey, number of people, route legs, and transfer point(s) if applicable.

## Requirements

1. First column in table: MapPin icon (lucide-react)
2. Click opens Modal with embedded Leaflet map
3. Map shows origin marker, destination marker, transfer marker(s), and curved arcs between them
4. Info card below map: route name(s), via stop(s), journey count, confidence badge, "Why" explanation
5. Fallback when geocodes missing: info card only, gray placeholder instead of map

## Architecture

### Data Flow

```
ODMatrixWorkspace (has geocodeCache)
  └─ ODRouteEstimationModule (new prop: geocodeCache)
       └─ state: selectedPair (ODPairRouteMatch | null)
       └─ ODPairMapModal (new component)
            ├─ Resolves coords from geocodeCache
            ├─ Leaflet map with arcs + markers
            └─ Info card with journey details
```

### New Files

- `components/Analytics/ODPairMapModal.tsx` — Modal component with Leaflet map

### Modified Files

- `components/Analytics/ODRouteEstimationModule.tsx` — Add map icon column, selectedPair state, render modal
- `components/Analytics/ODMatrixWorkspace.tsx` — Pass geocodeCache to ODRouteEstimationModule

## Modal Layout

```
┌──────────────────────────────────────────────┐
│  ✕                                            │
│  Origin  →  Destination                       │
│  N journeys                                   │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │     [Leaflet Map ~300px]                 │ │
│  │     Blue marker (origin)                 │ │
│  │     ~~~curved arc (leg 1)~~~             │ │
│  │     Purple diamond (transfer)            │ │
│  │     ~~~curved arc (leg 2)~~~             │ │
│  │     Red marker (destination)             │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  Route       Route name(s)                    │
│  Via         Transfer stop(s) or —            │
│  Stops       N intermediate                   │
│  Confidence  Badge + why explanation          │
│                                               │
└──────────────────────────────────────────────┘
```

## Map Specifications

- **Tiles:** OpenStreetMap (same as ODFlowMapModule)
- **Arcs:** Bezier curves, blue palette matching existing flow map
- **Markers:**
  - Origin: blue circle with label
  - Destination: red circle with label
  - Transfer: purple diamond with label
- **Bounds:** fitBounds() on all points with padding
- **Interactions:** Drag/zoom enabled, scroll zoom disabled

## Fallback (Missing Coordinates)

When either origin or destination lacks geocoded coordinates:
- Modal opens with same header and info card
- Map area shows gray placeholder: "Coordinates not available. Run geocoding to enable the map view."

## Table Column

- Icon: MapPin from lucide-react (16px)
- Color: gray-400, hover:violet-500
- Cursor: pointer
- Position: first column (before Origin)
