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
- no imports from legacy Route Planner controllers, services, or utilities

## Milestone 1B: Team Save/Load

Outcome:
- team-scoped project save/load
- saved route concept scenarios under each project
- header controls for save and loading existing plans

Acceptance:
- Route Planner 2 Firebase access stays isolated in `routePlanner2ProjectPersistence.ts`
- saves use `teams/{teamId}/routePlanner2Projects/{projectId}` and `scenarios/{scenarioId}`
- UI clearly distinguishes local drafts from saved team plans

## Milestone 2: Stop-Aware Map Authoring

Outcome:
- edit alignment
- add, remove, and order stops
- mark start/end terminals, timed stops, and bus turnaround stops
- selected stop details
- validation for missing/invalid terminal setup
- validation that out-and-back routes do not imply a U-turn or 3-point turn

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

## Future Milestone: Save Conflict Handling

Future outcome:
- version or updated-at conflict handling if multiple planners edit the same route plan concurrently

## Future Milestone: Observed Runtime Activation

The evidence engine already implements and tests observed proxy matching, observed/scheduled blending, sample-size confidence, matching diagnostics, and segment fallback disclosure. The current workspace intentionally calls that engine with a scheduled-only basis.

Future outcome:
- make an explicit product and UI decision about enabling best-available observed evidence in the interactive workspace
- disclose observed sample size, blend behavior, and provenance before observed values affect feasibility totals
- preserve planner-controlled runtime source and route filters

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
