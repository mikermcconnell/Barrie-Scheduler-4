# Corridor Performance

Durable product and technical contract for the Planning Data workspace whose stable internal route and permission identifiers remain `corridor-speed` and `analyticsCorridorSpeed`.

## Product purpose

Corridor Performance helps a transit planner identify where scheduled runtime is under pressure, determine when the condition occurs, and judge whether the evidence is strong enough to support further schedule review.

This is a planning and diagnostic surface. It does not modify schedules, GTFS, published master data, or accepted Route Planner runtime decisions.

The planner must be able to answer:

1. Which directed corridors have the greatest observed-versus-scheduled runtime pressure?
2. Is the condition route-specific, directional, or time-specific?
3. How many trips and distinct service days support the result?
4. Which STREETS history and GTFS baseline are being compared?
5. Is the result normal-service evidence, detour evidence, or unavailable because matching failed?

## Runtime semantics

- Observed runtime follows `docs/rules/LOCKED_LOGIC.md`: use departure-to-departure time when the downstream observed departure exists, with terminal/end-of-trip arrival fallback so recovery remains separate.
- Aggregated corridor observations must remain trip-linked. Do not synthesize a corridor traversal by adding independently aggregated stop-pair medians.
- Scheduled and observed comparisons remain route-, direction-, day-type-, and time-bucket-aware.
- Normal service is the default evidence population. Detours must be excluded from the headline or exposed as an explicit comparison, never silently blended.
- Headline comparisons use only explicitly normal-classified trip evidence. Entries with missing pattern classification are withheld rather than assumed to be normal service.
- Observed service dates outside the bundled GTFS effective range are withheld from scheduled-versus-observed calculations. When the source history only partially overlaps the feed, the workspace must say that only overlapping dates were compared.
- "Observed speed" means observed operating speed over the corridor geometry. It is not a claim about free-flow roadway speed.

## Evidence and confidence

Every visible result must disclose:

- matched traversal count;
- distinct service-day count;
- median observed and scheduled runtime;
- P80 and P90 observed runtime when observations exist;
- STREETS evidence date range;
- GTFS feed version and effective date range;
- whether the bundled schedule baseline covers the complete evidence range.

The workspace-level usable threshold is at least 8 matched traversals across at least 5 distinct service days. This threshold governs map/table confidence presentation. It does not silently change Route Planner runtime acceptance or fixed-route generation eligibility.

Missing GTFS provenance prevents scheduled-versus-observed comparison. Missing service-day or classification provenance remains visible as unavailable rather than being filled with fuzzy matches or fabricated estimates.

Decision-ready rankings contain only corridors that meet the usable threshold. Low-confidence evidence may remain visible in a clearly separated supporting section, but it must not occupy a decision-ready rank.

## Current architecture

- `components/Mapping/CorridorSpeedMap.tsx` remains the compatibility entry point while presenting the user-facing Corridor Performance workspace.
- `utils/gtfs/corridorSpeed.ts` retains the current GTFS and STREETS traversal adapter used by the map and Route Planner compatibility path.
- `utils/corridor-performance/corridorPerformanceEvidence.ts` owns workspace evidence thresholds, percentiles, and normal-service eligibility.
- `utils/corridor-performance/corridorPerformanceProvenance.ts` owns bundled GTFS provenance and evidence-range coverage assessment.
- `utils/corridor-performance/corridorPerformancePresentation.ts` owns map styling and display formatting, separate from traversal computation.

The current implementation still computes the full corridor index in the browser from loaded performance history. That is an explicit migration state, not the target architecture.

## Target read model

The target implementation derives a versioned Corridor Performance read model when STREETS data or a GTFS baseline changes. It should be partitioned by month and route in Cloud Storage, with bounded metadata and active-version pointers in Firestore, following existing performance-data storage patterns.

The read model must preserve:

- stable directed corridor definition and definition version;
- source import and GTFS feed provenance;
- normal/detour pattern classification;
- exclusion and unmatched-reason counts;
- date-, route-, direction-, and period-filterable aggregates;
- median, P80, P90, sample count, distinct days, and coverage.

Do not add these persistence paths without updating `docs/SCHEMA.md`, Firebase rules, shared-data boundaries, and focused emulator tests.

## Route Planner boundary

Route Planner may consume stop-to-stop or corridor runtime evidence only through a dedicated compatibility adapter. Map styling, ranking, and workspace confidence labels are not Route Planner inputs.

Existing accepted or locked Route Planner runtimes remain planner-controlled. Recomputed corridor evidence must never silently replace an accepted runtime.

## Verification

Required focused verification for changes in this feature:

- `npm test -- --run tests/corridorSpeed.test.ts tests/corridorPerformanceEvidence.test.ts`
- Route Planner evidence tests when shared types or adapters change
- TypeScript and focused lint
- production build
- manual desktop review at 1920×1080 and 1280×720 with real authenticated STREETS data
- spot checks for Routes 8, 10/100, 11, and 12, including both directions where applicable

The workspace is not decision-ready if the visible result omits the evidence range, schedule baseline, confidence basis, or exclusion behavior.
