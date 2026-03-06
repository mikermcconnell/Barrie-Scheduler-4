# Plans Directory

`docs/plans/` is archive and working-note space, not default repository context.

These files are useful when you need the history of a specific feature or want to inspect the original implementation approach. They are not the primary source of truth for current behavior.

## What lives here

- dated implementation plans
- feature design notes
- superseded execution details
- checklists captured during delivery

Many files here include agent-specific instructions, commit commands, or manual test steps. That makes them valuable history, but noisy default context.

## How to use this folder

- Start with `docs/CONTEXT_INDEX.md` instead.
- Open a plan file only when the task names that feature or date.
- After shipping work, update durable docs such as `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/PRODUCT_VISION.md`, or `docs/rules/LOCKED_LOGIC.md`.

## Going forward

For new work:

- keep design docs concise
- avoid treating plan files as the only place where decisions live
- distill lasting decisions back into the durable docs
