# Corrected run-cut status — September 21, 2026

Status: blocked by source timing conflicts; no full operational cut generated.

Authenticated read-only retrieval found all 29 pinned Master versions behind
the first draft: 1,118 trips in 83 vehicle blocks, original fingerprint
`fnv1a32:c466d066`. These versions are not certified as September-board service.
Published Master schedules, the original workbook and operational assignments
were not changed.

## Implemented locally

Schema-v2 input and proposals retain source stop events and allow operator
relief within a vehicle trip. Validation requires exact interval coverage and
conserves source driving; vehicle trips, times and blocks are not rewritten.
Legacy schema-v1 remains supported. Legacy split/merge editing is explicitly
disabled for v2 pending an event-aware editor.

## Blocking evidence

`Master-timing-conflicts.xlsx` contains the reviewable source evidence:

- Nine weekday 8A/8B trips have stored driving totals inconsistent with their
  stop times (eight differences of five minutes and one of nine minutes).
- Four Saturday 8B trips have non-chronological stop times.
- Seven whole vehicle blocks, containing 106 source trips, are withheld.
- The other 1,105 individual trips conserve exactly 57,913 driving minutes.

The input and projected block audits both show all 13 findings. Bad trips use
an explicitly blocked whole-trip fallback, never invented relief times.

## Search limitations

Exploratory generation produced 47,208 candidate duties for 5,654 service
intervals outside the withheld blocks. Of those intervals, 334 have no candidate
in this bounded same-route search. This is not proof of real-world infeasibility
and not a daily selection. No weekly roster or final proposal was generated.
After source correction, candidate construction must still resolve uncovered
work and validate actual operator transfers. Existing cab-capacity calculations
are approximate and do not establish a dispatch or pooling plan. Synthetic
solver tests do not prove the real schedule feasible.

## Next decision

Confirm the intended board-period sources and corrected stop times/driving
totals for the 13 listed trips. Do not silently amend Master from inferred
times. After planner-approved source correction, re-pin the source, regenerate
all service, complete candidate coverage and solve daily duties and recurring
weekly rosters. Require full coverage and all contractual checks before
labeling the result an operationally usable cut.

## Verification

Build, final TypeScript check, documentation context check and scoped diff
check passed. Focused run-cutting checks and five solver tests passed. The
full repository suite reported 2,905 passed, 49 skipped and one unrelated
RoutePlanner2Workspace local-workspace test timeout (5,000 ms). No run-cutting
test failed. Workbook formulas were checked and all five sheets visually
reviewed. These are local checks, not deployment or operational approval.
