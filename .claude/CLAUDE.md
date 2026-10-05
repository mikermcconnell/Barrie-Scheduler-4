# Claude Code Instructions

This file is a Claude-specific workflow supplement.
Read `AGENTS.md` first for the repo's top-level agent contract.

> **READ docs/CONTEXT_INDEX.md** for context load order.
> **READ docs/rules/LOCKED_LOGIC.md** before modifying core schedule files.
> **READ docs/PRODUCT_VISION.md** for product goals when planning features.
> **Use /pm-review** during complex planning to validate alignment.

---

## 0. Quick Start

```bash
npm run dev          # Dev server on port 3008
npm run typecheck    # TypeScript validation
npm run build        # Production Vite bundle
npx vitest run       # Run all tests
npx vitest run tests/timeUtils.test.ts  # Time parsing tests (run before any time changes)
```

**Stack:** Vite + React 19 + TypeScript + Firebase + Tailwind CSS

---

## 0b. Current Product and Repository State

Do not duplicate feature status or dated roadmap claims in this tool-specific file. Use:

- `docs/PRODUCT_VISION.md` for durable product scope and boundaries
- `docs/ARCHITECTURE.md` for current ownership, entry points, and data flow
- `docs/SCHEMA.md` for current persistence and type locations
- the feature document selected by `docs/CONTEXT_INDEX.md` for feature-specific behavior

`docs/IMPLEMENTATION_PLAN.md` is a historical March 2026 snapshot, not the current roadmap. Verify status claims against current code and tests before relying on them.

---

## 1. Prompt Quality Scoring

| Score | Meaning |
|-------|---------|
| 9-10 | Perfect |
| 7-8 | Good, minor issues |
| 5-6 | Acceptable, notable gaps |
| 3-4 | Poor - broke feature or ignored constraint |
| 1-2 | Unacceptable - ignored locked logic |

**After score < 8**, ask: "What was missing?"

---

## 2. Response Preferences

### Do
- Be concise
- Show `file:line` references (e.g., `scheduleGenerator.ts:142`)
- Use TodoWrite for multi-step tasks
- Ask only the fewest questions needed; use low-risk assumptions when the request is clear
- Check locked logic in `docs/rules/LOCKED_LOGIC.md` before modifying core files
- Inspect `git status` first and preserve unrelated user changes

### Don't
- Over-engineer or add unrequested features
- Create new files when editing existing ones works
- Add comments/docstrings to unchanged code
- Reset, clean, stash, overwrite, commit, deploy, or release without explicit approval

---

## 3. Build & Verification

- **After an approved package change**, run `npm install` and include the lockfile update.
- Verify proportionally: run focused tests for the behavior changed, then
  `npm run typecheck` and/or `npm run build` when the change can affect
  compilation or bundling. Documentation-only changes require
  `npm run docs:check`, not an automatic full build.
- Do not commit, deploy, or release unless the user explicitly asks. For
  multi-phase work, keep recoverable notes and verification evidence instead
  of creating unsolicited commits.
- **Post-edit hooks** in `.claude/settings.json` provide early typecheck and
  related-test feedback. They do not replace deliberate final verification.

---

## 4. Required Tests

Before touching time parsing or schedule parsing:

```bash
npx vitest run tests/timeUtils.test.ts
```

**Post-midnight bug** has occurred 3+ times. Fixed-route Excel times >= 1.0
represent next-day service and preserve the day offset (for example, `1.02`
is about 1470 service-day minutes). Time-of-day-only domains may intentionally
normalize; read `.claude/skills/time-parsing/SKILL.md` before changing them.

---

## 5. Task Patterns

### Bug Fix
1. Reproduce/understand the issue
2. Identify root cause `file:line`
3. Propose fix with impact assessment
4. Implement when requested; ask only if a material ambiguity, locked rule, or irreversible action requires clarification
5. Run relevant tests
6. Run focused verification plus typecheck/build when relevant

### New Feature
1. Clarify only requirements that materially affect the result; otherwise use low-risk assumptions
2. Impact assessment (which files affected)
3. **PM Quick Check** (auto-triggered, or `/pm-review` for complex features)
4. Implement once the requested scope is clear
5. Implement with TodoWrite tracking
6. Run focused verification plus typecheck/build when relevant

### Refactor
1. Explain current state and proposed change
2. Flag any behavioral changes
3. **PM Quick Check** if touching core workflows or locked logic
4. Ask before proceeding only when the refactor changes behavior, locked logic, or an external system
5. Run focused verification plus typecheck/build when relevant

---

## 6. Feedback Loop

When user provides feedback like `"7/10 - missed edge case"`:
1. Acknowledge
2. Fix the specific issue
3. Note pattern for future tasks

---

## 7. Route 8A/8B Sorting Rules

Route 8A and 8B have custom "Block Flow" sort logic in `RoundTripTableView.tsx`:

- **8A/8B are separate routes** (`suffixIsDirection: false`), not direction variants
- **Default sort key**: North Allandale Terminal departure (Platform 5 for 8A, Platform 12 for 8B)
- **South-only pullout trips** (no North leg): fall back to South Allandale arrival time — this keeps morning pullouts grouped chronologically at the top
- **Post-midnight trips** (12am–3am): use `getOperationalSortTime()` (DAY_START = 4:00 AM) so late-night service sorts at the bottom, not the top
- **Tiebreaker**: `compareBlockIds()` for same-time departures
- **Routes where A/B is direction** (2, 7, 12): Block Flow sorts by the A-side terminal arrival first, with B-side first departure as fallback when that A-side terminal arrival cell is blank
- **All other routes**: keep standard `pairIndex`-based block flow sort
- Allandale stops found dynamically via `combined.northStops.find(s => includes('allandale'))`

---

## 8. Danger Zones (Extra Verification Required)

These files are high-risk for bugs. Apply extra caution and always run the listed verification:

| File | Risk | Verify With |
|------|------|-------------|
| `utils/schedule/scheduleGenerator.ts` | Locked generation, approved-runtime trust boundary | `npx vitest run tests/scheduleGenerator.goldenPath.test.ts tests/scheduleGenerator.directionStart.test.ts tests/scheduleGenerator.floating.test.ts tests/scheduleGenerator.canonicalTravelTimes.test.ts tests/scheduleGenerator.lockedLogic.test.ts` |
| `utils/blocks/blockAssignmentCore.ts` | Subtle gap-based matching | `npx vitest run tests/blockAssignmentCore.test.ts` |
| `utils/parsers/masterScheduleParser*.ts`, `utils/parsers/parserAdapter.ts` | Parser routing, partial trips, next-day values | `npx vitest run tests/timeUtils.test.ts tests/parser.test.ts tests/parserEdgeCases.test.ts tests/masterScheduleParser.roundTrip.test.ts` |
| `utils/ai/runtimeAnalysis.ts`, `utils/ai/runtimeEvidenceEligibility.ts` | Approved runtime eligibility and banding | `npx vitest run tests/runtimeAnalysis.totalTripTimes.test.ts tests/runtimeEvidenceEligibility.test.ts tests/scheduleGenerator.canonicalTravelTimes.test.ts` |
| `utils/gtfs/gtfsImportService.ts` | Direction, stop-pattern, block, recovery, interline import | `npx vitest run tests/gtfsImportService.test.ts tests/blockAssignmentCore.test.ts` |
| `vite.config.ts` | API middleware and bundle configuration | `npm run typecheck && npm run build` |
| Any time parsing (`timeUtils.ts`, `excelTimeToString`, etc.) | Post-midnight >= 1.0 boundary | `npx vitest run tests/timeUtils.test.ts` |
| `components/ScheduleEditor.tsx` | Largest component, intricate editing | `npx vitest run tests/ScheduleEditor.integration.test.tsx tests/ScheduleEditor.interactions.test.tsx` plus `npm run typecheck` and targeted manual verification |
| `components/schedule/RoundTripTableView.tsx`, `utils/schedule/roundTripSortUtils.ts` | 8A/8B, Route 400, partial-trip sorting | `npx vitest run tests/RoundTripTableView.order.test.tsx tests/roundTripSortUtils.test.ts tests/useScheduleEditing.route400.test.tsx` |
| `utils/routing/raptorEngine.ts` | RAPTOR algorithm, loop-route logic, service calendar | `npx vitest run tests/routing/` |
| `utils/routing/routingDataService.ts` | Pre-computed indexes, calendar span derivation | `npx vitest run tests/routing/` |
| `utils/transit-app/studentPassRaptorAdapter.ts` | RAPTOR→StudentPass mapping, morning/afternoon queries | `npx vitest run tests/routing/ tests/studentPassUtils.test.ts` |
| `firestore.rules`, `firestore.indexes.json`, `storage.rules` | Production authorization and query contract | Relevant app tests + `npm run test:firestore-rules`; before release compare deployed rules, and after an approved deployment perform authenticated live read/write/read-back verification |

**Rule**: When editing a Danger Zone file, run its verification command BEFORE and AFTER changes.

---

## 9. Session Memory

- **Post-midnight time parsing** - Always run tests after touching time parsing
- **Dynamic stop-name detection** - Never hardcode stop indices; use name-based matching
- **ARR → R → DEP pattern** - At merged terminuses, recognized as single stop, not duplicates
- **Interline status** - Old manual fields/functions are removed; system-wide GTFS import still uses shared `block_id` values for limited cross-route recovery and block continuity

## 10. Context Hygiene

- Default context starts at `docs/CONTEXT_INDEX.md`
- Treat `docs/plans/` as archive and working notes, not read-first context
- If a shipped change affects behavior, move the durable outcome into `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/PRODUCT_VISION.md`, or `docs/rules/LOCKED_LOGIC.md`
