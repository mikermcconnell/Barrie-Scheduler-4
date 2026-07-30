# ORCHESTRATOR.md

Compact recovery memory for orchestrating non-trivial work in Scheduler 4.

## Purpose and authority

Use this file to recover the repo shape, cross-cutting conventions, fragile areas, and the next authoritative document to load. Do not use it as a feature specification, release log, test-status page, or replacement for Tier 1 docs.

Authority and context routing live in:

- `AGENTS.md` — repository contract
- `docs/CONTEXT_INDEX.md` — task routing and precedence
- `docs/rules/LOCKED_LOGIC.md` — non-negotiable schedule behavior
- `docs/PRODUCT_VISION.md` — product intent and boundaries
- `docs/ARCHITECTURE.md` — current code ownership and data flow
- `docs/SCHEMA.md` — persistence and type contracts

Update this file only when a durable cross-cutting convention, workspace boundary, fragile area, or recovery pointer changes. Verify its statements against current code and authoritative docs before relying on them.

## Current app shape

Scheduler 4 is a Barrie Transit planning platform with a fixed-route scheduling core and adjacent planning, analytics, operations, on-demand, and parking tools.

Top-level shells in `App.tsx` are On-Demand, Fixed Route, Operations, Parking, and Planning Data. `index.tsx` is the mount point. Navigation is hash-based rather than router-library based.

Planning Data deep-link handling is centralized in `utils/workspaces/analyticsWorkspaceRouting.ts`. The home-screen resume card uses `utils/workspaces/fixedRouteResumeState.ts`; despite the legacy name, Camp Shuttle Planner (`Route Planner 2` internally) also updates it.

This is a domain-heavy monolith:

- UI: `components/`
- domain logic: `utils/`
- request handlers: `api/`
- Firebase backend: `functions/src/`

Use `docs/ARCHITECTURE.md` for the current component and workspace map.

## Access and team boundaries

Workspace visibility flows through `utils/workspaceAccess.ts`, `hooks/useWorkspaceAccess.ts`, and `components/contexts/TeamContext.tsx`. Named onboarding packages live in `utils/workspaceAccessPackages.ts`; prefer packages over hand-built profile/override combinations.

Cross-team authority requires the Firebase Auth claim `schedulerAdmin: true`; never infer it from a team role or an `internal` workspace profile. Cross-team inspection/editing uses an expiring, audited, team-scoped support session. Inspection is read-only; edit requires an explicit reason. Do not reintroduce permanent impersonation or rewrite `users/{uid}.teamId` to simulate support access.

Partner agencies should be separate teams. Explicit `dataSourceTeamIds` pointers and the `sharedWorkspaceData` Cloud Function provide scoped read-only sharing for Transit App, performance, and published master-schedule data. Do not add partner users directly to Barrie merely to share analytics.

Scheduler administrators have a deliberate read-only exception for user-uploaded files through **All uploads**. Another user's user-scoped upload cannot be changed or deleted.

See `docs/ARCHITECTURE.md` for access flow and `docs/SCHEMA.md` for claims, support sessions, source pointers, and security boundaries.

## Workspace boundaries

### On-Demand

On-Demand owns demand-responsive requirements, shifts, optimization, validation, and saved schedules.

- Slot math is centralized in `utils/demandConstants.ts`. New saves use a 5-minute grid; legacy records without `slotGranularityMinutes` may represent 15-minute data and migrate through `utils/onDemandGridMigration.ts`.
- Non-straight shifts require lunch after at most five consecutive driving hours. Do not restore the old fixed 45-minute / fourth-to-sixth-hour break rule.
- Master requirements and RideCo/MVT imports are independently supported and planner-reviewed before replacing active shifts.

### Fixed Route

Fixed Route owns runtime import, the New Schedule wizard, schedule editing, GTFS import, draft management, publish-to-master, reports/timetables, and connection optimization.

Load `docs/rules/LOCKED_LOGIC.md` for behavioral constraints and the matching fixed-route feature docs from `docs/CONTEXT_INDEX.md` before changing these workflows.

### Operations

Operations owns STREETS-backed imports, dashboards, summaries, and reporting.

- Performance history uses monthly Storage chunks with Firestore metadata and route/month pointers; the old monolithic path is fallback only.
- Passenger load is reviewed in Ridership -> Passenger Flow by Stop. The former standalone Load Profiles UI and assignable access surface are removed; its compact monthly read model remains only for backward-compatible backend and repair use. Keep `utils/performanceLoadProfileView.ts` and `functions/src/performanceLoadProfileView.ts` contract-identical.
- Same-team and partner detail reads use bounded, access-checked backend views; do not restore broad direct browser reads or convert load/schema failures into empty data.
- Canonical metric and schema-version behavior lives in `docs/OPERATIONS_DASHBOARD_METRICS.md`. Older stored summaries may require rebuild or re-import after schema changes.
- Performance schema v14 gives heatmap trips stable identity and stores vehicle/applied capacity so same-time trips do not collide and inferred loads can enforce fleet-specific capacity.

### Parking

Parking owns parking-code usage, revenue review, map/location settings, and plate-pattern analysis. Parking data contains licence plates; preserve its restricted workspace boundary and use `docs/SCHEMA.md` for the current storage and access contract.

### Planning Data

Planning Data includes Transit App analytics, OD analysis, Camp Shuttle Planner, Route Concept Planner, Shuttle Planner, Network Connections, student-pass planning, Residential Growth, Council Intelligence, Fleet Plan, and related tools.

Important boundaries:

- Camp Shuttle Planner is the current Camp and address-based shuttle tool; its stable internal code name remains `Route Planner 2`. `docs/route-planner-2/README.md` routes to its product, workflow, architecture, data, runtime, and test contracts.
- Route Concept Planner is a separate neutral internal-beta workspace. Keep it isolated from Camp Shuttle Planner and load `docs/route-concept-planner/README.md` plus its contracts.
- The removed legacy Route Planner is historical. Remaining `utils/route-planner/` code is legacy support used by Shuttle Planner, not Route Planner 2.
- Council Intelligence must distinguish official named votes from movers, seconders, procedural signals, and unknown evidence.
- Fleet Plan is team-shared and versioned. Ordinary writes are owner/admin-only; an audited support session in edit mode is the explicit cross-team exception. The UI gates saves on workbook validation, while the persistence service enforces version conflicts, so preserve both layers.
- Transit App schema and data-quality cautions live in `docs/TRANSIT_APP_DATA_REVIEW_CHECKLIST.md`; re-import saved data when that checklist or schema contract says regeneration is required.

## Persistence and server model

The application is Firebase-centered:

- Firestore stores metadata, indexes, and bounded document state.
- Firebase Storage stores large JSON/blob payloads and immutable/versioned artifacts.
- Firebase Auth is the primary identity layer.

Runtime surfaces are intentionally mixed between Vite development middleware, canonical handlers in `api/`, and Firebase Functions in `functions/src/`. Prefer one shared implementation per server concern; local/dev adapters should delegate to canonical handlers when practical.

Production auth blocks Codex-style local development accounts on non-local hosts. Keep dev auto-login and `VITE_DEV_AUTH_*` behavior restricted to localhost.

Use `docs/SCHEMA.md` for exact collections, Storage paths, access rules, and type locations.

## Cross-cutting schedule conventions

Read `docs/rules/LOCKED_LOGIC.md` before changing schedule generation, parsing, timing, routing, block assignment, or Schedule Editor behavior.

High-value reminders:

- Fixed-route work follows Draft → Publish; master schedules are not editable working copies.
- AI suggests; planners decide.
- New Schedule Step 2 produces an approved runtime contract consumed by later steps. Load the three Step 2 documents named in `docs/CONTEXT_INDEX.md` for normal/detour evidence, loop keys, stop-order resolution, and route-scoped loading rules.
- Schedule Editor uses compare → change → review → publish. Source-version checks, ready-for-review state, publish-note validation, and operational blockers must be enforced in services, not only disabled UI controls.
- Schedule Editor mutations and block cascades are scoped by base route and service day. Preserve the 4:00 AM operational boundary, serialized saves, and navigation waits for the latest save.
- V2 occupied-end calculations must consistently respect whether terminal departure already includes recovery; keep parsers, block assignment, comparisons, timeline order, connection matching, and add/extend checks aligned.

## Fragile areas

Core schedule danger zones:

- `utils/schedule/scheduleGenerator.ts`
- `utils/blocks/blockAssignmentCore.ts`
- `utils/timeUtils.ts`
- `utils/parsers/masterScheduleParser.ts`
- `utils/parsers/masterScheduleParserV2.ts`
- `utils/gtfs/gtfsImportService.ts`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`

Large orchestration surfaces that deserve narrow edits and focused verification:

- `components/workspaces/OnDemandWorkspace.tsx`
- `components/workspaces/FixedRouteWorkspace.tsx`
- `components/MasterScheduleBrowser.tsx`
- `components/Analytics/TransitAppMap.tsx`
- `utils/transit-app/transitAppAggregator.ts`

Mirrored implementations that must stay behaviorally synchronized:

- STREETS client import and server auto-ingest
- `utils/performanceLoadProfileView.ts` and `functions/src/performanceLoadProfileView.ts`
- `utils/schedule/dwellCascadeComputer.ts` and `functions/src/dwellCascadeComputer.ts`
- root bundled GTFS assets/indexes and the copies used by Functions for missed-trip enrichment

Use the relevant `.agents/skills/` danger-zone skill and focused tests before calling changes complete.

## Durable feature cautions and pointers

- New Schedule runtime approvals use schema version 2. Visible `reviewBuckets` are evidence; only independently revalidated `approvedBuckets` may generate schedules.
- Performance runtime buckets require five complete paired-cycle days; CSV buckets require ten explicit observations on every segment. Detours, estimates, outliers, partial trips, and stop-only evidence remain review-only.
- Strict generation uses the exact approved half-hour bucket. The North cycle-start bucket supplies both paired legs; South-start pairs and missing buckets fail closed without closest-bucket, band, raw-segment, or default-runtime fallback.
- Missing or stale approval blocks later wizard steps, generation, export, and Master upload. Pre-v2 projects are durably reset while preserving planner settings; schema-v2 saves are serialized and revision-checked.
- Dwell Incident Review is incident-first, read-only, and map-first. Current UX and metric rules live in `docs/DWELL_CASCADE_FEATURE.md` and `docs/OPERATIONS_DASHBOARD_METRICS.md`.
- Passenger Flow inferred loads must remain visibly distinct from verified APC values. The canonical fallback and rejection rules live in `docs/OPERATIONS_DASHBOARD_METRICS.md`.
- Public timetable content is team-managed configuration. Its persistence contract lives in `docs/SCHEMA.md`.
- Detour Publisher uses GTFS read-only and Mapbox routing as advisory input; planners confirm stop impacts and bus suitability. Load `docs/DETOUR_PUBLISHER.md` for the workflow and export contract.
- Route Concept Planner runtime priority, feasibility boundaries, and persistence live in its product/technical contracts and `docs/SCHEMA.md`.
- Route Planner 2 accepted Mapbox runtime is planner-controlled state: background work must not silently overwrite it. Explicit refresh, lock, accept/keep behavior, bounded `runtimeSnapshots` history, persistence permissions, and tests are canonical in `docs/route-planner-2/04-architecture.md` through `07-test-strategy.md` and `docs/SCHEMA.md`.

## Guidance for future orchestrators

- Scope one owner per distinct task when practical and avoid overlapping write ownership.
- Give delegated work explicit goals, owned/forbidden files, conventions, and verification.
- Preserve unrelated edits and verify the actual working tree before planning changes.
- Do not treat `.tmp/`, `.worktrees/`, `temp/`, plans, archives, artifacts, or legacy docs as current authority.
- When a task touches locked logic, high-risk schedule code, security boundaries, or a fragile workspace, require focused verification before completion.
- Update authoritative docs from current code, tests, persisted contracts, and approved product decisions. Keep this file as a compact pointer map.
