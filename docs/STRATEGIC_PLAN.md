# 5-Year Strategic Plan Workspace

Current contract for the Planning Data workspace at `#planning/strategic-plan`.

## Purpose

The workspace provides a read-only existing-service baseline for five-year strategic-plan work. It summarizes the bundled Barrie Transit static GTFS into matching Weekday, Saturday, and Sunday route tables without modifying schedules, Master Schedule records, or the GTFS source.

## Source and calculations

- Source: bundled `gtfs/routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, and `feed_info.txt`.
- Route families: Master-style route identities merge 2A/2B into 2, 7A/7B into 7, and 12A/12B into 12; 8A and 8B remain separate.
- Service span: first scheduled departure through final scheduled arrival, with endpoints rounded to the nearest 15 minutes and post-midnight service preserved.
- Frequency: scheduled headways are calculated independently by route member and direction. Sustained regimes are averaged to one route-level value and rounded to five minutes. Each selected regime is shown as one approximate first-to-last window, rounded to 15 minutes; intermittent appearances inside that window are intentionally collapsed. `N/A` means there is no distinct regime or no service.
- Revenue hours: sum of scheduled trip time from first departure to final arrival across the route family. Terminal recovery and deadhead are excluded because they are not represented as revenue trip time in static GTFS.

The feed version and validity dates stay visible in the workspace. This is a static planning snapshot, not live service or published Master Schedule data.

## Implementation and verification

- Workspace UI: `components/Analytics/StrategicPlanWorkspace.tsx`
- Pure calculations: `utils/strategic-plan/serviceProfile.ts`
- Lazy bundled-data loading: `utils/strategic-plan/serviceProfileData.ts`
- Focused tests: `tests/strategicPlanServiceProfile.test.ts`, `tests/StrategicPlanWorkspace.test.tsx`, and Planning Data routing/access tests

The workspace uses the standard Planning Data feature flag and access-profile registrations. It introduces no persistence, API endpoint, or Firebase rule change.
