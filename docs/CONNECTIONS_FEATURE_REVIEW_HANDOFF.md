# Connections Feature Review Handoff

Last updated: February 6, 2026

## Context
We reviewed `CONNECTIONS_FEATURE` behavior in `ScheduleEditor` and compared implementation vs `docs/CONNECTIONS_FEATURE.md`.

## What Was Completed
- Located and reviewed feature spec:
  - `docs/CONNECTIONS_FEATURE.md`
- Reviewed editor integration points:
  - `components/ScheduleEditor.tsx`
  - `components/connections/ConnectionsPanel.tsx`
  - `components/NewSchedule/connections/AddTargetModal.tsx`
  - `components/schedule/SingleRouteView.tsx`
  - `components/schedule/RoundTripTableView.tsx`
  - `components/schedule/ConnectionIndicator.tsx`
  - `utils/connectionUtils.ts`
  - `utils/connectionTypes.ts`

## Current Definition of Success (Agreed Direction)
The feature is successful when all are true:
1. A planner can open Connections from Schedule Editor and maintain a single team-shared connection library.
2. Targets are unambiguous and complete: unique name, required stop code, type/location/times, day applicability.
3. Schedule cells show correct connection status for selected day from the library, and changes appear immediately after edits.
4. Route-based targets stay in sync with source master schedule changes.

## Findings From Review
1. High: In-session sync gap between `ConnectionsPanel` edits and `ScheduleEditor` display.
   - `ScheduleEditor` loads library once and passes it into table views.
   - `ConnectionsPanel` maintains/saves its own local library state and does not notify parent editor state.
2. Medium: Stop code is required but not validated against known stops.
   - This does not fully satisfy the metric "Every target has a valid stop code."
3. Scope note: spec explicitly focuses on library model/workflow, not full optimization behavior.

## Where We Left Off
You asked for a **pass/fail QA checklist** and a mapping to:
- code coverage status, and
- testing gaps.

I started checking tests and found no obvious connections-specific test coverage in `tests/`.

## Release-Gate QA Checklist (Pass/Fail)

| ID | Gate | Result | Coverage Status | Evidence |
|---|---|---|---|---|
| C1 | Planner can open Connections from Schedule Editor and edit team-shared library | PASS | Implemented but untested | `components/ScheduleEditor.tsx:1436`, `components/ScheduleEditor.tsx:1617`, `utils/connectionLibraryService.ts:51`, `utils/connectionLibraryService.ts:69`, `utils/connectionLibraryService.ts:107` |
| C2 | Target name must be unique (case-insensitive) | PASS | Implemented but untested | `components/NewSchedule/connections/AddTargetModal.tsx:172`, `components/NewSchedule/connections/AddTargetModal.tsx:173`, `components/NewSchedule/connections/AddTargetModal.tsx:174` |
| C3 | Stop code is required for target creation | PASS | Implemented but untested | `components/NewSchedule/connections/AddTargetModal.tsx:183`, `components/NewSchedule/connections/AddTargetModal.tsx:184` |
| C4 | Stop code is validated against known stops | FAIL | Missing | No validation path found in Add Target submit flow; only non-empty check in `components/NewSchedule/connections/AddTargetModal.tsx:183` |
| C5 | Manual target requires at least one enabled time with day applicability | PASS | Implemented but untested | `components/NewSchedule/connections/AddTargetModal.tsx:188`, `components/NewSchedule/connections/AddTargetModal.tsx:193`, `components/NewSchedule/connections/AddTargetModal.tsx:194` |
| C6 | Schedule cells compute status from library for selected day | PASS | Implemented but untested | `components/ScheduleEditor.tsx:1591`, `components/ScheduleEditor.tsx:1607`, `components/schedule/RoundTripTableView.tsx:1818`, `components/schedule/RoundTripTableView.tsx:2049`, `components/schedule/SingleRouteView.tsx:416`, `utils/connectionUtils.ts:64` |
| C7 | Edits in ConnectionsPanel appear immediately in ScheduleEditor table indicators (same session, no reopen) | FAIL | Partially implemented | `ConnectionsPanel` maintains local state (`components/connections/ConnectionsPanel.tsx:51`) and does not update parent `ScheduleEditor` library state loaded once in `components/ScheduleEditor.tsx:243`, `components/ScheduleEditor.tsx:251` |
| C8 | Route-based targets resync from source master schedules when source changes | FAIL | Partially implemented | Derivation/resync exists (`components/connections/ConnectionsPanel.tsx:129`, `components/connections/ConnectionsPanel.tsx:177`, `components/connections/ConnectionsPanel.tsx:189`), but only in panel-local lifecycle and not wired to editor state sync |

## Coverage Mapping Snapshot

- Implemented + covered by tests: **None found**
- Implemented but untested: C1, C2, C3, C5, C6
- Partially implemented: C7, C8
- Missing: C4

Evidence for testing gap:
- No matches in `tests/` for connections keywords (`connection`, `connectionLibrary`, `getConnectionsForStop`, `ConnectionIndicator`, `AddTargetModal`).

## Next Step For Resume
1. Fix **C7** first (highest impact): wire `ConnectionsPanel` updates back into `ScheduleEditor` state so indicator rows refresh immediately without closing/reopening the panel.
2. Minimal implementation shape:
   - Add `onLibraryChanged?: (library: ConnectionLibrary | null) => void` prop to `ConnectionsPanel`.
   - Call it when library loads and whenever `setConnectionLibrary` mutates state.
   - In `ScheduleEditor`, pass `setConnectionLibrary` into `ConnectionsPanel`.
3. Then add minimal test coverage:
   - Unit tests for `utils/connectionUtils.ts` day filtering and stop-code matching.
   - Component test for `AddTargetModal` validation (required stop code, unique name, enabled time/day requirement).
   - Integration test for edit-in-panel -> schedule indicator refresh (C7 regression guard).
