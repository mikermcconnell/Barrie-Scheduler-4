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
   a versioned operations-planning input JSON with the source manifest, blocks, trips,
   relief timing, operating matrix, and source provenance.
3. Codex uses `.codex/skills/operations-planning/` to produce
   a matching versioned operations-planning proposal JSON outside the app.
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
pages and confirmations, with September 21 duty clarifications in revision 2.
The app stores normalized rules plus source file name,
hash, and confirmation notes; it does not store the source photographs.

- Relief points are Park Place, B.A.T.T., and Downtown Hub. Park Place as a full
  break point is a **planner-confirmed override** to the supplied page wording.
- Operators start and end at the garage at 133 Welham Road. Duty includes five
  minutes sign-on, ten minutes circle check for a source-block bus pull-out,
  applicable passenger shuttle or bus deadhead, and five minutes post-trip
  after a source-block bus pull-in. An internal relief uses passenger shuttle
  travel instead of an assumed bus pull-out/pull-in.
- Garage deadheads are symmetric unless the matrix says otherwise: Downtown 15,
  B.A.T.T. 12, Barrie South GO 8, Park Place 6, Georgian Mall 20, Georgian
  College 20, RVH 20, and Sproule at Kraus 20 minutes. B.A.T.T. to Downtown is
  an explicit directional 11-minute transition.
- Relief and break boundaries use arrival time. Gaps of 15 minutes or less are
  paid through and do not reset work. A same-route break of at least 30 minutes
  resets; a route change requires at least 42 minutes.
- Driving without a qualifying physical meal break is capped at 7.5 hours;
  this is not a total-driving cap across a non-split duty with a qualifying meal.
  A 30-minute paid-break penalty
  applies when continuous/platform work exceeds five hours. Split pieces are
  capped at five driving hours, with a target break after 4.25 to 4.75 hours.
- Standard breaks are 42 to 75 minutes. A 76 to 89 minute break resets but is a
  non-split exception. A whole arrival-to-arrival gap of 90 minutes or more,
  including travel, is split work and returns to the garage. It does not require
  90 usable meal minutes after travel and preparation are deducted.
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

## Duty calculation and validation

Incoming whole-trip relief uses the preceding trip's arrival in the same
immutable source block, at a matching location. Missing or incompatible arrival
data blocks approval; departure cannot substitute for that relief. Waiting from
boarding arrival to departure is paid occupied time. A source-block first trip
uses its departure for the bus pull-out calculation.

Inter-piece gaps are decomposed into required travel and the remaining
break, followed by any arrival-to-departure boarding wait. A piece ending its
source vehicle block includes bus pull-in and post-trip before the meal. A piece
starting a source block includes circle check and bus pull-out after the meal.
These intermediate bus movements count toward driving limits too. Non-split transfers
require a known directional travel time even on the same route. A meal requires
a full-break location; recognition as a relief point alone is insufficient.
When neither endpoint supports a meal, the current v1 representation cannot
invent an intermediate break location. Missing travel or infeasible movement
blocks approval. Reset checks use the qualifying break after travel, not the
gross gap. The planner confirmed on September 21 that the split threshold uses
the whole arrival-based gap, including travel. Required travel and preparation
still cannot count toward a qualifying meal reset.

Recovery inside an uninterrupted piece remains paid occupied work and does not
create an inferred meal or reset. Changing the number of adjacent piece objects
cannot bypass continuous-driving limits. Bus pull-out/pull-in deadhead counts in
platform/driving time; passenger shuttle travel does not. Paid time includes
occupied trip duration and waiting, and adds a break penalty separately from
elapsed duty time. It must not be conflated with pure driving time.

Weekly rosters are recurring Monday-Sunday patterns. Rest checks include the
last worked assignment to the first assignment in the following week. Four-day
rosters require three total days off with at least two consecutive, rather than
three consecutive days off.

### Interior-stop operator relief

Version 2 retains each published Master trip and vehicle block, but can place
operator boundaries at exported stop events within a trip. Event identities
retain their source trip and stop occurrence, with arrival/departure provenance.
Version 1 remains the historical whole-trip contract.

The validator projects version-2 coverage to private work intervals and applies
the same duty, transfer, pay, weekly-rest and coverage checks. Every interval
must be covered once. A source trip can therefore appear in two operator pieces
only where their event intervals exactly partition its work. The incoming
operator owns the wait between relief arrival and departure. Missing or
ambiguous timing must not be interpolated to manufacture an eligible cut.

### Remaining source and representation limits

Schema v1 still references whole trips and cannot express interior stop relief,
separately sourced standby/RPT work, or all actual operator transfer permissions.
The existing route-transition matrix and cab-capacity approximation remain
limitations; corrected daily calculations do not establish full paddle fidelity.
Do not treat an incomplete or infeasible cut as acceptable service coverage.

September paddle comparison still requires planner reconciliation of
short-break exceptions and mode-specific travel times. The no-meal cap and
90-minute whole-gap split definition were confirmed on September 21. This does
not redefine the existing non-split share/weekly roster preference categories.
Existing normalized thresholds and labelled overrides remain in force pending
that reconciliation. The example paddles are evidence of operating practice,
not automatic authority to waive a contractual finding.

## Privacy and first-release boundaries

The model uses anonymous run and crew numbers only. Employee identity,
seniority, bidding, availability, and personal records are outside scope. Excel
is the first-release operational output; complete employee paddles and bidding
automation are not included. The result is a planning scenario, not an operator
assignment or dispatch instruction.
