# Route Concept Planner

Durable entrypoint for the neutral, fixed-route concept-testing workspace.

## Status and boundary

Route Concept Planner is an internal beta, hidden behind its own feature and workspace-access key. It is a new workspace, not a rename or refactor of Route Planner 2.

Route Planner 2 is the working Camp route-planning tool and is frozen from this feature's perspective. Keep its navigation, data, camp/address workflows, exports, and behaviour unchanged. Route Concept Planner may reuse proven GTFS, Mapbox, and map capabilities only through neutral adapters; it must not depend on Camp UI, Camp persistence, camper data, or Camp exports.

## Read next

1. [`PRODUCT_CONTRACT.md`](PRODUCT_CONTRACT.md) — use case, workflow, calculations, and explicit deferrals.
2. [`TECHNICAL_CONTRACT.md`](TECHNICAL_CONTRACT.md) — isolation boundary, domain model, persistence, access, and verification requirements.

## Product purpose

The workspace lets a Barrie Transit planner create or import complete route alternatives, edit their directions and stops, and test operational feasibility using scheduled GTFS evidence, Mapbox road estimates, and confirmed manual runtimes. It is a planning screen, not a schedule generator, GTFS editor, or publishing workflow.
