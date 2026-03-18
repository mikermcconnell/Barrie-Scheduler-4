# Temporary Step 4 Handoff - 2026-03-18

## Purpose
Use this file as a quick handoff for a new chat session about stabilizing **Step 4** of the **New Schedule Wizard** in Scheduler 4.

## User Story
**As a transit planner,** I want the **Step 4 schedule editor** to behave predictably when I review and edit generated schedules, **so that** I can safely adjust trip times, review deltas, compare against master schedules, and continue my work without flicker, resets, incorrect values, or crashes.

## Acceptance Criteria
- Up/down nudges work once and do not flicker.
- Direct edits persist correctly.
- Local edits are not overwritten by parent state echoes.
- Delta indicators stay correct and stable.
- Compare-to-master stays accurate.
- Save/resume restores Step 4 accurately.
- Resetting deltas returns to the intended original generated schedule.
- A planner can complete a normal Step 4 workflow without confusion or crashes.

## Locked Logic Reminder
Read and respect before changing schedule-generation behavior:
- `docs/CONTEXT_INDEX.md`
- `docs/rules/LOCKED_LOGIC.md`
- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`

Do **not** casually change generation, runtime math, routing, timing, or block assignment behavior.

## Work Already Completed

### 1) Wizard default mode
- Fresh New Schedule Wizard now defaults to **Create from Performance Data**.
- Fresh resets and new project flow also return to that default.

### 2) Step 4 maximum update depth / flicker fix
- File: `components/NewSchedule/steps/Step4Schedule.tsx`
- Root cause: local Step 4 editor state was syncing upward, then parent state echoed back down and reset the local undo state.
- Result: clicking a delta up-arrow could bounce between states until React hit maximum update depth.
- Fix: only reset local Step 4 state when a truly external schedule payload arrives.

### 3) Step 4 edit lifecycle hardening
- File: `components/ui/StackedTimeInput.tsx`
- External grid-triggered edit mode now only starts on the actual transition into edit mode.
- This reduces cells reopening or re-triggering while rerendering.

### 4) Grid callback stabilization
- File: `components/schedule/RoundTripTableView.tsx`
- Grid callbacks were memoized to reduce re-render churn during editing.

### 5) Schedule editor cleanup
- File: `components/ScheduleEditor.tsx`
- Removed leftover unused editing-hook wiring and noisy debug logging.

### 6) Compare-to-master baseline fix
- File: `components/schedule/RoundTripTableView.tsx`
- Master comparison matching now uses **direction + trip ID** instead of just trip ID.
- This avoids North/South collisions when trip IDs overlap.

### 7) Step 4 save/resume baseline fix
- Files:
  - `components/NewSchedule/NewScheduleWizard.tsx`
  - `components/NewSchedule/steps/Step4Schedule.tsx`
  - `hooks/useWizardProgress.ts`
  - `utils/services/newScheduleProjectService.ts`
- Root cause: Step 4 previously saved only the **current edited schedules**.
- That meant after resume/reload, the editor could lose the true original generated baseline used for deltas and reset.
- Fix: persist **both**:
  - `generatedSchedules` = current edited version
  - `originalGeneratedSchedules` = original generated Step 4 baseline
- Step 4 now restores that saved original baseline after resume/reload.
- `Reset Deltas` should now return to the true generated schedule.
- Older saved projects still load through a fallback that treats the saved generated schedule as the original baseline when the new field is missing.
- The old stop-ID repair path was also mirrored into the saved original baseline so reset does not bring back placeholder stop IDs.

## Other Work Completed In This Broader Thread
These are not the main Step 4 items, but they happened in the same session:
- Step 1 route picker for performance data changed from dropdown to clickable route tabs/cards.
- Step 2 runtime chart fixed to use real per-bucket totals instead of repeating one band average.
- Step 2 confidence indicators added for weak buckets.

## Current Known Good Verification
Latest checks completed successfully after the Step 4 save/resume fix:
- `npx tsc --noEmit` ✅
- `npm run build` ✅

## Current State of Step 4
Step 4 is in a much better place than before.

### Improved already
- No more known local/parent reset loop on arrow nudges.
- Lower edit-mode churn.
- More trustworthy compare-to-master matching.
- Save/resume now preserves the original baseline for deltas/reset.

### Still worth hardening
The next best slice is:
1. **Undo/redo regression pass**
2. **Edit-flow regression pass**
3. **Compare-mode interaction checks while actively editing**

## Recommended Next Task
Do a focused **undo/redo and edit-flow regression hardening pass** for Step 4.

### Suggested checks
- Nudge a time, then undo/redo.
- Direct-edit a time, then undo/redo.
- Edit multiple cells in sequence and confirm history order is sensible.
- Toggle compare mode on/off before and after edits.
- Save, reload, and confirm:
  - current edited schedule is restored
  - original generated baseline is restored
  - reset returns to the original generated baseline
- Try route/day/project switching to confirm the editor only resets when it should.

## Useful Files
- `components/NewSchedule/NewScheduleWizard.tsx`
- `components/NewSchedule/steps/Step4Schedule.tsx`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`
- `components/ui/StackedTimeInput.tsx`
- `hooks/useWizardProgress.ts`
- `utils/services/newScheduleProjectService.ts`

## Good Opening Prompt For Next Chat
"Continue the Step 4 stabilization work in Scheduler 4. Read AGENTS.md and the Tier 1 docs in the prescribed order. Step 4 already has fixes for the local/parent reset loop, direction-aware compare matching, and save/resume of the original generated baseline. Continue with an undo/redo and edit-flow regression hardening pass. Verify with typecheck and build before reporting back."
