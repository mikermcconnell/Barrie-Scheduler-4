# Route Planner 2 User Workflows

## Primary V1 Workflow: Blank Route Concept

1. Open Route Planner 2.
2. Create or rename a project.
3. Create a route.
4. Draw the route alignment.
5. Add stops along the alignment.
6. Mark start and end terminals.
7. Enter service assumptions.
8. Review operational feasibility outputs.
9. Duplicate the route to test another option.
10. Compare route metrics.
11. Review the on-screen summary.
12. Export a professional operator turn-by-turn PDF for field review.

## Imported GTFS Route Workflow

A planner can start from an existing GTFS route instead of a blank concept.

1. Open Route Planner 2.
2. Click **Import GTFS route**.
3. Select one or more full-route patterns. Partial/short-turn patterns are filtered out.
4. Import them as new editable route concepts in the same workspace.
5. Review each imported route line, stop sequence, terminal roles, and scheduled segment runtimes.
6. Move, remove, add, or rename stops as needed.
7. Adjust route line waypoints if the concept changes.
8. Enter service assumptions and review feasibility.

Imported GTFS routes are local planning copies. Editing them does not change the GTFS feed or create a fixed-route schedule draft.

## Imported Address List Workflow

A planner can import Excel/CSV address lists as custom stops.

1. Upload the address file.
2. The importer extracts street, city, province, and postal code rows, merges duplicate addresses, and geocodes each unique address.
3. Mapped addresses are previewed in geographic order before being added to the route.
4. Addresses that cannot be matched confidently stay in **Needs manual review**.
5. Each review item shows safe diagnostics: query used, geocoder source, response status, result count, top Mapbox label, and why the top result was rejected.
6. The planner edits the address and retries the match before adding it.

Diagnostics must never expose Mapbox token values.

## Project and Route Workflow

A project is the planning container. A route is one route option inside that project.

Required v1 actions:
- rename project
- create route
- rename route
- duplicate route
- delete route
- select active route
- mark one route as preferred when ready

## Stop Reassignment Workflow

When a planner is redesigning service coverage, they can reassign a contiguous stop range between route concepts.

1. Open the source route concept.
2. Use **Reassign stops** in the details panel.
3. Choose the first and last stop in the range.
4. Choose the target route concept.
5. Choose whether to insert the stops at the beginning, after a target stop, or at the end.
6. Use **Copy stops** to test coverage overlap or **Move stops** to transfer coverage.

Moved stops are removed from the source route and copied into the target route with new local IDs. Existing route-line bend anchors and stale segment runtimes are cleaned up where the stop order changes.

V1 may store this state locally only. The workflow should still use stable IDs and a structure that can later move to Firebase.

Preferred route should be project-level state. Do not create competing “preferred” flags on multiple routes.

## Stop-Aware Authoring Workflow

The planner should be able to:
- add route points to form an alignment
- add stops
- add stops from cached popular Barrie places such as Sadlon Arena, Peggy Hill Team Community Centre, and Barrie Community Sports Complex when Mapbox does not return POI-name suggestions
- reorder stops
- remove stops
- mark stop roles: regular stop, timed stop, start terminal, end terminal, bus turnaround
- choose a route shape: one-way, closed loop, or out-and-back
- see warnings when terminal roles are missing or invalid

The route line is useful, but stops and terminals are what make the concept operationally meaningful.

Route shape workflow:
- One-way keeps the stop order as drawn.
- Closed loop adds the final segment from the last stop back to Stop 1. The planner should not redraw Stop 1.
- Out-and-back automatically marks the far end stop as the turnaround and adds the return trip in reverse order back to Stop 1.

## Service Assumption Workflow

The planner enters simple assumptions:
- first trip time
- last trip time
- target frequency
- start and end terminal layover minutes
- day type or planning period if needed

The output updates from these assumptions.

The stop order cards should show the first-trip arrival time at each stop using
the current segment runtimes and intermediate dwell allowance. Imported address
stops should also show kids picked up at that stop and the running total through
the route.

## Comparison Workflow

V1 comparison should be simple and table-based.

Compare routes by:
- stop count
- estimated one-way runtime
- cycle time
- buses required
- warning count
- confidence level

Map overlay comparison is future scope.

## Summary Workflow

V1 should provide an on-screen summary only.

The summary should include:
- route name
- stop count and terminal status
- service assumptions
- runtime/cycle/bus outputs
- runtime source and confidence
- warnings and notes

Future versions may turn this into a structured schedule handoff package.

## Operator Direction Export Workflow

When a route has at least two stops, the planner can export an operator-facing
turn-by-turn PDF. The export should be clean enough for field review and should
include:
- route name, project name, generated date, and route type
- stop sequence
- runtime, cycle, recovery, buses, and confidence
- segment-by-segment directions
- a visible planning note reminding staff to confirm stop placement, safe turns,
  road restrictions, construction, and supervisor approval before issuing

When Mapbox turn-by-turn steps are available, use them. If not, export a clearly
labelled planning-alignment fallback rather than pretending exact turns are
known.

## Map PDF Export Workflow

When a route has at least two stops, the planner can export a map-first PDF for
review. The export should show the route line, numbered stops, start/end
markers, and route road-name labels derived from Mapbox direction steps when
available. The full-route overview page should keep the numbered stops but hide
stop text labels so the route remains readable; close-up detail pages should
keep the stop/address labels and imported kids counts.

Implementation gotcha: keep this export screenshot-first for the map itself.
Capture the app map as an image and place it into the PDF; do not redraw the map
with jsPDF primitives. For captured map labels, use inline SVG text with explicit
centered baselines because plain HTML/CSS text captured by `html2canvas` can
drift low inside pills. For the PDF header, KPI cards, and legend, use vector
jsPDF text/shapes with `baseline: 'middle'`; do not rasterize an SVG header into
a PNG because it makes the header text and cards blurry.
