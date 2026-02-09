# Claude Code Instructions

> **READ context.md** for locked logic before modifying core schedule files.
> **READ docs/PRODUCT_VISION.md** for product goals when planning features.
> **Use /pm-review** during complex planning to validate alignment.

---

## 0. Quick Start

```bash
npm run dev          # Dev server on port 3008
npm run build        # Production build (catches TS errors)
npx vitest run       # Run all tests
npx vitest run tests/timeUtils.test.ts  # Time parsing tests (run before any time changes)
```

**Stack:** Vite + React 19 + TypeScript + Firebase + Tailwind CSS

---

## 0b. Current Project State (Feb 2026)

### Implemented and Working
- CSV/Excel runtime import → schedule generation (5-step wizard)
- GTFS import with block assignment (single route + system-wide)
- Draft → Publish workflow with version history
- Schedule editing (ScheduleEditor, RoundTripTableView, SingleRouteView)
- Connection library (team-shared targets, GO Train times, college bells)
- Public timetable brochure generator (jsPDF)
- Platform conflict detection
- AI optimization via Gemini (Generator → Critic two-pass)
- Team-based multi-tenancy with roles

### Known Issues
- **Connections C7**: Edits in ConnectionsPanel don't refresh ScheduleEditor indicators without reopen
- **Connections C4**: Stop code not validated against known stops

### Removed / Pending Reimplementation
- **Interlining (8A↔8B)**: All interline code removed Feb 2026. No `interlineNext`/`interlinePrev` fields on MasterTrip. Reimplementation pending.

### Not Yet Built
- Real-time GTFS export
- Multi-route scenario comparison
- Automated schedule regression testing

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
- Ask 1-3 clarifying questions before implementing features
- Check locked logic in context.md before modifying core files

### Don't
- Over-engineer or add unrequested features
- Create new files when editing existing ones works
- Add comments/docstrings to unchanged code
- Guess at requirements - ask instead

---

## 3. Required Tests

Before touching time parsing or schedule parsing:

```bash
npx vitest run tests/timeUtils.test.ts
```

**Post-midnight bug** has occurred 3+ times. Excel times >= 1.0 represent next day (e.g., `1.02` = 12:30 AM).

---

## 4. Task Patterns

### Bug Fix
1. Reproduce/understand the issue
2. Identify root cause `file:line`
3. Propose fix with impact assessment
4. Implement after confirmation
5. Run relevant tests

### New Feature
1. Clarify requirements (1-3 questions)
2. Impact assessment (which files affected)
3. **PM Quick Check** (auto-triggered, or `/pm-review` for complex features)
4. Wait for "go" confirmation
5. Implement with TodoWrite tracking

### Refactor
1. Explain current state and proposed change
2. Flag any behavioral changes
3. **PM Quick Check** if touching core workflows or locked logic
4. Get approval before proceeding

---

## 5. Feedback Loop

When user provides feedback like `"7/10 - missed edge case"`:
1. Acknowledge
2. Fix the specific issue
3. Note pattern for future tasks

---

## 6. Route 8A/8B Sorting Rules

Route 8A and 8B have custom "Block Flow" sort logic in `RoundTripTableView.tsx`:

- **8A/8B are separate routes** (`suffixIsDirection: false`), not direction variants
- **Default sort key**: North Allandale Terminal departure (Platform 5 for 8A, Platform 12 for 8B)
- **South-only pullout trips** (no North leg): fall back to South Allandale arrival time — this keeps morning pullouts grouped chronologically at the top
- **Post-midnight trips** (12am–3am): use `getOperationalSortTime()` (DAY_START = 4:00 AM) so late-night service sorts at the bottom, not the top
- **Tiebreaker**: `compareBlockIds()` for same-time departures
- **All other routes**: keep standard `pairIndex`-based block flow sort
- Allandale stops found dynamically via `combined.northStops.find(s => includes('allandale'))`

---

## 7. Session Memory

- **Post-midnight time parsing** - Always run tests after touching time parsing
- **Dynamic stop-name detection** - Never hardcode stop indices; use name-based matching
- **ARR → R → DEP pattern** - At merged terminuses, recognized as single stop, not duplicates
- **Interline code removed** - Don't reference `interlineNext`, `interlinePrev`, or interline functions; they no longer exist
