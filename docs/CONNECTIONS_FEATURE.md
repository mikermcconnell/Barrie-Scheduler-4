# Connections Feature

## Overview

The Connections feature enables transit planners to define external services (GO Trains, Georgian College class bells) that buses should coordinate with. This document focuses on the Connection Library (targets and their times); route-level assignment, status/optimization, and scheduling behavior should be documented separately.

## Scope and Assumptions

- Times are stored as minutes from midnight in local service-day time (e.g., 7:45 AM = 465).
- If after-midnight service is supported, represent times beyond 1440 (e.g., 25:15 = 1515) to keep ordering monotonic.
- `DayType` values and holiday rules are shared with the schedule calendar (define in `utils/connections/connectionTypes.ts`).
- This doc does not define route assignment, connection buffers, or optimization logic.
- Planner-facing setup UI should describe connection intent as **to / from** the external service or route (for example, **to train**, **from train**, **to Route 8**, **from Route 8**). Keep arrival/departure wording for detailed timing math, previews, and diagnostics.

## Success Criteria

### For Transit Planners

1. **Centralized Library**: All connection targets defined in one shared location
2. **Clear Identification**: Each target has a name, type, location, and scheduled times
3. **Stop Code Based**: Targets reference stops by unique code, not ambiguous names

### For Passengers

1. **Predictable Connections**: Know which buses connect with GO Trains
2. **Reliable Information**: Connection points are clearly defined

## Key Concepts

### Connection Target

A service or event that buses should connect with:

| Type | Example | Times |
|------|---------|-------|
| Manual | GO Train to Toronto | Specific departure times (7:15 AM, 8:45 AM, etc.) |
| Manual | Georgian College Bell | Class start times (8:00 AM, 9:30 AM, etc.) |
| Route | Route 8B at Downtown | Pulled from master schedule |

Route targets should specify which route/stop/timepoint they reference and how they update when the master schedule changes.

### Connection Library

A team-wide collection of connection targets. Shared across all routes so planners define targets once and reuse them. Target names should be descriptive and unique within a team to reduce ambiguity in the UI.

## Data Model

### Stop Code Based

All connections use **stop codes** (unique identifiers) rather than stop names:

```
Stop Code: "777"
Stop Name: "Downtown Terminal" (for display only)
```

This ensures consistency because:
- Stop names can vary by direction (NB vs SB)
- Stop names may have abbreviations or formatting differences
- Stop codes are unique across the entire system

### Storage

```
teams/{teamId}/connectionLibrary/default → ConnectionLibrary (shared targets)
```

This is the application document path used by `utils/connections/connectionLibraryService.ts`.
The checked-in `firestore.rules` file does not currently declare a dedicated `connectionLibrary` match, so treat rules coverage for this path as something to verify explicitly.

### ConnectionTarget Structure

```typescript
{
  id: string;                    // Unique identifier
  name: string;                  // "GO Train to Toronto"
  type: 'manual' | 'route';      // How times are defined
  location?: string;             // "Allandale Waterfront GO Station"
  times?: ConnectionTime[];      // Manual time entries
  stopCode: string;              // Stop code for the connection point
  stopName?: string;             // Stop name (for display)
  icon?: 'train' | 'clock' | 'bus';
  createdAt: string;
  updatedAt: string;
}
```

Notes:
- If `type = 'manual'`, `times` is required and should include day-of-week applicability.
- If `type = 'route'`, define route-linkage fields (e.g., `routeId`, `direction`, `timepointStopCode`) in `utils/connections/connectionTypes.ts` and document them here.
- `stopCode` is required for matching; `stopName` is display-only.

### ConnectionTime Structure

```typescript
{
  id: string;
  time: number;                  // Minutes from midnight (e.g., 465 = 7:45 AM)
  label?: string;                // "Express to Union"
  daysActive: DayType[];         // ['Weekday', 'Saturday']
  enabled: boolean;
}
```

Notes:
- `time` uses minutes-from-midnight in local service-day time; after-midnight service should use values > 1440.
- `daysActive` should align with the schedule calendar rules (e.g., what counts as "Weekday").

## Validation Rules

- `stopCode` is required for all targets.
- Manual targets require at least one enabled time entry.
- Duplicate time + day combinations should be prevented or explicitly merged.
- `time` values must fall within the supported service-day range.

## User Workflow

### Build Connection Library

1. Open Connections panel from Schedule Editor toolbar
2. Click "Add Target"
3. Enter target details:
   - Name (e.g., "GO Train 7:45 AM Toronto")
   - Location (e.g., "Allandale Waterfront GO")
   - Stop code where buses connect
4. Add times with day-of-week applicability
5. Review for duplicates or missing stop codes
6. Save to team library

## Success Metrics

| Metric | Target |
|--------|--------|
| Target Definition | All major connections documented |
| Stop Code Coverage | Every target has a valid stop code |
| Time Accuracy | Times match published GO/College schedules |

## File Locations

| Purpose | File |
|---------|------|
| Type definitions | `utils/connections/connectionTypes.ts` |
| Firebase service | `utils/connections/connectionLibraryService.ts` |
| Main panel (Editor) | `components/connections/ConnectionsPanel.tsx` |
| Library UI | `components/NewSchedule/connections/ConnectionLibraryPanel.tsx` |
| Add target modal | `components/NewSchedule/connections/AddTargetModal.tsx` |

## February 2026 Review Items

C4, C7, and C8 from the February review are resolved in the current implementation. C9 remains a review item; verify its status against current code before planning work from this document.

| ID | Issue | Severity | Status | Details |
|----|-------|----------|--------|---------|
| **C4** | Stop code validation | Medium | Resolved | `AddTargetModal` validates manual and selected stop codes against the loaded schedule stop IDs when that reference set is available. |
| **C7** | Panel-to-editor state synchronization | High | Resolved | `ConnectionsPanel` reports library and route-config changes through callbacks; `ScheduleEditor` consumes both for in-session indicator refresh. |
| **C8** | Route-based target resync | Medium | Resolved | Route targets are refreshed from source master-schedule timestamps, persisted to the library, and synchronized to editor state. |
| **C9** | GO GTFS import is all-or-nothing | Medium | Open | The chooser bulk-imports all four GO station/direction templates at once. Add scope controls so planners can import only the station/direction they actually need. |

### Test Coverage Pointers

Relevant coverage includes:

- `tests/connectionUtils.test.ts` for connection utilities
- `tests/AddTargetModal.test.tsx` for add-target validation and behavior
- `tests/ConnectionLibraryPanel.test.tsx` for the library panel
- `tests/routeConnectionDefaults.test.ts` and `tests/RouteConnectionPanel.test.tsx` for route-connection defaults and display

When changing panel-to-editor synchronization, add or update a focused regression test for the callback flow.

---

## Example

### GO Train Connection Target

```
Name: "GO Train 7:45 AM Toronto"
Type: Manual
Location: "Allandale Waterfront GO Station"
Stop Code: "1234"
Icon: train

Times:
  - 7:45 AM (Weekday) - "Express to Union"
  - 8:15 AM (Weekday) - "Local to Union"
  - 9:00 AM (Saturday) - "Weekend Service"
```

### Georgian College Bell Target

```
Name: "Georgian College Morning Bell"
Type: Manual
Location: "Georgian College"
Stop Code: "5678"
Icon: clock

Times:
  - 8:00 AM (Weekday) - "First Period"
  - 9:30 AM (Weekday) - "Second Period"
  - 11:00 AM (Weekday) - "Third Period"
```
