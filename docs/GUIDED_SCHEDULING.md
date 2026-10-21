# Guided Scheduling Workflow

Feature contract for the guided, five-step fixed-route scheduling process. Load after `AGENTS.md` and `docs/CONTEXT_INDEX.md`. Read `docs/rules/LOCKED_LOGIC.md` before changing generation, timing, routing, blocking, or schedule-editor behavior; this contract never overrides it.

Status: **in development** (decisions recorded 2026-10-16). All five steps are built behind a feature flag. Step 1 offers all day types for one route. Step 2 reviews and approves each day type separately. Step 3 sets each day type's blocks and cycle. Step 4 builds the schedule when the planner continues from Step 3, then runs Manual tweaks → Connections with the reset rule. Step 5 publishes each day type through the draft editor, then opens the brochure and run cutting. The set autosaves (one project per day type) and can be reopened from Step 1; day types can be dropped at any step. The legacy New Schedule wizard in `components/NewSchedule/` remains the shipped path until the guided workspace reaches parity. Verify delivery status from current code and tests.

Design references: `docs/mockups/guided-scheduling-mockup.html` (all five steps) and `docs/mockups/step4-recommended-mockup.html` (Step 4 detail). Mockups use sample data and are not behavior contracts.

## Purpose

Turn the existing scheduling capabilities into one ordered process that walks the planner from observed data to an export package. This is a reorganization of existing capabilities, not a new scheduling engine.

## The five steps

| Step | Name | Planner outcome | Reused engine |
|---|---|---|---|
| 1 | Select data | Route (buttons, none preselected), day types, STREETS date range | Performance runtime import (`computeRuntimesFromPerformance`) |
| 2 | Review time bands | Reviewed 30-minute buckets and their A–E bands; explicit approval | Step 2 review builder and v2 approved runtime contract |
| 3 | Set the stage | Span of service and vehicles as a per-block list, cycle, recovery | `ScheduleConfig` from the existing Step 3 |
| 4 | Build the schedule | Auto-build → Manual tweaks → Connections | `generateSchedule`, connection optimizer, Schedule Editor and `RoundTripTableView` |
| 5 | Package | Draft review and publish per day type, then brochure and run-cut workbook | `publishService`, Timetable Publisher, Operations Planning |

## Decisions

- **Scope.** Step 1 shows every route with STREETS data as a button, with nothing selected. Picking a route selects Weekday, Saturday, and Sunday; the planner can untick any day type. No route data loads until the planner chooses a time frame (a quick range, all data, or a custom range); then only the months in that window load. Each chip shows that day type's stop-level data. Selected day types without usable data are skipped with a notice. The guided workflow uses STREETS data only; CSV and GTFS stay in the legacy wizard.
- **Schedule set.** "All day types" creates one single-day-type project per day type, linked by a shared schedule-set identifier. Each day type keeps its own approval contract, fingerprints, Step 3 configuration, and generated schedule. The planner may drop a day type (for example, no Sunday service or no Sunday data); the brochure then covers only the remaining days.
- **Save and resume.** The set autosaves 2 seconds after each change, one day-type project at a time, with a Saving / Saved / conflict status in the header. A save made elsewhere (another tab) stops autosave with a conflict rather than overwriting it. Step 1 lists saved sets (route, day types, step reached, data window, last saved) with Open and Delete. Reopening restores each day type's review inputs, exclusions, approval, Step 3 settings, schedules, optimizer reset snapshot, and draft id; the approval check still runs, so a reopened approval stays approved only while its inputs match. Saved "published" marks are not trusted: publish status is re-read from Master on reopen. Re-analyzing the same route keeps the set; a different route starts a new set.
- **Drop a day type.** Any step, after a confirm, except the last day type. The day's saved project is deleted and the set's selection drops it; Step 5 gates and run cutting use the remaining days.
- **Explicit Step 2 approval.** Approval is a deliberate planner action. Continue stays disabled until the current review is approved, and warnings must be acknowledged before approval. This supersedes the legacy auto-approve-on-continue behavior described in `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md`. Blocked reviews still cannot be approved (LOCKED_LOGIC rule 7).
- **Step 2 views.** Show the 30-minute buckets coloured by the A–E band each falls into, a band summary, and the bucket evidence table with Exclude / Restore. The legacy review panel stays available under "Full detail". Banding logic and the restore-eligibility rule are unchanged. Paired-cycle buckets with fewer than 5 qualifying days start excluded (they could never be banded or approved). Each bucket without a band shows, as a faded striped bar and a faded band badge with a "uses HH:MM" note, the banded bucket whose runtime its trips will use. This mirrors the generator's nearest-bucket rule (locked rule 7: nearest around the clock, earlier on a tie) and is display only. Each bucket shows P50 (the segment-median sum the schedule uses), P80 (observed cycles), and the real same-day cycle median on hover; P50 turns amber when real cycles ran 2+ minutes longer, and P80 turns amber when it is 5+ minutes above P50. Band cards show each band's min–max, and a note says bands are review groupings only (each trip uses its own half-hour's runtime), flagging when all banded half-hours sit within 3 minutes.
- **Step 3 model.** Keep the per-block list: span is the block start and end times, and the vehicle count is the number of blocks. Step 3 is setup only; generation moves to Step 4.
- **Step 4 order.** "Continue to Build" generates the schedule and opens Manual tweaks; Connections comes second (decision 2026-10-20, replacing Generate → Connections → Manual tweaks).
  - Step 4 builds a day automatically when it has no current schedule and the planner has no manual edits or optimizer run to lose. Otherwise it shows a stale warning, and the planner uses Regenerate (with a confirm when edits would be replaced).
  - Saved sets whose stage is the old "generate" open on Manual tweaks.
  - Manual tweaks opens with "Compare against" set to the generated baseline, so every change shows against what was generated. The legacy wizard's Step 4 still opens with no comparison.
  - Running the optimizer stores a snapshot of the schedule as it was just before the run. Reset restores that snapshot, so manual edits are never discarded by a connections reset.
  - Re-running the optimizer after manual tweaks starts from the tweaked schedule.
- **Step 4 table.** A guided display mode on the existing `RoundTripTableView`; editing behavior stays in the existing Schedule Editor code path rather than a parallel table. See the Step 4 design notes below.
- **Publish gate.** Step 5 exports unlock only after every day type left in the set has a confirmed published Master version. Publishing uses the existing draft → ready for review → publish path with all of its protections; the guided workflow never writes Master directly.
- **Version pinning.** The brochure and run cutting pin the versions published from this set. If a newer Master version appears, both stop and ask the planner to re-pin; nothing switches versions silently.
- **Export package.** The public brochure (Timetable Publisher PDF) and the run-cut workbook (`_runcut.xlsx` from Operations Planning). The run-cut workbook is the "one-cut package"; operator paddles remain out of scope.
- **Run cutting.** Keep the external Codex proposal round-trip. The guided step walks the planner through export, external run, import, validation, and approval. Codex proposes; the planner decides.

## Step 4 design notes

From the approved Step 4 mockup:

1. The table gets the screen: one compact header row; fixed table header and Block column.
2. Stages are a segmented control with live status (generated, connections met, edit count).
3. Blocks are visible: hovering a trip highlights its block; a Blocks view shows one lane per vehicle with pull-out, pull-in, and hours.
4. Colour marks exceptions only: short layover, recovery share or headway off target, and planner edits.
5. Clicking a trip opens an inspector drawer over the table.
6. An issues control lists operational issues and jumps to the row, using the existing schedule review checks.
7. Connection markers appear in full during the Connections stage and only as misses elsewhere.
8. A show-changes toggle compares against the generated schedule.
9. Hour separators aid scanning.
10. Edit controls are at least 24 px with a keyboard hint.
11. Trip times and recovery are editable; add/remove trip and block changes come from the existing editor.
12. **Fix headways** (Step 4 review tools, shared with the old wizard; replaces "Regularize headway"):
    - A **Target Hdwy** column holds one target per round-trip row. The system pre-fills an estimate: the row's current headway rounded by ratio to 10, 15, 30, 45 or 60 (56 → 60, 46 → 45, 36 → 30). A lone odd value inside a steady run takes the run's value; an alternating pattern is kept for the planner to decide. Typed values override estimates.
    - **Fix headways** sets only the last recovery of each block's previous round trip, then shifts that block's later trips. It never adds, deletes or reassigns trips, and each block's first trip (pull-out) stays fixed. Headway is measured the same way as the Hdwy column. One click is one undo step.
    - A recovery that would fall below 5 min turns its Recovery cell red. The panel offers "Use N min headway" or "Accept short recovery"; adding a bus is a Step 3 block change.
    - Typed targets are saved with the guided day (`build.headwayTargets`, keyed by round-trip row) and cleared when the schedule is generated again. Logic: `utils/schedule/headwayHold.ts`.

## Terms

- **Bucket:** a 30-minute slot of observed runtime evidence (approved or review-only).
- **Band:** the A–E runtime grade a bucket falls into. Bands are runtime categories, not continuous clock spans.
- **Block:** one vehicle's chain of trips. In Step 3 the number of blocks is the vehicle count.
- **Recovery:** buffer between trips (LOCKED_LOGIC durable term). The mockups label recovery at the end-of-cycle terminal as "LAY" (layover); whether "layover" becomes a distinct user-facing label is an open question.
- **Schedule set:** the linked day-type projects created by one guided run.

## Architecture

The guided workflow is a new shell that reuses the existing engine.

- Shell: `components/GuidedSchedule/GuidedScheduleWorkspace.tsx`, mounted as the `guided-schedule` view in `components/workspaces/FixedRouteWorkspace.tsx` behind the `fixedGuidedSchedule` flag in `utils/features.ts` (off by default; enable with `VITE_FEATURE_FIXED_GUIDED_SCHEDULE=true`). While the flag is off, only the primary developer (scheduler-admin claim plus the primary developer email, `components/GuidedSchedule/guidedScheduleAccess.ts`) sees the workspace. This hides UI only; data access still goes through existing rules. Hidden from planner and external-planner access levels, like New Schedule.
- Step gate: `components/GuidedSchedule/guidedSteps.ts`. Step 2 needs a review computed for the current Step 1 selection; Step 3 and later need a current approved contract; undelivered steps cannot be entered.
- Step 1: `components/GuidedSchedule/GuidedStep1.tsx` and `components/GuidedSchedule/guidedSelection.ts` (selection state and per-day-type readiness). Step 2 holds one review per selected day type, shown as tabs; Step 3 needs every reviewed day type approved.
- Runtime review: `components/GuidedSchedule/runtimeReview/`. It calls the same pure Step 2 functions as the legacy wizard (review builder, approval, invalidation, fingerprints, stop order, runtime computation, banding) instead of sharing the legacy wizard's inline glue. The route chosen in Step 1 is the route identity for the whole review, so canonical stops cannot be dropped by a later route-number change. Changing the Step 1 selection after analysis requires re-analysis. The Step 2 view is `GuidedStep2Review.tsx` with display helpers in `runtimeReview/guidedBandView.ts`.
- Step 3 mounts the existing `Step3Build` per day type with that day type's approved contract.
- Step 4: `components/GuidedSchedule/build/`. `generateGuidedSchedule.ts` mirrors the legacy generate step (strict approved-runtime mode, segments map from the approved day type's runtime rows, optional master recovery copy, block sync, generated-input fingerprint). `guidedBuildState.ts` holds the per-day-type schedule, the generated baseline, and the optimizer snapshot that the reset restores. Connections mount `Step5Connections`; Manual tweaks mount `Step4Schedule`. A schedule is current only while its fingerprint matches the approved contract and Step 3 settings; Step 5 needs every day type current.
- Step 5: `components/GuidedSchedule/package/`. "Open in draft editor" opens `ScheduleEditorWorkspace` over the guided workspace, so publishing keeps the editor's protections (ready for review, publish note, team owner/admin). A day type counts as published only when Master's `publishedFromDraft` equals the draft opened from the current Step 4 schedule. Exports unlock when every day type is published: the Timetable Publisher (`PublicTimetable`, preselected route) and Run Cutting (`RunCuttingWorkspace`, optional `initialSelection` preselecting the route's published day types).
- Reused engine: Step 2 utilities in `components/NewSchedule/utils/`, `utils/ai/runtimeAnalysis.ts`, `utils/schedule/scheduleGenerator.ts`, `utils/blocks/blockAssignmentCore.ts`, `utils/connections/`, `utils/services/newScheduleProjectService.ts`, `utils/services/publishService.ts`, `components/Reports/PublicTimetable.tsx`, and `components/workspaces/RunCuttingWorkspace.tsx`.
- Persistence: `components/GuidedSchedule/persistence/`. `guidedSetPersistence.ts` maps one day type to and from a `users/{uid}/newScheduleProjects` record (id `${scheduleSetId}_${dayType}`; fields in `docs/SCHEMA.md`). `useGuidedAutosave.ts` debounces and queues saves with the project revision. `GuidedSavedSets.tsx` is the Step 1 list. The review hook's `restore()` reopens a review with its exclusions and approval. Legacy wizard projects do not open in the guided workspace, and the legacy project list hides guided projects.

Danger zones (`components/ScheduleEditor.tsx`, `components/schedule/RoundTripTableView.tsx`, generator, block assignment) keep their locked behavior. Changes there are display or wiring only unless the planner explicitly approves a locked-logic change.

## Delivery phases

Each phase is one verified commit.

| Phase | Scope | Layer |
|---|---|---|
| 0 | This contract and doc alignment | Docs |
| 1 | Guided shell, step frame, and Step 1–2 with explicit approval (delivered behind flag) | Frontend |
| 2 | Step 3 setup and Step 4 Generate → Connections → Tweaks with the reset rule (delivered behind flag) | Frontend |
| 3 | Step 4 guided table mode and inspector (not started) | Frontend |
| 4 | Schedule sets: autosave, resume from Step 1, drop day type (delivered behind flag) | Frontend + persistence shape |
| 5 | Package: per-day-type publish checklist and version confirmation (delivered behind flag) | Frontend |
| 6 | Export package: pinned brochure and guided run cutting (opened from Step 5 behind flag; version pinning not yet enforced) | Frontend |

## Open questions

- Version pinning: the brochure and run cutting open on the published route but do not yet refuse a newer Master version than the one published from this set.

- Should "layover" be a distinct user-facing label for terminal recovery?
- Recovery-share and minimum-layover targets for issue flags (mockups use placeholder 10–30% and 3 minutes; the existing table flags above 25% and below 10%).
- After-midnight display convention in the guided table (LOCKED_LOGIC rule 5 governs ordering).
- The brochure reads the user's team while run cutting reads the linked source team; teams with linked Master data may see different schedules. Left unchanged until decided.

## Verification

- Every phase: `npm run typecheck`, `npm run build`, and the focused tests for touched code.
- Generator and block-assignment tests must pass unchanged.
- Run `npm run docs:check` after changing this or any other context document.
- Before calling the workflow complete: one manual end-to-end pass in the running app on a real route with all day types.
