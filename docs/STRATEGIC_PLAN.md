# 2027–2032 Strategic Plan Workspace

Current contract for the Planning Data workspace at `#planning/strategic-plan`.

## Purpose

The workspace combines project control with a controlled evidence base for the 2027–2032 strategic plan. Its landing page opens a team-shared Project Work Plan plus source-specific workspace cards for the read-only existing-service baseline, annual Ridership Trends, the complete aggregated Transit App analysis, the canonical shared Fleet Plan, and the canonical published Master Schedule. The Project Work Plan is editable; it does not modify schedules, Master Schedule records, GTFS, performance data, Transit App source data, or Fleet Plan records.

## Project Work Plan and source baseline

- The initial baseline is a week-precision transcription of Dillon Consulting Limited's June 16, 2026 `Work Plan and Schedule`, PDF pages 6-7 (proposal pages 5-5 to 5-6). It retains the four phases, WBS identifiers, chapter groupings, Staff/Consultant/Joint ownership, task windows, draft/final deliverables, City review windows, project meetings, working sessions, Council presentations, and engagement events shown in the proposal.
- The active starter schedule shifts every dated proposal task and milestone four complete schedule weeks later, moving the working range to August 3, 2026 through September 27, 2027 while preserving weekly alignment, duration, and relative sequencing. This is a project-control adjustment, not a claim that the revised dates appeared in Dillon's proposal.
- Dependencies are prefilled only where the sequence is explainable from the work plan: kickoff before setup work, engagement planning before engagement activities, analysis before chapter documentation, completed chapter outputs before the draft plan, and draft/presentation gates before final delivery. These are planning assumptions for project-team confirmation, not consultant-confirmed critical-path commitments.
- The proposal identifies timing and proposed responsibility; it does not establish current completion. Seeded tasks therefore start as `Unconfirmed` with 0% progress. Rows with no dated bar in the source remain unscheduled instead of receiving an inferred date.
- The default user experience is Full Schedule: selecting any Gantt row or bar opens the complete task editor in a right-side drawer without leaving the schedule. Update Desk remains available for rapid status/progress maintenance, while Timeline provides a phase-led leadership view. Search, phase, owner, status, and zoom controls share the same in-memory work plan. The History control lists recent immutable revisions and stages an earlier snapshot for restoration as a new revision.
- Full Schedule supports direct, week-precision timeline editing. Dragging a bar moves the task and its associated review/milestone segments while preserving duration; dragging either endpoint changes only the selected task boundary. Keyboard users can make the same one-week changes with the left and right arrow keys. Dependencies never auto-cascade, and the interface tells the planner to review related tasks before saving. Full-screen mode expands the same editable schedule into a viewport planning canvas with pinned task labels and month headings, filters, zoom, and save access.
- `dataSourceTeamIds.strategicPlanWorkplan` may point Dillon or another partner team at Barrie's one canonical project-control schedule. Same-team Barrie members and configured Dillon members must each have `analyticsStrategicPlan`; that mapping grants access only to this work plan and does not broaden evidence, Fleet Plan, Master Schedule, GTFS, or performance writes. When the selector is absent, a team maintains its own work plan.
- The active document is `teams/{sourceTeamId}/strategicPlanWorkplans/default`. Each successful save uses the loaded `revision` for optimistic conflict detection, increments it by one, and creates an immutable full snapshot under `teams/{sourceTeamId}/strategicPlanWorkplans/default/versions/{revision}`. Each version adds an audit entry with the authenticated editor UID, display label, save time, summary, affected tasks, and before/after task-field values. Client input and Firestore rules bound the payload to 250 tasks, bind both the document and audit UID to the authenticated user, and require the matching immutable version in the same atomic write.
- Current status, progress, notes, dependencies, and revised dates are project-control records. They are not approvals of recommendations, policies, funding, targets, or delivered outcomes.

## Source and calculations

- Source: bundled `gtfs/routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, and `feed_info.txt`.
- Route families: Master-style route identities merge 2A/2B into 2, 7A/7B into 7, and 12A/12B into 12; 8A and 8B remain separate.
- Service span: first scheduled departure through final scheduled arrival, with endpoints rounded to the nearest 15 minutes and post-midnight service preserved.
- Frequency: scheduled headways are calculated independently for each route member, direction, and origin-to-destination service pattern. Sustained time bands average ordinary departure variation and alternating gaps, then the prevailing simultaneous pattern band becomes the route-level value rounded to five minutes. Peak is the shortest sustained headway; slower bands are duration-weighted into one off-peak value. All sustained windows for a selected regime remain visible, with endpoints rounded to 15 minutes. Route 2 is normalized to the communicated 30/60-minute service plan rather than the artificial 45/50-minute average produced by interlaced 2A/2B gaps. The trailing 60-minute headways on Routes 10/11 are retained even though these short regimes would normally be removed by the sustained-band filter. Uniform Sunday service at 60-minute or longer headways is classified as off-peak; Routes 100/101 retain their distinct peak and off-peak regimes. Routes 100/101 use their 41-minute scheduled loop runtime as the simplified off-peak planning value: Monday-Saturday spans show only the final loop, while Sunday retains its sustained morning and evening off-peak windows. Other isolated boundary gaps are omitted, and `N/A` means there is no service in that frequency category or no service.
- Revenue hours: sum of scheduled trip time from first departure to final arrival across the route family. Terminal recovery and deadhead are excluded because they are not represented as revenue trip time in static GTFS.

The feed version and validity dates stay visible in the workspace. This is a static planning snapshot, not live service or published Master Schedule data.

## Transit App evidence and source of truth

- Canonical metadata remains `teams/{sourceTeamId}/transitAppData/default` in Firestore.
- The complete aggregate remains the single JSON object referenced by that metadata under `teams/{sourceTeamId}/transitAppData/{timestamp}.json` in Cloud Storage.
- The standalone Transit App workspace and Strategic Plan workspace use the same shared query/cache and reusable analysis view. The Strategic Plan does not import, copy, transform, or persist another aggregate.
- `dataSourceTeamIds.transitApp` may point a restricted Strategic Plan team at the owning team's canonical Transit App source. Cross-team reads continue through `sharedWorkspaceData`, which validates both the configured source-team link and the requester's workspace permission.
- A user may read the aggregate when granted either `analyticsTransitApp` or `analyticsStrategicPlan`. Import and overwrite operations still require `analyticsTransitApp`; the embedded Strategic Plan view has no re-import control.
- The `strategic-plan-only` access package grants only `analyticsStrategicPlan`. It exposes the embedded evidence without exposing the standalone Transit App workspace or other planning workspaces.

Transit App records are evidence of app engagement, requested trips, inferred origins and destinations, itinerary stop mentions, and transfer patterns. They do not by themselves establish boardings, unique riders, residence, trip completion, or service need.

## Fleet Plan evidence and source of truth

- Canonical metadata remains `teams/{teamId}/fleetPlan/default` in Firestore, and its `storagePath` continues to identify the one active normalized workbook JSON in Cloud Storage.
- The standalone Fleet Plan editor and Strategic Plan evidence card read that same current workbook through `utils/fleet-plan/fleetPlanService.ts`. The Strategic Plan does not import, copy, transform, version, or persist another workbook.
- The embedded evidence is a read-only 2027–2032 view of the current workbook. It shows planned fleet totals, retirements, replacement purchases, growth purchases, and unit-level timeline values while omitting all save, replace, issue-resolution, and export controls.
- A same-team user may read the active Fleet Plan with either `analyticsFleetPlan` or `analyticsStrategicPlan`. Fleet Plan version-history reads remain under `analyticsFleetPlan`; all writes remain restricted to team owners/admins or an audited support edit session.
- `dataSourceTeamIds.fleetPlan` may point a restricted Strategic Plan team at Barrie's canonical Fleet Plan. Cross-team reads use `sharedWorkspaceData`, which verifies the configured source-team link and either Fleet Plan or Strategic Plan permission. The source selector grants no write or version-history access.

Fleet Plan records describe current planning assumptions for vehicle lifecycle, replacements, and growth. They do not by themselves establish approved capital funding, procurement timing, vehicle availability, operating cost, or Council approval.

## Annual Ridership evidence and source of truth

- The Strategic Plan embeds the existing Ridership Trends workspace and reads the same compact projection referenced by `teams/{sourceTeamId}/performanceData/metadata.ridershipTrendStoragePath`.
- `dataSourceTeamIds.performance` selects the STREETS source for a partner team. Strategic Plan reads use `sharedWorkspaceData`, including for same-team access, so the endpoint can enforce the Strategic Plan context without granting the standalone Ridership Trends route.
- A member with `analyticsStrategicPlan` can read this embedded annual view. The standalone Planning Data module continues to require `analyticsRidershipTrend`, and projection writes retain their existing manager/support/server restrictions.

Annual Ridership is fixed-route boarding activity, not unique riders. It does not include Transit On Demand, establish causation, or justify a service change without operational context.

## Master Schedule evidence and source of truth

- Canonical metadata remains under `teams/{sourceTeamId}/masterSchedules/{routeIdentity}` in Firestore, and each entry continues to reference its current immutable JSON in Cloud Storage.
- The Strategic Plan embeds the existing `MasterScheduleBrowser` in explicit read-only mode. It does not create a Strategic Plan schedule table, snapshot, or copied Storage object.
- The embedded workspace exposes current published versions, route/day schedule tables, service-hour summaries, and platform activity. Timetable publishing and Copy to Draft controls are hidden.
- `dataSourceTeamIds.masterSchedules` may point a restricted Strategic Plan team at Barrie's canonical published schedules. Team Management provides a separate Master Schedule source selector; it does not overload the Transit App source.
- Same-team and configured cross-team reads are allowed with either `workspaceFixedRoute` or `analyticsStrategicPlan`. Master Schedule writes retain their existing team-manager/support rules and are not granted by Strategic Plan access.

Master Schedule records are the current published planning source. They are not evidence of actual service delivered, reliability, ridership, cost, or future Strategic Plan approval.

## Implementation and verification

- Workspace UI: `components/Analytics/StrategicPlanWorkspace.tsx`
- Editable work-plan UI: `components/Analytics/StrategicWorkplanWorkspace.tsx`
- Work-plan source model, audit diff, and persistence: `utils/strategic-plan/workplanBaseline.ts`, `workplanTypes.ts`, `workplanAudit.ts`, `workplanService.ts`
- Reusable Transit App analysis UI: `components/Analytics/TransitAppWorkspace.tsx`
- Reusable read-only Master Schedule UI: `components/MasterScheduleBrowser.tsx`
- Shared Transit App metadata/data query: `hooks/useTransitAppData.ts`
- Canonical source services: `utils/transit-app/transitAppService.ts`, `utils/fleet-plan/fleetPlanService.ts`
- Cross-team read gateway: `functions/src/sharedWorkspaceData.ts`
- Pure calculations: `utils/strategic-plan/serviceProfile.ts`, `utils/strategic-plan/fleetPlanEvidence.ts`
- Lazy bundled-data loading: `utils/strategic-plan/serviceProfileData.ts`
- Focused tests: `tests/strategicPlanServiceProfile.test.ts`, `tests/strategicPlanFleetEvidence.test.ts`, `tests/strategicWorkplanBaseline.test.ts`, `tests/strategicWorkplanAudit.test.ts`, `tests/StrategicWorkplanWorkspace.test.tsx`, `tests/StrategicPlanWorkspace.test.tsx`, `tests/strategicWorkplanFirestoreRules.emulator.test.ts`, the repeatable `test:strategic-workplan-browser` smoke, shared-source security regressions, and Planning Data routing/access tests

The workspace uses the standard Planning Data feature flag and access-profile registrations. Its landing page visually separates the editable project-control card from the read-only evidence-card library. It adds only the explicitly shared Strategic Plan work-plan document and immutable audited versions; it does not duplicate Transit App, Fleet Plan, Master Schedule, GTFS, or performance datasets.
