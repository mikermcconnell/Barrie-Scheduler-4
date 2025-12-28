---
name: schedule-domain
description: Use when discussing transit scheduling concepts like trips, blocks, cycles, recovery times, headways, or route structures. Ensures correct domain terminology.
---

## Transit Scheduling Domain Knowledge

When working on this Bus Scheduler project, understand these core concepts:

### Core Data Structures

**MasterTrip**: A single trip on a route
- `blockId`: Block assignment (e.g., "400-1")
- `direction`: 'North' | 'South'
- `startTime` / `endTime`: Minutes from midnight
- `travelTime`: Pure driving time (rounded)
- `recoveryTime`: Layover at terminus
- `stops`: Departure times at each stop

**RoundTripRow**: One round trip (N+S pair) in the schedule view
- Contains exactly 2 trips: one North, one South
- `totalCycleTime`: Last endTime - First startTime
- **1 round trip = 1 N + 1 S** (used for trips/hr calculations)

**Block**: A vehicle assignment running multiple trips
- Format: `{routeNumber}-{blockNumber}` (e.g., "400-1")
- Trips within a block are linked by time proximity (≤1 min gap)

### Key Calculations

1. **Cycle Time** = Last Timepoint End - First Timepoint Start
2. **Travel Time** = Sum of segment times (round BEFORE summing)
3. **Recovery Time** = Cycle Time - Travel Time
4. **Headway** = Gap between consecutive trip starts

### Terminology

| Term | Meaning |
|------|---------|
| Timepoint | Scheduled stop where time is tracked |
| Segment | Travel between two consecutive timepoints |
| Band | Time-of-day grouping (A=slowest → E=fastest) |
| Interline | Trip that connects to a different route |
| Deadhead | Non-revenue vehicle movement |
