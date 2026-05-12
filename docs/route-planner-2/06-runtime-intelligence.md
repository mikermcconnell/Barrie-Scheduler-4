# Route Planner 2 Runtime Intelligence

## Goal

Runtime intelligence should turn a route concept into explainable operating estimates.

V1 should be designed for observed stop-to-stop proxy evidence. The current MVP can also use Mapbox Directions estimates for shaped stop-to-stop segments, with fallback assumptions when Mapbox is unavailable.

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

Use this priority order:

1. manual segment/runtime override if planner provided one
2. scheduled GTFS runtime evidence for the selected day type, time period, and source route when available
3. Mapbox Directions estimate for the shaped stop-to-stop path
4. fallback estimate from distance or simple default speed
5. missing/not ready state

Manual overrides stay first because Route Planner 2 is a planning workspace. Automatic evidence can suggest better estimates, but it must not silently override planner-entered segment assumptions.
Mapbox should fill only gaps where scheduled GTFS evidence is not available for the current route/time selection.
Planners can switch a route to Mapbox-only runtime. In that mode, scheduled GTFS evidence is ignored for feasibility totals and Mapbox/drawn-route estimates are used when available, then fallback assumptions.
When a drawn segment extends beyond a matched GTFS corridor, use the scheduled GTFS runtime for the covered portion and estimate the uncovered portion from the drawn-route estimate or fallback distance. Label this as partial GTFS coverage rather than presenting the whole segment as fully scheduled evidence.
When custom stops are not exactly GTFS stops but the drawn line follows a GTFS route shape, interpolate the matched shape overlap and use the proportional scheduled GTFS runtime for the covered portion before falling back to Mapbox.

For imported address routes, route creation should not wait on every Mapbox segment. Render the draft route immediately, then calculate Mapbox road path and segment runtimes in a bounded background queue with visible progress.

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

- `high`: most segments have strong observed evidence or exact GTFS scheduled stop-to-stop runtime evidence
- `medium`: Mapbox estimates, manual assumptions, or mixed observed and fallback estimates
- `low`: mostly fallback estimates
- `not-ready`: missing terminals, too few stops, or no usable assumptions

Exact thresholds can be refined during implementation, but the UI must not hide uncertainty.

## Cycle Time

For v1 route concepts:

```text
one-way route runtime = rounded stop-to-stop segment runtime + intermediate stop dwell allowance
one-way cycle time = one-way route runtime * 2 + start terminal layover + end terminal layover
closed-loop/out-and-back estimated full runtime = stop-to-stop segment runtime + intermediate dwell for the complete route shape
closed-loop/out-and-back buses required = ceiling(estimated full runtime / target frequency)
closed-loop/out-and-back scheduled cycle window = buses required * target frequency
closed-loop/out-and-back recovery time = scheduled cycle window - estimated full runtime
closed-loop/out-and-back cycleTimeMinutes = scheduled cycle window
```

This is a planning estimate only. It is not the same as fixed-route generated schedule cycle logic.
Intermediate stop dwell is not terminal recovery. Keep terminal layover/recovery disclosed separately.

Closed-loop runtime includes the final segment from the last stop back to Stop 1.
Out-and-back runtime includes the reverse stop sequence from the turnaround stop back to Stop 1.
For closed-loop and out-and-back shapes, `cycleTimeMinutes` in the current model represents the scheduled cycle window needed to operate the full route at the target frequency. One-way routes keep the existing formula above.

## Buses Required

Suggested v1 estimate:

```text
one-way buses required = ceiling(cycle time / target frequency)
closed-loop/out-and-back buses required = ceiling(estimated full runtime / target frequency)
```

Show “not ready” if cycle time or frequency is missing or invalid.

## Recovery Time

For route concepts, recovery is the remaining buffer inside the scheduled cycle window:

```text
scheduled cycle window = buses required * target frequency
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
