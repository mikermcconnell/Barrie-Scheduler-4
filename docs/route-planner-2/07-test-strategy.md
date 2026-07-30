# Route Planner 2 Test Strategy

## Testing Goals

Tests should protect the Route Planner 2 clean boundary and the operational feasibility calculations.

Focus on:
- route operations
- map authoring state transitions
- feasibility calculations
- warning generation
- GTFS route pattern grouping
- GTFS pattern to editable route scenario conversion, including multi-route import into one workspace
- imported stop ordering and terminal role assignment
- imported shape simplification and waypoint ownership
- stop range copy/move between route concepts
- old Route Planner isolation

## Unit Tests

Recommended coverage:
- create/duplicate/delete routes
- preferred route selection
- preferred route single-source-of-truth behavior
- stop ordering
- terminal role validation
- runtime source priority
- scheduled-basis workspace integration and planner-controlled source/route filters
- best-available observed proxy/blend derivation as an engine capability, without implying that the current workspace enables it
- direct adjacent-pair, multi-edge corridor-path, and shape-overlap evidence matching
- partial scheduled coverage and rejection of candidate routes that leave the drawn corridor
- evidence diagnostics for unmatched stops, route mismatch, missing period data, and missing corridor paths
- cycle time calculation
- bus requirement calculation
- confidence calculation
- warning generation
- GTFS route pattern grouping
- GTFS pattern to editable route scenario conversion, including scheduled runtime evidence
- imported stop ordering and terminal role assignment
- imported shape simplification and waypoint ownership
- large-route virtualization/windowing and label-selection limits
- fallback road-snap segment estimates when Mapbox snapping is skipped or unavailable
- saved accepted runtime remains unchanged during background road snapping and failed refreshes
- explicit refresh bypasses the route cache, stages old/new totals, and changes runtime only after acceptance
- accepted/rejected snapshot history is bounded and runtime lock blocks acceptance
- Mapbox failure categories are sanitized and never expose tokens
- segment runtimes retain the locked round-each-segment-before-summing behavior

Current focused suites:
- `tests/routePlanner2RuntimeEvidence.test.ts` covers scheduled and best-available evidence derivation, matching methods, route filters, diagnostics, and partial coverage.
- `tests/routePlanner2RuntimeSnapshots.test.ts` covers staged Mapbox comparisons, accept/reject decisions, locking, bounded history, and first-save acceptance.
- `tests/RoutePlanner2Workspace.localWorkspace.test.tsx` covers scheduled GTFS runtime behavior and runtime-source UI integration.
- `tests/routePlanner2RoadSnap.test.ts` covers Mapbox road-snap estimates and failure behavior.

Keep the distinction explicit in tests: evidence-engine unit tests may use the default best-available observed basis, while the current workspace integration must preserve scheduled-only behavior unless the product contract intentionally changes.

## Component Tests

Recommended coverage:
- workspace renders with starter project/route
- route selection updates details panel
- editing route name/notes updates state
- comparison table reflects route metrics
- “not ready” states appear when inputs are missing

## Integration Tests

Recommended v1 flows:
1. create blank route
2. add route points
3. add stops
4. mark terminals
5. enter frequency and terminal layovers
6. see feasibility outputs
7. duplicate route
8. compare metrics

## Regression Guards

Route Planner 2 should not import old Route Planner modules.

A simple guard test can scan Route Planner 2 files for disallowed imports from:
- `utils/route-planner/`
- old Route Planner controller hooks
- old Route Planner project services
- old Route Planner draft storage

## Manual QA Checklist

Before calling v1 work complete:
- project name can be edited
- route can be created, renamed, duplicated, deleted
- stops can be ordered and terminal roles are clear
- feasibility output shows not-ready states before required inputs
- runtime confidence is visible
- warnings are actionable
- comparison table is understandable
- save/load UI reflects team-scoped persistence state clearly
- importing one or more GTFS routes creates new route concepts with line, all stops, and scheduled segment runtime evidence
- imported stops can still be moved, renamed, reordered, and deleted
- imported route line can still be edited with bend anchors
- UI clearly says the import is a local planning copy, not GTFS editing
- map stop trays for routes above 10 stops stay collapsed by default
- stop ranges can be copied or moved into another route concept at a chosen insertion position
- map PDF exports show centered text in stop labels, header KPI cards, and the
  legend; no label text should sit on the lower edge of its pill/card
- large camp/address-import routes stay responsive: stop labels are capped, the stop-order rail virtualizes, and fallback segment runtimes appear even when automatic road snapping is skipped
