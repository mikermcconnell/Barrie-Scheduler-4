# Codex-Assisted Operations Planning

## Purpose

Scheduled Transit includes a team-scoped workspace for auditing published
vehicle blocks, cutting operator runs, and assembling anonymous weekly rosters.
It replaces an error-prone handoff of master schedules and union rules with a
version-bound, planner-reviewed workflow.

Codex is an external proposal author. Scheduler 4 remains the system of record
and independently validates every imported proposal. A proposal never changes
a published master schedule or becomes approved without a planner action.

## Workflow

1. A planner creates a scenario and pins immutable Master Schedule versions for
   the included routes and Weekday, Saturday, or Sunday service.
2. The app normalizes the confirmed rule profile and exports
   `operations-planning-input-v1.json` with the source manifest, blocks, trips,
   relief timing, operating matrix, and source provenance.
3. Codex uses `.codex/skills/operations-planning/` to produce
   `operations-planning-proposal-v1.json` outside the app.
4. The planner imports the proposal. The app rejects invalid references,
   changed block membership, ambiguous relief times, duplicated/omitted trips,
   stale sources, and malformed weekly assignments. It recalculates all time,
   pay, fleet, coverage, and rule metrics rather than trusting proposal totals.
5. The planner may split or merge at a valid relief boundary, move a whole
   piece between runs, renumber work, or assign daily runs to anonymous weekly
   crews. Every edit reruns validation.
6. A fixed-route member may save and submit. Only an owner/admin or an audited
   support edit session may approve. Integrity and contractual findings block
   approval; exception, best-practice, and informational findings remain
   visible warnings.
7. The planner exports an Excel workbook for operational review. Master
   schedules remain unchanged.

## Source and block integrity

The scenario source manifest records route identity, day type, pinned master
version, storage path, content fingerprint, and export time. Approval fails when
the current master version differs from a pinned version.

Existing vehicle-block trip membership and order are immutable inputs. The
feature audits chronological overlap, terminal/location continuity, pull-out
and pull-in activity, fleet concurrency, permitted interlining, and relief-cab
capacity. It does not re-block service. A trip with unresolved occupied-end or
relief-arrival semantics produces an integrity blocker rather than an inferred
time.

## Confirmed initial Barrie rule profile

The default profile is based on the planner-supplied August 27, 2026 source
pages and confirmations. The app stores normalized rules plus source file name,
hash, and confirmation notes; it does not store the source photographs.

- Relief points are Park Place, B.A.T.T., and Downtown Hub. Park Place as a full
  break point is a **planner-confirmed override** to the supplied page wording.
- Operators start and end at the garage at 133 Welham Road. Duty includes five
  minutes sign-on, ten minutes circle check, applicable shuttle/deadhead, and
  five minutes post-trip after pull-in.
- Garage deadheads are symmetric unless the matrix says otherwise: Downtown 15,
  B.A.T.T. 12, Barrie South GO 8, Park Place 6, Georgian Mall 20, Georgian
  College 20, RVH 20, and Sproule at Kraus 20 minutes. B.A.T.T. to Downtown is
  an explicit directional 11-minute transition.
- Relief and break boundaries use arrival time. Gaps of 15 minutes or less are
  paid through and do not reset work. A same-route break of at least 30 minutes
  resets; a route change requires at least 42 minutes.
- Straight-shift driving is capped at 7.5 hours. A 30-minute paid-break penalty
  applies when continuous/platform work exceeds five hours. Split pieces are
  capped at five driving hours, with a target break after 4.25 to 4.75 hours.
- Standard breaks are 42 to 75 minutes. A 76 to 89 minute break resets but is a
  non-split exception. A gap of 90 minutes or more is split work and returns to
  the garage by shuttle/company vehicle.
- Daily maximums are 11 work hours, 11 driving hours, and 12 hours spread. No
  more than ten percent of runs should have 11 to 12 hours spread. Preferred
  run length is 7 to 10 hours.
- 8A/8B interlining is allowed in evenings and on Sundays only. Other
  cross-route transitions require an explicit matrix entry.
- Six relief cabs are available. The first release checks concurrent capacity
  but does not assign individual cabs or drivers. B.A.T.T. park-out capacity is
  reported as not evaluated until a numeric capacity is confirmed.
- Fleet availability is 31 forty-foot plus 6 small buses on weekdays, 31 plus 5
  on Saturdays, and 17 plus 5 on Sundays. Fixed routes prefer forty-foot buses.
- Workforce inputs are 112 fixed crews, 2 fixed spare/shuttle drivers, 8
  vacation crews, and 13 spare operators, totalling 135.
- Weekly minimum paid time is 38.5 hours; maximum platform is 40 hours; maximum
  combined time is 44 hours; minimum rest is 10 hours. Weekly overtime begins
  after 40 platform hours at 150 percent. The planner's current workflow builds
  to the minimum instead of automatically adding guarantee pay.
- Five-day work with two consecutive days off is preferred. Up to eight
  four-day crews are allowed with three days off, at least two consecutive. No
  part-time roster is created.
- Straight shifts normally target no more than about 25 percent of daily runs,
  while roster construction may create 20 percent all-straight weekly rosters.
  Weekday starts should remain within roughly 30 minutes to 2 hours; weekend
  variation is acceptable.

The objective order is: source/contract integrity, run quality, fewer split or
awkward reliefs, overtime/guarantee exposure, run count, then operating cost.

## Privacy and first-release boundaries

The model uses anonymous run and crew numbers only. Employee identity,
seniority, bidding, availability, and personal records are outside scope. Excel
is the first-release operational output; complete employee paddles and bidding
automation are not included. The result is a planning scenario, not an operator
assignment or dispatch instruction.
