---
name: doc-review
description: Audit context docs for staleness, accuracy, and best practices
user_invocable: true
---

# Documentation Review

## Purpose

Systematically audit all project context documentation to ensure it accurately reflects the current codebase. Catches stale references, missing coverage, contradictions, and structural issues before they cause incorrect agent behavior.

## When to Use

- After major refactors or feature additions
- After removing features or files
- Periodically (monthly) as a health check
- When an agent makes mistakes that suggest stale documentation
- After reorganizing file structure

## Documentation Inventory and Authority

Do not duplicate document tiers in this skill. Load these first:

1. `AGENTS.md` — repository-wide workflow, safety, and authority contract
2. `docs/CONTEXT_INDEX.md` — the canonical task router, document tiers, and source-of-truth precedence

Build the audit inventory from `docs/CONTEXT_INDEX.md` at review time. Load only the durable and feature documents relevant to the audit scope. Never promote `.claude/` supplements, tool-managed memory, dated plans, status snapshots, or archives above the authority assigned by the context index.

Also audit the repository's agent extensions:

| Location | Purpose |
|----------|---------|
| `.agents/skills/*/SKILL.md` | Portable skill sources |
| `.claude/skills/*/SKILL.md` | Claude-specific skill adapters |
| `.claude/commands/*.md` | Claude-specific commands |
| `.claude/agents/*.AGENT.md` | Claude-specific agents |

## Audit Checks

### Check 1: File & Path References

For every file path mentioned in documentation:

1. **Verify the file exists** at the stated path
2. **Verify key functions/types exist** — use `rg` for function names, type names, and exports
3. **Flag moved or renamed files** that docs still reference at old paths
4. **Flag deleted files** still referenced in docs

```
Example stale reference:
  Doc says: "See utils/blockAssignment.ts"
  Reality: File moved to utils/blocks/blockAssignment.ts
  → Flag as STALE PATH
```

### Check 2: Feature Accuracy

For each feature described as "implemented" or "working":

1. **Verify the component/file exists**
2. **Spot-check that key functionality matches description** (read the file, confirm exports)
3. **Flag features described as working that have been removed**
4. **Flag new features that exist in code but aren't documented**

To discover undocumented features, compare:
- Components in `components/` against ARCHITECTURE.md component list
- Exports in `utils/` subfolders against documented utilities
- Routes/workspaces in the app against PRODUCT_VISION.md feature list

### Check 3: Removed Code References

Search documentation for references to known removed items:

- `interlineNext`, `interlinePrev`, interline functions
- `ScheduleTweakerWorkspace`
- `DraftManagerModal`, `ScenarioComparisonModal`, `SaveErrorBoundary`, `PlatformSummary`
- Any other removed items recorded in available tool-managed memory

```bash
# Quick grep across all docs
rg -n -i "interline|tweaker|DraftManager|ScenarioComparison|SaveErrorBoundary|PlatformSummary" .agents .claude docs -g '*.md'
```

### Check 4: Locked Logic Validation

For each locked rule in `docs/rules/LOCKED_LOGIC.md` and `.claude/context.md`:

1. **Verify the source file exists** at the documented path
2. **Verify the locked logic still matches the code** — read the relevant lines
3. **Check line numbers** if provided (they shift after edits)
4. **Flag any locked rules that reference removed functionality**

### Check 5: Danger Zone Coverage

For each file in `.claude/CLAUDE.md` Section 8 (Danger Zones):

1. **Verify the file exists** at the stated path
2. **Verify the test command works** (or at least that the test file exists)
3. **Check if new high-risk files should be added** to the danger zone table
4. **Cross-reference with recent bug patterns** in tool-managed memory when available

### Check 6: Cross-Document Consistency

Check for contradictions between documents:

| Check | Files to Compare |
|-------|-----------------|
| Stack description | `.claude/CLAUDE.md` vs ARCHITECTURE.md vs package.json |
| Feature status | PRODUCT_VISION.md and feature docs vs current code/tests |
| Known issues | Feature docs vs current code/tests |
| File structure | ARCHITECTURE.md vs actual repository tree |
| Test inventory | `.claude/CLAUDE.md` danger zones vs actual test files |

### Check 7: Skill File Health

For each portable skill in `.agents/skills/` and each tool adapter in `.claude/skills/`:

1. **Verify referenced files/functions still exist**
2. **Check for stale trigger conditions** (e.g., referencing removed features)
3. **Confirm frontmatter format** (name, description, optional user_invocable)
4. **Flag skills that reference removed functionality**

### Check 8: Tool-Managed Memory Hygiene

1. **Under 200 lines** (lines after 200 are truncated in system prompt)
2. **No session-specific content** (temporary state, in-progress work)
3. **No contradictions with `AGENTS.md` or `docs/CONTEXT_INDEX.md`** (repository context remains authoritative)
4. **Organized by topic**, not chronologically
5. **Links to detailed topic files** if tool-managed memory is getting long

## Output Format

Produce a structured report with these sections:

```markdown
# Doc Review Report — [Date]

## Summary
- Files audited: X
- Issues found: X (Y critical, Z minor)
- Last review: [date or "first review"]

## Critical Issues (Fix Immediately)
Issues that will cause incorrect agent behavior:
- [ ] [FILE:LINE] Description of issue

## Stale References (Fix Soon)
Outdated but not immediately harmful:
- [ ] [FILE:LINE] Description of issue

## Missing Coverage (Add When Convenient)
Features or files not yet documented:
- [ ] Description of gap

## Consistency Warnings
Cross-document contradictions:
- [ ] [FILE1] vs [FILE2]: Description

## Best Practice Suggestions
Structural improvements:
- [ ] Suggestion

## Verified OK
Things confirmed accurate (brief list for confidence):
- Locked logic rules 1-6: ✓
- Danger zone files exist: ✓
- etc.
```

## Workflow

1. **Read `AGENTS.md` and `docs/CONTEXT_INDEX.md`**, then load the smallest relevant authoritative set
2. **Run Check 3** (removed code grep) — fastest way to find stale content
3. **Run Check 1** (file/path references) — systematic path verification
4. **Run Checks 2, 4, 5** in parallel where possible using subagents
5. **Run Check 6** (cross-document) — requires all docs loaded
6. **Run Checks 7-8** — skill and memory hygiene
7. **Compile report** in output format above
8. **Offer to fix** critical and stale issues automatically

## Automation Tips

- Use `rg --files` to inventory Markdown and verify repository paths
- Use `rg` to search for stale references across the selected documentation scope
- Use subagents for parallel checks (e.g., one per tier)
- For large audits, follow the scope and authority routes in `docs/CONTEXT_INDEX.md`

## Scope Options

When invoked, ask the user:

- **Full audit** — All tiers, all checks (~5-10 min)
- **Quick check** — Tier 1 only, checks 1-3 (~2-3 min)
- **Targeted** — Specific file or check number
