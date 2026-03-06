---
name: pm-review
description: Reviews implementation plans against product vision and architecture. Use /pm-review after creating a plan to validate alignment with product goals.
user_invocable: true
---

## Product Manager Review Skill

Invoked with `/pm-review` or automatically suggested during complex planning.

### Purpose

Act as a product manager reviewing implementation plans to ensure:
- Alignment with product vision and user workflows
- Respect for architectural constraints and locked logic
- Appropriate scope (not over-engineered)
- No unintended side effects on existing features

### When to Use

- After creating an implementation plan for a significant feature
- Before major refactors that touch core workflows
- When uncertain if a proposed approach fits the product direction
- During plan mode, before requesting user approval

### Workflow

1. **Gather Context**
   - Read `docs/CONTEXT_INDEX.md` (load order and doc tiers)
   - Read `docs/PRODUCT_VISION.md` (product goals, anti-patterns)
   - Read `docs/rules/LOCKED_LOGIC.md` (locked logic summary)
   - Read `.claude/context.md` if detailed implementation notes are needed
   - Read `.claude/CLAUDE.md` (development patterns)
   - Review the current plan or proposed changes

2. **Analyze Plan Against Vision**

   | Check | Question |
   |-------|----------|
   | **Core Workflow** | Does this serve Create → Edit → Optimize → Publish? |
   | **User Focus** | Which user (Planner/Manager/Dispatcher) benefits? |
   | **Draft→Publish** | Does it respect the two-stage workflow? |
   | **Human Control** | Does the planner remain in control? |
   | **Scope** | Is this solving the actual problem, not a generalized one? |
   | **Locked Logic** | Does it touch segment rounding, block assignment, or other locked patterns? |

3. **Identify Concerns**
   - Flag any vision misalignments
   - Note locked logic impacts
   - Highlight scope creep risks
   - Call out missing considerations

4. **Output Structured Review**

### Output Format

```markdown
## PM Review: [Feature/Plan Name]

### Alignment Score: [1-10]

### Vision Alignment
- [ ] Serves core workflow (Create → Edit → Optimize → Publish)
- [ ] Respects draft→publish pattern
- [ ] Keeps planner in control
- [ ] Appropriate for Barrie Transit scope

### Concerns
1. [Concern with specific reference to vision doc]
2. [Another concern if applicable]

### Locked Logic Impact
- [ ] Segment rounding: [None/Low/High risk]
- [ ] Block assignment: [None/Low/High risk]
- [ ] Time parsing: [None/Low/High risk]

### Recommendation
**[APPROVE / APPROVE WITH CHANGES / REQUEST REVISION]**

[Specific guidance or required changes]

### Suggestions
- [Optional improvement]
- [Alternative approach if applicable]
```

### Scoring Guide

| Score | Meaning |
|-------|---------|
| 9-10 | Excellent alignment, proceed confidently |
| 7-8 | Good alignment, minor adjustments suggested |
| 5-6 | Acceptable but notable gaps to address |
| 3-4 | Significant concerns, needs revision |
| 1-2 | Does not align with product vision |

### Common Concerns to Check

1. **Over-engineering**
   - Is this solving hypothetical future needs?
   - Does it add configurability that wasn't requested?
   - Could this be simpler?

2. **Workflow Disruption**
   - Does this change how planners currently work?
   - Are there migration considerations?
   - Will existing drafts/schedules be affected?

3. **Scope Creep**
   - Is this solving the stated problem or adjacent ones?
   - Does it introduce new concepts users didn't ask for?
   - Is it Barrie-specific or accidentally generalizing?

4. **Technical Debt**
   - Does this add complexity to core scheduling logic?
   - Are there simpler alternatives?
   - Will this be hard to maintain?

### Example Reviews

**Good Plan (Score: 9)**
```
## PM Review: Add recovery time column to schedule export

### Alignment Score: 9

### Vision Alignment
- [x] Serves core workflow - Export is part of Publish
- [x] Respects draft→publish - Only affects export output
- [x] Keeps planner in control - Display only, no automation
- [x] Appropriate scope - Specific to existing export feature

### Concerns
None significant.

### Locked Logic Impact
- Segment rounding: None
- Block assignment: None
- Time parsing: Low risk (reading existing data)

### Recommendation
**APPROVE**

Clean addition to existing functionality. Proceed with implementation.
```

**Problematic Plan (Score: 4)**
```
## PM Review: Add multi-agency support

### Alignment Score: 4

### Vision Alignment
- [ ] Serves core workflow - Adds complexity to all workflows
- [x] Respects draft→publish - Pattern preserved
- [x] Keeps planner in control - Yes
- [ ] Appropriate scope - Vision explicitly states single-city scope

### Concerns
1. Vision doc states "Single-city scope - Hardcoded for Barrie Transit"
2. Would require significant refactor of route configuration
3. No stated user need for multi-agency

### Locked Logic Impact
- Block assignment: HIGH risk - route assumptions throughout

### Recommendation
**REQUEST REVISION**

This contradicts the product vision. If multi-agency is now a requirement,
update PRODUCT_VISION.md first with stakeholder approval, then re-plan.
```

### Integration Notes

- Run `/pm-review` after using EnterPlanMode and before ExitPlanMode
- For smaller changes, use judgment - not every edit needs PM review
- When score < 7, address concerns before proceeding
- Update PRODUCT_VISION.md if business requirements have genuinely changed
