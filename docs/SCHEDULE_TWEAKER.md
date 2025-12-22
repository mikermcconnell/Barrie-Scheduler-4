# Schedule Tweaker

A powerful schedule editing workspace for transit operations teams.

## Overview

The Schedule Tweaker allows operations staff to upload master schedule Excel files, make real-time edits, and manage draft versions. It features intelligent block linking, automatic time propagation, and cloud-based draft management.

---

## Core Features

### 1. Excel Import & Parsing
- Upload `.xlsx` files with master schedules
- Auto-detects route sheets by name (e.g., "400", "8A")
- Parses stops, timepoints, recovery columns, and trip structure
- Handles bidirectional routes (North/South) and loop routes

### 2. Schedule Editing

#### Time Cell Editing
- Click any time cell to edit directly
- **Time propagation**: Editing a stop time shifts all subsequent stops by the same delta
- **Block ripple**: Changes cascade to subsequent trips in the same block

#### Time Adjustment Arrows
- Hover over any time cell to reveal `▲`/`▼` buttons
- Click to increment/decrement time by 1 minute
- Same propagation rules apply

#### Diff Indicators
- Modified cells display `+X` or `-X` badges showing change from original
- Green for increases, red for decreases
- Recovery time changes also show diff indicators

### 3. Block Linking

**Block = A chain of trips operated by a single bus**

#### How Blocking Works:
1. Trips are linked when: `endTime + recovery ≈ nextTrip.startTime` (within 1 minute)
2. For bidirectional routes: N→S→N→S alternation
3. Block IDs assigned sequentially by first departure time (4 AM operational day start)

#### Dynamic Re-assignment:
After any time or recovery edit, blocks are **automatically re-calculated** to maintain correct linking based on the new schedule.

---

## Draft Management System

### Auto-Save
- Drafts auto-save every 10 seconds after changes
- Status indicator shows: Saving, Saved, or Error
- Uses Firebase Firestore + Storage (or localStorage for guests)

### File Menu Actions
| Action | Description |
|--------|-------------|
| **Open Drafts...** | Opens the Draft Manager modal |
| **New Draft** | Creates a fresh draft, clears current schedule |
| **Rename Draft** | Change the draft name inline |
| **Save Version** | Creates a named snapshot (version history) |
| **Export** | Downloads schedule as Excel file |
| **Close Schedule** | Returns to dashboard |

### Draft Manager Modal
- View all saved drafts with route count and timestamps
- **Load** any draft to resume editing
- **Delete** drafts with hover-to-reveal trash button
- **Version History**: View and restore previous versions

### Version Restore
- Each saved version is a complete snapshot
- Restore reverts to that exact state
- Includes retry logic with exponential backoff for network failures

---

## Excel Export (Enterprise)

The export feature generates a professionally formatted Excel workbook with rich styling.

### Workbook Structure

```
Bus_Schedule_Export.xlsx
├── Service Hours Summary   ← First sheet (overview)
├── 400 (Weekday) (North)   ← Route sheets
├── 400 (Weekday) (South)
├── 400 (Saturday) (North)
└── ...
```

### Service Hours Summary Sheet

| Section | Description |
|---------|-------------|
| **Daily Hours** | Cycle hours per route per day (Weekday, Saturday, Sunday) |
| **Annual Hours** | Calculated using: Weekday×260, Saturday×52, Sunday×52 |
| **Route Colors** | Each route row uses its designated color |
| **Totals** | Bottom row shows grand totals |

**Example:**
| Route | Weekday | Saturday | Sunday | Total | Weekday | Saturday | Sunday | Total |
|-------|---------|----------|--------|-------|---------|----------|--------|-------|
| 400   | 23.4    | 18.2     | 12.1   | 53.7  | 6,084   | 946      | 629    | 7,659 |
| **TOTAL** | 38.6 | 28.3   | 20.4   | 87.3  | 10,036  | 1,472    | 1,061  | 12,569|

### Route Sheet Structure

Each route sheet contains:

1. **Route Header** (Row 1)
   - Shows: `ROUTE 400 - WEEKDAY`
   - Uses route's brand color with auto-contrast text

2. **Direction Header** (Row 2)
   - Shows: `NORTHBOUND` / `SOUTHBOUND` / `ALL TRIPS`

3. **Column Headers** (Row 3)
   - Block | Timepoint1 | R | Timepoint2 | ... | Travel | Recovery | Cycle | Ratio

4. **Trip Data**
   - Alternating row colors
   - R columns highlighted in blue
   - All text centered

5. **Day Summary Card** (offset right)
   - Total Trips, Travel, Recovery, Cycle (hours), Ratio

### Formatting Features

| Feature | Implementation |
|---------|----------------|
| **Centered text** | All cells horizontally + vertically centered |
| **Row heights** | Headers: 28px, Subheaders: 22px, Data: 18px |
| **Borders** | Thin gray borders on all cells |
| **Route colors** | Applied to header and summary card |
| **Contrast text** | Auto-detects light/dark text based on background |
| **Alternating rows** | White / Light gray striping |
| **R columns** | Blue-tinted for recovery values |

---

## Architecture

### Key Components

```
ScheduleEditor.tsx        # Main editor component
├── WorkspaceHeader.tsx   # Header with File menu, status, navigation
├── SingleRouteView.tsx   # Single direction trip table
├── RoundTripTableView.tsx # Bidirectional trip table
├── TravelTimeGrid.tsx    # Travel/recovery time matrix
└── DraftManagerModal.tsx # Draft list, versions, actions
```

### Data Flow

```
Excel File → masterScheduleParserV2 → parserAdapter → MasterRouteTable[]
                                            ↓
                              blockAssignment (time-based linking)
                                            ↓
                              ScheduleEditor (editing + re-linking)
                                            ↓
                              useAutoSave → dataService → Firebase/Storage
```

### Key Utilities
- `TimeUtils` - Time parsing, formatting, arithmetic
- `blockAssignment.ts` - Block ID assignment algorithms
- `dataService.ts` - Firebase CRUD with retry logic
- `useAutoSave.ts` - Debounced auto-save hook

---

## Recent Fixes & Improvements

### Session Dec 22, 2024

| Fix | Description |
|-----|-------------|
| ✅ Block linking | Re-implemented time-based matching after edits |
| ✅ Time arrows | Added hover-to-reveal `▲`/`▼` buttons on all time cells |
| ✅ Diff indicators | Show `+X`/`-X` badges on modified cells |
| ✅ Delete saved files | Trash button on Recent Files list |
| ✅ Delete drafts | Trash button on draft list in modal |
| ✅ Modal z-index | Fixed overlay appearing behind header |
| ✅ Menu buttons | Wired up Open Drafts, New Draft, Close Schedule |
| ✅ Restore button | Fixed non-functional version restore |
| ✅ Retry logic | Exponential backoff on save failures |
| ✅ Race condition | Fixed version restore overwriting draft name |

---

## Configuration

### Firebase Setup
Required collections:
- `users/{uid}/drafts` - Draft metadata
- `users/{uid}/files` - Uploaded file metadata

Required storage buckets:
- `drafts/{uid}/{draftId}` - Schedule JSON
- `files/{uid}/{fileId}` - Original Excel files
- `versions/{uid}/{draftId}/{versionId}` - Version snapshots

### Environment Variables
```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
```
