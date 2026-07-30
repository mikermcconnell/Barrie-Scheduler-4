# Context Index

Canonical context router for Scheduler 4. `AGENTS.md` is the repository contract; use this file second to select only the context required for the task.

## Minimal bootstrap

Always start with:

1. `AGENTS.md`
2. `docs/CONTEXT_INDEX.md`

Do not load every durable document by default. Continue with the task routes below.

## Authority and precedence

Different sources are authoritative for different questions:

1. Higher-priority system, developer, and user instructions govern the current task.
2. `AGENTS.md` governs repository-wide agent workflow and safety.
3. `docs/rules/LOCKED_LOGIC.md` governs non-negotiable schedule behavior.
4. `docs/PRODUCT_VISION.md` governs durable product intent, boundaries, and decision principles.
5. Feature product contracts govern their named feature without overriding locked logic or product boundaries.
6. `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` describe current implementation structure and persisted/type contracts.
7. Feature architecture, data-model, and test docs provide narrower implementation guidance.
8. `ORCHESTRATOR.md` is recovery memory and a pointer map; it never overrides the sources above.
9. Plans, handoffs, checklists, and archives are supporting evidence, not default authority.

For implementation facts, verify current code and tests. For persisted-state questions, inspect the actual stored source of truth when access is available. A mismatch between implementation and durable intent is documentation or code drift to investigate, not permission to bypass locked behavior.

## Task routing

| Task | Load next |
|------|-----------|
| Schedule generation, parsing, timing, block assignment, routing, or Schedule Editor behavior | `docs/rules/LOCKED_LOGIC.md`, then the relevant architecture/feature docs and danger-zone skill |
| Product design, feature scope, or prioritization | `docs/PRODUCT_VISION.md`, then the matching product brief or feature contract |
| Code ownership, entry points, module boundaries, or major data flow | `docs/ARCHITECTURE.md` |
| Firestore, Storage, authentication, security rules, or TypeScript type locations | `docs/SCHEMA.md`; also load `docs/ARCHITECTURE.md` when flow ownership matters |
| Current delivery status | Verify current code, tests, and the active issue/task source; use `docs/IMPLEMENTATION_PLAN.md` only for its explicitly dated historical snapshot |
| Orchestration, delegation, multi-workspace changes, or compacted-context recovery | `ORCHESTRATOR.md` after loading the authoritative docs relevant to the task |
| Claude-specific workflow or extra danger-zone verification guidance | `.claude/CLAUDE.md` |
| Historical detail about locked schedule implementation | `.claude/context.md` |
| Documentation audit | `.agents/skills/doc-review/SKILL.md` and this index |

## Feature routing

Load feature docs only when the task directly touches that feature.

### Fixed-route scheduling and operations

- New Schedule Step 2: start with `docs/new-schedule-step2/README.md`, then load only the routed contract for the task
- Connections: `docs/CONNECTIONS_FEATURE.md`
- Schedule Editor verification history: `docs/SCHEDULE_EDITOR_TEST_SUMMARY.md` only when point-in-time test history is relevant
- GTFS/STREETS auto-ingest: `docs/AUTO_INGEST_SETUP.md`
- Dwell Incident Review: `docs/DWELL_CASCADE_FEATURE.md`
- Operations metrics and schemas: `docs/OPERATIONS_DASHBOARD_METRICS.md`
- Detour Publisher: `docs/DETOUR_PUBLISHER.md`
- Route colors: `docs/route-colors.md`

### Planning-data workspaces

- Route Planner 2: start with `docs/route-planner-2/README.md`, then load only the numbered docs selected by its task router
- Route Concept Planner: `docs/route-concept-planner/README.md`, then its product and technical contracts
- Shuttle Planner: use `docs/SHUTTLE_PLANNER_PRD.md` for product/domain work; add `docs/SHUTTLE_PLANNER_UI_SPEC.md` only for UI, interaction, or layout work
- Network Connections: use `docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md` for product/domain work; add `docs/NETWORK_CONNECTIONS_UI_SPEC.md` only for UI, interaction, or layout work
- OD workspace: `docs/OD_WORKSPACE_GUIDE.md`
- Residential Growth: `docs/RESIDENTIAL_GROWTH_AUTOMATION.md`
- Transit App data validation: `docs/TRANSIT_APP_DATA_REVIEW_CHECKLIST.md`

### Important route-planning boundaries

- Route Planner 2 is the current Camp route-planning tool.
- Route Concept Planner is a separate neutral internal-beta workspace. Do not change Route Planner 2 as part of Route Concept Planner work.
- `docs/route-planner-legacy/` is historical background only. Remaining `utils/route-planner/` code supports legacy-dependent features and is not the Route Planner 2 implementation.

## Document tiers

Tiers describe authority and expected stability, not a mandatory load sequence.

### Tier 1: durable sources

- `AGENTS.md` — repository contract
- `docs/CONTEXT_INDEX.md` — context router and precedence
- `docs/rules/LOCKED_LOGIC.md` — locked schedule behavior
- `docs/PRODUCT_VISION.md` — product intent and boundaries
- `docs/ARCHITECTURE.md` — current component and data-flow map
- `docs/SCHEMA.md` — current persistence and type-location reference

Keep these current and free of dated implementation chatter.

### Tier 2: operational and feature reference

- `ORCHESTRATOR.md`
- `.claude/CLAUDE.md`
- `.claude/context.md`
- the current product, workflow, architecture, data, and operations references listed under Feature routing, excluding documents explicitly assigned Tier 3 below

These are useful within their scope, but some are more likely to drift and should be checked against current code and tests.

### Tier 3: history, status snapshots, and supporting artifacts

- `docs/plans/`
- `docs/superpowers/plans/`
- `docs/archive/`
- `docs/artifacts/`
- `docs/route-planner-legacy/`
- `docs/IMPLEMENTATION_PLAN.md` — March 2026 delivery snapshot, not a current roadmap
- `docs/DWELL_CASCADE_PLAN.md` — historical plan; use `docs/DWELL_CASCADE_FEATURE.md` for current behavior
- `docs/SCHEDULE_EDITOR_TEST_SUMMARY.md` — point-in-time verification summary, not the current test source of truth

These may contain useful rationale, manual test notes, install commands, superseded implementation details, or exported artifacts. Do not use them as the sole basis for current behavior.

## Update and verification rules

- If behavior or constraints change, update the appropriate Tier 1 or feature contract in the same change.
- If storage, collections, security boundaries, or type locations change, update `docs/SCHEMA.md`.
- If component ownership, entry points, or major data flow changes, update `docs/ARCHITECTURE.md`.
- If product boundaries or decision principles change, update `docs/PRODUCT_VISION.md`.
- If locked schedule behavior changes with explicit approval, update `docs/rules/LOCKED_LOGIC.md` and its focused tests.
- If a feature ships or becomes durable, move the lasting outcome into a Tier 1 or Tier 2 source instead of leaving it only in a plan or handoff.
- Keep `ORCHESTRATOR.md` compact: record cross-cutting conventions and fragile-area pointers, not full feature specifications or transient CI state.
- Run `npm run docs:check` after changing context documentation. Also run any feature-specific verification required by the touched area.

## Compatibility note

`.claude/CLAUDE.md` and `.claude/context.md` remain available as tool-specific and historical supplements. They do not replace `AGENTS.md`, this index, or the durable locked-logic summary.
