# Project Context & Locked Logic

> [!IMPORTANT]
> This file contains critical domain knowledge and implementation rules.
> **DO NOT modify locked logic without explicit user approval.**

---

## Project Overview

**Scheduler 4** - Transit scheduling application for bus route optimization

**Tech Stack:**
- React + TypeScript
- Vite build system
- TailwindCSS
- Claude API for AI optimization

**Purpose:** Generate optimal bus schedules from runtime data (CSV), accounting for:
- Recovery time between trips
- Travel time variations by time of day
- Trip pairing (Northbound/Southbound)
- Cycle time calculations

---

## Locked Logic (DO NOT MODIFY)

### 1. Double Pass Optimization (`api/optimize.ts`)
**Pattern:** Generator → Critic

```typescript
// LOCKED: Two-phase AI optimization
Phase 1 (Generator): Create initial schedule
Phase 2 (Critic): Review and suggest improvements
```

**Why locked:** This pattern prevents AI from over-optimizing in a single pass and provides better results through iterative refinement.

**Before modifying:** Ask user for approval

---

### 2. Segment Rounding (`scheduleGenerator.ts`)
**Rule:** Round BEFORE summing, not after

```typescript
// CORRECT (LOCKED):
const segment1 = Math.round(runtime1)
const segment2 = Math.round(runtime2)
const total = segment1 + segment2

// WRONG:
const total = Math.round(runtime1 + runtime2)
```

**Why locked:** Individual segment precision prevents cumulative timing errors in long routes.

---

### 3. Trip Pairing (`ScheduleEditor.tsx`)
**Rule:** N1+S1, N2+S2 pairs per row

```
Row 1: Trip N1 | Trip S1
Row 2: Trip N2 | Trip S2
Row 3: Trip N3 | Trip S3
```

**NOT:**
```
Row 1: Trip N1 | Trip N2
Row 2: Trip S1 | Trip S2
```

**Why locked:** Operators need to see paired round trips (N→S or S→N) for vehicle assignment.

---

### 4. Cycle Time Calculation
**Formula:** `Last Trip End Time - First Trip Start Time`

```typescript
// LOCKED:
cycleTime = schedule[schedule.length - 1].end - schedule[0].start
```

**NOT:**
- Sum of all trip durations
- Sum of runtime + recovery
- Any other calculation

**Why locked:** Cycle time represents the total vehicle operating period, not sum of individual trips.

---

## Key Architectural Patterns

### CSV Parsing (`csvParser.ts`)
- Handles variable CSV formats (with/without headers)
- Auto-detects time formats (HH:mm:ss vs HH:mm)
- Validates and cleans data before processing

### Runtime Analysis (`runtimeAnalysis.ts`)
- Calculates time-of-day travel time bands
- Identifies peak/off-peak patterns
- Used for recovery time adjustments

### Schedule Generation (`scheduleGenerator.ts`)
- Creates trips from runtime data
- Applies recovery times
- Handles trip direction pairing
- Outputs schedule in display format

---

## Domain Terminology

| Term | Meaning |
|------|---------|
| **Runtime** | Actual driving time from start to end of route |
| **Recovery Time** | Buffer time between trips for operator breaks |
| **Cycle Time** | Total time vehicle is in service (first start → last end) |
| **Trip Pair** | Northbound + Southbound trip (or vice versa) |
| **Segment** | Individual portion of a route with distinct timing |
| **Time Band** | Period of day with characteristic travel times |

---

## Common Gotchas

### ❌ Don't
- Modify cycle time calculation
- Change rounding logic
- Reorder trip pairing
- Skip segment-level rounding
- Assume CSV headers exist

### ✅ Do
- Validate CSV format before parsing
- Apply recovery times after runtime calculation
- Round each segment individually
- Preserve trip pairing in display
- Ask before changing locked logic

---

## File Dependency Map

```
App.tsx
  └─> NewSchedule (wizard)
       ├─> Step 1: CSV upload
       ├─> Step 2: Runtime analysis
       ├─> Step 3: Recovery settings
       ├─> Step 4: Schedule generation
       │    └─> utils/scheduleGenerator.ts
       │         ├─> csvParser.ts
       │         └─> utils/runtimeAnalysis.ts
       └─> Step 5: Connections (interline)
            └─> utils/connectionOptimizer.ts
                 ├─> utils/connectionConfigService.ts
                 └─> utils/connectionLibraryService.ts

ScheduleEditor.tsx
  └─> Displays paired trips
  └─> Allows manual adjustments
  └─> Sends to API for optimization

api/optimize.ts
  └─> Double-pass AI optimization
  └─> Returns improved schedule
```

---

## Testing Scenarios

### Essential Test Cases
1. **Empty CSV** - Should show error
2. **CSV without headers** - Should auto-detect
3. **Single trip** - Should handle edge case
4. **Odd number of trips** - Last trip unpaired OK
5. **Zero recovery time** - Should allow
6. **Very long cycle** - Should calculate correctly

---

## Performance Considerations

- **CSV parsing**: Handled synchronously (files < 10MB)
- **Schedule generation**: < 100ms for typical routes
- **AI optimization**: 2-5 seconds (uses Claude API)
- **UI updates**: React state updates, not real-time

---

## Future Enhancements (Not Yet Implemented)

- [ ] Database storage (currently CSV only)
- [ ] Multi-route scheduling
- [ ] Driver assignment logic
- [ ] Real-time vehicle tracking integration
- [ ] Historical runtime analysis
- [ ] Automated schedule versioning

---

## Questions Before Implementing Features

Before adding new features, clarify:

1. **Does this affect locked logic?** → Ask for approval
2. **Which files will change?** → Impact assessment
3. **Are there edge cases?** → Think through scenarios
4. **Does this change existing behavior?** → Flag breaking changes

---

## Contact & Feedback

When uncertain about:
- Locked logic modification → ASK USER FIRST
- Architectural changes → PROPOSE, DON'T IMPLEMENT
- Domain logic interpretation → CLARIFY BEFORE CODING

Remember: **This is a scheduling application with mathematical precision requirements.
Small logic changes can have cascading timing errors.**
