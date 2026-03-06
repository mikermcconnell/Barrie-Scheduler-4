# Markdown Review Handoff

Date: 2026-03-06

## What this file is

This is a saved handoff note from the Markdown/documentation review session in case the chat transcript is unavailable.

## Scope reviewed

- Root-level Markdown files
- `docs/` structure and context hierarchy
- runbooks, setup docs, plan docs, and archive suitability
- whether Markdown matched the actual repo/code/config/rules

## Key findings from the review

### Important

1. `FIREBASE_RULES.md` described an outdated user-only security model that did not match the live team-based rules in `firestore.rules` and `storage.rules`.
2. `README.md` referenced `.env.local.example`, but that file did not exist.
3. `README.md` had stale file paths in the project structure section.
4. Route documentation was inconsistent across docs, especially for route `400`.
5. `docs/route-colors.md` did not match `utils/config/routeColors.ts` and used an outdated import path.
6. Context hierarchy between `.claude/CLAUDE.md` and `.claude/context.md` was not stated clearly enough.
7. Shared docs contained environment-specific values such as a real email address and a real team ID.

## Changes applied

### Updated

- `README.md`
- `FIREBASE_RULES.md`
- `docs/CONTEXT_INDEX.md`
- `docs/PRODUCT_VISION.md`
- `docs/route-colors.md`
- `docs/AUTO_INGEST_SETUP.md`
- `docs/rules/LOCKED_LOGIC.md`
- `functions/scripts/TEST_EMAIL.md`

### Added

- `.env.example`
- `docs/archive/README.md`
- `docs/archive/Transit_Dashboard_Business_Case.md`

### Moved

- `Transit_Dashboard_Business_Case.md` moved from repo root to `docs/archive/`

## What changed conceptually

- The repo now has a clearer documentation entry path.
- `README.md` points to a real env template and a better doc map.
- `FIREBASE_RULES.md` is now an explainer instead of a stale copy-paste source.
- `.claude/CLAUDE.md` is treated as workflow/danger-zone guidance.
- `.claude/context.md` is treated as deeper compatibility/history context, not default context.
- Personal or environment-specific values were removed from shared docs.
- Historical/non-canonical material is now explicitly archived.

## Verification completed

- Markdown link scan: no broken local links found
- Targeted scan: removed values no longer present in the reviewed shared docs
- I did not run build/tests because this was a documentation-only patch set

## Remaining recommended next step

Do a second-pass drift audit for:

- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`
- `docs/IMPLEMENTATION_PLAN.md`

Reason: those files are more likely to drift as the app evolves, and they are part of the durable context spine.

## Reusable prompt for other projects

```text
Review this repository’s Markdown documentation with a best-practice lens.

Context:
- Treat the Markdown files as operational documentation artifacts, not marketing copy.
- Evaluate them for maintainability, context quality, correctness, drift, and usefulness to future contributors or agents.
- Use the repository itself as the source of truth. Validate docs against actual files, folders, config, rules, and code where relevant.
- Focus especially on whether the repo has a clear documentation spine:
  - a good entrypoint
  - clear context/load order
  - clear separation between durable docs, operational runbooks, and archive/history
  - minimal duplication and minimal stale “sources of truth”
- Assume success means the docs become easier to trust, easier to navigate, and less likely to mislead someone making changes.

What to review:
- All `*.md` / `*.markdown` files in the repo
- Root-level docs
- `docs/` structure and taxonomy
- Any context or agent instruction docs if they exist
- Runbooks, plans, archived notes, setup docs, and feature docs

Review criteria:
- Broken, stale, or misleading file paths
- Docs that no longer match the real code/config/rules
- Duplicate or conflicting sources of truth
- Missing or weak repo entrypoints
- Confusing context hierarchy or load order
- Root-level docs that should be moved into `docs/` or archive
- Hardcoded personal, environment-specific, or secret-like values in docs
- Poor Markdown hygiene:
  - weak headings
  - inconsistent structure
  - unclear ownership/source-of-truth language
  - overly long files that should be split
  - historical notes mixed with current truth
- Whether examples, commands, and imports are still valid
- Whether “plans” or “working notes” are being used as de facto canonical docs

Output requirements:
- Use a code-review mindset, but for documentation.
- Findings first, ordered by severity.
- For each finding, include:
  - severity (`Critical`, `Important`, or `Minor`)
  - file path
  - concise explanation of the issue
  - concrete recommendation
- After findings, include:
  - open questions or assumptions
  - a short summary of the repo’s documentation health
- If there are no findings, say so explicitly and mention residual risks or drift areas.

Definition of success:
- The repo has a clear “start here” path.
- Durable docs are clearly separated from plans/history.
- Markdown does not contradict the codebase.
- There are no obvious stale paths, invalid examples, or personal/local values in shared docs.
- A future contributor or coding agent could navigate the project context with low risk of being misled.

Optional execution mode:
- After the review, propose the minimum high-value patch set.
- If asked to proceed, implement the documentation fixes directly.
```

## Optional stronger version

```text
After the review, go ahead and implement the high-priority documentation fixes directly, preserving intent but removing drift, ambiguity, and environment-specific values.
```
