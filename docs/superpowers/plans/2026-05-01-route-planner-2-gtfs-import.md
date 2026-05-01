# Route Planner 2 GTFS Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a planner import an existing GTFS bus route into Route Planner 2 as an editable route concept with the route line and all stops.

**Architecture:** Keep Route Planner 2 isolated from legacy Route Planner and fixed-route schedule import logic. Add a Route Planner 2-specific GTFS adapter that converts GTFS route patterns into local editable scenarios; the UI only fetches/selects/imports these patterns and then uses existing Route Planner 2 authoring/editing flows.

**Tech Stack:** React, TypeScript, Vite, Vitest, existing `/api/gtfs` proxy, Mapbox/react-map-gl, Route Planner 2 local state.

---

## Product boundary

This is **GTFS-based template import**, not GTFS editing.

In scope:
- Fetch Barrie GTFS through the existing GTFS proxy.
- Include `shapes.txt` data in the proxy response.
- List route patterns by route, service/day, direction, shape, and stop count.
- Import a chosen pattern as a new Route Planner 2 route/scenario.
- Add all stops from GTFS stop_times/stops.
- Draw the route line from GTFS shape points.
- Keep imported route editable with existing stop/line tools.

Out of scope:
- Saving Route Planner 2 projects to Firebase.
- Publishing back to GTFS.
- Fixed-route schedule draft creation.
- Reusing legacy Route Planner controllers/services.
- Changing locked schedule generation, parsing, block, or time logic.

## PM Quick Check

- Core workflow: ✓ Supports planning concept creation/editing before schedule work.
- Draft→Publish: ✓ Local Route Planner 2 route only; no master schedule writes.
- Locked logic: ✓ Does not touch schedule generator, block assignment, fixed-route parser timing, or ScheduleEditor.
- Scope: ✓ Focused on Barrie planner need: start from an existing route and edit off it.
- Escalation: No full PM review needed unless implementation expands into Firebase persistence or fixed-route schedule import.

## File structure

### Create

- `utils/route-planner-2/routePlanner2GtfsImport.ts`
  - Pure GTFS-to-Route-Planner-2 adapter.
  - Groups trips into importable patterns.
  - Converts one selected pattern into a `RoutePlanner2Scenario`.
  - Simplifies GTFS shape points for editable waypoints.

- `utils/route-planner-2/routePlanner2GtfsClient.ts`
  - Fetches GTFS from `/api/gtfs?includeShapes=true`.
  - Converts network errors into UI-friendly messages.
  - Keeps API fetching out of the workspace component.

- `components/Analytics/route-planner-2/RoutePlanner2GtfsImportModal.tsx`
  - Route/pattern picker modal.
  - Shows route, day/service, direction/headsign, stop count, shape point count, and trip count.
  - Calls `onImport(patternId)`.

- `tests/routePlanner2GtfsImport.test.ts`
  - Unit tests for pattern grouping and scenario conversion.

- `tests/RoutePlanner2GtfsImportModal.test.tsx`
  - Component tests for loading, selecting, importing, and error states.

### Modify

- `utils/route-planner-2/routePlanner2Types.ts`
  - Add optional scenario source metadata for imported GTFS routes.

- `utils/route-planner-2/routePlanner2ProjectController.ts`
  - Add `importRoutePlanner2Scenario(project, scenario, now)`.

- `components/Analytics/RoutePlanner2Workspace.tsx`
  - Add Import GTFS button.
  - Open modal.
  - Add imported scenario into project state.

- `components/Analytics/route-planner-2/RoutePlanner2MapCanvas.tsx`
  - Ensure imported alignment waypoints render/edit correctly.
  - Do not add special GTFS-only map behavior unless required.

- `api/gtfs.ts`
  - Add optional `includeShapes=true` support.
  - Include parsed `shapes` array only when requested.

- `vite.config.ts`
  - Mirror the `/api/gtfs?includeShapes=true` local dev behavior by parsing and returning shapes.

- `docs/route-planner-2/README.md`
  - Note that GTFS import is an editable template capability.

- `docs/route-planner-2/01-product-brief.md`
  - Update non-goal wording: GTFS editing remains out of scope; GTFS template import is allowed.

- `docs/route-planner-2/02-user-workflows.md`
  - Add imported-route workflow.

- `docs/route-planner-2/04-architecture.md`
  - Add GTFS adapter boundary.

- `docs/route-planner-2/05-data-model.md`
  - Add optional `source` metadata to scenario.

- `docs/route-planner-2/07-test-strategy.md`
  - Add GTFS import tests/manual QA.

---

## Task 1: Document the Route Planner 2 GTFS import boundary

**Files:**
- Modify: `docs/route-planner-2/README.md`
- Modify: `docs/route-planner-2/01-product-brief.md`
- Modify: `docs/route-planner-2/02-user-workflows.md`
- Modify: `docs/route-planner-2/04-architecture.md`
- Modify: `docs/route-planner-2/05-data-model.md`
- Modify: `docs/route-planner-2/07-test-strategy.md`

- [ ] **Step 1: Update README scope summary**

Add this under the V1 Scope Summary `In scope` list:

```markdown
- importing an existing GTFS bus route as an editable local route concept template
```

Add this under `Out of scope for v1`:

```markdown
- editing, publishing, or exporting GTFS feeds; imported GTFS routes are editable planning copies only
```

- [ ] **Step 2: Update product brief non-goals**

Replace the current non-goal line:

```markdown
- GTFS editing
```

with:

```markdown
- GTFS feed editing or publishing; Route Planner 2 may import GTFS routes as local editable planning templates
```

- [ ] **Step 3: Add user workflow**

Add this section to `02-user-workflows.md` after the primary blank-route workflow:

```markdown
## Imported GTFS Route Workflow

A planner can start from an existing GTFS route instead of a blank concept.

1. Open Route Planner 2.
2. Click **Import GTFS route**.
3. Select a route and pattern.
4. Import it as a new editable route concept.
5. Review the imported route line and stop sequence.
6. Move, remove, add, or rename stops as needed.
7. Adjust route line waypoints if the concept changes.
8. Enter service assumptions and review feasibility.

Imported GTFS routes are local planning copies. Editing them does not change the GTFS feed or create a fixed-route schedule draft.
```

- [ ] **Step 4: Add architecture boundary**

Add this to `04-architecture.md` under Suggested Module Slices:

```markdown
### GTFS Template Import Adapter

Owns conversion from GTFS route patterns into Route Planner 2 scenarios.

Responsibilities:
- fetch or receive parsed GTFS feed data
- group trips into selectable route patterns
- convert GTFS stops into Route Planner 2 stops
- convert GTFS shapes into editable route-line waypoints
- attach source metadata so imported concepts are clearly labelled

Rules:
- do not create fixed-route schedule drafts
- do not modify GTFS feeds
- do not import old Route Planner controllers or services
```

- [ ] **Step 5: Add scenario source metadata docs**

Add this type to `05-data-model.md` near `RoutePlanner2Scenario`:

```typescript
interface RoutePlanner2ScenarioSource {
  type: 'blank' | 'gtfs';
  routeId?: string;
  routeShortName?: string;
  routeLongName?: string;
  serviceId?: string;
  directionId?: number;
  tripHeadsign?: string;
  shapeId?: string;
  feedVersion?: string;
  importedAt?: string;
}
```

Add this field to the scenario interface:

```typescript
source?: RoutePlanner2ScenarioSource;
```

- [ ] **Step 6: Add test strategy entry**

Add this to `07-test-strategy.md` under Unit Tests:

```markdown
- GTFS route pattern grouping
- GTFS pattern to editable route scenario conversion
- imported stop ordering and terminal role assignment
- imported shape simplification and waypoint ownership
```

Add this to Manual QA Checklist:

```markdown
- importing a GTFS route creates a new route concept with line and all stops
- imported stops can still be moved, renamed, reordered, and deleted
- imported route line can still be edited with bend anchors
- UI clearly says the import is a local planning copy, not GTFS editing
```

- [ ] **Step 7: Commit docs**

Run:

```powershell
git add docs/route-planner-2
git commit -m "docs: define route planner 2 gtfs import boundary"
```

---

## Task 2: Add GTFS shapes to the existing proxy response

**Files:**
- Modify: `api/gtfs.ts`
- Modify: `vite.config.ts`
- Test: existing API behavior through targeted build/type checks

- [ ] **Step 1: Update `api/gtfs.ts` response shape**

Add a parsed `shapes` field only when `includeShapes=true` is supplied.

Expected shape item:

```typescript
{
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
  shape_dist_traveled?: number;
}
```

Implementation details:
- Read `const includeShapes = req.query.includeShapes === 'true';`
- Keep `shapes.txt` optional unless `includeShapes=true`.
- If `includeShapes=true` and `shapes.txt` is missing, return `shapes: []` rather than failing the whole feed.
- Include `shape_dist_traveled` when present.

- [ ] **Step 2: Mirror local dev behavior in `vite.config.ts`**

In the existing `/api/gtfs` dev middleware:
- Parse `includeShapes` from `urlParams`.
- Add `shape_id` to parsed trips if missing today.
- Add parsed `shapes` to `feed` only when requested.

Required parsed trip field:

```typescript
shape_id: t.shape_id,
```

Required shape parsing:

```typescript
shapes: includeShapes && normalizedFiles.has('shapes.txt')
  ? parseGtfsCsv(normalizedFiles.get('shapes.txt')!).map(s => ({
      shape_id: s.shape_id,
      shape_pt_lat: parseFloat(s.shape_pt_lat) || 0,
      shape_pt_lon: parseFloat(s.shape_pt_lon) || 0,
      shape_pt_sequence: parseInt(s.shape_pt_sequence) || 0,
      shape_dist_traveled: s.shape_dist_traveled ? parseFloat(s.shape_dist_traveled) : undefined,
    }))
  : undefined,
```

- [ ] **Step 3: Run build check**

Run:

```powershell
npm run build
```

Expected: build completes. Bundle size warnings are acceptable if unchanged.

- [ ] **Step 4: Commit API support**

Run:

```powershell
git add api/gtfs.ts vite.config.ts
git commit -m "feat: include gtfs shapes for route planner imports"
```

---

## Task 3: Add Route Planner 2 GTFS import types and pure adapter

**Files:**
- Modify: `utils/route-planner-2/routePlanner2Types.ts`
- Create: `utils/route-planner-2/routePlanner2GtfsImport.ts`
- Create: `tests/routePlanner2GtfsImport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/routePlanner2GtfsImport.test.ts` with tests for:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildRoutePlanner2GtfsImportPatterns,
  createRoutePlanner2ScenarioFromGtfsPattern,
  simplifyRoutePlanner2GtfsShapePoints,
} from '../utils/route-planner-2/routePlanner2GtfsImport';

const feed = {
  routes: [{ route_id: '8A', route_short_name: '8A', route_long_name: 'RVH/Yonge', route_type: 3, route_color: '00AEEF' }],
  stops: [
    { stop_id: 's1', stop_code: '1001', stop_name: 'Terminal A', stop_lat: 44.37, stop_lon: -79.70 },
    { stop_id: 's2', stop_code: '1002', stop_name: 'Main Street', stop_lat: 44.38, stop_lon: -79.69 },
    { stop_id: 's3', stop_code: '1003', stop_name: 'Terminal B', stop_lat: 44.39, stop_lon: -79.68 },
  ],
  trips: [
    { route_id: '8A', service_id: 'weekday', trip_id: 't1', trip_headsign: 'To Terminal B', direction_id: 0, shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't2', trip_headsign: 'To Terminal B', direction_id: 0, shape_id: 'shape-8a-a' },
  ],
  stopTimes: [
    { trip_id: 't1', arrival_time: '06:00:00', departure_time: '06:00:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't1', arrival_time: '06:05:00', departure_time: '06:05:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't1', arrival_time: '06:12:00', departure_time: '06:12:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't2', arrival_time: '06:30:00', departure_time: '06:30:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't2', arrival_time: '06:35:00', departure_time: '06:35:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't2', arrival_time: '06:42:00', departure_time: '06:42:00', stop_id: 's3', stop_sequence: 3 },
  ],
  calendar: [{ service_id: 'weekday', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0, start_date: '20260101', end_date: '20261231' }],
  calendarDates: [],
  shapes: [
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.37, shape_pt_lon: -79.70, shape_pt_sequence: 1 },
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.375, shape_pt_lon: -79.695, shape_pt_sequence: 2 },
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.38, shape_pt_lon: -79.69, shape_pt_sequence: 3 },
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.39, shape_pt_lon: -79.68, shape_pt_sequence: 4 },
  ],
  agency: [],
};

describe('routePlanner2GtfsImport', () => {
  it('groups trips into selectable GTFS import patterns', () => {
    const patterns = buildRoutePlanner2GtfsImportPatterns(feed);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      routeId: '8A',
      routeShortName: '8A',
      serviceId: 'weekday',
      directionId: 0,
      shapeId: 'shape-8a-a',
      tripCount: 2,
      stopCount: 3,
    });
  });

  it('creates an editable Route Planner 2 scenario from a GTFS pattern', () => {
    const pattern = buildRoutePlanner2GtfsImportPatterns(feed)[0];
    const scenario = createRoutePlanner2ScenarioFromGtfsPattern(pattern, { id: 'scenario-imported', now: '2026-05-01T12:00:00.000Z' });
    expect(scenario.name).toBe('Route 8A - To Terminal B');
    expect(scenario.source?.type).toBe('gtfs');
    expect(scenario.stops.map(stop => stop.name)).toEqual(['Terminal A', 'Main Street', 'Terminal B']);
    expect(scenario.stops[0].role).toBe('start-terminal');
    expect(scenario.stops[2].role).toBe('end-terminal');
    expect(scenario.stops.every(stop => stop.source === 'barrie-stop')).toBe(true);
    expect(scenario.alignment.length).toBeGreaterThan(0);
  });

  it('simplifies dense shape points while preserving endpoints', () => {
    const dense = Array.from({ length: 80 }, (_, index) => ({ lat: 44 + index * 0.001, lng: -79 - index * 0.001, sequence: index + 1 }));
    const simplified = simplifyRoutePlanner2GtfsShapePoints(dense, 20);
    expect(simplified.length).toBeLessThanOrEqual(20);
    expect(simplified[0]).toEqual(dense[0]);
    expect(simplified[simplified.length - 1]).toEqual(dense[dense.length - 1]);
  });
});
```

Run:

```powershell
npx vitest run tests/routePlanner2GtfsImport.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 2: Add source metadata type**

In `routePlanner2Types.ts`, add:

```typescript
export interface RoutePlanner2ScenarioSource {
    type: 'blank' | 'gtfs';
    routeId?: string;
    routeShortName?: string;
    routeLongName?: string;
    serviceId?: string;
    directionId?: number;
    tripHeadsign?: string;
    shapeId?: string;
    feedVersion?: string;
    importedAt?: string;
}
```

Add to `RoutePlanner2Scenario`:

```typescript
source?: RoutePlanner2ScenarioSource;
```

- [ ] **Step 3: Implement the pure adapter**

Create `utils/route-planner-2/routePlanner2GtfsImport.ts` exporting:

```typescript
export interface RoutePlanner2GtfsImportPattern
export interface RoutePlanner2GtfsImportFeed
export function buildRoutePlanner2GtfsImportPatterns(feed: RoutePlanner2GtfsImportFeed): RoutePlanner2GtfsImportPattern[]
export function simplifyRoutePlanner2GtfsShapePoints(points: RoutePlanner2GtfsShapePoint[], maxPoints?: number): RoutePlanner2GtfsShapePoint[]
export function createRoutePlanner2ScenarioFromGtfsPattern(pattern: RoutePlanner2GtfsImportPattern, options?: { id?: string; now?: string }): RoutePlanner2Scenario
```

Implementation rules:
- Group by `route_id | service_id | direction_id | shape_id | ordered stop IDs`.
- Pick the earliest trip in each group as the stop-order source.
- Stop order comes from sorted `stop_sequence`.
- First stop role is `start-terminal`.
- Last stop role is `end-terminal`.
- Stop source is `barrie-stop`.
- `stopCode` uses GTFS `stop_code`.
- Shape points are sorted by `shape_pt_sequence`.
- Simplification preserves first/last point and caps default waypoint count at 60.
- Alignment points should be route-line waypoints, not stops.
- Alignment point IDs should be stable within one import, e.g. `gtfs-shape-${shapeId}-${index + 1}`.
- Scenario name should be `Route ${routeShortName} - ${tripHeadsign}` when headsign exists, otherwise `Route ${routeShortName}`.
- Scenario `notes` should say: `Imported from GTFS as an editable planning copy. Changes here do not modify the GTFS feed.`

- [ ] **Step 4: Run adapter tests**

Run:

```powershell
npx vitest run tests/routePlanner2GtfsImport.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit adapter**

Run:

```powershell
git add utils/route-planner-2/routePlanner2Types.ts utils/route-planner-2/routePlanner2GtfsImport.ts tests/routePlanner2GtfsImport.test.ts
git commit -m "feat: convert gtfs patterns to route planner concepts"
```

---

## Task 4: Add GTFS client fetch wrapper

**Files:**
- Create: `utils/route-planner-2/routePlanner2GtfsClient.ts`
- Test: `tests/routePlanner2GtfsImport.test.ts` or new small client test if fetch mocking is straightforward

- [ ] **Step 1: Implement fetch wrapper**

Create `routePlanner2GtfsClient.ts`:

```typescript
import { buildRoutePlanner2GtfsImportPatterns, type RoutePlanner2GtfsImportPattern } from './routePlanner2GtfsImport';

export interface LoadRoutePlanner2GtfsPatternsOptions {
    feedUrl?: string;
    fetchImpl?: typeof fetch;
}

export async function loadRoutePlanner2GtfsImportPatterns(
    options: LoadRoutePlanner2GtfsPatternsOptions = {},
): Promise<RoutePlanner2GtfsImportPattern[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const params = new URLSearchParams({ includeShapes: 'true' });
    if (options.feedUrl) params.set('url', options.feedUrl);

    const response = await fetchImpl(`/api/gtfs?${params.toString()}`);
    if (!response.ok) {
        throw new Error('GTFS routes could not be loaded. Please try again.');
    }

    const feed = await response.json();
    return buildRoutePlanner2GtfsImportPatterns(feed);
}
```

- [ ] **Step 2: Add client test if practical**

Add to `tests/routePlanner2GtfsImport.test.ts`:

```typescript
it('loads GTFS patterns through the proxy client', async () => {
  const { loadRoutePlanner2GtfsImportPatterns } = await import('../utils/route-planner-2/routePlanner2GtfsClient');
  const calls: string[] = [];
  const patterns = await loadRoutePlanner2GtfsImportPatterns({
    fetchImpl: (async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => feed } as Response;
    }) as typeof fetch,
  });
  expect(calls[0]).toContain('/api/gtfs?includeShapes=true');
  expect(patterns).toHaveLength(1);
});
```

- [ ] **Step 3: Run tests**

Run:

```powershell
npx vitest run tests/routePlanner2GtfsImport.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit client wrapper**

Run:

```powershell
git add utils/route-planner-2/routePlanner2GtfsClient.ts tests/routePlanner2GtfsImport.test.ts
git commit -m "feat: load route planner gtfs import patterns"
```

---

## Task 5: Add project controller import operation

**Files:**
- Modify: `utils/route-planner-2/routePlanner2ProjectController.ts`
- Modify: `tests/routePlanner2ProjectController.test.ts`

- [ ] **Step 1: Add failing controller test**

Add a test that creates a project, imports a prepared scenario, and verifies:
- scenarios length increases by one
- selectedScenarioId becomes imported scenario ID
- project status is `local-draft`
- imported scenario source remains `gtfs`

Suggested test body:

```typescript
it('imports a GTFS scenario and selects it', () => {
  const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-01T12:00:00.000Z' });
  const imported = createRoutePlanner2Scenario({ id: 'scenario-gtfs', name: 'Route 8A', now: '2026-05-01T12:01:00.000Z' });
  const result = importRoutePlanner2Scenario(project, { ...imported, source: { type: 'gtfs', routeId: '8A' } }, '2026-05-01T12:02:00.000Z');

  expect(result.scenarios).toHaveLength(2);
  expect(result.selectedScenarioId).toBe('scenario-gtfs');
  expect(result.status).toBe('local-draft');
  expect(result.scenarios[1].source?.type).toBe('gtfs');
});
```

Run:

```powershell
npx vitest run tests/routePlanner2ProjectController.test.ts
```

Expected: fails because `importRoutePlanner2Scenario` does not exist.

- [ ] **Step 2: Implement controller function**

Add to `routePlanner2ProjectController.ts`:

```typescript
export function importRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    scenario: RoutePlanner2Scenario,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (project.scenarios.some((existing) => existing.id === scenario.id)) return project;

    return markChanged({
        ...project,
        selectedScenarioId: scenario.id,
        scenarios: [...project.scenarios, { ...scenario, updatedAt: now }],
    }, now);
}
```

- [ ] **Step 3: Run controller tests**

Run:

```powershell
npx vitest run tests/routePlanner2ProjectController.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit controller change**

Run:

```powershell
git add utils/route-planner-2/routePlanner2ProjectController.ts tests/routePlanner2ProjectController.test.ts
git commit -m "feat: import route planner scenarios"
```

---

## Task 6: Add GTFS import modal UI

**Files:**
- Create: `components/Analytics/route-planner-2/RoutePlanner2GtfsImportModal.tsx`
- Create: `tests/RoutePlanner2GtfsImportModal.test.tsx`

- [ ] **Step 1: Write modal tests**

Tests should verify:
- loading state appears
- route/pattern options render after load
- import button is disabled until a pattern is selected
- import calls `onImport` with selected pattern
- cancel calls `onClose`
- error state appears when load fails

Expected labels:
- modal heading: `Import GTFS route`
- helper text: `This creates an editable planning copy. It does not modify GTFS.`
- button: `Import as editable route`

Run:

```powershell
npx vitest run tests/RoutePlanner2GtfsImportModal.test.tsx
```

Expected: fails because component does not exist.

- [ ] **Step 2: Implement modal component**

Component props:

```typescript
interface RoutePlanner2GtfsImportModalProps {
    open: boolean;
    patterns: RoutePlanner2GtfsImportPattern[];
    loading: boolean;
    error: string | null;
    onClose: () => void;
    onImport: (pattern: RoutePlanner2GtfsImportPattern) => void;
    onRetry: () => void;
}
```

UI rules:
- Return `null` when `open` is false.
- Show route pattern cards grouped/sorted by route short name, then headsign, then service ID.
- Each card shows: route, headsign or direction, service ID, trip count, stop count.
- Selecting a card enables import.
- Use Scheduler-friendly rounded white panel styling.
- Avoid implying save/publish.

- [ ] **Step 3: Run modal tests**

Run:

```powershell
npx vitest run tests/RoutePlanner2GtfsImportModal.test.tsx
```

Expected: pass.

- [ ] **Step 4: Commit modal**

Run:

```powershell
git add components/Analytics/route-planner-2/RoutePlanner2GtfsImportModal.tsx tests/RoutePlanner2GtfsImportModal.test.tsx
git commit -m "feat: add route planner gtfs import modal"
```

---

## Task 7: Wire import into Route Planner 2 workspace

**Files:**
- Modify: `components/Analytics/RoutePlanner2Workspace.tsx`
- Modify: `tests/RoutePlanner2Workspace.localState.test.tsx`

- [ ] **Step 1: Add workspace test**

Test expected behavior:
- workspace renders `Import GTFS` button
- clicking it opens the modal
- successful import adds/selects a new route card

Mock `loadRoutePlanner2GtfsImportPatterns` to return one pattern and mock `createRoutePlanner2ScenarioFromGtfsPattern` only if needed.

Run:

```powershell
npx vitest run tests/RoutePlanner2Workspace.localState.test.tsx
```

Expected: fails because the button/modal is not wired.

- [ ] **Step 2: Import new helpers in workspace**

Add imports:

```typescript
import { BusFront } from 'lucide-react';
import { RoutePlanner2GtfsImportModal } from './route-planner-2/RoutePlanner2GtfsImportModal';
import { loadRoutePlanner2GtfsImportPatterns } from '../../utils/route-planner-2/routePlanner2GtfsClient';
import { createRoutePlanner2ScenarioFromGtfsPattern, type RoutePlanner2GtfsImportPattern } from '../../utils/route-planner-2/routePlanner2GtfsImport';
import { importRoutePlanner2Scenario } from '../../utils/route-planner-2/routePlanner2ProjectController';
```

If `lucide-react` already has a better bus icon available, use it; otherwise use the existing `Route` icon.

- [ ] **Step 3: Add modal state**

Add state near existing workspace state:

```typescript
const [isGtfsImportOpen, setIsGtfsImportOpen] = useState(false);
const [gtfsPatterns, setGtfsPatterns] = useState<RoutePlanner2GtfsImportPattern[]>([]);
const [gtfsLoading, setGtfsLoading] = useState(false);
const [gtfsError, setGtfsError] = useState<string | null>(null);
```

- [ ] **Step 4: Add load function**

Add:

```typescript
async function loadGtfsPatterns() {
    setGtfsLoading(true);
    setGtfsError(null);
    try {
        const patterns = await loadRoutePlanner2GtfsImportPatterns();
        setGtfsPatterns(patterns);
    } catch (error) {
        setGtfsError(error instanceof Error ? error.message : 'GTFS routes could not be loaded.');
    } finally {
        setGtfsLoading(false);
    }
}
```

- [ ] **Step 5: Add open/import handlers**

Add:

```typescript
function openGtfsImport() {
    setIsGtfsImportOpen(true);
    if (gtfsPatterns.length === 0 && !gtfsLoading) void loadGtfsPatterns();
}

function importGtfsPattern(pattern: RoutePlanner2GtfsImportPattern) {
    const scenario = createRoutePlanner2ScenarioFromGtfsPattern(pattern);
    setProject((current) => importRoutePlanner2Scenario(current, scenario));
    setSelectedStopId(scenario.stops[0]?.id ?? null);
    setIsRightRailOpen(true);
    setIsDrawFocusMode(false);
    setIsGtfsImportOpen(false);
}
```

- [ ] **Step 6: Add header button**

Add near existing `Add route` / header actions:

```tsx
<button
    type="button"
    onClick={openGtfsImport}
    className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-bold text-cyan-800"
>
    <Route size={16} />Import GTFS
</button>
```

- [ ] **Step 7: Render modal**

Render near the bottom of workspace JSX:

```tsx
<RoutePlanner2GtfsImportModal
    open={isGtfsImportOpen}
    patterns={gtfsPatterns}
    loading={gtfsLoading}
    error={gtfsError}
    onClose={() => setIsGtfsImportOpen(false)}
    onImport={importGtfsPattern}
    onRetry={loadGtfsPatterns}
/>
```

- [ ] **Step 8: Run workspace tests**

Run:

```powershell
npx vitest run tests/RoutePlanner2Workspace.localState.test.tsx tests/RoutePlanner2GtfsImportModal.test.tsx
```

Expected: pass.

- [ ] **Step 9: Commit workspace wiring**

Run:

```powershell
git add components/Analytics/RoutePlanner2Workspace.tsx tests/RoutePlanner2Workspace.localState.test.tsx
git commit -m "feat: import gtfs routes into route planner workspace"
```

---

## Task 8: Verify imported route map behavior

**Files:**
- Modify only if tests reveal issues: `components/Analytics/route-planner-2/RoutePlanner2MapCanvas.tsx`
- Modify only if tests reveal issues: `utils/route-planner-2/routePlanner2Segments.ts`
- Test: existing map canvas tests plus manual browser check

- [ ] **Step 1: Run map/authoring tests**

Run:

```powershell
npx vitest run tests/RoutePlanner2MapCanvas.directionArrows.test.tsx tests/routePlanner2Authoring.test.ts tests/routePlanner2RoadSnap.test.ts
```

Expected: pass or reveal imported-alignment issue.

- [ ] **Step 2: Fix only specific issues**

If imported GTFS alignment does not render:
- inspect whether alignment points are unanchored general route points or segment-owned waypoints.
- Prefer fixing the adapter output over adding GTFS special cases to the map.

Expected behavior:
- The GTFS line is visible after import.
- Imported stop markers are visible.
- Stops can be dragged.
- Existing route-line bend-anchor logic still works after adding new anchors.

- [ ] **Step 3: Run targeted tests again**

Run:

```powershell
npx vitest run tests/RoutePlanner2MapCanvas.directionArrows.test.tsx tests/routePlanner2Authoring.test.ts tests/routePlanner2RoadSnap.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit any map fixes**

Run only if files changed:

```powershell
git add components/Analytics/route-planner-2/RoutePlanner2MapCanvas.tsx utils/route-planner-2/routePlanner2Segments.ts tests
git commit -m "fix: support imported gtfs route geometry editing"
```

---

## Task 9: Full verification and manual QA

**Files:**
- No planned code changes.

- [ ] **Step 1: Run Route Planner 2 tests**

Run:

```powershell
npx vitest run tests/routePlanner2*.test.ts tests/RoutePlanner2*.test.tsx
```

Expected: Route Planner 2 tests pass.

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: build passes. Existing chunk-size warnings are acceptable.

- [ ] **Step 3: Manual browser QA**

Run:

```powershell
npm run dev
```

Manual checks:
- Open Route Planner 2.
- Click `Import GTFS`.
- Confirm routes load.
- Import route `8A` or `400`.
- Confirm a new route card appears and is selected.
- Confirm the map shows the route line and all stops.
- Drag one stop.
- Rename one stop.
- Delete one stop.
- Add a bend anchor to the route line.
- Confirm feasibility warnings still make sense.
- Confirm UI says this is an editable planning copy, not GTFS editing.

- [ ] **Step 4: Update durable memory only if needed**

If implementation introduces a lasting architecture convention, update `ORCHESTRATOR.md` with one concise bullet:

```markdown
- Route Planner 2 can import GTFS route patterns as local editable planning-copy scenarios through `utils/route-planner-2/routePlanner2GtfsImport.ts`; this does not create fixed-route schedule drafts or edit GTFS feeds.
```

- [ ] **Step 5: Final commit**

Run:

```powershell
git status --short
git add docs/route-planner-2 ORCHESTRATOR.md
git commit -m "docs: record route planner gtfs import behavior"
```

Only commit docs/memory if changed.

---

## Risks and mitigations

- **Large GTFS response:** Only request shapes when importing. If loading feels slow, follow-up should add a compact `/api/gtfs-route-patterns` endpoint.
- **Routes with many shape variants:** Pattern picker must show headsign, direction, trip count, stop count, and shape ID so planners choose intentionally.
- **Too many editable waypoints:** Simplify shape points to a capped number and preserve stops separately.
- **Accidental schedule import coupling:** Do not call `gtfsImportService`, `saveDraft`, or fixed-route publish services.
- **Road snapping overriding GTFS geometry:** Prefer imported GTFS geometry as initial display. Existing Mapbox snapping can continue for changed stop-to-stop segments, but do not silently erase planner edits.

## Completion criteria

Done means:
- Route Planner 2 has an `Import GTFS` action.
- Planner can import an existing route pattern as a new editable route concept.
- The imported route includes a visible route line and all stops.
- Imported stops/line can be edited with existing tools.
- UI clearly says this is a planning copy.
- Targeted Route Planner 2 tests pass.
- Build passes.
- Route Planner 2 docs reflect the new boundary.
