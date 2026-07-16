# Dwell Incident Review

> Product and calculation contract for dwell-incident investigation and downstream carryover.

## Purpose

The Operations Dashboard **Dwell Incident Review** page is a read-only forensic tool for operations supervisors. It helps a supervisor answer:

1. Why was this stop event flagged?
2. What operating and passenger context was present?
3. What happened on the remainder of the same trip?
4. Did associated delay survive recovery into later trips on the block?
5. Where did it return under five minutes, and where did it fully recover to zero?

The page presents investigation signals. It does not prove operator fault, sole causation, or a disciplinary finding, and it is not a schedule-design model or general OTP explainer.

Operator-level evidence follows the `operationsOperatorDwell` workspace permission. Shared-data responses reject dwell-detail requests and redact operator/cascade evidence from broader performance responses when that permission is absent.

## Incident contract

- Only normal, non-tripper, non-detour timepoint observations with valid observed arrival and departure are eligible.
- Departure must be more than three minutes late.
- If arrival is on or before the scheduled departure, effective dwell is departure lateness.
- If arrival is after the scheduled departure, effective dwell is observed arrival-to-departure dwell.
- Effective dwell up to two minutes is minor, over two through five minutes is moderate, and over five minutes is high.
- Moderate and high events are reportable. Minor events must not enter reportable counts, averages, queues, patterns, or exports.
- Exposure rates use reportable incidents per 1,000 eligible timepoint visits with matching date, route, and operator scope.

These legacy thresholds remain fixed until Barrie Transit completes operational sign-off.

## Associated-delay story

- Baseline lateness is positive arrival deviation already present at the dwell stop.
- Dwell-associated delay at later observations is `max(0, raw departure deviation - baseline lateness)`.
- Always show the remainder of the incident trip before later block trips.
- Keep any positive associated delay separate from associated delay over the five-minute OTP threshold.
- “Back under 5 min” is not the same as “recovered to zero.”
- Missing observations are unknown; they must not imply recovery or continued propagation.
- Use “associated with” and “visible after,” not language claiming the dwell was the only cause.

## Page structure

### Incident Queue

- Default sort: high severity, later OTP-late departures, later trips touched, effective dwell, then recency.
- Global date, day-type, and route filters are inherited from the Operations Dashboard.
- Local filters cover severity, downstream effect, operator, search, and priority/newest order.
- Operator identity is context, not a leaderboard.

### Incident detail

- Why the event qualified.
- Scheduled and observed arrival/departure, raw dwell, and effective dwell.
- Boardings, alightings, wheelchair activity, reliable departure load, vehicle, route, direction, block, and operator when available.
- Same-trip impact, later-trip carryover, threshold milestone, zero-recovery milestone, and observation confidence.
- Map first when useful coordinates exist. Treat the map as the spatial incident timeline: show the incident-trip remainder before later block trips, label only the dwell origin and meaningful carryover/recovery milestones by default, and keep other observed stops available through selection.
- Keep the default map overlays compact: incident identity, a small outcome summary, and a whole-story/same-trip/later-trips phase control. Scheduled/observed times, passenger context, vehicle details, method, and data confidence belong in progressive disclosure rather than separate dashboard cards.
- When useful coordinates are unavailable, keep the same incident-detail shell and replace the map with a concise evidence fallback; do not switch to a different detail experience.

### Patterns

- Exposure-normalized incident trend.
- Recurring route/stop/trip combinations on at least three distinct service days.
- Alphabetical operator context with eligible visits and reportable rates, explicitly not a fault ranking.

## Compatibility

Performance schema v12 adds deterministic incident IDs, operating context, and route/operator exposure rows. Older days remain visible, but unavailable evidence and denominators display as unavailable with a re-import notice. Rebuild or re-import existing raw STREETS history to produce complete v12 evidence.

Cascade logic exists in both `utils/schedule/dwellCascadeComputer.ts` and `functions/src/dwellCascadeComputer.ts`; keep them behaviorally synchronized.
