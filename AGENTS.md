# AGENTS.md instructions for Scheduler 4

Primary agent contract for this repository.

Read this file first. Then read `docs/CONTEXT_INDEX.md`, which routes tasks to the smallest relevant set of product, architecture, schema, feature, and historical context.

## Authority and context

- Higher-priority system, developer, and user instructions override this file.
- `AGENTS.md` owns repository-wide agent workflow and safety rules.
- `docs/CONTEXT_INDEX.md` owns context routing, document tiers, and source-of-truth precedence.
- `docs/rules/LOCKED_LOGIC.md` owns non-negotiable schedule behavior.
- `docs/PRODUCT_VISION.md` owns durable product intent and decision principles.
- `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` describe current implementation structure and data contracts.
- Feature docs govern only their named feature and cannot override locked logic or product boundaries.
- `ORCHESTRATOR.md` is compact recovery memory, not an independent source of truth.

When docs and implementation disagree, verify current code, tests, and persisted data as appropriate. Treat the mismatch as documentation drift to resolve; do not silently change locked behavior to match an implementation accident.

## Repository principles

- Load only the context required for the task. Do not scan `docs/` broadly when the context index names a narrower source.
- Keep durable decisions in the appropriate durable or feature document, not only in dated plans or handoffs.
- Treat `docs/plans/`, `docs/superpowers/plans/`, `docs/archive/`, `docs/artifacts/`, and legacy feature folders as history unless a current authoritative document explicitly incorporates the decision.
- Respect locked logic before changing generation, parsing, timing, routing, block assignment, or schedule-editor behavior.
- Keep the planner in control. AI may suggest or analyze, but must not silently override operational rules.
- Never use `--no-verify` to bypass failed checks. Fix the failure or investigate and report the blocker.
- Preserve unrelated user changes in a dirty working tree.

## Orchestrator mode

For non-trivial repository work, default to orchestrator mode unless the user explicitly requests direct implementation or higher-priority instructions require otherwise.

In orchestrator mode:

- Map the relevant entry points, module boundaries, conventions, tests, and fragile areas before changing code.
- During an initial mapping pass, do not make changes unless the user asked for them.
- Use `ORCHESTRATOR.md` when delegating, recovering from compacted context, or orienting across multiple workspaces.
- Delegate bounded work when delegation is available, appropriate, and permitted. Give each subagent a clear goal, owned files, forbidden files, conventions, and verification steps.
- Review delegated work before reporting completion.
- Update the authoritative product, architecture, schema, locked-logic, or feature document when durable behavior changes. Update `ORCHESTRATOR.md` only when a compact cross-cutting convention or fragile-area pointer would help future orchestration.

## Tool-specific supplements

- Load `.claude/CLAUDE.md` only for Claude-specific workflow guidance or its extra danger-zone verification table.
- Load `.claude/context.md` only for detailed historical implementation notes about locked schedule behavior.
- Neither `.claude` file overrides this contract or the durable docs.

## Repository skills

Repository-portable skills use paths relative to this checkout:

- `feature-delivery-loop` — audit, plan, implement, verify, and continue feature delivery. (file: ./.codex/skills/feature-delivery-loop/SKILL.md)
- `doc-review` — audit context documentation for staleness, contradictions, paths, and context hygiene. (file: ./.agents/skills/doc-review/SKILL.md)

Additional scoped and auto-activated skills live under `.agents/skills/`. Use a skill when the task matches its description, and read its complete `SKILL.md` before acting. If a named skill is unavailable, state that briefly and continue with the safest fallback.
