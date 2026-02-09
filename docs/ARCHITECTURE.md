# Architecture

## Overview

The Barrie Transit Schedule Builder uses a **Draft → Publish** workflow with a single data type (`MasterScheduleContent`) across all views.

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

```
├── index.tsx                          # Entry point
├── App.tsx                            # React root, routing
├── types.ts                           # Global type definitions (2,140 lines)
├── constants.ts                       # Global constants (907 lines)
│
├── components/
│   ├── ScheduleEditor.tsx             # ★ Core editor (1,634 lines) - editing, connections, publishing
│   ├── ScheduleEditorWorkspace.tsx    # Editor wrapper with sidebar
│   ├── MasterScheduleBrowser.tsx      # Browse published schedules, copy to draft
│   ├── FixedRouteWorkspace.tsx        # Main workspace routing
│   ├── GTFSImport.tsx                 # GTFS feed import UI
│   │
│   ├── NewSchedule/                   # ═══ 5-Step Wizard ═══
│   │   ├── NewScheduleWizard.tsx      # Wizard orchestrator
│   │   ├── NewScheduleHeader.tsx      # Step progress bar
│   │   ├── ResumeWizardModal.tsx      # Resume interrupted projects
│   │   ├── ProjectManagerModal.tsx    # Manage saved projects
│   │   ├── SegmentTimeEditor.tsx      # Edit segment travel times
│   │   ├── TimelineView.tsx           # Visual trip timeline
│   │   ├── TripContextMenu.tsx        # Right-click trip actions
│   │   ├── QuickActionsBar.tsx        # Toolbar shortcuts
│   │   │
│   │   ├── steps/
│   │   │   ├── Step1Upload.tsx        # Upload CSV runtime data
│   │   │   ├── Step2Analysis.tsx      # Analyze runtimes, assign bands
│   │   │   ├── Step3Build.tsx         # Configure cycle/headway
│   │   │   ├── Step4Schedule.tsx      # Generate and preview trips
│   │   │   └── Step5Connections.tsx   # Connection optimization
│   │   │
│   │   ├── connections/               # Connection optimization UI
│   │   │   ├── AddTargetModal.tsx     # Create connection target
│   │   │   ├── ConnectionAddChooser.tsx
│   │   │   ├── ConnectionLibraryPanel.tsx
│   │   │   ├── ImportRouteModal.tsx   # Import route as target
│   │   │   ├── OptimizationPanel.tsx
│   │   │   └── RouteConnectionPanel.tsx
│   │   │
│   │   └── utils/
│   │       ├── csvParser.ts           # CSV runtime file parsing
│   │       └── timeCascade.ts         # Time adjustment propagation
│   │
│   ├── schedule/                      # ═══ Schedule Display ═══
│   │   ├── RoundTripTableView.tsx     # ★ Paired N+S table (8A/8B custom sort)
│   │   ├── SingleRouteView.tsx        # Single direction table
│   │   ├── ConnectionIndicator.tsx    # Connection status dots
│   │   └── ConnectionBadge.tsx        # Connection labels
│   │
│   ├── connections/                   # ═══ Editor Connection Panel ═══
│   │   ├── ConnectionsPanel.tsx       # Library management in editor
│   │   └── ConnectionStatusPanel.tsx  # Connection status overview
│   │
│   ├── Reports/                       # ═══ Reports & Export ═══
│   │   ├── PublicTimetable.tsx        # PDF brochure generator (~800 lines)
│   │   └── ReportsDashboard.tsx       # Reports landing page
│   │
│   ├── ui/                            # ═══ Shared UI ═══
│   │   ├── Modal.tsx
│   │   ├── CascadeModeSelector.tsx
│   │   └── StackedTimeInput.tsx
│   │
│   ├── Analytics/
│   │   └── AnalyticsDashboard.tsx
│   │
│   │  # ═══ Supporting Components ═══
│   ├── AddTripModal.tsx               # Add trip to schedule
│   ├── AuthContext.tsx / AuthModal.tsx # Authentication
│   ├── TeamContext.tsx / TeamManagement.tsx  # Team multi-tenancy
│   ├── DraftManagerModal.tsx          # Manage draft schedules
│   ├── BulkUploadToMasterModal.tsx    # Batch publish
│   ├── UploadToMasterModal.tsx        # Single publish
│   ├── VersionHistoryPanel.tsx        # Schedule version history
│   ├── PlatformSummary.tsx            # Platform conflict analysis
│   ├── RouteSummary.tsx               # Route overview cards
│   ├── ShiftEditor.tsx / ShiftEditorModal.tsx  # Operator shifts
│   ├── ScenarioComparisonModal.tsx    # Compare schedule versions
│   ├── SystemDraftEditorWorkspace.tsx # System-wide draft editing
│   ├── SystemDraftList.tsx            # List system drafts
│   ├── TravelTimeGrid.tsx            # Travel time matrix
│   ├── GapChart.tsx                   # Headway gap visualization
│   ├── OptimizationReviewModal.tsx    # AI optimization results
│   ├── FocusPromptModal.tsx           # Gemini prompt editor
│   ├── OTPAnalysis.tsx                # On-time performance
│   └── WorkspaceHeader.tsx            # Workspace title bar
│
├── utils/                             # ═══ Core Logic ═══
│   ├── scheduleGenerator.ts           # ★ Trip generation (394 lines) - LOCKED LOGIC
│   ├── blockAssignment.ts             # Block chaining
│   ├── blockAssignmentCore.ts         # Block core algorithm - LOCKED LOGIC
│   ├── runtimeAnalysis.ts             # Time band analysis (274 lines)
│   ├── timeUtils.ts                   # ★ Time parsing (99 lines) - post-midnight handling
│   │
│   ├── masterScheduleParser.ts        # Master schedule parsing (897 lines)
│   ├── masterScheduleParserV2.ts      # V2 parser (875 lines)
│   ├── parserAdapter.ts               # Parser version adapter (327 lines)
│   ├── scheduleParser.ts              # Legacy parser (86 lines)
│   │
│   ├── gtfsImportService.ts           # ★ GTFS import pipeline (1,573 lines)
│   ├── gtfsTypes.ts                   # GTFS type definitions (336 lines)
│   ├── gtfsStopLookup.ts             # Stop name resolution (91 lines)
│   │
│   ├── routeDirectionConfig.ts        # Route config inc. 8A/8B (524 lines)
│   ├── routeNameParser.ts             # Route name parsing (172 lines)
│   ├── routeColors.ts                 # Route color palette (85 lines)
│   │
│   ├── connectionLibraryService.ts    # Connection CRUD (433 lines)
│   ├── connectionTypes.ts             # Connection type defs
│   ├── connectionUtils.ts             # Connection matching logic
│   ├── connectionLibraryUtils.ts      # Connection helpers
│   ├── connectionOptimizer.ts         # AI connection optimization
│   │
│   ├── draftService.ts                # Draft CRUD (181 lines)
│   ├── publishService.ts              # Publish to master (175 lines)
│   ├── masterScheduleService.ts       # Master schedule access (706 lines)
│   ├── masterScheduleTypes.ts         # Master types (145 lines)
│   ├── scheduleTypes.ts               # Core schedule types (113 lines)
│   ├── scheduleEditorUtils.ts         # Editor utilities (410 lines)
│   ├── scheduleDraftAdapter.ts        # Draft adapter (79 lines)
│   ├── newScheduleProjectService.ts   # Wizard project persistence (281 lines)
│   ├── systemDraftService.ts          # System draft management (283 lines)
│   │
│   ├── platformAnalysis.ts            # Platform conflict detection (407 lines)
│   ├── platformConfig.ts              # Hub configurations (188 lines)
│   │
│   ├── dataService.ts                 # Firebase data operations
│   ├── firebase.ts                    # Firebase init (26 lines)
│   ├── teamService.ts                 # Team management (338 lines)
│   ├── exportService.ts               # CSV export (86 lines)
│   ├── goTransitService.ts            # GO Transit API (635 lines)
│   └── geminiOptimizer.ts             # Gemini AI integration (123 lines)
│
├── hooks/                             # ═══ React Hooks ═══
│   ├── useScheduleWizard.ts           # ★ Wizard state management (434 lines)
│   ├── useScheduleEditing.ts          # Editor state
│   ├── useAutoSave.ts                 # Auto-save logic
│   ├── useAddTrip.ts                  # Add trip workflow
│   ├── useTimeValidation.ts           # Time input validation (92 lines)
│   ├── useTravelTimeGrid.ts           # Travel time grid data (230 lines)
│   ├── useUndoRedo.ts                 # Undo/redo stack (101 lines)
│   ├── useUploadToMaster.ts           # Upload workflow (264 lines)
│   └── useWizardProgress.ts           # Wizard step tracking (78 lines)
│
├── api/                               # ═══ Serverless Functions ═══
│   ├── optimize.ts                    # Gemini two-pass optimization (314 lines)
│   ├── gtfs.ts                        # GTFS proxy endpoint (206 lines)
│   ├── parse-schedule.ts              # Schedule parsing (130 lines)
│   └── download-file.ts              # File download proxy (51 lines)
│
└── tests/                             # ═══ Tests ═══
    ├── timeUtils.test.ts              # ★ Post-midnight handling (216 lines)
    ├── connectionUtils.test.ts        # Connection matching (73 lines)
    ├── goTransitService.test.ts       # GO Transit API (66 lines)
    ├── gtfsDirection.test.ts          # Route config (64 lines, 5 tests)
    ├── parser.test.ts                 # Parser tests (44 lines)
    ├── scheduleDraftAdapter.test.ts   # Draft adapter (95 lines)
    └── fixtures/
        └── master_schedule.xlsx       # Test data
```

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
  id: string;                      // Format: "{routeNumber}_{dayType}"
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
| Trip generation | `utils/scheduleGenerator.ts` | LOCKED: segment rounding |
| Block assignment | `utils/blockAssignment.ts` + `blockAssignmentCore.ts` | LOCKED: gap-based chaining |
| Time parsing | `utils/timeUtils.ts` | Post-midnight: Excel >= 1.0 |
| CSV parsing | `components/NewSchedule/utils/csvParser.ts` | Runtime data import |
| Runtime analysis | `utils/runtimeAnalysis.ts` | Time band detection |
| Excel parsing | `utils/masterScheduleParserV2.ts` | Master schedule import |
| GTFS import | `utils/gtfsImportService.ts` | Full pipeline (1,573 lines) |
| Schedule display | `components/ScheduleEditor.tsx` | Core editor (1,634 lines) |
| Round-trip table | `components/schedule/RoundTripTableView.tsx` | 8A/8B custom sort |
| AI optimization | `api/optimize.ts` | Gemini Generator → Critic |
| Connection library | `utils/connectionLibraryService.ts` | Team-shared targets |
| Draft management | `utils/draftService.ts` | Draft CRUD |
| Publishing | `utils/publishService.ts` | Draft → Master |
| Route config | `utils/routeDirectionConfig.ts` | A/B suffix rules |

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
└── connectionLibrary/default          # Shared connection targets
```

---

## Data Flow

```
CREATE (from CSV):
  Runtime CSV → csvParser → runtimeAnalysis → scheduleGenerator → Draft

IMPORT (from GTFS):
  GTFS Feed → api/gtfs → gtfsImportService → Draft

IMPORT (from Excel):
  Excel file → masterScheduleParserV2 → Draft

EDIT:
  Published Master → Copy to Draft → ScheduleEditor → Publish

EXPORT:
  Published Master → PublicTimetable (PDF) or exportService (CSV)
```
