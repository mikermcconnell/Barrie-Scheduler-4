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

The implemented direction is full-screen map-first: the map owns the full
workspace and app controls sit as map-integrated side panels instead of taking
vertical page space. Project identity sits in a small floating chip, primary
actions live in a collapsible left action sidebar, and the route-detail rail is
a collapsible right-side review panel with save available at the top. Entering draw
focus mode hides the command overlays and keeps only compact route metrics
visible on the map.

Default map authoring should show one active instruction at a time. Keep debug
details such as snap source, future persistence notes, and comparison outputs
out of the primary map view unless the planner opens Details or Comparison.
Route concepts should live inside the collapsible left sidebar. In the
collapsed state, keep quick access to expand route concepts and add a route; in
the expanded state, show compact vertical route concept cards. This keeps the
map as the primary surface without leaving route switching hidden.

## Project Chip and Action Sidebar

The floating project chip should show:
- back action
- editable project name
- module label: Route Planner 2
- local/draft status

The left action sidebar should be collapsible:
- collapsed: icons only, with accessible labels
- expanded: route concepts, icons plus labels, and saved-plan selector
- route concepts: add route and select route concept from compact vertical cards
- actions: undo, redo, source overlay, save, load, duplicate, import GTFS, import addresses, operator PDF, camp focus, review route
- operator turn-by-turn PDF export
- Camp Focus action for the seasonal camp shuttle concept review
- disabled or future-labelled save/export if not implemented
- a compact route review toggle

Avoid implying Firebase persistence exists in v1.

GTFS and address import workflows should open as map-integrated side drawers
instead of page-centred modals so the planner keeps geographic context while
importing.

Draw-route guidance, address search, add-stop action, and route type controls
belong in the right-side review panel, not as a large floating card on top of
the map.

## Camp Shuttle Focus

Camp Shuttle Focus is a Route Planner 2 view, not a separate recurring-service module.
It should reuse the selected route concept and hide the generic review rail so the map
and camp-specific shuttle summary are primary.

The focus panel should emphasize:
- summer service label
- stop count and stop order
- service span and headway
- one-way runtime, cycle time, and buses required
- clear note that detailed edits still happen in the normal Route Planner 2 review panel

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
- move the mouse over the map and press `1` to add a stop at the pointer location
- search for a Canadian address near Barrie, pick an autocomplete suggestion, and add it as the next stop
- import an Excel/CSV address list, preview mapped/unresolved addresses, merge duplicate addresses, and add mapped stops in geographic order
- drag numbered stop markers to move stops
- delete stops from the stop order list
- choose route type: one-way, closed loop, or out-and-back
- for one-way shuttle patterns, use **Create back direction** to generate a separate editable **Back** route concept from the selected **Out** route
- click the route line to select a segment and open the segment popover without changing the route
- press `2` to add a bend at the pointer location on the nearest route segment, or use **Add bend here** in the segment popover
- use **Add stop here** in the segment popover when explicitly inserting a stop into a selected segment
- click the route line and edit the selected segment runtime in a small map popover; saved values become planner manual overrides
- drag route-line `+` waypoint handles to bend the travel path, Google Maps-style
- delete route-line waypoint handles directly from the map
- show direction arrows on route lines; out-and-back shared segments should show arrows in both directions
- undo and redo planner edits from the sidebar or keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Y`, `Ctrl/Cmd+Shift+Z`)

The full stop order belongs in the review rail as a scrollable panel, not as an expandable map overlay or duplicate map tray. This prevents imported routes with many stops from covering route controls or metrics.

Map overlay ownership:
- top-left: draw guidance and address search
- top-right: focus toggles and transient progress only
- bottom-left: keep clear unless a future non-duplicative map control is needed
- bottom-right: route metric strip

New map UI should use those zones instead of adding free-floating overlays.

Route type controls:
- Show **Closed loop** once there are at least 3 stops. It adds the final segment from the last stop back to Stop 1.
- Show **Out and back** once there are at least 2 stops. It automatically marks the far end stop as the turnaround, then returns to Stop 1 in reverse stop order.

Required visible states:
- selected stop
- start terminal
- end terminal
- missing terminal warning
- unsaved/local-only state if applicable

For network redesign work, the right rail should include a compact **Reassign stops** control that can copy or move a contiguous stop range into another route concept. It should require the planner to choose the target route and insertion position instead of guessing where transferred stops belong.

## Right Rail

Right rail turns the selected route into planning meaning.

The right rail should mirror the left sidebar's reduce/expand behavior:
- collapsed: narrow icon rail with accessible labels for review, save, and draw
- expanded: full route review, save action, route authoring controls, and details

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
