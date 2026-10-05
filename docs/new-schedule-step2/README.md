# New Schedule Step 2 Context Router

Use this page after `AGENTS.md`, `docs/CONTEXT_INDEX.md`, and, for any behavior change, `docs/rules/LOCKED_LOGIC.md`. It routes agents to the smallest authoritative Step 2 document set; it does not restate or replace those contracts.

## Task routing

| Task | Load next |
|------|-----------|
| Product outcome, implemented rebuild scope, workflow, readiness rules, migration history, or acceptance criteria | `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md` |
| Current schema-v2 object model, fingerprints, approval/invalidation, persistence, Step 3/4 boundary, or component ownership | `docs/NEW_SCHEDULE_STEP2_CONTRACT_DESIGN.md` |
| Canonical planning stop order, complete-trip pattern selection, stop matching, confidence, or fallback behavior | `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md` |
| Current code ownership or wizard data flow | `docs/ARCHITECTURE.md`, then verify the relevant code and tests |
| Runtime calculation, parsing, banding, schedule generation, or other locked behavior | `docs/rules/LOCKED_LOGIC.md`, the applicable document above, and the relevant danger-zone skill |
| Current delivery status | Start with the implementation snapshots in the three Step 2 documents, then verify current code and focused tests |

## Combined changes

Load more than one Step 2 contract only when the change crosses their boundaries. For example, changing how a resolved stop chain is stored in the approved runtime contract requires the stop-order resolution and contract-design documents. A UI-only change generally does not require the stop-order algorithm document.

## Authority note

The Step 2 runtime review and approved runtime contract are implemented at schema version 2. The documents retain their March 2026 proposal and rationale sections as design history, clearly labelled as such. Current implementation facts still come from code and tests, and locked schedule behavior remains authoritative over every design document.
