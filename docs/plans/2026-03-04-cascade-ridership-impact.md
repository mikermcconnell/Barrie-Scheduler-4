# Cascade Ridership Impact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show actual observed APC boardings (not period averages) at late stops in cascade analysis.

**Architecture:** Add `boardings` field to `CascadeTimepointObs`, populate from raw STREETS records in the cascade computer, sum in the slide-over UI. Minimal schema change — data already available at construction site.

**Tech Stack:** TypeScript, React (existing components)

---

### Task 1: Add `boardings` field to CascadeTimepointObs types

**Files:**
- Modify: `utils/performanceDataTypes.ts:132-140`
- Modify: `functions/src/types.ts:127-135`

**Step 1: Add field to client-side type**

In `utils/performanceDataTypes.ts`, add `boardings` after `isLate`:

```typescript
export interface CascadeTimepointObs {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  scheduledDeparture: string;
  observedDeparture: string | null;
  deviationSeconds: number | null;
  isLate: boolean;
  boardings: number;              // observed APC boardings at this stop
}
```

**Step 2: Mirror in functions type**

In `functions/src/types.ts`, same change to `CascadeTimepointObs`.

**Step 3: Commit**

```bash
git add utils/performanceDataTypes.ts functions/src/types.ts
git commit -m "feat(types): add boardings to CascadeTimepointObs"
```

---

### Task 2: Populate boardings in client-side cascade computer

**Files:**
- Modify: `utils/schedule/dwellCascadeComputer.ts` (two `timepoints.push()` sites at ~lines 216 and 234)

Add `boardings: rec.boardings` to both push calls. The `rec` variable is a `STREETSRecord` which already has `.boardings`.

**Step 1: Run existing tests first**

```bash
npx vitest run tests/dwellCascadeComputer.test.ts
```

**Step 2: Add `boardings: rec.boardings` to both timepoints.push() calls**

**Step 3: Run tests again — fix any shape assertion failures by adding `boardings` expectation**

**Step 4: Commit**

```bash
git add utils/schedule/dwellCascadeComputer.ts
git commit -m "feat(cascade): populate boardings from STREETS records"
```

---

### Task 3: Mirror boardings population in functions-side cascade computer

**Files:**
- Modify: `functions/src/dwellCascadeComputer.ts` (two push sites at ~lines 206 and 224)

Same change as Task 2. Add `boardings: rec.boardings` to both `timepoints.push()` calls.

**Step 1: Apply changes**

**Step 2: Commit**

```bash
git add functions/src/dwellCascadeComputer.ts
git commit -m "feat(functions): populate boardings in cascade computer"
```

---

### Task 4: Update tests to verify boardings field

**Files:**
- Modify: `tests/dwellCascadeComputer.test.ts`

Test fixtures already set `boardings: 2` on the base STREETS record (line 23).

**Step 1: Add boarding assertion to an existing test that checks timepoints**

```typescript
expect(tp.boardings).toBe(2);
```

**Step 2: Run tests**

```bash
npx vitest run tests/dwellCascadeComputer.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add tests/dwellCascadeComputer.test.ts
git commit -m "test: verify boardings field in cascade timepoints"
```

---

### Task 5: Rewrite customerImpact memo to use actual boardings

**Files:**
- Modify: `components/Performance/CascadeStorySlideOver.tsx:36-51` (memo) and `155-160` (display)

**Step 1: Replace customerImpact memo**

```typescript
const customerImpact = useMemo(() => {
    let totalBoardings = 0;
    for (const trip of cascade.cascadedTrips) {
        for (const tp of trip.timepoints) {
            if (!tp.isLate) continue;
            totalBoardings += tp.boardings;
        }
    }
    if (totalBoardings === 0) return null;
    return { totalBoardings };
}, [cascade.cascadedTrips]);
```

Key: no longer depends on `stopLoadLookup`, removed `peakLoad`.

**Step 2: Update display**

Replace the stats row customer impact section (~lines 155-160):

```tsx
{customerImpact && (
    <>
        <span className="text-gray-300">|</span>
        <span>
            <span className="font-semibold text-gray-800">{customerImpact.totalBoardings}</span>
            {' '}boardings at late stops
        </span>
    </>
)}
```

No tilde, no peak load. Actual observed data.

**Step 3: Build check**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add components/Performance/CascadeStorySlideOver.tsx
git commit -m "feat(cascade): use actual APC boardings for passenger impact"
```

---

### Task 6: Final verification

**Step 1: Run all cascade tests**

```bash
npx vitest run tests/dwellCascadeComputer.test.ts tests/dwellCascadeReal.test.ts
```

**Step 2: Full build**

```bash
npm run build
```

**Step 3: Manual verification**

Open cascade story slide-over for a high-severity incident. Verify stats row shows "X boardings at late stops" with actual APC data.
