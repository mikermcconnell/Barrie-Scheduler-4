# Route Planner 2 UX Spec

## Design Direction

Route Planner 2 should feel warm, operational, and focused. It should not feel like a heavy GIS editor.

Use the existing Scheduler 4 friendly visual language:
- soft workspace background
- white rounded panels
- clear borders
- strong but compact action buttons
- tinted KPI and warning cards
- quiet map controls

## Desktop Layout

Recommended v1 layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Header: Back | Project Name | Status | Save soon | Actions   │
├──────────────┬───────────────────────────────┬───────────────┤
│ Left Rail    │ Map Canvas                    │ Right Rail    │
│ Project      │ Alignment + stops             │ Route      │
│ Routes    │ One draw-route workflow        │ Service       │
│ Compare      │ Selection state               │ Feasibility   │
└──────────────┴───────────────────────────────┴───────────────┘
```

The implemented direction is map-first: the map owns the full workspace and
the left route rail and right route-detail rail sit as collapsible overlays.
Entering draw focus mode collapses both rails and keeps only compact route
metrics visible on the map.

Default map authoring should show one active instruction at a time. Keep debug
details such as snap source, future persistence notes, and comparison outputs
out of the primary map view unless the planner opens Details or Comparison.
Route concepts should live in the header bar as compact selectable cards, not
as a persistent map overlay rail. This keeps the map as the primary surface.

## Header

Header should show:
- back action
- editable project name
- module label: Route Planner 2
- local/draft status
- operator turn-by-turn PDF export
- disabled or future-labelled save/export if not implemented

Avoid implying Firebase persistence exists in v1.

## Left Rail

Left rail owns planning object navigation:
- project summary
- route list
- add/duplicate/delete actions
- preferred route indicator
- simple comparison table or link to comparison drawer

## Map Canvas

Map canvas should support stop-aware authoring without separate GIS-style modes.

V1 interactions:
- click the map to add stops in travel order
- drag numbered stop markers to move stops
- delete stops from the stop order list
- choose route type: one-way, closed loop, or out-and-back
- click the route line to create one or more route-line waypoints
- click the route line and choose **Add stop here** to insert an intermediate stop between existing stops
- drag route-line `+` waypoint handles to bend the travel path, Google Maps-style
- delete route-line waypoint handles directly from the map
- show direction arrows on route lines; out-and-back shared segments should show arrows in both directions

When a route has more than 10 stops, the map stop tray should collapse to a compact summary with stop count, start/end, selected stop, and a **Show all stops** action. The full list may expand into a scrollable tray or live in the details panel; it should not cover the map by default.

Route type controls:
- Show **Closed loop** once there are at least 3 stops. It adds the final segment from the last stop back to Stop 1.
- Show **Out and back** once there are at least 2 stops. It returns from the turnaround stop to Stop 1 in reverse stop order.
- For out-and-back routes, allow the selected stop to become the turnaround point.

Required visible states:
- selected stop
- start terminal
- end terminal
- missing terminal warning
- unsaved/local-only state if applicable

For network redesign work, the right rail should include a compact **Reassign stops** control that can copy or move a contiguous stop range into another route concept. It should require the planner to choose the target route and insertion position instead of guessing where transferred stops belong.

## Right Rail

Right rail turns the selected route into planning meaning.

Recommended sections:
1. Route details
2. Service assumptions
3. Feasibility outputs
4. Warnings
5. On-screen summary

## KPI Cards

Show the main planning outputs as cards:
- one-way runtime
- cycle time
- buses required
- confidence

KPI cards should show “not ready” states when required inputs are missing.
The map metric strip should also include recovery as `minutes (percent)` once cycle time and frequency are ready.
The confidence metric should expose a small hover pop-out explaining what the
confidence value means.

## Operator PDF Export

The header should include an **Operator PDF** export once a route has at least
two stops. The PDF should look professional and field-ready:
- strong title/header treatment
- compact KPI cards
- clear stop sequence
- segment-by-segment turn-by-turn instructions
- clear source label: Mapbox turn-by-turn or planning-alignment fallback
- operator note that the directions must be verified before issuing

## Warnings

Warnings must be direct and actionable.

Examples:
- “Add a start terminal before estimating cycle time.”
- “End terminal is missing.”
- “Runtime uses fallback assumptions for 4 of 7 segments.”
- “Target frequency requires more buses than expected.”

## Responsive Expectations

Desktop is the priority. Narrow screens may stack panels, but the map should remain near the top and not be buried under long forms.
