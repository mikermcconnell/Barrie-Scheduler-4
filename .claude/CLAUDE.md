# Claude Code Instructions

> [!IMPORTANT]
> **READ context.md FIRST** - It contains critical project context, locked logic, and domain knowledge.
> This file focuses on collaboration preferences and prompt quality.

---

## 1. Prompt Quality Scoring (1-10)

The user will rate responses using this scale. Use feedback to adapt.

| Score | Meaning | Typical Issue |
|-------|---------|---------------|
| 9-10 | Perfect | - |
| 7-8 | Good, minor issues | Missing edge case, slight over-engineering |
| 5-6 | Acceptable, notable gaps | Wrong file modified, missed requirement |
| 3-4 | Poor | Broke existing feature, ignored constraint |
| 1-2 | Unacceptable | Ignored locked logic, major regression |

**After receiving a score < 8**, ask: "What was missing?" and incorporate into future responses.

---

## 2. Response Preferences

### Do
- **Be concise** - Short answers unless complexity demands detail
- **Show file:line references** - e.g., `scheduleGenerator.ts:142`
- **Use TodoWrite** for multi-step tasks
- **Ask 1-3 clarifying questions** before implementing features (per context.md "Questions Before Implementing Features")
- **Check locked logic** in context.md before modifying core files

### Don't
- Over-engineer or add unrequested features
- Create new files when editing existing ones works
- Add comments/docstrings to unchanged code
- Guess at requirements - ask instead
- Skip the prompt refinement workflow

---

## 3. Route Direction Structure

**Config file:** `utils/routeDirectionConfig.ts`

### Complete Route Direction Table

| Route | Type | North Direction | South Direction | North Terminus | South Terminus |
|-------|------|-----------------|-----------------|----------------|----------------|
| **400** | Linear | 400 | 400 | RVH | Park Place |
| **2** | Linear | 2A | 2B | Downtown | Park Place |
| **7** | Linear | 7A | 7B | Georgian College | Park Place |
| **8A** | Linear | 8A | 8A | Georgian College | Barrie South GO |
| **8B** | Linear | 8B | 8B | Georgian College | Barrie South GO |
| **10** | Loop | Clockwise | - | - | - |
| **11** | Loop | Counter-clockwise | - | - | - |
| **12** | Linear | 12A | 12B | Georgian College | Barrie South GO |
| **100** | Loop | Clockwise | - | - | - |
| **101** | Loop | Counter-clockwise | - | - | - |

### A/B Suffix Meaning (IMPORTANT)

| Routes | A/B Suffix Meaning |
|--------|-------------------|
| **2, 7, 12** | **Direction indicator** - A = North, B = South |
| **8A, 8B** | **Route variants** - Each has its own NB + SB |

### Pattern Summary

- **Linear routes (400, 2, 7, 8A, 8B, 12):** Have North and South directions
- **Loop routes (10, 11, 100, 101):** Single direction (clockwise or counter-clockwise)

**Excel Master Schedule Layout:**
- Both directions appear in ONE schedule (e.g., Route 12 = 12A columns + 12B columns)
- A complete cycle: Terminal → Direction A stops → Turnaround → Direction B stops → Terminal
- Same stop appearing in both directions is **legitimate** (e.g., "Allandale GO" in 12A and 12B)
- Same stop with ARR → R → DEP columns is **one logical stop** (not duplicates)

**Parser behavior (`masterScheduleParserV2.ts`):**
- Stops in different directions get `(2)` suffix: "Georgian" (12A) → "Georgian (2)" (12B) ✓
- ARR → R → DEP pattern is recognized as single stop (no false duplicates) ✓

---

## 4. Key Files Quick Reference

| Purpose | File |
|---------|------|
| Trip generation | `utils/scheduleGenerator.ts` |
| CSV parsing | `components/NewSchedule/utils/csvParser.ts` |
| Runtime analysis | `utils/runtimeAnalysis.ts` |
| Master schedule parsing | `utils/masterScheduleParserV2.ts` |
| Block assignment | `utils/blockAssignment.ts` ⚠️ *recurring bugs* |
| Schedule display | `components/ScheduleEditor.tsx` |
| AI optimization | `api/optimize.ts` |
| Connection optimization | `utils/connectionOptimizer.ts` |
| Main app routing | `App.tsx` |

---

## 5. Connection Management System (New)

The wizard now includes **Step 5: Connections** for interline/transfer optimization.

### Key Files

| Purpose | File |
|---------|------|
| Types | `utils/connectionTypes.ts` |
| Config service | `utils/connectionConfigService.ts` |
| Library service | `utils/connectionLibraryService.ts` |
| Optimizer | `utils/connectionOptimizer.ts` |
| Step 5 UI | `components/NewSchedule/steps/Step5Connections.tsx` |
| Connection panels | `components/NewSchedule/connections/*.tsx` |
| Badge display | `components/schedule/ConnectionBadge.tsx` |

### Connection Panel Components

- `RouteConnectionPanel.tsx` - Edit route connections
- `ImportRouteModal.tsx` - Import routes for connection
- `OptimizationPanel.tsx` - Run connection optimization
- `ConnectionLibraryPanel.tsx` - Browse saved connections
- `AddTargetModal.tsx` - Add connection targets

---

## 6. Locked Logic Reminder

Before modifying these, **ask for approval**:

1. **Double Pass Optimization** (`api/optimize.ts`) - Generator -> Critic pattern
2. **Segment Rounding** - Round BEFORE summing
3. **Trip Pairing** - N1+S1, N2+S2 pairs per row
4. **Cycle Calculation** - Last End - First Start

---

## 7. Required Tests

**Before completing any task that touches time parsing or schedule parsing, run:**

```bash
npx vitest run tests/timeUtils.test.ts
```

### Critical: Post-Midnight Time Parsing Bug

This bug has occurred **3+ times**. The test file `tests/timeUtils.test.ts` exists specifically to prevent regression.

**Root cause:** Excel represents times as day fractions. Post-midnight times (12:30 AM, 1:00 AM) have values >= 1.0:
- `0.5` = 12:00 PM
- `1.02` = 12:30 AM (the "1" = next day)

**The fix:** Extract fractional part for values >= 1.0. See:
- `utils/timeUtils.ts:18-26`
- `utils/masterScheduleParser.ts:119-129`
- `utils/masterScheduleParserV2.ts:55-84` (parseTimeToMinutes)
- `utils/masterScheduleParserV2.ts:425` (isExcelTime check)

**If you modify any time parsing function, you MUST run the tests.**

---

## 8. Common Task Patterns

### Bug Fix
```
1. Reproduce/understand the issue
2. Identify root cause file:line
3. Propose fix with impact assessment
4. Implement after confirmation
5. Run relevant tests (see Section 6)
```

### New Feature
```
1. Clarify requirements (1-3 questions)
2. Impact assessment (which files affected)
3. Restate refined requirements
4. Wait for "go" confirmation
5. Implement with TodoWrite tracking
6. Run relevant tests
```

### Refactor
```
1. Explain current state and proposed change
2. Flag any behavioral changes
3. Get approval before proceeding
4. Run relevant tests after changes
```

---

## 9. Feedback Loop

After each significant task, the user may provide:

```
"7/10 - good but missed the edge case for empty blocks"
```

When this happens:
1. Acknowledge the feedback
2. Fix the specific issue
3. Note the pattern for future similar tasks

---

## 10. Session Memory

Key learnings from this session (updated as we work):

- **Post-midnight time parsing** - Fixed 3x. Always run `tests/timeUtils.test.ts` after touching time parsing.
- **Interline cycle calculation** - Use dynamic stop-name detection, not hardcoded column indices (different day types have different layouts).
- **Duplicate DEP columns** - Fixed in `masterScheduleParserV2.ts`. ARR → R → DEP pattern is now recognized as single stop, not three separate stops with `(2)`, `(3)` suffixes.
