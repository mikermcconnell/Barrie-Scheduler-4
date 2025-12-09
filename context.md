# AI Agent Instructions

> [!IMPORTANT]
> **CRITICAL INSTRUCTIONS FOR AI AGENTS**
> You are a very strong reasoner and planner. Use these critical instructions to structure your plans, thoughts, and responses.
>
> **LOCKED LOGIC (DO NOT CHANGE WITHOUT APPROVAL):**
> 1. **Double Pass Optimization**: The `api/optimize.ts` file MUST use the "Double Pass" strategy (Generator -> Critic). Any attempt to revert to a single call is FORBIDDEN.
> 2. **Efficiency Rules**: allowed gaps ("-1 driver for < 30 mins") are a critical feature to prevent surplus. DO NOT remove this instruction from the prompt.
>
> **Before taking any action (either tool calls *or* responses to the user), you must proactively, methodically, and independently plan and reason about:**
>
> 1. **Logical dependencies and constraints**: Analyze the intended action against the following factors. Resolve conflicts in order of importance:
>    1.1. Policy-based rules, mandatory prerequisites, and constraints.
>    1.2. Order of operations: Ensure taking an action does not prevent a subsequent necessary action.
>         1.2.1. The user may request actions in a random order, but you may need to reorder operations to maximize successful completion of the task.
>    1.3. Other prerequisites (information and/or actions needed).
>    1.4. Explicit user constraints or preferences.
>
> 2. **Risk assessment**: What are the consequences of taking the action? Will the new state cause any future issues?
>    2.1. For exploratory tasks (like searches), missing *optional* parameters is a LOW risk. **Prefer calling the tool with the available information over asking the user, unless** your `Rule 1` (Logical Dependencies) reasoning determines that optional information is required for a later step in your plan.
>
> 3. **Abductive reasoning and hypothesis exploration**: At each step, identify the most logical and likely reason for any problem encountered.
>    3.1. Look beyond immediate or obvious causes. The most likely reason may not be the simplest and may require deeper inference.
>    3.2. Hypotheses may require additional research. Each hypothesis may take multiple steps to test.
>    3.3. Prioritize hypotheses based on likelihood, but do not discard less likely ones prematurely. A low-probability event may still be the root cause.
>
> 4. **Outcome evaluation and adaptability**: Does the previous observation require any changes to your plan?
>    4.1. If your initial hypotheses are disproven, actively generate new ones based on the gathered information.
>
> 5. **Information availability**: Incorporate all applicable and alternative sources of information, including:
>    5.1. Using available tools and their capabilities
>    5.2. All policies, rules, checklists, and constraints
>    5.3. Previous observations and conversation history
>    5.4. Information only available by asking the user
>
> 6. **Precision and Grounding**: Ensure your reasoning is extremely precise and relevant to each exact ongoing situation.
>    6.1. Verify your claims by quoting the exact applicable information (including policies) when referring to them.
>
> 7. **Completeness**: Ensure that all requirements, constraints, options, and preferences are exhaustively incorporated into your plan.
>    7.1. Resolve conflicts using the order of importance in #1.
>    7.2. Avoid premature conclusions: There may be multiple relevant options for a given situation.
>         7.2.1. To check for whether an option is relevant, reason about all information sources from #5.
>         7.2.2. You may need to consult the user to even know whether something is applicable. Do not assume it is not applicable without checking.
>    7.3. Review applicable sources of information from #5 to confirm which are relevant to the current state.
>
> 8. **Persistence and patience**: Do not give up unless all the reasoning above is exhausted.
>    8.1. Don't be dissuaded by time taken or user frustration.
>    8.2. This persistence must be intelligent: On *transient* errors (e.g. please try again), you *must* retry **unless an explicit retry limit (e.g., max x tries) has been reached**. If such a limit is hit, you *must* stop. On *other* errors, you must change your strategy or arguments, not repeat the same failed call.
>
> 9. **Inhibit your response**: only take an action after all the above reasoning is completed. Once you've taken an action, you cannot take it back.

---

# Project Context: Bus Scheduler App

## 1. Project Overview
**Bus Scheduler** is a React-based application designed to manage and optimize transit schedules. It supports two primary modes of operation:
*   **Transit On-Demand**: Managing dynamic driver shifts, analyzing coverage gaps against demand curves, and using AI to optimize rosters.
*   **Fixed Route**: (Placeholder/Future) Managing traditional fixed-route timetables.

## 2. Technology Stack
*   **Frontend Library**: React 19
*   **Build Tool**: Vite 7
*   **Language**: TypeScript 5.9
*   **Styling**: **Tailwind CSS (via CDN)**.
    *   *Note*: Tailwind is loaded directly in `index.html`. There is no build-time CSS processing or `tailwind.config.js`. Custom theme colors (brand-green, brand-blue, etc.) are defined in the script tag within `index.html`.
*   **Icons**: Lucide React
*   **Charts**: Recharts
*   **Backend/API**: Vercel Serverless Functions (`/api` folder).
*   **AI Model**: Google Gemini (`gemini-3-pro-preview` / `gemini-2.0-flash`) via the `@google/generative-ai` SDK.
*   **Data Handling**: `xlsx` for Excel export, custom CSV parsers for import.

## 3. Architecture & Data Flow

### 3.1 Data Model
*   **Requirement**: Represents demand at a specific 15-minute slot. Tracks `total`, `north`, `south`, and `floater` demand.
*   **Shift**: A driver's assigned block of time. Key properties: `id`, `driverName`, `zone` (North/South/Floater), `startSlot`, `endSlot`, `breakStartSlot`.
*   **Zone**: Strict union-based zones. "North" buses stay in North. "South" buses stay in South. "Floaters" can relieve either.

### 3.2 Optimization Pipeline
1.  **Input**: User uploads specific CSV files ("Master Schedule" for demand, "RideCo Shifts" for supply).
2.  **Parsing**: `utils/csvParsers.ts` converts CSV rows into `Requirement[]` and `Shift[]` objects.
3.  **State**: Managed in React components (`OnDemandWorkspace.tsx`).
4.  **Optimization Request**: User clicks "Regenerate".
    *   Frontend calls `utils/geminiOptimizer.ts`.
    *   Request POSTs to `/api/optimize`.
5.  **Serverless Processing**:
    *   **Production**: Vercel handles `/api/optimize` via `api/optimize.ts`.
    *   **Local Dev**: Vite middleware (in `vite.config.ts`) intercepts `/api/optimize` and executes `optimizeImplementation` directly.
6.  **AI Generation**:
    *   Gemini API is called with a prompt containing demand curves and constraints (Union rules, break windows).
    *   Model returns a JSON array of optimized shifts.
7.  **Output**: State is updated. Charts (`GapChart`) reflect the new coverage.

## 4. Development Workflow

### 4.1 Running Locally
The project uses a standard Vite setup but requires specific configuration for the API:
```bash
npm run dev
```
*   **Port**: Defaults to `3008`.
*   **Environment Variables**: A `.env` file in the root is **REQUIRED** containing `GEMINI_API_KEY`.
*   **API Proxy**: Use `vite.config.ts` to debug the API middleware if `404` errors occur on `/api/optimize`.

### 4.2 Deployment
*   Platform: **Vercel**
*   Configuration: `vercel.json` (defines rewrites/redirects).
*   API Keys: Set `GEMINI_API_KEY` in Vercel Project Settings.

## 5. Directory Structure
```
/
├── api/                # Vercel Serverless Functions (Backend logic)
│   └── optimize.ts     # Main Gemini optimization handler
├── components/         # React Components
│   ├── OnDemandWorkspace.tsx # Main workspace for On-Demand mode
│   ├── ShiftEditor.tsx       # UI for manipulating shifts
│   └── ...
├── utils/              # Helper logic
│   ├── csvParsers.ts   # CSV import logic
│   ├── geminiOptimizer.ts # Frontend client for optimization API
│   └── ...
├── scripts/            # Verification and utility scripts
├── .env                # Local secrets (API Key) - DO NOT COMMIT
├── App.tsx             # Main routing/layout logic
├── vite.config.ts      # Vite config + Local API Middleware
└── index.html          # Entry point + Tailwind CDN config
```

## 6. Key Features & Constraints
*   **Union Rules**:
    *   Shift Length: 5-10 hours.
    *   Breaks: Mandatory 45m break if shift > 6 hours.
    *   Break Window: Must occur between the 5th and 8th hour of the shift.
*   **Zones**:
    *   **North/South**: Dedicated coverage.
    *   **Floater**: Swing coverage to fill gaps or cover breaks.
*   **Theme**: "Duolingo-style" - Friendly, rounded, vibrant colors (`#58CC02` Green, `#1CB0F6` Blue).

## 7. Troubleshooting

### 7.1 Port Conflicts & "Zombie" Servers
*   **Symptom**: `Error: Port 3008 is already in use` or weird 404s because you're hitting an old server process.
*   **Prevention**: `strictPort: true` is enabled in `vite.config.ts`. The server will fail to start rather than switching ports.
*   **Fix**: Run the "Nuclear Option" in PowerShell to kill ALL Node processes:
    ```powershell
    taskkill /F /IM node.exe
    ```

### 7.2 Local API 404 Errors
*   **Symptom**: `POST /api/optimize` returns 404 during local development (`npm run dev`), but works on Vercel.
*   **Cause**: Vite middleware isn't loading correctly.
*   **Fix**: Ensure the API middleware in `vite.config.ts` is implemented as a **Vite Plugin** (via `plugins: [apiMiddlewarePlugin()]`), NOT nested inside `server.configureServer`. Nested hooks can be ignored by Vite in certain configurations.
*   **Verification**: Check terminal logs on startup for `✅ Plugin configureServer called`.

### 7.3 Tailwind Not Working
*   **Check**: `index.html`. Tailwind is loaded via CDN `<script src="https://cdn.tailwindcss.com"></script>`. It is NOT built via npm/PostCSS.
