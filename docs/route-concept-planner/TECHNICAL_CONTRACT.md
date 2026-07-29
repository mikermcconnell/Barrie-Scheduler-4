# Route Concept Planner Technical Contract

## Isolation

Route Concept Planner owns a neutral workspace, controller/domain layer, types, persistence service, and tests. New code must not import Route Planner 2 workspace/controller, persistence, camper/address-manifest helpers, stop-time summaries, Camp exports, or stop-range transfer workflow.

Approved reuse must sit behind a narrow neutral adapter:

- GTFS loading, caching, full-pattern parsing, and scheduled runtime matching
- Mapbox road snapping, directions, and individual place search
- map rendering/authoring capabilities with all Camp presentation disabled

The import adapter owns the user-facing route-option reduction. Group by route family and service day, then by direction/loop role. Collapse candidates only when their route member, stop sequence, and alignment match. Prefer a recognized day label, then trip count, stop count, service span, and a stable ID tie-break. Preserve materially different stop sequences or alignments as optional variants; never silently merge them.

The new domain layer owns complete-route aggregation, authoring state, evidence invalidation, feasibility, daily estimates, warnings, and review readiness. It does not call fixed-route schedule generation or block assignment.

## Domain contract

- `RouteConceptProject`: project identity, ordered alternatives, selected/preferred IDs, schema version, persistence revision, and audit timestamps.
- `RouteConceptAlternative`: complete-route type, ordered patterns, service assumptions, provenance, status, and notes.
- `RouteConceptPattern`: direction/loop role, ordered neutral stops, alignment, automatic evidence, and manual overrides.
- `ConceptStop`: identity, name, coordinate, sequence, operational role, source, and optional GTFS stop code; no camper, rider-manifest, or source-row fields.
- `RouteConceptFeasibility`: runtime, cycle, minimum/tested buses, recovery, daily estimates, confidence, and actionable issues.

Derived feasibility is recomputed from saved inputs. Cached automatic evidence records its source context and a path fingerprint so stale evidence cannot silently remain valid.

New out-and-back alternatives use explicit `outbound` and `inbound` patterns with turnaround endpoint roles; the feasibility layer sums both patterns once. Legacy schema-v1 single `out-and-back` patterns remain readable. A reversed return created from a one-direction GTFS import receives new neutral IDs and no copied runtime evidence.

## Navigation and access

- Hash route: `route-concept-planner`
- Feature/workspace key: `analyticsRouteConceptPlanner`
- Dashboard label: **Route Concept Planner**
- Default: disabled, internal users only; explicit member override may grant pilot access

Do not change the existing `route-planner-2` route or `analyticsRoutePlanner2` access.

## Persistence and conflicts

Use a separate team-scoped hierarchy:

```text
teams/{teamId}/routeConceptPlannerProjects/{projectId}
  alternatives/{alternativeId}
    patterns/{patternId}
```

The root stores `schemaVersion`, integer `revision`, ordering, selected/preferred IDs, timestamps, and updater identity. Save the root, alternatives, patterns, and deletions atomically with `saveProject(project, expectedRevision)`. First save creates revision 1; each successful save increments it. A stale revision must never overwrite newer work.

On conflict, offer only **Reload team version** or **Save local work as a new copy**. Do not force-overwrite or automatically merge. Network, permission, validation, and conflict failures preserve local work and keep it marked unsaved. Validate and normalize loaded documents before replacing the open project.

Firestore rules must require authentication, team access, `analyticsRouteConceptPlanner` access, consistent document identity/ownership, valid schema/revision fields, and updater identity. No Cloud Storage is required.

## Required verification

- Existing Route Planner 2/Camp tests stay green, including open/edit/save/export coverage.
- Isolation tests reject Camp dependencies and camper/address fields in serialized neutral projects.
- Unit tests cover complete alternatives, GTFS after-midnight times, evidence priority/invalidation, feasibility, daily estimates, and warnings.
- Persistence/emulator tests cover round trips, atomic deletion, unauthorized access, and simultaneous-save conflicts.
- Browser coverage follows import → duplicate → edit → review → compare → prefer → save → reload → stale-save conflict.
- Type checking, production build, accessibility/keyboard review, and a real Barrie GTFS/Mapbox pilot pass are release gates.

The production rollback is disabling the new feature flag. Its separate saved data remains intact and Route Planner 2/Camp is unaffected.
