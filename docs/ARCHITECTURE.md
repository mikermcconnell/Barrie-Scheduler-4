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

## Key Files

| Purpose | File |
|---------|------|
| Trip generation | `utils/scheduleGenerator.ts` |
| CSV parsing | `components/NewSchedule/utils/csvParser.ts` |
| Runtime analysis | `utils/runtimeAnalysis.ts` |
| Excel parsing | `utils/masterScheduleParserV2.ts` |
| Block assignment | `utils/blockAssignment.ts` |
| Schedule display | `components/ScheduleEditor.tsx` |
| AI optimization | `api/optimize.ts` |
| Connection optimization | `utils/connectionOptimizer.ts` |

---

## Firestore Structure

```
teams/{teamId}/
├── draftSchedules/{draftId}/
│   ├── name, routeNumber, dayType
│   ├── content: MasterScheduleContent
│   ├── status, basedOn
│   └── createdAt, updatedAt, createdBy
│
├── masterSchedules/{routeId}_{dayType}/
│   ├── routeNumber, dayType
│   ├── content: MasterScheduleContent
│   ├── version, publishedAt, publishedBy
│   └── history: [previous versions]
│
└── gtfsCache/
    └── lastImport, routes, stops, schedules
```

---

## Data Flow

```
CREATE (from CSV):
  Runtime CSV → csvParser → scheduleGenerator → Draft

IMPORT (from GTFS):
  GTFS Feed → gtfsImportService → Draft

EDIT:
  Published Master → Copy to Draft → Edit → Publish

EXPORT:
  Published Master → Excel/CSV (never from drafts)
```
