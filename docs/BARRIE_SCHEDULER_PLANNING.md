# Barrie Transit Schedule Builder
## Project Planning Document

**Version:** 1.0
**Date:** January 13, 2026
**Project Type:** Internal Schedule Planning Tool
**Target Users:** Barrie Transit Planners

---

## Executive Summary

This document defines the architecture and data flow for the Barrie Transit Schedule Builder application. The app enables transit planners to create, edit, and publish fixed-route schedules and manage on-demand transit shifts.

**Key Architectural Decision:** All schedule data flows through a **Draft → Publish** workflow with a single source of truth, eliminating the current fragmentation across 4 disconnected views.

**Data Import:** Existing schedules are imported via GTFS feed (myridebarrie.ca/gtfs), eliminating complex CSV parsing for schedule retrieval.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solution Overview](#2-solution-overview)
3. [Architecture](#3-architecture)
4. [Data Model](#4-data-model)
5. [User Flows](#5-user-flows)
6. [Component Responsibilities](#6-component-responsibilities)
7. [GTFS Integration](#7-gtfs-integration)
8. [Locked Logic](#8-locked-logic)
9. [Migration Plan](#9-migration-plan)
10. [File Reference](#10-file-reference)

---

## 1. Problem Statement

### Current Challenges

The application has **4 disconnected schedule representations** that do not sync:

| View | Data Type | Storage Location | Problem |
|------|-----------|------------------|---------|
| New Schedule Wizard | `MasterRouteTable[]` | Manual wrap → Firestore | Conversion loses metadata |
| Schedule Tweaker | `MasterRouteTable[]` | `ScheduleDraft` collection | Edits never reach Master |
| Master Browser | `MasterScheduleContent` | `masterSchedules` collection | Never sees Tweaker edits |
| Export | Cached `MasterScheduleContent` | Browser memory | Shows stale data |

**Result:** When a user edits a schedule in the Tweaker, those changes don't appear in the Master Browser or Export. Users see different data depending on which view they're in.

### Root Cause

```
THREE SEPARATE STORAGE LOCATIONS:
├── ScheduleDraft (Tweaker saves here)
├── MasterScheduleContent (Browser reads here)
└── In-memory generation (Wizard creates here)

NO SYNC MECHANISM BETWEEN THEM
```

### Impact

- User confusion ("Which version is correct?")
- Lost work (edits saved to Draft, exported from Master)
- Inconsistent exports
- Difficulty maintaining code (4 different data flows)

---

## 2. Solution Overview

### Core Principle: Draft → Publish Workflow

```
┌─────────────────┐         ┌─────────────────┐
│  DRAFT          │         │  PUBLISHED      │
│  SCHEDULES      │────────►│  MASTER         │
│                 │ Publish │                 │
│  Work in        │         │  Final source   │
│  progress       │         │  of truth       │
│  Editable       │         │  Read-only      │
│  Multiple per   │         │  One per route/ │
│  route allowed  │         │  day-type       │
└─────────────────┘         └─────────────────┘
        ▲                           │
        │                           │
        └───────────────────────────┘
              "Copy to Draft"
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data import | GTFS feed | Standard format, eliminates parsing bugs |
| Storage model | Draft + Published | Clear separation of WIP vs final |
| Single type | `MasterScheduleContent` | All views use same structure |
| Draft naming | Multiple named drafts | Flexibility for trials/variants |
| Export source | Published Master only | Guarantees consistency |
| Edit workflow | Copy to Draft → Edit → Publish | Prevents accidental changes to live schedules |

### What Changes

| Before | After |
|--------|-------|
| 4 disconnected views | 2 clear modes: Draft Editor + Published Browser |
| CSV parsing for existing schedules | GTFS import |
| `ScheduleDraft` separate from Master | Drafts are first-class citizens |
| Edits lost between views | All edits in Draft, published when ready |
| Multiple type conversions | Single `MasterScheduleContent` type |

---

## 3. Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐   │
│  │ GTFS FEED            │  │ RUNTIME CSV          │  │ MANUAL ENTRY     │   │
│  │ myridebarrie.ca/gtfs │  │ P50/P80 travel times │  │ Direct input     │   │
│  │                      │  │ (for NEW routes)     │  │                  │   │
│  │ • stop_times.txt     │  │                      │  │                  │   │
│  │ • trips.txt          │  │ • Segment times      │  │                  │   │
│  │ • routes.txt         │  │ • Time buckets       │  │                  │   │
│  │ • stops.txt          │  │ • Outlier detection  │  │                  │   │
│  │ • calendar.txt       │  │                      │  │                  │   │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘   │
│             │                         │                       │              │
│             │    GTFS Parser          │   Schedule Generator  │              │
│             │    (NEW)                │   (existing)          │              │
│             └─────────┬───────────────┴───────────┬───────────┘              │
│                       │                           │                          │
│                       ▼                           ▼                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         DRAFT SCHEDULES                               │   │
│  │                                                                       │   │
│  │   Firestore: teams/{teamId}/draftSchedules/{draftId}                 │   │
│  │                                                                       │   │
│  │   Type: DraftSchedule {                                              │   │
│  │     id: string                                                       │   │
│  │     name: string              // e.g., "Route 100 - Summer Trial"    │   │
│  │     routeNumber: string       // e.g., "100"                         │   │
│  │     dayType: DayType          // Weekday | Saturday | Sunday         │   │
│  │     content: MasterScheduleContent                                   │   │
│  │     status: 'draft' | 'ready_for_review'                             │   │
│  │     createdAt: Timestamp                                             │   │
│  │     updatedAt: Timestamp                                             │   │
│  │     createdBy: string                                                │   │
│  │     basedOn?: string          // ID of source (Master or GTFS)       │   │
│  │   }                                                                  │   │
│  │                                                                       │   │
│  │   Features:                                                          │   │
│  │   • Multiple drafts per route allowed                                │   │
│  │   • Auto-save enabled                                                │   │
│  │   • Full edit capabilities                                           │   │
│  │   • Version history within draft                                     │   │
│  │                                                                       │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                            │
│                                 │  [PUBLISH TO MASTER]                       │
│                                 │  • Requires confirmation                   │
│                                 │  • Creates version in history              │
│                                 │  • Replaces current published              │
│                                 ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      PUBLISHED MASTER SCHEDULES                       │   │
│  │                                                                       │   │
│  │   Firestore: teams/{teamId}/masterSchedules/{routeId}_{dayType}      │   │
│  │                                                                       │   │
│  │   Type: PublishedSchedule {                                          │   │
│  │     routeNumber: string                                              │   │
│  │     dayType: DayType                                                 │   │
│  │     content: MasterScheduleContent                                   │   │
│  │     publishedAt: Timestamp                                           │   │
│  │     publishedBy: string                                              │   │
│  │     version: number                                                  │   │
│  │     history: PublishedSchedule[]   // Previous versions              │   │
│  │   }                                                                  │   │
│  │                                                                       │   │
│  │   Rules:                                                             │   │
│  │   • ONE published schedule per route/day-type                        │   │
│  │   • Read-only (no direct edits)                                      │   │
│  │   • Export ALWAYS pulls from here                                    │   │
│  │   • "Copy to Draft" creates editable version                         │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │ DRAFT        │ │ PUBLISHED    │ │ EXPORT       │
           │ EDITOR       │ │ BROWSER      │ │              │
           │              │ │              │ │ • Excel      │
           │ Edit drafts  │ │ View final   │ │ • CSV        │
           │ Auto-save    │ │ Copy to draft│ │ • GTFS       │
           │ Publish      │ │ View history │ │              │
           └──────────────┘ └──────────────┘ └──────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React 18 + TypeScript | UI framework |
| Styling | Tailwind CSS | Consistent design |
| State | React Context + useState | Global and local state |
| Persistence | Firebase Firestore | Draft and Master storage |
| File Storage | Firebase Storage | Excel exports, backups |
| Auth | Firebase Auth | User authentication |
| AI | Google Gemini | Schedule optimization |
| GTFS Parser | gtfs-utils (NEW) | Import existing schedules |
| Export | ExcelJS | Excel file generation |

### Workspace Structure

```
App.tsx
├── Home (Workspace Selector)
│   ├── Fixed Route Workspace
│   │   ├── Dashboard
│   │   ├── Schedule Creator (was: New Schedule Wizard)
│   │   │   └── Sources: GTFS Import | Runtime CSV | Manual
│   │   ├── Draft Editor (was: Schedule Tweaker)
│   │   │   └── Edit drafts, auto-save, publish
│   │   ├── Published Browser (was: Master Schedule Browser)
│   │   │   └── View published, copy to draft, export
│   │   └── Analytics (future)
│   │
│   └── On-Demand Workspace
│       └── (unchanged - shift management)
```

---

## 4. Data Model

### Core Types

```typescript
// ============================================
// MASTER SCHEDULE CONTENT (Shared by all views)
// ============================================

interface MasterScheduleContent {
  northTable: MasterRouteTable;
  southTable: MasterRouteTable;
  metadata: ScheduleMetadata;
}

interface MasterRouteTable {
  routeName: string;           // e.g., "Route 100 (North)"
  stops: string[];             // Ordered stop names
  stopIds: Record<string, string>;  // Stop name → GTFS stop_id
  trips: MasterTrip[];
}

interface MasterTrip {
  tripId: string;
  blockId: string;
  times: Record<string, string>;  // Stop name → time (HH:MM)
  travelTime: number;             // Total trip minutes
  recoveryTime: number;           // Layover minutes
  cycleTime: number;              // Full round-trip minutes
  assignedBand?: string;          // Time band (A/B/C/D/E)
  direction: 'North' | 'South' | 'Loop';
}

interface ScheduleMetadata {
  routeNumber: string;
  dayType: DayType;
  effectiveDate?: string;
  notes?: string;
}

type DayType = 'Weekday' | 'Saturday' | 'Sunday';

// ============================================
// DRAFT SCHEDULE (Work in Progress)
// ============================================

interface DraftSchedule {
  id: string;
  name: string;                    // User-defined name
  routeNumber: string;
  dayType: DayType;
  content: MasterScheduleContent;
  status: 'draft' | 'ready_for_review';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;               // User ID
  basedOn?: {
    type: 'master' | 'gtfs' | 'generated';
    id?: string;                   // Master schedule ID if copied
    importedAt?: Timestamp;
  };
}

// ============================================
// PUBLISHED SCHEDULE (Final/Live)
// ============================================

interface PublishedSchedule {
  id: string;                      // Format: "{routeNumber}_{dayType}"
  routeNumber: string;
  dayType: DayType;
  content: MasterScheduleContent;
  version: number;
  publishedAt: Timestamp;
  publishedBy: string;
  publishedFromDraft: string;      // Draft ID that was published
  history: PublishedVersion[];     // Previous versions
}

interface PublishedVersion {
  version: number;
  content: MasterScheduleContent;
  publishedAt: Timestamp;
  publishedBy: string;
}
```

### Firestore Structure

```
firestore/
├── teams/{teamId}/
│   ├── draftSchedules/
│   │   ├── {draftId}/
│   │   │   ├── id: string
│   │   │   ├── name: "Route 100 - Summer Trial"
│   │   │   ├── routeNumber: "100"
│   │   │   ├── dayType: "Weekday"
│   │   │   ├── content: MasterScheduleContent
│   │   │   ├── status: "draft"
│   │   │   ├── createdAt: Timestamp
│   │   │   ├── updatedAt: Timestamp
│   │   │   ├── createdBy: "user123"
│   │   │   └── basedOn: { type: "gtfs", importedAt: Timestamp }
│   │   │
│   │   └── {draftId2}/
│   │       └── ... (another draft, same or different route)
│   │
│   ├── masterSchedules/
│   │   ├── 100_Weekday/
│   │   │   ├── routeNumber: "100"
│   │   │   ├── dayType: "Weekday"
│   │   │   ├── content: MasterScheduleContent
│   │   │   ├── version: 3
│   │   │   ├── publishedAt: Timestamp
│   │   │   ├── publishedBy: "user123"
│   │   │   └── history: [v1, v2]
│   │   │
│   │   ├── 100_Saturday/
│   │   ├── 100_Sunday/
│   │   ├── 200_Weekday/
│   │   └── ...
│   │
│   └── gtfsCache/
│       ├── lastImport: Timestamp
│       ├── routes: [...]
│       ├── stops: [...]
│       └── schedules: {...}  // Parsed GTFS data
│
└── users/{userId}/
    └── ... (user profile, preferences)
```

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA FLOW                                     │
└─────────────────────────────────────────────────────────────────────┘

CREATE NEW SCHEDULE (from Runtime CSV):
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Runtime  │───►│ csvParser│───►│ schedule │───►│  Draft   │
│ CSV      │    │ .ts      │    │ Generator│    │ Schedule │
│ (P50/P80)│    │          │    │ .ts      │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
                                                      ▼
IMPORT FROM GTFS:                               ┌──────────┐
┌──────────┐    ┌──────────┐                    │  Draft   │
│ GTFS     │───►│ gtfsImport│───────────────────►│ Editor   │
│ Feed     │    │ Service   │                    │          │
└──────────┘    └──────────┘                    └──────────┘
                                                      │
                                                      │ [Save]
EDIT EXISTING:                                        ▼
┌──────────┐    ┌──────────┐                    ┌──────────┐
│ Published│───►│ Copy to  │───────────────────►│ Firestore│
│ Master   │    │ Draft    │                    │ drafts/  │
└──────────┘    └──────────┘                    └──────────┘
                                                      │
                                                      │ [Publish]
                                                      ▼
                                                ┌──────────┐
                                                │ Firestore│
                                                │ master/  │
                                                └──────────┘
                                                      │
                                                      │ [Export]
                                                      ▼
                                                ┌──────────┐
                                                │ Excel/   │
                                                │ CSV      │
                                                └──────────┘
```

---

## 5. User Flows

### Flow 1: Import Existing Schedule from GTFS

```
User clicks "Import from GTFS"
         │
         ▼
┌─────────────────────────────┐
│ Fetch GTFS Feed             │
│ myridebarrie.ca/gtfs        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Parse & Display Routes      │
│ • Route 100 (Weekday)       │
│ • Route 100 (Saturday)      │
│ • Route 200 (Weekday)       │
│ • ...                       │
└─────────────┬───────────────┘
              │
              ▼
User selects route + day type
              │
              ▼
┌─────────────────────────────┐
│ Convert to MasterSchedule   │
│ Content format              │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Create Draft                │
│ Name: "Route 100 - GTFS     │
│        Import Jan 2026"     │
│ Status: draft               │
└─────────────┬───────────────┘
              │
              ▼
    Open in Draft Editor
```

### Flow 2: Create New Schedule (from Runtime CSV)

```
User clicks "Create New Schedule"
              │
              ▼
┌─────────────────────────────┐
│ Step 1: Upload Runtime CSV  │
│ (P50/P80 travel times)      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Step 2: Analysis            │
│ • View time buckets         │
│ • Assign bands (A/B/C/D/E)  │
│ • Review segment times      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Step 3: Configure           │
│ • Route number              │
│ • Day type                  │
│ • Cycle time                │
│ • Number of blocks          │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Step 4: Generate & Review   │
│ scheduleGenerator.ts        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Create Draft                │
│ Name: "Route 400 - New      │
│        Service Q2 2026"     │
└─────────────┬───────────────┘
              │
              ▼
    Open in Draft Editor
```

### Flow 3: Edit Published Schedule

```
User opens Published Browser
              │
              ▼
┌─────────────────────────────┐
│ Select Route + Day Type     │
│ View published schedule     │
└─────────────┬───────────────┘
              │
              ▼
User clicks "Copy to Draft"
              │
              ▼
┌─────────────────────────────┐
│ Name Draft Dialog           │
│ "Route 100 - Timing Adjust" │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Draft Created               │
│ basedOn: { type: 'master',  │
│   id: '100_Weekday' }       │
└─────────────┬───────────────┘
              │
              ▼
    Open in Draft Editor
```

### Flow 4: Edit and Publish Draft

```
User opens Draft Editor
              │
              ▼
┌─────────────────────────────┐
│ Select Draft from list      │
│ • Route 100 - Summer Trial  │
│ • Route 200 - Timing Fix    │
│ • Route 400 - New Service   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Edit Schedule               │
│ • Modify trip times         │
│ • Add/remove trips          │
│ • Adjust recovery           │
│ (Auto-saves to Firestore)   │
└─────────────┬───────────────┘
              │
              ▼
User clicks "Publish to Master"
              │
              ▼
┌─────────────────────────────┐
│ Confirmation Dialog         │
│ "This will replace the      │
│  current Route 100 Weekday  │
│  schedule. Continue?"       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Publish Process             │
│ 1. Archive current Master   │
│ 2. Copy Draft → Master      │
│3. Increment version         │
│ 4. Update publishedAt       │
└─────────────┬───────────────┘
              │
              ▼
    Success notification
    "Route 100 Weekday v4 published"
```

### Flow 5: Export Schedule

```
User opens Published Browser
              │
              ▼
┌─────────────────────────────┐
│ Select Route(s) to Export   │
│ ☑ Route 100 Weekday         │
│ ☑ Route 100 Saturday        │
│ ☐ Route 200 Weekday         │
└─────────────┬───────────────┘
              │
              ▼
User clicks "Export"
              │
              ▼
┌─────────────────────────────┐
│ Select Format               │
│ • Excel (.xlsx)             │
│ • CSV                       │
│ • GTFS (future)             │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Generate File               │
│ Source: Published Master    │
│ (NEVER from drafts)         │
└─────────────┬───────────────┘
              │
              ▼
    Browser downloads file
```

---

## 6. Component Responsibilities

### View Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `FixedRouteWorkspace` | `/components/FixedRouteWorkspace.tsx` | Dashboard and navigation for fixed routes |
| `ScheduleCreator` | `/components/ScheduleCreator/` (NEW) | Create schedules from GTFS, CSV, or manual |
| `DraftEditor` | `/components/DraftEditor/` (was Tweaker) | Edit drafts, auto-save, publish action |
| `PublishedBrowser` | `/components/PublishedBrowser/` (was MasterBrowser) | View/export published, copy to draft |
| `ScheduleEditor` | `/components/ScheduleEditor.tsx` | Reusable table editor (used by DraftEditor) |

### Service Modules

| Service | Location | Responsibility |
|---------|----------|----------------|
| `gtfsImportService` | `/utils/gtfsImportService.ts` (NEW) | Fetch and parse GTFS feed |
| `draftService` | `/utils/draftService.ts` (NEW) | CRUD for draft schedules |
| `publishService` | `/utils/publishService.ts` (NEW) | Publish drafts to Master |
| `masterScheduleService` | `/utils/masterScheduleService.ts` | Read published schedules |
| `scheduleGenerator` | `/utils/scheduleGenerator.ts` | Generate schedules from runtime data |
| `exportService` | `/utils/exportService.ts` | Generate Excel/CSV exports |

### Utility Modules

| Utility | Location | Responsibility |
|---------|----------|----------------|
| `csvParser` | `/components/NewSchedule/utils/csvParser.ts` | Parse runtime CSV files |
| `runtimeAnalysis` | `/components/NewSchedule/utils/runtimeAnalysis.ts` | Calculate trip times, bands |
| `timeUtils` | `/utils/timeUtils.ts` | Time parsing (handles post-midnight) |
| `masterScheduleParser` | `/utils/masterScheduleParser.ts` | Type definitions |

### Component Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPONENT RELATIONSHIPS                           │
└─────────────────────────────────────────────────────────────────────┘

ScheduleCreator
├── Uses: gtfsImportService (GTFS import)
├── Uses: csvParser + scheduleGenerator (CSV import)
├── Creates: DraftSchedule
└── Navigates to: DraftEditor

DraftEditor
├── Uses: draftService (load/save drafts)
├── Uses: ScheduleEditor (table editing)
├── Uses: publishService (publish action)
└── Data: DraftSchedule → MasterScheduleContent

PublishedBrowser
├── Uses: masterScheduleService (load published)
├── Uses: exportService (Excel/CSV export)
├── Uses: draftService (copy to draft)
└── Data: PublishedSchedule → MasterScheduleContent

ScheduleEditor (Shared)
├── Input: MasterRouteTable[]
├── Output: onUpdateSchedules callback
└── Used by: DraftEditor, ScheduleCreator Step 4
```

---

## 7. GTFS Integration

### GTFS Feed Structure

The Barrie Transit GTFS feed (https://www.myridebarrie.ca/gtfs/google_transit.zip) contains:

| File | Content | Use in App |
|------|---------|------------|
| `routes.txt` | Route definitions | Route list for import |
| `trips.txt` | Trip definitions | Trip structure |
| `stop_times.txt` | Arrival/departure times | Schedule times |
| `stops.txt` | Stop locations | Stop names, coordinates |
| `calendar.txt` | Service days | Weekday/Saturday/Sunday mapping |
| `calendar_dates.txt` | Exceptions | Holiday handling |
| `shapes.txt` | Route geometry | Future: map visualization |

### GTFS to MasterScheduleContent Mapping

```typescript
// GTFS Import Service (NEW)

interface GTFSImportService {
  // Fetch and cache GTFS data
  fetchGTFS(): Promise<GTFSData>;

  // Get available routes with service patterns
  getAvailableRoutes(): RouteOption[];

  // Import specific route/day as draft
  importToDraft(
    routeId: string,
    dayType: DayType,
    draftName: string
  ): Promise<DraftSchedule>;
}

// Mapping logic
function gtfsToMasterContent(
  gtfsTrips: GTFSTrip[],
  gtfsStopTimes: GTFSStopTime[],
  gtfsStops: GTFSStop[]
): MasterScheduleContent {

  // 1. Group trips by direction (inbound/outbound → North/South)
  const northTrips = gtfsTrips.filter(t => t.direction_id === 0);
  const southTrips = gtfsTrips.filter(t => t.direction_id === 1);

  // 2. Get ordered stops for each direction
  const northStops = getOrderedStops(northTrips[0], gtfsStopTimes, gtfsStops);
  const southStops = getOrderedStops(southTrips[0], gtfsStopTimes, gtfsStops);

  // 3. Build MasterTrip for each GTFS trip
  const northMasterTrips = northTrips.map(trip =>
    buildMasterTrip(trip, gtfsStopTimes)
  );

  // 4. Return unified structure
  return {
    northTable: {
      routeName: `Route ${routeId} (North)`,
      stops: northStops,
      stopIds: buildStopIdMap(northStops, gtfsStops),
      trips: northMasterTrips
    },
    southTable: { ... },
    metadata: {
      routeNumber: routeId,
      dayType: dayType
    }
  };
}
```

### GTFS Import UI Flow

```
┌─────────────────────────────────────────────┐
│           IMPORT FROM GTFS                   │
├─────────────────────────────────────────────┤
│                                              │
│  Last updated: Jan 13, 2026 6:00 AM         │
│  [Refresh Feed]                              │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ Select Route                        │    │
│  │ ┌─────────────────────────────────┐ │    │
│  │ │ ▼ Route 100 - Barrie South GO   │ │    │
│  │ └─────────────────────────────────┘ │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ Select Day Type                     │    │
│  │ ○ Weekday  ○ Saturday  ○ Sunday    │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ Draft Name                          │    │
│  │ ┌─────────────────────────────────┐ │    │
│  │ │ Route 100 - GTFS Import Jan 26  │ │    │
│  │ └─────────────────────────────────┘ │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  Preview:                                    │
│  ┌─────────────────────────────────────┐    │
│  │ North: 45 trips, 12 stops           │    │
│  │ South: 45 trips, 12 stops           │    │
│  │ First trip: 5:30 AM                 │    │
│  │ Last trip: 11:45 PM                 │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  [Cancel]              [Import as Draft]    │
│                                              │
└─────────────────────────────────────────────┘
```

---

## 8. Locked Logic

> **WARNING:** Do not modify the following logic without explicit approval. These have been tested and bugs in these areas have caused significant issues.

### 1. Post-Midnight Time Parsing

**Location:** `utils/timeUtils.ts:18-26`, `utils/masterScheduleParserV2.ts:55-84`

**Problem:** Excel represents times as day fractions. Post-midnight times (12:30 AM) have values >= 1.0.

**Rule:** Extract fractional part for values >= 1.0:
```typescript
if (excelValue >= 1) {
  excelValue = excelValue % 1;  // Get fractional part
}
```

**Test:** Always run `npx vitest run tests/timeUtils.test.ts` after modifying time parsing.

### 2. Segment Rounding

**Location:** `utils/runtimeAnalysis.ts:80-82`

**Rule:** Round each segment BEFORE summing:
```typescript
// CORRECT
const total = segments.reduce((sum, seg) => sum + Math.round(seg.p50), 0);

// WRONG
const total = Math.round(segments.reduce((sum, seg) => sum + seg.p50, 0));
```

### 3. Trip Pairing

**Location:** `utils/scheduleGenerator.ts`

**Rule:** Round trips pair as N1+S1, N2+S2 per row (not interleaved):
```
Block 1: N1 → S1 → N2 → S2 → ...
Block 2: N1 → S1 → N2 → S2 → ...
```

### 4. Cycle Time Calculation

**Location:** `utils/scheduleGenerator.ts`

**Rule:** Cycle = Last End Time - First Start Time (includes all recovery).

### 5. Double Pass Optimization

**Location:** `api/optimize.ts`

**Rule:** AI optimization uses Generator → Critic pattern. Do not bypass the critic phase.

---

## 9. Migration Plan

### Phase 1: Unified Data Model

1. Create `DraftSchedule` type definition
2. Create `PublishedSchedule` type definition
3. Create Firestore collections (`draftSchedules/`, update `masterSchedules/`)
4. Create `draftService.ts` with CRUD operations
5. Create `publishService.ts` with publish logic

### Phase 2: GTFS Import

1. Create `gtfsImportService.ts`
2. Add GTFS parser (use `gtfs-utils` or custom)
3. Build import UI in Schedule Creator
4. Test with Barrie GTFS feed

### Phase 3: Refactor Views

1. Rename `ScheduleTweakerWorkspace` → `DraftEditor`
2. Update to use `draftService` instead of `ScheduleDraft`
3. Rename `MasterScheduleBrowser` → `PublishedBrowser`
4. Add "Copy to Draft" functionality
5. Update export to only use Published data

### Phase 4: Remove Legacy Code

1. Remove old `ScheduleDraft` type and storage
2. Remove redundant parser adapters
3. Consolidate to single `MasterScheduleContent` type
4. Update all components to use unified services

### Phase 5: Testing & Validation

1. Test GTFS import with all Barrie routes
2. Test Draft → Publish workflow
3. Test export from Published only
4. Validate no data loss in migration

---

## 10. File Reference

### Key Files (Current)

| Purpose | File | Status |
|---------|------|--------|
| App entry | `App.tsx` | Keep |
| Fixed route workspace | `components/FixedRouteWorkspace.tsx` | Modify |
| Schedule editor | `components/ScheduleEditor.tsx` | Keep |
| Schedule tweaker | `components/ScheduleTweakerWorkspace.tsx` | Rename → DraftEditor |
| Master browser | `components/MasterScheduleBrowser.tsx` | Rename → PublishedBrowser |
| New schedule wizard | `components/NewSchedule/NewScheduleWizard.tsx` | Refactor |
| CSV parser | `components/NewSchedule/utils/csvParser.ts` | Keep |
| Schedule generator | `utils/scheduleGenerator.ts` | Keep (LOCKED) |
| Runtime analysis | `utils/runtimeAnalysis.ts` | Keep (LOCKED) |
| Time utils | `utils/timeUtils.ts` | Keep (LOCKED) |
| Master schedule service | `utils/masterScheduleService.ts` | Modify |
| Data service | `utils/dataService.ts` | Modify (remove ScheduleDraft) |
| Export service | `utils/exportService.ts` | Modify |

### New Files (To Create)

| Purpose | File |
|---------|------|
| GTFS import | `utils/gtfsImportService.ts` |
| Draft operations | `utils/draftService.ts` |
| Publish operations | `utils/publishService.ts` |
| Draft editor view | `components/DraftEditor/DraftEditor.tsx` |
| Published browser view | `components/PublishedBrowser/PublishedBrowser.tsx` |
| GTFS import UI | `components/ScheduleCreator/GTFSImport.tsx` |

### Type Definitions

| Types | File |
|-------|------|
| Core schedule types | `utils/masterScheduleTypes.ts` |
| Draft/Published types | `utils/scheduleTypes.ts` (NEW) |
| GTFS types | `utils/gtfsTypes.ts` (NEW) |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | January 13, 2026 | Planning Session | Initial document |

---

*End of Document*
