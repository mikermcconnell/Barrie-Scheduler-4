# Parking Plate Monitor — Review Fix Plan

Date: 2026-10-05
Source: code review of the Plate Monitor page (`#parking/plate-monitor`)

## Context for the implementer

- Page component: `components/workspaces/ParkingDataWorkspace.tsx` (~4.8k lines). Plate Monitor is the
  `activeWorkspace === 'plate-monitor'` branch; the final `return (` near the bottom of the component renders it.
- Shell: `components/workspaces/ParkingWorkspace.tsx` renders the parking dashboard itself and mounts
  `<ParkingDataWorkspace key={activeWorkspace} />` per view, so the data workspace **remounts on every view change**.
- Aggregation: `utils/parking/parkingAggregation.ts`. Persistence: `utils/parking/parkingService.ts`.
  Observation filters: `utils/parking/parkingObservations.ts`.
- Line numbers below are from the review snapshot; re-locate by the quoted code if they've drifted.
- Match surrounding style (Tailwind classes, `React.FC`, `useMemo` density). No new dependencies.
- Run after each item: `npx vitest run tests/parking*.test.ts tests/Parking*.test.tsx` and `npm run typecheck`.
- Do items in order. Item 1 is the only data-loss bug — land it first, as its own commit.

---

## 1. [HIGH] Saving an import permanently strips "Ignore data" rows from all stored months

**Problem.** `importPreview` → `saveParkingMonthsData(team.id, user.uid, previewDatasets, savedSettings)`
(`parkingService.ts:302`) → `buildParkingReplacementSummaryForMonths(...)` → `buildParkingSummary(...)`.
When `settings` is a full `ParkingSettings`, `buildParkingSummary` (`parkingAggregation.ts:326-333`) replaces each
month's `rows` with `filterIgnoredDataRows(...)` output. That filtered payload is uploaded and the old file deleted,
so unticking "Ignore data" later can never restore the rows. This applies to kept months too, not just the new ones.

**Fix.** Persist raw rows; keep ignore-data filtering as a read-time concern (display already rebuilds via
`buildDisplaySummary` → `rebuildParkingSummaryWithRules`).

1. In `parkingAggregation.ts`, add an options param to `buildParkingSummary`:
   ```ts
   export interface BuildParkingSummaryOptions { retainIgnoredRows?: boolean }
   export function buildParkingSummary(months, importedBy, storagePath?, settings = DEFAULT_PARKING_FLAG_RULES, options: BuildParkingSummaryOptions = {})
   ```
   In the `isParkingSettings(settings)` branch, still compute `rows` (filtered) for `analysis`, `rowCount`,
   `totalValue`, but set the returned month's `rows` to `options.retainIgnoredRows ? month.rows : rows`.
   Add a one-line comment that `rowCount`/`totalValue` describe active (non-ignored) rows.
2. Thread the same `options` through `buildParkingReplacementSummaryForMonths` (and `buildParkingReplacementSummary`).
3. In `saveParkingMonthsData` (`parkingService.ts:302`) pass `{ retainIgnoredRows: true }`.
4. Leave `rebuildParkingSummaryWithRules` unchanged (display wants filtered rows).
5. Check `components/workspaces/ParkingDataWorkspace.tsx` Plate Monitor "Export Excel" (`buildParkingSummary(reviewMonths, …, settingsRef.current)`)
   — keep it filtered (no option), i.e. export reflects what's on screen.

**Tests** (`tests/parking.test.ts`, `tests/parkingFirebaseService.test.ts`):
- Existing test "excludes code families marked ignoreData from Parking summaries" must still pass unchanged.
- New: `buildParkingSummary([parsed], 'u', undefined, ignoredSettings, { retainIgnoredRows: true })` keeps the `IF`
  row in `months[0].rows`, while `rowCount === 3`, `totalValue === 110`, and `departmentSummaries` exclude Infrastructure.
- New service test: save with `IF` ignored, capture the uploaded payload from the `uploadBytes` mock, assert `IF` rows
  are present in the stored months (including a pre-existing kept month).

**Note for the user (not code):** rows already stripped by past imports are gone; affected months must be re-imported
from the source workbooks. P1 (`ignoreData: true` by default) has also been stripped on every past save.

---

## 2. [MEDIUM] Wasted Lot Data load on "Back" + silent loss of unsaved settings on leave

**Corrected scope.** Because the shell remounts `ParkingDataWorkspace` per view, re-fetching on entry is by design.
The real defects:
- The inner "Back to Parking Workspaces" button calls `navigateWorkspace('dashboard')`, which sets inner state to
  `'dashboard'`; the load effect (`ParkingDataWorkspace.tsx:2042-2089`, deps `[activeWorkspace, team?.id]`) then
  starts a `'lot-data'`-scope load (downloads the revenue JSON) right before the component unmounts.
- Unsaved Department Manager edits are dropped without warning when navigating away.

**Fix.**
1. In the load effect, compute `const loadScope = activeWorkspace === 'plate-monitor' ? 'plate-monitor' : activeWorkspace === 'lot-data' ? 'lot-data' : null;`
   If `loadScope === null`, return early **without** resetting state or toggling `loading`. Depend on `loadScope`
   instead of `activeWorkspace`.
2. Unsaved-change guard: covered by item 4's `settingsDirty` flag. In `navigateWorkspace` (and the Back button),
   if `settingsDirty`, `window.confirm('You have unsaved department changes. Leave without saving?')`; abort on cancel.
   Also add a `beforeunload` listener while `settingsDirty` is true.

**Tests** (`tests/ParkingWorkspace.loading.test.tsx` / `tests/parkingWorkspaceLoad.test.ts`): mock
`loadParkingWorkspaceData`; render plate-monitor, click Back, assert no call with `'lot-data'` scope.

---

## 3. [MEDIUM] Department Manager "Short code" input loses focus on every keystroke

**Problem.** Row key at `ParkingDataWorkspace.tsx:2740` is `` `${mapping.familyKey}-${index}` ``. Typing in the short
code (`:2749`) changes `familyKey` (trimmed/uppercased in `buildSettingsWithCodeFamilyPatch`, `:2469`), so React
remounts the row and the input loses focus.

**Fix.** Use `key={index}` for the Department Manager rows (list is index-addressed everywhere already — all updates
use `index`). Do the same for the legend rows at `:4703` (`key={color.mappingIndex}`).
Optional, nicer: keep the user's raw text while typing and only uppercase/trim on blur — not required.

**Test:** RTL test — open Manage departments, type `ABC` into a Short code input with `userEvent.type`, assert the
input value is `ABC` and `document.activeElement` is still that input.

---

## 4. [MEDIUM] Ignore checkboxes silently save other pending edits; no validation; no delete confirm

**Problem.**
- Name/code/colour/add/delete/override edits only call `setSettings` (unsaved). The Ignore checkboxes call
  `updateCodeFamilyDirectoryAndSave` (`:2484-2487`), which saves `settingsRef.current` + patch — persisting every
  pending edit, including half-typed ones.
- `saveSettingsOnly` (`:2445`) ignores `departmentManagerWarnings` (blank names/codes, duplicate short codes).
- Delete department (`:2817`) has no confirmation.

**Fix.**
1. Track a saved baseline: `const savedSettingsRef = useRef<ParkingSettings>(DEFAULT_PARKING_SETTINGS)`; set it
   wherever settings arrive from the server (load success, `importPreview`, `persistRevenueDatasets`,
   `persistParkingSettings` success, threshold save success). Derive
   `const settingsDirty = settings.codeFamilies !== savedSettingsRef.current.codeFamilies || settings.revenueLocations !== … || settings.revenueLocationCategories !== …`
   (reference comparison is fine — all edits create new arrays). Use a state counter or store baseline in state if
   re-render is needed for the dirty flag.
2. Change `updateCodeFamilyDirectoryAndSave` to build the patch against **`savedSettingsRef.current`** (the last
   saved baseline) for the persisted copy, and apply the same patch to the local `settings` so pending edits stay
   local and unsaved. Find the mapping in the baseline by index; if the index doesn't exist there (new unsaved row),
   just update locally and don't save.
3. In `saveSettingsOnly`, if `departmentManagerWarnings.length > 0`, `setErrorMessage(departmentManagerWarnings.join(' '))`
   (and/or `toast.error`) and return without saving. Also disable the modal's "Save settings" button when warnings exist.
4. Delete: `if (!window.confirm(\`Delete ${mapping.department || 'this department'}?\`)) return;` before `deleteCodeFamily(index)`.
5. Show a small "Unsaved changes" pill next to the modal's Save button when `settingsDirty`.

**Tests:** RTL — edit a department name, then tick Ignore flags; assert the `saveParkingSettings` mock received the
**old** name. Duplicate short code → Save is disabled / no save call.

---

## 5. [LOW] Blank ignored mapping hides rows with empty department/family in observation views

**Problem.** `filterParkingObservationRows` (`parkingObservations.ts:30-34`) adds `''` to the ignore sets when a mapping
with `ignoreData` has a blank `familyKey`/`department`, hiding every row with an empty key from the annual matrix and
drilldowns (month analysis in `parkingAggregation.ts:38-39` guards this; observations don't).

**Fix.** Mirror the aggregation guard:
```ts
const familyKey = getParkingCodeFamilyKey(mapping.familyKey).trim().toUpperCase();
const department = normalizeText(mapping.department);
if (familyKey) ignoredFamilyKeys.add(familyKey);
if (department) ignoredDepartments.add(department);
```
Apply the same check in `buildParkingDepartmentDrilldownRows` (`ParkingDataWorkspace.tsx:261-267`) — it already guards; verify only.

**Test** (`tests/parkingObservationDrilldown.test.ts`): settings include `{ familyKey: '', department: '', codes: [], ignoreData: true }`;
a row with `department: ''` is still returned.

---

## 6. [LOW] Preview months vs saved months count ignored rows differently

**Problem.** `reviewMonths` (`:1571-1578`) mixes saved months (already ignore-filtered by `plateDisplaySummary`) with
raw `previewDatasets` (unfiltered). The "Rows"/"Total value" metrics (`:4534-4535`) and flagged-plate
"Transactions reviewed" evidence (`:4608`) therefore include ignored departments only for preview months.

**Fix.** Build reviewMonths from a display-normalized preview:
```ts
const displayPreviewDatasets = useMemo(
  () => activeWorkspace === 'plate-monitor' && previewDatasets.length > 0
    ? buildParkingSummary(previewDatasets, user?.uid || 'preview', undefined, observationSettings).months
    : previewDatasets,
  [activeWorkspace, observationSettings, previewDatasets, user?.uid],
);
```
and use `displayPreviewDatasets` in `reviewMonths`. Keep `previewRowCount` / `previewTotalValue` / Save import using
raw `previewDatasets` (those describe the file being saved) — but label the preview banner values as "rows in file".

**Test:** unit-level — preview month containing an ignored family: Rows metric excludes it; saving still sends all rows.

---

## 7. [LOW] Flagged-plate table does O(plates × rows) work on every render

**Problem.** `:4605-4612` filters all `rawTransactionRows` and runs `buildFlagEvidence` for each of up to 120 patterns
on every render, even for collapsed rows.

**Fix.**
1. `const rowsByPlate = useMemo(() => { const m = new Map<string, ParkingRawRow[]>(); for (const row of rawTransactionRows) { const k = \`${row.startMonth}|${row.plate || '(missing)'}\`; (m.get(k) ?? m.set(k, []).get(k)!).push(row); } return m; }, [rawTransactionRows]);`
2. In the map: `const plateRows = rowsByPlate.get(\`${pattern.month}|${pattern.displayPlate}\`) ?? [];`
   (`displayPlate` is `plate || '(missing)'`, same as the aggregation group key.)
3. Only call `buildFlagEvidence` inside the `isExpanded` branch.

**Test:** existing parking tests stay green; optional RTL test that expanding a row still shows the evidence cards.

---

## 8. [LOW] Flagged-plate list silently capped at 120

**Fix.** Below the table, when `monthlyFlaggedPlates.length > 120`, render
`Showing 120 of {n} flagged plates. Export Excel for the full list.` (small gray text, same style as other footnotes).
Hoist `120` to a `const MAX_FLAGGED_PLATE_ROWS = 120` near other constants.

---

## 9. [LOW] Dead fallback in raw observations table

`ParkingDataWorkspace.tsx:2971`:
```tsx
{row.startRaw || `${row.startDate} ${minutesToTime(row.startMinutes)}` || '—'}
```
The template literal is always truthy. Replace with
`{row.startRaw || (row.startDate ? \`${row.startDate} ${minutesToTime(row.startMinutes)}\` : '—')}`.

---

## 10. [QUESTION — do not change without user confirmation]

Plate Monitor "Export Excel" (`:4362`) exports `reviewMonths`, which includes **unsaved preview** months. Ask the
user whether exports should include previews. If not, export `displaySummary` months only (excluding preview keys).

---

## Done criteria

- `npx vitest run tests/parking*.test.ts tests/Parking*.test.tsx` green, with the new tests above.
- `npm run typecheck` clean.
- Manual check (`npm run dev`): import a month with a department set to Ignore data → untick Ignore data → that
  department's rows reappear for that month and earlier months saved after this fix.
- Item 1 committed separately from the rest.
