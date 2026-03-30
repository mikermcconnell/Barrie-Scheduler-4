# Context Index

Canonical entrypoint for repository context.

Use this file to decide what to load first and what to ignore unless explicitly needed.

---

## Default Read Order

1. `AGENTS.md`
   Top-level agent contract and repo-specific usage rules.
2. `docs/rules/LOCKED_LOGIC.md`
   Core non-negotiable behavior and safety constraints.
3. `docs/PRODUCT_VISION.md`
   Product scope, target users, anti-patterns, and decision framework.
4. `docs/ARCHITECTURE.md`
   Component map, data flow, and current source file layout.
5. `docs/SCHEMA.md`
   Firestore structure, storage layout, and type locations.
6. `.claude/CLAUDE.md`
   Tool-specific workflow supplement and extra verification guidance for danger-zone work.

Load `ORCHESTRATOR.md` when working in orchestrator mode, delegating implementation work, recovering from compacted context, or when you need the repo's living summary of architecture, conventions, fragile areas, and current repo state. It supports Tier 1 docs and should not replace them.

Load `.claude/context.md` only when the task touches locked schedule behavior or you need detailed historical implementation notes.

Load `docs/IMPLEMENTATION_PLAN.md` only when roadmap status matters.

Load `docs/CONNECTIONS_FEATURE.md`, `docs/AUTO_INGEST_SETUP.md`, `docs/OD_WORKSPACE_GUIDE.md`, `docs/DWELL_CASCADE_FEATURE.md`, and other feature docs only when the task is directly related.

Load `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md` when the task is directly related to rebuilding or implementing New Schedule wizard Step 2.
Load `docs/NEW_SCHEDULE_STEP2_CONTRACT_DESIGN.md` when the task needs the Step 2 contract, approval, invalidation, or UI/component design.
Load `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md` when the task touches dynamic planning-chain / stop-order resolution, partial-trip filtering, or the source-of-truth rules for Step 2 route-chain selection.

Do not load `docs/plans/` or `docs/archive/` by default.

---

## Document Tiers

### Tier 1: Durable context

- `AGENTS.md`
- `docs/rules/LOCKED_LOGIC.md`
- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`

These should stay concise, current, and safe to use as default context.

### Tier 2: Operational reference

- `ORCHESTRATOR.md`
- `.claude/CLAUDE.md`
- `.claude/context.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md`
- `docs/NEW_SCHEDULE_STEP2_CONTRACT_DESIGN.md`
- `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md`
- `docs/CONNECTIONS_FEATURE.md`
- `docs/AUTO_INGEST_SETUP.md`
- `docs/OD_WORKSPACE_GUIDE.md`
- `docs/DWELL_CASCADE_FEATURE.md`
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

`AGENTS.md` is the repo's top-level agent contract. Treat `docs/rules/LOCKED_LOGIC.md` as the durable behavior summary, `.claude/CLAUDE.md` as the Claude-specific workflow supplement, and `.claude/context.md` as the detailed historical companion during the transition.
