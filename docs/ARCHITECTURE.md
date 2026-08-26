# Architecture

> Last reviewed: July 22, 2026
> Load order: start with `AGENTS.md`, then `docs/CONTEXT_INDEX.md`, before using this file as agent context.

## Overview

Scheduler 4 is a Barrie Transit planning platform with a fixed-route scheduling core plus adjacent planning and operations tools.

This file is a navigation guide, not an exhaustive file inventory. Use it to understand:
- the main app shells
- where major domains live
- which files are most important
- which areas are fragile

For locked schedule behavior, read `docs/rules/LOCKED_LOGIC.md` first.
For collections, storage paths, and type locations, use `docs/SCHEMA.md`.

### Stack summary

- React + TypeScript single-page application built with Vite
- Firebase Authentication, Firestore, Cloud Storage, and Cloud Functions
- Vitest for unit/integration tests, with selected browser smoke coverage
- Mapbox for map-first planning surfaces
- Excel/PDF import and export tooling for planner-facing workflows
- Capacitor for the Android application shell

Use `package.json`, `firebase.json`, and `functions/package.json` for current dependency versions and runtime configuration; do not copy patch versions into durable architecture guidance.

### New Schedule runtime trust boundary

Step 2 keeps visible review evidence separate from scheduling inputs. `TripBucketAnalysis.evidence` records the evidence kind, qualifying count, required count, eligibility, and exclusion reasons. `ApprovedRuntimeContract` schema version 2 stores both `reviewBuckets` and the smaller `approvedBuckets` set. Steps 3 through 5 accept only a current v2 contract; stale approval blocks generation, schedule editing, connection optimization, and draft handoff. The wizard never writes Master directly: Step 5 opens the normal draft editor, where save, review, readiness, and publishing protections apply. Trusted generation uses the exact eligible approved bucket when available, otherwise the nearest eligible bucket from the same direction/start orientation. It still throws `MissingApprovedRuntimeError` rather than crossing orientations or using unapproved, raw, or default runtime evidence.

Performance planning canonicalizes complete trips onto the official stop chain before same-day pairing. Raw stop-pattern variations do not disqualify an otherwise complete trip. Candidate opposite-direction legs must preserve terminal continuity when identifiers or anchors are available and must start within the bounded 30-minute handoff window. North-then-South and South-then-North cycles are shown, excluded, and validated as separate models; each approved cycle-start half-hour bucket needs five distinct complete days and supplies both legs of only that orientation. `RuntimeData.cycleStartDirection` keeps the analyses separate, `plannerOverrides.excludedCycleBucketsByStartDirection` preserves independent planner exclusions, and `planning.approvedCycleBucketsByStartDirection` persists the approved inputs. A missing orientation fails closed; a missing exact bucket uses the nearest eligible bucket within that same orientation. CSV percentiles become eligible only when the upload includes explicit per-segment observation counts and positive finite P50/P80 values. Stop-level, count-free CSV, and detour evidence remain troubleshooting-only. Observed stop order without trusted anchors cannot silently become canonical full-route truth.

Saved projects use revision-checked, serialized cloud writes. Save snapshots preserve the highest completed payload already present in memory, so a temporary Step 2 trust gate cannot discard saved Step 3 configuration or Step 4 schedules. `generatedScheduleInputFingerprint` binds output to the exact approved runtime fingerprint, day type, autofill choice, and normalized Step 3 configuration; Steps 4 and 5 redirect to regeneration when those inputs drift. Local progress is resumable through an explicit prompt, and project switching is guarded while saves or unsaved changes remain. Readers deeply validate the v2 contract instead of trusting a version marker or stored eligibility Boolean. Loading a legacy project durably removes its old runtime/generated artifacts while preserving planner settings; a failed cloud reset remains visible and requires retry.

---

## Top-level app shape

`App.tsx` is the main shell. It uses hash-based navigation and lazy-loads five top-level app views:

Firebase Hosting keeps its client-route fallback for non-asset URLs but excludes `/assets/**`. Missing hashed bundles must return `404` so `utils/lazyWithRetry.ts` can refresh a stale open tab instead of receiving cached `index.html` as JavaScript.

- **On-Demand** → `components/workspaces/OnDemandWorkspace.tsx`
- **Fixed Route** → `components/workspaces/FixedRouteWorkspace.tsx`
- **Operations** → `components/workspaces/OperationsWorkspace.tsx`
- **Parking** → `components/workspaces/ParkingWorkspace.tsx`
- **Planning Data** → `components/Analytics/AnalyticsDashboard.tsx`

Common app-wide infrastructure:
- auth context → `components/contexts/AuthContext.tsx`
- team context → `components/contexts/TeamContext.tsx`; it loads the active team, ordinary users' memberships, or the full team directory for scheduler administrators, and owns active-team/support-team switching
- toast context → `components/contexts/ToastContext.tsx`
- global header → `components/layout/Header.tsx`; it keeps the active team visible, provides membership-backed switching for ordinary users, and lets scheduler administrators inspect any team through an expiring read-only support session
- feature flags → `utils/features.ts`
- workspace access profiles → `utils/workspaceAccess.ts`, surfaced through `hooks/useWorkspaceAccess.ts`
- named workspace access packages → `utils/workspaceAccessPackages.ts`, used by Team Management for safer onboarding presets
- Expiring developer support sessions → `utils/developerPreview.ts` and `utils/services/developerSupportSessionService.ts`, applied in `components/contexts/TeamContext.tsx`

Planning Data has a second routing and permission-registration layer beneath the top-level `#planning` hash:

- nested view names, labels, hash parsing, and hash building → `utils/workspaces/analyticsWorkspaceRouting.ts`
- nested view-to-feature permission mapping and workspace composition → `components/Analytics/AnalyticsDashboard.tsx`
- feature definitions and build availability → `utils/features.ts`
- user/team access keys and access profiles → `utils/workspaceAccess.ts`

When adding or renaming a Planning Data workspace, update all four registration points and the focused routing/access tests. A card or component alone does not make a workspace routable or accessible.

`components/Analytics/FareProgramsWorkspace.tsx` is a read-only analysis surface with usage-map and raw-count views. `scripts/generateFareProgramsSnapshot.mjs` deterministically derives its privacy-preserving `utils/fare-programs/fareProgramsSnapshot.generated.json` summary asset from the source workbook, including a source hash and aggregate fare-program counts. The workspace accepts validated `.xlsx` files up to 100 MB and uses `fareProgramsWorkbookStorage.ts` to retain the selected workbook in the browser's IndexedDB under one replaceable device-local key; it restores that file on later visits and exposes an explicit removal action. The workbook is not uploaded to Firebase or bundled into the generated snapshot. `components/Analytics/FareProgramsUsageMap.tsx` parses and buckets High School Pass starting-location labels in `fareProgramsWorkbook.worker.ts`, automatically starts map geocoding after parse, supports weekday/weekend and overlapping time filters, and renders total transaction uses as either a default Mapbox heatmap or clustered points. `fareProgramsUsageMap.ts` combines workbook labels mapped to the same coordinate before Mapbox clusters nearby points, sums uses and location counts for cluster labels, and preserves the contributing labels for point details. `fareProgramsSchools.ts` supplies planning-context markers for Barrie's publicly funded high schools without implying that a transaction belongs to a school. Temporary map geocoding prefers bundled GTFS stop coordinates and otherwise discloses that starting-location labels are sent to Mapbox; resulting geocodes stay in memory. `fareProgramsPdfExport.ts` creates a labelled internal-planning screenshot PDF of the selected filtered map view. Detailed fare-type rows use the same device-local workbook and worker.

---

## Major product areas

### 1) Fixed Route

This is the most mature and operationally critical part of the repo.

Main areas:
- New Schedule wizard → `components/NewSchedule/`
- Schedule editing → `components/ScheduleEditor.tsx`
- Round-trip schedule display → `components/schedule/`
- GTFS import → `components/GTFSImport.tsx`, `utils/gtfs/`
- Draft and publish workflow → `utils/services/draftService.ts`, `utils/services/publishService.ts`
- System-wide GTFS drafts and multi-route editing → `utils/services/systemDraftService.ts`, `components/workspaces/SystemDraftEditorWorkspace.tsx`; this is a parallel user-scoped draft flow, not a replacement for single-route `draftSchedules`

The Schedule Editor is organized around compare → change → review → publish. `components/workspaces/ScheduleEditorWorkspace.tsx` loads the immutable source-master baseline, owns autosave/checkpoints and the review drawer, and passes edit state into `components/ScheduleEditor.tsx`. Pure change and operational-issue detection lives in `utils/schedule/scheduleReview.ts`; ready-for-review creates a team-visible immutable snapshot through `utils/services/scheduleReviewService.ts`; and publish enforcement is repeated in `utils/services/publishService.ts` so stale/unverifiable master copies, drafts not marked ready for review, blocking schedule issues, and missing/oversized publish notes cannot bypass the UI gate. `utils/services/masterScheduleService.ts` rechecks the expected source version inside its transaction and uses unique upload paths so concurrent publishers cannot overwrite or delete one another's payload.
- Connection setup and optimization → `components/NewSchedule/connections/`, `utils/connections/`
- Public timetable/report output → `components/Reports/`, `utils/reports/`

Core logic folders:
- `utils/schedule/`
- `utils/blocks/`
- `utils/parsers/`
- `utils/gtfs/`
- `utils/connections/`
- `utils/newSchedule/`

### 2) On-Demand

Demand-responsive planning and optimization lives primarily in:
- `components/workspaces/OnDemandWorkspace.tsx`
- root on-demand utilities such as `utils/onDemand*.ts`
- supporting UI such as `components/ShiftEditor.tsx` and related modals

Current import flow:
- Master service requirements and RideCo/MVT shift files can be loaded from direct upload or the file manager.
- A single Master or RideCo file auto-processes; planners no longer need both files before loading data.
- RideCo parsing lives in `utils/parsers/csvParsers.ts` and supports CSV plus workbook sheets, Excel numeric time values, label-based row detection, overnight shifts, skipped-column warnings, and import reports.
- RideCo imports open a planner review/apply step before replacing the active shift list.

### 3) Operations

STREETS-style operational reporting and dashboards live in:
- `components/Performance/`
- `utils/performance*.ts`
- scheduled/server aggregation in `functions/src/aggregator.ts` and related functions files

The Operations landing path reads metadata before requesting its compact overview payload. The system overview renders its dataset context, KPIs, action queue, and route scorecard before loading the Recharts-backed visualizations in `SystemOverviewCharts.tsx`, keeping chart parsing and layout out of the first useful paint. Detail views continue to read the requested route/date projection; monthly history downloads are capped at four concurrent Storage reads so wide custom ranges do not create an unbounded burst of downloads and JSON parsing.

Passenger load is consolidated in Ridership -> Passenger Flow by Stop; the standalone Load Profiles navigation surface has been removed. Schema-v14 heatmaps retain stable trip identity, vehicle ID, and applied capacity so same-time trips remain distinct and block inference can enforce fleet-specific limits. Team capacity settings live at `teams/{teamId}/performanceConfig/load`, are owner/admin-managed through the Ridership surface, and feed client imports, server ingest, history rebuilds, and current heatmap estimates. `utils/performanceRidershipStopProfile.ts` owns the opportunity-weighted confidence score and inference diagnostics; the chart must keep the rating, evidence mix, and actionable findings visible. The former tab's dedicated monthly read model remains temporarily as a backward-compatible API and repair path. Its compact projection is implemented in `utils/performanceLoadProfileView.ts` and mirrored in `functions/src/performanceLoadProfileView.ts`; keep their JSON contracts synchronized. Manual import and server auto-ingest still publish versioned files under `teams/{teamId}/performanceViews/load-profiles/` and atomically update `loadProfileMonthlyStoragePaths`. Legacy reads go through `sharedWorkspaceData`, which enforces Operations plus Load Profiles access and bounded route/date scope. Do not add new UI dependencies on this projection without an explicit migration decision.

Transit On Demand activity is loaded once in the Ridership module alongside fixed-route stop activity. `functions/src/todDailyKpi.ts` owns authenticated email auto-ingest, workbook parsing, raw-workbook archival, read-before-write protection, and optimistic active-pointer replacement. Power Automate supplies the previous Toronto calendar day because the workbook contains no trustworthy service date. The client reads those daily reports through `utils/todPickupService.ts`, aggregates only the Ridership period's included service dates, and renders a dedicated Activity/Pickups/Drop-offs card immediately below the Stop Activity Map. `utils/todPickupAggregation.ts` also merges numeric TOD stop IDs into matching fixed-route stops for the combined map: pickups add to boardings, drop-offs add to alightings, and unmatched TOD locations remain standalone points. Activity is the default view. TOD is not attributed to fixed routes and has no hourly or prior-period detail, so it is deliberately omitted whenever a fixed route, hourly range, or change view is selected. Manual daily workbook and legacy monthly CSV uploads are no longer exposed; retained monthly datasets remain read-only compatibility data and are not rendered.

TOD zone assignment is a separate planning layer within that same activity card. `utils/todZones/` owns effective-version selection, boundary-inclusive point-in-polygon assignment, explicit connection-stop membership, explicit stop overrides, City GIS stop loading, GeoJSON interchange, the four-pocket Zone A and Zone B seeds, the one-time mutable-draft schema migration, and Firestore persistence. `TodZoneEditor.tsx` is the manager-only fullscreen drawing and validation surface; `TodActivityMap.tsx` renders the applicable published polygons and connection-stop symbols below activity points and exposes zone, multi-zone, and unassigned filters. Each selected service date is classified with its effective published version, while the visible overlay uses the latest applicable version and discloses when a period spans multiple versions. Zone grouping never creates route, hourly, comparison, or additive ridership evidence that the source does not contain. The durable behavior contract is `docs/TOD_ZONES.md`.

Dwell Incident Review is an incident-first operations workflow. Stored detection and exposure metrics are built by the client/server aggregators, the shared queue/pattern/operator view model lives in `utils/performanceDwellReview.ts`, and `components/Performance/OperatorDwellModule.tsx` renders the queue and patterns while incident-level same-trip and later-block evidence opens in a map-first dwell detail view. The map acts as the spatial incident timeline with compact milestone overlays and progressive disclosure for supporting evidence. The standalone aggregate cascade dashboard is legacy UI; downstream analysis belongs inside incident detail.

### 4) Parking

Shared department parking-code usage review lives in:
- `components/workspaces/ParkingWorkspace.tsx`
- `components/workspaces/ParkingDataWorkspace.tsx`
- `utils/parking/`

`ParkingWorkspace.tsx` is the lightweight card-dashboard and routing shell. It does not read Parking data or load the chart, map, workbook-parser, or export implementation. Selecting Plate Monitor or Parking Lot Data lazy-loads `ParkingDataWorkspace.tsx`; Plate Monitor downloads only the department-code payload, while Parking Lot Data downloads both department-code and revenue payloads because it exposes both analyses. Workbook parsing and export dependencies load only when the planner imports or exports a file.

The Parking workspace opens to a card dashboard, similar to Fixed Route Operations, with separate Plate Monitor and Parking Lot Data workspaces. Parking Lot Data is a Route Planner-style full-screen map-first shell for Parking Revenue analytics: it imports and auto-saves HotSpot app and QR revenue workbooks as source-aware monthly datasets, ships with bundled City ParkingLatLong lot coordinates/spaces as default reviewed map locations, can refresh those mappings from a newer City lat/lng workbook, stores normalized row-level data in team Storage, keeps reviewed source-ID mappings and map locations in Firestore settings, uses public City of Barrie parking GIS locations as map-only fallback coordinates until reviewed locations are saved, and summarizes revenue, sessions, stay length, peak periods, location comparisons, category comparisons across the requested operating metrics, and estimated capacity utilization with monthly trend views. Parking staff can maintain editable revenue category labels in settings; seeded categories are Downtown, Waterfront, Hybrid, Marina, Hospital, Allandale GO, and Special Events. A revenue mapping can be a physical parking location or an intentionally non-spatial group. HotSpot and QR ID `9000` are seeded as the same non-spatial Special Events group: those rows participate in revenue, session, category, source, and time/trend analysis, but the group has no map pin and is excluded from capacity-derived metrics and spatial map-coverage denominators. Year/month/category/uploader/day/source/hour filters drive both map and analysis views, and single-month trend views switch to daily trend data. Map pins may group multiple source IDs for the same physical lot, but distinct nearby lots or on-street parking areas must remain separate rather than distance-clustered. Public-source matches are treated as normal map pins in the UI rather than user-facing unmapped warnings. The older department-code usage import remains in Parking Lot Data for department summaries. Plate Monitor reviews the derived plate-level pattern flags and indicator thresholds; its annual department matrix shows both discount value and use count, and every value, including monthly and annual totals, opens the matching raw observations for Excel or PDF export.

### 5) Planning-data / analytics surfaces

Broader planning and analysis tools mostly live under `components/Analytics/` plus matching domain folders in `utils/`.

Visible workspace access is controlled by `utils/workspaceAccess.ts`. Global feature flags decide whether a feature exists in the build; user/team workspace access decides whether the current user can see and enter it. Signed-in ordinary users without a team member record, or with the `none` profile, see only the blocking Team Management setup flow until access is granted. A `schedulerAdmin` account can enter Team Management without joining a home team and automatically receives the `internal` workspace profile when it does belong to a home team. Developer support uses one expiring team-scoped session for other teams: `inspect` grants cross-team reads, while `edit` grants cross-team writes for up to 60 minutes and requires an audited reason. The selected team/member surface changes only in `useTeam()` and never rewrites `users/{uid}.teamId`. Team Management's Data Sources tab can point partner teams at separate read-only Transit App, STREETS, and Master Schedule sources through `teams/{teamId}.dataSourceTeamIds`; aggregate Transit App/STREETS reads use `sharedWorkspaceData`, while Master Schedule reads use the existing Firestore/Storage shared-source rules. External agency teams should be onboarded through the partner-team invite-link flow; use the `2027–2032 Strategic Plan only` package for embedded read-only strategic evidence, `Transit App Data only` when a team should see only the standalone Transit App workspace, or `Transit App + STREETS Dashboard` for WATT-style access.

Notable areas:
- Ridership Trends → `components/Analytics/RidershipTrendsWorkspace.tsx`, `utils/ridership-trends/`; a Friendly Design, graph-led Planning Data view that combines a generated workbook baseline through July 2026 with a compact long-lived daily STREETS boarding projection from August 2026 onward. Automatic and manual performance publishers replace the projection pointer with the rest of the performance generation so detailed 380-day retention cannot erase annual history. The durable contract is `docs/RIDERSHIP_TRENDS.md`.
- Detour Publisher → `components/workspaces/DetourPublisherWorkspace.tsx`, `components/detours/`, and `utils/detours/`; a Scheduled Transit subworkspace with team-scoped notice persistence, GTFS-snapshot overlays, Mapbox authoring, PDF/PNG/web-copy export, and manual MyRide posting records. It reads current route data without modifying schedule or GTFS sources.
- Transit App analytics → `components/Analytics/TransitApp*`, `utils/transit-app/`
- OD analysis → `components/Analytics/OD*`, `utils/od-matrix/`
- Fleet Plan → `components/Analytics/FleetPlan*.tsx`, `utils/fleet-plan/`; imports the legacy three-tab Excel template, but the app/editor and export present one combined Fleet Plan sheet with a Bus Type column. The active plan is team-shared, versioned under `fleetPlan/default/versions`, and writable only by team owners/admins.
- Legacy Route Planner workspace has been removed; old docs live in `docs/route-planner-legacy/` as background only, and remaining `utils/route-planner/` helpers are legacy support code used by Shuttle Planner.
- Camp Shuttle Planner (`Route Planner 2` internally) → `components/Analytics/RoutePlanner2Workspace.tsx`; the working Camp and address-based shuttle tool is frozen from Route Concept Planner work; current docs live in `docs/route-planner-2/`
- Route Concept Planner → a separate internal-beta, map-first workspace under `components/Analytics/` with a neutral domain/persistence layer under `utils/route-concept-planner/`; it models complete alternatives and may reuse GTFS, Mapbox, and map capabilities only through neutral adapters. Its contract lives in `docs/route-concept-planner/`.
- Shuttle Planner → `components/Analytics/ShuttlePlannerWorkspace.tsx`, `utils/shuttle/`
- Network Connections → `components/Analytics/NetworkConnectionsWorkspace.tsx`, `utils/network-connections/`
- 2027–2032 Strategic Plan → `components/Analytics/StrategicPlanWorkspace.tsx`, `utils/strategic-plan/`; a card-led evidence library whose source workspaces expose the read-only static-GTFS baseline, complete canonical Transit App aggregate, current canonical Fleet Plan, and canonical published Master Schedule. `hooks/useTransitAppData.ts`, `TransitAppAnalysisView`, `fleetPlanService`, and a read-only `MasterScheduleBrowser` are reused, so the plan creates no duplicate dataset, workbook, or schedule snapshot. `utils/strategic-plan/fleetPlanEvidence.ts` derives only the 2027–2032 presentation from the loaded workbook. Strategic-only users cannot import Transit App data, edit Fleet Plan records, modify schedules, or open the standalone source workspaces.
- Corridor Performance → compatibility UI entry point `components/Mapping/CorridorSpeedMap.tsx`, evidence/provenance/presentation modules under `utils/corridor-performance/`, and the current trip-linked traversal adapter in `utils/gtfs/corridorSpeed.ts`; its durable contract is `docs/CORRIDOR_PERFORMANCE.md`
- student-pass planning → `components/Analytics/StudentPass*`
- Residential Growth → `components/Analytics/ResidentialGrowthWorkspace.tsx`, `utils/residential-growth/`; imports monthly Issuance Listing and Certificate of Occupancy Excel reports, maps issued/planned and occupied/completed residential units as separate Mapbox tabs, and stores team-scoped planning datasets.

---

## Source layout by responsibility

### UI and workspace composition

Primary UI folders:
- `components/workspaces/` → top-level app shells
- `components/NewSchedule/` → fixed-route wizard
- `components/schedule/` → schedule tables and display primitives
- `components/Performance/` → operations dashboards
- `components/Analytics/` → planning-data tools
- `components/Reports/` → brochure/report outputs
- `components/modals/` → reusable operational dialogs
- `components/layout/`, `components/ui/`, `components/shared/` → shared app structure and UI pieces

### Domain logic and services

Primary logic folders:
- `utils/schedule/` → generation, editing helpers, draft adapters
- `utils/blocks/` → block assignment
- `utils/parsers/` → Excel/CSV parsing
- `utils/gtfs/` → GTFS import and lookup
- `utils/connections/` → connection models and optimization
- `utils/platform/` → platform conflict logic
- `utils/newSchedule/` → Step 2 and related wizard-specific analysis logic
- `utils/services/` → Firestore/Storage CRUD and workflow helpers
- `utils/ai/` → optimization and AI review support
- `utils/transit-app/`, `utils/od-matrix/`, `utils/route-planner-2/`, `utils/shuttle/` → specialized planning domains
- `utils/route-planner/` → legacy Route Planner utility layer retained only where still needed by Shuttle Planner

### Backend/runtime surfaces

- `api/` → canonical request handlers used by local/dev and serverless surfaces where possible
- `functions/src/` → Firebase Cloud Functions
- `vite.config.ts` → dev middleware wiring

### Tests

- `tests/` contains unit, integration, and selected UI tests
- coverage is strongest around schedule generation, block assignment, parsing, GTFS helpers, connection logic, performance aggregation, and selected workspace flows

---

## Key files to know first

These are the fastest entry points for understanding the codebase:

### App shell and navigation
- `App.tsx`
- `components/layout/Header.tsx`
- `utils/features.ts`

### Fixed Route
- `components/workspaces/FixedRouteWorkspace.tsx`
- `components/NewSchedule/NewScheduleWizard.tsx`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`
- `utils/schedule/scheduleGenerator.ts`
- `utils/blocks/blockAssignmentCore.ts`
- `utils/parsers/masterScheduleParserV2.ts`
- `utils/services/draftService.ts`
- `utils/services/publishService.ts`

### Operations
- `components/workspaces/OperationsWorkspace.tsx`
- `components/Performance/PerformanceWorkspace.tsx`
- `components/Performance/PerformanceDashboard.tsx`
- `utils/performanceDataAggregator.ts`
- `functions/src/aggregator.ts`

### Planning-data / analytics
- `components/Analytics/AnalyticsDashboard.tsx`
- `components/Analytics/TransitAppWorkspace.tsx`
- `components/Analytics/FleetPlanWorkspace.tsx`
- `components/Analytics/RoutePlanner2Workspace.tsx`
- `components/Analytics/NetworkConnectionsWorkspace.tsx`

---

## Core fixed-route flow map

### Create from runtime data
`CSV import → parser/utilities → runtime analysis / Step 2 review → schedule generator → draft save → editor/review → publish`

Key files:
- `utils/parsers/csvParsers.ts`
- `utils/ai/runtimeAnalysis.ts`
- `utils/newSchedule/`
- `utils/schedule/scheduleGenerator.ts`
- `utils/services/newScheduleProjectService.ts`
- `utils/services/draftService.ts`
- `utils/services/publishService.ts`

### Import from GTFS
`GTFS feed → api/gtfs → gtfs import service → draft save → editor/review → publish`

Key files:
- `api/gtfs.ts`
- `utils/gtfs/gtfsImportService.ts`
- `utils/services/draftService.ts`

### Import from Excel master schedule
`Excel file → master schedule parser → draft/master workflow`

Key files:
- `utils/parsers/masterScheduleParser.ts`
- `utils/parsers/masterScheduleParserV2.ts`

### Operations reporting
`STREETS import → parser/aggregator → Firestore + Storage → performance dashboard + reports`

Key files:
- `utils/performanceDataParser.ts`
- `utils/performanceDataAggregator.ts`
- `utils/performanceSnapshotService.ts`
- `components/Performance/`
- `functions/src/aggregator.ts`

---

## Fragile and high-risk areas

Treat these as danger zones:
- `utils/schedule/scheduleGenerator.ts`
- `utils/blocks/blockAssignmentCore.ts`
- `utils/timeUtils.ts`
- `utils/parsers/masterScheduleParser.ts`
- `utils/parsers/masterScheduleParserV2.ts`
- `utils/gtfs/gtfsImportService.ts`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`

Also watch large orchestration files where local changes can have wide UI effects:
- `components/workspaces/OnDemandWorkspace.tsx`
- `components/workspaces/FixedRouteWorkspace.tsx`
- `components/MasterScheduleBrowser.tsx`
- `components/Analytics/TransitAppMap.tsx`
- `utils/transit-app/transitAppAggregator.ts`

If you touch locked logic, load `docs/rules/LOCKED_LOGIC.md`, then the relevant Tier 2 docs, before editing.

---

## Testing map

Representative coverage areas in `tests/`:

- **Schedule generation** → `scheduleGenerator.*.test.ts`
- **Block assignment** → `blockAssignmentCore.test.ts`, `blockStartDirection.test.ts`
- **Parsing** → parser and route inference tests
- **Time logic** → `timeUtils.test.ts`
- **Connections** → connection utility and optimizer tests
- **GTFS** → direction, schedule index, and GO service tests
- **Performance** → aggregation/import sync tests
- **Transit App / analytics** → aggregator, parser, scoring, and pipeline tests
- **Workspace/UI flows** → selected tests for Add Trip, Extend Trip, resume, connections, and performance import behavior
- **On-Demand imports** → `rideCoParser.test.ts` covers RideCo/MVT row detection, Excel numeric times, workbook-sheet selection, and skipped-column reports
- **Camp Shuttle Planner** (`Route Planner 2` internally) → route authoring, road snapping, map export, stop-time labels, and workspace local-state tests cover the current map-first workflow

Do not assume every large UI surface has deep coverage. For fragile planner-facing workflows, manual verification is still important.

---

## Maintenance rules for this document

- Keep this file focused on durable structure, ownership, major flows, and navigation.
- Do not turn it back into an exhaustive inventory or a dated handoff log.
- When a feature ships, add only the files and flows that future repo navigation truly needs.
- Put collections, storage paths, and type-location detail in `docs/SCHEMA.md`, not here.
- Put locked behavioral rules in `docs/rules/LOCKED_LOGIC.md`, not here.
