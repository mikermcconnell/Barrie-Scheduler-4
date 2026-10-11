# Corrected full run: source feasibility gate

Superseded later September 21: the pinned full Master schedules were retrieved
and schema-v2 interior relief was implemented locally. The endpoint-only
representation limitation below is historical, not a remaining request for
source upload. The current blocker is 13 source timing conflicts across seven
vehicle blocks. See `../corrected-run-cut-20260921/README.md` and its source
review workbook. No complete corrected operational cut has been produced.

Checked September 21, 2026. No corrected full proposal or replacement workbook
was generated because the available source cannot support legal full coverage
under the current whole-trip relief contract.

## Source checked

- Scenario: `dry-run-full-current-master-2026-08-27`.
- Export: August 27, 2026 at 18:49:51.467 UTC.
- Source fingerprint: `fnv1a32:c466d066`.
- Included scope: 1,118 trips, 83 vehicle blocks, 29 route/day source versions.
- The September paddle folder contains example paddles and rosters, not an
  Operations Planning input export with pinned stop-event references.
- Original source files and proposal remain unchanged. The confirmed no-meal
  cap and whole-gap split interpretation were used; no relief permissions,
  travel times, or driving limits were relaxed.

## Constraint contradiction

A complete whole-trip cut must partition every vehicle block at valid operator
relief boundaries. At an internal boundary, the outgoing trip endpoint and the
incoming trip start must both be recognized relief locations, and incoming
boarding must resolve to the preceding source arrival at the same location.
Changing operators at an unapproved endpoint or at an unrepresented interior
stop is not permitted by the current input/proposal contract.

The independent feasibility audit used the current relief lookup and alias
equivalence. It found 30 indivisible work sections in 30 blocks exceeding the
450-minute no-meal driving cap before an eligible endpoint cut:

| Day type | Affected blocks |
|---|---:|
| Weekday | 14 |
| Saturday | 14 |
| Sunday | 2 |
| Total | 30 |

Those sections contain 315 of the 1,118 source trips. This is not a claim that
315 trips individually exceed a limit. Twenty-five affected blocks have no
eligible internal endpoint cut anywhere; five have cuts elsewhere, but an
indivisible portion still exceeds the cap. Additional validation could reveal
further constraints; these alone rule out complete legal coverage.

Example: `master:12-Saturday@v7:12-1` contains eight trips from 06:16 to
22:01, Georgian Mall to Barrie South GO. With source-profile bus deadhead it
requires 843 driving minutes (14:03), 1,023 paid minutes (17:03), and 993
minutes spread (16:33). It has no permitted internal whole-trip relief cut.
Revenue driving alone is already excessive, so travel-mode refinement cannot
remove this blocker.

The first-draft proposal was also reassessed with the corrected local validator:
approval remains unavailable, with 155 contractual findings. That reassessment
is not a regenerated run cut and does not verify September service coverage.

## Required next inputs and implementation

1. Obtain the pinned Master source schedules with stop-level arrival/departure
   times and immutable trip/block identities. For a September operational cut,
   use the September service sources; for correction of the original draft,
   use the exact August source versions above. Example paddles do not establish
   those source identities.
2. Extend the planning export/proposal and validator to reference interior
   relief events. Partition operator coverage at those events while preserving
   every vehicle trip, its timing, and block membership unchanged. The existing
   v1 export alone cannot convey these events.
3. Confirm only the operator transfers and movement standards needed by the
   chosen cuts. Do not broaden vehicle interlining permissions automatically.
4. Generate feasible daily duties, then weekly rosters. Validate exact service
   coverage, actual breaks, travel, pay, daily limits, weekly limits, and rest
   across the repeating-week boundary before producing the full review workbook.

No live Master, scenario, workbook, or operational assignment was changed.
