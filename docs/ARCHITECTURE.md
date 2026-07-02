# Architecture

> Last reviewed: June 18, 2026
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

---

## Top-level app shape

`App.tsx` is the main shell. It uses hash-based navigation and lazy-loads three top-level app views:

- **On-Demand** → `components/workspaces/OnDemandWorkspace.tsx`
- **Fixed Route** → `components/workspaces/FixedRouteWorkspace.tsx`
- **Operations** → `components/workspaces/OperationsWorkspace.tsx`
- **Parking** → `components/workspaces/ParkingWorkspace.tsx`
- **Planning Data** → `components/Analytics/AnalyticsDashboard.tsx`

Common app-wide infrastructure:
- auth context → `components/contexts/AuthContext.tsx`
- team context → `components/contexts/TeamContext.tsx`
- toast context → `components/contexts/ToastContext.tsx`
- global header → `components/layout/Header.tsx`
- feature flags → `utils/features.ts`
- workspace access profiles → `utils/workspaceAccess.ts`, surfaced through `hooks/useWorkspaceAccess.ts`
- named workspace access packages → `utils/workspaceAccessPackages.ts`, used by Team Management for safer onboarding presets
- Developer Preview Mode → `utils/developerPreview.ts`, applied in `components/contexts/TeamContext.tsx`

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

### 4) Parking

Shared department parking-code usage review lives in:
- `components/workspaces/ParkingWorkspace.tsx`
- `utils/parking/`

The Parking workspace opens to a card dashboard, similar to Fixed Route Operations, with separate Plate Monitor and Parking Lot Data workspaces. Parking Lot Data is a Route Planner-style full-screen map-first shell for Parking Revenue analytics: it imports and auto-saves HotSpot app and QR revenue workbooks as source-aware monthly datasets, ships with bundled City ParkingLatLong lot coordinates/spaces as default reviewed map locations, can refresh those mappings from a newer City lat/lng workbook, stores normalized row-level data in team Storage, keeps reviewed source-ID-to-lat/lng map locations in Firestore settings, uses public City of Barrie parking GIS locations as map-only fallback coordinates until reviewed locations are saved, and summarizes revenue, sessions, stay length, peak periods, and lot comparisons. Map pins may group multiple source IDs for the same physical lot, but distinct nearby lots or on-street parking areas must remain separate rather than distance-clustered. Public-source matches are treated as normal map pins in the UI rather than user-facing unmapped warnings. The older department-code usage import remains in Parking Lot Data for department summaries. Plate Monitor reviews the derived plate-level pattern flags and indicator thresholds.

### 5) Planning-data / analytics surfaces

Broader planning and analysis tools mostly live under `components/Analytics/` plus matching domain folders in `utils/`.

Visible workspace access is controlled by `utils/workspaceAccess.ts`. Global feature flags decide whether a feature exists in the build; user/team workspace access decides whether the current user can see and enter it. Signed-in users without a team member record, or with the `none` profile, see only the blocking Team Management setup flow until access is granted. The `parking` profile shows only the Parking workspace by default. Planning Data is a top-level app view whenever the user can access at least one analytics workspace, so Transit App-only external users do not need Scheduled Transit access. Global admins can use Team Management's Developer Access Wizard to pick a team, apply a named access package from `utils/workspaceAccessPackages.ts`, set the default invite-join profile, apply per-workspace overrides, adjust individual users, preview the app surface for that profile, enter Developer Preview Mode as that team/default or selected user, and copy the invite link. Team Management's Data Sources tab can point partner teams at read-only Transit App and STREETS source data through `teams/{teamId}.dataSourceTeamIds` and the `sharedWorkspaceData` Cloud Function. Developer Preview Mode changes only the in-memory `useTeam()` team/member surface; it does not update `users/{uid}.teamId`. External agency teams should be onboarded through the partner-team invite-link flow; use the `Transit App Data only` package when a team such as Lane Transit should see only Transit App Data, or `Transit App + STREETS Dashboard` for WATT-style access.

Notable areas:
- Transit App analytics → `components/Analytics/TransitApp*`, `utils/transit-app/`
- OD analysis → `components/Analytics/OD*`, `utils/od-matrix/`
- Fleet Plan → `components/Analytics/FleetPlan*.tsx`, `utils/fleet-plan/`; imports the legacy three-tab Excel template, but the app/editor and export present one combined Fleet Plan sheet with a Bus Type column. The active plan is team-shared, versioned under `fleetPlan/default/versions`, and writable only by team owners/admins.
- Legacy Route Planner workspace has been removed; old docs live in `docs/route-planner-legacy/` as background only, and remaining `utils/route-planner/` helpers are legacy support code used by Shuttle Planner.
- Route Planner 2 → `components/Analytics/RoutePlanner2Workspace.tsx`; fresh restart shell intentionally isolated from old Route Planner controllers/utilities; current docs live in `docs/route-planner-2/`
- Shuttle Planner → `components/Analytics/ShuttlePlannerWorkspace.tsx`, `utils/shuttle/`
- Network Connections → `components/Analytics/NetworkConnectionsWorkspace.tsx`, `utils/network-connections/`
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
- **Route Planner 2** → route authoring, road snapping, map export, stop-time labels, and workspace local-state tests cover the current map-first workflow

Do not assume every large UI surface has deep coverage. For fragile planner-facing workflows, manual verification is still important.

---

## Maintenance rules for this document

- Keep this file focused on durable structure, ownership, major flows, and navigation.
- Do not turn it back into an exhaustive inventory or a dated handoff log.
- When a feature ships, add only the files and flows that future repo navigation truly needs.
- Put collections, storage paths, and type-location detail in `docs/SCHEMA.md`, not here.
- Put locked behavioral rules in `docs/rules/LOCKED_LOGIC.md`, not here.
