# System Design Review Handoff

> Date: April 9, 2026
> Purpose: Architecture review handoff for a future chat session
> Scope: Current uncommitted changes only

## Current position

The current changes are moving the repo in a better direction overall.

The biggest positive shift is that shared backend behavior is starting to get pulled out of duplicated runtime wrappers:

- optimize logic is no longer fully duplicated between `api/optimize.ts` and `functions/src/optimize.ts`
- Vite local dev now delegates to canonical API handlers instead of re-implementing route behavior inline
- performance data now has three intentional storage shapes:
  - full app summary
  - lightweight overview summary
  - report-focused summary for daily email

That said, the structure is **not fully settled yet**. The current state is better than before, but there are still a few architectural seams that could drift if left alone.

## Main structural concerns

### 1. Server-only optimize logic lives in a too-generic shared location

`utils/ai/optimizeCore.ts` is a good extraction, but it is really server runtime code, not a general-purpose utility.

Right now it mixes:

- prompt/rules construction
- Gemini client calls
- schedule scoring
- shift post-processing
- candidate selection

That makes ownership blurry and future edits riskier than they need to be.

### 2. Performance snapshot shaping is duplicated

Overview/report snapshot-building logic now exists in both:

- `utils/performanceOverviewSummary.ts`
- `functions/src/index.ts`

That means browser-side save flows and Functions ingest/rebuild flows can slowly stop matching.

### 3. The performance data contract is still maintained in parallel

Metadata and summary contract changes still have to be made in both:

- `utils/performanceDataTypes.ts`
- `functions/src/types.ts`

This works, but it is easy to miss one side.

### 4. `vite.config.ts` still carries too much route glue

Delegating local requests to canonical handlers is the right direction.

But `vite.config.ts` still contains route-specific body buffering and response patching. If more endpoints follow the same pattern, the dev server config will become a second API layer.

### 5. There is still an awkward cross-runtime dependency

`api/optimize.ts` currently imports `functions/src/optimizePipelinePolicy.ts`.

Even though this works, it is not a clean boundary. It would be better if both runtimes depended on a neutral shared module instead of one runtime reaching into another runtime's folder.

## What is well placed already

### 1. Optimize extraction was the right move

These wrappers are much thinner now:

- `api/optimize.ts`
- `functions/src/optimize.ts`

That is materially better than carrying two copies of the core optimize logic.

### 2. Canonical API handler delegation is a good pattern

These are now acting more like the source-of-truth handlers:

- `api/optimize.ts`
- `api/performance-query.ts`

And Vite dev is delegating to them rather than re-implementing the same logic separately.

### 3. The performance storage split makes sense

The three storage forms are well motivated:

- `storagePath` for the full app dataset
- `overviewStoragePath` for fast dashboard first-load
- `reportStoragePath` for the daily report

This is a sensible separation by use case.

### 4. Daily report behavior is better aligned with scale

`functions/src/dailyReport.ts` now prefers `reportStoragePath`, which should keep report generation lighter and more stable as the full dataset grows.

### 5. Durable docs were updated

The architecture changes were reflected in:

- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`
- `ORCHESTRATOR.md`

That is the correct repo behavior after structural change.

## What should move, split, or be simplified

### Priority 1 — move optimize runtime code into a neutral shared server area

Best candidates:

- `utils/ai/optimizeCore.ts`
- `functions/src/optimizePipelinePolicy.ts`

Target shape could be something like:

- `server/optimize/`
- or `lib/server/optimize/`

Goal:

- both `api/` and `functions/src/` depend on the same neutral module
- neither runtime layer imports from the other

### Priority 2 — split `optimizeCore.ts` by responsibility

Recommended internal split:

- prompt/rules builder
- Gemini client/schema module
- schedule evaluation/scoring module
- orchestration runner
- thin endpoint wrappers

Goal:

- smaller files
- easier testing
- lower chance of mixing runtime concerns with business rules

### Priority 3 — centralize performance snapshot building

Create one shared snapshot builder used by:

- browser-side save flow
- Functions ingest
- rebuild flow
- backfill flow

Goal:

- one source of truth for overview/report summary shaping
- lower risk of dashboard/report drift

### Priority 4 — consolidate shared performance metadata contract

Even if the full type graph is not unified yet, at minimum centralize:

- `storagePath`
- `overviewStoragePath`
- `reportStoragePath`
- shared performance metadata shape

Goal:

- reduce parallel edits across frontend and Functions types

### Priority 5 — add a tiny Vite API adapter helper

If this dev-delegation approach continues, add one small helper for:

- reading request bodies
- attaching `status()` / `json()` helpers
- calling canonical handlers

Goal:

- keep `vite.config.ts` from turning into endpoint-by-endpoint glue code

## Biggest future risk if left as-is

The biggest risk is **silent drift across runtime paths**.

That means these paths slowly stop behaving the same:

- local dev path
- Vercel/API path
- Firebase Functions path
- dashboard snapshot path
- daily report path

The most likely early failure point is the performance snapshot/report flow:

- one path writes one reduced summary shape
- another path writes a slightly different one
- the dashboard expects one version
- the daily report expects another

This kind of drift is easy to miss until something fails in production or behaves differently between environments.

## Recommended next step

If continuing this work in a later chat, the best next design cleanup is:

1. move optimize shared runtime logic into a neutral server-shared area
2. move optimize pipeline policy there too
3. centralize overview/report snapshot shaping into one shared builder
4. then review whether performance metadata/types can be partially unified without a larger refactor

That sequence gives the best cleanup value without trying to redesign the whole repo at once.

## Files reviewed for this handoff

- `api/optimize.ts`
- `api/performance-query.ts`
- `functions/src/optimize.ts`
- `functions/src/index.ts`
- `functions/src/dailyReport.ts`
- `functions/src/reportHtml.ts`
- `functions/src/types.ts`
- `functions/src/optimizePipelinePolicy.ts`
- `utils/ai/optimizeCore.ts`
- `utils/performanceOverviewSummary.ts`
- `utils/performanceDataService.ts`
- `utils/performanceDataTypes.ts`
- `vite.config.ts`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`
- `ORCHESTRATOR.md`

## Verification completed during review

### Automated tests run

- `tests/optimizeApiHandler.test.ts`
- `tests/optimizeCore.shared.test.ts`
- `tests/optimizeCore.test.ts`
- `tests/performanceQuery.test.ts`
- `tests/performanceOverviewSummary.test.ts`
- `tests/scheduleGenerator.lockedLogic.test.ts`

Result:

- 6 test files passed
- 15 tests passed

### Build verification run

- root app build: `npm run build`
- Functions build: `npm run build` from `functions/`

Both passed during the review session.

## Suggested prompt for next chat

“Continue the system design cleanup review in Scheduler 4. Start with `docs/plans/2026-04-09-system-design-review-handoff.md`. Focus first on moving optimize shared runtime logic into a neutral server-shared module, then centralizing performance overview/report snapshot shaping so local app saves and Functions ingest/rebuild use the same logic. Do not make unrelated product changes.” 
