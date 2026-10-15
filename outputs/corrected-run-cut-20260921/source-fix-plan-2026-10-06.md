# Source fix plan for the 13 run-cut blockers (October 6, 2026)

Nothing in Master has been changed. Each fix below must be made in Scheduler 4
and saved as a new Master version, then the run-cut bundle re-exported.

## Common cause: the evening 8A/8B interline at B.A.T.T.

All 13 blockers are trips at the evening bus swap at B.A.T.T., which runs every
day of the week. A bus arriving on 8A at x:07 leaves as 8B at x:12, and a bus
arriving on 8B at x:37 leaves as 8A at x:42. Each day type stores the swap
differently:

| Day | Master format | Where the B.A.T.T. layover is stored | Result |
|---|---|---|---|
| Weekday | one-way trips, GTFS blocks | first stop of the northbound trip leaving after the swap | Blocks correct; importer bug understated driving on all 9 of these trips |
| Sunday | one-way trips, GTFS blocks | end of the trip arriving before the swap | Correct: blocks follow the real buses and driving matches (4 swap trips, from 7:42 PM) |
| Saturday | full round trip per row | inside the round-trip row | Rows and blocks mix two buses after about 8 PM |

## Weekday 8A/8B: 9 trips with understated driving totals

Cause: a code bug, not a data-entry error. The GTFS importer
(`utils/gtfs/gtfsImportService.ts`) measured driving as departure-to-departure
minus *all* recovery. Recovery at the first stop happens before the first
departure, so it was subtracted twice. The same pattern existed in
`utils/schedule/masterRecoveryTransfer.ts`. Both are fixed, with regression
tests.

Stop times are correct. Only the stored driving total is wrong, and every
difference equals the trip's starting layover at B.A.T.T. See
`weekday-driving-corrections.csv`.

| Trip | Block | Departs | Stored | Correct |
|---|---|---|---|---|
| 8B-N-31 | 8B-1 | 8:12 PM | 24 | 29 |
| 8A-N-33 | 8A-3 | 8:42 PM | 24 | 29 |
| 8B-N-33 | 8B-2 | 9:12 PM | 24 | 29 |
| 8A-N-35 | 8A-5 | 9:42 PM | 22 | 27 |
| 8B-N-35 | 8B-5 | 10:12 PM | 24 | 29 |
| 8A-N-37 | 8A-1 | 10:42 PM | 22 | 27 |
| 8B-N-37 | 8B-3 | 11:12 PM | 24 | 29 |
| 8A-N-39 | 8A-2 | 11:46 PM | 18 | 27 |
| 8A-N-40 | 8A-5 | 12:42 AM | 1 | 6 |

Fix: re-import weekday 8A/8B from GTFS with the fixed importer, or correct the
nine totals. Passenger times do not change.

Caution: the Schedule Editor's trip recalculation (`ScheduleEditor.tsx`,
`useTravelTimeGrid.ts`, `useScheduleEditing.ts`) uses a related
cycle-minus-all-recovery formula. Editing these trips there may reintroduce a
wrong total. Re-run the run-cut validator after any edit.

## Saturday 8A/8B: the B.A.T.T. interline splits a loop between two buses

Cause: the Saturday masters (all uploaded January 7, 2026) store each full
round trip as one row in a single table. The weekday and Sunday masters store
one-way trips in separate North/South tables instead. From about 8 PM on
Saturday, 8A and 8B swap buses at B.A.T.T. every hour (summer 2026 GTFS copy in
`gtfs/`, whose times match Master exactly):

- a bus arriving on 8A at x:07 leaves as 8B at x:12;
- a bus arriving on 8B at x:37 leaves as 8A at x:42.

From then on, one round-trip row describes two buses: the part before B.A.T.T.
is one vehicle and the part after it is another. Every time is correct, but the
row structure, and the block assigned to it, are wrong.

- **8B rows 8B-T-77 to 8B-T-80 (flagged).** Barrie South GO x:23 → B.A.T.T.
  x:37 is one bus. The loop departing B.A.T.T. at x:12 is another, and it
  leaves 25 minutes *before* the first one arrives. Because the stops go
  backwards in time, the validator blocks these rows.
- **8A rows 8A-T-78 to 8A-T-81 (not flagged).** The row arrives at B.A.T.T. at
  x:06 and "departs" at x:41, so Master shows one bus waiting 35 minutes. In
  reality the x:06 bus leaves as 8B at x:12, and the x:41 departure is the bus
  that arrived on 8B at x:37. The times stay in order, so validation passes, but
  the block assignments after about 8 PM are wrong. A run cut built from these
  rows would put operators on the wrong buses.

Fix (recommended): re-import Saturday 8A and 8B as one-way trips in the same
North/South format as weekday, using the fixed GTFS importer. The interline
then falls on a trip boundary, and GTFS `block_id` gives the real bus. Splitting
only the four 8B rows by hand would leave the 8A blocks silently wrong. Confirm
against the current Saturday paddle first, because the local GTFS copy is the
summer feed.

Possible follow-up: add a run-cut integrity check for dwells longer than about
15 minutes at a configured interline point during `ruleProfile.interlining`
periods. That would catch the silent 8A case.
