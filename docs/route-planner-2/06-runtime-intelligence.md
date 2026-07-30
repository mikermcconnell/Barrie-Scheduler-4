# Route Planner 2 Runtime Intelligence

## Goal

Runtime intelligence should turn a route concept into explainable operating estimates.

The evidence engine can derive scheduled, observed-proxy, and observed/scheduled-blend estimates. The current workspace deliberately requests scheduled-only GTFS evidence and can also use Mapbox Directions estimates for shaped stop-to-stop segments, with fallback assumptions when stronger evidence is unavailable.

## Required Outputs

- one-way runtime
- segment runtime
- intermediate stop dwell allowance
- cycle time
- buses required
- recovery time and recovery percent
- confidence level
- segment-level source disclosure
- warnings for weak or missing inputs

## Runtime Source Priority

For the current interactive workspace, use this priority order:

1. manual segment/runtime override if planner provided one
2. scheduled GTFS runtime evidence for the selected day type, time period, and planner-controlled route filter when available
3. Mapbox Directions estimate for the shaped stop-to-stop path
4. fallback estimate from distance or simple default speed
5. missing/not ready state

Manual overrides stay first because Route Planner 2 is a planning workspace. Automatic evidence can suggest better estimates, but it must not silently override planner-entered segment assumptions.
Mapbox should fill only gaps where scheduled GTFS evidence is not available for the current route/time selection.
Planners can switch a route to Mapbox-only runtime. In that mode, scheduled GTFS evidence is ignored for feasibility totals and Mapbox/drawn-route estimates are used when available, then fallback assumptions.
When GTFS runtime is enabled, the planner's explicit route filter controls matching: **Selected routes** overrides the imported source route, while **All matching** may use every matching scheduled route for that corridor.
When a drawn segment extends beyond a matched GTFS corridor, use the scheduled GTFS runtime for the covered portion and estimate the uncovered portion from the drawn-route estimate or fallback distance. Label this as partial GTFS coverage rather than presenting the whole segment as fully scheduled evidence.
When custom stops are not exactly GTFS stops but the drawn line follows a GTFS route shape, interpolate the matched shape overlap and use the proportional scheduled GTFS runtime for the covered portion before falling back to Mapbox.

### Implemented evidence flow

`deriveRoutePlanner2EvidenceRuntimeEstimates` matches each planner stop to GTFS candidates, then tries three evidence methods: a direct adjacent stop pair, a multi-edge scheduled corridor path, and GTFS shape overlap for custom stops. Corridor candidates must follow the drawn line; routes that detour away from it are rejected. A partially covered corridor produces `partial-scheduled-proxy` by combining scheduled runtime for the covered portion with the drawn-route or distance estimate for the remainder. Missing matches produce diagnostics rather than fabricated evidence; feasibility may still use Mapbox or fallback estimates afterward.

`runtimeSourceMode` and `runtimeRouteFilter` are planner-controlled. Mapbox mode skips this evidence flow. GTFS mode uses the selected day and period and either selected route short names or all matching corridor routes.

The derivation engine's default best-available basis can return `observed-proxy` or `observed-scheduled-blend` when observed samples are available. That capability and its sample-size behavior are unit-tested. `RoutePlanner2Workspace` currently passes `runtimeBasis: 'scheduled'`, so observed values do not drive the current interactive feasibility totals. Activating best-available evidence in the workspace requires an explicit product/UI decision and matching disclosure; agents must not describe the present scheduled-basis output as observed runtime.

For imported address routes, route creation should not wait on every Mapbox segment. Render the draft route immediately, then calculate Mapbox road path and segment runtimes in a bounded background queue with visible progress.
When a route is too large for automatic road snapping, keep the fallback alignment and still emit per-segment fallback runtime estimates so feasibility and stop cards remain usable. Do not leave large routes in a no-runtime state just because Mapbox snapping was intentionally skipped.

## Accepted Mapbox Runtime

Mapbox uses the standard `mapbox/driving` profile as an automotive planning estimate; it is not live-traffic or departure-time routing. The UI must disclose that provenance.

The first save of a draft with usable Mapbox segments establishes an accepted runtime baseline. After that, opening, rendering, or background road snapping must not silently replace it. **Refresh Mapbox estimate** bypasses the client cache and stages a comparison of accepted and candidate route totals and changed segments. The planner explicitly accepts the candidate or keeps the existing value. Both decisions are retained in bounded history. A runtime lock prevents acceptance until the planner unlocks the route.

This accepted/locked state governs Mapbox road-runtime refreshes only. Scheduled GTFS evidence is derived from the planner's current day, period, source-mode, and route-filter selections; it is not accepted through the Mapbox snapshot decision history.

Missing credentials, authorization failure, rate limits, network failure, invalid response, no-route response, and oversized routes are safe refresh failures. They must retain the accepted runtime, show a sanitized reason, and never expose credential values. Fallback estimates remain useful for new drafts but cannot replace an accepted runtime during a failed refresh.

## Segment-Level Disclosure

Each stop-to-stop segment should show:
- from stop
- to stop
- runtime minutes
- source
- confidence
- distance if available
- sample size if available
- scheduled runtime evidence if available
- observed runtime evidence if available
- matched stop IDs, match quality, and matched route IDs when evidence is used
- fallback reason if stronger data is missing
- a visible source badge such as `Scheduled GTFS · Route 400 · AM Peak`, `Mapbox estimate`, `Fallback estimate`, or `Planner override`
- when scheduled GTFS is missing and Mapbox/fallback is used, a direct explanation of the missing data gap
- when a planner override is active, the original automatic source and runtime underneath the override

The segment list should allow planners to enter or clear a manual runtime override. Manual overrides affect totals immediately and must not be overwritten by automatic Mapbox recalculation.

The right rail should include a compact runtime-source summary showing how many segments came from scheduled GTFS, Mapbox, fallback, or planner override sources.

## Confidence Model

Suggested confidence rules:

- `high`: most segments have exact or strong scheduled GTFS evidence; the evidence engine can also assign high confidence to sufficiently strong observed samples when best-available mode is used
- `medium`: Mapbox estimates, manual assumptions, partial scheduled coverage, or mixed observed and scheduled/fallback estimates
- `low`: mostly fallback estimates
- `not-ready`: missing terminals, too few stops, or no usable assumptions

Exact thresholds can be refined during implementation, but the UI must not hide uncertainty.

## Cycle Time

For v1 route concepts:

```text
one-way route runtime = rounded stop-to-stop segment runtime + intermediate stop dwell allowance
one-way cycle time = one-way route runtime * 2 + start terminal layover + end terminal layover
scheduled cycle window with a target bus count = selected GTFS scheduledCycleWindow, otherwise target buses * target frequency
closed-loop/out-and-back estimated full runtime = stop-to-stop segment runtime + intermediate dwell for the complete route shape
closed-loop/out-and-back buses required = ceiling(estimated full runtime / target frequency)
closed-loop/out-and-back scheduled cycle window = selected GTFS scheduledCycleWindow, otherwise buses required * target frequency
closed-loop/out-and-back recovery time = scheduled cycle window - estimated full runtime
closed-loop/out-and-back cycleTimeMinutes = scheduled cycle window
```

This is a planning estimate only. It is not the same as fixed-route generated schedule cycle logic.
Intermediate stop dwell is not terminal recovery. Keep terminal layover/recovery disclosed separately.

Closed-loop runtime includes the final segment from the last stop back to Stop 1.
Out-and-back runtime includes the reverse stop sequence from the turnaround stop back to Stop 1.
For closed-loop and out-and-back shapes, `cycleTimeMinutes` in the current model represents the scheduled cycle window needed to operate the full route at the target frequency. One-way routes keep the existing formula above.
If a route has `targetBuses`, including from a GTFS import with `block_id` data, `cycleTimeMinutes` represents the scheduled cycle window. GTFS imports should use the selected period's `scheduledCycleWindows` value when available, because actual block cycles can vary by period and may not equal `targetBuses * frequencyMinutes`. Recovery then shows the spare time or deficit between that window and the estimated full runtime.

## Buses Required

Suggested v1 estimate:

```text
one-way buses required = ceiling(cycle time / target frequency)
closed-loop/out-and-back buses required = ceiling(estimated full runtime / target frequency)
```

When `targetBuses` is set, buses required is that target count. This lets an imported existing route, such as a three-bus route running every 30 minutes, display the current GTFS service level before the planner edits the concept.

Show “not ready” if cycle time or frequency is missing or invalid.

## Recovery Time

For route concepts, recovery is the remaining buffer inside the scheduled cycle window:

```text
scheduled cycle window = selected GTFS scheduledCycleWindow, otherwise buses required * target frequency
recovery time = scheduled cycle window - estimated full runtime
recovery percent = recovery time / estimated full runtime
```

Example: 24 minutes of full-route runtime at 30-minute frequency requires 1 bus, has a 30-minute cycle time, and leaves 6 minutes of recovery, shown as `6 min (25%)`.

## Warning Examples

Blocking:
- missing start terminal
- missing end terminal
- fewer than two stops
- invalid frequency
- invalid or missing terminal layover assumptions

Warning:
- most segments use fallback runtime
- layover is lower than recommended minimum
- cycle time is close to another bus threshold

Info:
- observed runtime evidence is available for all segments
- route is ready for comparison

## Important Boundary

Do not reuse fixed-route schedule generator logic for v1 feasibility estimates. Route Planner 2 is estimating concept feasibility, not generating a publishable schedule.


## GTFS Import Runtime Bands

Imported GTFS route concepts calculate scheduled segment runtimes from the trips in each time band: AM Peak, Midday, PM Peak, Evening, and Full Day. Each adjacent stop segment uses the median scheduled stop-to-stop runtime for the selected band, with same-minute adjacent stops kept as at least one minute of segment evidence. Route-level totals must still preserve the median first-stop-to-last-stop elapsed trip runtime for that band, so minute-level GTFS stop interpolation does not inflate operating runtime or understate recovery.

GTFS imports also derive scheduled cycle windows from `block_id` data when possible. For each period, the importer looks at consecutive same-pattern trips in the same block, filters out implausibly long off-service gaps, and uses the typical repeat cycle for that period. This avoids treating an all-day median headway and bus count as the cycle when the route has a shorter normal cycle and a longer peak-only cycle.

When a GTFS pattern starts and ends at the same stop, the pattern is already a complete loop. Feasibility must not double that runtime as if it were a one-way out-and-back route; recovery is the scheduled cycle window minus the loop runtime.

The Runtime day and Runtime period controls in Service assumptions select which evidence band feasibility uses. If a narrow band has no scheduled sample, the planner keeps the imported full-day GTFS runtime instead of dropping to Mapbox/fallback, and the UI labels the actual band in use.
