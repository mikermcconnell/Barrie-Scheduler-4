# 2027–2032 Strategic Plan Workspace

Current contract for the Planning Data workspace at `#planning/strategic-plan`.

## Purpose

The workspace provides a controlled evidence base for the 2027–2032 strategic plan. Its landing page uses source-specific workspace cards for the read-only existing-service baseline, the complete aggregated Transit App analysis, the canonical shared Fleet Plan, and the canonical published Master Schedule. It does not modify schedules, Master Schedule records, GTFS, Transit App source data, or Fleet Plan records.

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

Fleet Plan records describe current planning assumptions for vehicle lifecycle, replacements, and growth. They do not by themselves establish approved capital funding, procurement timing, vehicle availability, operating cost, or Council approval.

## Master Schedule evidence and source of truth

- Canonical metadata remains under `teams/{sourceTeamId}/masterSchedules/{routeIdentity}` in Firestore, and each entry continues to reference its current immutable JSON in Cloud Storage.
- The Strategic Plan embeds the existing `MasterScheduleBrowser` in explicit read-only mode. It does not create a Strategic Plan schedule table, snapshot, or copied Storage object.
- The embedded workspace exposes current published versions, route/day schedule tables, service-hour summaries, and platform activity. Timetable publishing and Copy to Draft controls are hidden.
- `dataSourceTeamIds.masterSchedules` may point a restricted Strategic Plan team at Barrie's canonical published schedules. Team Management provides a separate Master Schedule source selector; it does not overload the Transit App source.
- Same-team and configured cross-team reads are allowed with either `workspaceFixedRoute` or `analyticsStrategicPlan`. Master Schedule writes retain their existing team-manager/support rules and are not granted by Strategic Plan access.

Master Schedule records are the current published planning source. They are not evidence of actual service delivered, reliability, ridership, cost, or future Strategic Plan approval.

## Implementation and verification

- Workspace UI: `components/Analytics/StrategicPlanWorkspace.tsx`
- Reusable Transit App analysis UI: `components/Analytics/TransitAppWorkspace.tsx`
- Reusable read-only Master Schedule UI: `components/MasterScheduleBrowser.tsx`
- Shared Transit App metadata/data query: `hooks/useTransitAppData.ts`
- Canonical source services: `utils/transit-app/transitAppService.ts`, `utils/fleet-plan/fleetPlanService.ts`
- Cross-team read gateway: `functions/src/sharedWorkspaceData.ts`
- Pure calculations: `utils/strategic-plan/serviceProfile.ts`, `utils/strategic-plan/fleetPlanEvidence.ts`
- Lazy bundled-data loading: `utils/strategic-plan/serviceProfileData.ts`
- Focused tests: `tests/strategicPlanServiceProfile.test.ts`, `tests/strategicPlanFleetEvidence.test.ts`, `tests/StrategicPlanWorkspace.test.tsx`, `tests/sharedWorkspaceTransitAppAccess.test.ts`, security-rule regressions, and Planning Data routing/access tests

The workspace uses the standard Planning Data feature flag and access-profile registrations. It introduces no new persistence location or duplicated Transit App, Fleet Plan, or Master Schedule dataset.
