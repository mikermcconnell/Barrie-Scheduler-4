# Claude Code Instructions

> **READ context.md** for locked logic before modifying core schedule files.
> **READ docs/PRODUCT_VISION.md** for product goals when planning features.
> **Use /pm-review** during complex planning to validate alignment.

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

## 6. Session Memory

- **Post-midnight time parsing** - Always run tests after touching time parsing
- **Interline cycle calculation** - Use dynamic stop-name detection, not hardcoded indices
- **ARR → R → DEP pattern** - Recognized as single stop, not duplicates
