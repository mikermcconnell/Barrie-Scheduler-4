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

## Header

Header should show:
- back action
- editable project name
- module label: Route Planner 2
- local/draft status
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
- click the route line to create one or more route-line waypoints
- drag route-line `+` waypoint handles to bend the travel path, Google Maps-style

Required visible states:
- selected stop
- start terminal
- end terminal
- missing terminal warning
- unsaved/local-only state if applicable

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

## Warnings

Warnings must be direct and actionable.

Examples:
- “Add a start terminal before estimating cycle time.”
- “End terminal is missing.”
- “Runtime uses fallback assumptions for 4 of 7 segments.”
- “Target frequency requires more buses than expected.”

## Responsive Expectations

Desktop is the priority. Narrow screens may stack panels, but the map should remain near the top and not be buried under long forms.
