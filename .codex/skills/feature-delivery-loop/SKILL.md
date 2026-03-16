---
name: feature-delivery-loop
description: Plan and deliver product features in an existing codebase with a disciplined delivery loop: audit the current state, compare docs to code, choose the next highest-value milestone, implement it, verify it, and continue iteratively. Use for both new and partially implemented features when the user asks to build a feature, add a module, wire a prototype, continue a feature, proceed, keep going, implement the next step, move a feature from prototype to usable functionality, or asks "where are we at" on feature work.
---

# Feature Delivery Loop

Use this skill when a feature already exists in some form and the job is to carry it forward in controlled increments instead of starting from scratch.

## Workflow

1. Verify the current state before proposing the next step.
   Read the status note, PRD, UI spec, and the actual code that renders the feature.
   Confirm what is real, what is stubbed, and what the repo says versus what the code actually does.

2. State the current milestone in concrete terms.
   Describe the feature as it exists now, not as it was intended to exist.
   Call out the exact gap between current behavior and planner/user need.

3. Pick the next highest-value slice.
   Prefer the smallest milestone that materially increases usefulness.
   Sequence work in this order unless local context clearly argues otherwise:
   - persistence and loading
   - editable state instead of seeded/demo state
   - derived calculations and validation
   - real interaction workflows
   - external integrations or exports
   - polish and cleanup

4. Reuse existing repo patterns aggressively.
   Search for comparable services, map layers, auth plumbing, list/detail flows, and validation patterns before inventing new structures.
   Match the app's current architecture unless the existing pattern is clearly blocking progress.

5. Isolate domain logic from UI.
   Move calculations, normalization, validation, and transformation logic into utilities when the component starts mixing editing and business logic.
   Keep the UI responsible for state orchestration and interaction, not core planning math.

6. Preserve forward momentum.
   Do not stop at analysis if the user is asking to continue.
   Implement the chosen slice end to end: code, wiring, and verification.

7. Verify after each slice.
   Run targeted verification immediately after finishing a milestone.
   Prefer `npm run build` and `npx tsc --noEmit` for frontend feature work unless a narrower test is more appropriate.
   Separate new failures from unrelated pre-existing repo failures.

8. Reassess the feature honestly.
   After shipping a slice, answer the practical question:
   "What can the user/planner do now that they could not do before?"
   Then identify the next constraint still preventing the feature from being fully useful.

## Decision Rules

- Trust the repo over stale docs when they disagree, but note the mismatch.
- Treat seeded/demo UI as prototype surface, not completed functionality.
- Prefer one shippable milestone over a wide partial refactor.
- Add data model fields only when they unlock the next real capability.
- If a new capability introduces a structural need, fix the structure cleanly before piling on more behavior.

## Communication Pattern

- Start by saying what you are checking and why.
- While working, explain what context you are gathering and what the next milestone is.
- Before edits, state what you are about to change.
- After verification, say what passed and list unrelated failures separately.
- Close by describing the new capability level of the feature, not just the files changed.

## Typical Loop

For a feature handoff:
- read handoff/status note
- verify code matches handoff
- identify the most important missing capability
- implement it
- validate it
- summarize what level of usefulness the feature has reached

For "continue" requests:
- assume the user wants execution, not brainstorming
- do the next milestone immediately
- carry the work until verification is complete

For "does this satisfy the need?" requests:
- evaluate against the real workflow in the docs and the current code
- answer from the user's job-to-be-done, not from implementation effort
- say clearly whether it is prototype, early usable, review-ready, or production-ready

## Output Standard

Use plain, direct status language.
Be specific about:
- what is implemented
- what remains missing
- what verification passed
- what unrelated failures still exist in the repo

Do not present a feature as complete if key user actions still rely on placeholders, fake data, or manual workarounds.
