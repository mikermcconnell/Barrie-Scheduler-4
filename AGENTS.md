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

Load `.claude/CLAUDE.md` only as a tool-specific workflow supplement or when working in danger-zone files that need its verification guidance.
Load `.claude/context.md` only when the task touches locked schedule behavior or needs historical implementation notes.
Do not use `docs/plans/` or `docs/archive/` as default context.

## Repo Principles

- Keep durable decisions in Tier 1 docs, not in dated plan files.
- Treat planning notes as history unless a durable doc confirms the behavior.
- Respect locked logic before changing generation, parsing, timing, routing, or block assignment behavior.
- Keep the planner in control. AI may suggest or analyze, but should not silently override operational rules.

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
