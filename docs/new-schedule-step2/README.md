# New Schedule Step 2 Context Router

Use this page after `AGENTS.md`, `docs/CONTEXT_INDEX.md`, and, for any behavior change, `docs/rules/LOCKED_LOGIC.md`. It routes agents to the smallest authoritative Step 2 document set; it does not restate or replace those contracts.

## Task routing

| Task | Load next |
|------|-----------|
| Product outcome, rebuild scope, workflow, readiness rules, migration direction, or acceptance criteria | `docs/NEW_SCHEDULE_STEP2_REBUILD_SPEC.md` |
| Proposed object model, fingerprints, approval/invalidation, persistence, Step 3/4 boundary, or component ownership | `docs/NEW_SCHEDULE_STEP2_CONTRACT_DESIGN.md` |
| Canonical planning stop order, complete-trip pattern selection, stop matching, confidence, or fallback behavior | `docs/NEW_SCHEDULE_STOP_ORDER_RESOLUTION.md` |
| Current code ownership or wizard data flow | `docs/ARCHITECTURE.md`, then verify the relevant code and tests |
| Runtime calculation, parsing, banding, schedule generation, or other locked behavior | `docs/rules/LOCKED_LOGIC.md`, the applicable document above, and the relevant danger-zone skill |
| Current delivery status | Verify current code and tests; the three Step 2 documents describe proposed target contracts, not proof of implementation |

## Combined changes

Load more than one Step 2 contract only when the change crosses their boundaries. For example, changing how a resolved stop chain is stored in the approved runtime contract requires the stop-order resolution and contract-design documents. A UI-only change generally does not require the stop-order algorithm document.

## Authority note

The existing Step 2 documents are proposed target contracts. Current implementation facts come from code and tests. Locked schedule behavior remains authoritative over every proposal here.
