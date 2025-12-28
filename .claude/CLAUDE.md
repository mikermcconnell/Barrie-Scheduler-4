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
- **Ask 1-3 clarifying questions** before implementing features (per context.md Section 9)
- **Check locked logic** in context.md before modifying core files

### Don't
- Over-engineer or add unrequested features
- Create new files when editing existing ones works
- Add comments/docstrings to unchanged code
- Guess at requirements - ask instead
- Skip the prompt refinement workflow

---

## 3. Key Files Quick Reference

| Purpose | File |
|---------|------|
| Trip generation | `components/NewSchedule/utils/scheduleGenerator.ts` |
| CSV parsing | `components/NewSchedule/utils/csvParser.ts` |
| Runtime analysis | `components/NewSchedule/utils/runtimeAnalysis.ts` |
| Schedule display | `components/ScheduleEditor.tsx` |
| AI optimization | `api/optimize.ts` |
| Main app routing | `App.tsx` |

---

## 4. Locked Logic Reminder

Before modifying these, **ask for approval**:

1. **Double Pass Optimization** (`api/optimize.ts`) - Generator -> Critic pattern
2. **Segment Rounding** - Round BEFORE summing
3. **Trip Pairing** - N1+S1, N2+S2 pairs per row
4. **Cycle Calculation** - Last End - First Start

---

## 5. Common Task Patterns

### Bug Fix
```
1. Reproduce/understand the issue
2. Identify root cause file:line
3. Propose fix with impact assessment
4. Implement after confirmation
```

### New Feature
```
1. Clarify requirements (1-3 questions)
2. Impact assessment (which files affected)
3. Restate refined requirements
4. Wait for "go" confirmation
5. Implement with TodoWrite tracking
```

### Refactor
```
1. Explain current state and proposed change
2. Flag any behavioral changes
3. Get approval before proceeding
```

---

## 6. Feedback Loop

After each significant task, the user may provide:

```
"7/10 - good but missed the edge case for empty blocks"
```

When this happens:
1. Acknowledge the feedback
2. Fix the specific issue
3. Note the pattern for future similar tasks

---

## 7. Session Memory

Key learnings from this session (updated as we work):

- *(none yet - will be updated based on feedback)*
