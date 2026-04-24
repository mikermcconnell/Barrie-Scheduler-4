# Dwell Cascade Feature

> Recommended operating model for the Operator Dwell cascade experience.
> Load this file only when working on dwell incident analysis, cascade attribution, or the cascade story UI.

---

## Purpose

Help a planner answer four questions about a dwell incident:

1. **What happened at the dwell stop?**
2. **What happened next on the same trip?**
3. **Did that delay carry into later trips on the block?**
4. **Where did the block get back under 5 minutes, and where did it fully recover to zero?**

This feature is an **operational forensic tool**, not a schedule design model and not a general OTP explainer.

---

## Current gap to fix

The current implementation primarily traces **later trips in the same block** and evaluates them at **downstream timepoints**. That means a dwell that starts at Park Place can appear to "show up" much later on the route, even when the planner expects to first see what happened immediately after the dwell.

That behavior is mathematically valid for a **block carryover** view, but it is not intuitive as a general **incident story** view.

---

## Recommended product model

Treat the feature as a **four-step story**, not a single downstream score:

1. **Incident**
   - Where the dwell happened
   - How much excess dwell was recorded
   - How late the bus already was before the dwell

2. **Same-trip impact**
   - What happened after the dwell on the remainder of the same trip
   - Whether the delay grew, held, or shrank before the trip ended

3. **Block carryover**
   - Whether the delay survived terminal recovery
   - Which later trips on the same block still carried dwell-associated delay

4. **Recovery**
   - First point back under the 5-minute OTP threshold
   - First point where dwell-associated delay returned to zero

The story should always start with the **remainder of the incident trip** before showing later trips.

---

## Terms the UI should use

Use these terms consistently:

- **Dwell incident**: the origin event
- **Pre-existing lateness**: lateness already present when the bus entered the dwell stop
- **Dwell-associated delay**: additional delay still visible after subtracting pre-existing lateness. This is an operational carryover signal, not proof that dwell was the only cause of every later delay.
- **Same-trip impact**: delay carried after the dwell on the incident trip
- **Block carryover**: delay that survives into the next scheduled trip(s) on the same block
- **Back under 5 min**: first observed point where dwell-associated delay returns to `<= 5 minutes` after previously being above the OTP threshold
- **Stayed under 5 min**: observed carryover never exceeded the OTP threshold
- **Recovered to zero**: first observed point where dwell-associated delay is `0`
- **Trips touched**: later trips that still carried any dwell-associated delay
- **OTP-late departures**: observed departures where dwell-associated delay remained `> 5 minutes`

Avoid language that implies every downstream late point was a direct local effect of the dwell stop itself.

---

## Calculation rules

### 1) Keep dwell incident detection separate

The logic that identifies a dwell incident can continue to be handled by the operator dwell pipeline.

This document is about **how to tell the story after an incident already exists**.

### 2) Use a clear baseline

For a dwell incident, calculate:

- **baseline lateness** = lateness on arrival into the dwell stop
- **dwell-associated delay** at later observations = `max(0, raw deviation - baseline lateness)`

This keeps the feature focused on what the dwell added, not on delay the bus was already carrying.
Use planner-facing language that avoids overclaiming causality. Prefer "associated with" or "visible after" unless the model has enough evidence to prove direct causation.

### 3) Trace the remainder of the incident trip first

For the incident trip:

- start at the first observed stop after the dwell stop
- use all available downstream observations needed to tell a believable story
- show whether dwell-associated delay:
  - increased
  - held roughly flat
  - shrank
  - returned under 5 minutes
  - returned to zero

If same-trip data is missing, the UI should say **unknown**, not silently jump to a later trip.

### 4) Then trace later trips on the same block

Only after the same-trip segment is shown should the feature continue into later trips on the same block.

For each later trip:

- show scheduled recovery before the trip
- show observed recovery when available
- show whether the trip carried any dwell-associated delay
- show whether any observed departures stayed above 5 minutes

### 5) Keep two separate impact levels

The feature should distinguish between:

- **delay touched**: any positive dwell-associated delay
- **OTP impact**: dwell-associated delay still above 5 minutes

These are not the same thing and should not be blended into one headline.

### 6) Treat missing data honestly

If there is no observation where the story should logically continue:

- say **no observation available**
- do not imply recovery
- do not imply continued propagation with certainty

Examples:

- no observed downstream stop after the dwell on the same trip
- no observed departure on the next block trip
- missing timepoint between two known observations

---

## Recommended UI structure

## Header

Show:

- route
- block
- date
- dwell stop
- dwell time
- pre-existing lateness

Subtitle:

> Follow the incident on the same trip first, then see whether it carried into later trips on the block.

## Story rail

The left-side story path should become:

1. **Started**
2. **Same-trip impact**
3. **Carried into next trip** or **Absorbed before next trip**
4. **Back under 5 min**
5. **Recovered to zero**

If a phase is unknown because of missing observations, show that explicitly.

## Timeline

The timeline should visually separate:

- incident trip remainder
- later block trips

Trip boundaries should be obvious, and the first same-trip downstream point should appear before any later-trip point.

## Map

The map should visually distinguish:

- origin stop
- same-trip downstream stops
- later-trip carryover stops
- threshold milestone
- zero-recovery milestone

If the first mappable downstream point is far from the origin, the UI should explain why:

> First observed downstream timepoint available here.

## Metrics

Prefer these planner-facing metrics:

- **Same-trip delay carried**
- **Later trips touched**
- **OTP-late departures caused**
- **First back under 5 min**
- **Full recovery point**

Avoid using only a generic "total route impact" headline for the incident card.

---

## Recommended implementation order

### Slice 1 — Honesty pass (smallest useful change)

Do not change the algorithm yet. Make the current feature truthful.

Changes:

- rename the story from a generic cascade view to a **block carryover** view where appropriate
- explain that the current traced path begins at the **first observed downstream timepoint on later trips**
- rename metrics from broad "impact" language to clearer "trips touched" / "OTP-late departures"
- show a warning when the first visible impact is not on the same trip

Success condition:

The planner can understand why a Park Place dwell may first appear later in the chain without assuming the model is broken.

### Slice 2 — Same-trip trace (highest-value behavior fix)

Add explicit tracing for the remainder of the incident trip before later trips.

Changes:

- include same-trip downstream observations in the story
- expose same-trip threshold and zero milestones when they occur
- keep later-trip carryover tracing after that

Success condition:

The story always shows what happened immediately after the dwell before showing later block carryover.

### Slice 3 — Stronger visual story

Refine the timeline, map, and cards once the calculation model is right.

Changes:

- separate same-trip and later-trip sections visually
- improve labels and milestone callouts
- optionally expand from timepoint-only display where needed for continuity

Success condition:

A planner can read the incident story without needing to infer hidden logic.

---

## Acceptance criteria for the target experience

The feature is behaving correctly when all of the following are true:

1. A dwell at Park Place first shows the **remainder of that trip** before any later trip.
2. The UI clearly distinguishes **same-trip impact** from **later-trip carryover**.
3. The UI clearly distinguishes **any delay carried** from **OTP-late impact**.
4. Missing observations are labeled as **unknown**, not treated as recovery.
5. The UI exposes observation coverage, including same-trip observed points, later-trip observed points, missing AVL points, and whether the incident record was matched.
6. If the first observed downstream point is far from the origin, the UI explains the observation gap.
7. The UI distinguishes **returned under 5 min** from **stayed under 5 min**.
8. Metrics that sum delay across observed points are labeled as summed observed delay, not elapsed delay minutes.
9. A planner can answer:
   - what the dwell added,
   - whether that added delay survived recovery,
   - where it dropped under 5 minutes,
   - where it fully cleared.
