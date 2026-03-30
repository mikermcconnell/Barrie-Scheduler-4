# New Schedule Dynamic Stop-Order Resolution

Status: Proposed  
Date: March 30, 2026  
Audience: Engineers working on New Schedule Step 2 runtime analysis, route-chain resolution, and schedule generation

---

## 1. Purpose

This document defines the recommended process for resolving the **planning stop order** used by the New Schedule wizard without relying on a manually maintained route-stop list or on GTFS as the primary source of truth.

The core problem is operational drift:

- stops can be added, removed, moved, or temporarily bypassed
- published GTFS may lag operations
- master schedules may be stale, one-sided, or too coarse
- partial trips can pollute runtime analysis if they are treated as full patterns

The solution must therefore be:

- **dynamic**
- **stop-number-first**
- **resistant to partial trips**
- **safe for schedule-building**
- **planner-reviewable when confidence is low**

---

## 2. Decision Summary

### Recommended decision

Use a **dynamic stop-order resolver** that builds the planning stop chain from recent observed full trips, using **stop numbers / stop IDs as the primary key** and **stop names only as fallback evidence**.

### Source ranking

The resolver should rank evidence in this order:

1. **Recent complete observed trip pattern**
2. **Recent midday complete observed trip pattern**
3. **Recent dominant complete all-day pattern**
4. **Current master schedule stop chain** for labels and fallback only
5. **GTFS** as last resort only

### Key rule

**Partial trips must never define the planning stop order.**

They may be shown in diagnostics, but they must not establish the canonical chain used for Step 2 planning or Step 3/4 generation.

---

## 3. Why not a maintained stop-order table?

Manually maintained stop-order metadata would drift too quickly for Barrie operations.

It would add recurring maintenance cost whenever:

- a stop is inserted or removed
- a loop branch changes
- a terminal platform changes
- construction detours alter the active path

A planner-maintained table can still exist as an override or review artifact in the future, but it should **not** be the default source of truth.

---

## 4. Core principles

### 4.1 Stop numbers first

When stop numbers / stop IDs are available, they are the primary identity.

Use stop names only for:

- cross-source reconciliation
- alias normalization
- fallback matching when numbers are absent
- user-facing labels

### 4.2 Full patterns define planning truth

Planning truth must be built from observed trips that look like full route traversals for the selected route + direction + day type.

### 4.3 Midday is preferred, not mandatory

Midday is a good heuristic because it tends to avoid short turns and pull-ins/pull-outs.

However, the system should prefer the **best complete recent pattern**, with midday acting as a scoring boost rather than a hard dependency.

### 4.4 Diagnostics and planning are separate

The resolver may keep alternate or partial patterns for diagnostics, but the approved planning chain must only use the chosen full pattern.

### 4.5 Changes should be detectable

When the resolved stop order changes materially from the previously trusted pattern, the system should surface that change for review instead of silently accepting weak evidence.

---

## 5. Resolver input

The stop-order resolver should operate on:

- selected route
- selected day type
- optional selected date range
- recent performance data
- route/direction identity rules from `utils/config/routeDirectionConfig.ts`
- stop alias normalization from `utils/runtimeSegmentMatching.ts`
- optional master schedule stop chain for fallback / comparison

Expected input evidence:

- trip-stop segment runtime entries
- stop-level segment runtime entries
- route metadata
- direction hints from route variants and trip names

---

## 6. Resolver output

The resolver should produce a domain object like:

```ts
interface ResolvedStopOrder {
  routeId: string;
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  direction: 'North' | 'South';

  source:
    | 'observed-midday-pattern'
    | 'observed-dominant-pattern'
    | 'master-fallback'
    | 'gtfs-fallback';

  confidence: 'high' | 'medium' | 'low';

  stopIds: string[];
  stopNames: string[];

  tripCountUsed: number;
  dayCountUsed: number;

  middayTripCount: number;
  alternatePatternCount: number;

  changedFromPrevious: boolean;
  changeSeverity: 'none' | 'minor' | 'major';

  warnings: string[];
}
```

Step 2 should depend on this resolved object, not on ad hoc stop-chain loading in the wizard shell.

---

## 7. Pattern-building process

## 7.1 Build candidate trips

For the selected route + direction + day type:

1. gather recent observed trips
2. normalize direction
3. normalize stop names
4. preserve stop IDs / stop numbers where available

Each candidate trip should carry:

- ordered stop IDs
- ordered stop names
- start/end times
- day date
- whether it falls in the preferred midday window

## 7.2 Exclude obvious non-full trips

Reject trips that look like:

- short turns
- pull-ins
- pull-outs
- deadheads mixed into service
- trips with non-monotonic stop-number order
- trips with too few matched stops

Suggested v1 exclusion rules:

- trip has fewer than a minimum stop count for the route family
- stop sequence is not monotonic by route stop index
- trip starts too far into the route pattern
- trip ends too early in the route pattern
- trip has large internal stop gaps that imply a missing middle section

## 7.3 Build pattern signatures

For each remaining trip, create a signature using:

1. ordered stop IDs when available
2. normalized stop names as fallback

Examples:

- `stopId:123 > stopId:456 > stopId:789`
- fallback: `park place > downtown > georgian mall`

## 7.4 Cluster identical patterns

Group trips by pattern signature and compute:

- number of trips
- number of days represented
- midday trip count
- latest observed date
- average completeness score

## 7.5 Score patterns

Score candidate patterns using:

1. **completeness** — highest weight
2. **frequency across days**
3. **midday presence**
4. **recency**
5. **low ambiguity in stop matching**

Suggested order of preference:

- complete midday dominant pattern
- complete all-day dominant pattern
- master fallback
- GTFS fallback

## 7.6 Select one pattern

Choose the highest-scoring **complete** pattern as the resolved planning stop order.

If no complete observed pattern exists:

- use master fallback if safe
- otherwise block Step 2 planning and surface diagnostics

---

## 8. Completeness rules

A pattern is **complete** only if it represents the full operational route path for the chosen direction.

It should not be accepted just because it has many stops.

Suggested v1 rules:

- stop sequence is monotonic
- start and end both match route-appropriate termini or trusted anchors
- internal stop gaps are acceptable only when a known alias / replacement can bridge them
- missing interior stops disqualify the pattern from planning truth

Important:

If the resolver cannot prove whether a trip is full, treat it as **diagnostic-only**, not planning truth.

---

## 9. Midday heuristic

Midday should be used as a **confidence boost** because it tends to represent full standard service.

Recommended use:

- prefer trips within a configurable midday window, such as 10:00–14:00
- do not require midday if recent complete trips outside the window are stronger

Midday should therefore influence ranking, not replace completeness and frequency.

---

## 10. Handling route changes over time

This process is intended to adapt automatically when the route changes.

### Auto-accept minor changes

If the dominant complete pattern changes by only:

- one inserted stop
- one removed stop
- one renamed stop

and confidence remains high, the new pattern can become the current planning chain automatically.

### Flag major changes

If the pattern changes materially, such as:

- new branch structure
- different terminus
- several stops inserted/removed
- different dominant midday pattern

then Step 2 should warn the planner that the planning stop chain changed significantly.

This does **not** require manual maintenance every time. It requires **review only when the evidence says the route materially changed**.

---

## 11. Integration with Step 2

The dynamic stop-order resolver should run **before** Step 2 health evaluation and before planning-segment approval.

### Planning path

1. resolve stop order per direction
2. build canonical adjacent segment columns from the resolved stop order
3. map runtime evidence onto those adjacent segments
4. exclude partial jumps and under-proven paths
5. compute buckets, bands, and health

### Diagnostic path

Diagnostics may still show:

- alternate patterns
- skipped-stop trips
- partial trips
- fallback path guesses

But these must not drive approved planning output.

---

## 12. Integration with Step 3 and Step 4

Step 3 and Step 4 should receive the resolved stop order only through the approved Step 2 contract.

They should never:

- re-derive route chain order from GTFS
- silently reload master schedule stops as planning truth
- accept partial-stop runtime chains as schedule inputs

---

## 13. Suggested module boundary

Create a dedicated resolver module, separate from the wizard shell:

```ts
utils/newSchedule/stopOrderResolver.ts
```

Suggested responsibilities:

- trip candidate extraction
- pattern signature building
- pattern clustering and scoring
- resolved stop-order selection
- change detection against previous resolved chain

Keep these concerns out of:

- `NewScheduleWizard.tsx`
- Step 2 rendering components
- schedule generation utilities

The wizard should orchestrate. The resolver should decide.

---

## 14. Proposed resolution strategy

### Option A — Recommended

**Observed full-pattern resolver with midday weighting**

How it works:

- derive stop order from recent complete observed trips
- weight midday patterns higher
- choose the most trustworthy complete pattern
- fall back to master only when observed confidence is too low

Pros:

- adapts automatically to route changes
- not GTFS-dependent
- minimizes planner maintenance
- naturally resists stale published data

Cons:

- requires good partial-trip filtering
- needs confidence thresholds and review warnings

### Option B

**Midday trip only**

How it works:

- use only a midday full trip or midday dominant pattern as the stop order

Pros:

- simple
- often operationally clean

Cons:

- fragile when midday data is sparse
- one odd midday trip can distort the result

### Option C

**Master-first with observed fallback**

Pros:

- easy to ship

Cons:

- too dependent on stale schedule structure
- does not solve the real maintenance problem

### Recommendation

Choose **Option A**.

---

## 15. Where planner input still helps

The planner should not need to constantly maintain stop-order tables.

However, planner input is still useful for:

- confirming major pattern changes
- defining route-family-specific terminal anchors
- identifying known stop aliases not yet in normalization
- resolving rare ambiguous stop-number gaps

Useful optional planner inputs:

1. terminal anchor stops by route + direction
2. known stop alias pairs
3. known non-service partial trip families to exclude

These are light-touch guardrails, not a full maintained stop list.

---

## 16. Implementation phases

### Phase 1

Add a stop-order resolver that:

- extracts recent trip patterns
- filters obvious partial trips
- picks a dominant complete observed pattern
- returns resolved stop IDs and names

### Phase 2

Wire Step 2 planning to use the resolved chain instead of loading master stops directly in the wizard shell.

### Phase 3

Add confidence scoring and change detection.

### Phase 4

Add planner-facing diagnostics:

- chosen pattern
- alternate patterns
- confidence
- major-change warning

---

## 17. Practical rule of thumb

For this repo, the simplest durable rule is:

> Build planning stop order from the dominant recent complete observed trip pattern, prefer midday when available, use stop numbers first, use stop names second, and never let partial trips define planning truth.

