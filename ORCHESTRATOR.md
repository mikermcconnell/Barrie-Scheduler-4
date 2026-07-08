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
- Parking
- Planning Data

The app uses hash-based navigation rather than a router library. The top-level shell lives in `App.tsx`, with `index.tsx` as the mount point. Planning Data nested workspaces use `utils/workspaces/analyticsWorkspaceRouting.ts` for deep links such as `#planning/route-planner-2` and, when opened inside Scheduled Transit, `#fixed/analytics/route-planner-2`. The home-screen "Where you left off" card uses `utils/workspaces/fixedRouteResumeState.ts`; despite the legacy file name, Route Planner 2 also updates this state so the card can resume the latest route-planning project.

Workspace visibility is controlled by `utils/workspaceAccess.ts`, `hooks/useWorkspaceAccess.ts`, and `components/contexts/TeamContext.tsx`. Existing global feature flags still control build-wide availability; workspace access profiles (`none`, `production`, `planner`, `external-planner`, `transit-app-only`, `parking`, `admin`, `internal`) control what each team member sees, with optional `workspaceOverrides` for exact allow/block changes. Named onboarding packages live in `utils/workspaceAccessPackages.ts`; use these from Team Management instead of hand-picking profile/checkbox combinations when setting up users or partner teams. `Transit App + STREETS Dashboard` is the WATT-style package: base `transit-app-only` plus `workspaceOperations: true`. Global admins can start read-only Developer Preview Mode from Team Management; it swaps the in-memory `useTeam()` team/member to a synthetic preview user for the selected team/profile or selected user's saved access without changing `users/{uid}.teamId`. The header shows an amber preview banner with an exit action and read-only status. `parking` users see only the Parking workspace by default. Signed-in users with no team member record or `none` access are held in a blocking Team Management setup flow; new self-created teams default the owner and future members to `none` until access is explicitly granted. `App.tsx` exposes Planning Data as a top-level view when the user has at least one analytics workspace, so Transit App-only external users can enter the app without Scheduled Transit access.

Cross-team team lookup and permission management require a Firebase Auth custom claim such as `schedulerAdmin: true`; do not infer global admin power from a user's own team role or workspace access level. Team owners/admins can manage their own team settings under Firestore rules. External agencies such as Ontario Northland, Lane Transit, or WATT should be separate partner teams. Use Team Management's Developer Access Wizard to set team defaults, apply a named access package, adjust per-user overrides, preview the app surface for that profile, and then use read-only Developer Preview Mode to navigate the real app as that team/default or a selected user's saved access. For Lane Transit-style access, use `Transit App Data only`. For WATT-style access, use `Transit App + STREETS Dashboard` and make sure the team has its required STREETS/Transit App data available through Team Management's Data Sources tab. Prefer the generated invite link rather than a bare code. Invite lookup docs mirror the team's default join access because new invite users cannot read the private team doc until after membership is created.

Global admins also have an intentional support-only exception for user-uploaded File Manager files: they can read `users/{userId}/files` metadata and matching Storage objects across users from File Manager's **All uploads** view. Writes/deletes remain owner-only in the normal client path. Team Management also has an **Edit as saved user** developer action that opens another team's saved user surface with global-admin write permissions; the banner says `admin edit mode`. Use this deliberately for support tasks such as updating Parking Plate Monitor thresholds for another team, and keep ordinary user cross-team access isolated.

Team Management has an admin-only Data Sources tab for partner teams. It writes `teams/{teamId}.dataSourceTeamIds.transitApp` and/or `.performance` so a team like WATT can read Barrie Transit App and STREETS dashboard/reporting data without copying Storage files. Shared reads go through the `sharedWorkspaceData` Cloud Function, which verifies the user is a member of the requesting team and that the source-team pointer is explicitly configured. Do not make WATT users direct Barrie members just to view shared analytics data.

Partner teams with Scheduled Transit access can view published master schedules from a source team without copying schedule JSON. `dataSourceTeamIds.masterSchedules` is the explicit pointer; when absent, the Master Schedule Browser falls back to `dataSourceTeamIds.performance` if the partner team has no local schedules. Firebase rules allow this as read-only access only for members of the requesting team who also have Fixed Route workspace access.

This is a domain-heavy monolith:
- UI lives in `components/`
- domain logic lives in `utils/`
- persistence and backend helpers are split across Firebase services, `api/`, and `functions/src/`

## 3) Workspace and domain boundaries

### On-Demand
Owns shift generation, optimization, validation, and saved-schedule workflows for demand-responsive planning.

TOD slot math is centralized in `utils/demandConstants.ts` through the active slot-grid helpers (`SLOT_MINUTES`, `TIME_SLOTS_PER_DAY`, `hoursToSlots`, `minutesToSlotsCeil`, `slotDurationToHours`, `slotToMinutes`, `formatSlotToTime`). The active app grid is 5 minutes. Legacy saved TOD schedules without `slotGranularityMinutes` are treated as 15-minute data and converted on load by `utils/onDemandGridMigration.ts`; new saves include `slotGranularityMinutes: 5`.

TOD shift rules use a max of 5 consecutive driving hours before lunch is required for non-straight shifts; the old fixed 45-minute / 4th-to-6th-hour break rule should not be reintroduced. New manual drivers can be placeholders until a shift time is set, and changeoff penalties are skipped for configured on-site handoff locations.

On-Demand imports accept Master requirements and RideCo/MVT shifts independently; a single uploaded or file-manager-selected file auto-processes. RideCo/MVT parsing lives in `utils/parsers/csvParsers.ts` and supports CSV/workbook sheets, Excel numeric times, shift-header-relative row fallback, overnight service, day-type counts, skipped-column diagnostics, and a review/apply step before shifts replace the active draft.

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

STREETS performance history is now stored as monthly Storage chunks instead of one giant all-route JSON file. Metadata lives at `teams/{teamId}/performanceData/metadata` with `storageMode: 'monthly'`, `monthlyStoragePaths`, and `routeMonthlyStoragePaths`; `overviewStoragePath` and `reportStoragePath` remain the fast dashboard/email entry points. The old `storagePath` monolithic file is legacy fallback only. Keep server auto-ingest (`functions/src/index.ts`) and client manual import (`utils/performanceDataService.ts`) behavior aligned when changing this pipeline.

Operations Dashboard should not eagerly load all STREETS detail history after the 7-day overview. Detail tabs request date-range and tab-specific slices through `usePerformanceDataQuery`/`getPerformanceData`; partner-team reads must pass the same `dateRange` and `detailMode` through `sharedWorkspaceData`.

The Ridership tab also includes a Transit On Demand pickup map. TOD pickup uploads are separate from STREETS performance data: metadata lives at `teams/{teamId}/todPickupData/metadata`, aggregated monthly JSON lives under `teams/{teamId}/todPickupData/`, and replacing an upload replaces only the selected month. Stored TOD pickup data is aggregated by stop ID when present, otherwise pickup name plus rounded coordinates, or coordinates alone. Raw rider/request rows and address columns should not be persisted. Imports are limited to CSV files under 5 MB and 25,000 rows. All team members can view TOD map data and import metadata; upload controls are owner/admin-only.

### Parking
Owns shared parking-code and parking-revenue review. `components/workspaces/ParkingWorkspace.tsx` opens to a card dashboard at `#parking`, similar to Fixed Route Operations, with separate Plate Monitor (`#parking/plate-monitor`) and Parking Lot Data (`#parking/lot-data`) workspaces. Parking Lot Data uses a Route Planner-style full-screen map shell for Parking Revenue analytics: it imports and auto-saves HotSpot app and QR revenue workbooks as source-aware monthly datasets, ships with bundled City ParkingLatLong mappings in `utils/parking/parkingDefaultLocations.ts` as default reviewed lot coordinates/spaces, can refresh those mappings from newer City lat/lng workbooks through `utils/parking/parkingLocationWorkbook.ts`, uses `Amount` as revenue, stores normalized revenue payloads under `teams/{teamId}/parking/revenue/`, and uses reviewed `settings.revenueLocations` to map HotSpot/QR IDs to physical locations with lat/lng. Parking Revenue settings include editable lot categories managed through `utils/parking/parkingCategories.ts`; seeded categories are Downtown, Waterfront, Hybrid, Marina, Hospital, and Allandale GO. Bundled City ParkingLatLong locations are now categorized by City parking area: regular downtown lots/on-street as Downtown, waterfront lots/on-street as Waterfront, Spirit Catcher/Simcoe Street/Marina North as Hybrid, Marina Lot as Marina, Gallie Court/Quarry Ridge as Hospital, and Cumberland St as Allandale GO. H-Block is Downtown; legacy H-Block defaults from Hospital migrate to Downtown. Revenue analytics support year/month/category/uploader/day/source/hour filters, recent import history by `importedBy`, category comparison, single-month daily trend views, and estimated utilization based on paid parking minutes divided by known spaces × imported active days × selected hour window. Map display can group multiple source IDs for the same physical lot, but must not merge distinct nearby lots or on-street parking areas just because their coordinates are close. Public City of Barrie parking GIS locations from `utils/parking/publicParkingLocations.ts` are a map-only fallback until reviewed coordinates are saved; they must not overwrite `settings.revenueLocations` unless a planner explicitly applies and saves them. Public-source matches are shown as normal City-source pins, not as user-facing unmapped warnings. Revenue imports replace only matching source/month combinations. The older department-code usage import remains in Parking Lot Data: it requires discount-code family mappings before saving, replaces matching month(s), and derives department month-over-month summaries. Plate Monitor reviews plate-level pattern flags, evidence, and indicator thresholds, and includes annual department reporting with months as rows, department-code/color columns, annual totals, and a department-total pie chart. Department code editability lives in a modal manager: each department can edit its name, color, short code, active years, year format (`2026` or `26`), manual yearly code overrides, and an `ignoreFlags` option that suppresses plate-level indicators for that department. Matching helpers live in `utils/parking/parkingCodeRules.ts`; flag analysis lives in `utils/parking/parkingAggregation.ts`; revenue parsing/analytics live in `utils/parking/parkingRevenue.ts`. Metadata/settings live at `teams/{teamId}/parking/default`. Parking contains license plates, so workspace access is limited by default to the `parking`, `admin`, and `internal` profiles; users with Parking workspace access can read, export, import, and maintain Parking settings.

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

Production auth safety: `components/contexts/AuthContext.tsx` blocks Codex-style local dev accounts (`codex.dev.*@example.com`) on non-local hosts and signs them out immediately. Keep dev auto-login restricted to localhost only; do not let `VITE_DEV_AUTH_*` values affect `transitscheduler.ca`.

## 5) Locked logic and cross-cutting conventions

Read `docs/rules/LOCKED_LOGIC.md` before changing schedule generation, parsing, timing, routing, or block assignment behavior.

High-value reminders:
- Fixed-route work follows **draft → publish**. Do not treat master schedules as editable working copies.
- Segment rounding, gap-based block assignment, trip pairing, cycle-time semantics, and post-midnight ordering are locked behavior.
- AI suggests; planners decide.
- New Schedule Step 2 is an internal workflow, not a hard human decision gate. Step 3 and Step 4 should still trust the approved runtime contract, but the UX may auto-approve on continue instead of forcing a separate approval decision.
- In New Schedule Step 2, loop-route planning chains must stay keyed as `Loop` in `canonicalDirectionStops`; do not coerce loop master/fallback stops into `North` or `South`, or full-pattern runtime matching for routes such as 10/11 can return no data.
- STREETS runtime imports keep normal and detour observed patterns separate. Step 2 should prefer normal-pattern evidence, fall back to detour-pattern runtimes only when normal evidence is unavailable, and warn planners before approval. Stop-order resolution is normal-only by default, but the New Schedule Step 2 performance path explicitly passes `runtimePatternStrategy: 'detour-fallback'` so detour-only routes such as Route 12 can resolve a usable stop order when no normal trips exist.
- New Schedule performance mode should prefer route-scoped performance files for Step 2 loading. The All routes option remains available for comparison, but default/loading behavior should avoid fetching the full performance JSON when route-scoped files exist.
- In New Schedule Step 1, the performance-data load picker groups A/B direction suffixes under the full base route (for example 7A + 7B appear as Route 7). Variant routes such as 8A and 8B remain separate route choices.
- New Schedule Step 4 exposes Compare to Master as a local planner review panel, not a header toggle. It loads the published master on demand, shows warning-only summary counts, and can show/hide editor deltas without blocking publish.
- New Schedule Step 4 also exposes Regularize Headway as a planner-applied review tool. It snaps trips to the target headway by shifting trip times and rebalancing terminal recovery only; it must not alter travel times or segment runtimes, and overlap/tight-recovery warnings require planner review.
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
- Server-side STREETS auto-ingest enriches stored performance summaries with GTFS-based `missedTrips` in `functions/src/gtfsScheduleIndex.ts`. The Cloud Functions package uses copied GTFS assets under `functions/src/gtfs/` and `functions/src/data/gtfsTripIndex.json`; keep these synced with the root `gtfs/` and `data/gtfsTripIndex.json` files whenever the bundled GTFS feed/index changes, or daily emails may lose missed-trip coverage.
- Transit App OD pair logic is centralized in `utils/transit-app/transitAppOdPairs.ts`; keep the Canada coordinate guard, uncapped default pair retention, `America/Toronto` timezone conversion, and shared OD time-filter definitions in sync with `TransitAppMap`/`DemandModule`.
- Transit App OD display summaries and map display helpers use `utils/transit-app/transitAppOdDisplay.ts`; selected-zone totals must be based on all filtered flows touching the zone, not just the visible Top N map slice, peak-period labels should only appear when positive hourly bins exist, and the OD route-corridor filter should evaluate all GTFS shape variants for the selected route.
- Transit App OD Coverage Gap Analysis is Barrie-only before top-N selection, uses shared Barrie analysis bounds from `utils/transit-app/transitAppGeo.ts`, evaluates all bundled GTFS shape variants, groups merged `2A/2B`, `7A/7B`, and `12A/12B` as route keys `2`, `7`, and `12`, and passes one `coverageStatus` to both the map and table.
- Transit App transfer analysis schema v3 keeps full rankable transfer lists, exact pair time-band counts, exact `America/Toronto` transfer time buckets, service-name-first agency classification, GTFS stop-ID disambiguation for same-name transfer stops, and total wait minutes for weighted summaries. Scope filtering is centralized in `utils/transit-app/transitAppTransferScope.ts` with numbered-route-only Barrie route hints; UI ranking helpers live in `utils/transit-app/transitAppTransferUiMetrics.ts`; and `TransfersModule` applies display caps after scope/time-band filters. Existing saved imports need reimport to regenerate uncapped transfer summaries and exact time-band counts.
- Transit App Stop Analysis schema v2 filters coverage-gap endpoints to the Barrie analysis bounds, records invalid/out-of-scope endpoint exclusions, uses exact `America/Toronto` time buckets, reports total cluster count before the saved top-150 cap, normalizes stop mention case/whitespace, and falls back to an exact GTFS nearest-stop scan for far endpoints. Existing saved imports need reimport to regenerate stop proximity summaries.
- Transit App Heatmap schema v2 keeps weekday overnight separate from evening, stores one hotspot callout per non-empty atlas slice, uses exact `America/Toronto` season/day/time buckets, and avoids all-season map fallback when a selected atlas slice is missing. Existing saved imports need reimport to regenerate heatmap summaries.
- Transit App GTFS normalization merges Barrie GTFS `2A/2B`, `7A/7B`, and `12A/12B` into Transit App route keys `2`, `7`, and `12`; keep `8A` and `8B` separate.
- Transit App Route Performance schema v3 joins observed trip legs to engagement months using exact `America/Toronto` local month, not the raw UTC timestamp month; weekday/weekend scores use daypart-specific observed-leg counts; stale scorecard rows compare against the median for that route's own latest month; table sorting keeps N/A score values last. Existing saved imports need reimport to regenerate corrected route-performance summaries.
- Transit App Service Gaps schema v2 is Barrie-scope only: filter out regional/non-Barrie transit legs before comparing to bundled Barrie GTFS supply, use average app requests per service day/hour for demand-vs-supply, use exact Toronto-local minutes for span-start/span-end demand, and save the full gap register. Existing saved imports need reimport to regenerate service-gap summaries.
- Dwell cascade logic exists in both `utils/schedule/dwellCascadeComputer.ts` and `functions/src/dwellCascadeComputer.ts`; keep them behaviorally synced and run the cascade/function sync tests when changing it.
- Public timetable content is now team-managed config, not only static copy in the component.
- Route Planner 2 can import one or more full GTFS route patterns as local editable planning-copy scenarios through `utils/route-planner-2/routePlanner2GtfsImport.ts`; imports filter out partial patterns, keep scheduled segment runtimes as high-confidence evidence by time band when available, and do not create fixed-route schedule drafts or edit GTFS feeds. GTFS imports attach optional route-family metadata for Barrie merged A/B routes 2A+2B, 7A+7B, and 12A+12B so the picker/sidebar show one family with editable Out/Back direction concepts; keep 8A and 8B separate. Family summaries are derived in `utils/route-planner-2/routePlanner2Summary.ts`: combined runtime is the sum of ready direction runtimes, cycle window uses selected GTFS `block_id` scheduled cycle windows when available and otherwise shared buses × frequency, recovery is cycle minus combined runtime, and the direction scenarios keep separate labels/stops/shapes/runtimes.
- Route Planner 2 supports local stop-range reassignment between route concepts through `reassignRoutePlanner2StopRange`; copied/moved stops get new local IDs, insertion position is planner-controlled, and stale runtime evidence/line anchors are cleaned when stop order changes.
- Route Planner 2 runtime estimates use priority-protected segment evidence: planner manual overrides outrank observed evidence, blended observed+scheduled evidence, scheduled proxies, Mapbox estimates, and distance fallback. Evidence derivation lives in `utils/route-planner-2/routePlanner2RuntimeEvidence.ts` and depends on local scenario stops plus performance/schedule indexes, not legacy Route Planner modules. For Route Planner 2 GTFS segment runtimes, use the stop-to-stop `buildCorridorSpeedIndex` index; the map/corridor chunk index is for corridor visualization and will not reliably match adjacent stop pairs. Same-minute adjacent GTFS stop times are valid scheduled evidence and are kept at a 1-minute minimum rather than being treated as missing, but imported GTFS route-level totals should preserve the median first-stop-to-last-stop elapsed runtime for the selected band so dense stop interpolation does not inflate runtime or understate recovery. GTFS-imported scheduled runtimes are selected by service day/planning period, and when period-specific evidence is missing the planner preserves imported full-day GTFS runtimes instead of clearing them to Mapbox/fallback; the UI must disclose the band actually in use.
- Route Planner 2 GTFS patterns that start and end at the same stop are already complete loops; feasibility should not double them as one-way out-and-back routes. Use the loop trip runtime against the selected scheduled cycle window to calculate recovery.
- Route Planner 2 stop-card and map-label kids/travel-time summaries live in `utils/route-planner-2/routePlanner2StopTimes.ts`; kids counts prefer imported `riderCount` and fall back to source rows for older saved/imported stops. Cached Barrie POI search suggestions live in `utils/route-planner-2/routePlanner2PopularPlaces.ts` and are checked before Mapbox for non-civic-address queries.
- Route Planner 2 custom concepts can use scheduled GTFS corridor runtime evidence when the custom stops match GTFS stops but are not adjacent in GTFS. The resolver finds route-specific GTFS paths between the matched stops, aggregates scheduled runtime over the full path, and supports runtime-panel filtering between all matching routes and selected routes. Corridor estimates are labeled as scheduled GTFS corridor estimates with matched route names.
- In Route Planner 2 GTFS runtime filtering, an explicit Selected routes choice overrides the imported source route, while All matching broadens the match to every scheduled route that follows the corridor. Stop-range reassignment should preserve period-specific GTFS runtime estimates and manual overrides when copied/moved in the same direction.
- Route Planner 2 stop-range reassignment now has a pre-apply transfer preview for runtime impact, carried scheduled/manual evidence, connector gaps, duplicate join-stop warnings, and reversed-direction evidence drops. When a one-way target route is extended by prepending before its start terminal or appending after its end terminal, the terminal role moves to the new outer transferred stop so feasibility includes the transferred section.
- Route Planner 2 routes now carry a planner-controlled runtime source mode: `gtfs` allows scheduled GTFS runtime evidence to outrank Mapbox, while `mapbox` ignores GTFS runtime evidence and uses Mapbox/drawn-route estimates, then fallback assumptions. Manual overrides still outrank automatic sources.
- New blank/custom Route Planner 2 scenarios default to `runtimeSourceMode: 'mapbox'`; GTFS-imported scenarios default to `runtimeSourceMode: 'gtfs'` so their first runtime estimate uses scheduled GTFS stop times. Planners can still switch runtime source mode from the Advanced source panel.
- Route Planner 2 GTFS imports also seed service assumptions from the selected pattern when available: first/last trip start, median scheduled headway, day type, and distinct `block_id` count as `targetBuses`. Feasibility uses `targetBuses * frequency` as the scheduled cycle window so existing services such as three buses at 30-minute frequency are reflected before edits.
- Route Planner 2 map overlays are zone-owned. Keep the full stop order in the review rail; the map should show only a compact stop summary with a `Review stops` action so bulk address imports do not cover controls or metrics.
- Route Planner 2 uses a full-screen map shell: project identity lives in a small floating chip; primary actions, route concepts, and the runtime source overlay toggle live in a collapsible left sidebar; and GTFS/address imports open as right-side map drawers instead of page-centred modals. The right-side review panel mirrors the left sidebar with collapsed/expanded states, includes a top save action, and owns draw-route guidance/address search/route type controls so the map stays clear. The map should not show a duplicate stop-review tray because stop order lives in the review rail.
- Route Planner 2 map PDF export is screenshot-first for the map: capture the app map and embed it in the PDF instead of redrawing the map with jsPDF primitives. Export-only map labels should use inline SVG text with explicit centered baselines before `html2canvas` capture. The PDF header, KPI cards, and legend should stay sharp vector jsPDF text/shapes with `baseline: 'middle'`; do not rasterize an SVG header into a PNG because it blurs the header.
- Route Planner 2 road-name labels come from Mapbox Directions step names collected during road snapping. They are planner-toggleable on the map and automatically shown during map PDF capture; keep them as map symbols with halos rather than permanent HTML overlays so dense routes can stay uncluttered.
- Route Planner 2 large camp routes must avoid unbounded React/HTML map overlays and list rendering. Interactive stop labels are capped, large stop sets render through Mapbox symbol/circle layers, the stop-order rail is virtualized, only selected/high-priority stops stay as draggable HTML markers, and automatic road snapping is skipped for extremely large segment counts.
- Route Planner 2 map authoring uses mouse-position shortcuts: `1` adds a stop at the current pointer location, and `2` adds a bend at the pointer location on the nearest route segment. Blank map clicks do not add stops. Route-line clicks select a segment and open the segment popover, which also supports manual travel-time overrides; saved overrides remain planner-controlled and outrank automatic runtime sources.
- Route Planner 2 selected stops include curb-side repair controls in the right review rail: **Flip side** reflects/nudges the stop across the inferred street line when a stable reference exists, N/S/E/W nudges move it in small 4 m increments, and suspicious Mapbox detours surface a stop-side warning that directs planners to the available repair controls. Box/Lasso-selected stops and bend anchors can also be nudged in 4 m increments from the selection menu.
- Route Planner 2 planner edits are undoable/redoable from the sidebar and keyboard shortcuts. Background runtime estimates and save status updates should not create undo history entries.
- Route Planner 2 road snapping/runtime estimation is a staged background build: imported or bulk-added stops render immediately with fallback geometry, then Mapbox segment snapping runs through a bounded queue with progress instead of firing all segment requests at once. Keep this non-blocking behavior for address-import route creation.
- Route Planner 2 address geocoding prefers `/api/route-planner-geocode` in production and falls back to direct client Mapbox search when needed. Manual-review rows include safe diagnostics for query, geocoder source, response status, token-present boolean, result count, top result, and confidence rejection reason; never expose token values.
- Route Planner 2 address import collapses apartment unit-style addresses to one base building stop for route planning, for example `1009-49 Coulter St` and `1407-49 Coulter St` become `49 Coulter St`; normal civic ranges such as `37-41 Johnson St` and `309-339 Essa Rd` must remain ranges.
- Route Planner 2 address import can create visible bus start/end terminal stops and order imported address stops between them using Mapbox road travel time. The fixed-endpoint optimizer lives in `utils/route-planner-2/routePlanner2StopOptimization.ts`; it should fail rather than silently use fallback geometry when exact road-time data is unavailable.
- Route Planner 2 operator PDF export is an operator route card, not a planner report: include a Map PDF-style captured overview, focused stop-to-stop segment maps before each matching direction segment when available, a stop checklist with roles/next-stop runtimes, route-phase labels, large operator action badges for turn-by-turn steps, and explicit field-review flags for planning-alignment fallback, turnaround safety, missing runtimes, stop placement, turns, road restrictions, construction, and supervisor approval.
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
