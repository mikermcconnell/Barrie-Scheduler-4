# Connections Feature

## Overview

The Connections feature enables transit planners to define external services (GO Trains, Georgian College class bells) that buses should coordinate with. This document focuses on the Connection Library (targets and their times); route-level assignment, status/optimization, and scheduling behavior should be documented separately.

## Scope and Assumptions

- Times are stored as minutes from midnight in local service-day time (e.g., 7:45 AM = 465).
- If after-midnight service is supported, represent times beyond 1440 (e.g., 25:15 = 1515) to keep ordering monotonic.
- `DayType` values and holiday rules are shared with the schedule calendar (define in `utils/connectionTypes.ts`).
- This doc does not define route assignment, connection buffers, or optimization logic.

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
- If `type = 'route'`, define route-linkage fields (e.g., `routeId`, `direction`, `timepointStopCode`) in `utils/connectionTypes.ts` and document them here.
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
| Type definitions | `utils/connectionTypes.ts` |
| Firebase service | `utils/connectionLibraryService.ts` |
| Main panel (Editor) | `components/connections/ConnectionsPanel.tsx` |
| Library UI | `components/NewSchedule/connections/ConnectionLibraryPanel.tsx` |
| Add target modal | `components/NewSchedule/connections/AddTargetModal.tsx` |

## Known Issues (Feb 2026 Review)

| ID | Issue | Severity | Status | Details |
|----|-------|----------|--------|---------|
| **C4** | Stop code not validated against known stops | Medium | Open | Only checks non-empty; doesn't verify against GTFS stop list. `AddTargetModal.tsx:183` |
| **C7** | Panel edits don't refresh editor indicators | High | Open | `ConnectionsPanel` maintains local state and doesn't notify parent `ScheduleEditor`. Indicators only update after closing/reopening panel. Fix: add `onLibraryChanged` callback prop. |
| **C8** | Route-based target resync only in panel lifecycle | Medium | Open | Derivation/resync from master schedules happens in `ConnectionsPanel` local state, not wired to editor state. |

### Untested Areas

No connection-specific test coverage exists in `tests/`. Priority test targets:
- `utils/connectionUtils.ts` - day filtering, stop-code matching
- `AddTargetModal.tsx` - validation (required stop code, unique name, enabled time/day)
- Panel → Editor sync (C7 regression guard)

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
