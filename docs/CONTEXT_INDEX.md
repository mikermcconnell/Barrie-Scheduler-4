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

Load `ORCHESTRATOR.md` when working in orchestrator mode, delegating implementation work, recovering from compacted context, or when you need the repo's living summary of architecture, conventions, fragile areas, and current repo state. It supports Tier 1 docs and should not replace them.

Load `.claude/CLAUDE.md` only as a tool-specific workflow supplement or when working in danger-zone files that need its extra verification guidance.
Load `.claude/context.md` only when the task touches locked schedule behavior or you need detailed historical implementation notes.

Load `docs/IMPLEMENTATION_PLAN.md` only when roadmap status matters.

Load feature docs only when the task is directly related, including:
- `docs/CONNECTIONS_FEATURE.md`
- `docs/AUTO_INGEST_SETUP.md`
- `docs/OD_WORKSPACE_GUIDE.md`
- `docs/RESIDENTIAL_GROWTH_AUTOMATION.md`
- `docs/DWELL_CASCADE_FEATURE.md`
- `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md`
- `docs/NEW_SCHEDULE_STEP2_CONTRACT_DESIGN.md`
- `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md`
- `docs/route-planner-2/README.md` and its numbered docs for current Route Planner 2 work
- `docs/route-planner-legacy/README.md` only when historical old Route Planner background is explicitly needed
- `docs/SHUTTLE_PLANNER_PRD.md`
- `docs/SHUTTLE_PLANNER_UI_SPEC.md`
- `docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md`
- `docs/NETWORK_CONNECTIONS_UI_SPEC.md`
- `docs/route-colors.md`

Do not load `docs/plans/`, `docs/archive/`, `docs/artifacts/`, or `docs/route-planner-legacy/` by default.

### Route Planner 2 note

For current Route Planner 2 work, use `docs/route-planner-2/README.md` first, then its numbered docs. The old Route Planner docs have been moved under `docs/route-planner-legacy/` and are background only, not binding guidance.

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
- `docs/RESIDENTIAL_GROWTH_AUTOMATION.md`
- `docs/DWELL_CASCADE_FEATURE.md`
- `docs/route-planner-2/README.md` and its numbered docs for current Route Planner 2 work
- `docs/SHUTTLE_PLANNER_PRD.md`
- `docs/SHUTTLE_PLANNER_UI_SPEC.md`
- `docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md`
- `docs/NETWORK_CONNECTIONS_UI_SPEC.md`
- `docs/route-colors.md`

These are useful, but narrower in scope and more likely to drift.

### Tier 3: Archive and working notes

- `docs/plans/`
- `docs/archive/`
- `docs/artifacts/`
- `docs/route-planner-legacy/`

These files are implementation history, working plans, design notes, or supporting artifacts. They may include:

- agent-specific instructions
- commit commands
- manual test checklists
- package install steps
- superseded implementation details
- exported PDFs, DOCX files, screenshots, or sample inputs

They are not reliable default context.

---

## Update Rules

- If a change alters behavior or constraints, update Tier 1 docs.
- If a change alters storage, collections, or type locations, update `docs/SCHEMA.md`.
- If a change alters component ownership or major data flow, update `docs/ARCHITECTURE.md`.
- If a feature ships or becomes durable enough to guide future work, copy the durable outcome into Tier 1 or Tier 2 docs instead of leaving it only in `docs/plans/`.
- Keep `docs/plans/` as history, not as the main source of truth.

---

## Compatibility Note

`AGENTS.md` is the repo's top-level agent contract. Treat `docs/rules/LOCKED_LOGIC.md` as the durable behavior summary, `.claude/CLAUDE.md` as the Claude-specific workflow supplement, and `.claude/context.md` as the detailed historical companion during the transition.
