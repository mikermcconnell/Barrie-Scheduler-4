# AGENTS.md instructions for Scheduler 4

Primary agent entrypoint for this repository.

Use this file to understand the repo's agent contract before loading deeper project context.

## Read Next

1. `docs/CONTEXT_INDEX.md`
   Canonical context load order and document tiers.
2. `docs/rules/LOCKED_LOGIC.md`
   Durable behavioral constraints for schedule logic.
3. `docs/PRODUCT_VISION.md`
   Product scope, decision framework, and anti-patterns.
4. `docs/ARCHITECTURE.md`
   Current source layout and major data flow.
5. `docs/SCHEMA.md`
   Firestore, storage, and type-location reference.

Load `ORCHESTRATOR.md` when you are operating in orchestrator mode, delegating work to subagents, recovering from compacted context, or you need the repo's living summary of architecture, conventions, fragile areas, and current state. Treat it as durable working memory that supports Tier 1 docs, not as a replacement for them.

Load `.claude/CLAUDE.md` only as a tool-specific workflow supplement or when working in danger-zone files that need its verification guidance.
Load `.claude/context.md` only when the task touches locked schedule behavior or needs historical implementation notes.
Do not use `docs/plans/` or `docs/archive/` as default context.

## Repo Principles

- Keep durable decisions in Tier 1 docs, not in dated plan files.
- Treat planning notes as history unless a durable doc confirms the behavior.
- Respect locked logic before changing generation, parsing, timing, routing, or block assignment behavior.
- Keep the planner in control. AI may suggest or analyze, but should not silently override operational rules.

## Orchestrator Mode

In this repo, default to orchestrator mode for non-trivial repository work unless the user explicitly asks for direct implementation or higher-priority instructions require otherwise.

In orchestrator mode:

- Understand the codebase enough to work safely before changing it. If repo understanding is incomplete, first inspect the structure, entry points, module boundaries, conventions, dependencies, test patterns, and fragile or non-obvious areas.
- During that initial mapping pass, do not make changes unless the user asked for them.
- Treat this thread as working memory, but do not rely on thread memory alone for important repo knowledge.
- Prefer delegating implementation work to subagents when delegation is available, appropriate, and permitted.
- Give each subagent a clear prompt with the goal, owned files, forbidden files, conventions to follow, and verification steps.
- If the user gives multiple independent implementation tasks, delegate them in parallel when practical.
- Review subagent output before reporting back. Incorporate what you learn into your understanding of the repo.
- Preserve durable memory in repo files. Update `ORCHESTRATOR.md` when architecture, conventions, fragile areas, or other lasting repo understanding changes in a way future work should know.
- Keep `AGENTS.md` as the top-level agent contract, Tier 1 docs as the durable source of truth for behavior and architecture, and `ORCHESTRATOR.md` as the living memory that helps future orchestrator work recover context quickly.

## Skills

A skill is a set of local instructions stored in a `SKILL.md` file. The skills below are intended to be visible and portable with this repository.

### Available skills

- feature-delivery-loop: Plan and deliver product features in an existing codebase with a disciplined delivery loop: audit the current state, compare docs to code, choose the next highest-value milestone, implement it, verify it, and continue iteratively. Use for both new and partially implemented features when the user asks to build a feature, add a module, wire a prototype, continue a feature, proceed, keep going, implement the next step, move a feature from prototype to usable functionality, or asks "where are we at" on feature work. (file: C:/Users/Mike McConnell/.codex/skills/feature-delivery-loop/SKILL.md)
- docs-content-audit: Audit repository Markdown and agent-facing documentation for best-practice context hygiene, load order, portability, drift, contradictions, and durable-vs-archive separation. Use when reviewing README, AGENTS.md, context index files, product vision, architecture docs, schema docs, plan folders, or any request to assess whether docs are current, agent-friendly, or at best-practice level, and when cleaning up those docs afterward. (file: C:/Users/Mike McConnell/.codex/skills/docs-content-audit/SKILL.md)

### How to use skills

- Discovery: The list above is the skills available in this repository. Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill, or the task clearly matches a skill description shown above, use that skill for that turn.
- Missing or blocked: If a named skill is not listed or its `SKILL.md` cannot be read, say so briefly and continue with the best fallback.
- Progressive disclosure: After deciding to use a skill, open its `SKILL.md` and read only enough to follow the workflow.
- Context hygiene: Keep context small. Only load extra files directly needed for the request.
- Safety and fallback: If a skill cannot be applied cleanly, state the issue, pick the next-best approach, and continue.
