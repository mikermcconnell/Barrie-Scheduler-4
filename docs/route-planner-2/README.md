# Camp Shuttle Planner Documentation

Current source of truth for the **Camp Shuttle Planner**. Its stable internal code name remains `Route Planner 2`, including component names, route keys, persistence paths, and utility folders; those identifiers are not user-facing and do not require a data migration.

Camp Shuttle Planner is a new module, not a continuation of the old Route Planner implementation. The old Route Planner docs live in `docs/route-planner-legacy/` and may be used only as background.

## Task Router

Read this page first, then load only the documents required for the task.

| Task | Load next |
|------|-----------|
| Product purpose, v1 scope, principles, non-goals, or success criteria | `01-product-brief.md` |
| Planner workflow, import, authoring, transfer, comparison, save, or export behavior | `02-user-workflows.md` |
| Layout, map/rail interactions, responsive behavior, warnings, or export presentation | `03-ux-spec.md` |
| Module ownership, adapters, data flow, persistence boundary, or legacy isolation | `04-architecture.md` |
| Types, field semantics, runtime sources, route families, or Firestore shape | `05-data-model.md` |
| Runtime priority, evidence derivation, feasibility, confidence, or accepted Mapbox lifecycle | `06-runtime-intelligence.md` |
| Automated coverage, regression guards, or manual QA | `07-test-strategy.md` |
| Milestone intent or future work | `08-roadmap.md`, then verify current code and tests before treating status as current |

Cross-cutting runtime changes commonly require `04-architecture.md`, `05-data-model.md`, `06-runtime-intelligence.md`, and `07-test-strategy.md`. Do not load all numbered documents by default.

## Documentation Contract

These docs are the default contract for Camp Shuttle Planner (`Route Planner 2` internally) coding. Product and behavioral intent lives here; current implementation claims must also be verified in code and tests. If implementation needs to deviate, update the relevant doc first so the next agent has the current source of truth.

## V1 Scope Summary

Camp Shuttle Planner v1 is a team-saveable operational feasibility workspace for Camp and address-based shuttle route concepts.

In scope:
- project with routes
- blank route concept workflow
- stop-aware map authoring
- service assumptions
- runtime, cycle time, bus requirement, and warning outputs
- simple route metrics comparison
- on-screen planning summary
- screenshot-first map PDF export and operator turn-by-turn PDF export for field review
- importing one or more full GTFS bus routes as editable local route concept templates
- importing Excel/CSV address lists as custom stops, with duplicate addresses merged and unresolved geocodes held for review
- team-scoped save/load of route planner projects

Out of scope for v1:
- coverage analysis
- downstream schedule handoff
- editing, publishing, or exporting GTFS feeds; imported GTFS routes are editable planning copies only
- production publishing
- importing old Route Planner controllers or services
