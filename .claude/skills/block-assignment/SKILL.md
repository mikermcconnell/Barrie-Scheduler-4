---
name: block-assignment
description: Use when working on utils/blocks/blockAssignment.ts, utils/blocks/blockAssignmentCore.ts, block IDs, or trip linking. Block bugs have been a recurring issue.
---

## Block Assignment Logic

Block assignment has been a recurring bug area. Follow these rules carefully.

### Block ID Format

`{routeNumber}-{blockNumber}`

Examples: `400-1`, `400-2`, `12-1`

### Trip Linking Rules

Two matching modes exist and must not be conflated:

1. **Generated/legacy section matching** (`utils/blocks/blockAssignment.ts`)
   - Expected-start matching uses a one-minute tolerance.
   - For generated schedules, `endTime` already includes recovery time. Do not add recovery again.
2. **Unified and merged-route matching** (`utils/blocks/blockAssignmentCore.ts`)
   - When `maxGap` is configured for merged A/B routes, compare the actual gap: `candidate.startTime - current.endTime`.
   - Accept non-negative gaps up to `maxGap`; do not derive expected start from recovery for this mode.
   - Otherwise, the core uses expected-start matching with the configured tolerance and `endTimeIncludesRecovery` semantics.
3. **Direction and location continuity**
   - Preserve the configured direction alternation and stop/terminal matching rules.

Never apply the legacy one-minute rule to merged-route actual-gap matching.

### Bidirectional Routes

For routes running both directions (most fixed routes):

```
Block 400-1: N1 → S1 → N2 → S2 → ...
Block 400-2: S1 → N1 → S2 → N2 → ...  (starts opposite direction)
```

### Key Functions

In `utils/blocks/blockAssignment.ts`:

- `assignBlocksToSection()`: Single-direction block assignment
- `assignBlocksBidirectional()`: Merged route block chaining
- `assignBlocksToRoute()`: Route-level orchestrator
- `debugBlockAssignment()`: Debug output helper

In `utils/blocks/blockAssignmentCore.ts`:

- `findNextTrip()`: Chooses actual-gap or expected-start matching from the config
- `buildBlocks()` / `buildBlocksBidirectional()`: Unified block construction
- `MatchConfigPresets`: Matching policy, including merged-route `maxGap`

### Recovery Time at Terminals

- Recovery goes at the END of each trip (terminus)
- When editing a trip, subsequent trips in the block shift

### Common Bugs

| Bug | Cause | Fix |
|-----|-------|-----|
| Generated/legacy trips not linking | Expected-start difference > 1 minute | Verify `endTime`/recovery semantics |
| Merged trips not linking | Actual gap is outside `maxGap` or terminal identity does not match | Check the matching preset, actual gap, and location data |
| Wrong direction sequence | Initialization error | Verify first trip direction |
| Recovery not propagating | Block boundary issue | Check block membership |

### Test File

- `tests/blockAssignmentCore.test.ts` — gap-based matching, merged route chaining
