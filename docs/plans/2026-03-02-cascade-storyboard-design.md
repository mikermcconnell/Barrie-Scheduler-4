# Cascade Storyboard — Design Document

**Date**: 2026-03-02
**Feature**: Visual cascade story for dwell incidents
**Status**: Approved

---

## Problem

The dwell cascade feature computes rich per-timepoint deviation data for every downstream trip, but the UI only shows counts and tables. There is no visual representation of how a delay propagates through a block and where/when it recovers. Users need to "see the story."

## Solution

A 3-panel **Cascade Storyboard** that opens as a slide-over panel when a user clicks an incident card in `DwellCascadeSection`. Each panel tells a different dimension of the same story.

---

## Entry Point

- **Trigger**: Click any incident card in the "Top Incidents" grid of `DwellCascadeSection.tsx`
- **Container**: Right slide-over panel, ~70% viewport width
- **Header**: "Cascade Story — Route {X}, Block {Y}" with severity badge, date, origin stop, excess dwell duration
- **Close**: X button or click outside

---

## Panel 1: Delay Timeline Chart (~200px height)

A continuous area chart tracking deviation in minutes at each timepoint across all downstream trips.

### Layout
- **X-axis**: Sequential timepoints, grouped by trip. Trip boundaries shown as vertical dashed lines with trip name labels above.
- **Y-axis**: Deviation in minutes (0 = on schedule, positive = late)
- **Red filled area**: Actual deviation at each timepoint
- **Horizontal dashed red line**: +5 min OTP threshold
- **Green zone**: 0–5 min range (on-time band)
- **Origin marker**: Far left, icon + dwell duration label
- **Recovery marker**: Green checkmark where deviation drops below threshold (if recovery occurs)

### Interaction
- Hover any point → tooltip with stop name, scheduled vs. observed departure, deviation
- Click a point → highlights the corresponding stop in Panel 3 (map)

### Data Source
- `DwellCascade.cascadedTrips[].timepoints[]` — `CascadeTimepointObs` has `stopName`, `scheduledDeparture`, `observedDeparture`, `deviationSeconds`, `isLate`
- Timepoints with null `observedDeparture` shown as gaps (no AVL data)

### Implementation
- Pure SVG rendered in React (no charting library needed)
- Points plotted sequentially; deviation = `deviationSeconds / 60` on Y-axis

---

## Panel 2: Trip Chain Diagram (~120px height)

A horizontal subway-map-style node-link diagram showing the block's trip sequence after the dwell event.

### Layout
- **Origin node** (left): Diamond/burst icon. Route, stop name, dwell duration. Dark red.
- **Trip nodes**: Rounded rectangles connected left-to-right by a thick line.
  - Content: Trip name, Route ID, terminal departure time, late timepoint count (e.g., "3/5 late")
  - Color: Red (all timepoints late), Amber (mixed), Green (all on-time)
- **Connecting lines**: Show scheduled recovery time between trips (e.g., "4 min"). Color transitions red → green as recovery progresses.
- **Recovery marker**: Green checkmark badge on the trip where recovery happened
- **Not recovered**: Red "!" badge on the last node if no recovery

### Interaction
- Click a trip node → highlights its timepoints in Panel 1, its stops in Panel 3
- Hover → mini tooltip with stop-by-stop breakdown
- Horizontally scrollable if > 6 trips (most cascades are 2–5)

### Data Source
- `DwellCascade.cascadedTrips[]` — `CascadeAffectedTrip` has `tripName`, `routeId`, `terminalDepartureTime`, `scheduledRecoverySeconds`, `lateTimepointCount`, `otpStatus`, `recoveredHere`

---

## Panel 3: Route Map (~300px height)

A Leaflet map showing the geographic footprint of the cascade.

### Layout
- **Route polyline**: Affected route(s) drawn as a path
- **Origin stop**: Larger pulsing red marker with popup (dwell details)
- **Timepoint stops**: Circle markers colored by deviation:
  - Red: > 5 min late
  - Amber: 2–5 min late
  - Green: Recovered/on-time
  - Gray: No AVL data / skipped
- **Recovery stop**: Green marker with checkmark icon
- **Auto-fit bounds**: Map zooms to fit all affected stops

### Interaction
- Hover stop marker → tooltip with stop name, deviation, scheduled vs. observed
- Highlighted stops sync with Panel 1 and Panel 2 selections

### Data Dependency
- Stop coordinates from GTFS `stops.txt` (already used in HeadwayMap, ODFlowMapModule)
- Match by `stopId` from `CascadeTimepointObs`
- **Fallback**: If no geocoordinates available, show "No coordinates available" message; Panels 1 and 2 still function independently

---

## Cross-Panel Interaction

All three panels share a `selectedTripIndex` / `selectedTimepointIndex` state:
- Clicking a trip node in Panel 2 highlights that trip's timepoints in Panel 1 and stops in Panel 3
- Clicking a point in Panel 1 highlights the corresponding stop in Panel 3
- Visual sync via shared React state (lifted to the slide-over container)

---

## Component Structure

```
CascadeStorySlideOver (new)
├── CascadeStoryHeader
├── CascadeTimelineChart (Panel 1, SVG)
├── CascadeTripChain (Panel 2, SVG/HTML)
├── CascadeRouteMap (Panel 3, Leaflet)
└── shared state: selectedTrip, selectedTimepoint, cascade data
```

**Files to create**:
- `components/Performance/CascadeStorySlideOver.tsx` — container + state
- `components/Performance/CascadeTimelineChart.tsx` — Panel 1
- `components/Performance/CascadeTripChain.tsx` — Panel 2
- `components/Performance/CascadeRouteMap.tsx` — Panel 3

**Files to modify**:
- `components/Performance/DwellCascadeSection.tsx` — add click handler to incident cards, render slide-over

---

## Existing Data Structures (No Backend Changes)

All data needed is already computed and available in the `DwellCascade` type:
- `cascadedTrips[].timepoints[]` — per-stop deviation data (Panel 1)
- `cascadedTrips[]` — trip-level status (Panel 2)
- Stop IDs for geocoding lookup (Panel 3)

No changes to `dwellCascadeComputer.ts` or Firebase storage required.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Container | Slide-over (70% width) | Keeps cascade section visible for context |
| Chart library | Pure SVG | Data is simple enough; avoids dependency |
| Map library | Leaflet (existing) | Already used in 5+ components |
| Trip chain | Horizontal subway diagram | Natural reading direction, matches trip sequence |
| Cross-panel sync | Shared React state | Simple, no external state management needed |
| Stop coordinates | GTFS stops.txt lookup | Already loaded for other map features |
