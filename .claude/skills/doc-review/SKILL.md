---
name: doc-review
description: Audit context docs for staleness, accuracy, and best practices
user_invocable: true
---

# Documentation Review

## Purpose

Systematically audit all project context documentation to ensure it accurately reflects the current codebase. Catches stale references, missing coverage, contradictions, and structural issues before they cause incorrect Claude behavior.

## When to Use

- After major refactors or feature additions
- After removing features or files
- Periodically (monthly) as a health check
- When Claude makes mistakes that suggest stale documentation
- After reorganizing file structure

## Documentation Inventory

Audit these files in order of priority:

### Tier 1 — Critical (directly controls Claude behavior)

| File | Purpose |
|------|---------|
| `docs/CONTEXT_INDEX.md` | Canonical load order and doc tiers |
| `.claude/CLAUDE.md` | Project instructions, danger zones, task patterns |
| `docs/rules/LOCKED_LOGIC.md` | Durable locked logic summary |
| `.claude/context.md` | Detailed compatibility copy of locked logic |
| `~/.claude/projects/.../memory/MEMORY.md` | Cross-session learnings |

### Tier 2 — High (referenced during planning and feature work)

| File | Purpose |
|------|---------|
| `docs/PRODUCT_VISION.md` | Product goals, user personas, feature scope |
| `docs/ARCHITECTURE.md` | Component map, data flow, stack description |
| `docs/SCHEMA.md` | Firestore collections, TypeScript types, storage paths |
| `docs/IMPLEMENTATION_PLAN.md` | Roadmap phases, completion status |

### Tier 3 — Reference (consulted for specific features)

| File | Purpose |
|------|---------|
| `docs/CONNECTIONS_FEATURE.md` | Connection library design, known issues |
| `docs/AUTO_INGEST_SETUP.md` | Automated data ingestion |
| `docs/OD_WORKSPACE_GUIDE.md` | OD workspace user guidance |
| `docs/DWELL_CASCADE_PLAN.md` | Dwell and cascade reference |
| `docs/route-colors.md` | Route color scheme reference |
| `docs/plans/README.md` | Archive policy for dated plans |

### Tier 4 — Skills & Commands

| Location | Count |
|----------|-------|
| `.claude/skills/*/SKILL.md` | All skill files |
| `.claude/commands/*.md` | All command files |
| `.claude/agents/*.AGENT.md` | All agent files |

## Audit Checks

### Check 1: File & Path References

For every file path mentioned in documentation:

1. **Verify the file exists** at the stated path
2. **Verify key functions/types exist** — grep for function names, type names, exports
3. **Flag moved or renamed files** that docs still reference at old paths
4. **Flag deleted files** still referenced in docs

```
Example stale reference:
  Doc says: "See utils/blockAssignment.ts"
  Reality: File moved to utils/blocks/blockAssignmentCore.ts
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
- Any other items listed in MEMORY.md "Key Removals" section

```bash
# Quick grep across all docs
grep -ri "interline\|tweaker\|DraftManager\|ScenarioComparison\|SaveErrorBoundary\|PlatformSummary" .claude/ docs/
```

### Check 4: Locked Logic Validation

For each locked rule in `docs/rules/LOCKED_LOGIC.md` and `.claude/context.md`:

1. **Verify the source file exists** at the documented path
2. **Verify the locked logic still matches the code** — read the relevant lines
3. **Check line numbers** if provided (they shift after edits)
4. **Flag any locked rules that reference removed functionality**

### Check 5: Danger Zone Coverage

For each file in CLAUDE.md Section 8 (Danger Zones):

1. **Verify the file exists** at the stated path
2. **Verify the test command works** (or at least that the test file exists)
3. **Check if new high-risk files should be added** to the danger zone table
4. **Cross-reference with recent bug patterns** in MEMORY.md

### Check 6: Cross-Document Consistency

Check for contradictions between documents:

| Check | Files to Compare |
|-------|-----------------|
| Stack description | CLAUDE.md vs ARCHITECTURE.md vs package.json |
| Feature status | PRODUCT_VISION.md vs IMPLEMENTATION_PLAN.md vs CLAUDE.md "Current Project State" |
| Known issues | CLAUDE.md vs CONNECTIONS_FEATURE.md vs MEMORY.md |
| File structure | ARCHITECTURE.md vs REORGANIZATION_LOG.md vs actual `ls` |
| Test inventory | CLAUDE.md danger zones vs MEMORY.md test coverage vs actual test files |

### Check 7: Skill File Health

For each skill in `.claude/skills/`:

1. **Verify referenced files/functions still exist**
2. **Check for stale trigger conditions** (e.g., referencing removed features)
3. **Confirm frontmatter format** (name, description, optional user_invocable)
4. **Flag skills that reference removed functionality**

### Check 8: MEMORY.md Hygiene

1. **Under 200 lines** (lines after 200 are truncated in system prompt)
2. **No session-specific content** (temporary state, in-progress work)
3. **No contradictions with CLAUDE.md** (CLAUDE.md is authoritative)
4. **Organized by topic**, not chronologically
5. **Links to detailed topic files** if MEMORY.md is getting long

## Output Format

Produce a structured report with these sections:

```markdown
# Doc Review Report — [Date]

## Summary
- Files audited: X
- Issues found: X (Y critical, Z minor)
- Last review: [date or "first review"]

## Critical Issues (Fix Immediately)
Issues that will cause incorrect Claude behavior:
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

1. **Read all Tier 1 docs** first to establish baseline understanding
2. **Run Check 3** (removed code grep) — fastest way to find stale content
3. **Run Check 1** (file/path references) — systematic path verification
4. **Run Checks 2, 4, 5** in parallel where possible using subagents
5. **Run Check 6** (cross-document) — requires all docs loaded
6. **Run Checks 7-8** — skill and memory hygiene
7. **Compile report** in output format above
8. **Offer to fix** critical and stale issues automatically

## Automation Tips

- Use `Glob` to verify file existence quickly
- Use `Grep` to search for stale references across all docs at once
- Use subagents for parallel checks (e.g., one per tier)
- For large audits, focus on Tier 1 first and expand if time permits

## Scope Options

When invoked, ask the user:

- **Full audit** — All tiers, all checks (~5-10 min)
- **Quick check** — Tier 1 only, checks 1-3 (~2-3 min)
- **Targeted** — Specific file or check number
