# Route Planner 2 Runtime Intelligence

## Goal

Runtime intelligence should turn a route concept into explainable operating estimates.

V1 should be designed for observed stop-to-stop proxy evidence, even if the first implementation uses fallback assumptions while data wiring is added.

## Required Outputs

- one-way runtime
- cycle time
- buses required
- confidence level
- segment-level source disclosure
- warnings for weak or missing inputs

## Runtime Source Priority

Use this priority order:

1. observed proxy evidence between adjacent stops
2. manual segment/runtime assumption if planner provided one
3. fallback estimate from distance or simple default speed
4. missing/not ready state

## Segment-Level Disclosure

Each stop-to-stop segment should show:
- from stop
- to stop
- runtime minutes
- source
- confidence
- sample size if available
- fallback reason if observed data is missing

## Confidence Model

Suggested confidence rules:

- `high`: most segments have observed evidence with reasonable samples
- `medium`: mixed observed and fallback estimates
- `low`: mostly fallback or manual estimates
- `not-ready`: missing terminals, too few stops, or no usable assumptions

Exact thresholds can be refined during implementation, but the UI must not hide uncertainty.

## Cycle Time

For v1 route concepts:

```text
cycle time = one-way runtime * 2 + start terminal layover + end terminal layover
```

This is a planning estimate only. It is not the same as fixed-route generated schedule cycle logic.

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
- scenario is ready for comparison

## Important Boundary

Do not reuse fixed-route schedule generator logic for v1 feasibility estimates. Route Planner 2 is estimating concept feasibility, not generating a publishable schedule.
