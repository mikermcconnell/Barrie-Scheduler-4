# Corridor Speed Map Implementation Plan

**Goal:** Add a `Corridor Speed` tool under `Scheduled Transit -> Planning Data` that uses Barrie GTFS geometry plus observed STREETS/AVL travel times to show where buses are slow by roadway corridor, time period, day type, and direction.

**Feature position:** New sibling analytics tool beside `Corridor Headway`, not a new top-level workspace.

**Primary user job:** Planning support. Surface slow corridors and runtime pressure points to inform schedule design, paddles, and corridor review.

## Approved product decisions

- Purpose is planning-first, not public-facing.
- Ship as a separate analytics tool: `Corridor Speed`.
- Corridor unit is merged roadway corridor, not raw stop-to-stop rendering.
- Phase 1 data source is existing STREETS imports only.
- Primary map metric is observed-vs-scheduled runtime delta.
- Tooltip/panel also shows observed speed in km/h.
- Reuse existing day type and time period model.
- Keep directions separate by default.
- Apply a minimum sample threshold and gray low-confidence corridors.
- Build the engine reusable, but optimize the first release for Barrie GTFS + Barrie STREETS conventions.

## Existing code to reuse

### UI shell

- `components/Analytics/AnalyticsDashboard.tsx`
  Add a new analytics card and a new route/view state for `corridor-speed`.
- `components/Mapping/HeadwayMap.tsx`
  Reuse the overall page shell, fullscreen behavior, hover/click interaction, and corridor GeoJSON rendering pattern.
- `components/Mapping/HeadwayFilterBar.tsx`
  Reuse as-is for MVP because the speed map uses the same `TimePeriod` and `DayType` controls.
- `components/shared/MapBase.tsx`
  Reuse the base Mapbox wrapper.
- `components/shared/StopDotLayer.tsx`
  Reuse for junction nodes if needed.

### Corridor geometry

- `utils/gtfs/corridorBuilder.ts`
  Source of merged Barrie corridor segments and geometry.
- `utils/gtfs/corridorHeadway.ts`
  Reuse `TimePeriod`, `DayType`, `TIME_PERIODS`, and `DAY_TYPES`.

### Performance data

- `utils/performanceDataTypes.ts`
  Existing STREETS storage types, especially `DailySummary`, `DailySegmentRuntimes`, and `DailySegmentRuntimeEntry`.
- `utils/performanceDataService.ts`
  Existing Firebase loader for team-scoped STREETS data.
- `utils/performanceDataAggregator.ts`
  Confirms observed segment runtime naming and bucketing:
  `segmentName = "{fromStop} to {toStop}"` using consecutive timepoints, bucketed to 30-minute scheduled departure buckets.
- `hooks/usePerformanceData.ts`
  Optional hook path if query caching is desired. Not required for MVP.

### Shared geometry math

- `utils/routing/geometryUtils.ts`
  Reuse `haversineDistance()` for corridor length calculations in meters.

## Core architecture

### 1. Build a corridor speed computation layer

Create a new utility focused on joining three things:

1. GTFS corridor geometry
2. GTFS scheduled runtimes by corridor and period
3. STREETS observed runtimes by corridor and period

Recommended new file:

- `utils/gtfs/corridorSpeed.ts`

This file should own:

- corridor length calculation from geometry
- scheduled trip traversal extraction from GTFS stop times
- STREETS segment-to-corridor matching
- period/day filtering
- confidence thresholds
- final styling metrics for the map

### 2. Keep the speed map independent from headway logic

Do not overload `corridorHeadway.ts` with runtime logic. The headway tool is already coherent and small. A separate `corridorSpeed.ts` keeps the feature legible and easier to test.

### 3. Load STREETS data directly inside analytics

The analytics workspace already has precedent for reaching into STREETS data directly from `StudentPassModule`. Follow the same pattern: the `Corridor Speed` tool should load performance metadata/data through `performanceDataService` instead of requiring users to enter the Operations workspace first.

## Data model

Recommended types in `utils/gtfs/corridorSpeed.ts`:

```ts
export type CorridorSpeedMetric = 'delay-minutes' | 'delay-percent' | 'observed-speed' | 'scheduled-speed';

export interface CorridorSpeedStats {
  segmentId: string;
  directionId: string;
  period: TimePeriod;
  dayType: DayType;
  sampleCount: number;
  lowConfidence: boolean;
  corridorLengthMeters: number;
  scheduledRuntimeMin: number | null;
  observedRuntimeMin: number | null;
  runtimeDeltaMin: number | null;
  runtimeDeltaPct: number | null;
  scheduledSpeedKmh: number | null;
  observedSpeedKmh: number | null;
  routeBreakdown: {
    route: string;
    sampleCount: number;
    scheduledRuntimeMin: number | null;
    observedRuntimeMin: number | null;
    observedSpeedKmh: number | null;
  }[];
}
```

Recommended constants:

- `MIN_SAMPLE_COUNT = 8` for corridor-period visibility
- `LOW_CONFIDENCE_COLOR = '#9ca3af'`
- a fixed diverging runtime-delta ramp centered on zero

## Matching strategy

This is the critical-path problem.

### Observed side

STREETS observations are stored as consecutive timepoint pairs:

- `routeId`
- `direction`
- `segmentName` formatted as `"{fromStop} to {toStop}"`
- `timeBucket`
- `runtimeMinutes[]`

### Corridor side

GTFS corridors are merged multi-stop segments with:

- ordered stop IDs
- ordered stop names
- route list
- merged geometry

### Mapping rule for MVP

For each corridor:

1. Expand it into its constituent consecutive stop pairs.
2. Build candidate observed STREETS segment names from those stop-name pairs.
3. Aggregate all matching observed STREETS entries for routes that belong to the corridor.
4. Filter by Barrie route membership and direction.

Important constraint:

- Only use observed segments that align to stop pairs fully contained within the corridor.
- Do not “nearest string” fuzzy-match arbitrary stop names in phase 1.

Recommended implementation shape:

```ts
type CorridorObservedIndex = Map<
  corridorSegmentId,
  Map<dayType, Map<period, CorridorObservedAggregate>>
>;
```

## Scheduled baseline strategy

Scheduled runtime should come from GTFS stop times, not from schedule editor drafts.

### Scheduled traversal definition

A scheduled trip contributes to a corridor-period bucket if:

- the trip serves the corridor entry and exit stops in order
- the trip route belongs to the corridor route set
- the trip service matches the selected day type
- the scheduled departure at corridor entry falls inside the selected time period

For each matching trip:

- corridor scheduled runtime = arrival(exit stop) - departure(entry stop)

Aggregate to:

- median scheduled runtime per corridor-period-direction
- trip count
- route breakdown

Recommendation:

- Use the median for both scheduled and observed runtime rollups in phase 1.
- Keep average as a possible future toggle, but not in MVP.

## Direction handling

The existing `CorridorSegment` type does not explicitly store direction. That is acceptable for headway, but weak for speed analysis.

Recommended change:

- extend `CorridorSegment` in `utils/gtfs/corridorBuilder.ts` with a stable direction key
- or add a derived wrapper type in `corridorSpeed.ts` that distinguishes directional traversals without disturbing existing headway consumers

Preferred MVP approach:

- leave `corridorBuilder.ts` unchanged
- derive directional corridor variants in `corridorSpeed.ts` using ordered stop traversal and route-direction information

This avoids risky churn in a working map feature.

## UI implementation

Recommended new files:

- `components/Mapping/CorridorSpeedMap.tsx`
- `components/Mapping/CorridorSpeedLegend.tsx`
- `components/Mapping/CorridorSpeedDetailPanel.tsx`

### `CorridorSpeedMap.tsx`

Responsibilities:

- load corridor geometry once
- load STREETS metadata and performance data for `teamId`
- compute speed stats from `corridorSpeed.ts`
- render corridor line layer
- support metric toggle, period toggle, day type toggle, and direction filter
- gray low-confidence corridors
- show hover popup
- open detail panel on click

Props:

```ts
interface CorridorSpeedMapProps {
  onBack: () => void;
  teamId?: string;
}
```

### `CorridorSpeedLegend.tsx`

Legend states for:

- faster than scheduled
- near scheduled
- moderately slower
- severely slower
- low confidence
- no data

### `CorridorSpeedDetailPanel.tsx`

Show:

- corridor label
- from/to anchors
- routes using corridor
- period/day type
- corridor length
- scheduled runtime
- observed runtime
- delta minutes
- delta percent
- observed speed km/h
- sample count
- low-confidence warning if applicable
- route breakdown table

## Analytics routing changes

Modify `components/Analytics/AnalyticsDashboard.tsx`:

1. Add new view type:
   - `'corridor-speed'`
2. Add new card:
   - title: `Corridor Speed`
   - description: observed travel speed and delay by roadway corridor using STREETS + GTFS
3. Render `CorridorSpeedMap` when selected

Do not remove or merge the existing `Corridor Headway` card in this phase.

## Suggested file-level task list

### Task 1: Build computation utility

Create:

- `utils/gtfs/corridorSpeed.ts`

Implement:

- corridor length calculator using `haversineDistance`
- GTFS stop-time parsing for scheduled corridor runtimes
- STREETS segment matching and observed runtime aggregation
- metric/style helpers

### Task 2: Unit-test the matching logic

Create:

- `tests/corridorSpeed.test.ts`

Cover:

- corridor length calculation
- corridor stop-pair expansion
- observed segment matching from `segmentName`
- scheduled runtime extraction from stop times
- low-confidence behavior
- direction separation

### Task 3: Build map UI

Create:

- `components/Mapping/CorridorSpeedMap.tsx`
- `components/Mapping/CorridorSpeedLegend.tsx`
- `components/Mapping/CorridorSpeedDetailPanel.tsx`

Reuse:

- `HeadwayFilterBar`
- `MapBase`
- `StopDotLayer`

### Task 4: Wire into analytics dashboard

Modify:

- `components/Analytics/AnalyticsDashboard.tsx`

Add:

- new card
- new view route
- `teamId` pass-through to the new map

### Task 5: Verification and manual QA

Verify:

- card appears under Planning Data
- feature handles missing STREETS data gracefully
- day type and period filters change metrics correctly
- clicking a corridor opens stable detail output
- low-sample corridors are not overstated

## Graceful empty states

MVP must handle these cases explicitly:

1. No STREETS dataset for the team
   - show an import-required empty state with a path to the Operations import flow
2. STREETS data exists but has no `segmentRuntimes`
   - explain that older imports may need re-import
3. Corridor has GTFS baseline but no observed samples
   - show as `No observed data`
4. Corridor has samples below threshold
   - show gray line and `Low confidence`

## Recommended styling behavior

Primary default metric:

- `delay-minutes`

Color semantics:

- green/blue: faster than scheduled
- neutral gray: near scheduled
- orange/red: slower than scheduled
- muted gray: low confidence or no data

Line weight:

- modestly increase with sample count
- clamp the range tightly so the map does not become unreadable

## Verification plan

### Automated

- `npm run test -- tests/corridorSpeed.test.ts`

### Manual

1. Open `Scheduled Transit -> Planning Data`.
2. Confirm `Corridor Speed` card shows.
3. Open the tool with and without STREETS data loaded.
4. Compare a few corridors against known Barrie runtime patterns.
5. Spot-check at least one corridor per major route family:
   - Route 1 / 100 corridor
   - Route 8 corridor
   - Route 11 corridor
   - Route 12 corridor
6. Validate that direction-specific slowdowns can diverge.

## Main risks

### 1. Stop-name mismatch between GTFS and STREETS

Risk:

- observed `segmentName` matching can silently drop valid samples

Mitigation:

- normalize stop names before comparison
- keep matching exact after normalization, not fuzzy
- log unmatched observed segments during development

### 2. Corridor merge level too coarse

Risk:

- a merged corridor may contain mixed performance conditions

Mitigation:

- keep detail panel anchored to from/to endpoints
- if needed later, split long corridors at major junctions or timepoints

### 3. Scheduled baseline instability

Risk:

- using all GTFS trips may blend branches or edge-case variants

Mitigation:

- restrict scheduled trips to routes included in the corridor
- use median runtime, not mean
- show route-level breakdown in detail panel

## Non-goals for phase 1

- live AVL feed ingestion
- trend charts by month or season
- export/PDF
- public-facing map polish
- automatic recommendations or AI commentary

## Follow-up after shipping

If the feature lands cleanly, update durable docs:

- `docs/ARCHITECTURE.md`
- `docs/PRODUCT_VISION.md`
- `docs/SCHEMA.md` if any stored type changes are introduced

