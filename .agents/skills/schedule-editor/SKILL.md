---
name: schedule-editor
description: Use when editing ScheduleEditor.tsx or related table/grid components. This is the largest and most complex component with intricate rendering logic.
---

## Schedule Editor Component

`ScheduleEditor.tsx` is the most complex component in the project. Handle with care.

### Round Trip View Structure

```
| Block | [North Stops: Arr | R | Dep] | [South Stops: Arr | R | Dep] | Metrics |
```

**One row = one round trip (N+S pair)**, NOT all trips for a block.

### Column Groups

| Group | Color | Contents |
|-------|-------|----------|
| North | Blue (`bg-blue-*`) | Arr, R, Dep for each North stop |
| South | Indigo (`bg-indigo-*`) | Arr, R, Dep for each South stop |
| Metrics | Gray | Travel, Band, Recovery, Ratio, Headway, Cycle |

### Column Types

- **Arr**: Arrival time (before recovery dwell)
- **R**: Recovery minutes at that stop (always shown, even if 0)
- **Dep**: Departure time (after recovery)

### Key Patterns

1. **Trip Pairing**: N1+S1, N2+S2 pairs per row (NOT all trips in one row)
2. **Unique Keys**: Use `${blockId}-${tripIndex}` pattern for React keys
3. **Editable Cells**: Click to edit; changes trigger recalculation of downstream times
4. **Band Badge**: Color-coded A-E based on travel time quintile

### Related Components

- `TravelTimeGrid.tsx`: Segment Times by Band table (shows p50 + p80 percentile times)
- `WorkspaceHeader.tsx`: Header with time bands inline (always visible), route info, actions
- `AddTripModal.tsx`: Modal for adding new trips
- `RouteSummary.tsx`: Stats card showing trip counts, blocks, span

### Common Pitfalls

- Duplicate key warnings: Ensure unique keys for each row
- Off-by-one in stop indexing
- Recovery time propagation on edits
