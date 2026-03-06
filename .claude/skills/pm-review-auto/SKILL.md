---
name: pm-review-auto
description: Auto-activates during plan mode or when creating implementation plans. Performs lightweight product alignment check before ExitPlanMode.
---

# Automatic PM Review

This skill auto-activates during implementation planning to catch misalignment early.

## Trigger Conditions

Activate when:
- Using `EnterPlanMode` for feature implementation
- Writing to a plan file (`.claude/plan.md` or similar)
- About to call `ExitPlanMode`
- Creating TodoWrite lists with 5+ implementation tasks

## Quick Alignment Check

Before finalizing any implementation plan, verify:

### 1. Core Workflow Fit
Does this serve: **Create → Edit → Optimize → Publish**?

If the answer is unclear, flag for manual `/pm-review`.

### 2. Draft→Publish Respect
- [ ] Edits happen on drafts, not masters
- [ ] Publishing creates immutable versions
- [ ] No direct master schedule modifications

### 3. Locked Logic Safety
Will this touch any of these? If yes, extra scrutiny required:

| Pattern | Files | Risk |
|---------|-------|------|
| Segment rounding | `scheduleGenerator.ts` | HIGH |
| Block assignment | `blockAssignment.ts`, `gtfsImportService.ts` | HIGH |
| Time parsing | `timeUtils.ts`, `csvParser.ts` | MEDIUM |
| Trip pairing | `ScheduleEditor.tsx`, table renderers | MEDIUM |

### 4. Scope Check
Ask yourself:
- Is this solving the stated problem or a generalized version?
- Would a Barrie Transit planner recognize this as useful?
- Could this be simpler?

## Auto-Review Output

When triggered, output a brief inline check:

```
📋 PM Quick Check:
- Core workflow: ✓ Serves schedule editing
- Draft→Publish: ✓ Respects pattern
- Locked logic: ⚠ Touches scheduleGenerator.ts - verify segment rounding
- Scope: ✓ Focused on stated problem

→ Proceed with caution on locked logic. Consider running /pm-review for full analysis.
```

## Escalation Triggers

Recommend full `/pm-review` when:
- Plan touches 3+ locked logic areas
- Feature adds new data models or collections
- Change affects all routes or day types
- Architectural pattern changes proposed
- Uncertainty about vision alignment

## Reference Files

Quick-read before finalizing plans:
- `docs/PRODUCT_VISION.md` - Section "Decision Framework"
- `docs/rules/LOCKED_LOGIC.md` - Locked logic summary
- `.claude/context.md` - Detailed compatibility notes
- `.claude/CLAUDE.md` - Development patterns

## Integration with ExitPlanMode

Before calling ExitPlanMode, ensure:
1. Quick check completed (above)
2. Any ⚠ warnings addressed or acknowledged
3. Locked logic impacts documented in plan
4. User informed if full `/pm-review` recommended
