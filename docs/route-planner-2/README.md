# Camp Shuttle Planner Documentation

Current source of truth for the **Camp Shuttle Planner**. Its stable internal code name remains `Route Planner 2`, including component names, route keys, persistence paths, and utility folders; those identifiers are not user-facing and do not require a data migration.

Camp Shuttle Planner is a new module, not a continuation of the old Route Planner implementation. The old Route Planner docs live in `docs/route-planner-legacy/` and may be used only as background.

## Read Order

1. `01-product-brief.md`
2. `02-user-workflows.md`
3. `03-ux-spec.md`
4. `04-architecture.md`
5. `05-data-model.md`
6. `06-runtime-intelligence.md`
7. `07-test-strategy.md`
8. `08-roadmap.md`

## Documentation Contract

These docs are the default contract for Camp Shuttle Planner (`Route Planner 2` internally) coding. If implementation needs to deviate, update the relevant doc first so the next agent has the current source of truth.

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
