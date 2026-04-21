---
name: block-assignment
description: Use when working on blockAssignment.ts, block IDs, or trip linking. Block bugs have been a recurring issue.
---

## Block Assignment Logic

Block assignment has been a recurring bug area. Follow these rules carefully.

### Block ID Format

`{routeNumber}-{blockNumber}`

Examples: `400-1`, `400-2`, `12-1`

### Trip Linking Rules

Trips are linked into the same block when:

1. **Time Proximity**: Trip A's `endTime` matches Trip B's `startTime` within 1 minute
   - ⚠️ **CRITICAL**: For generated schedules, `endTime` already includes recovery time
   - Do NOT add recovery again when calculating expected start of next trip
   - Use `endTime` directly as the expected start time
2. **Direction Alternation**: For bidirectional routes, N→S→N→S pattern
3. **Same Block ID**: Both trips have matching blockId

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

### Recovery Time at Terminals

- Recovery goes at the END of each trip (terminus)
- When editing a trip, subsequent trips in the block shift

### Common Bugs

| Bug | Cause | Fix |
|-----|-------|-----|
| Trips not linking | Gap > 1 minute | Check time calculations |
| Wrong direction sequence | Initialization error | Verify first trip direction |
| Recovery not propagating | Block boundary issue | Check block membership |

### Test File

- `tests/blockAssignmentCore.test.ts` — gap-based matching, merged route chaining
