# Shuttle Planner Status

> Date: March 11, 2026
> Purpose: Handoff note for a new chat session

## Current position

The Shuttle Planner now exists as the first live mode inside the broader Route Planner direction in Planning Data.

It is wired into:

- `components/Analytics/AnalyticsDashboard.tsx`
- `components/Analytics/RoutePlannerWorkspace.tsx`

It renders from:

- `components/Analytics/ShuttlePlannerWorkspace.tsx`

The shared shell also now exposes planned `Existing Route Tweak` and `Route Concept` modes, and those flows now support saved route studies, map authoring, stop editing, and observed runtime evidence.

The parent Route Planner shell now also receives a shared project and scenario snapshot from Shuttle Planner so future modes can display live planning context.

The planned route modes also now hold neutral base-source setup state in the parent Route Planner controller, which is an early step toward moving planning state above the shuttle-specific workspace.

The planned route modes now also run through neutral draft project controllers so the shell can show real Route Planner draft names, descriptions, scenario types, patterns, and notes even before those modes have map editing.

Those planned route-mode drafts now persist locally, so route concept setup work survives shell remounts even before full project persistence is built.

Those planned route modes now also support local scenario selection, duplication, preferred-scenario marking, deletion, and compare-ready draft metrics inside the shell.

Those planned route modes now also support Firebase-backed save, duplicate, delete, and reopen flows through a neutral Route Planner project service.

Those planned route modes now also support first-pass map alignment editing with ordered waypoint clicks, draggable handles, undo, and clear actions.

Those planned route modes now also support stop editing with Barrie stop pickup, custom stop placement, draggable stop markers, and selected-stop detail editing.

Those planned route modes now also consume shared Corridor Speed / STREETS stop-to-stop runtime proxy data with day-type and time-period filters, matched-segment counts, and segment-level fallback disclosure.

Those planned route modes now also support markdown project-summary export and preferred-scenario scheduling handoff export from the runtime-aware display project.

Those planned route modes now also expose editable service-definition controls for scenario name, pattern, status, span, frequency, and layover.

Those planned route modes now also expose a stop-by-stop timetable preview in the workspace and exported handoff files.

Those planned route modes now also support interior stop timing anchors so key timed stops can shape the timetable.

Those planned route modes now also surface route-wide timing structure review and schedule-structure warnings when timed stops are still interpolated.

Those planned route modes now also support explicit timing profiles, start/end terminal hold assumptions, and schedule-ready terminal / anchor validation in both the planning engine and the workspace shell.

Those planned route modes now also support a first-pass coverage workflow with configurable walkshed assumptions and a local strategic market layer for Barrie hubs and schools.

The Shuttle Planner view now reads its persistence, selection, and editing state through `components/Analytics/useShuttlePlannerController.ts`.

Route Planner now instantiates that controller and passes it into a presentational shuttle workspace view.

Route Planner state ownership is now consolidated in `components/Analytics/useRoutePlannerController.ts`.

## What is done

- PRD drafted:
  - `docs/SHUTTLE_PLANNER_PRD.md`
- UI spec drafted:
  - `docs/SHUTTLE_PLANNER_UI_SPEC.md`
- Planning Data card and navigation added in `AnalyticsDashboard.tsx`
- Shuttle Planner shell added in `components/Analytics/ShuttlePlannerWorkspace.tsx`
- Map-first three-pane layout is in place
- Theme follows the Transit On-Demand workspace visual language
- Seeded scenarios are in place for demo purposes
- Stop list, compare toggle, KPI cards, warnings, and timetable preview are in place
- Firebase-backed project save, load, duplicate, and delete flows are wired into the workspace for signed-in users
- Local starter mode still works when the user is not signed in
- Shuttle scenario derivation now runs through the shared Route Planner planning layer while preserving shuttle-specific outputs
- neutral Route Planner draft project utilities now exist in:
  - `utils/route-planner/routePlannerDrafts.ts`
- neutral Route Planner draft persistence now exists in:
  - `utils/route-planner/routePlannerDraftStorage.ts`
- neutral Route Planner draft controllers now exist in:
  - `components/Analytics/useRoutePlannerDraftController.ts`
  - `components/Analytics/useRoutePlannerController.ts`
- neutral Route Planner project-state management now exists in:
  - `components/Analytics/useRoutePlannerProjectController.ts`
  - `utils/route-planner/routePlannerProjectState.ts`
- neutral Route Planner project persistence now exists in:
  - `utils/services/routePlannerProjectService.ts`
- first-pass route study map authoring now exists in:
  - `components/Analytics/useRoutePlannerProjectController.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
- observed runtime proxy application for route studies now exists in:
  - `utils/route-planner/routePlannerObservedRuntime.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
- route-study output and handoff formatting now exists in:
  - `utils/route-planner/routePlannerOutputs.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
- neutral Route Planner service-definition editing now exists in:
  - `components/Analytics/useRoutePlannerProjectController.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
- neutral Route Planner timetable preview generation now exists in:
  - `utils/route-planner/routePlannerTimetable.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
  - `utils/route-planner/routePlannerOutputs.ts`
- neutral Route Planner timing-anchor support now exists in:
  - `utils/route-planner/routePlannerPlanning.ts`
  - `components/Analytics/useRoutePlannerProjectController.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
- route-wide timing structure review now exists in:
  - `components/Analytics/RoutePlannerWorkspace.tsx`
  - `utils/route-planner/routePlannerPlanning.ts`
- schedule-ready timing-profile and terminal-hold controls now exist in:
  - `components/Analytics/useRoutePlannerProjectController.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
  - `utils/route-planner/routePlannerPlanning.ts`
  - `utils/route-planner/routePlannerOutputs.ts`
- starter coverage analysis now exists in:
  - `utils/route-planner/routePlannerCoverage.ts`
  - `utils/route-planner/routePlannerCoverageSeed.ts`
  - `components/Analytics/useRoutePlannerProjectController.ts`
  - `components/Analytics/RoutePlannerWorkspace.tsx`
  - `utils/route-planner/routePlannerPlanning.ts`
  - `utils/route-planner/routePlannerOutputs.ts`
- Shuttle domain files exist:
  - `utils/shuttle/shuttleTypes.ts`
  - `utils/shuttle/shuttleSeedData.ts`
- Shuttle project service stub exists:
  - `utils/services/shuttleProjectService.ts`
- `docs/ARCHITECTURE.md` was updated to mention the Shuttle Planner workspace shell

## What is not done

- The workspace still starts from local seeded scenarios before a user saves a project
- No road-snapped route drawing yet
- No road snapping yet
- No stop reordering yet
- No real timetable generation logic yet
- No downstream scheduling handoff yet

## Important notes

- The PRD still contains some older wording that assumed Shuttle Planner would be a dedicated top-level workspace. The actual implementation direction is now inside Planning Data.
- The shuttle-related files are local working changes and not committed.
- A working visual shell exists, but this is still a prototype surface rather than a functioning planner.

## Relevant files

- `components/Analytics/AnalyticsDashboard.tsx`
- `components/Analytics/ShuttlePlannerWorkspace.tsx`
- `utils/services/shuttleProjectService.ts`
- `utils/shuttle/shuttleTypes.ts`
- `utils/shuttle/shuttleSeedData.ts`
- `docs/SHUTTLE_PLANNER_PRD.md`
- `docs/SHUTTLE_PLANNER_UI_SPEC.md`
- `docs/ARCHITECTURE.md`

## Recommended next step

Replace the starter strategic market coverage layer with a real population / employment dataset now that the saved-study editor can compare coverage reach, show timing structure, and export a first scheduling handoff.

After that:

1. add census / employment-backed coverage metrics and scenario delta reporting on the neutral Route Planner path
2. keep replacing placeholder metrics and timetable values with more route-aware calculations
3. start shaping land-use-specific analysis layers after the demographic coverage layer is in place

## Suggested prompt for next chat

“Continue the Shuttle Planner work in Scheduler 4. It lives inside Planning Data in `components/Analytics/AnalyticsDashboard.tsx` and renders from `components/Analytics/ShuttlePlannerWorkspace.tsx`. The current state is a themed interactive shell with seeded data. Next step is to wire the workspace to `utils/services/shuttleProjectService.ts` for real project persistence, then move into map editing and road snapping. Read `docs/plans/2026-03-11-shuttle-planner-status.md`, `docs/SHUTTLE_PLANNER_PRD.md`, and `docs/SHUTTLE_PLANNER_UI_SPEC.md` first.” 
“Continue the Shuttle Planner / Route Planner work in Scheduler 4. Shuttle Planner lives inside Planning Data in `components/Analytics/AnalyticsDashboard.tsx` and renders from `components/Analytics/ShuttlePlannerWorkspace.tsx`. The current state is a Friendly-theme planning shell with signed-in Firebase persistence, shared route-planner derivation, a neutral `useRoutePlannerController.ts`, planned route modes that support saved multi-scenario route studies through `useRoutePlannerProjectController.ts` and `routePlannerProjectService.ts`, and first-pass map authoring in `RoutePlannerWorkspace.tsx` for both alignment and stop editing. Next step is to connect those saved route studies to shared runtime intelligence and segment-level confidence views. Read `docs/plans/2026-03-11-shuttle-planner-status.md`, `docs/ROUTE_PLANNER_PRD.md`, `docs/ROUTE_PLANNER_UI_SPEC.md`, and `docs/plans/2026-03-11-route-planner-build-plan.md` first.”
