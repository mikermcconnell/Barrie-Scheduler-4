# ORCHESTRATOR.md

Living memory for future orchestrator work in Scheduler 4.

## 1) Purpose and update rules

Use this file as compact durable memory for:
- current repo shape
- workspace boundaries
- risky areas
- operating assumptions that future orchestrator work should know quickly

Update this file when:
- architecture changes in a durable way
- workspace ownership changes
- a high-risk area is discovered or retired
- a cross-cutting convention becomes important for future work

Keep it:
- concise
- practical
- current
- easy to skim after context recovery

Do not use this file for dated handoffs, release notes, or plan chatter.

## 2) Current app shape

Scheduler 4 is a Barrie Transit planning platform with a fixed-route scheduling core plus adjacent planning and operations tools.

Top-level app shells in `App.tsx`:
- On-Demand
- Fixed Route
- Operations

The app uses hash-based navigation rather than a router library. The top-level shell lives in `App.tsx`, with `index.tsx` as the mount point.

This is a domain-heavy monolith:
- UI lives in `components/`
- domain logic lives in `utils/`
- persistence and backend helpers are split across Firebase services, `api/`, and `functions/src/`

## 3) Workspace and domain boundaries

### On-Demand
Owns shift generation, optimization, validation, and saved-schedule workflows for demand-responsive planning.

### Fixed Route
Owns the core fixed-route workflow:
- CSV/runtime import
- New Schedule wizard
- schedule editing
- GTFS import
- draft management
- publish to master schedules
- timetable/report outputs
- route-level connection setup and optimization

### Operations
Owns STREETS-style performance dashboards, imports, summaries, and reporting.

### Planning-data / analytics surfaces
The repo also contains planning-data tools, mostly under `components/Analytics/` and related `utils/` folders, including:
- Transit App analytics
- OD analysis
- Route Planner
- Shuttle Planner
- Network Connections
- Route 8 sandbox
- student-pass planning

### Domain folders worth knowing first
- `utils/schedule/`
- `utils/blocks/`
- `utils/parsers/`
- `utils/gtfs/`
- `utils/connections/`
- `utils/platform/`
- `utils/newSchedule/`
- `utils/transit-app/`
- `utils/od-matrix/`
- `utils/route-planner/`
- `utils/route8-sandbox/`
- `utils/shuttle/`

## 4) Persistence and runtime model

The repo is Firebase-centered:
- Firestore stores metadata and indexes
- Firebase Storage stores large JSON/blob payloads
- Firebase Auth is the primary auth layer

Common pattern:
- Firestore = lightweight document state
- Storage = full content, large payloads, or versioned artifacts

Runtime surfaces are intentionally mixed:
- Vite dev middleware in `vite.config.ts`
- canonical request handlers in `api/`
- Firebase Cloud Functions in `functions/src/`

Prefer one shared implementation per server concern when practical. If a canonical `api/` handler already exists, prefer delegating local/dev behavior to it rather than duplicating request logic elsewhere.

## 5) Locked logic and cross-cutting conventions

Read `docs/rules/LOCKED_LOGIC.md` before changing schedule generation, parsing, timing, routing, or block assignment behavior.

High-value reminders:
- Fixed-route work follows **draft → publish**. Do not treat master schedules as editable working copies.
- Segment rounding, gap-based block assignment, trip pairing, cycle-time semantics, and post-midnight ordering are locked behavior.
- AI suggests; planners decide.
- New Schedule Step 2 approval is a real gate. Step 3 and Step 4 should trust the approved runtime contract, not re-derive their own Step 2 truth.
- Route 8 sandbox work is intentionally isolated from live 8A/8B master/editor paths.
- Brand-new added trips should not inherit delta-source fallback from template trips; compare-to-master deltas should only render when a real original/reference match exists.

When a task touches these areas, load the matching Tier 1 or Tier 2 docs first instead of relying on memory.

## 6) Known fragile / high-risk areas

Treat these as danger zones:
- `utils/schedule/scheduleGenerator.ts`
- `utils/blocks/blockAssignmentCore.ts`
- `utils/timeUtils.ts`
- `utils/parsers/masterScheduleParser.ts`
- `utils/parsers/masterScheduleParserV2.ts`
- `utils/gtfs/gtfsImportService.ts`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`

Also be careful in very large orchestration files and workspaces such as:
- `components/workspaces/OnDemandWorkspace.tsx`
- `components/workspaces/FixedRouteWorkspace.tsx`
- `components/MasterScheduleBrowser.tsx`
- `components/Analytics/TransitAppMap.tsx`
- `utils/transit-app/transitAppAggregator.ts`

## 7) Current durable cautions

These are worth remembering, but should still be verified before relying on them:
- The working tree may already contain unrelated edits; do not assume a clean baseline.
- Build output has shown large bundle/chunk warnings.
- The test suite has known student-pass timeout failures; do not treat a partial red test run as proof that unrelated work is broken.
- Performance/import flows and New Schedule Step 2 are active areas of recent hardening; verify behavior directly when changing them.
- Public timetable content is now team-managed config, not only static copy in the component.

## 8) Guidance for future subagents

Default orchestrator behavior:
- do not implement directly unless explicitly instructed
- delegate scoped implementation tasks when delegation is available and appropriate
- give each subagent a clear goal, owned files, forbidden files, conventions to follow, and verification steps

When scoping work:
- prefer one subagent per distinct task
- keep write ownership narrow
- avoid overlapping file ownership unless necessary

By default, do not treat these as source of truth:
- `.tmp/`
- `.worktrees/`
- `temp/`
- `docs/plans/`
- `docs/archive/`

If a task touches locked logic, high-risk schedule code, or a fragile workspace, require explicit verification before calling it done.

## 9) Source-of-truth docs

Primary durable sources:
- `AGENTS.md`
- `docs/CONTEXT_INDEX.md`
- `docs/rules/LOCKED_LOGIC.md`
- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`

Use feature briefs/specs only when relevant.
Use plan/archive content only as historical context unless a durable doc confirms the behavior.

If this file drifts from reality, update it from current code and Tier 1 docs rather than from old plans.
