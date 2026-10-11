---
name: operations-planning
description: Create a planner-reviewable fixed-route block audit, daily run cut, and anonymous weekly roster from a Scheduler 4 operations-planning-input-v1.json bundle. Use when the user asks Codex to audit master-schedule blocks, cut operator runs, build weekly crews/rostering, or produce an operations-planning-proposal-v1.json file for import into Scheduler 4.
---

# Operations Planning

Create an advisory proposal for Scheduler 4. The app owns source integrity,
validation, calculated activities and metrics, persistence, and approval. Never
edit a master schedule or claim that a proposal is approved.

## Required input

Read one versioned `operations-planning-input-v1.json` or
`operations-planning-input-v2.json` exported by Scheduler 4. Do not
produce an import proposal if `schemaVersion` is neither `1` nor `2`, `kind` is not
`operations-planning-input`, or the source manifest does not identify pinned
master versions. Do not substitute a spreadsheet, photograph, or narrative for
the app export.

If individual trips have unresolved arrival or occupied-end timing, keep their
source audit visible, emit an `integrity` finding, and do not cut the affected
block. A partial proposal may be useful for review, but describe it as blocked
and incomplete.

Read [the proposal contract](references/proposal-contract.md) before producing
output. Treat rules in the bundle as authoritative for that scenario. Preserve
each rule's source label, including planner-confirmed overrides.

## Workflow

1. Verify the bundle before optimizing.
   - Confirm each trip has a stable route, day type, trip ID, block ID, start,
     occupied end, start location, and end location.
   - Confirm every trip appears exactly once in the block audit.
   - Keep the existing vehicle-block trip membership and order unchanged.
   - Record unresolved continuity, time, location, or source issues as
     `integrity` findings; do not cut affected work.

2. Audit vehicle blocks.
   - Check chronological order, overlaps, location continuity, pull-out and
     pull-in coverage, fleet concurrency, permitted interlining, and the relief
     vehicle capacity supplied by the bundle.
   - Audit 8A/8B interlining only in the allowed periods from the rule profile.
     Do not re-block trips.
   - If B.A.T.T. park-out capacity is absent, emit a `not-evaluated` warning.

3. Cut daily runs at valid relief arrivals.
   - A piece is chronological, contiguous operator work from one exported
     `vehicleBlockKey`. Version 1 permits whole trips only. Version 2 may use
     source-backed `startEventId` and `endEventId` boundaries within the first
     and last referenced trips, respectively.
   - Use arrival time for internal relief and break boundaries. A first piece
     may begin at its block's source pull-out location and a final piece may end
     at its source pull-in location when the rule profile supplies Garage travel
     time for that terminal.
   - Do not split or rewrite a published vehicle trip, change its time or block
     membership, or invent a relief point or cross-route transition. Version 2
     partitions operator coverage, not the vehicle schedule. Cover every source
     interval once, including arrival-to-departure waiting at a relief.
   - Do not write duty activities or calculated totals into a piece. Scheduler 4
     derives sign-on, circle check, deadhead, shuttle, platform, gap, break, and
     post-trip activities from the source trips and rule profile.
   - Apply contractual limits before quality preferences. Minimize awkward
     reliefs and split work, then overtime/guarantee exposure, then run count and
     estimated operating cost.

4. Build anonymous weekly rosters.
   - Cover five weekday instances plus Saturday and Sunday work as represented
     by the bundle.
   - Use anonymous crew IDs only. Do not include employee names, seniority,
     bids, availability, medical information, or other personal data.
   - Respect rest, weekly platform/combined limits, days-off rules, and straight
     versus split-work objectives in the supplied profile.

5. Self-review before writing output.
   - Recalculate and validate daily duties before assigning them to weekly
     rosters. Never fill an infeasible block with an excessive operator shift
     merely to report complete coverage. If no feasible cut is found, report
     the uncovered work and limiting constraint; do not claim that a failed
     search proves real-world infeasibility.
   - Distinguish incoming arrival/boarding from departure, bus driving from
     passenger travel, and actual meal time from the gross gap between pieces.
     A relief point is not automatically an approved meal location. Recovery
     while retaining the bus is not an inferred meal break.
   - Check continuous driving across adjacent pieces, including bus deadhead,
     applying the 7.5-hour no-meal cap between qualifying physical breaks, not
     to total driving across a non-split meal duty. The confirmed 90-minute
     split threshold uses the whole arrival-to-arrival gap, including travel;
     qualifying meal duration still excludes travel and preparation. Keep
     these planner-confirmed interpretations distinct from paddle labels.
   - Check continuous split-driving limits
     and recurring-week rest across the last/first day boundary. A piece split
     or weekly average cannot conceal an excessive daily duty.
   - Treat paddle labels and separately listed break penalties carefully.
     Reconcile total paid time to the roster and include separately sourced
     auxiliary duties in any claim of complete daily or workforce coverage.
     Do not infer new rule permissions from an example or from the word
     "straight" in its label.
   - Verify every daily run piece refers only to exported trip IDs.
   - Verify no service is duplicated or omitted unless it is covered by an
     explicit blocking integrity finding. In version 2, separate operators can
     reference the same source trip only for disjoint, exactly covering event
     intervals. Reject unknown, reversed, overlapping or missing boundaries.
   - Verify each weekly assignment refers only to a proposed run/day instance.
   - Keep contractual failures separate from exceptions and best-practice
     warnings. Do not downgrade a contract breach to make a proposal look
     acceptable. Codex findings are advisory after import; Scheduler 4 decides
     approval blockers from its own validation.

## Output

Write exactly one UTF-8 JSON file named
`operations-planning-proposal-v1.json` or `operations-planning-proposal-v2.json`,
matching the input schema. Do not add Markdown fences or prose to
the file. Preserve the input `schemaVersion` and
`kind: "operations-planning-proposal"`, copy the scenario ID and
source-manifest fingerprint exactly, and include:

- an unchanged copy of every immutable-source block audit;
- daily runs and pieces containing source trip references;
- anonymous weekly rosters;
- findings with stable IDs, category, severity, rule reference, affected IDs,
  and a concise planner explanation;
- a short `methodNotes` list describing material optimization trade-offs.

Use `vehicleBlockKey`, not the display `blockId`, in each piece's `blockId`
field. The imported app discards self-reported totals and derives activities and
metrics itself. A valid JSON shape is not evidence that the plan satisfies the
contract.

## Safety boundaries

- Codex suggests; the planner edits, submits, and approves in Scheduler 4.
- Never write to Firestore, Storage, a published master schedule, employee
  records, or an existing scenario as part of proposal generation.
- Never include the source photographs in output. Use the normalized rule
  profile and its source names/hashes supplied by the app.
- If rules conflict or required data is missing, emit findings and explain the
  unresolved choice instead of silently choosing a convenient interpretation.
