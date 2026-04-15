# ORCHESTRATOR.md

Living memory for future orchestrator work in Scheduler 4.

## 1) Purpose and update rules

Use this file as the compact, durable memory of the repo’s current shape, conventions, risks, and operating assumptions.

Update this file when:
- architecture changes in a durable way
- workspace ownership changes
- a high-risk area is discovered or retired
- repo health changes in a way future work should know

Keep it:
- concise
- practical
- current
- easy to append to

Do not use this file for dated delivery notes or plan chatter. Use it for durable context only.

## 2) Current architecture summary

Scheduler 4 is a Barrie Transit planning app with one shared shell and three top-level workspaces:

- On-Demand
- Fixed Route
- Operations

The app uses hash-based navigation rather than a router library. The top-level shell lives in `App.tsx`, with `index.tsx` as the mount point.

This is a domain-heavy monolith: UI lives in `components/`, domain logic in `utils/`, and persistence/services are split into Firebase-backed helpers plus a small set of API and function entry points.

## 3) Workspace/module boundaries

### On-Demand
Owns shift generation, optimization, validation, and related saved-schedule workflows.

### Fixed Route
Owns the core scheduling workflow:
- CSV/runtime import
- schedule generation
- editing
- GTFS import
- draft management
- publish to master schedules
- timetable/report outputs

### Operations
Owns performance dashboards and reporting for STREETS-style operational data.

### Analytics / planning tools
The analytics/planning side is broader than the core workspaces and includes:
- route planner
- shuttle planner
- network connections
- student pass
- OD tools
- Transit App analytics

### Domain folders
Key domain areas live under `utils/`, especially:
- `utils/schedule/`
- `utils/blocks/`
- `utils/parsers/`
- `utils/gtfs/`
- `utils/connections/`
- `utils/platform/`
- `utils/routing/`
- `utils/transit-app/`
- `utils/od-matrix/`
- `utils/route-planner/`
- `utils/shuttle/`

## 4) Core conventions and locked logic reminders

Respect `docs/rules/LOCKED_LOGIC.md` before changing:
- schedule generation
- time parsing
- block assignment
- routing behavior
- any logic that affects published schedule results

Core reminders:
- round each segment before summing
- trip rows represent paired north/south trips
- cycle time is `lastTripEnd - firstTripStart`
- merged-route block assignment is gap-based
- Excel times `>= 1.0` mean next-day/post-midnight service
- AI suggests; planners decide
- Fixed-route Schedule Editor should follow draft → publish only; direct editor-side "Upload to Master" actions are not part of the intended workflow
- Fixed-route Schedule Editor round-trip cycle display should use the paired row's stored `totalCycleTime`, not rebuilt `travel + recovery`
- Fixed-route Schedule Editor overnight summaries, gap warnings, and post-midnight row sorting should use operational-day ordering so after-midnight trips stay in the correct service sequence
- Fixed-route Schedule Editor time-entry parsing should preserve the existing cell's AM/PM period for ambiguous shorthand edits/pastes when a prior value exists, and should reject explicit invalid 12-hour inputs instead of silently coercing them
- Fixed-route Schedule Editor round-trip grid should behave like a keyboard-addressable editing surface: focusing the grid should select the first populated cell, Ctrl/Cmd+Home/End should jump to the first/last populated cell, Ctrl/Cmd+C and Ctrl/Cmd+V should work on the active cell, and editable time cells should expose meaningful ARIA labels rather than bare clickable divs
- Add-trip full cycles should always start northbound when a northbound table exists, then continue southbound on the same block; cycle mode should use the full route endpoints rather than a collapsed same-terminal stop selection, and unsafe full-cycle duplicates on an existing/reference block should be blocked with a planner-facing recommendation to switch to a new block
- Add-trip modal preview should use the schedule editor-style layout with a live post-change schedule preview, not a tiny trip-summary card, so planners review the actual resulting table before confirming
- Add-trip same-block previews should surface short positive trailing idle gaps before the next trip on that block; when the gap is 1-5 minutes, the modal should offer a planner-controlled "absorb into recovery" option and carry that choice through the real apply path so preview and saved schedule stay aligned
- Add-trip modal UX is now intent-first and insertion-driven: planners choose where to insert service from the live preview (`+ Above first row`, row `+`, `+ Below last row`), then adjust trip type (`Single trip` vs `Round trip`) and bus/block as needed; presets, insertion context, planner impact, and operational diagnostics stay behind an "Advanced planner controls" expander by default
- Fixed-route Schedule Editor main round-trip table now mirrors that insertion model with visible `Add trip above first row` and `Add trip below last row` controls in the live table itself, in addition to the per-row add button, so planners can start Add new trip directly from the actual editor placement they mean
- Add new trip and Extend trip modals should surface plain-language action summaries up front: Add new trip now shows placement, anchor trip window, and anchor block; Extend trip shows current span, result-if-applied span/window, and stop-count change before the planner opens any advanced details
- Fixed-route Schedule Editor now has a first Extend Trip workflow: planners can choose `Extend Trip` for a selected northbound/southbound row action, then either bring the trip earlier or extend it later in a dedicated modal with a live schedule preview; the extension updates the existing trip in place, preserves current stop times on the already-served segment, fills only the newly added stops from the nearest template trip, and blocks confirmation if the longer trip would overlap other work on the same block
- Round-trip row actions now expose visible inline Extend Trip buttons for each direction (`N` and `S`) alongside the add/delete controls, so planners can jump straight into extending the northbound or southbound trip without opening the overflow actions menu first
- Manual terminal recovery edits in the Fixed-route Schedule Editor should be non-propagating by default: changing end-of-trip recovery should preserve the existing paired row/block assignment, keep downstream trips untouched, and only change the terminal departure-equivalent plus the trip's recovery/cycle metrics
- Fixed-route Schedule Editor inline cell edits, recovery edits, and +/- nudges now flow through `hooks/useScheduleEditing.ts`; delete/duplicate/direction handlers still remain local in `ScheduleEditor.tsx` pending further cleanup
- Fixed Route now persists a lightweight “where you left off” resume target in local storage. The app home dashboard shows a one-click resume button for the last meaningful Fixed Route location, and `fixed/editor` or `fixed/system-editor` resume paths can reopen the last saved draft/system draft from stored IDs instead of landing on a blank shell after a dev refresh
- Add-trip block assignment should default to an existing block when one is available, while still letting the planner switch to a new block or the original reference block
- Round-trip table block badges should be derived from the live current block sequence, not stale imported flags: show `BEGIN` on the first current row of a block and `END` on the last current row so block markers stay correct after added or edited trips
- New Schedule wizard Step 2: chart + detailed table show actual bucket totals for the selected metric; segment matrix cells show weighted band summaries; matrix `Band Avg` and legend show the actual average bucket total for that band; P80 view keeps median/P50-based band assignment and colors
- New Schedule wizard Step 2: when performance imports include day-level cycle evidence, the chart, detailed table, tooltip headline, banding, and strict-cycle guidance should prefer full observed cycle totals for each bucket; the segment matrix and direction band summaries still derive from segment-level medians/P80s
- New Schedule wizard Step 2: full observed cycle totals must only use days that contributed the complete expected segment chain for that bucket; partial day contributions can falsely depress Route 7-style cycle bars and the tooltip's "last parsed days" list if they are treated as complete cycles
- New Schedule wizard Step 2: buckets with missing segment coverage stay visible and flagged, but are unbanded by default and excluded from band calculations, legend averages, band matrix summaries, and downstream direction band summaries used for generation
- New Schedule wizard Step 2: performance-data imports use a 5-day confidence floor for low-confidence bucket flagging; CSV imports keep the sample-count confidence rule

Fixed-route uses a draft → publish workflow. Do not treat master schedules as editable working copies.

## 5) Persistence and backend/runtime model

The repo is Firebase-centered:
- Firestore stores metadata and indexes
- Firebase Storage stores large JSON/blob payloads
- Auth is Firebase-backed

Common pattern:
- Firestore = lightweight document state
- Storage = full content or versioned payloads

Backend/runtime surfaces are mixed:
- Vite dev middleware in `vite.config.ts`
- request handlers in `api/`
- Firebase Functions in `functions/src/`

This mixed model is real and should be treated as part of the architecture, not an accident.
For endpoints that already have a canonical `api/` handler, prefer making Vite dev delegate to that handler rather than re-implementing request logic in `vite.config.ts`. `performance-query` now follows that pattern.
Optimize now also follows that delegation pattern locally, and the shared optimize engine lives in `utils/ai/optimizeCore.ts` so the Vercel/API and Firebase Functions wrappers no longer carry separate copies of the core prompt/scoring pipeline.
Fixed-route Schedule Editor now has a feature-flagged local AI Review side panel. The panel is read-only, builds its own grounded route/day snapshot in `utils/ai/scheduleReviewContext.ts`, talks to `api/local-ai-review.ts` instead of calling a local model runtime directly from the browser, and currently supports both anomaly review and draft-vs-master summary actions.

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

Also watch very large orchestration files and workspaces such as:
- `components/workspaces/OnDemandWorkspace.tsx`
- `components/workspaces/FixedRouteWorkspace.tsx`
- `components/MasterScheduleBrowser.tsx`
- `components/Analytics/TransitAppMap.tsx`
- `utils/transit-app/transitAppAggregator.ts`

## 7) Current repo health snapshot

Verified recently:
- Web build passes
- Step 2 incomplete-coverage banding fix is in place: missing-segment buckets stay visible/flagged but are excluded from banding and downstream band summaries
- New Schedule performance runtimes now prefer stop-level legs first; coarse timepoint segments are only used when stop-level data is absent
- New Schedule performance stop-level legs must be canonicalized to master-stop names before Step 2 coverage matching; raw STREETS aliases like terminal-specific stop names can otherwise yield false `0/x` coverage
- New Schedule stop-name matching now relies on Barrie-specific alias normalization for common master/STREETS drift across routes, including downtown/allandale/south-GO hub families plus platform or entrance variants such as `Downtown Hub (Platform 2)`, `Allandale Waterfront GO Station`, `Barrie Allandale Transit Terminal Platform 13`, `Georgian Mall North Entrance`, `Peggy Hill Community Centre`, `Park Place Terminal`, and `RVH Main Entrance`
- New Schedule should only trust master-derived canonical stop chains for bidirectional performance analysis when both direction tables are present; legacy one-sided master tables are unsafe and should fall back to performance-derived segment chains. When both tables exist, the out-and-back canonical chain may need a handoff bridge from the last north stop to the first south stop (for example Route 7 `Georgian College -> Rose Street`), and that bridge must stay on the outbound/north chain rather than being prepended to the return/south chain or Step 2 can show a false single missing segment
- New Schedule performance stop-level fallback must handle non-contiguous / branched stop-index graphs and must reconstruct downstream bucket timing within a trip; assuming contiguous indexes or one shared bucket across all fine segments can falsely leave Step 2 with no complete cycle buckets
- New Schedule performance route matching must treat base selections like `12` as matching `12A` + `12B`; only explicit variant picks like `12A` should stay exact-match
- New Schedule performance runtime inference must not collapse suffix-as-direction routes like `2`, `7`, or `12` into one side when raw trip directions are blank; if trip names still carry `2A/2B`, `7A/7B`, or `12A/12B`, use that hint so Step 2 still builds a full out-and-back cycle
- New Schedule now has a standalone dynamic stop-order resolver in `utils/newSchedule/stopOrderResolver.ts`. It derives route stop order from recent observed trip-stop runtimes, prefers stop IDs over names, weights complete midday patterns, penalizes skipped-stop/partial patterns, and returns a decision gate (`accept` / `review` / `blocked`) before any Step 2 wiring
- Stop-order resolution must treat zero-based and sparse `routeStopIndex` values from live STREETS trip-stop data as valid. Penalize actual chain discontinuities, not raw numeric index gaps, and judge cleanliness from the average skipped/discontinuity count across the dominant pattern so one noisy trip does not falsely demote an otherwise strong repeated route pattern
- New Schedule / STREETS segment runtime proxies should include ordinary intermediate stop dwell for planning realism, but should subtract planned control-point hold/recovery from non-terminal legs when the downstream stop has scheduled arrival/departure hold and observed arrival/departure times. Continue to fall back to downstream arrival at terminal/end-of-trip points so terminal recovery is not baked into segment runtime
- New Schedule Step 2 now surfaces a Data Health summary before the chart. That health check combines route/day availability diagnostics, direction coverage, segment-chain coverage, complete-vs-incomplete bucket counts, and import freshness warnings
- New Schedule Step 2 performance analysis should now run the stop-order resolver before building the canonical planning chain: `accept` lets runtime-derived stop order replace the master chain for analysis, while `review` / `blocked` stay visible in Step 2 health and should not silently auto-trust a runtime-derived stop order
- New Schedule Step 2 now hardens incomplete bucket handling across all routes: it classifies incomplete buckets as boundary-service, single-gap, internal-gap, or fragmented coverage; it keeps boundary/partial-cycle buckets visible but unbanded; and it can repair small safe gaps from adjacent complete buckets for planning (one missing segment, or up to three contiguous internal missing segments) while marking that bucket as an estimated repair in Step 2 health and review UI
- Performance imports now stamp a separate runtime logic version in metadata. Missing or older runtime logic versions should be treated as legacy imports and surfaced as a re-import recommendation in Step 2
- New Schedule Step 2 should now ignore legacy pre-fix performance history by default. It uses a clean-history window from `metadata.cleanHistoryStartDate` when present, otherwise it falls back to the contiguous tail of current-schema daily summaries; future imports extend that clean window forward, and older days stay excluded from Step 2 planning/review
- New Schedule Step 2 also derives an approved runtime model from the current reviewed analysis state. That contract includes the current buckets, bands, direction band summaries, segment columns, and health snapshot; Step 3 should prefer that approved model over re-deriving references ad hoc
- Local wizard resume and cloud project saves now persist the approved runtime model payload alongside the Step 2 analysis state
- New Schedule Step 2 now builds a live `Step2ReviewResult`, stores an explicit `ApprovedRuntimeContract`, and derives approval state from the current review plus stored contract. The wizard shell gates Step 2 continuation on current approval, and Step 3/Step 4 consume the approved contract via an adapter instead of re-deriving live Step 2 truth
- New Schedule Step 2 footer now carries the approval gate directly: when the current review is unapproved or stale it shows approve/re-approve actions, and once approved it switches to the Continue to Step 3 action
- New Schedule Step 2 warning approvals no longer require a separate acknowledgement step; warnings remain visible in Data Health and the approved contract still records the warning list when a warning-state approval is saved
- New Schedule Step 2 no longer shows the in-page approval strip; the footer owns the approval/continue action so the gate is not duplicated inside the page body
- New Schedule Step 2 screen split has started in earnest: `Step2Analysis.tsx` is now a thin wrapper, and the large planning/chart/legend/travel-view/detail-table UI lives in `components/NewSchedule/step2/Step2PlanningReviewPanel.tsx`
- New Schedule generation should now refuse to run without an approved Step 2 runtime model and should feed `generateSchedule` with the approved buckets, approved bands, and approved direction band summaries rather than rebuilding a separate performance-specific band summary at generation time
- New Schedule wizard navigation now clamps Step 3 and Step 4 behind the current Step 2 approval gate, and stale or missing approvals should drop the user back to Step 2 instead of letting downstream steps operate on legacy approval data
- New Schedule Step 3 and Step 4 should treat the current `ApprovedRuntimeContract` as their only trusted Step 2 source; legacy approved-runtime payloads may still be stored for compatibility or display, but should not drive downstream build/generation behavior when no current contract exists
- New Schedule Step 2 UI has started its component split: approval, readiness/data-health, approved-runtime summary, and travel-view sections now live in `components/NewSchedule/step2/`, while `Step2Analysis.tsx` still owns most of the derived state, charting, and detailed table logic
- New Schedule Step 2 must ignore stale canonical master-stop columns from a previously loaded route; only canonical data for the current route identity is valid, otherwise Step 2 can falsely show `0/x` coverage from an unrelated route chain
- Standalone verification for the new stop-order resolver passed in `tests/stopOrderResolver.test.ts`, including a Route 12 smoke test where the resolver correctly chose the complete midday pattern over more frequent partial trips and blocked when one direction was missing
- Operations / Performance now has an import-health panel (`utils/performanceImportHealth.ts`, `components/Performance/PerformanceImportHealthPanel.tsx`) that summarizes latest import freshness, latest service-day freshness, runtime-logic version drift, mixed schema history, and trip-linked runtime coverage so stale auto-imports or partially upgraded history are visible in the UI
- Operations Overview should prefer stored `day.missedTrips` results from imports instead of recomputing GTFS missed trips on first open. `components/Performance/SystemOverviewModule.tsx` now lazy-loads GTFS fallback logic only for older imports missing those stored results, so first-open dashboard work stays lighter for current data
- Performance data consumers should pass already-fetched metadata into `usePerformanceDataQuery` / `getPerformanceData` so the app reuses the known storage path instead of re-reading metadata before each full JSON download. `components/Performance/PerformanceDashboard.tsx` also now opens into a metadata-backed loading shell while the heavy history file streams in, so planners see immediate dashboard context instead of a blank blocker
- Operations Dashboard now has a two-stage load path for current imports: save/import writes a lightweight `-overview.json` last-7-days payload and stores `metadata.overviewStoragePath`; `PerformanceDashboard` opens from that Overview payload first, and `PerformanceWorkspace` keeps non-overview tabs disabled with a loading banner until the full history file finishes in the background
- Performance imports now also write a report-focused `-report.json` snapshot and store `metadata.reportStoragePath`; the daily email should prefer that lighter snapshot over the full performance history blob so email generation can stay stable as the full dataset grows
- Server-side performance imports are now re-aligned with the app-side performance schema: `functions/src/types.ts` and `functions/src/aggregator.ts` now emit schema v8 summaries with `ridershipHeatmaps`, `routeStopDeviations`, and the same schema/runtime version constants the frontend expects
- Performance auto-ingest in `functions/src/index.ts` should now fail closed if the existing saved performance summary cannot be read, instead of silently starting fresh and overwriting history; it also accepts base64-encoded CSV request bodies so Power Automate-style `Content Bytes` payloads still ingest cleanly
- Targeted sync coverage for that alignment lives in `tests/functionsPerformanceAggregatorSync.test.ts`, and current verification passed for both root build and `functions/` build
- Performance auto-ingest now archives each raw STREETS CSV to `teams/{teamId}/performanceImports/raw/{timestamp}.csv` and records a matching Firestore import-run doc under `teams/{teamId}/performanceImports/{importId}` so future history can be replayed
- Cloud Functions now expose `rebuildPerformanceHistory`, which can dry-run or apply a date-window rebuild from archived raw performance imports; this can clean up mixed recent history going forward, but it cannot recreate richer data for dates whose raw CSVs were never archived
- Targeted verification for that fix passed: `tests/runtimeAnalysis.totalTripTimes.test.ts`, `tests/scheduleGenerator.canonicalTravelTimes.test.ts`, and web build
- Connections / GO GTFS templates now treat calendar_dates-only feeds as date-scoped service variants: they pick one representative service date for the requested day type instead of unioning every weekday/weekend variant, and northbound GO arrival templates use station arrival times rather than departure times
- Step 5 Connections is now partially route-first: the Route Connections panel can create a new goal directly, reusing the existing chooser/modal flow, and auto-attach the new target to the current route when a matching route stop can be inferred. Shared inference/default logic now lives in `utils/connections/routeConnectionDefaults.ts`
- That same Step 5 route-first flow now shows a pre-save preview inside `AddTargetModal.tsx` when the goal is being created from the route panel. The preview uses the shared route inference helper to show suggested stop, default rule, and active events for the current day before the target is saved and attached
- `ConnectionAddChooser.tsx` is now also route-aware when opened from the Route Connections panel: GO buttons, multi-select import copy, and helper text all describe saving and adding GO options to the current route/day instead of generic library import language
- `AddTargetModal.tsx` now acts like a route-first goal builder when it is launched from the Route Connections panel with template data: it shows a review-oriented header, route-specific save CTA, the route preview block, and hides library-style detail fields behind an “Edit details” toggle by default
- The Step 5 multi-target GO import path now also shows a per-target route attach preview inside `ConnectionAddChooser.tsx`, so planners can review the suggested route stop, timing rule, and current event preview for each selected GO option before saving and auto-attaching them
- Step 5 now defaults to opening the `Route Connections` panel first, and the former `Connection Library` surface is relabeled `Saved Service Library` with an explicit `Advanced` badge plus helper copy that frames it as shared-service maintenance/import tooling rather than the primary route setup path
- Step 5 no longer renders the full library manager inline in the main layout. Instead it shows a lighter `Advanced saved-service tools` card with a `Manage saved services` button that opens the existing `ConnectionLibraryPanel` inside a modal, keeping the route workflow primary while preserving the advanced maintenance/import surface
- `ConnectionLibraryPanel` now supports a compact admin mode for that Step 5 modal: it defaults to route-relevant saved services for the current route/day, offers a toggle to show all saved services, and keeps GTFS refresh, connection timing settings, and recent change history behind a collapsed `Library maintenance` section
- That compact admin mode now also surfaces clearer saved-service grouping with quick counts for `Manual saved services` and `Route-derived saved services`, so planners can scan the kinds of available services before expanding individual items
- Compact saved-service rows now also show route/day usefulness badges before expansion, including stop-match status and active-time relevance, so planners can judge whether a saved service is likely useful for the current route/day at a glance
- Compact advanced saved-service lists are now also sorted by route relevance: matching services with active times rise above non-matching or inactive ones, especially when planners switch from the route-relevant default to the broader “show all saved services” view
- Demo-safe feature gating now lives in `utils/features.ts`. It centralizes environment-driven visibility for top-level workspaces plus selected Fixed Route, Analytics, and Operations tools. `VITE_DEMO_MODE=1` now keeps demo-tagged features visible by default and marks them as under construction in the UI instead of hiding them; per-feature overrides still use `VITE_FEATURE_<FEATURE_NAME>=true|false`
- Fixed-route delta / compare-to-master is being re-founded around stable trip lineage plus a dedicated compare result in `utils/schedule/masterComparison.ts`. New/duplicated/generated trips now get `lineageId`, older restored Step 4 sessions are normalized to backfill lineage, compare-to-original prefers lineage-aware lookup keys, and the round-trip table now consumes explicit compare entries (`matched` / `new` / `ambiguous` / `removed`) with match method metadata instead of guessing directly in render. Time-based compare should now flag near-tie matches as `ambiguous` / review-needed instead of forcing a confident delta, and those ambiguous candidate master trips should not also show up as false `removed` rows. Review-needed trips now surface in a dedicated `MasterCompareReviewPanel` above the affected route table with current-trip details, candidate master trips, and a jump/focus action back to the row in the grid
- Test suite has student-pass timeout failures

Other current cautions:
- build output shows large bundle/chunk warnings
- the working tree may already contain unrelated edits; do not assume a clean baseline

## 8) Guidance for future subagents

Default behavior:
- do not implement directly unless explicitly instructed
- spawn subagents for scoped tasks
- give each subagent a clear goal, owned files, forbidden files, conventions, and verification steps

When scoping work:
- prefer one subagent per distinct task
- keep file ownership narrow
- avoid overlap unless the task truly requires it

By default, avoid treating these as source of truth:
- `.tmp/`
- `.worktrees/`
- `temp/`
- `docs/plans/`
- `docs/archive/`

If a task touches locked logic, high-risk schedule code, or a fragile workspace, require explicit verification before calling it done.

## 9) Working assumptions / source-of-truth docs

Primary durable sources:
- `AGENTS.md`
- `docs/CONTEXT_INDEX.md`
- `docs/rules/LOCKED_LOGIC.md`
- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`

Use plan/archive content only as historical context unless a durable doc confirms the behavior.

If this file drifts from reality, update it from current code and current durable docs rather than from old plans.

Recent durable note:
- Newly added trips now carry a delta-source fallback to the template trip they were cloned from, so non-master `+/- Deltas` continue to render on appended service instead of disappearing just because the new trip has no direct original match.
