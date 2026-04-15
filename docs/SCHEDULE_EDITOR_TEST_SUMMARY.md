# Schedule Editor Test Summary

Last reviewed: April 10, 2026

## Scope

This document summarizes the automated tests currently wired to the Fixed Route Schedule Editor feature and notes the main coverage gaps that still remain.

Primary source files in scope:
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`
- `components/TravelTimeGrid.tsx`
- `components/workspaces/ScheduleEditorWorkspace.tsx`
- `components/NewSchedule/steps/Step4Schedule.tsx`
- `hooks/useAutoSave.ts`
- `hooks/useGridNavigation.ts`
- `hooks/useScheduleEditing.ts`
- `hooks/useTimeValidation.ts`
- `hooks/useTravelTimeGrid.ts`
- `utils/schedule/addTripPlanner.ts`
- `utils/schedule/masterComparison.ts`
- `utils/schedule/masterCycleMode.ts`
- `utils/schedule/scheduleEditorUtils.ts`

## How the test suite is wired

### Runner and config
- Test runner: `Vitest`
- Config location: `vite.config.ts`
- NPM scripts:
  - `npm test`
  - `npm run test:coverage`
  - `npm run test:smoke`
- Default environment: `jsdom`
- Globals enabled: `true`
- Setup files: none currently configured
- Test discovery:
  - `tests/**/*.test.ts`
  - `tests/**/*.test.tsx`
  - `tests/**/*.spec.ts`
  - `tests/**/*.spec.tsx`

### Test style in this area
- Most Schedule Editor UI tests use `react-dom/client` + `flushSync` and assert against the real DOM.
- Parent-level `ScheduleEditor` tests mock heavy children and services so they can verify editor wiring and behavior in isolation.
- `RoundTripTableView` has its own focused component tests for grid behavior, actions, accessibility, paste handling, timepoint display, and compare-to-master badges.
- Hook and utility logic is covered separately where logic is deterministic.

## Current automated tests in this feature area

### Schedule editor shell
- `tests/ScheduleEditor.interactions.test.tsx`
  - timeline edits trigger block reassignment
  - post-midnight timeline edits preserve operational ordering
  - large negative cascades propagate through suffixed downstream stops
  - recovery-stop nudges keep arrival fixed and update departure/recovery correctly
  - Ctrl/Cmd+S success and failure behavior
- `tests/ScheduleEditor.integration.test.tsx`
  - mounts the real `RoundTripTableView` inside `ScheduleEditor`
  - commits a real inline cell edit through the editor wiring
  - confirms downstream block cascade updates reach `onSchedulesChange`
- `tests/ScheduleEditor.publishOnly.test.tsx`
  - enforces draft -> publish flow and guards against direct editor-side upload-to-master actions
- `tests/ScheduleEditor.shell.test.tsx`
  - undo/redo shortcut behavior
  - fullscreen enter/exit behavior
  - connections panel open/close wiring
  - export workflow wiring
- `tests/ScheduleEditor.viewTabs.test.tsx`
  - editor / timeline / travel-times tab switching

### Round-trip table
- `tests/RoundTripTableView.accessibility.test.tsx`
  - labeled grid region
  - first populated cell selection on focus
  - meaningful ARIA labels
  - actions column visibility
  - no frozen first schedule column
  - connection badge placement on arrival vs departure cells
- `tests/RoundTripTableView.actions.test.tsx`
  - add-trip action uses correct trip context
  - row-actions menu works on south-only rows
  - row delete removes whole round trip
- `tests/RoundTripTableView.paste.test.tsx`
  - ambiguous pasted times reuse the existing AM/PM period
- `tests/RoundTripTableView.timepoints.test.tsx`
  - authoritative timepoints preserve authored stops
- `tests/RoundTripTableView.masterCompare.test.tsx`
  - aligned / new / removed / review-needed compare states

### Grid and travel-time editing
- `tests/useGridNavigation.test.tsx`
  - first/last populated cell jumps
  - Cmd copy/paste
  - F2 edit start
  - Tab and Shift+Tab movement
  - row-level Home and End behavior
  - Escape clears the active cell
  - recovery-cell arrow nudges
- `tests/TravelTimeGrid.test.tsx`
  - overnight row bucketing
  - keyboard-focusable cell controls
  - row context isolation
  - first displayed segment hour logic
  - delta display behavior
- `tests/useTravelTimeGrid.test.tsx`
  - bulk recovery edits
  - single-trip travel edits
  - bulk travel edits
  - skipping trips that do not serve an edited segment

### Editor hooks
- `tests/useAutoSave.test.tsx`
  - guest debounced local save
  - authenticated version save creates a draft first when needed
  - guest draft load and clear behavior
  - disabled mode does not save
  - firebase save failures surface error state
  - stale in-flight save does not incorrectly mark the draft as saved
- `tests/useScheduleEditing.test.tsx`
  - duplicate trip flow
  - delete trip flow
  - direction change flow
  - direct cell edit cascade
  - recovery edit clamping and downstream shift
  - delete cancel behavior
- `tests/useTimeValidation.test.tsx`
  - invalid time error state
  - auto-hide behavior
  - clear/reset behavior
  - validation classes helper

### Add-trip flow
- `tests/AddTripModal.test.tsx`
  - planner impact information
  - shorthand time preview
  - short-turn confirmation
  - full-cycle confirmation
  - northbound-first cycle behavior
- `tests/addTripPlanner.test.ts`
  - fixed presets
  - alternating preview items
  - full-cycle northbound-first planning
  - applying short-turn and paired cycle inserts

### Editor workspace and wizard handoff
- `tests/ScheduleEditorWorkspace.test.tsx`
  - save uses the active draft id
  - pending autosave flushes on unmount
  - publish is blocked when save fails
- `tests/Step4Schedule.test.tsx`
  - Step 4 passes approved runtime contract data into the editor when present

### Compare / cycle / utility logic used by the editor
- `tests/masterComparison.test.ts`
- `tests/masterCompareState.test.ts`
- `tests/masterCycleMode.test.ts`
- `tests/scheduleEditorUtils.headways.test.ts`
- `tests/SingleRouteView.layout.test.tsx`

## Verification run completed on April 10, 2026

### Targeted Schedule Editor run
Command:

```powershell
npx vitest run tests/ScheduleEditor.interactions.test.tsx tests/ScheduleEditor.integration.test.tsx tests/ScheduleEditor.publishOnly.test.tsx tests/ScheduleEditor.shell.test.tsx tests/ScheduleEditor.viewTabs.test.tsx tests/ScheduleEditorWorkspace.test.tsx tests/Step4Schedule.test.tsx tests/RoundTripTableView.accessibility.test.tsx tests/RoundTripTableView.actions.test.tsx tests/RoundTripTableView.masterCompare.test.tsx tests/RoundTripTableView.paste.test.tsx tests/RoundTripTableView.timepoints.test.tsx tests/useGridNavigation.test.tsx tests/TravelTimeGrid.test.tsx tests/useTravelTimeGrid.test.tsx tests/AddTripModal.test.tsx tests/addTripPlanner.test.ts tests/scheduleEditorUtils.headways.test.ts tests/masterComparison.test.ts tests/masterCompareState.test.ts tests/masterCycleMode.test.ts tests/SingleRouteView.layout.test.tsx tests/useAutoSave.test.tsx tests/useTimeValidation.test.tsx tests/useScheduleEditing.test.tsx
```

Result:
- 25 test files passed
- 99 tests passed
- 0 failures

### Full repo suite run
Command:

```powershell
npx vitest run
```

Result:
- 194 test files passed
- 2 test files skipped
- 1045 tests passed
- 10 tests skipped
- 0 failures

### Targeted coverage snapshot
Command:

```powershell
npx vitest run tests/ScheduleEditor.interactions.test.tsx tests/ScheduleEditor.integration.test.tsx tests/ScheduleEditor.publishOnly.test.tsx tests/ScheduleEditor.shell.test.tsx tests/ScheduleEditor.viewTabs.test.tsx tests/ScheduleEditorWorkspace.test.tsx tests/Step4Schedule.test.tsx tests/RoundTripTableView.accessibility.test.tsx tests/RoundTripTableView.actions.test.tsx tests/RoundTripTableView.masterCompare.test.tsx tests/RoundTripTableView.paste.test.tsx tests/RoundTripTableView.timepoints.test.tsx tests/useGridNavigation.test.tsx tests/TravelTimeGrid.test.tsx tests/useTravelTimeGrid.test.tsx tests/AddTripModal.test.tsx tests/addTripPlanner.test.ts tests/scheduleEditorUtils.headways.test.ts tests/masterComparison.test.ts tests/masterCompareState.test.ts tests/masterCycleMode.test.ts tests/SingleRouteView.layout.test.tsx tests/useAutoSave.test.tsx tests/useTimeValidation.test.tsx tests/useScheduleEditing.test.tsx --coverage --coverage.reporter=text
```

Notable file-level coverage from that targeted run:
- `components/ScheduleEditor.tsx`: 67.58% statements / 51.75% branches
- `components/schedule/RoundTripTableView.tsx`: 74.62% statements / 63.51% branches
- `components/TravelTimeGrid.tsx`: 56.96% statements / 55.07% branches
- `components/modals/AddTripModal.tsx`: 88.51% statements / 75.57% branches
- `components/workspaces/ScheduleEditorWorkspace.tsx`: 60.92% statements / 33.33% branches
- `hooks/useAutoSave.ts`: 77.86% statements / 68.33% branches
- `hooks/useGridNavigation.ts`: 68.33% statements / 58.08% branches
- `hooks/useScheduleEditing.ts`: 87.68% statements / 60% branches
- `hooks/useTimeValidation.ts`: 89.28% statements / 80% branches
- `hooks/useTravelTimeGrid.ts`: 72.38% statements / 44.82% branches
- `utils/schedule/addTripPlanner.ts`: 91.54% statements / 67.34% branches
- `utils/schedule/masterComparison.ts`: 98.11% statements / 87.77% branches
- `utils/schedule/masterCycleMode.ts`: 92.38% statements / 67.39% branches
- `utils/schedule/scheduleEditorUtils.ts`: 81.09% statements / 61.49% branches

## Assessment

### What is working well
- The editor has meaningful regression coverage for several high-risk behaviors:
  - overnight time handling
  - cascade edits
  - block reassignment after edits
  - draft -> publish safety
  - compare-to-master states
  - add-trip planning rules
  - keyboard grid basics
- The full repo suite currently passes.
- The most important editor business logic already has targeted tests rather than only broad smoke tests.

### Where the suite is not yet comprehensive
This area is solid, but it is **not yet comprehensive enough for best-practice confidence**.

Highest-value missing automated coverage:
1. More real integration tests for `ScheduleEditor` with the actual `RoundTripTableView`, beyond the current single inline-edit happy path.
2. More `RoundTripTableView` edit-path tests:
   - actual inline editing with `StackedTimeInput`
   - invalid explicit 12-hour inputs
   - recovery-cell editing and edge cases
   - copy/paste across more than one cell or row
3. Additional `ScheduleEditor` toolbar and shell coverage for:
   - route/day switching and filter interactions
   - publish button states
   - save status display states
   - compare-to-master review panel shell behavior
4. Manual or browser-level workflow coverage for:
   - copy master to draft -> edit -> save -> publish
   - add/delete/edit trip sequences in the real UI
   - compare-to-master review flow
   - accessibility sanity checks with actual keyboard traversal

## Recommended next additions

If more test work is scheduled, add these next in priority order:
1. Extend `tests/ScheduleEditor.integration.test.tsx`
2. Extend `tests/RoundTripTableView.*.test.tsx` for real edit/error paths
3. Add one browser smoke test dedicated to the Schedule Editor happy path
4. Add focused `ScheduleEditor` shell tests for route/day/filter state, publish states, and save-status display

## Manual verification checklist

Even with the current automated suite, still manually verify:
- open a real draft in Schedule Editor
- edit one regular time cell
- edit one recovery stop
- test one post-midnight trip
- add a short turn and a full cycle
- confirm compare-to-master badges look right
- save a version
- publish a draft
- confirm no direct Upload to Master action appears in the editor

## Bottom line

The current Schedule Editor suite is healthy and passing, and it covers several of the riskiest rules. It is good regression protection, but it is not yet a full best-practice safety net for this feature. The biggest remaining gap is full editor integration coverage around real inline editing, autosave, undo/redo, connections workflow, and end-to-end publish behavior.
