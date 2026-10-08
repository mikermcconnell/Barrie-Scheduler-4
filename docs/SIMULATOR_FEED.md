# Simulator Day Feed

Durable contract for the per-day STREETS feed consumed by the Barrie City Simulator (a separate repository, `City Simulator 2`) for its "replay yesterday" transit view.

## Purpose and boundary

The City Simulator animates Barrie Transit buses over a 3D model of the city. To show what buses actually did, it needs each trip's stop-by-stop scheduled and observed times plus passenger activity for one service day. Scheduler 4 already receives that data daily (see `docs/AUTO_INGEST_SETUP.md`), so it publishes the feed rather than the simulator running a second ingest.

The feed is a read model only. It does not change performance history, dashboard metrics, schedules, GTFS, or import status. The two repositories share this data contract, not code.

## Publication

- `publishSimulatorDays` (`functions/src/simulatorDayJob.ts`) runs when a `teams/{teamId}/performanceImports/{importId}` record changes to `completed`. That covers queued Power Automate imports and authenticated in-app imports.
- It reads the import's archived raw CSV, parses it with the existing STREETS parser, and builds one day file per service date (`functions/src/simulatorDayPublish.ts`, pure builder in `functions/src/simulatorDay.ts`).
- Each day is uploaded to an immutable generation path, then the date's pointer in `teams/{teamId}/simulatorFeed/metadata` is moved in a transaction. The previous generation is deleted only after the pointer commit.
- A date is replaced only by an import with an equal or newer performance source revision, so an older import finishing late cannot overwrite a same-day correction.
- Days older than 380 days before the newest published day are removed, matching detailed performance retention.
- Failures are logged and written to `lastError` on the feed metadata. They never change the import's status or retry the import.
- `functions/scripts/backfill-simulator-days.mjs` (`npm run backfill:simulator-days -- --team TEAM_ID [--start] [--end] [--apply]`) rebuilds a date range from the newest completed import per date. It is a dry run unless `--apply` is passed.

## GTFS matching

Each day is matched against the archived Barrie GTFS feed (`gtfsArchive/barrie/snapshots`, written by `archiveGtfsFeeds`) whose date range covers the service date; the newest covering snapshot wins. If none covers the date, the newest snapshot is used and the day is marked `gtfs.covers: false`. The packaged missed-trip schedule bundle (`data/gtfsScheduleBundle.json`) is not used.

- A trip matches by identical STREETS `TripID` and GTFS `trip_id` among trips running that date (`match: 'trip-id'`); otherwise by the active trip leaving the same first stop at the same scheduled time, preferring a matching route short name (`match: 'first-stop-time'`). Unmatched trips keep `gtfsTripId: null`.
- STREETS stop IDs resolve to GTFS `stop_id` directly or through `stop_code`; unresolved stops are written as `streets:<StopID>`.
- Matched trips are shifted onto the GTFS clock, so after-midnight service uses times past 24:00 as GTFS does.
- `quality.tripsMatched` against `quality.trips` is the first thing to check on a new feed.

## Data rules

The builder follows `docs/OPERATIONS_DASHBOARD_METRICS.md`:

- Duplicate observations of one trip/stop/position keep the observation closest to schedule.
- `InBetween` rows are passenger-only: their boardings and alightings are added to the matching stop visit, or kept as a passenger-only visit (`flags & 2`) whose times must not be used. Trips with only passenger rows are omitted.
- `load` is APC `DepartureLoad` only when `APCSource > 0`, capped at the vehicle's configured capacity (`performanceConfig/load`). Scheduler 4 does not treat `DepartureLoad` as reliable enough for planning displays (see `docs/ARCHITECTURE.md`, Load Along the Route), so consumers should prefer load inferred from boardings and alightings and present APC load as supporting evidence only.
- Operator identity is never included. Vehicle, block, route, and trip identifiers are.

## File contract (schema 1)

Times are seconds after midnight of the service day on the GTFS clock.

```ts
interface SimulatorDay {
  schema: 1;
  serviceDate: string;               // YYYY-MM-DD
  dayType: 'weekday' | 'saturday' | 'sunday';
  generatedAt: string;
  source: { kind: 'streets-csv'; name: string; sha256: string };
  gtfs: { version: string | null; start: string | null; end: string | null; covers: boolean; origin: string };
  quality: { rows; inBetweenRows; duplicateRows; missingAvl; missingApc; loadCapped; trips; tripsMatched };
  trips: {
    id: string; gtfsTripId: string | null; match: 'trip-id' | 'first-stop-time' | null;
    routeId: string; routeName: string; direction: string; tripName: string; block: string; vehicle: string;
    start: number; detour: boolean; tripper: boolean;
    // [stopId, routeStopIndex, schedArr, schedDep, obsArr|null, obsDep|null, boardings, alightings, load|null, flags]
    visits: [string, number, number, number, number | null, number | null, number, number, number | null, number][];
  }[];
  // Optional: [lat, lon] of each stop that did not resolve to GTFS, keyed by its `streets:<StopID>`
  // visit id (mostly temporary detour stops). Omitted when every stop resolved.
  stops?: Record<string, [number, number]>;
}
```

Visit flags: `1` timepoint, `2` passenger-only. `stops` is an additive field within schema 1: readers that don't know it ignore it. The simulator uses it to place temporary stops when it draws detour paths. Breaking changes bump `schema` and must be made in both repositories (`functions/src/simulatorDay.ts` here, `src/data/streetsDay.ts` in the simulator).

## Access

Day files live at `teams/{teamId}/performanceViews/simulator-days/{date}/{generation}.json` and the pointer document at `teams/{teamId}/simulatorFeed/metadata`. Neither has a client rule beyond the support-session catch-alls; ordinary clients read only through `sharedWorkspaceData`:

- `workspace: 'simulatorDayIndex'` returns available days, newest first.
- `workspace: 'simulatorDay', serviceDate: 'YYYY-MM-DD'` returns one day file.

Both use the performance data-source mapping and the Load Profiles permission boundary (`canReadSimulatorFeed`: Operations access plus passenger-load access, admin/internal by default), because the files contain per-trip passenger activity.

## Deployment

Deploy `publishSimulatorDays` and the updated `sharedWorkspaceData` (`npx firebase deploy --only functions:publishSimulatorDays,functions:sharedWorkspaceData`), then run the backfill dry run, review the matched-trip counts, and rerun with `--apply`. No Firestore or Storage rule changes are required.
