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
- confidence level
- segment-level source disclosure
- warnings for weak or missing inputs

## Runtime Source Priority

Use this priority order:

1. observed proxy evidence between adjacent stops
2. manual segment/runtime override if planner provided one
3. Mapbox Directions estimate for the shaped stop-to-stop path
4. fallback estimate from distance or simple default speed
5. missing/not ready state

## Segment-Level Disclosure

Each stop-to-stop segment should show:
- from stop
- to stop
- runtime minutes
- source
- confidence
- distance if available
- sample size if available
- fallback reason if stronger data is missing

The segment list should allow planners to enter or clear a manual runtime override. Manual overrides affect totals immediately and must not be overwritten by automatic Mapbox recalculation.

## Confidence Model

Suggested confidence rules:

- `high`: most segments have observed evidence with reasonable samples
- `medium`: Mapbox estimates, manual assumptions, or mixed observed and fallback estimates
- `low`: mostly fallback estimates
- `not-ready`: missing terminals, too few stops, or no usable assumptions

Exact thresholds can be refined during implementation, but the UI must not hide uncertainty.

## Cycle Time

For v1 route concepts:

```text
one-way runtime = rounded stop-to-stop segment runtime + intermediate stop dwell allowance
cycle time = one-way runtime * 2 + start terminal layover + end terminal layover
```

This is a planning estimate only. It is not the same as fixed-route generated schedule cycle logic.
Intermediate stop dwell is not terminal recovery. Keep terminal layover/recovery disclosed separately.

## Buses Required

Suggested v1 estimate:

```text
buses required = ceiling(cycle time / target frequency)
```

Show “not ready” if cycle time or frequency is missing or invalid.

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
