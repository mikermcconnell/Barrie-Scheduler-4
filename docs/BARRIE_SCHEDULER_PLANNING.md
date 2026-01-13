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
8. [Brochure Generator](#8-brochure-generator)
9. [Platform Conflict Detector](#9-platform-conflict-detector)
10. [Locked Logic](#10-locked-logic)
11. [Migration Plan](#11-migration-plan)
12. [File Reference](#12-file-reference)

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
| 4 disconnected views | 2 clear modes: Schedule Editor + Master Schedule |
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
           │ SCHEDULE     │ │ MASTER       │ │ EXPORT       │
           │ EDITOR       │ │ SCHEDULE     │ │              │
           │              │ │              │ │ • Excel      │
           │ Edit drafts  │ │ View final   │ │ • CSV        │
           │ Auto-save    │ │ Copy to draft│ │ • Brochure   │
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
│   │   ├── Schedule Editor (was: Schedule Tweaker)
│   │   │   └── Edit drafts, auto-save, publish
│   │   ├── Master Schedule (was: Master Schedule Browser)
│   │   │   └── View published, copy to draft, export, brochure generation
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
| `ScheduleEditorWorkspace` | `/components/ScheduleEditor/` (was Tweaker) | Edit drafts, auto-save, publish action |
| `MasterScheduleView` | `/components/MasterSchedule/` (was MasterBrowser) | View/export published, copy to draft, brochure export |
| `ScheduleTableEditor` | `/components/ScheduleTableEditor.tsx` | Reusable table editor (used by ScheduleEditorWorkspace) |

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
└── Navigates to: ScheduleEditorWorkspace

ScheduleEditorWorkspace
├── Uses: draftService (load/save drafts)
├── Uses: ScheduleTableEditor (table editing)
├── Uses: publishService (publish action)
└── Data: DraftSchedule → MasterScheduleContent

MasterScheduleView
├── Uses: masterScheduleService (load published)
├── Uses: exportService (Excel/CSV export)
├── Uses: brochureService (PDF brochure generation)
├── Uses: draftService (copy to draft)
└── Data: PublishedSchedule → MasterScheduleContent

ScheduleTableEditor (Shared)
├── Input: MasterRouteTable[]
├── Output: onUpdateSchedules callback
└── Used by: ScheduleEditorWorkspace, ScheduleCreator Step 4
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

## 8. Brochure Generator

### Overview

Generate public-facing PDF brochures (like the Route 2 Dunlop/Park Place brochure) directly from the Master Schedule. The brochure combines:
- **Static elements:** Route map image, fare table, legend, connections (manually configured per route)
- **Dynamic elements:** Schedule times (pulled from Master Schedule)

This eliminates manual time entry when schedules change - just regenerate the brochure.

### Feature Requirements

| Requirement | Description |
|-------------|-------------|
| Single route export | Generate brochure for one route + all day types |
| Batch export | Generate brochures for all routes at once |
| Day type support | Weekday, Saturday, Sunday/Holiday schedules on same brochure |
| Branch support | Handle routes with branches (2A/2B, 8A/8B) |
| Manual metadata | Effective date, fare table, legend, connections |
| Map images | One PNG image per route (user-provided) |

### Data Model

```typescript
// ============================================
// BROCHURE TEMPLATE (Per Route)
// ============================================

interface BrochureTemplate {
  id: string;
  routeNumber: string;
  routeName: string;                    // e.g., "Dunlop/Park Place"

  // Static content (manually configured)
  mapImagePath: string;                 // Path to PNG in Firebase Storage
  effectiveDate: string;                // e.g., "October 27th, 2025"
  fareTable: FareTable;
  legend: LegendItem[];
  connections: RouteConnection[];

  // Branch configuration
  branches: RouteBranch[];

  // Layout settings
  layoutType: 'standard' | 'compact';   // For routes with many trips

  // Metadata
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

interface RouteBranch {
  branchId: string;                     // e.g., "2A", "2B"
  branchName: string;                   // e.g., "Dunlop to Downtown"
  direction: 'outbound' | 'inbound';
  stops: BrochureStop[];                // Ordered stops for this branch
  color?: string;                       // Branch indicator color
}

interface BrochureStop {
  stopName: string;                     // e.g., "Park Place Platform 2"
  stopId: string;                       // e.g., "777"
  isTimingPoint: boolean;               // Show in schedule table
  displayName?: string;                 // Short name for table header
}

interface FareTable {
  effectiveDate: string;
  fares: FareRow[];
  notes: string[];                      // e.g., "Seniors Ride Free on Tuesdays..."
}

interface FareRow {
  type: string;                         // e.g., "Single Ride", "Monthly Pass"
  adult: string;
  student: string;
  children: string;
  senior: string;
  family: string;
}

interface LegendItem {
  symbol: string;                       // e.g., "#", "X"
  description: string;                  // e.g., "Connection to other fixed route"
}

interface RouteConnection {
  stopName: string;
  routes: string[];                     // e.g., ["7", "8", "11", "12", "400"]
}

// ============================================
// GENERATED BROCHURE (Output)
// ============================================

interface GeneratedBrochure {
  routeNumber: string;
  generatedAt: Timestamp;
  generatedBy: string;
  sourceScheduleVersion: number;        // Master Schedule version used
  pdfUrl: string;                       // Firebase Storage URL
  dayTypes: DayType[];                  // Which day types included
}
```

### Firestore Structure

```
firestore/
├── teams/{teamId}/
│   ├── brochureTemplates/
│   │   ├── route_2/
│   │   │   ├── routeNumber: "2"
│   │   │   ├── routeName: "Dunlop/Park Place"
│   │   │   ├── mapImagePath: "brochures/maps/route_2.png"
│   │   │   ├── effectiveDate: "October 27th, 2025"
│   │   │   ├── fareTable: { ... }
│   │   │   ├── legend: [ ... ]
│   │   │   ├── connections: [ ... ]
│   │   │   ├── branches: [
│   │   │   │   { branchId: "2A", branchName: "Dunlop to Downtown", ... },
│   │   │   │   { branchId: "2B", branchName: "Park Place", ... }
│   │   │   │ ]
│   │   │   └── layoutType: "standard"
│   │   │
│   │   ├── route_7/
│   │   ├── route_8/
│   │   └── ...
│   │
│   └── generatedBrochures/
│       ├── route_2_2026-01-13/
│       │   ├── pdfUrl: "..."
│       │   ├── generatedAt: Timestamp
│       │   └── sourceScheduleVersion: 4
│       └── ...
│
└── storage/
    └── brochures/
        └── maps/
            ├── route_2.png
            ├── route_7.png
            └── ...
```

### User Flow: Configure Brochure Template

```
User opens Master Schedule
         │
         ▼
Clicks "Brochure Settings" for Route 2
         │
         ▼
┌─────────────────────────────────────────────┐
│       BROCHURE TEMPLATE EDITOR              │
├─────────────────────────────────────────────┤
│                                             │
│  Route: 2 - Dunlop/Park Place              │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Map Image                           │   │
│  │ [route_2.png]  [Upload New]         │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Effective Date                      │   │
│  │ [October 27th, 2025]                │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Branches                            │   │
│  │ ┌─────────────────────────────────┐ │   │
│  │ │ 2A: Dunlop to Downtown          │ │   │
│  │ │ Stops: [Configure]              │ │   │
│  │ └─────────────────────────────────┘ │   │
│  │ ┌─────────────────────────────────┐ │   │
│  │ │ 2B: Park Place                  │ │   │
│  │ │ Stops: [Configure]              │ │   │
│  │ └─────────────────────────────────┘ │   │
│  │ [+ Add Branch]                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Fare Table  [Edit]                  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Legend & Connections  [Edit]        │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Cancel]                    [Save Template]│
│                                             │
└─────────────────────────────────────────────┘
```

### User Flow: Generate Brochure

```
User opens Master Schedule
         │
         ▼
Selects Route 2 (or multiple routes)
         │
         ▼
Clicks "Export → Brochure PDF"
         │
         ▼
┌─────────────────────────────────────────────┐
│       GENERATE BROCHURE                     │
├─────────────────────────────────────────────┤
│                                             │
│  Route: 2 - Dunlop/Park Place              │
│  Template: ✓ Configured                     │
│  Map Image: ✓ Uploaded                      │
│                                             │
│  Day Types to Include:                      │
│  ☑ Weekday                                  │
│  ☑ Saturday                                 │
│  ☑ Sunday & Holidays                        │
│                                             │
│  Schedule Source:                           │
│  Master Schedule v4 (Published Jan 10)     │
│                                             │
│  Preview:                                   │
│  ┌─────────────────────────────────────┐   │
│  │  [Thumbnail of brochure page 1]     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Cancel]              [Generate PDF]       │
│                                             │
└─────────────────────────────────────────────┘
         │
         ▼
PDF generated → Browser downloads
```

### User Flow: Batch Generate

```
User opens Master Schedule
         │
         ▼
Clicks "Export → Generate All Brochures"
         │
         ▼
┌─────────────────────────────────────────────┐
│       BATCH GENERATE BROCHURES              │
├─────────────────────────────────────────────┤
│                                             │
│  Routes with templates configured:          │
│                                             │
│  ☑ Route 2 - Dunlop/Park Place    ✓ Ready  │
│  ☑ Route 7 - Bayfield             ✓ Ready  │
│  ☑ Route 8 - Essa                 ✓ Ready  │
│  ☐ Route 11 - Mapleview          ⚠ No map │
│  ☑ Route 12 - Yonge              ✓ Ready  │
│  ☐ Route 100 - Barrie South GO   ⚠ No tmpl│
│                                             │
│  [Select All Ready]  [Deselect All]         │
│                                             │
│  Output: ZIP file with all PDFs             │
│                                             │
│  [Cancel]              [Generate All]       │
│                                             │
└─────────────────────────────────────────────┘
```

### Technical Implementation

#### Map Image Format

**Recommendation: PNG**

| Format | Pros | Cons |
|--------|------|------|
| **PNG** | Simple to embed, good quality, widely supported | Larger file size |
| SVG | Scalable, small file size | Complex to embed in PDF |
| PDF | Vector quality | Requires conversion |

**PNG specifications:**
- Resolution: 300 DPI for print quality
- Dimensions: ~1200 x 800 pixels (landscape, half-page)
- Color: RGB
- File size: ~500KB - 1MB per map

#### PDF Generation

**Technology options:**

| Library | Pros | Cons |
|---------|------|------|
| `@react-pdf/renderer` | React-native syntax, good for complex layouts | Learning curve |
| `pdfmake` | Simple API, good table support | Less flexible styling |
| `Puppeteer` | Render HTML to PDF, full CSS support | Requires server, slower |

**Recommendation: `@react-pdf/renderer`**
- Best for complex brochure layouts
- Good image embedding support
- Table rendering for schedule grids
- Can match existing brochure styling

#### Service Module

```typescript
// utils/brochureService.ts

interface BrochureService {
  // Template management
  getTemplate(routeNumber: string): Promise<BrochureTemplate | null>;
  saveTemplate(template: BrochureTemplate): Promise<void>;
  uploadMapImage(routeNumber: string, file: File): Promise<string>;

  // Generation
  generateBrochure(
    routeNumber: string,
    dayTypes: DayType[]
  ): Promise<Blob>;

  generateAllBrochures(
    routeNumbers: string[]
  ): Promise<Blob>;  // ZIP file

  // Preview
  generatePreview(
    routeNumber: string,
    dayTypes: DayType[]
  ): Promise<string>;  // Base64 image of first page
}
```

#### Schedule Time Injection

The brochure generator pulls times from the published Master Schedule:

```typescript
function injectScheduleTimes(
  template: BrochureTemplate,
  masterSchedule: MasterScheduleContent,
  dayType: DayType
): BrochureScheduleData {

  // 1. Get trips from Master Schedule
  const northTrips = masterSchedule.northTable.trips;
  const southTrips = masterSchedule.southTable.trips;

  // 2. Map to brochure stops (timing points only)
  const outboundTimes = template.branches
    .filter(b => b.direction === 'outbound')
    .map(branch => ({
      branchId: branch.branchId,
      stops: branch.stops.filter(s => s.isTimingPoint),
      trips: mapTripsToStops(northTrips, branch.stops)
    }));

  // 3. Return structured data for PDF generation
  return {
    dayType,
    outbound: outboundTimes,
    inbound: inboundTimes
  };
}
```

### Files to Create

| File | Purpose |
|------|---------|
| `utils/brochureService.ts` | Template CRUD, PDF generation |
| `utils/brochureTypes.ts` | Type definitions |
| `components/MasterSchedule/BrochureTemplateEditor.tsx` | Template configuration UI |
| `components/MasterSchedule/BrochureGenerator.tsx` | Generation dialog |
| `components/MasterSchedule/BrochurePreview.tsx` | PDF preview component |
| `components/pdf/BrochureDocument.tsx` | React-PDF document template |
| `components/pdf/ScheduleTable.tsx` | Schedule grid component |
| `components/pdf/FareTable.tsx` | Fare table component |

### Migration: Adding Templates for Existing Routes

1. For each route, user uploads map image
2. Configure branches based on Master Schedule structure
3. Set timing point stops (which stops appear in brochure)
4. Configure fare table (one-time, shared across routes)
5. Add legend and connections

---

## 9. Platform Conflict Detector

### Overview

Automatically detect platform conflicts (multiple buses at the same platform simultaneously) when the Master Schedule is updated. Conflicts are displayed via alerts, badges, and highlighted rows in the schedule table.

**Existing Foundation:** The app already has `platformAnalysis.ts`, `platformConfig.ts`, and `PlatformSummary.tsx` that detect and display conflicts. This spec enhances the system with:
- Soft warnings (within 2 minutes)
- Auto-run on publish
- Schedule table highlighting
- Master Schedule view badges

### Conflict Severity Levels

| Severity | Definition | Visual Indicator |
|----------|------------|------------------|
| **Hard Conflict** | Exact same minute OR overlapping dwell times exceeding platform capacity | Red badge, red row highlight |
| **Soft Warning** | Within 2 minutes of another bus at same platform | Yellow badge, yellow row highlight |
| **OK** | No overlap | No indicator |

### Dwell Time Calculation

A bus occupies a platform from **arrival** to **departure**:

```
Arrival Time = Departure Time - Dwell Time
Dwell Time = Recovery Time (if set) OR default 2 minutes
```

**Conflict occurs when:**
```
Bus A: arrives 9:00, departs 9:02
Bus B: arrives 9:01, departs 9:03
Overlap: 9:01 - 9:02 (1 minute) = HARD CONFLICT
```

**Soft warning when:**
```
Bus A: departs 9:02
Bus B: arrives 9:03
Gap: 1 minute = SOFT WARNING (within 2-min threshold)
```

### Data Model Enhancements

```typescript
// ============================================
// CONFLICT DETECTION TYPES
// ============================================

type ConflictSeverity = 'hard' | 'soft' | 'none';

interface PlatformConflict {
  id: string;
  severity: ConflictSeverity;
  platform: {
    hubName: string;
    platformId: string;
  };
  timeWindow: {
    startMin: number;       // Minutes from midnight
    endMin: number;
    overlapMinutes: number; // For hard: actual overlap. For soft: gap minutes
  };
  involvedTrips: ConflictingTrip[];
  dayType: DayType;
}

interface ConflictingTrip {
  tripId: string;
  routeNumber: string;
  direction: 'North' | 'South';
  blockId: string;
  arrivalTime: string;      // HH:MM format
  departureTime: string;
  stopName: string;
}

interface ConflictAnalysisResult {
  dayType: DayType;
  analyzedAt: Timestamp;
  scheduleVersion: number;
  totalRoutes: number;
  summary: {
    hardConflicts: number;
    softWarnings: number;
    conflictingTrips: number;   // Unique trips involved
    affectedPlatforms: number;
  };
  conflicts: PlatformConflict[];
}

// ============================================
// ENHANCED MASTER SCHEDULE ENTRY
// ============================================

interface PublishedSchedule {
  // ... existing fields ...

  // NEW: Conflict analysis results (auto-populated on publish)
  conflictAnalysis?: {
    [dayType: string]: ConflictAnalysisResult;
  };
}
```

### Auto-Run on Publish

When a schedule is published to Master, automatically run conflict analysis:

```typescript
// In publishService.ts

async function publishToMaster(
  draft: DraftSchedule,
  userId: string
): Promise<PublishedSchedule> {

  // 1. Create published schedule (existing logic)
  const published = createPublishedSchedule(draft, userId);

  // 2. NEW: Run conflict analysis for ALL routes + this route's day type
  const conflictResults = await runConflictAnalysis(
    draft.dayType,
    published.routeNumber
  );

  // 3. Store conflict results with the schedule
  published.conflictAnalysis = {
    [draft.dayType]: conflictResults
  };

  // 4. Save to Firestore
  await savePublishedSchedule(published);

  // 5. Return with conflict info for immediate display
  return published;
}
```

### UI Enhancements

#### 1. Master Schedule View - Conflict Badge

```
┌─────────────────────────────────────────────────────────────┐
│  MASTER SCHEDULE                                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Day Type: [Weekday ▼]                                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Routes                                              │    │
│  │                                                     │    │
│  │  [400] [100] [7]  [8] ⚠️ [11] [12] 🔴 [2]          │    │
│  │                    ↑              ↑                 │    │
│  │              soft warning    hard conflict          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🔴 2 Hard Conflicts  ⚠️ 3 Soft Warnings             │    │
│  │ [View All Conflicts]                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 2. Conflicts Panel (Expandable)

```
┌─────────────────────────────────────────────────────────────┐
│  PLATFORM CONFLICTS - Weekday                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  🔴 HARD CONFLICTS (2)                                      │
│  ────────────────────                                       │
│                                                              │
│  Downtown - Stop 1                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 9:00 AM - 9:02 AM (2 buses, capacity 2)             │   │
│  │                                                      │   │
│  │ • Route 2B Block 201 - arrives 9:00, departs 9:02   │   │
│  │ • Route 7B Block 301 - arrives 9:01, departs 9:03   │   │
│  │                                                      │   │
│  │ Overlap: 1 minute                                    │   │
│  │ [Jump to Trip] [Jump to Trip]                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Park Place - P2                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3:30 PM - 3:32 PM (2 buses, capacity 1)             │   │
│  │                                                      │   │
│  │ • Route 2A Block 102 - arrives 3:30, departs 3:32   │   │
│  │ • Route 7A Block 302 - arrives 3:31, departs 3:33   │   │
│  │                                                      │   │
│  │ Overlap: 1 minute                                    │   │
│  │ [Jump to Trip] [Jump to Trip]                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ⚠️ SOFT WARNINGS (3)                                       │
│  ────────────────────                                       │
│                                                              │
│  Georgian College - Stop 330                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 10:02 AM → 10:03 AM (1 min gap)                     │   │
│  │                                                      │   │
│  │ • Route 8A Block 401 - departs 10:02                │   │
│  │ • Route 100 Block 501 - arrives 10:03               │   │
│  │                                                      │   │
│  │ Gap: 1 minute (tight turnaround)                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 3. Schedule Table - Row Highlighting

```
┌─────────────────────────────────────────────────────────────┐
│  ROUTE 2B - WEEKDAY                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Block │ Park Place │ Downtown │ Ferndale │ ... │ Status   │
│  ──────┼────────────┼──────────┼──────────┼─────┼──────────│
│  201   │ 8:30       │ 8:45     │ 8:52     │ ... │          │
│  201   │ 9:00       │ 🔴 9:00  │ 9:07     │ ... │ 🔴 Conflict│
│  201   │ 9:30       │ 9:45     │ 9:52     │ ... │          │
│  202   │ 10:00      │ ⚠️ 10:15 │ 10:22    │ ... │ ⚠️ Warning │
│  202   │ 10:30      │ 10:45    │ 10:52    │ ... │          │
│                                                              │
│  Legend: 🔴 Hard Conflict  ⚠️ Soft Warning                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Clicking on highlighted cell shows tooltip:
┌─────────────────────────────────────┐
│ Platform Conflict at Downtown Stop 1│
│                                     │
│ This trip conflicts with:           │
│ • Route 7B Block 301 at 9:01 AM     │
│                                     │
│ Overlap: 1 minute                   │
│ [View in Conflicts Panel]           │
└─────────────────────────────────────┘
```

### Platform Configuration UI

Add ability to edit platform assignments (currently hardcoded):

```
┌─────────────────────────────────────────────────────────────┐
│  PLATFORM CONFIGURATION                                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Hub: [Downtown ▼]                                          │
│                                                              │
│  Platform Assignments:                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Stop 1 (Capacity: 2)                                │    │
│  │ Routes: [101] [2] [2B] [7] [7B] [8B] [11] [12B]    │    │
│  │ [Edit Routes] [Change Capacity]                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Stop 2 (Capacity: 2)                                │    │
│  │ Routes: [100] [7A] [8A] [10] [12A]                  │    │
│  │ [Edit Routes] [Change Capacity]                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  [+ Add Platform]                                           │
│                                                              │
│  Stop Codes: 1, 2, 10                                       │
│  [Edit Stop Codes]                                          │
│                                                              │
│  [Save Configuration]                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Service Module Enhancements

```typescript
// utils/platformConflictService.ts (NEW)

interface PlatformConflictService {
  // Run analysis for a specific day type
  analyzeConflicts(dayType: DayType): Promise<ConflictAnalysisResult>;

  // Get conflicts for a specific route
  getConflictsForRoute(
    routeNumber: string,
    dayType: DayType
  ): PlatformConflict[];

  // Get conflicts for a specific trip
  getConflictsForTrip(tripId: string): PlatformConflict[];

  // Check if a trip has conflicts
  tripHasConflict(tripId: string): ConflictSeverity;

  // Get summary for display
  getConflictSummary(dayType: DayType): ConflictSummary;
}

interface ConflictSummary {
  hardConflicts: number;
  softWarnings: number;
  routesWithConflicts: string[];
  worstPlatform: { hub: string; platform: string; count: number };
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `utils/platformAnalysis.ts` | Add soft warning detection, return trip IDs |
| `utils/platformConfig.ts` | Move to Firestore (editable) |
| `utils/publishService.ts` | Add auto-run conflict analysis on publish |
| `components/PlatformSummary.tsx` | Add soft warning display |
| `components/MasterSchedule/MasterScheduleView.tsx` | Add conflict badge, conflicts panel |
| `components/ScheduleTableEditor.tsx` | Add row highlighting for conflicts |

### Files to Create

| File | Purpose |
|------|---------|
| `utils/platformConflictService.ts` | Enhanced conflict detection with soft warnings |
| `components/MasterSchedule/ConflictsPanel.tsx` | Dedicated conflicts display |
| `components/MasterSchedule/PlatformConfigEditor.tsx` | Edit platform assignments |
| `components/common/ConflictBadge.tsx` | Reusable conflict indicator |
| `components/common/ConflictTooltip.tsx` | Hover tooltip for conflicts |

### Migration: Platform Config to Firestore

1. Create `teams/{teamId}/platformConfig/` collection
2. Migrate `HUBS` array from `platformConfig.ts` to Firestore
3. Add UI for editing platform assignments
4. Keep `platformConfig.ts` as default/fallback

---

## 10. Locked Logic

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

## 11. Migration Plan

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

1. Rename `ScheduleTweakerWorkspace` → `ScheduleEditorWorkspace`
2. Update to use `draftService` instead of `ScheduleDraft`
3. Rename `MasterScheduleBrowser` → `MasterScheduleView`
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

### Phase 6: Brochure Generator

1. Create `brochureService.ts` and `brochureTypes.ts`
2. Build Brochure Template Editor UI
3. Build PDF generation with `@react-pdf/renderer`
4. Add batch generation capability
5. Test with Route 2 brochure as reference

### Phase 7: Platform Conflict Detector

1. Enhance `platformAnalysis.ts` with soft warning detection
2. Create `platformConflictService.ts` with enhanced API
3. Add auto-run on publish in `publishService.ts`
4. Build conflict badges and highlighting in Master Schedule view
5. Build Conflicts Panel component
6. Add Platform Configuration editor (move config to Firestore)
7. Add row highlighting in ScheduleTableEditor

---

## 12. File Reference

### Key Files (Current)

| Purpose | File | Status |
|---------|------|--------|
| App entry | `App.tsx` | Keep |
| Fixed route workspace | `components/FixedRouteWorkspace.tsx` | Modify |
| Schedule table editor | `components/ScheduleEditor.tsx` | Rename → ScheduleTableEditor |
| Schedule tweaker | `components/ScheduleTweakerWorkspace.tsx` | Rename → ScheduleEditorWorkspace |
| Master browser | `components/MasterScheduleBrowser.tsx` | Rename → MasterScheduleView |
| New schedule wizard | `components/NewSchedule/NewScheduleWizard.tsx` | Refactor |
| CSV parser | `components/NewSchedule/utils/csvParser.ts` | Keep |
| Schedule generator | `utils/scheduleGenerator.ts` | Keep (LOCKED) |
| Runtime analysis | `utils/runtimeAnalysis.ts` | Keep (LOCKED) |
| Time utils | `utils/timeUtils.ts` | Keep (LOCKED) |
| Master schedule service | `utils/masterScheduleService.ts` | Modify |
| Data service | `utils/dataService.ts` | Modify (remove ScheduleDraft) |
| Export service | `utils/exportService.ts` | Modify |
| Platform analysis | `utils/platformAnalysis.ts` | Enhance (add soft warnings) |
| Platform config | `utils/platformConfig.ts` | Migrate to Firestore |
| Platform summary UI | `components/PlatformSummary.tsx` | Enhance |

### New Files (To Create)

| Purpose | File |
|---------|------|
| GTFS import | `utils/gtfsImportService.ts` |
| Draft operations | `utils/draftService.ts` |
| Publish operations | `utils/publishService.ts` |
| Brochure service | `utils/brochureService.ts` |
| Brochure types | `utils/brochureTypes.ts` |
| Schedule editor view | `components/ScheduleEditor/ScheduleEditorWorkspace.tsx` |
| Master schedule view | `components/MasterSchedule/MasterScheduleView.tsx` |
| GTFS import UI | `components/ScheduleCreator/GTFSImport.tsx` |
| Brochure template editor | `components/MasterSchedule/BrochureTemplateEditor.tsx` |
| Brochure generator | `components/MasterSchedule/BrochureGenerator.tsx` |
| PDF brochure document | `components/pdf/BrochureDocument.tsx` |
| Platform conflict service | `utils/platformConflictService.ts` |
| Conflicts panel | `components/MasterSchedule/ConflictsPanel.tsx` |
| Platform config editor | `components/MasterSchedule/PlatformConfigEditor.tsx` |
| Conflict badge | `components/common/ConflictBadge.tsx` |
| Conflict tooltip | `components/common/ConflictTooltip.tsx` |

### Type Definitions

| Types | File |
|-------|------|
| Core schedule types | `utils/masterScheduleTypes.ts` |
| Draft/Published types | `utils/scheduleTypes.ts` (NEW) |
| GTFS types | `utils/gtfsTypes.ts` (NEW) |
| Brochure types | `utils/brochureTypes.ts` (NEW) |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | January 13, 2026 | Planning Session | Initial document |
| 1.1 | January 13, 2026 | Planning Session | Added Brochure Generator spec; renamed Draft Editor → Schedule Editor, Published Browser → Master Schedule |
| 1.2 | January 13, 2026 | Planning Session | Added Platform Conflict Detector enhancement spec (Section 9) |

---

*End of Document*
