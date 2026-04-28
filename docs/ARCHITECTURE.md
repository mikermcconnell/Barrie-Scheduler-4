# Architecture

> Last reviewed: April 20, 2026
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

Common app-wide infrastructure:
- auth context → `components/contexts/AuthContext.tsx`
- team context → `components/contexts/TeamContext.tsx`
- toast context → `components/contexts/ToastContext.tsx`
- global header → `components/layout/Header.tsx`
- feature flags → `utils/features.ts`
- workspace access profiles → `utils/workspaceAccess.ts`, surfaced through `hooks/useWorkspaceAccess.ts`

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

### 3) Operations

STREETS-style operational reporting and dashboards live in:
- `components/Performance/`
- `utils/performance*.ts`
- scheduled/server aggregation in `functions/src/aggregator.ts` and related functions files

### 4) Planning-data / analytics surfaces

Broader planning and analysis tools mostly live under `components/Analytics/` plus matching domain folders in `utils/`.

Visible workspace access is controlled by `utils/workspaceAccess.ts`. Global feature flags decide whether a feature exists in the build; user/team workspace access decides whether the current user can see and enter it.

Notable areas:
- Transit App analytics → `components/Analytics/TransitApp*`, `utils/transit-app/`
- OD analysis → `components/Analytics/OD*`, `utils/od-matrix/`
- Fleet Plan → `components/Analytics/FleetPlan*.tsx`, `utils/fleet-plan/`; imports the legacy three-tab Excel template, but the app/editor and export present one combined Fleet Plan sheet with a Bus Type column. The active plan is team-shared, versioned under `fleetPlan/default/versions`, and writable only by team owners/admins.
- Route Planner → `components/Analytics/RoutePlannerWorkspace.tsx`, `utils/route-planner/`
- Shuttle Planner → `components/Analytics/ShuttlePlannerWorkspace.tsx`, `utils/shuttle/`
- Network Connections → `components/Analytics/NetworkConnectionsWorkspace.tsx`, `utils/network-connections/`
- Route 8 sandbox → `components/Analytics/Route8SandboxWorkspace.tsx`, `utils/route8-sandbox/`
- student-pass planning → `components/Analytics/StudentPass*`

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
- `utils/transit-app/`, `utils/od-matrix/`, `utils/route-planner/`, `utils/route8-sandbox/`, `utils/shuttle/` → specialized planning domains

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
- `components/Analytics/RoutePlannerWorkspace.tsx`
- `components/Analytics/NetworkConnectionsWorkspace.tsx`
- `components/Analytics/Route8SandboxWorkspace.tsx`

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

Do not assume every large UI surface has deep coverage. For fragile planner-facing workflows, manual verification is still important.

---

## Maintenance rules for this document

- Keep this file focused on durable structure, ownership, major flows, and navigation.
- Do not turn it back into an exhaustive inventory or a dated handoff log.
- When a feature ships, add only the files and flows that future repo navigation truly needs.
- Put collections, storage paths, and type-location detail in `docs/SCHEMA.md`, not here.
- Put locked behavioral rules in `docs/rules/LOCKED_LOGIC.md`, not here.
