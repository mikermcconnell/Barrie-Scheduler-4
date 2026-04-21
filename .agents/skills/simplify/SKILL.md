---
name: simplify
description: Simplifies and refines code for clarity, consistency, and maintainability. Use /simplify to clean up recently modified code or specify a file/function.
user_invocable: true
---

## Code Simplification Skill

Invoked with `/simplify` or `/simplify <target>`

### Purpose

Reduce complexity while preserving functionality. Focus on:
- Eliminating duplication
- Improving readability
- Removing dead code
- Simplifying conditionals
- Extracting helper functions

### Workflow

1. **Identify Target**
   - If no target specified, check git status for recently modified files
   - If target specified, focus on that file/function

2. **Analyze**
   - Read the target code
   - Identify patterns: duplication, nested conditionals, long functions
   - Note any locked logic (check `docs/rules/LOCKED_LOGIC.md`)

3. **Plan Changes**
   - List specific simplifications
   - Estimate lines reduced
   - Flag any behavioral changes (should be NONE)

4. **Execute**
   - Make changes incrementally
   - Show before/after for significant changes
   - Run build to verify no breakage

5. **Verify**
   - `npm run build` must pass
   - Run relevant tests if they exist

### Simplification Patterns

| Pattern | Before | After |
|---------|--------|-------|
| **Duplicate code** | Same logic in 2+ places | Extract to helper function |
| **Nested conditionals** | `if (a) { if (b) { if (c) {...}}}` | Early returns or guard clauses |
| **Long functions** | 100+ line function | Split into focused helpers |
| **Magic numbers** | `if (x > 86400)` | `const SECONDS_PER_DAY = 86400` |
| **Dead code** | Unused imports, unreachable code | Remove entirely |
| **Verbose conditionals** | `if (x === true)` | `if (x)` |
| **Repeated calculations** | Same computation multiple times | Cache in variable |

### What NOT to Change

- **Locked logic** in `docs/rules/LOCKED_LOGIC.md` (ask before modifying)
- **Public API signatures** (unless explicitly requested)
- **Test files** (unless tests are the target)
- **Configuration files** without explicit request
- **Working code** that's already clear

### Output Format

```
## Simplification Report

**Target:** `utils/services/exportService.ts`
**Lines before:** 450
**Lines after:** 320
**Reduction:** 130 lines (29%)

### Changes Made
1. Extracted `renderTripTable()` helper - eliminated 165 lines of duplication
2. Removed unused import `lodash`
3. Simplified nested conditional in `validateInput()`

### Verification
- Build: PASS
- Tests: N/A (no test file)
```

### Example Usage

```
User: /simplify
→ Analyzes recently modified files, simplifies them

User: /simplify utils/schedule/scheduleGenerator.ts
→ Focuses on that specific file

User: /simplify handleExport
→ Finds and simplifies the handleExport function
```

### Safety Rules

1. **Never change behavior** - Output must be identical
2. **Build must pass** - Always verify with `npm run build`
3. **Show your work** - Report what changed and why
4. **Ask if uncertain** - If locked logic might be affected, ask first
5. **Preserve comments** - Keep meaningful comments, remove obvious ones
