# Route Planner 2 Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Route Planner 2 clean local workspace foundation: typed project/scenario state, local scenario actions, preferred scenario selection, and a simple comparison table.

**Architecture:** Keep Route Planner 2 isolated from legacy Route Planner. Put reusable local domain logic in `utils/route-planner-2/`, keep the current workspace component as the UI shell, and add tests before implementation. Preferred scenario is stored once at project level via `preferredScenarioId`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing DOM-based component test pattern.

---

## Source Docs

Read these before coding:

- `docs/route-planner-2/README.md`
- `docs/route-planner-2/01-product-brief.md`
- `docs/route-planner-2/02-user-workflows.md`
- `docs/route-planner-2/05-data-model.md`
- `docs/route-planner-2/07-test-strategy.md`
- `docs/route-planner-2/08-roadmap.md`

Do not use `docs/route-planner-legacy/` as implementation guidance.

## Files

- Create: `utils/route-planner-2/routePlanner2Types.ts`
- Create: `utils/route-planner-2/routePlanner2ProjectFactory.ts`
- Create: `utils/route-planner-2/routePlanner2ProjectController.ts`
- Modify: `components/Analytics/RoutePlanner2Workspace.tsx`
- Create: `tests/routePlanner2ProjectFactory.test.ts`
- Create: `tests/routePlanner2ProjectController.test.ts`
- Create: `tests/routePlanner2Isolation.test.ts`
- Create: `tests/RoutePlanner2Workspace.localWorkspace.test.tsx`

---

## Task 1: Add Route Planner 2 types and starter factory

**Files:**

- Create: `utils/route-planner-2/routePlanner2Types.ts`
- Create: `utils/route-planner-2/routePlanner2ProjectFactory.ts`
- Test: `tests/routePlanner2ProjectFactory.test.ts`

- [ ] **Step 1: Write the failing factory test**

Create `tests/routePlanner2ProjectFactory.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { createRoutePlanner2Project, createRoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 project factory', () => {
  const now = '2026-04-29T12:00:00.000Z';

  it('creates a local draft project with one selected blank scenario', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', now, scenarioId: 'scenario-1' });

    expect(project.name).toBe('Untitled Route Study');
    expect(project.status).toBe('local-draft');
    expect(project.selectedScenarioId).toBe('scenario-1');
    expect(project.preferredScenarioId).toBeUndefined();
    expect(project.scenarios).toHaveLength(1);
    expect(project.scenarios[0]).toMatchObject({
      id: 'scenario-1',
      name: 'Clean Concept A',
      status: 'draft',
      alignment: [],
      stops: [],
      notes: 'Blank route concept. Add an alignment and stops before running feasibility checks.',
      createdAt: now,
      updatedAt: now,
    });
    expect(project.scenarios[0]?.service).toEqual({
      firstTripTime: '06:00',
      lastTripTime: '22:00',
      frequencyMinutes: 30,
      startTerminalLayoverMinutes: 5,
      endTerminalLayoverMinutes: 5,
    });
  });

  it('creates a scenario without a preferred status', () => {
    const scenario = createRoutePlanner2Scenario({ id: 'scenario-2', name: 'Option B', now });

    expect(scenario.id).toBe('scenario-2');
    expect(scenario.name).toBe('Option B');
    expect(scenario.status).toBe('draft');
    expect(Object.prototype.hasOwnProperty.call(scenario, 'preferredScenarioId')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```powershell
npm test -- tests/routePlanner2ProjectFactory.test.ts --run
```

Expected: fails because `routePlanner2ProjectFactory.ts` does not exist.

- [ ] **Step 3: Create `routePlanner2Types.ts`**

Use the exact model from `docs/route-planner-2/05-data-model.md`, with these exported names:

```typescript
export type RoutePlanner2ProjectStatus = 'local-draft' | 'local-saved' | 'archived';
export type RoutePlanner2ScenarioStatus = 'draft' | 'review';
export type RoutePlanner2StopRole = 'regular' | 'timed' | 'start-terminal' | 'end-terminal';
export type RoutePlanner2RuntimeSource = 'observed-proxy' | 'manual' | 'fallback' | 'missing';
export type RoutePlanner2Confidence = 'high' | 'medium' | 'low' | 'not-ready';
export type RoutePlanner2SegmentConfidence = 'high' | 'medium' | 'low' | 'missing';
export type RoutePlanner2WarningSeverity = 'info' | 'warning' | 'blocking';
```

Then define and export:

- `RoutePlanner2Project`
- `RoutePlanner2Scenario`
- `RoutePlanner2RoutePoint`
- `RoutePlanner2Stop`
- `RoutePlanner2ServiceAssumptions`
- `RoutePlanner2FeasibilitySummary`
- `RoutePlanner2SegmentRuntime`
- `RoutePlanner2Warning`

- [ ] **Step 4: Create `routePlanner2ProjectFactory.ts`**

Implement:

```typescript
export function createRoutePlanner2Scenario(options: {
  id?: string;
  name?: string;
  now?: string;
} = {}): RoutePlanner2Scenario

export function createRoutePlanner2Project(options: {
  id?: string;
  now?: string;
  scenarioId?: string;
} = {}): RoutePlanner2Project
```

Rules:

- default project name is `Untitled Route Study`
- default scenario name is `Clean Concept A`
- project status is `local-draft`
- scenario status is `draft`
- no scenario-level preferred state exists
- selected scenario is the first scenario
- service defaults are `06:00`, `22:00`, `30`, `5`, `5`

- [ ] **Step 5: Run the factory test**

Run:

```powershell
npm test -- tests/routePlanner2ProjectFactory.test.ts --run
```

Expected: pass.

---

## Task 2: Add pure project controller helpers

**Files:**

- Create: `utils/route-planner-2/routePlanner2ProjectController.ts`
- Test: `tests/routePlanner2ProjectController.test.ts`

- [ ] **Step 1: Write the failing controller tests**

Create `tests/routePlanner2ProjectController.test.ts` with tests for:

- `renameRoutePlanner2Project`
- `addRoutePlanner2Scenario`
- `renameRoutePlanner2Scenario`
- `duplicateRoutePlanner2Scenario`
- `selectRoutePlanner2Scenario`
- `markRoutePlanner2PreferredScenario`
- `deleteRoutePlanner2Scenario`

Required assertions:

```typescript
expect(project.preferredScenarioId).toBe('scenario-1');
expect(project.scenarios[0]?.status).toBe('draft');
expect(project.status).toBe('local-draft');
expect(project.selectedScenarioId).toBe('scenario-2');
expect(project.scenarios).toHaveLength(2);
```

Deletion behavior:

- deleting the last remaining scenario returns the original project
- deleting the selected scenario selects the first remaining scenario
- deleting the preferred scenario clears `preferredScenarioId`

- [ ] **Step 2: Run the controller tests and confirm they fail**

Run:

```powershell
npm test -- tests/routePlanner2ProjectController.test.ts --run
```

Expected: fails because `routePlanner2ProjectController.ts` does not exist.

- [ ] **Step 3: Create `routePlanner2ProjectController.ts`**

Implement these exports:

```typescript
export function renameRoutePlanner2Project(project: RoutePlanner2Project, name: string, now = new Date().toISOString()): RoutePlanner2Project

export function addRoutePlanner2Scenario(project: RoutePlanner2Project, options: { id?: string; name?: string; now?: string } = {}): RoutePlanner2Project

export function renameRoutePlanner2Scenario(project: RoutePlanner2Project, scenarioId: string, name: string, now = new Date().toISOString()): RoutePlanner2Project

export function duplicateRoutePlanner2Scenario(project: RoutePlanner2Project, scenarioId: string, options: { id?: string; now?: string } = {}): RoutePlanner2Project

export function deleteRoutePlanner2Scenario(project: RoutePlanner2Project, scenarioId: string, now = new Date().toISOString()): RoutePlanner2Project

export function selectRoutePlanner2Scenario(project: RoutePlanner2Project, scenarioId: string, now = new Date().toISOString()): RoutePlanner2Project

export function markRoutePlanner2PreferredScenario(project: RoutePlanner2Project, scenarioId: string, now = new Date().toISOString()): RoutePlanner2Project
```

Implementation rules:

- all helpers are pure functions
- unknown scenario IDs return the original project
- changed projects become `local-draft` unless archived
- duplicate names use `${source.name} copy`
- duplicate scenario status is `draft`
- preferred scenario stays project-level only

- [ ] **Step 4: Run the controller tests**

Run:

```powershell
npm test -- tests/routePlanner2ProjectController.test.ts --run
```

Expected: pass.

---

## Task 3: Add the legacy isolation guard

**Files:**

- Create: `tests/routePlanner2Isolation.test.ts`

- [ ] **Step 1: Write the isolation test**

Create `tests/routePlanner2Isolation.test.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const filesToScan = [
  'components/Analytics/RoutePlanner2Workspace.tsx',
  'utils/route-planner-2/routePlanner2ProjectFactory.ts',
  'utils/route-planner-2/routePlanner2ProjectController.ts',
  'utils/route-planner-2/routePlanner2Types.ts',
];

const disallowedPatterns = [
  'utils/route-planner/',
  '../utils/route-planner/',
  './useRoutePlannerController',
  'useRoutePlannerController',
  'routePlannerDraftStorage',
  'routePlannerProjectService',
];

describe('Route Planner 2 isolation', () => {
  it('does not import legacy Route Planner controllers, services, storage, or utilities', () => {
    const violations = filesToScan.flatMap((relativePath) => {
      const fullPath = path.join(process.cwd(), relativePath);

      if (!fs.existsSync(fullPath)) return [];

      const text = fs.readFileSync(fullPath, 'utf8');
      return disallowedPatterns
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${relativePath} contains ${pattern}`);
    });

    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the isolation test**

Run:

```powershell
npm test -- tests/routePlanner2Isolation.test.ts --run
```

Expected: pass.

---

## Task 4: Refactor `RoutePlanner2Workspace.tsx` onto the local model

**Files:**

- Modify: `components/Analytics/RoutePlanner2Workspace.tsx`
- Test: `tests/RoutePlanner2Workspace.localWorkspace.test.tsx`

- [ ] **Step 1: Write the failing workspace tests**

Create `tests/RoutePlanner2Workspace.localWorkspace.test.tsx` using the same `createRoot` / `flushSync` pattern as `tests/WorkspaceHeader.test.tsx`.

Required tests:

1. Renders:
   - `Route Planner 2`
   - `Local draft`
   - `Clean Concept A`
   - `Blank route concept`
   - does not render `Shuttle Template`
2. Clicking `Add scenario` creates `Option 2`.
3. Editing `#rp2-scenario-name` updates the scenario name.
4. Clicking `Mark preferred` displays `Preferred`.
5. Clicking `Delete` removes the selected scenario when more than one exists.
6. Renders a `Scenario comparison` table with `Stops`, `Runtime`, `Buses`, and `Warnings`.

- [ ] **Step 2: Run the workspace tests and confirm they fail**

Run:

```powershell
npm test -- tests/RoutePlanner2Workspace.localWorkspace.test.tsx --run
```

Expected: fails because the current shell still has mode-specific starter data and disabled add actions.

- [ ] **Step 3: Replace local ad hoc scenario state**

In `components/Analytics/RoutePlanner2Workspace.tsx`:

- remove `PlannerMode`
- remove `ScenarioStatus`
- remove `PlannerScenario`
- remove `STARTER_SCENARIOS`
- remove `MODE_LABELS`
- remove `STATUS_STYLES`
- add imports from `utils/route-planner-2`
- create state with `createRoutePlanner2Project()`
- derive `selectedScenario` from `project.selectedScenarioId`

- [ ] **Step 4: Wire local scenario actions**

Add component functions:

```typescript
function addScenario() {
  setProject((current) => addRoutePlanner2Scenario(current));
}

function duplicateSelectedScenario() {
  if (!selectedScenario) return;
  setProject((current) => duplicateRoutePlanner2Scenario(current, selectedScenario.id));
}

function deleteSelectedScenario() {
  if (!selectedScenario) return;
  setProject((current) => deleteRoutePlanner2Scenario(current, selectedScenario.id));
}

function markSelectedPreferred() {
  if (!selectedScenario) return;
  setProject((current) => markRoutePlanner2PreferredScenario(current, selectedScenario.id));
}
```

- [ ] **Step 5: Update UI copy and controls**

Required UI changes:

- replace mode selector with a project summary card
- show `Local draft` in the header
- label disabled save as `Save later`
- keep export disabled
- enable `Add scenario`
- show `Preferred` from `project.preferredScenarioId`
- disable `Delete` when only one scenario remains
- keep notes editing local
- keep map interaction copy clear that map authoring starts in Milestone 2

- [ ] **Step 6: Add scenario comparison table**

Add a table titled `Scenario comparison`.

Columns:

- Scenario
- Stops
- Runtime
- Buses
- Warnings

For Milestone 1, values can show current local state:

- stops: `scenario.stops.length`
- runtime: `scenario.feasibility?.oneWayRuntimeMinutes` or `Not estimated`
- buses: `scenario.feasibility?.busesRequired` or `—`
- warnings: `scenario.feasibility?.warnings.length` or `0`

- [ ] **Step 7: Run workspace tests**

Run:

```powershell
npm test -- tests/RoutePlanner2Workspace.localWorkspace.test.tsx --run
```

Expected: pass.

---

## Task 5: Focused verification

**Files:**

- Modify only if behavior changed: `docs/route-planner-2/08-roadmap.md`

- [ ] **Step 1: Run Route Planner 2 tests**

Run:

```powershell
npm test -- tests/routePlanner2ProjectFactory.test.ts tests/routePlanner2ProjectController.test.ts tests/routePlanner2Isolation.test.ts tests/RoutePlanner2Workspace.localWorkspace.test.tsx --run
```

Expected: pass.

- [ ] **Step 2: Run nearby feature tests**

Run:

```powershell
npm test -- tests/features.test.ts tests/workspaceAccess.test.ts --run
```

Expected: pass. If a failure references `analyticsRoutePlanner2`, inspect it before continuing.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: build completes. Existing bundle-size warnings are acceptable if there are no TypeScript or Vite errors.

- [ ] **Step 4: Check whitespace and legacy imports**

Run:

```powershell
git diff --check
Select-String -Path components\Analytics\RoutePlanner2Workspace.tsx,utils\route-planner-2\*.ts -Pattern 'utils/route-planner/|useRoutePlannerController|routePlannerDraftStorage|routePlannerProjectService'
```

Expected:

- `git diff --check` has no errors; line-ending warnings may appear
- `Select-String` returns no matches

- [ ] **Step 5: Update roadmap only if the delivered behavior differs**

If implementation follows this plan, do not edit docs.

If Milestone 1 scope changes, update `docs/route-planner-2/08-roadmap.md` so its Milestone 1 acceptance section matches the delivered behavior.

- [ ] **Step 6: Commit Milestone 1**

Stage only Route Planner 2 Milestone 1 files and tests:

```powershell
git add components/Analytics/RoutePlanner2Workspace.tsx utils/route-planner-2 tests/routePlanner2ProjectFactory.test.ts tests/routePlanner2ProjectController.test.ts tests/routePlanner2Isolation.test.ts tests/RoutePlanner2Workspace.localWorkspace.test.tsx docs/route-planner-2/08-roadmap.md
```

Commit:

```powershell
git commit -m "feat: add route planner 2 local workspace foundation"
```

---

## Self-Review

Spec coverage:

- Project with scenarios: Task 1 and Task 2.
- Blank route concept workflow: Task 1 starter project and Task 4 UI copy.
- Local-first and Firebase-ready: Task 1 types and Task 4 local draft status.
- Preferred scenario single source of truth: Task 2 tests and implementation.
- Simple comparison table: Task 4.
- Legacy isolation: Task 3.
- No Firebase persistence, coverage, or schedule handoff: Task 3 and Task 4 avoid those integrations.

Type consistency:

- `preferredScenarioId` is project-level only.
- Scenario status values are `draft` and `review` only.
- Project status uses `local-draft`, `local-saved`, and `archived`.
- Terminal layover fields match `05-data-model.md`.

Execution note:

- This plan is scoped to Milestone 1 only.
- Stop-aware map authoring begins in Milestone 2.
