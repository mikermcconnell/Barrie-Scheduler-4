---
name: interline-schedule
description: Auto-activates when working on Route 8A/8B interlining, Allandale Terminal logic, Georgian College turnaround linking, interline rules, or interline time windows. Use for interline questions, turnaround linking, rule configuration, and ensuring correct interline behavior.
---

# Interline Schedule Skill

This skill auto-activates when working with Route 8A/8B interlining at Barrie Allandale Transit Terminal, or Georgian College turnaround linking.

## Trigger Conditions

Activate when discussion involves:
- Route 8A or 8B interlining
- Barrie Allandale Transit Terminal scheduling
- Interline rules or configuration
- Interline time windows (8pm rule, Sunday all-day)
- `InterlineRule`, `InterlineConfig`, `interlineNext`, `interlinePrev`
- Files: `ScheduleEditor.tsx`, `RoundTripTableView.tsx`, `masterScheduleParser.ts` interline sections
- **Georgian College turnaround linking**
- Partial trips ending/starting at a terminal
- Linking North/South trips by block ID
- `mergeGeorgianTurnaroundTripsAcrossTables`, `isPartialTripEndingAtGeorgian`

---

## Part 1: Operational Rules

### CRITICAL: 8A and 8B Are Separate Loop Routes

**Routes 8A and 8B are completely independent loop routes.** They are NOT directional variants of the same route (i.e., "8A goes out, 8B comes back" is WRONG).

| Route | Description |
|-------|-------------|
| **8A** | Its own complete loop route with North and South directions |
| **8B** | Its own complete loop route with North and South directions |

Each route:
- Has its own distinct path through the city
- Has both Northbound and Southbound legs
- Operates as a full loop returning to its origin

The "interline" simply means these two separate routes **share a vehicle** during certain hours at Allandale Terminal to improve efficiency. The bus physically switches from serving one route to serving the other.

---

### What is the 8A/8B Interline?

Routes 8A and 8B share vehicles during certain time periods at Barrie Allandale Transit Terminal. A single bus alternates between routes:

```
8A arrives at Allandale → 5 min layover → Departs as 8B
8B arrives at Allandale → 5 min layover → Departs as 8A
... cycle continues
```

**IMPORTANT: Northbound Only**

The interline logic **only applies to NORTHBOUND legs** of Routes 8A and 8B at Allandale Terminal. The southbound trips do not participate in the interline pattern - they operate independently.

### When Does Interlining Occur?

| Day Type | Interline Hours | Notes |
|----------|-----------------|-------|
| **Weekday** | 8:00 PM - 1:35 AM | After evening rush |
| **Saturday** | 8:00 PM - 1:35 AM | Same as weekday |
| **Sunday** | All Day (0:00 - 1:35 AM) | Reduced service |

**Key Times in Minutes:**
- 8:00 PM = 1200 minutes from midnight
- 1:35 AM = 1535 minutes (next day)
- Sunday starts at 0 minutes

### Why Interline?

- **Efficiency**: One bus serves both routes instead of two sitting idle
- **Lower demand**: Evening/Sunday ridership doesn't justify separate vehicles
- **Cost savings**: Reduces vehicle hours and driver shifts

---

## Part 2: Hardcoded Rule Locations

### Interline Constants in RoundTripTableView.tsx

**File:** `components/schedule/RoundTripTableView.tsx:113-116`

```typescript
const INTERLINE_ROUTES = ['8A', '8B'];
const INTERLINE_STOP_PATTERN = 'allandale';
const INTERLINE_START_TIME = 1200; // 8:00 PM in minutes
const INTERLINE_END_TIME = 120;    // 2:00 AM in minutes (next day, wrapped)
```

### Time Window Check

**File:** `components/schedule/RoundTripTableView.tsx:127-136`

```typescript
const isInInterlineWindow = (tripTime: number, routeName: string): boolean => {
    const isSunday = routeName.toLowerCase().includes('sunday');
    if (isSunday) return true; // All Sunday trips can have interlining

    // Weekdays/Saturdays: 8 PM to 2 AM
    // - >= 1200: 8 PM to midnight (or extended format post-midnight)
    // - < 120: midnight to 2 AM (wrapped format)
    return tripTime >= INTERLINE_START_TIME || tripTime < INTERLINE_END_TIME;
};
```

### Interline Linking Logic

**File:** `components/schedule/RoundTripTableView.tsx:743-925`

The `linkInterlineTripsAtAllandale()` function handles interline display at Allandale Terminal:

1. **Identifies** trips during interline hours:
   - Trips that END at Allandale (have data before, no data after) - "arriving trips"
   - Trips that START at Allandale (no data before, have data after) - "departure-only trips"
2. **Pairs by time sequence**: For each arriving trip, finds the NEXT departure-only trip
3. **Merges stop data**: Copies stops from the departure-only trip (Downtown Hub, Blake at Johnson, Georgian College) into the arriving trip
4. **Stores metadata**: `_interlineDepartureTime` for DEP column display at Allandale

**Key insight**: GTFS data has separate trips for each physical bus journey. During interline hours:
- Trip A: Start → Allandale (bus becomes 8B)
- Trip B: Allandale → Georgian College (was 8B, now 8A)

The function **merges Trip B's stops into Trip A** so the display shows the complete 8A service pattern.

Called in the `roundTripData` useMemo before Georgian College turnaround linking.

---

## Part 3: Data Model

### InterlineRule Type

```typescript
interface InterlineRule {
    id: string;
    fromRoute: string;           // '8A' or '8B'
    fromDirection: 'North' | 'South';
    toRoute: string;             // '8B' or '8A'
    toDirection: 'North' | 'South';
    atStop: string;              // 'Barrie Allandale Transit Terminal - Platform X'
    timeRange: {
        start: number;           // Minutes from midnight (1200 = 8pm)
        end: number;             // Minutes from midnight (1535 = 1:35am)
    };
    days: ('Weekday' | 'Saturday' | 'Sunday')[];
    enabled: boolean;
}
```

### MasterTrip Interline Fields

```typescript
interface MasterTrip {
    // Set by linkInterlineTripsAtAllandale()
    _interlinePartial?: boolean;              // True if processed by interline linking
    _interlineDepartureTime?: number | null;  // DEP time at Allandale (e.g., 1242 = 8:42 PM)
    _interlineStop?: string;                  // The interline stop name (e.g., "allandale")
    _mergedFromDepartureTrip?: string;        // ID of the departure-only trip whose stops were merged

    // After merging, the trip's stops/arrivalTimes/recoveryTimes contain:
    // - Original data from Start → Allandale
    // - Merged data from Allandale → Georgian College (from the departure-only trip)

    // Legacy fields (may still exist in some code paths)
    interlineNext?: {
        route: string;      // Route it becomes ("8B")
        time: number;       // Time at terminal (minutes)
        stopName?: string;  // Terminal stop name
    };
    interlinePrev?: {
        route: string;      // Route it came from ("8A")
        time: number;
        stopName?: string;
    };
}
```

---

## Part 4: Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `linkInterlineTripsAtAllandale` | `RoundTripTableView.tsx:743` | **Links trips at Allandale by time sequence, stores `_interlineDepartureTime`** |
| `isInInterlineWindow` | `RoundTripTableView.tsx:145` | Checks if trip time is in interline hours |
| `isInterlineRoute` | `RoundTripTableView.tsx:166` | Checks if route participates in interlining (8A/8B) |
| `isInterlineStop` | `RoundTripTableView.tsx:159` | Checks if stop is Allandale Terminal |
| `getInterlineDepartureTime` | `RoundTripTableView.tsx:185` | (Legacy) Finds next same-route departure |
| `mergeGeorgianTurnaroundTripsAcrossTables` | `RoundTripTableView.tsx:512` | Links partial trips at Georgian College |

---

## Part 5: ARR | R | DEP Display Pattern

At Allandale Terminal, the schedule shows three sub-columns:

| Column | Meaning | Example |
|--------|---------|---------|
| **ARR** | When this trip arrives | 8:07 PM |
| **R** | Recovery/layover minutes | 5 |
| **DEP** | When SAME ROUTE next departs | 8:42 PM |

**Critical Insight:** DEP is NOT `ARR + R` during interline hours!

```
8A arrives at 8:07 PM (ARR)
5 min layover (R)
Bus departs as 8B at 8:12 PM (NOT shown in 8A schedule)
8B does its loop...
8A next departs at 8:42 PM (DEP)

The 35-minute gap (8:07 -> 8:42) signals an interline occurred
```

---

## Part 5A: Service Pattern View (Single Row)

During interline hours, 8A displays as a **service pattern view** - showing 8A service at each stop, paired by time sequence. This is for route planning and costing, not vehicle/driver tracking.

### Row Structure

Each row shows a complete 8A service cycle:

| Segment | Start | At Allandale | End |
|---------|-------|--------------|-----|
| Full service | South GO DEP | ARR :07 \| R 5 \| DEP :42 | Georgian College |

**Key Insight:** The :07 arrival and :42 departure are from **different physical buses**, but we display them as one 8A service row. The 35-min gap implicitly shows the interline occurred.

### How Pairing Works

```
Trip 1: South GO → arrives Allandale 8:07 → (bus becomes 8B) → departs 8:12
Trip 2: South GO → arrives Allandale 8:37 → (bus becomes 8B) → departs 8:42 as 8A

Display Row for 8:07 arrival:
- ARR: 8:07 (from Trip 1)
- R: 5 (Trip 1's recovery)
- DEP: 8:42 (from Trip 2's departure - NEXT trip, not same trip!)
```

The `linkInterlineTripsAtAllandale()` function pairs Trip 1's arrival with Trip 2's departure by:
1. Building list of all departures from interline trips
2. For each arrival, finding the NEXT departure that isn't from the same trip

### GTFS Reference Times (from Barrie Allandale Transit Terminal Platform 5)

| Time Pattern | Meaning | Example Times |
|--------------|---------|---------------|
| **:07** | 8A North arrivals at Allandale | 20:07, 21:07, 22:07 (weekday/Sat) |
| **:42** | 8A North departures from Allandale | 20:42, 21:42, 22:42 (weekday/Sat) |

**Sunday (all day):** :07 arrivals and :42 departures from 08:42 through 22:07.

### Display Checklist

- [ ] Single row shows: South GO → Allandale (ARR :07, R 5, DEP :42) → Georgian College
- [ ] DEP shows the NEXT 8A departure (from different trip), not ARR + R
- [ ] The 35-min gap (:07 → :42) is visible, indicating interline occurred
- [ ] Sunday shows this pattern all day; weekdays/Saturdays only after 8pm

---

## Part 6: Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| **Sunday 8B missing stops (e.g., South GO)** | GTFS has partial trips (A→B and B→C); old code picked trip with most stops which might not start at the beginning | Fixed 2026-01-23: Added `mergeStopListsFromTrips()` in gtfsImportService.ts that merges stops from ALL trips using graph traversal |
| DEP shows "-" at Allandale | No departures found to pair with | Check `linkInterlineTripsAtAllandale` is finding departure-only trips |
| DEP shows ARR+R instead of :42 | `_interlineDepartureTime` not being used in display | Check DEP column logic - `interlineDepTime` must be checked before returning null |
| Stops after Allandale empty | Stop data not merged from departure trip | Check `_mergedFromDepartureTrip` is set; verify departure trip has stop data |
| Trips not in interline window | Wrong time check | Verify `isInInterlineWindow` returns true for the trip time |
| Last interline trip has no DEP | No "next" trip to pair with | Expected - last trip of the day won't have a following departure |
| **Cycle time inflated (172 vs 150 min)** | Georgian College recovery double-counted in N+S | **WIP**: Line 1539-1548 uses `totalTravel + allandaleRecovery + barrieSouthRecovery` to avoid double-counting |

### Cycle Time Calculation (WIP)

**File:** `components/schedule/RoundTripTableView.tsx:1539-1548`

For 8A interline trips, the cycle time requires special handling:

**User's Example Trip (expected 150 min):**
- Segment 1: Barrie South GO → Allandale = 49 min travel
- Allandale recovery: 5 min
- Segment 2: Allandale → Georgian College → Barrie South GO = 96 min travel
- **Total: 150 min**

**Problem:** Standard calculation (`totalTravel + totalRec`) showed 172 min (22 min too high)

**Root Cause:** Georgian College recovery appears in BOTH:
- North trip's `recoveryTime` (from merge)
- South trip's `recoveryTime` (original data)

**Current Fix Attempt:**
```typescript
if (isRoute8A(combined.routeName) && tripWithInterline?._interlinePartial) {
    const interlineStopName = tripWithInterline._interlineStop;
    const allandaleRecovery = (interlineStopName && northTrip?.recoveryTimes?.[interlineStopName]) || 5;
    const lastSouthStop = combined.southStops[combined.southStops.length - 1];
    const barrieSouthRecovery = (lastSouthStop && southTrip?.recoveryTimes?.[lastSouthStop]) || 0;
    displayCycleTime = totalTravel + allandaleRecovery + barrieSouthRecovery;
}
```

**Status:** Still showing incorrect value - needs further investigation into what `totalTravel` contains after the interline merge.

### Debug Logging

Enable console logs by loading schedules and checking DevTools:

```
[InterlineLink] Route: 8A (Weekday) North
[InterlineLink] Interline trips: 5
[InterlineLink] Departures: ["8:12 PM", "8:42 PM", "9:12 PM", "9:42 PM", "10:12 PM"]
[InterlineLink] Departure-only trip 8A-dep-1 DEP 8:52 PM
[InterlineLink] Trip 8A-1 ARR 8:07 PM → DEP 8:42 PM (skipped own departure at 8:12 PM) MERGING stops from 8A-dep-1
```

**Key log entries:**
- `Departure-only trip` - Trips that START at Allandale (have data after, not before)
- `MERGING stops from` - Indicates stop data is being copied from the departure trip

---

## Part 7: Checklist When Modifying Interline Logic

Before making changes:

- [ ] Understand the time window rules (8pm weekday/Sat, all-day Sunday)
- [ ] Check these locations for hardcoded times:
  - `RoundTripTableView.tsx:131-134` (constants: INTERLINE_START_TIME, INTERLINE_END_TIME)
  - `RoundTripTableView.tsx:145-153` (isInInterlineWindow function)
  - `RoundTripTableView.tsx:743-900` (linkInterlineTripsAtAllandale function)
- [ ] Test with trips before 8pm (should NOT be processed on weekdays)
- [ ] Test with trips after 8pm (should be linked on weekdays)
- [ ] Test Sunday schedules (should be linked all day)

After making changes:

- [ ] Verify ARR | R | DEP display at Allandale Terminal
- [ ] DEP shows time from NEXT trip, not ARR + R
- [ ] Trips that START at Allandale don't appear as separate rows
- [ ] The 35-min gap (:07 → :42) is visible in the display

---

## Part 8: Quick Reference

### Time Conversions

| Time | Minutes |
|------|---------|
| 8:00 PM | 1200 |
| 8:07 PM | 1207 |
| 8:12 PM | 1212 |
| 8:37 PM | 1237 |
| 8:42 PM | 1242 |
| 12:00 AM | 1440 |
| 1:35 AM | 1535 |

### Key Constants

```typescript
INTERLINE_ROUTES = ['8A', '8B']           // (RoundTripTableView.tsx:131)
INTERLINE_STOP_PATTERN = 'allandale'      // (RoundTripTableView.tsx:132)
INTERLINE_START_TIME = 1200               // 8:00 PM (RoundTripTableView.tsx:133)
INTERLINE_END_TIME = 120                  // 2:00 AM wrapped (RoundTripTableView.tsx:134)
```

### Stop Name Matching

The terminal stop name varies. Code handles:
- `"Barrie Allandale Transit Terminal"`
- `"Barrie Allandale Transit Terminal - Platform 1"`
- `"Allandale Terminal"`
- Partial matches work via `includes('allandale')`

---

## Part 9: Georgian College Turnaround Linking

### What is the Georgian College Turnaround?

Routes 8A and 8B both have a turnaround point at Georgian College where:
- **Northbound trips END** at Georgian College
- **Southbound trips START** at Georgian College

During interline hours, these partial trips should be **linked by block ID** so they display as one combined row.

### When Does Turnaround Linking Occur?

Same time window as interlining:

| Day Type | Linking Hours | Notes |
|----------|---------------|-------|
| **Weekday** | 8:00 PM - 2:00 AM | After evening rush |
| **Saturday** | 8:00 PM - 2:00 AM | Same as weekday |
| **Sunday** | All Day | Reduced service |

### Key Constants

**File:** `components/schedule/RoundTripTableView.tsx:94-97`

```typescript
const INTERLINE_START_TIME = 1200; // 8:00 PM in minutes
const INTERLINE_END_TIME = 120;    // 2:00 AM in minutes (next day, wrapped)
const GEORGIAN_COLLEGE_PATTERN = 'georgian college';
```

### How Linking Works

1. **Detect partial trips** ending at Georgian (North) and starting at Georgian (South)
2. **Match by time**: arrival + recovery ≈ departure (within 2 min tolerance)
3. **Link by block ID**: Give South trip the same block ID as North trip
4. **Both trips stay in their arrays**: North in northTrips, South in southTrips
5. **Display in same row**: Because they share block ID

### Key Functions

**File:** `components/schedule/RoundTripTableView.tsx`

| Function | Line | Purpose |
|----------|------|---------|
| `isGeorgianCollegeStop` | ~192 | Check if stop name contains "georgian college" |
| `findGeorgianStop` | ~199 | Find Georgian College stop in stops array |
| `isPartialTripEndingAtGeorgian` | ~207 | Detect North trips that END at Georgian |
| `isPartialTripStartingAtGeorgian` | ~252 | Detect South trips that START at Georgian |
| `mergeGeorgianTurnaroundTripsAcrossTables` | ~387 | Link trips across North/South tables |

### Implementation Pattern

```typescript
// In mergeGeorgianTurnaroundTripsAcrossTables:

// 1. Find partial trips
const endingTrips = northTrips.filter(t => isPartialTripEndingAtGeorgian(t, northStops));
const startingTrips = southTrips.filter(t => isPartialTripStartingAtGeorgian(t, southStops));

// 2. Match by time (arrival + recovery = departure)
for (const endTrip of endingTrips) {
    const expectedDep = arrivalTime + recoveryTime;
    const match = startingTrips.find(t => Math.abs(t.departureTime - expectedDep) <= 2);

    if (match) {
        // 3. Link by giving South trip the North trip's block ID
        linkedSouthTrip.blockId = endTrip.blockId;
    }
}

// 4. Return both arrays (trips stay separate for proper N/S display)
return { mergedNorthTrips, mergedSouthTrips };
```

### Display Rules

**Recovery only shows when arrival exists:**

```typescript
// Get arrival time first
const northArrivalAtStop = getArrivalTimeForStop(northTrip, stop, ...);

// Recovery only displays if arrival exists
<span>{northArrivalAtStop ? (northTrip?.recoveryTimes?.[stop] ?? '') : ''}</span>
```

### Debug Logging

Console shows linking process:

```
[GeorgianLink] Processing route: 8A Weekday (North)
[GeorgianLink] North ENDING trip: 8A-N-30 block: 5 arr: 1208 (8:08 PM) rec: 2
[GeorgianLink] South STARTING trip: 8A-S-32 block: 3 dep: 1210 (8:10 PM)
[GeorgianLink] LINKED! 8A-N-30 (block: 5) with 8A-S-32 (block: 3)
[GeorgianLink] South trip 8A-S-32 now has block: 5
```

### Checklist: Adding Turnaround Linking to New Route

To replicate this pattern for another route (e.g., Route 2A/2B):

1. **Add stop pattern constant:**
   ```typescript
   const NEW_TURNAROUND_PATTERN = 'terminal name';
   ```

2. **Add detection functions:**
   - `isNewTurnaroundStop(stopName)` - check if stop matches pattern
   - `findNewTurnaroundStop(stops)` - find stop in array

3. **Add partial trip detection:**
   - `isPartialTripEndingAtNewStop(trip, stops)` - North trips ending here
   - `isPartialTripStartingAtNewStop(trip, stops)` - South trips starting here

4. **Add linking function or extend existing:**
   ```typescript
   // Either extend mergeGeorgianTurnaroundTripsAcrossTables
   // Or create new: mergeNewTurnaroundTripsAcrossTables
   ```

5. **Call in roundTripData memo** (around line 533):
   ```typescript
   const { mergedNorthTrips, mergedSouthTrips } = mergeNewTurnaroundTripsAcrossTables(
       group.north.trips, group.north.stops,
       group.south.trips, group.south.stops,
       group.north.routeName
   );
   ```

6. **Ensure recovery display check:**
   - Only show recovery when arrival time exists at that stop

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Trips not linking | Time mismatch > 2 min | Check arrival + recovery = departure |
| South trips missing | Merged into one object | Keep trips separate, link by block ID only |
| Recovery showing without arrival | Display not checking arrival | Add `northArrivalAtStop ? recovery : ''` check |
| Post-midnight trips not linking | Time window check fails | Include `tripTime < INTERLINE_END_TIME` for wrapped times |
