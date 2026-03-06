# Context Index

Canonical entrypoint for repository context.

Use this file to decide what to load first and what to ignore unless explicitly needed.

---

## Default Read Order

1. `docs/rules/LOCKED_LOGIC.md`
   Core non-negotiable behavior and safety constraints.
2. `.claude/CLAUDE.md`
   Repo-specific workflow, verification expectations, and danger zones.
3. `docs/PRODUCT_VISION.md`
   Product scope, target users, anti-patterns, and decision framework.
4. `docs/ARCHITECTURE.md`
   Component map, data flow, and current source file layout.
5. `docs/SCHEMA.md`
   Firestore structure, storage layout, and type locations.

Load `.claude/context.md` only when the task touches locked schedule behavior or you need detailed historical implementation notes.

Load `docs/IMPLEMENTATION_PLAN.md` only when roadmap status matters.

Load `docs/CONNECTIONS_FEATURE.md`, `docs/AUTO_INGEST_SETUP.md`, `docs/OD_WORKSPACE_GUIDE.md`, and other feature docs only when the task is directly related.

Do not load `docs/plans/` or `docs/archive/` by default.

---

## Document Tiers

### Tier 1: Durable context

- `docs/rules/LOCKED_LOGIC.md`
- `.claude/CLAUDE.md`
- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`

These should stay concise, current, and safe to use as default context.

### Tier 2: Operational reference

- `.claude/context.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CONNECTIONS_FEATURE.md`
- `docs/AUTO_INGEST_SETUP.md`
- `docs/OD_WORKSPACE_GUIDE.md`
- `docs/route-colors.md`

These are useful, but narrower in scope and more likely to drift.

### Tier 3: Archive and working notes

- `docs/plans/`
- `docs/archive/`

These files are implementation history, working plans, and design notes. They may include:

- agent-specific instructions
- commit commands
- manual test checklists
- package install steps
- superseded implementation details

They are not reliable default context.

---

## Update Rules

- If a change alters behavior or constraints, update Tier 1 docs.
- If a change alters storage, collections, or type locations, update `docs/SCHEMA.md`.
- If a change alters component ownership or major data flow, update `docs/ARCHITECTURE.md`.
- If a plan ships, copy the durable outcome into Tier 1 or Tier 2 docs instead of leaving it only in `docs/plans/`.
- Keep `docs/plans/` as history, not as the main source of truth.

---

## Compatibility Note

`.claude/context.md` remains in the repo for compatibility with existing local skills and habits. Treat `docs/rules/LOCKED_LOGIC.md` as the read-first summary and `.claude/context.md` as the detailed companion during the transition.
