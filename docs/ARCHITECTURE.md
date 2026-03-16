# Architecture

> Last reviewed: March 14, 2026
> Load order: start with `AGENTS.md`, then `docs/CONTEXT_INDEX.md`, before using this file as agent context.

## Overview

The Barrie Transit Schedule Builder uses a **Draft → Publish** workflow with a single data type (`MasterScheduleContent`) across all views.
This file is a selective architecture map, not an exhaustive file inventory. Prefer `rg --files` for full discovery, and treat line counts here as approximate.

```
┌─────────────────┐         ┌─────────────────┐
│  DRAFT          │         │  PUBLISHED      │
│  SCHEDULES      │────────►│  MASTER         │
│                 │ Publish │                 │
│  Work in        │         │  Final source   │
│  progress       │         │  of truth       │
│  Editable       │         │  Read-only      │
└─────────────────┘         └─────────────────┘
        ▲                           │
        └───────────────────────────┘
              "Copy to Draft"
```

**Stack:** Vite + React 19 + TypeScript + Firebase + Tailwind CSS | Port 3008

---

## Source File Map

### components/

```
components/
├── ScheduleEditor.tsx              # ★ Core editor (1,634 lines) — DANGER ZONE
├── MasterScheduleBrowser.tsx       # Browse published schedules (1,689 lines)
├── GTFSImport.tsx                  # GTFS feed import UI (849 lines)
├── PlatformTimeline.tsx            # Platform occupancy timeline (1,319 lines)
├── PlatformConfigEditor.tsx        # Edit terminal platform config (402 lines)
├── FileManager.tsx                 # File upload/management (568 lines)
├── TeamManagement.tsx              # Team member/role management (478 lines)
├── TravelTimeGrid.tsx              # Segment travel time editor (460 lines)
├── GapChart.tsx                    # Headway gap visualization (369 lines)
├── ShiftEditor.tsx                 # Driver shift editing (263 lines)
├── RouteSummary.tsx                # Per-route trip/block summary cards
├── OTPAnalysis.tsx                 # Legacy OTP analysis view
├── AuditLogPanel.tsx               # Audit log viewer
├── VersionHistoryPanel.tsx         # Draft version history
├── SummaryCards.tsx                # High-level KPI cards
├── ErrorBoundary.tsx               # React error boundary
├── FileUpload.tsx                  # Drag-and-drop upload widget
│
├── workspaces/                     # ═══ Top-Level Workspaces ═══
│   ├── FixedRouteWorkspace.tsx     # Fixed-route scheduling root (719 lines)
│   ├── OnDemandWorkspace.tsx       # On-demand service analysis (946 lines)
│   ├── OperationsWorkspace.tsx     # Operations dashboard routing
│   ├── ReportsWorkspace.tsx        # Reports workspace root
│   ├── ScheduleEditorWorkspace.tsx # Schedule editor wrapper with sidebar
│   └── SystemDraftEditorWorkspace.tsx # System-wide draft editor
│
├── NewSchedule/                    # ═══ 5-Step Wizard ═══
│   ├── NewScheduleWizard.tsx       # Wizard orchestrator (1,260 lines)
│   ├── NewScheduleHeader.tsx       # Step progress bar (394 lines)
│   ├── ProjectManagerModal.tsx     # Manage saved projects
│   ├── ResumeWizardModal.tsx       # Resume interrupted projects
│   ├── SegmentTimeEditor.tsx       # Edit segment travel times
│   ├── TimelineView.tsx            # Visual trip timeline (413 lines)
│   ├── TripContextMenu.tsx         # Right-click trip actions
│   ├── QuickActionsBar.tsx         # Toolbar shortcuts
│   ├── steps/
│   │   ├── Step1Upload.tsx         # Upload CSV runtime data
│   │   ├── Step2Analysis.tsx       # Analyze runtimes, assign bands (548 lines)
│   │   ├── Step3Build.tsx          # Configure cycle/headway (868 lines)
│   │   ├── Step4Schedule.tsx       # Generate and preview trips
│   │   └── Step5Connections.tsx    # Connection optimization (792 lines)
│   └── connections/
│       ├── AddTargetModal.tsx      # Create connection target (744 lines)
│       ├── ConnectionAddChooser.tsx
│       ├── ConnectionLibraryPanel.tsx # Browse connection library (716 lines)
│       ├── ImportRouteModal.tsx
│       ├── OptimizationPanel.tsx
│       └── RouteConnectionPanel.tsx
│
├── schedule/                       # ═══ Schedule Display ═══
│   ├── RoundTripTableView.tsx      # ★ Paired N+S table (1,966 lines) — DANGER ZONE
│   ├── SingleRouteView.tsx         # Single direction table (427 lines)
│   ├── ConnectionIndicator.tsx     # Connection status dots
│   └── ConnectionBadge.tsx         # Connection labels
│
├── connections/                    # ═══ Editor Connection Panel ═══
│   ├── ConnectionsPanel.tsx        # Library management in editor (524 lines)
│   └── ConnectionStatusPanel.tsx   # Connection status overview
│
├── Performance/                    # ═══ Operations Performance ═══
│   ├── PerformanceWorkspace.tsx    # Workspace root
│   ├── PerformanceDashboard.tsx    # Tab router (Overview, OTP, Ridership, Load, Reports)
│   ├── PerformanceFilterBar.tsx    # Date/route/direction filters
│   ├── PerformanceImport.tsx       # STREETS CSV import (324 lines)
│   ├── SystemOverviewModule.tsx    # Fleet-wide KPIs (909 lines)
│   ├── OTPModule.tsx               # On-time performance heatmap/scatter
│   ├── RidershipModule.tsx         # Ridership trends and charts
│   ├── RidershipHeatmapSection.tsx # Ridership heatmap by hour/day (532 lines)
│   ├── LoadProfileModule.tsx       # Passenger load curves by stop (383 lines)
│   ├── StopActivityMap.tsx         # Geographic stop activity map (760 lines)
│   ├── ReportsModule.tsx           # Reports tab container
│   └── reports/
│       ├── RoutePerformanceReport.tsx  # Detailed route report (480 lines)
│       ├── WeeklySummaryReport.tsx     # Weekly summary report (461 lines)
│       ├── DateRangePicker.tsx         # Date range selection
│       └── AIQueryPanel.tsx            # Gemini natural-language queries
│
├── Analytics/                      # ═══ Transit App & OD Analysis ═══
│   ├── TransitAppWorkspace.tsx     # Transit app workspace container
│   ├── TransitAppDashboard.tsx     # Transit app data dashboard
│   ├── TransitAppImport.tsx        # Transit app data import wizard (413 lines)
│   ├── TransitAppMap.tsx           # ★ Leaflet analytics map (1,876 lines)
│   ├── AnalyticsDashboard.tsx      # Top-level analytics tab router
│   ├── ODMatrixWorkspace.tsx       # OD matrix workspace
│   ├── ODMatrixImport.tsx          # OD matrix CSV import (733 lines)
│   ├── ODFlowMapModule.tsx         # Origin-destination flow map (654 lines)
│   ├── ODRouteEstimationModule.tsx # Route matching and transfer analysis
│   ├── ODCoordinateEditor.tsx      # Edit geocoded stop coords (501 lines)
│   ├── DemandModule.tsx            # Ridership demand analysis (413 lines)
│   ├── ServiceGapsModule.tsx       # Service gap detection (380 lines)
│   ├── CoverageGapMap.tsx          # Route coverage gaps map (371 lines)
│   ├── HeatmapModule.tsx           # Ridership heatmap (315 lines)
│   ├── RoutePerformanceModule.tsx  # Route-level analytics
│   ├── TransfersModule.tsx         # Transfer pattern analysis (929 lines)
│   ├── ODHeatmapGridModule.tsx     # OD matrix heatmap grid
│   ├── StopAnalysisModule.tsx      # Per-stop boarding/alighting
│   ├── ODTopPairsModule.tsx        # Top OD pairs table
│   ├── ODStationRankingsModule.tsx # Station-level rankings
│   ├── ODOverviewPanel.tsx         # OD data overview
│   ├── OverviewPanel.tsx           # Transit app overview
│   ├── AppUsageModule.tsx          # Transit app usage stats
│   ├── StudentPassModule.tsx       # Student transit pass planner + PDF export
│   ├── ShuttlePlannerWorkspace.tsx # Shuttle planning workspace shell in Planning Data
│   ├── StudentPassMap.tsx          # Student pass map rendering
│   ├── StudentPassTimeline.tsx     # Student pass timeline view
│   └── AnalyticsShared.tsx         # Shared analytics types/helpers
│
├── Reports/                        # ═══ Reports & Export ═══
│   ├── PublicTimetable.tsx         # jsPDF brochure generator (1,302 lines)
│   └── ReportsDashboard.tsx        # Reports landing page
│
├── contexts/                       # ═══ React Contexts ═══
│   ├── AuthContext.tsx             # Firebase auth provider
│   ├── TeamContext.tsx             # Active team provider
│   └── ToastContext.tsx            # Toast notifications
│
├── modals/                         # ═══ Modal Dialogs ═══
│   ├── AddTripModal.tsx            # Add trip to schedule (314 lines)
│   ├── AuthModal.tsx               # Login/register (234 lines)
│   ├── BulkUploadToMasterModal.tsx # Batch publish (286 lines)
│   ├── UploadToMasterModal.tsx     # Single publish
│   ├── OptimizationReviewModal.tsx # AI optimization results (366 lines)
│   ├── ShiftEditorModal.tsx        # Full-screen shift editor (441 lines)
│   └── FocusPromptModal.tsx        # Gemini prompt editor
│
├── layout/                         # ═══ App Layout ═══
│   ├── Header.tsx                  # Top navigation
│   ├── ScheduleSidebar.tsx         # Left sidebar with schedule list
│   ├── SystemDraftList.tsx         # System-wide draft list
│   └── WorkspaceHeader.tsx         # Workspace title bar
│
└── ui/                             # ═══ Shared UI ═══
    ├── Modal.tsx                   # Reusable modal wrapper
    ├── CascadeModeSelector.tsx     # Cascade edit mode selector
    └── StackedTimeInput.tsx        # Stacked ARR/DEP time input
```

### utils/

```
utils/
├── # ROOT — Shared types, Firebase, performance data
├── firebase.ts                         # Firebase app init (26 lines)
├── timeUtils.ts                        # ★ Time parsing/formatting — DANGER ZONE (99 lines)
├── masterScheduleTypes.ts              # MasterSchedule/MasterTrip types (145 lines)
├── demandTypes.ts                      # On-demand service types
├── demandConstants.ts                  # On-demand service constants
├── dataGenerator.ts                    # Synthetic schedule data generator (308 lines)
├── performanceDataAggregator.ts        # Aggregate perf data into metrics (863 lines)
├── performanceDataParser.ts            # Parse STREETS CSV uploads (335 lines)
├── performanceDataService.ts           # Firestore CRUD for perf data
├── performanceDataTypes.ts             # Performance data types (303 lines)
├── performanceDateUtils.ts             # Date helpers for perf queries
├── performanceSnapshotService.ts       # Snapshot persistence
├── performanceSnapshotTypes.ts         # Snapshot types
│
├── schedule/                           # ═══ Schedule Generation & Editing ═══
│   ├── scheduleGenerator.ts            # ★ Trip generation — LOCKED/DANGER ZONE (590 lines)
│   ├── scheduleEditorUtils.ts          # Editor mutation helpers (410 lines)
│   ├── scheduleDraftAdapter.ts         # Draft ↔ editor format conversion
│   ├── scheduleInsights.ts             # Schedule summary calculations
│   └── scheduleTypes.ts               # Schedule domain types
│
├── blocks/                             # ═══ Block Assignment ═══
│   ├── blockAssignment.ts              # Block assignment orchestrator (536 lines)
│   └── blockAssignmentCore.ts          # ★ Gap-based matching — LOCKED/DANGER ZONE (517 lines)
│
├── parsers/                            # ═══ File Parsing ═══
│   ├── masterScheduleParser.ts         # ★ V1 parser — DANGER ZONE (900 lines)
│   ├── masterScheduleParserV2.ts       # ★ V2 parser — DANGER ZONE (875 lines)
│   ├── parserAdapter.ts               # Routes between V1/V2 parsers (327 lines)
│   ├── csvParsers.ts                   # Generic CSV/Excel utilities (337 lines)
│   ├── scheduleParser.ts              # Runtime schedule CSV parser
│   └── otpParser.ts                   # OTP data CSV parser
│
├── gtfs/                               # ═══ GTFS Import & Lookup ═══
│   ├── gtfsImportService.ts            # ★ Full GTFS pipeline — DANGER ZONE (1,573 lines)
│   ├── goTransitService.ts             # GO Transit live GTFS feed (716 lines)
│   ├── gtfsScheduleIndex.ts            # GTFS schedule lookup index (583 lines)
│   ├── gtfsShapesLoader.ts            # GTFS shapes.txt loader
│   ├── gtfsStopLookup.ts             # Stop name/ID fuzzy lookup
│   └── gtfsTypes.ts                   # GTFS type definitions (336 lines)
│
├── connections/                        # ═══ Connection Library ═══
│   ├── connectionLibraryService.ts     # Firestore CRUD for targets (432 lines)
│   ├── connectionOptimizer.ts          # Connection window optimization (793 lines)
│   ├── connectionUtils.ts             # Matching/scoring helpers (238 lines)
│   ├── connectionTypes.ts             # Connection type definitions (330 lines)
│   └── connectionLibraryUtils.ts      # Library helper utilities
│
├── platform/                           # ═══ Platform Conflict Detection ═══
│   ├── platformConfig.ts              # Hub/platform configurations (317 lines)
│   ├── platformAnalysis.ts            # Platform occupancy analysis
│   ├── conflictEngine.ts             # Conflict detection engine
│   ├── dwellEventBuilder.ts          # Build dwell events from trips
│   ├── platformConfigService.ts       # Firestore-backed config
│   ├── platformMatcher.ts            # Match trips to platform slots
│   ├── time.ts                        # Platform-domain time utilities
│   └── types.ts                       # Platform type definitions
│
├── config/                             # ═══ Route Configuration ═══
│   ├── routeDirectionConfig.ts         # Per-route direction/suffix config (524 lines)
│   ├── routeNameParser.ts             # Route name/suffix parsing
│   └── routeColors.ts                 # Route color palette
│
├── services/                           # ═══ Firebase Services ═══
│   ├── masterScheduleService.ts        # Master schedule Firestore access (706 lines)
│   ├── dataService.ts                 # Core Firestore data operations (570 lines)
│   ├── teamService.ts                 # Team/member management (382 lines)
│   ├── newScheduleProjectService.ts   # Wizard project persistence (310 lines)
│   ├── systemDraftService.ts          # System-wide draft management (283 lines)
│   ├── draftService.ts               # Draft lifecycle CRUD
│   ├── publishService.ts             # Draft → published workflow
│   └── exportService.ts              # Schedule export (CSV/Excel)
│
├── ai/                                 # ═══ AI Integration ═══
│   ├── runtimeAnalysis.ts             # Time band analysis (274 lines)
│   ├── performanceQueryService.ts     # AI performance queries
│   └── geminiOptimizer.ts             # Gemini optimize client (fast full, multi-phase refine)
│
├── transit-app/                        # ═══ Transit App Data ═══
│   ├── transitAppAggregator.ts         # Data aggregation engine (1,669 lines)
│   ├── transitAppTransferAnalysis.ts   # Transfer pattern analysis (881 lines)
│   ├── transitAppTypes.ts             # Transit app types (634 lines)
│   ├── transitAppParsers.ts           # Export format parsing (465 lines)
│   ├── transitAppGtfsNormalization.ts # GTFS data normalization (381 lines)
│   ├── transitAppService.ts           # Firestore CRUD
│   ├── transitAppPlannerRules.ts      # Planner rule evaluations
│   └── transitAppScoring.ts           # Route/stop scoring
│
├── od-matrix/                          # ═══ Origin-Destination Analysis ═══
│   ├── odMatrixGeocoder.ts            # Nominatim geocoding for OD stops (502 lines)
│   ├── odMatrixParser.ts             # OD matrix CSV/Excel parser
│   ├── odMatrixService.ts            # Firestore CRUD for OD data
│   ├── coordinateParsing.ts          # Geocoordinate normalization
│   └── odMatrixTypes.ts              # OD matrix types
│
└── workspaces/
    └── fixedRouteDraftState.ts         # Fixed-route draft state helpers
```

### hooks/

```
hooks/
├── useScheduleWizard.ts           # ★ Wizard state management (434 lines)
├── useScheduleEditing.ts          # Editor state management (392 lines)
├── useGridNavigation.ts           # Keyboard grid navigation (373 lines)
├── useAutoSave.ts                 # Debounced auto-save to Firestore (358 lines)
├── useUploadToMaster.ts           # Upload draft to master workflow (264 lines)
├── useAddTrip.ts                  # Add trip mutation with undo (235 lines)
├── useTravelTimeGrid.ts           # Travel time grid data (230 lines)
├── useUndoRedo.ts                 # Generic undo/redo stack
├── useTimeValidation.ts           # Time input validation
├── useWizardProgress.ts           # Wizard step tracking
└── usePlatformConfig.ts           # Load/subscribe platform config
```

### API & Cloud Functions

```
api/                                # Vite dev-server API middleware
├── optimize.ts                    # Gemini optimization endpoint parity for local dev
├── gtfs.ts                        # GTFS proxy endpoint (247 lines)
├── security.ts                    # API auth/security middleware (196 lines)
├── parse-schedule.ts              # Schedule parsing endpoint
├── download-file.ts               # File download proxy
└── performance-query.ts           # Performance AI query endpoint

functions/src/                      # Firebase Cloud Functions
├── index.ts                       # Cloud Functions entry point (205 lines)
├── aggregator.ts                  # Scheduled performance aggregation (487 lines)
├── reportHtml.ts                  # HTML report template renderer (444 lines)
├── types.ts                       # Shared Cloud Functions types (232 lines)
├── parser.ts                      # Schedule parse Cloud Function
└── dailyReport.ts                 # Daily email report generator
```

### Tests

Representative coverage areas in `tests/`:

| Category | Files |
|----------|-------|
| **Schedule generation** | `scheduleGenerator.goldenPath.test.ts`, `.directionStart.test.ts`, `.floating.test.ts` |
| **Block assignment** | `blockAssignmentCore.test.ts`, `blockStartDirection.test.ts` |
| **Parsing** | `parser.test.ts`, `routeInference.test.ts` |
| **Time** | `timeUtils.test.ts` |
| **Connections** | `connectionUtils.test.ts` |
| **GTFS** | `gtfsDirection.test.ts`, `gtfsScheduleIndex.test.ts`, `goTransitService.test.ts` |
| **Platform** | `platformAnalysis.test.ts`, `platformConfig.test.ts` |
| **Performance** | `performanceDataAggregator.test.ts` |
| **Transit App** | `transitAppAggregator.*.test.ts` (5), `transitAppScoring.test.ts`, `transitAppParsers.test.ts`, `transitAppPipeline.e2e.test.ts` |
| **Draft/Adapter** | `scheduleDraftAdapter.test.ts`, `fixedRouteDraftState.test.ts` |
| **Other** | `odMatrixParser.test.ts`, `apiSecurity.test.ts`, `studentPassTimeline.test.tsx` |

★ = Critical files with locked logic or high complexity

---

## Data Model

### Core Types

```typescript
interface MasterScheduleContent {
  northTable: MasterRouteTable;
  southTable: MasterRouteTable;
  metadata: ScheduleMetadata;
}

interface MasterRouteTable {
  routeName: string;           // e.g., "Route 100 (North)"
  stops: string[];             // Ordered stop names
  stopIds: Record<string, string>;
  trips: MasterTrip[];
}

interface MasterTrip {
  tripId: string;
  blockId: string;
  times: Record<string, string>;  // Stop name → time (HH:MM)
  travelTime: number;
  recoveryTime: number;
  cycleTime: number;
  direction: 'North' | 'South' | 'Loop';
}

type DayType = 'Weekday' | 'Saturday' | 'Sunday';
```

### Draft Schedule

```typescript
interface DraftSchedule {
  id: string;
  name: string;
  routeNumber: string;
  dayType: DayType;
  content: MasterScheduleContent;
  status: 'draft' | 'ready_for_review';
  basedOn?: { type: 'master' | 'gtfs' | 'generated'; id?: string; };
}
```

### Published Schedule

```typescript
interface PublishedSchedule {
  id: string;                      // RouteIdentity: "{routeNumber}-{dayType}"
  routeNumber: string;
  dayType: DayType;
  content: MasterScheduleContent;
  version: number;
  publishedAt: Timestamp;
  history: PublishedVersion[];
}
```

---

## Route Configuration

### Route Direction Table

| Route | Type | North | South | Notes |
|-------|------|-------|-------|-------|
| 400 | Linear | 400 | 400 | RVH ↔ Park Place |
| 2 | Linear | 2A | 2B | A/B = direction |
| 7 | Linear | 7A | 7B | A/B = direction |
| 8A | Linear | 8A | 8A | Route variant |
| 8B | Linear | 8B | 8B | Route variant |
| 10 | Loop | CW | - | Clockwise |
| 11 | Loop | CCW | - | Counter-clockwise |
| 12 | Linear | 12A | 12B | A/B = direction |
| 100 | Loop | CW | - | Clockwise |
| 101 | Loop | CCW | - | Counter-clockwise |

**A/B Suffix Meaning:**
- Routes 2, 7, 12: A = North direction, B = South direction
- Routes 8A, 8B: Separate route variants (each has own NB + SB)

---

## Excel Parsing

### File Structure

| Element | Location | Description |
|---------|----------|-------------|
| Sheet | Each tab | One route per sheet |
| Stop Name row | Row with "Stop Name" in Col A/B | Stop names across columns |
| Stop ID row | Row with "Stop ID" | Stop IDs matching names |
| Trip data | Rows below Stop ID | Each row = one trip |
| Day sections | Sequential blocks | 1st=Weekday, 2nd=Saturday, 3rd=Sunday |

### Column Pattern

```
Col A    Col B        Col C onwards...
─────────────────────────────────────────────
         Stop Name    [Stop1]  R   [Stop2]  R
         Stop ID      [ID1]        [ID2]
[Day]    [TimeBand]   7:05 AM  1   7:13 AM  0
```

### Recovery Time (R columns)

- Position: Immediately after the stop they apply to
- Values: Integer minutes (not Excel time format)
- Duplicates: Parser names them `R`, `R (2)`, `R (3)`
- Zero values: Valid and preserved

### Day Type Detection

Day types determined by section order, not merged cells:

| Section | Day Type |
|---------|----------|
| 1st | Weekday |
| 2nd | Saturday |
| 3rd | Sunday |

---

## Key Files by Purpose

| Purpose | File | Notes |
|---------|------|-------|
| Trip generation | `utils/schedule/scheduleGenerator.ts` | LOCKED: segment rounding |
| Block assignment | `utils/blocks/blockAssignment.ts` + `blockAssignmentCore.ts` | LOCKED: gap-based chaining |
| Time parsing | `utils/timeUtils.ts` | Post-midnight: Excel >= 1.0 |
| CSV parsing | `utils/parsers/csvParsers.ts` | Runtime data import |
| Runtime analysis | `utils/ai/runtimeAnalysis.ts` | Time band detection |
| Excel parsing | `utils/parsers/masterScheduleParserV2.ts` | Master schedule import |
| GTFS import | `utils/gtfs/gtfsImportService.ts` | Full pipeline (1,573 lines) |
| Schedule display | `components/ScheduleEditor.tsx` | Core editor (1,634 lines) |
| Round-trip table | `components/schedule/RoundTripTableView.tsx` | 8A/8B custom sort |
| AI optimization | `api/optimize.ts` | Fast full regenerate, multi-phase refine |
| Connection library | `utils/connections/connectionLibraryService.ts` | Team-shared targets |
| Draft management | `utils/services/draftService.ts` | Draft CRUD |
| Publishing | `utils/services/publishService.ts` | Draft → Master |
| Route config | `utils/config/routeDirectionConfig.ts` | A/B suffix rules |
| Performance data | `utils/performanceDataAggregator.ts` | STREETS data aggregation |
| Transit App data | `utils/transit-app/transitAppAggregator.ts` | Transit App analytics |
| OD analysis | `utils/od-matrix/odMatrixGeocoder.ts` | OD demand geocoding |

---

## Firestore Structure

```
users/{userId}/
├── draftSchedules/{draftId}/          # Working schedule copies
├── newScheduleProjects/{projectId}/   # Wizard project state
└── files/{fileId}/                    # Uploaded file metadata

teams/{teamId}/
├── members/{userId}/                  # Team membership + roles
├── masterSchedules/{routeIdentity}/   # Published schedules
│   ├── versions/{versionId}/          # Version history
│   └── connectionConfig/default       # Route connection settings
├── connectionLibrary/default          # Shared connection targets
└── performanceData/                   # Performance data collections
    ├── dailySummaries/{date}          # Daily aggregated metrics
    └── snapshots/{snapshotId}         # Data snapshots
```

---

## Data Flow

```
CREATE (from CSV):
  Runtime CSV → csvParsers → runtimeAnalysis → scheduleGenerator → Draft

IMPORT (from GTFS):
  GTFS Feed → api/gtfs → gtfsImportService → Draft

IMPORT (from Excel):
  Excel file → masterScheduleParserV2 → Draft

EDIT:
  Published Master → Copy to Draft → ScheduleEditor → Publish

EXPORT:
  Published Master → PublicTimetable (PDF) or exportService (CSV)

PERFORMANCE:
  STREETS CSV → performanceDataParser → performanceDataAggregator → Firestore
  → PerformanceDashboard (OTP, Ridership, Load Profiles, Reports)
  → AI queries via Gemini (performanceQueryService)

TRANSIT APP:
  Transit App CSV → transitAppParsers → transitAppAggregator → Analytics views
  → OD matrix, route scoring, transfer analysis, service gap detection
```

---

## Maintenance Note

- Keep this file focused on durable structure, ownership, and major data flow.
- Do not treat exact file counts or exhaustive inventories as stable documentation.
- When a feature ships, add only the files and flows that matter for future navigation.
