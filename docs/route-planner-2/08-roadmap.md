# Route Planner 2 Roadmap

## Milestone 0: Documentation Foundation

Outcome:
- Route Planner 2 docs are the current source of truth.
- old Route Planner docs are moved to legacy background.
- v1 scope and boundaries are clear.

## Milestone 1: Clean Local Workspace

Outcome:
- project and route model
- local state controller
- create/rename/duplicate/delete routes
- preferred route marker
- starter comparison table

Acceptance:
- project and route state use the data model in `05-data-model.md`
- preferred route is stored once at project level
- UI does not imply Firebase persistence exists
- no imports from legacy Route Planner controllers, services, or utilities

## Milestone 2: Stop-Aware Map Authoring

Outcome:
- edit alignment
- add, remove, and order stops
- mark start/end terminals and timed stops
- selected stop details
- validation for missing/invalid terminal setup

## Milestone 3: Feasibility Engine

Outcome:
- service assumptions
- one-way runtime estimate
- cycle time estimate
- buses required estimate
- confidence and warning model
- segment-level source disclosure

## Milestone 4: Route Comparison and Summary

Outcome:
- metrics table across routes
- preferred route summary
- on-screen planning summary
- clear not-ready and warning states

## Future Milestone: Firebase Persistence

Not v1.

Future outcome:
- team-scoped project save/load
- route persistence
- version or updated-at conflict handling if needed

## Future Milestone: Observed Runtime Integration

V1 is designed for this, but wiring may land after fallback estimates.

Future outcome:
- observed proxy matching
- sample-size confidence
- fallback disclosure by segment

## Future Milestone: Downstream Schedule Handoff

Not v1.

Future outcome:
- structured handoff package for schedule development
- assumptions, stops, runtime evidence, warnings, and preferred route data

## Future Milestone: Coverage Analysis

Not v1.

Future outcome:
- population and employment coverage
- route-to-route coverage deltas
- strategic destinations and land-use layers
