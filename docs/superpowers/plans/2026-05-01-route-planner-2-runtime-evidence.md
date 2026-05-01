# Route Planner 2 Schedule + Observed Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Route Planner 2 runtime estimates from Mapbox/fallback-only estimates to planner-explainable travel times that blend scheduled GTFS runtimes with observed STREETS trip-stop runtimes.

**Architecture:** Add a Route Planner 2-specific runtime evidence adapter under `utils/route-planner-2/` that converts GTFS/corridor speed data into `RoutePlanner2SegmentRuntime` estimates. Keep Route Planner 2 isolated from legacy `utils/route-planner/` code and avoid fixed-route schedule generator logic. Manual planner overrides remain the highest-priority source, then observed/scheduled evidence, then Mapbox, then fallback.

**Tech Stack:** React 19, TypeScript, Vitest, existing GTFS corridor speed utilities, existing performance data hooks, local Route Planner 2 state.

---

## Complexity and Risk

- **Estimated effort:** 1 to 2 weeks.
- **Complexity:** Medium-high.
- **Main risk:** Stop matching quality. Custom map stops may not have stop codes, so coordinate/name matching must be disclosed and confidence-weighted.
- **Locked logic risk:** Low if this plan avoids `scheduleGenerator.ts`, `blockAssignmentCore.ts`, and parser changes. Runtime wording must stay clear that Route Planner 2 estimates are planning estimates, not generated fixed-route schedules.
- **Data risk:** Performance data may be absent for some teams/routes; scheduled proxy estimates should still work from bundled GTFS where stop matching succeeds.

## Source Priority Decision

Use this priority in Route Planner 2 feasibility:

1. manual segment override
2. observed/scheduled evidence adapter estimate
3. Mapbox estimate
4. distance fallback
5. missing/not-ready

This intentionally puts manual overrides first, because the existing Route Planner 2 contract says planner-entered overrides affect totals immediately and must not be overwritten by automatic recalculation.

## Files

### Create
- `utils/route-planner-2/routePlanner2StopMatching.ts` — match Route Planner 2 stops to GTFS stops by code, normalized name, then nearest coordinate.
- `utils/route-planner-2/routePlanner2RuntimeEvidence.ts` — convert corridor speed/schedule stats into Route Planner 2 segment runtime estimates.
- `tests/routePlanner2StopMatching.test.ts` — unit tests for stop-code, name, coordinate, and failed matches.
- `tests/routePlanner2RuntimeEvidence.test.ts` — unit tests for source priority, blend rules, missing-data fallback behavior, and path fingerprinting.

### Modify
- `utils/route-planner-2/routePlanner2Types.ts` — add scheduled/blended runtime source types and optional evidence details.
- `utils/route-planner-2/routePlanner2Authoring.ts` — prevent Mapbox/fallback updates from overwriting stronger evidence estimates.
- `utils/route-planner-2/routePlanner2Feasibility.ts` — accept scheduled/blended evidence as current estimates, update confidence and warnings.
- `components/Analytics/RoutePlanner2Workspace.tsx` — load performance data, build a corridor speed index, expose day/period controls, inject evidence estimates.
- `docs/route-planner-2/05-data-model.md` — document new source types and evidence details.
- `docs/route-planner-2/06-runtime-intelligence.md` — document new priority and blend rules.
- `tests/routePlanner2Feasibility.test.ts` — coverage for scheduled/blended confidence and warnings.
- `tests/routePlanner2Authoring.test.ts` — coverage for runtime estimate merge priority.
- `tests/RoutePlanner2Workspace.local.test.tsx` — basic UI coverage for day/period controls and source label display.

---

## Blend Rules

Segment evidence should be deterministic:

```ts
const OBSERVED_HIGH_SAMPLE_COUNT = 8;
const OBSERVED_BLEND_SAMPLE_COUNT = 3;

if (manualOverride) use manualOverride;
if (observedRuntime != null && observedSampleCount >= OBSERVED_HIGH_SAMPLE_COUNT && !lowConfidence) use observedRuntime;
if (scheduledRuntime != null && observedRuntime != null && observedSampleCount >= OBSERVED_BLEND_SAMPLE_COUNT) {
  use Math.round((scheduledRuntime * 0.65) + (observedRuntime * 0.35));
}
if (scheduledRuntime != null) use scheduledRuntime;
if (observedRuntime != null) use observedRuntime;
if (mapboxRuntime != null) use mapboxRuntime;
use fallbackRuntime;
```

Confidence rules:

```ts
if (source === 'observed-proxy' && sampleSize >= 8) confidence = 'high';
if (source === 'observed-scheduled-blend') confidence = 'medium';
if (source === 'scheduled-proxy') confidence = 'medium';
if (source === 'observed-proxy' && sampleSize < 8) confidence = 'medium';
if (source === 'fallback') confidence = 'low';
```

---

### Task 1: Update Route Planner 2 runtime data contract

**Files:**
- Modify: `utils/route-planner-2/routePlanner2Types.ts`
- Modify: `docs/route-planner-2/05-data-model.md`
- Modify: `docs/route-planner-2/06-runtime-intelligence.md`

- [ ] **Step 1: Extend runtime source types**

Change `RoutePlanner2RuntimeSource` to:

```ts
export type RoutePlanner2RuntimeSource =
    | 'observed-proxy'
    | 'observed-scheduled-blend'
    | 'scheduled-proxy'
    | 'manual'
    | 'mapbox'
    | 'fallback'
    | 'missing';
```

Add optional evidence fields to `RoutePlanner2SegmentRuntime`:

```ts
scheduledRuntimeMinutes?: number;
observedRuntimeMinutes?: number;
matchQuality?: 'exact-code' | 'name' | 'nearby' | 'unmatched';
matchedFromStopId?: string;
matchedToStopId?: string;
matchedRoutes?: string[];
```

- [ ] **Step 2: Document the source priority**

In `docs/route-planner-2/06-runtime-intelligence.md`, replace the current source priority list with:

```md
1. manual segment/runtime override if planner provided one
2. observed/scheduled runtime evidence for adjacent matched stops
3. Mapbox Directions estimate for the shaped stop-to-stop path
4. fallback estimate from distance or simple default speed
5. missing/not ready state
```

Add a short note:

```md
Manual overrides stay first because Route Planner 2 is a planning workspace. Automatic evidence can suggest better estimates, but it must not silently override planner-entered segment assumptions.
```

- [ ] **Step 3: Run type-focused tests**

Run:

```bash
npm test -- --run tests/routePlanner2Feasibility.test.ts tests/routePlanner2Authoring.test.ts
```

Expected: existing tests pass before behavior changes, or fail only where source exhaustiveness needs updates.

- [ ] **Step 4: Commit**

```bash
git add utils/route-planner-2/routePlanner2Types.ts docs/route-planner-2/05-data-model.md docs/route-planner-2/06-runtime-intelligence.md
git commit -m "docs: define route planner runtime evidence sources"
```

---

### Task 2: Add GTFS stop matching for Route Planner 2

**Files:**
- Create: `utils/route-planner-2/routePlanner2StopMatching.ts`
- Create: `tests/routePlanner2StopMatching.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/routePlanner2StopMatching.test.ts` with these cases:

```ts
import { describe, expect, it } from 'vitest';
import { matchRoutePlanner2StopToGtfsStop } from '../utils/route-planner-2/routePlanner2StopMatching';
import type { RoutePlanner2Stop } from '../utils/route-planner-2/routePlanner2Types';

const stop = (patch: Partial<RoutePlanner2Stop>): RoutePlanner2Stop => ({
  id: 'rp-stop-1',
  name: 'Downtown Terminal',
  lat: 44.389,
  lng: -79.69,
  sequence: 1,
  role: 'regular',
  source: 'custom',
  ...patch,
});

const gtfsStops = [
  { stop_id: '1000', stop_code: '1000', stop_name: 'Downtown Terminal', lat: 44.389, lon: -79.69 },
  { stop_id: '2000', stop_code: '2000', stop_name: 'Georgian College', lat: 44.412, lon: -79.668 },
];

describe('matchRoutePlanner2StopToGtfsStop', () => {
  it('matches by exact stop code first', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ stopCode: '2000', name: 'Different Label' }), gtfsStops);
    expect(match?.gtfsStopId).toBe('2000');
    expect(match?.quality).toBe('exact-code');
  });

  it('matches by normalized stop name when code is absent', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ name: 'downtown   terminal' }), gtfsStops);
    expect(match?.gtfsStopId).toBe('1000');
    expect(match?.quality).toBe('name');
  });

  it('matches by nearby coordinate within 100 metres', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ name: 'Planner Stop', lat: 44.3892, lng: -79.6902 }), gtfsStops);
    expect(match?.gtfsStopId).toBe('1000');
    expect(match?.quality).toBe('nearby');
  });

  it('returns null when no stop is close enough', () => {
    const match = matchRoutePlanner2StopToGtfsStop(stop({ name: 'Far Stop', lat: 44.6, lng: -79.9 }), gtfsStops);
    expect(match).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run tests/routePlanner2StopMatching.test.ts
```

Expected: fail because `routePlanner2StopMatching.ts` does not exist.

- [ ] **Step 3: Implement stop matching**

Create `utils/route-planner-2/routePlanner2StopMatching.ts`:

```ts
import { getAllStopsWithCoords, type GtfsStopWithCoords } from '../gtfs/gtfsStopLookup';
import type { RoutePlanner2Stop } from './routePlanner2Types';

export type RoutePlanner2StopMatchQuality = 'exact-code' | 'name' | 'nearby';

export interface RoutePlanner2GtfsStopMatch {
    routePlannerStopId: string;
    gtfsStopId: string;
    gtfsStopName: string;
    quality: RoutePlanner2StopMatchQuality;
    distanceMeters?: number;
}

const NEARBY_STOP_MAX_METERS = 100;
const EARTH_RADIUS_METERS = 6371000;

function normalize(value: string | undefined): string {
    return (value ?? '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lon: number }): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const dLat = toRadians(b.lat - a.lat);
    const dLon = toRadians(b.lon - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function matchRoutePlanner2StopToGtfsStop(
    stop: RoutePlanner2Stop,
    gtfsStops: readonly GtfsStopWithCoords[] = getAllStopsWithCoords(),
): RoutePlanner2GtfsStopMatch | null {
    const stopCode = normalize(stop.stopCode);
    if (stopCode) {
        const byCode = gtfsStops.find((gtfsStop) => normalize(gtfsStop.stop_id) === stopCode || normalize(gtfsStop.stop_code) === stopCode);
        if (byCode) {
            return { routePlannerStopId: stop.id, gtfsStopId: byCode.stop_id, gtfsStopName: byCode.stop_name, quality: 'exact-code' };
        }
    }

    const stopName = normalize(stop.name);
    if (stopName) {
        const byName = gtfsStops.find((gtfsStop) => normalize(gtfsStop.stop_name) === stopName);
        if (byName) {
            return { routePlannerStopId: stop.id, gtfsStopId: byName.stop_id, gtfsStopName: byName.stop_name, quality: 'name' };
        }
    }

    let best: { stop: GtfsStopWithCoords; meters: number } | null = null;
    for (const gtfsStop of gtfsStops) {
        const meters = distanceMeters(stop, gtfsStop);
        if (!best || meters < best.meters) best = { stop: gtfsStop, meters };
    }

    if (best && best.meters <= NEARBY_STOP_MAX_METERS) {
        return {
            routePlannerStopId: stop.id,
            gtfsStopId: best.stop.stop_id,
            gtfsStopName: best.stop.stop_name,
            quality: 'nearby',
            distanceMeters: Math.round(best.meters),
        };
    }

    return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- --run tests/routePlanner2StopMatching.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add utils/route-planner-2/routePlanner2StopMatching.ts tests/routePlanner2StopMatching.test.ts
git commit -m "feat: match route planner stops to gtfs stops"
```

---

### Task 3: Add scheduled + observed evidence resolver

**Files:**
- Create: `utils/route-planner-2/routePlanner2RuntimeEvidence.ts`
- Create: `tests/routePlanner2RuntimeEvidence.test.ts`

- [ ] **Step 1: Write failing tests for source selection**

Create tests that build a tiny fake corridor index with one segment and verify:

```ts
expect(resolveRoutePlanner2RuntimeEvidenceSegment({ scheduledRuntimeMin: 10, observedRuntimeMin: 14, sampleCount: 10, lowConfidence: false }).source).toBe('observed-proxy');
expect(resolveRoutePlanner2RuntimeEvidenceSegment({ scheduledRuntimeMin: 10, observedRuntimeMin: 16, sampleCount: 4, lowConfidence: false }).source).toBe('observed-scheduled-blend');
expect(resolveRoutePlanner2RuntimeEvidenceSegment({ scheduledRuntimeMin: 10, observedRuntimeMin: null, sampleCount: 0, lowConfidence: false }).source).toBe('scheduled-proxy');
expect(resolveRoutePlanner2RuntimeEvidenceSegment({ scheduledRuntimeMin: null, observedRuntimeMin: 13, sampleCount: 2, lowConfidence: true }).source).toBe('observed-proxy');
```

Also verify the blend value:

```ts
expect(resolveRoutePlanner2RuntimeEvidenceSegment({ scheduledRuntimeMin: 10, observedRuntimeMin: 16, sampleCount: 4, lowConfidence: false }).runtimeMinutes).toBe(12);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run tests/routePlanner2RuntimeEvidence.test.ts
```

Expected: fail because the resolver does not exist.

- [ ] **Step 3: Implement resolver**

Implement these exports in `routePlanner2RuntimeEvidence.ts`:

```ts
export interface RoutePlanner2RuntimeEvidenceInput {
    scheduledRuntimeMin: number | null;
    observedRuntimeMin: number | null;
    sampleCount: number;
    lowConfidence: boolean;
}

export function resolveRoutePlanner2RuntimeEvidenceSegment(input: RoutePlanner2RuntimeEvidenceInput): {
    runtimeMinutes: number;
    source: 'observed-proxy' | 'observed-scheduled-blend' | 'scheduled-proxy';
    confidence: 'high' | 'medium' | 'low' | 'missing';
} | null {
    const { scheduledRuntimeMin, observedRuntimeMin, sampleCount, lowConfidence } = input;
    if (observedRuntimeMin != null && sampleCount >= 8 && !lowConfidence) {
        return { runtimeMinutes: Math.round(observedRuntimeMin), source: 'observed-proxy', confidence: 'high' };
    }
    if (scheduledRuntimeMin != null && observedRuntimeMin != null && sampleCount >= 3) {
        return {
            runtimeMinutes: Math.round((scheduledRuntimeMin * 0.65) + (observedRuntimeMin * 0.35)),
            source: 'observed-scheduled-blend',
            confidence: 'medium',
        };
    }
    if (scheduledRuntimeMin != null) {
        return { runtimeMinutes: Math.round(scheduledRuntimeMin), source: 'scheduled-proxy', confidence: 'medium' };
    }
    if (observedRuntimeMin != null) {
        return { runtimeMinutes: Math.round(observedRuntimeMin), source: 'observed-proxy', confidence: 'medium' };
    }
    return null;
}
```

Then add `deriveRoutePlanner2EvidenceRuntimeEstimates(scenario, speedIndex, dayType, period)` that:

- builds current stop-to-stop segment paths from `buildRoutePlanner2StopSegmentPaths(scenario)`
- matches each Route Planner 2 stop to GTFS using `matchRoutePlanner2StopToGtfsStop`
- reads `CorridorSpeedStats` from `getStatsForPeriod(speedIndex, dayType, period)`
- returns estimates only for segments where both stops match and a corridor stat exists
- includes the current `pathFingerprint` on each estimate

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- --run tests/routePlanner2RuntimeEvidence.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add utils/route-planner-2/routePlanner2RuntimeEvidence.ts tests/routePlanner2RuntimeEvidence.test.ts
git commit -m "feat: resolve route planner runtime evidence"
```

---

### Task 4: Protect runtime estimate merge priority

**Files:**
- Modify: `utils/route-planner-2/routePlanner2Authoring.ts`
- Modify: `tests/routePlanner2Authoring.test.ts`

- [ ] **Step 1: Write failing merge-priority tests**

Add tests that verify:

```ts
// Evidence should replace Mapbox.
// Mapbox should not replace evidence with the same path fingerprint.
// Fallback should not replace Mapbox or evidence.
// A new path fingerprint should allow recalculated evidence to replace old evidence.
```

Use this expected priority:

```ts
const expectedPriority = {
  missing: 0,
  fallback: 1,
  mapbox: 2,
  'scheduled-proxy': 3,
  'observed-scheduled-blend': 4,
  'observed-proxy': 5,
  manual: 6,
};
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run tests/routePlanner2Authoring.test.ts
```

Expected: fail because current merge logic replaces by segment id without source priority.

- [ ] **Step 3: Implement priority-aware merging**

Add a helper near `segmentRuntimeChanged`:

```ts
const RUNTIME_SOURCE_PRIORITY: Record<RoutePlanner2SegmentRuntime['source'], number> = {
    missing: 0,
    fallback: 1,
    mapbox: 2,
    'scheduled-proxy': 3,
    'observed-scheduled-blend': 4,
    'observed-proxy': 5,
    manual: 6,
};

function shouldReplaceRuntimeEstimate(current: RoutePlanner2SegmentRuntime | undefined, next: RoutePlanner2SegmentRuntime): boolean {
    if (!current) return true;
    if (current.pathFingerprint && next.pathFingerprint && current.pathFingerprint !== next.pathFingerprint) return true;
    return RUNTIME_SOURCE_PRIORITY[next.source] >= RUNTIME_SOURCE_PRIORITY[current.source];
}
```

Use it inside `updateRoutePlanner2SegmentRuntimeEstimates` so lower-priority incoming estimates do not replace higher-priority current estimates.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- --run tests/routePlanner2Authoring.test.ts tests/routePlanner2RoadSnap.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add utils/route-planner-2/routePlanner2Authoring.ts tests/routePlanner2Authoring.test.ts
git commit -m "fix: preserve stronger route planner runtime evidence"
```

---

### Task 5: Teach feasibility about scheduled and blended evidence

**Files:**
- Modify: `utils/route-planner-2/routePlanner2Feasibility.ts`
- Modify: `tests/routePlanner2Feasibility.test.ts`

- [ ] **Step 1: Write failing feasibility tests**

Add tests for:

```ts
// scheduled-proxy segment contributes to segmentRuntimeMinutes.
// observed-scheduled-blend segment contributes to segmentRuntimeMinutes.
// fallback warning counts only fallback segments.
// confidence is high when all segments are observed-proxy with high confidence.
// confidence is medium when all segments are scheduled-proxy or observed-scheduled-blend.
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run tests/routePlanner2Feasibility.test.ts
```

Expected: fail on scheduled/blended source handling and confidence.

- [ ] **Step 3: Update current estimate acceptance**

In `estimateMatchesCurrentPath`, allow evidence sources with a matching `pathFingerprint`:

```ts
if (!estimate.pathFingerprint) {
    return estimate.source === 'manual' || estimate.source === 'observed-proxy';
}
return estimate.pathFingerprint === pathFingerprint;
```

Keep this rule, but make new evidence estimates include `pathFingerprint`. Do not add a no-fingerprint exception for `scheduled-proxy` or `observed-scheduled-blend`.

- [ ] **Step 4: Update confidence logic**

Use these rules in the return object:

```ts
const evidenceSegments = segmentSummaries.filter((segment) =>
    segment.source === 'observed-proxy'
    || segment.source === 'observed-scheduled-blend'
    || segment.source === 'scheduled-proxy'
);

const allEvidence = evidenceSegments.length === segmentSummaries.length && segmentSummaries.length > 0;
const allHighObserved = segmentSummaries.every((segment) => segment.source === 'observed-proxy' && segment.confidence === 'high');

const confidence = hasBlockingWarnings
    ? 'not-ready'
    : allHighObserved
        ? 'high'
        : allEvidence
            ? 'medium'
            : fallbackSegments.length > 0
                ? 'low'
                : segmentSummaries.some((segment) => segment.source === 'mapbox' || segment.source === 'manual')
                    ? 'medium'
                    : 'low';
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- --run tests/routePlanner2Feasibility.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add utils/route-planner-2/routePlanner2Feasibility.ts tests/routePlanner2Feasibility.test.ts
git commit -m "feat: include schedule evidence in route planner feasibility"
```

---

### Task 6: Wire evidence estimates into Route Planner 2 workspace

**Files:**
- Modify: `components/Analytics/RoutePlanner2Workspace.tsx`
- Modify: `tests/RoutePlanner2Workspace.local.test.tsx`

- [ ] **Step 1: Add imports**

Add:

```ts
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import { buildCorridorSpeedMapIndex } from '../../utils/gtfs/corridorSpeed';
import { DAY_TYPES, TIME_PERIODS, type DayType, type TimePeriod } from '../../utils/gtfs/corridorHeadway';
import { deriveRoutePlanner2EvidenceRuntimeEstimates } from '../../utils/route-planner-2/routePlanner2RuntimeEvidence';
```

- [ ] **Step 2: Add day and period state**

Inside `RoutePlanner2Workspace`:

```ts
const [runtimeDayType, setRuntimeDayType] = useState<DayType>('weekday');
const [runtimePeriod, setRuntimePeriod] = useState<TimePeriod>('full-day');
```

- [ ] **Step 3: Build speed index**

Use existing performance hooks:

```ts
const metadataQuery = usePerformanceMetadataQuery(teamId ?? undefined);
const hasPerformanceData = Boolean(metadataQuery.data);
const dataQuery = usePerformanceDataQuery(teamId ?? undefined, hasPerformanceData, metadataQuery.data);

const speedIndex = useMemo(() => {
    return buildCorridorSpeedMapIndex(dataQuery.data?.dailySummaries ?? []);
}, [dataQuery.data]);
```

- [ ] **Step 4: Inject evidence estimates**

Add an effect:

```ts
useEffect(() => {
    if (!selectedScenario || !speedIndex) return;
    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
        selectedScenario,
        speedIndex,
        runtimeDayType,
        runtimePeriod,
    );
    if (estimates.length === 0) return;
    setProject((current) => updateRoutePlanner2SegmentRuntimeEstimates(current, selectedScenario.id, estimates));
}, [runtimeDayType, runtimePeriod, selectedScenario, speedIndex]);
```

If the dependency on `selectedScenario` causes repeated updates, narrow it to stable fields:

```ts
selectedScenario?.id,
selectedScenario?.stops,
selectedScenario?.alignment,
selectedScenario?.routeShape,
selectedScenario?.turnaroundStopId,
selectedScenario?.service.planningPeriod,
```

- [ ] **Step 5: Add controls to Service assumptions**

Add selects beside the existing service fields:

```tsx
<label className="text-xs font-bold uppercase tracking-wide text-slate-500">
  Runtime day
  <select value={runtimeDayType} onChange={(event) => { const next = event.target.value as DayType; setRuntimeDayType(next); updateService({ dayType: next }); }} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
    {DAY_TYPES.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}
  </select>
</label>
<label className="text-xs font-bold uppercase tracking-wide text-slate-500">
  Runtime period
  <select value={runtimePeriod} onChange={(event) => { const next = event.target.value as TimePeriod; setRuntimePeriod(next); updateService({ planningPeriod: next === 'full-day' ? 'all-day' : next }); }} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
    {TIME_PERIODS.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
  </select>
</label>
```

- [ ] **Step 6: Update tests**

Add a workspace test that renders the controls and verifies labels exist:

```ts
expect(screen.getByLabelText(/Runtime day/i)).toBeInTheDocument();
expect(screen.getByLabelText(/Runtime period/i)).toBeInTheDocument();
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- --run tests/RoutePlanner2Workspace.local.test.tsx tests/routePlanner2RuntimeEvidence.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add components/Analytics/RoutePlanner2Workspace.tsx tests/RoutePlanner2Workspace.local.test.tsx
git commit -m "feat: apply schedule and observed evidence in route planner"
```

---

### Task 7: Improve segment disclosure in the UI

**Files:**
- Modify: `components/Analytics/RoutePlanner2Workspace.tsx`
- Modify: `tests/RoutePlanner2Workspace.local.test.tsx`

- [ ] **Step 1: Add source label helper**

Add near `confidenceDescription`:

```ts
function runtimeSourceLabel(source: RoutePlanner2SegmentRuntime['source']): string {
    if (source === 'observed-proxy') return 'Observed runtime';
    if (source === 'observed-scheduled-blend') return 'Observed + schedule blend';
    if (source === 'scheduled-proxy') return 'Scheduled runtime';
    if (source === 'mapbox') return 'Mapbox planning estimate';
    if (source === 'manual') return 'Planner override';
    if (source === 'fallback') return 'Distance fallback';
    return 'Missing runtime';
}
```

- [ ] **Step 2: Show evidence details**

In the segment runtime card, replace raw source text with:

```tsx
<span>{runtimeSourceLabel(segment.source)} / {segment.confidence}</span>
{segment.sampleSize != null && <span>{segment.sampleSize} samples</span>}
{segment.scheduledRuntimeMinutes != null && <span>Scheduled {segment.scheduledRuntimeMinutes} min</span>}
{segment.observedRuntimeMinutes != null && <span>Observed {segment.observedRuntimeMinutes} min</span>}
{segment.matchQuality && <span>Match: {segment.matchQuality}</span>}
```

- [ ] **Step 3: Run component test**

Run:

```bash
npm test -- --run tests/RoutePlanner2Workspace.local.test.tsx
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add components/Analytics/RoutePlanner2Workspace.tsx tests/RoutePlanner2Workspace.local.test.tsx
git commit -m "feat: disclose route planner runtime evidence"
```

---

### Task 8: Final verification and docs review

**Files:**
- Modify if needed: `docs/route-planner-2/05-data-model.md`
- Modify if needed: `docs/route-planner-2/06-runtime-intelligence.md`
- Modify if durable repo memory changed: `ORCHESTRATOR.md`

- [ ] **Step 1: Run focused tests**

```bash
npm test -- --run tests/routePlanner2StopMatching.test.ts tests/routePlanner2RuntimeEvidence.test.ts tests/routePlanner2Authoring.test.ts tests/routePlanner2Feasibility.test.ts tests/RoutePlanner2Workspace.local.test.tsx tests/routePlanner2Isolation.test.ts
```

Expected: pass.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: build succeeds. Existing bundle-size warnings are acceptable.

- [ ] **Step 3: Manual QA**

Run:

```bash
npm run dev
```

Open Route Planner 2 and verify:

- Day and period selectors are visible.
- A route using existing Barrie stops shows scheduled or observed runtime source labels.
- Manual segment override still changes totals immediately.
- Mapbox recalculation does not replace observed/scheduled estimates for matched segments.
- Segments without matches still fall back to Mapbox or distance.
- Warnings identify fallback segments.

- [ ] **Step 4: PM quick check**

Record this in the implementation handoff:

```md
PM Quick Check:
- Core workflow: Supports planning analysis before schedule creation.
- Draft→Publish: Does not edit master schedules.
- Locked logic: Avoids schedule generation, block assignment, and parser behavior.
- Scope: Focused on Route Planner 2 runtime estimation only.
```

- [ ] **Step 5: Commit final doc updates**

```bash
git add docs/route-planner-2/05-data-model.md docs/route-planner-2/06-runtime-intelligence.md ORCHESTRATOR.md
git commit -m "docs: document route planner runtime evidence workflow"
```

---

## Implementation Notes

- Do not import `utils/route-planner/routePlannerObservedRuntime.ts` into Route Planner 2. Use it only as reference while implementing the isolated Route Planner 2 adapter.
- Do not import or reuse `utils/schedule/scheduleGenerator.ts` for this feature.
- Keep terminal layover/recovery separate from stop-to-stop travel time.
- Preserve the existing per-segment rounding behavior in Route Planner 2 totals: segment estimates are rounded before summing.
- Use `full-day` when bridging to `utils/gtfs/corridorHeadway.ts`; use `all-day` only in the Route Planner 2 service model if keeping the current docs wording.

## Self-Review

- Spec coverage: Covers scheduled runtimes, observed data, blending, confidence, source disclosure, fallback behavior, and manual override priority.
- Placeholder scan: No placeholder or unspecified implementation tasks remain.
- Type consistency: Source names are `observed-proxy`, `observed-scheduled-blend`, `scheduled-proxy`, `manual`, `mapbox`, `fallback`, and `missing` across types, tests, UI, and docs.



