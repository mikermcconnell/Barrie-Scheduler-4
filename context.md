# AI Agent Instructions

> [!IMPORTANT]
> **CRITICAL INSTRUCTIONS FOR AI AGENTS**
> You are a very strong reasoner and planner. Use these critical instructions to structure your plans, thoughts, and responses.
>
> **IMPACT ANALYSIS REQUIRED:**
> Before implementing any new feature or change, you MUST:
> 1. Identify which existing features could be affected
> 2. Provide an estimated impact assessment (LOW/MEDIUM/HIGH)
> 3. List specific files/functions that will be modified
> 4. Flag any breaking changes or risky modifications to the user BEFORE coding
>
> **LOCKED LOGIC (DO NOT CHANGE WITHOUT APPROVAL):**
> 1. **Double Pass Optimization**: The `api/optimize.ts` file MUST use the "Double Pass" strategy (Generator -> Critic). Any attempt to revert to a single call is FORBIDDEN.
> 2. **Efficiency Rules**: allowed gaps ("-1 driver for < 30 mins") are a critical feature to prevent surplus. DO NOT remove this instruction from the prompt.
> 3. **Segment Rounding**: All segment travel times MUST be rounded to whole minutes BEFORE summing.
> 4. **Trip Pairing**: Round Trip View displays N1+S1, N2+S2 pairs - NOT all trips in one row.
> 5. **Cycle Calculation**: Total Cycle = Last Timepoint End - First Timepoint Start (simple subtraction).
>
> **Before taking any action (either tool calls *or* responses to the user), you must proactively, methodically, and independently plan and reason about:**
>
> 1. **Logical dependencies and constraints**: Analyze the intended action against the following factors. Resolve conflicts in order of importance:
>    1.1. Policy-based rules, mandatory prerequisites, and constraints.
>    1.2. Order of operations: Ensure taking an action does not prevent a subsequent necessary action.
>    1.3. Other prerequisites (information and/or actions needed).
>    1.4. Explicit user constraints or preferences.
>
> 2. **Risk assessment**: What are the consequences of taking the action? Will the new state cause any future issues?
>    2.1. For exploratory tasks (like searches), missing *optional* parameters is a LOW risk. **Prefer calling the tool with the available information over asking the user.**
>
> 3. **Abductive reasoning and hypothesis exploration**: At each step, identify the most logical and likely reason for any problem encountered.
>    3.1. Look beyond immediate or obvious causes.
>    3.2. Hypotheses may require additional research.
>    3.3. Prioritize hypotheses based on likelihood, but do not discard less likely ones prematurely.
>
> 4. **Outcome evaluation and adaptability**: Does the previous observation require any changes to your plan?
>
> 5. **Information availability**: Incorporate all applicable and alternative sources of information.
>
> 6. **Precision and Grounding**: Ensure your reasoning is extremely precise and relevant to each exact ongoing situation.
>
> 7. **Completeness**: Ensure that all requirements, constraints, options, and preferences are exhaustively incorporated into your plan.
>
> 8. **Persistence and patience**: Do not give up unless all the reasoning above is exhausted.
>
> 9. **Inhibit your response**: only take an action after all the above reasoning is completed.

---

# Project Context: Bus Scheduler App

## 1. Project Overview
**Bus Scheduler** is a React-based application designed to manage and optimize transit schedules. It supports two primary modes of operation:
*   **Transit On-Demand**: Managing dynamic driver shifts, analyzing coverage gaps against demand curves, and using AI to optimize rosters.
*   **Fixed Route (ACTIVE DEVELOPMENT)**: Building and managing traditional fixed-route timetables from runtime data.

## 2. Technology Stack
*   **Frontend Library**: React 19
*   **Build Tool**: Vite 7
*   **Language**: TypeScript 5.9
*   **Styling**: **Tailwind CSS (via CDN)** - loaded in `index.html`, no build-time processing
*   **Icons**: Lucide React
*   **Charts**: Recharts
*   **Backend/API**: Vercel Serverless Functions (`/api` folder)
*   **AI Model**: Google Gemini via `@google/generative-ai` SDK
*   **Data Handling**: `xlsx` for Excel, custom CSV parsers for import

## 3. Architecture & Data Flow

### 3.1 On-Demand Data Model
*   **Requirement**: Demand at a 15-minute slot. Tracks `total`, `north`, `south`, `floater`.
*   **Shift**: Driver's assigned block. Properties: `id`, `driverName`, `zone`, `startSlot`, `endSlot`, `breakStartSlot`.
*   **Zone**: "North" | "South" | "Floater"

### 3.2 Fixed Route Data Model
```typescript
interface MasterTrip {
    id: string;
    blockId: string;           // "400-1"
    direction: 'North' | 'South';
    tripNumber: number;
    startTime: number;         // Minutes from midnight
    endTime: number;
    travelTime: number;        // Pure driving time (rounded)
    recoveryTime: number;      // Layover at end
    recoveryTimes?: Record<string, number>;  // Per-stop recovery
    arrivalTimes?: Record<string, string>;   // Arrival at each stop
    stops: Record<string, string>;           // Departure from each stop
    cycleTime: number;
}

interface RoundTripRow {
    blockId: string;
    trips: MasterTrip[];       // One N + one S per row
    northStops: string[];
    southStops: string[];
    totalTravelTime: number;
    totalRecoveryTime: number;
    totalCycleTime: number;    // Last endTime - First startTime
}

interface ScheduleConfig {
    routeNumber: string;
    cycleTime: number;                       // User-defined round-trip time
    recoveryDistribution?: 'End' | 'Proportional';
    blocks: BlockConfig[];
}
```

### 3.3 Fixed Route Pipeline
1. **Upload** (`Step1Upload`) - User uploads segment CSV files (North/South)
2. **Parse** (`csvParser.ts`) - Extract segments, timepoints, time buckets
3. **Analyze** (`runtimeAnalysis.ts`) - Calculate P50/P80, assign time bands (A-E)
4. **Configure** (`Step3Build`) - Set cycle time, recovery mode, blocks
5. **Generate** (`scheduleGenerator.ts`) - Build trips from config + runtime data
6. **Display** (`ScheduleEditor.tsx`) - Round Trip View with Arr | R | Dep columns

### 3.4 Key Constraints (Fixed Route)
*   **Segment Rounding**: Round each segment's P50 to nearest minute BEFORE summing
*   **Cycle Time**: User-defined. Slack = Cycle - Travel Time
*   **Recovery Distribution**:
    - `End`: All slack at terminus
    - `Proportional`: Distribute slack across stops proportional to segment length
*   **Time Bands**: A (slowest) → E (fastest), based on travel time quintiles

## 4. Directory Structure
```
/
├── api/                       # Vercel Serverless Functions
│   └── optimize.ts            # Gemini optimization handler
├── components/
│   ├── NewSchedule/           # Fixed Route Builder (4-step wizard)
│   │   ├── steps/
│   │   │   ├── Step1Upload.tsx
│   │   │   ├── Step2Analysis.tsx
│   │   │   ├── Step3Build.tsx
│   │   │   └── Step4Schedule.tsx
│   │   └── utils/
│   │       ├── csvParser.ts       # Segment parsing
│   │       ├── runtimeAnalysis.ts # Time band calculation
│   │       └── scheduleGenerator.ts # Trip generation
│   ├── ScheduleEditor.tsx     # Round Trip View table
│   ├── TravelTimeGrid.tsx     # Runtime breakdown display
│   ├── OnDemandWorkspace.tsx  # On-Demand shift editor
│   └── ...
├── utils/
│   ├── masterScheduleParser.ts    # Excel parsing + buildRoundTripView
│   ├── csvParsers.ts              # On-Demand CSV import
│   └── ...
├── .env                       # GEMINI_API_KEY (DO NOT COMMIT)
├── App.tsx                    # Main routing
├── vite.config.ts             # Vite + API middleware
└── index.html                 # Entry + Tailwind CDN
```

## 5. UI Layout Conventions (Fixed Route)

### Round Trip View Table Structure
```
| Block | [North Stops: Arr | R | Dep] | [South Stops: Arr | R | Dep] | Travel | Band | Rec | Ratio | Hdwy | Cycle |
```

*   **Colors**: Blue = North direction, Indigo = South direction, Gray = Metrics
*   **Arr**: Arrival time (before recovery dwell)
*   **R**: Recovery minutes at that stop (always shown, even if 0)
*   **Dep**: Departure time (after recovery)
*   **Band**: A-E color-coded badge based on travel time

## 6. Key Features & Constraints

### On-Demand (Union Rules)
*   Shift Length: 5-10 hours
*   Breaks: Mandatory 45m if shift > 6 hours
*   Break Window: Between 5th and 8th hour

### Fixed Route
*   **Cycle Time**: User-defined (typically 60-120 min round trip)
*   **Blocks**: Each block runs from startTime to endTime, generating multiple trip pairs
*   **Trip Pairing**: N1+S1, N2+S2, etc. (one row per round trip, not per block)

### Theme
*   "Duolingo-style" - Friendly, rounded, vibrant colors
*   Primary Green: `#58CC02`
*   Primary Blue: `#1CB0F6`

## 7. Current Feature Status

| Feature | Status | Key Files |
|---------|--------|-----------|
| On-Demand Shifts | ✅ Done | `OnDemandWorkspace.tsx`, `ShiftEditor.tsx` |
| AI Optimization | ✅ Done | `api/optimize.ts`, `geminiOptimizer.ts` |
| Fixed Route Upload | ✅ Done | `Step1Upload.tsx`, `csvParser.ts` |
| Runtime Analysis | ✅ Done | `Step2Analysis.tsx`, `runtimeAnalysis.ts` |
| Schedule Builder | ✅ Done | `Step3Build.tsx` |
| Schedule Generator | ✅ Done | `scheduleGenerator.ts` |
| Round Trip View | ✅ Done | `ScheduleEditor.tsx`, `Step4Schedule.tsx` |
| Arr/R/Dep Columns | ✅ Done | `ScheduleEditor.tsx` |
| Time Band Column | ✅ Done | `ScheduleEditor.tsx` |
| Export to Excel | ⏳ Planned | - |
| Save/Load Schedules | ⏳ Planned | - |

## 8. Troubleshooting

### Port Conflicts
*   **Symptom**: `Error: Port 3008 is already in use`
*   **Fix**: `taskkill /F /IM node.exe` (PowerShell)

### Local API 404 Errors
*   **Cause**: Vite middleware not loading
*   **Fix**: Ensure API middleware is a Vite Plugin, not nested in `server.configureServer`
*   **Verification**: Look for `✅ Plugin configureServer called` in terminal

### Tailwind Not Working
*   **Check**: `index.html` loads Tailwind via CDN `<script src="https://cdn.tailwindcss.com"></script>`

---

## 9. Prompt Refinement Workflow (USER PREFERENCE)

> [!CAUTION]
> **MANDATORY FOR EVERY PROMPT**: The user has opted into an interactive prompt refinement process. This applies to ALL feature requests, changes, and significant work items - NO EXCEPTIONS.

**BEFORE executing ANY feature request or change, you MUST:**

1. **Analyze the prompt** for completeness (expected outcome, visual context, acceptance criteria)

2. **Ask 1-3 quick clarifying questions** to fill any gaps BEFORE writing code

3. **Restate the refined prompt** clearly for user confirmation

4. **WAIT for user confirmation** (e.g., "go", "yes", or any affirmative) before proceeding

**Example exchange:**
```
USER: "Add a save button"
AGENT: "Quick clarifications:
  1. Where should it appear?
  2. What does it save?
  3. Styling preference?"
USER: "Header right, saves to localStorage, blue button"
AGENT: "✅ Refined: Add 'Save' button in header (right), blue styling, saves schedule to localStorage. Proceeding..."
```

---

## 10. Travel Time Calculation (Option D Implementation)

> [!IMPORTANT]
> **SOURCE OF TRUTH**: The Step 2 "Segment Times by Band" table is the definitive source for travel times. The schedule generator uses these averaged segment times directly.

### 10.1 Data Flow

```
CSV Files (North.csv, South.csv)
    ↓
csvParser.ts → RuntimeData (segments with times per 30-min bucket)
    ↓
runtimeAnalysis.ts → TripBucketAnalysis[] (buckets with bands A-E assigned)
    ↓
Step2Analysis.tsx → BandSummary[] (averaged segment times PER BAND)
    ↓
NewScheduleWizard.tsx → stores bandSummary in state
    ↓
scheduleGenerator.ts → uses bandSummary to look up segment times
```

### 10.2 Key Data Structures

```typescript
// Band summary with averaged segment times (computed in Step2Analysis)
interface BandSummary {
    bandId: string;           // 'A', 'B', 'C', 'D', 'E'
    color: string;            // '#ef4444' (red for A)
    avgTotal: number;         // Average total trip time (e.g., 47m)
    segments: BandSegmentAverage[];
    timeSlots: string[];      // Which 30-min slots belong to this band
}

interface BandSegmentAverage {
    segmentName: string;      // "Park Place to Veteran's at Essa"
    avgTime: number;          // Averaged P50 across all slots in this band
}
```

### 10.3 Lookup Logic

When generating a trip at time `T`:

1. **Find Bucket**: Look for 30-min bucket containing `T`
   - Example: 7:00 AM → bucket "07:00 - 07:29"
   
2. **Fallback to Closest**: If no exact match, find nearest valid bucket
   - Example: 6:00 AM has no data → use "06:30 - 06:59" (Band E)

3. **Get Band**: Find which band (A-E) is assigned to that bucket
   - Example: "07:00 - 07:29" → Band A

4. **Look Up Segment Time**: From bandSummary, get the averaged segment time
   - Example: Band A → "Park Place to Veteran's at Essa" → 6 min

### 10.4 Example Trip Generation

**Input:**
- Trip start: 7:00 AM (420 minutes)
- Bucket "07:00 - 07:29" assigned to Band A
- Band A avgTotal: 47 minutes

**BandSummary for Band A:**
```
segments: [
    { segmentName: "Park Place to Veteran's at Essa", avgTime: 6 },
    { segmentName: "Veteran's at Essa to Rose at Highway 400", avgTime: 8 },
    { segmentName: "Rose at Highway 400 to Georgian at Governors", avgTime: 5 },
    { segmentName: "Georgian at Governors to RVH Main Entrance", avgTime: 4 }
]
```

**Output Trip:**
- Segment 1: 6 min
- Segment 2: 8 min
- Segment 3: 5 min
- Segment 4: 4 min
- **Total Travel Time: 23 min** (half of round-trip)

### 10.5 Console Debug Output

When generating schedules, console shows whether band data was used:

```
Trip 3 at 420 mins: {
    band: 'A',
    bandAvgTotal: '47',
    pureTravelTime: 23,
    usedBandData: true,    // ← Used Step 2 table data
    isRoundTrip: true
}
```

If `usedBandData: false`, segment name matching failed and raw CSV data was used as fallback.

### 10.6 Time Slot Assignment

The Step 2 table shows which 30-minute time slots belong to each band:

| Band | Time Slots | Avg Total |
|------|------------|-----------|
| A | 07:00, 16:00, 16:30, 17:00 | 47m |
| B | 07:30, 15:30, 17:30 | 45m |
| C | 08:00, 09:00, 14:30, 15:00 | 43m |
| D | 09:30, 14:00 | 42m |
| E | 06:30, 08:30, 10:00-13:30 | 41m |

Trips outside these windows use the **closest** available bucket.

