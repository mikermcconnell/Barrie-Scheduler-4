# Route Planner 2 Documentation

Current source of truth for the Route Planner 2 clean restart.

Route Planner 2 is a new module, not a continuation of the old Route Planner implementation. The old Route Planner docs live in `docs/route-planner-legacy/` and may be used only as background.

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

These docs are the default contract for Route Planner 2 coding. If implementation needs to deviate, update the relevant doc first so the next agent has the current source of truth.

## V1 Scope Summary

Route Planner 2 v1 is a local-first operational feasibility workspace for blank route concepts.

In scope:
- project with routes
- blank route concept workflow
- stop-aware map authoring
- service assumptions
- runtime, cycle time, bus requirement, and warning outputs
- simple route metrics comparison
- on-screen planning summary

Out of scope for v1:
- Firebase persistence
- coverage analysis
- downstream schedule handoff
- GTFS editing
- production publishing
- importing old Route Planner controllers or services
