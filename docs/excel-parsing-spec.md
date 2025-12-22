# Excel Master Schedule Parsing Specification

This document describes the structure of the `August Master.xlsx` file and how the parser (`masterScheduleParserV2.ts`) extracts schedule data.

---

## File Structure Overview

| Element | Location | Description |
|---------|----------|-------------|
| **Sheet** | Each tab | One route per sheet (e.g., "400", "7", "101") |
| **Stop Name row** | Row with "Stop Name" in Col A or B | Contains stop names across columns |
| **Stop ID row** | Row with "Stop ID" in Col A or B | Contains stop IDs matching stop names |
| **Trip data** | Rows below Stop ID | Each row = one trip |
| **Day sections** | Sequential blocks | 1st = Weekday, 2nd = Saturday, 3rd = Sunday |

---

## Column Structure

```
Col A    Col B        Col C onwards...
─────────────────────────────────────────────────────────
         Stop Name    [Stop1]  [Stop1]  R   [Stop2]  [Stop2]  R   ...
         Stop ID      [ID1]    [ID1]        [ID2]    [ID2]        ...
[Day]    [TimeBand]   DEPART   ARRIVE   R   DEPART   ARRIVE   R   ...
W        Morning      7:05 AM  7:12 AM  1   7:13 AM  7:20 AM  0   ...
e        Morning      7:27 AM  7:34 AM  1   7:35 AM  7:42 AM  0   ...
...
```

### Column Meanings

| Column | Content |
|--------|---------|
| **A** | Day type letters (merged cell showing "Weekday"/"Saturday"/"Sunday" vertically) |
| **B** | Time band (Morning, Midday, Peak, Evening, Night) or "Stop Name"/"Stop ID" markers |
| **C+** | Alternating DEPART → ARRIVE times with R (recovery) columns between stops |

---

## Stop Pattern: ARRIVE → Recovery → DEPART

Each stop appears twice in the headers:
1. **First occurrence** = DEPART from this stop
2. **R column** = Recovery/layover time (minutes)
3. **Second occurrence** = ARRIVE at next stop

Example for a bus going Downtown → Johnson → RVH:
```
DEPART      ARRIVE         R    DEPART        ARRIVE
Downtown    Johnson at         Johnson at    RVH
            Napier             Napier
─────────────────────────────────────────────────────
7:05 AM     7:12 AM        1   7:13 AM       7:20 AM
```


---

## Recovery Time Parsing & Logic

The system includes robust logic for handling "Recovery" or "Layover" time, which is critical for linking trips and calculating accurate block schedules.

### 1. Representation
- **Column Header**: Identified by `"R"` in the header row.
- **Position**: "R" columns are positioned immediately *after* the stop they apply to.
- **Values**: treated strictly as **integer minutes** (e.g., `3`, `0`). 
  - *Note*: The parser explicitly bypasses standard Excel time-serial conversion for these columns to ensure single-digit integers are not misinterpreted as dates.

### 2. Handling Duplicates
- **Scenario**: A route may have multiple recovery points (e.g., one at terminus, one at a mid-point).
- **Naming**: The parser allows multiple "R" columns. They are deduped during parsing:
  - 1st occurrence: `R`
  - 2nd occurrence: `R (2)`
  - 3rd occurrence: `R (3)`
- **Mapping**: These unique keys are mapped back to the *preceding stop name* in the adapter layer, ensuring the recovery time is associated with the correct location.

### 3. Zero-Value Preservation
- Recovery times of `0` minutes are **valid and preserved**.
- They are displayed in the UI to maintain visual consistency with the printed schedule.
- Logic: `Arrival Time + 0 min = Departure Time`.

### 4. Logic & Calculation
The fundamental rule for schedule continuity is:
> **Arrival Time** (at Stop A) + **Recovery Time** (at Stop A) = **Departure Time** (from Stop A)

- **UI Interaction**: Editing an *Arrival Time* will automatically recalculate the subsequent *Departure Time* based on the defined recovery duration for that stop.
- **Block Assignment**: Total recovery time is aggregated per block to calculate true service hours versus paid hours.

## Day Type Detection

Day types are determined by **section order**, not by parsing merged cells:

| Section # | Day Type |
|-----------|----------|
| 1st | Weekday |
| 2nd | Saturday |
| 3rd | Sunday |

Each section is identified by finding a new "Stop Name" / "Stop ID" pair.

---

## Loop Route Pattern

For loop routes (e.g., 101 - Blue), trips run continuously:

```
Trip N ends at Downtown     → 7:50 AM
Trip N+1 starts at Downtown → 7:50 AM (same time, no gap)
```

The terminus time appears in both:
- **Last column of Trip N** (arrival)
- **First column of Trip N+1** (departure)

This duplication is intentional for user visibility.

---

## Route Types

### 1. Bidirectional Routes (e.g., 400)
- Has "North" and "South" labels in Row 1
- Both directions on same sheet
- Treated as one combined route

### 2. Linear with Sub-routes (e.g., 7A/7B)
- Multiple route variants on same sheet
- All treated as one route

### 3. Loop Routes (e.g., 101 - Blue)
- Single direction, circular path
- Last stop = First stop (same location)

---

## Parser Output Structure

```typescript
interface ParseResult {
  routes: ParsedRoute[];
  errors: string[];
  warnings: string[];
}

interface ParsedRoute {
  routeName: string;           // Sheet name
  sections: ParsedSection[];   // Weekday, Saturday, Sunday
}

interface ParsedSection {
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  stops: StopInfo[];
  trips: ParsedTrip[];
}

interface ParsedTrip {
  rowIndex: number;
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  timeBand: string;
  times: Record<string, string>;      // Stop name → time
  recoveryTimes: Record<string, number>; // R column → minutes
  startTime: number | null;           // Minutes from midnight
  endTime: number | null;
  travelTime: number;
}
```

---

## Detection Anchors

The parser uses these text markers to identify structure:

| Marker | Location | Purpose |
|--------|----------|---------|
| `"Stop Name"` | Col A or B | Signals start of new section's header |
| `"Stop ID"` | Col A or B | Signals stop ID row, section begins |
| `"R"` | Stop name row | Marks recovery/layover column |
| `"Travel"`, `"Cycle"`, `"Frequency"` | End columns | Summary metrics (signals end of stops) |

---

## Downstream Implications

### Block Assignment
- Consecutive trips with matching end/start times (at the terminus) can be linked into the same **bus block**
- A block represents all trips served by a single bus/driver
- Criteria: `Trip N endTime @ lastStop === Trip N+1 startTime @ firstStop`

### Total Service Hours Calculation
- **Avoid double-counting** the overlap time at terminus
- Trip duration = `endTime - startTime` (recovery is included in the route)
- Block duration = `lastTrip.endTime - firstTrip.startTime`
- When aggregating, only count each unique time window once

### Visual Display Considerations
- Show the duplicated terminus time in **both trip rows** (matches user's mental model)
- Use visual indicators (color, border) to show block boundaries
- Highlight recovery columns differently from time columns
- Consider collapsing ARRIVE/DEPART into single column with "→" separator for compact view

---

## Files

| File | Purpose |
|------|---------|
| `utils/masterScheduleParserV2.ts` | New parser implementation |
| `utils/masterScheduleParser.ts` | Old parser (deprecated) |
| `test_parser_v2.ts` | Test script for validation |
