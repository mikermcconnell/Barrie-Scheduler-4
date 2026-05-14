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

Workspace visibility is controlled by `utils/workspaceAccess.ts` and `hooks/useWorkspaceAccess.ts`. Existing global feature flags still control build-wide availability; workspace access profiles (`production`, `planner`, `admin`, `internal`) control what each team member sees.

This is a domain-heavy monolith:
- UI lives in `components/`
- domain logic lives in `utils/`
- persistence and backend helpers are split across Firebase services, `api/`, and `functions/src/`

## 3) Workspace and domain boundaries

### On-Demand
Owns shift generation, optimization, validation, and saved-schedule workflows for demand-responsive planning.

TOD slot math is centralized in `utils/demandConstants.ts` through the active slot-grid helpers (`SLOT_MINUTES`, `TIME_SLOTS_PER_DAY`, `hoursToSlots`, `minutesToSlotsCeil`, `slotDurationToHours`, `slotToMinutes`, `formatSlotToTime`). The active app grid is 5 minutes. Legacy saved TOD schedules without `slotGranularityMinutes` are treated as 15-minute data and converted on load by `utils/onDemandGridMigration.ts`; new saves include `slotGranularityMinutes: 5`.

TOD shift rules use a max of 5 consecutive driving hours before lunch is required for non-straight shifts; the old fixed 45-minute / 4th-to-6th-hour break rule should not be reintroduced. New manual drivers can be placeholders until a shift time is set, and changeoff penalties are skipped for configured on-site handoff locations.

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
- Legacy Route Planner workspace has been removed; `docs/route-planner-legacy/` is historical background only, and remaining `utils/route-planner/` code is legacy support used by Shuttle Planner.
- Route Planner 2, a fresh restart shell in `components/Analytics/RoutePlanner2Workspace.tsx` with current source-of-truth docs in `docs/route-planner-2/`; v1 is a team-saveable blank-concept operational feasibility workspace and intentionally excludes coverage analysis and downstream schedule handoff
- Shuttle Planner
- Network Connections
- student-pass planning
- Residential Growth, a Planning Data workspace that imports monthly Issuance Listing and Certificate of Occupancy Excel files, geocodes Barrie addresses with Mapbox, and maps issued/planned versus occupied/completed residential units as separate tabs.

Fleet Plan is a team-shared analytics surface backed by `teams/{teamId}/fleetPlan/default` plus version metadata under `versions/{versionNumber}` and immutable JSON payloads in Storage. Reads are team-member scoped; writes are owner/admin scoped and use loaded-version conflict detection. Saves are validation-gated for duplicate/missing unit numbers, invalid years, and broken lifecycle timelines. Blocking issues can be fixed in a planner-approved resolver modal; Gemma 4 suggestions come from `api/fleet-plan-ai-resolver.ts` and are constrained to allowed deterministic fix IDs. Missing retirement years are warnings only for buses already in service, not future purchasing rows; the resolver defaults those warnings to a retirement year 13 years after first in service.

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
- `utils/route-planner-2/`
- `utils/route-planner/` (legacy support only; do not use for Route Planner 2)
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
- New Schedule Step 2 is an internal workflow, not a hard human decision gate. Step 3 and Step 4 should still trust the approved runtime contract, but the UX may auto-approve on continue instead of forcing a separate approval decision.
- In New Schedule Step 2, loop-route planning chains must stay keyed as `Loop` in `canonicalDirectionStops`; do not coerce loop master/fallback stops into `North` or `South`, or full-pattern runtime matching for routes such as 10/11 can return no data.
- STREETS runtime imports keep normal and detour observed patterns separate. Step 2 should prefer normal-pattern evidence, fall back to detour-pattern runtimes only when normal evidence is unavailable, and warn planners before approval; do not let detour-only trips replace the normal/master stop-order chain.
- New Schedule performance mode should prefer route-scoped performance files for Step 2 loading. The All routes option remains available for comparison, but default/loading behavior should avoid fetching the full performance JSON when route-scoped files exist.
- New Schedule Step 4 exposes Compare to Master as a local planner review panel, not a header toggle. It loads the published master on demand, shows warning-only summary counts, and can show/hide editor deltas without blocking publish.
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
- Dwell cascade logic exists in both `utils/schedule/dwellCascadeComputer.ts` and `functions/src/dwellCascadeComputer.ts`; keep them behaviorally synced and run the cascade/function sync tests when changing it.
- Public timetable content is now team-managed config, not only static copy in the component.
- Route Planner 2 can import one or more full GTFS route patterns as local editable planning-copy scenarios through `utils/route-planner-2/routePlanner2GtfsImport.ts`; imports filter out partial patterns, keep scheduled segment runtimes as high-confidence evidence when available, and do not create fixed-route schedule drafts or edit GTFS feeds.
- Route Planner 2 supports local stop-range reassignment between route concepts through `reassignRoutePlanner2StopRange`; copied/moved stops get new local IDs, insertion position is planner-controlled, and stale runtime evidence/line anchors are cleaned when stop order changes.
- Route Planner 2 runtime estimates use priority-protected segment evidence: planner manual overrides outrank observed evidence, blended observed+scheduled evidence, scheduled proxies, Mapbox estimates, and distance fallback. Evidence derivation lives in `utils/route-planner-2/routePlanner2RuntimeEvidence.ts` and depends on local scenario stops plus performance/schedule indexes, not legacy Route Planner modules. For Route Planner 2 GTFS segment runtimes, use the stop-to-stop `buildCorridorSpeedIndex` index; the map/corridor chunk index is for corridor visualization and will not reliably match adjacent stop pairs. Same-minute adjacent GTFS stop times are valid scheduled evidence and are clamped to a 1-minute minimum rather than being treated as missing. When period-specific evidence is missing, preserve existing imported scheduled GTFS runtimes instead of clearing them to Mapbox/fallback.
- Route Planner 2 custom concepts can use scheduled GTFS corridor runtime evidence when the custom stops match GTFS stops but are not adjacent in GTFS. The resolver finds route-specific GTFS paths between the matched stops, aggregates scheduled runtime over the full path, and supports runtime-panel filtering between all matching routes and selected routes. Corridor estimates are labeled as scheduled GTFS corridor estimates with matched route names.
- Route Planner 2 routes now carry a planner-controlled runtime source mode: `gtfs` allows scheduled GTFS runtime evidence to outrank Mapbox, while `mapbox` ignores GTFS runtime evidence and uses Mapbox/drawn-route estimates, then fallback assumptions. Manual overrides still outrank automatic sources.
- New Route Planner 2 scenarios default to `runtimeSourceMode: 'mapbox'`; planners can opt into GTFS route runtime from the Advanced source panel.
- Route Planner 2 map overlays are zone-owned. Keep the full stop order in the review rail; the map should show only a compact stop summary with a `Review stops` action so bulk address imports do not cover controls or metrics.
- Route Planner 2 uses a full-screen map shell: project identity lives in a small floating chip; primary actions, route concepts, and the runtime source overlay toggle live in a collapsible left sidebar; and GTFS/address imports open as right-side map drawers instead of page-centred modals. The right-side review panel mirrors the left sidebar with collapsed/expanded states, includes a top save action, and owns draw-route guidance/address search/route type controls so the map stays clear. The map should not show a duplicate stop-review tray because stop order lives in the review rail.
- Route Planner 2 map authoring uses mouse-position shortcuts: `1` adds a stop at the current pointer location, and `2` adds a bend at the pointer location on the nearest route segment. Blank map clicks do not add stops. Route-line clicks select a segment and open the segment popover, which also supports manual travel-time overrides; saved overrides remain planner-controlled and outrank automatic runtime sources.
- Route Planner 2 planner edits are undoable/redoable from the sidebar and keyboard shortcuts. Background runtime estimates and save status updates should not create undo history entries.
- Route Planner 2 road snapping/runtime estimation is a staged background build: imported or bulk-added stops render immediately with fallback geometry, then Mapbox segment snapping runs through a bounded queue with progress instead of firing all segment requests at once. Keep this non-blocking behavior for address-import route creation.
- Route Planner 2 address geocoding prefers `/api/route-planner-geocode` in production and falls back to direct client Mapbox search when needed. Manual-review rows include safe diagnostics for query, geocoder source, response status, token-present boolean, result count, top result, and confidence rejection reason; never expose token values.
- Route Planner 2 saved projects use team-scoped Firestore through `utils/route-planner-2/routePlanner2ProjectPersistence.ts`: project metadata lives at `teams/{teamId}/routePlanner2Projects/{projectId}`, with editable route concepts under `scenarios/{scenarioId}`. Firestore rules allow team members and workspace permission managers to read/write these docs. The workspace should not import Firestore directly.
- Route Planner 2 out-and-back routes automatically mark the far end stop as the `turnaround` stop when the planner selects Out and back. Planners can still adjust stop roles, but the route type control should not require a separate "mark turnaround" action.
- Route Planner 2 one-way shuttle patterns can create a separate editable reverse route concept with **Create back direction**. The source concept is labeled `Out`; the generated concept is labeled `Back`, reverses stop order and bends, clears runtime estimates/overrides, and remains a one-way route.

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

For Route Planner 2 work, load `docs/route-planner-2/README.md` and its numbered docs. Treat `docs/route-planner-legacy/` as historical background only.
Use feature briefs/specs only when relevant.
Use plan/archive content only as historical context unless a durable doc confirms the behavior.

If this file drifts from reality, update it from current code and Tier 1 docs rather than from old plans.
