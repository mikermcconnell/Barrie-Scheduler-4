---
name: operations-planning
description: Audit fixed-route vehicle blocks, cut daily operator runs, and build anonymous weekly rosters from a Scheduler 4 operations-planning-input-v1/v2.json export, producing an operations-planning-proposal JSON for import back into Scheduler 4. Use when the user asks to cut runs, do a run cut, audit master-schedule blocks, build crews or rosters, or produce an operations-planning proposal.
---

# Operations Planning

Create an advisory proposal for Scheduler 4. The app owns source integrity,
validation, calculated activities and metrics, persistence, and approval. Never
edit a master schedule or claim that a proposal is approved.

## Required input

Read one `operations-planning-input-v1.json` or
`operations-planning-input-v2.json` exported by Scheduler 4. Stop and ask for
the export if:

- `schemaVersion` is neither `1` nor `2`;
- `kind` is not `operations-planning-input`; or
- the source manifest does not identify pinned master versions.

Do not substitute a spreadsheet, photograph, or narrative for the app export.

Input bundles can be large (thousands of trips). Inspect them with `node -e`
or short scripts that print counts and samples. Do not read the whole file into
context. For candidate evaluation, reuse the repo's own helpers in
`utils/run-cutting/` (`metrics.ts`, `dutyTransitions.ts`, `rules.ts`,
`interiorRelief.ts`) rather than re-implementing duty math. See
`scripts/operations-planning-corrected-generate.cjs` for the esbuild `require`
hook that loads them from Node.

If individual trips have unresolved arrival or occupied-end timing, keep their
source audit visible, emit an `integrity` finding, and do not cut the affected
block. A partial proposal can still be useful for review, but describe it as
blocked and incomplete.

Read [the proposal contract](references/proposal-contract.md) before producing
output. The TypeScript types in `utils/run-cutting/types.ts` are the
machine-readable authority if the two disagree. The bundle's `ruleProfile` is
authoritative for the scenario. Preserve each rule's source label, including
planner-confirmed overrides. Rule values quoted below are the current defaults
and are only examples. Always read the actual value from `ruleProfile`.

## Workflow

1. **Verify the bundle before optimizing.**
   - Confirm each trip has a stable route, day type, trip ID, block ID, start,
     occupied end, start location, and end location.
   - Confirm every trip appears exactly once in the block audit.
   - Keep the existing vehicle-block trip membership and order unchanged.
   - Record unresolved continuity, time, location, or source issues as
     `integrity` findings. Do not cut affected work.
   - Report a summary to the user before continuing: trip and block counts
     per day type, and how many blocks are withheld for integrity issues.

2. **Audit vehicle blocks.**
   - Check:
     - chronological order and overlaps;
     - location continuity;
     - pull-out and pull-in coverage;
     - fleet concurrency against `fleetByDayType`;
     - permitted interlining;
     - relief vehicle capacity (`reliefCabCapacity`).
   - Audit interlining (for example 8A/8B) only in the periods listed in
     `ruleProfile.interlining`. Do not re-block trips.
   - If B.A.T.T. park-out capacity is absent, emit a `not-evaluated`
     informational finding.

3. **Cut daily runs at valid relief arrivals.**
   - A piece is chronological, contiguous operator work from one exported
     `vehicleBlockKey`.
     - Version 1 permits whole trips only.
     - Version 2 may use source-backed `startEventId` and `endEventId`
       boundaries within the first and last referenced trips.
   - Use arrival time for internal relief and break boundaries. A first piece
     may begin at its block's source pull-out location, and a final piece may
     end at its source pull-in location, when the rule profile supplies Garage
     travel time for that terminal.
   - Do not split or rewrite a published vehicle trip. Do not change its time
     or block membership, and do not invent a relief point or cross-route
     transition. Version 2 partitions operator coverage, not the vehicle
     schedule. Cover every source interval once, including
     arrival-to-departure waiting at a relief.
   - Do not write duty activities or calculated totals into a piece.
     Scheduler 4 derives sign-on, circle check, deadhead, shuttle, platform,
     gap, break, and post-trip activities itself.
   - Priority order:
     1. contractual limits;
     2. fewer awkward reliefs and split runs;
     3. less overtime/guarantee exposure;
     4. lower run count and estimated operating cost.

4. **Build anonymous weekly rosters.**
   - Cover five weekday instances plus Saturday and Sunday work, as
     represented by the bundle.
   - Use anonymous crew IDs only. Do not include employee names, seniority,
     bids, availability, medical information, or other personal data.
   - Respect rest, weekly platform/combined limits, days-off rules, and
     straight versus split-work objectives in the supplied profile.

5. **Self-review the plan.**
   - **Feasibility.** Recalculate and validate daily duties before assigning
     them to rosters. Never fill an infeasible block with an excessive shift
     just to report complete coverage. If no feasible cut is found, report the
     uncovered work and the limiting constraint. A failed search does not
     prove real-world infeasibility.
   - **Time semantics.** Keep these distinctions:
     - incoming arrival/boarding vs. departure;
     - bus driving vs. passenger travel;
     - actual meal time vs. the gross gap between pieces.

     A relief point is not automatically an approved meal location. Recovery
     time while keeping the bus is not a meal break.
   - **Driving limits.** Check continuous driving across adjacent pieces,
     including bus deadhead.
     - `straightDrivingMaximumMinutes` (default 7.5 h) caps driving between
       qualifying physical breaks. It does not cap total driving across a
       non-split meal duty.
     - `splitThresholdMinutes` (default 90) is measured on the whole
       arrival-to-arrival gap, including travel. Qualifying meal duration
       still excludes travel and preparation.
     - Also check `splitPieceDrivingMaximumMinutes`, and recurring-week rest
       across the Sunday→Monday boundary.
     - These are planner-confirmed interpretations. Keep them separate from
       paddle labels. A split piece or a weekly average cannot hide an
       excessive daily duty.
   - **Labels and pay.** Treat paddle labels and separately listed break
     penalties with care. Reconcile total paid time to the roster. Include
     separately sourced auxiliary duties in any claim of complete coverage.
     Do not infer rule permissions from an example or from the word
     "straight" in a label.
   - **References and coverage.**
     - Every piece refers only to exported trip IDs.
     - Every weekly assignment refers only to a proposed run of the matching
       day type.
     - No service is duplicated or omitted unless an explicit blocking
       integrity finding covers it.
     - In version 2, separate operators may share a source trip only through
       disjoint event intervals that cover it exactly.
   - **Honest categories.** Keep contractual failures separate from exceptions
     and best-practice warnings. Never downgrade a contract breach to make a
     proposal look acceptable.

6. **Write the proposal and run the app validator.**
   - Write the file (see Output), then run:

     ```
     node <skill folder>/scripts/validate-proposal.cjs <input.json> <proposal.json>
     ```

     The skill folder is `.claude/skills/operations-planning` or
     `.codex/skills/operations-planning`. Run the command from the repo root.

     This runs Scheduler 4's own `assessOperationsPlanningProposal`.
     - Exit 0: approval-ready.
     - Exit 1: blockers found.
     - Exit 2: usage or read error.

     Read the per-code counts first. Most findings on an incomplete proposal
     are `trip-unassigned`, so look at those counts before the sample
     messages.
   - Fix any parse failure, or any blocker you introduced (coverage,
     references, relief points, contractual), and re-run.
   - Blockers that come from the source data (for example
     `source-stop-events-unresolved`) cannot be fixed here. Leave them as
     integrity findings and report them.
   - Do not report the proposal as complete until the validator's results
     have been reviewed. A valid JSON shape alone does not show that the plan
     meets the contract.

## Output

Write exactly one UTF-8 JSON file named
`operations-planning-proposal-v1.json` or
`operations-planning-proposal-v2.json`, matching the input schema version.
Write it to the folder the user names. If they don't name one, write it next
to the input bundle. Never overwrite an existing proposal without asking. Do
not add Markdown fences or prose to the file.

Preserve the input `schemaVersion` and `kind: "operations-planning-proposal"`,
and copy the scenario ID and source-manifest fingerprint exactly. Include:

- an unchanged copy of every block audit;
- daily runs whose pieces contain source trip references;
- anonymous weekly rosters;
- findings, each with a stable deterministic `id`, `category`, matching
  `severity`, a stable `code`, and a concise planner-facing `message`. Scope
  findings with `dayType`, `runId`, `crewId`, `blockId`, and/or `tripId`.
  Put the rule reference and any other affected IDs in `details`;
- a short `methodNotes` list describing material optimization trade-offs.

The top-level metadata key is `codex` for schema compatibility. Fill it in whichever
assistant authored the proposal, and set `model` to the actual model name.

Use `vehicleBlockKey`, not the display `blockId`, in each piece's `blockId`
field. The app discards self-reported totals and derives activities and
metrics itself.

After writing, give the user a short summary:

- runs per day type;
- crews;
- uncovered or withheld work;
- validator blocker counts by category;
- the top trade-offs.

## Safety boundaries

- The assistant suggests; the planner edits, submits, and approves in Scheduler 4.
  Imported findings are advisory. Scheduler 4 decides approval blockers from
  its own validation.
- Never write to Firestore, Storage, a published master schedule, employee
  records, or an existing scenario as part of proposal generation.
- Never include source photographs in output. Use the normalized rule profile
  and the source names and hashes the app supplies.
- If rules conflict or required data is missing, emit findings and explain the
  unresolved choice. Do not silently pick a convenient interpretation.
