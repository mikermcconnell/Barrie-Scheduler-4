# Parking Strategy Evidence

Durable contract for historical parking-payment evidence used to support Barrie's Municipal Parking Strategy.

## Current delivery status

- Three Friendly Design concepts live in `output/parking-strategy-mockups/`: Executive Evidence Board, Strategy Analyst Workbench, and Spatial Portfolio.
- Parking Lot Data is the shared entry point for **HotSpot & QR** and **LocoMobi History**. The history tab initially opens Map Analysis at `#parking/lot-data/history/map`, with Trends and Graphs at `#parking/lot-data/history`. Subsequent source-tab switches retain the last visited history view and context. Existing `#parking/strategy` and `#parking/strategy/map` bookmarks still open the history tab with their period and location context. `components/Parking/ParkingStrategyWorkspace.tsx` owns import review, saved-history loading, period filters, ranking, location evidence and reviewed mapping controls. The HTML files remain standalone design references.
- The map uses the shared Mapbox surface and coordinates from existing physical Parking locations. No illustrative placement or automatic name match is used in the application. Unlinked meters remain in totals and source-domain groups without map pins.
- `utils/parking/parkingLocoMobiParser.ts` parses the audited Worldstream/LocoMobi workbook profiles into privacy-minimized activity rows. `utils/parking/parkingLocoMobiAggregation.ts` builds the aggregate strategic read model, and `utils/parking/parkingStrategyHistoryService.ts` owns versioned aggregate-first persistence.

## Evidence boundary

The supplied archive contains 44,236 accepted records after removing 28 exact duplicates and excluding four report/invalid rows. It represents $592,495.02 in source-reported amounts across 18 meter/location combinations from March 28, 2024 through November 11, 2025.

This is a partial 2024-2025 payment-activity baseline, not five years of history. A 2021-2025 presentation must show 2021-2023 as unavailable and both observed years as partial. Missing periods are never zero.

LocoMobi `Amount` has no supplied tax breakdown. Label it **source-reported amount** and do not combine it with HotSpot/QR tax-inclusive revenue until Finance or vendor documentation establishes comparable semantics.

The source has no usable duration or physical-occupancy measure. Do not calculate stay length, turnover, occupancy, or estimated utilization from it. The prior 85% effective-capacity threshold and 300-400 metre alternative-parking catchment may appear as policy references only, not as LocoMobi findings.

## Privacy and identifiers

Direct identifiers are used only transiently when testing whether complete source rows are exact duplicates. The normalized row, aggregates, persisted JSON, prototypes, and exports must not contain licence plates, cards, usernames, receipts, permits, ticket barcodes, transaction numbers, or source-row fingerprints.

Use:

- `Meter` as the stable source identifier
- `Location` as the source display label
- `Domain` as the source grouping dimension
- `Transaction Time` as activity time, falling back to Entry Time only when Transaction Time is unavailable

Strategic history remains under the existing restricted Parking workspace boundary.

## Import and persistence

The parser chooses one canonical source table per supplied workbook:

- 2024 consolidated workbook: `All`, source columns through `XID1`; quarterly copies and pivot columns are excluded
- 2025 January-October workbook: the `(OG)` sheet; the edited/report copy is excluded
- 2025 November workbook: `Revenue Details`; OOXML content is accepted even when the filename ends in `.xls`

Exact raw rows are deduplicated before privacy projection. Zero-dollar approved/paid rows remain in activity counts with a quality flag and contribute zero to monetary totals.

`teams/{teamId}/parking/history` stores the active manifest and revision. Its aggregate JSON and privacy-minimized monthly partitions live under `teams/{teamId}/parking/history/` in Storage. The initial reader downloads only the aggregate. Its optional `locationMonths` index contains month/meter totals and 24 hourly counts for synchronized period and location filtering without activity-partition reads. Legacy archives remain usable for whole-history evidence and require re-import for linked period filters. A month partition is loaded only for an explicit drill-down.

Saves upload immutable replacement objects, recheck the manifest revision in a transaction, atomically advance the pointer, and clean new objects after a failed commit. Re-importing identical normalized content is idempotent.

The import UI reads Excel files locally, previews canonical-table coverage and reconciliation, and requires an explicit Save history archive action. This replaces the complete history archive; users must select all workbooks they intend to retain. It does not replace HotSpot/QR revenue or mapping settings. Successful UI saves are read back before confirmation. Load failures remain errors, never an empty-state invitation to overwrite data.

## Connected location workflow

- `ParkingLotWorkspaceShell.tsx` provides the shared title, back navigation and source tabs. Only the active source workspace mounts, keeping history aggregate loading independent of HotSpot/QR raw payloads. Source-tab navigation remembers the last visited source URL within the Parking shell, including history period, selected area and map/board view; it does not copy source-specific filters or combine financial totals. Each tab retains its own import and export actions. Plate Monitor remains a separate Parking tool.

- The map retains its own Records/Amount toolbar, period, mapped coverage and selected-lot summary in fullscreen. Initial/changed geography fits all mapped lots; changing measure or amounts alone preserves the viewport. Explicit lot selection focuses a lot, and Show all lots restores the overview. A zero-pin state distinguishes unresolved links from invalid coordinates and offers editors a review action (exiting fullscreen before the mapping dialog opens); read-only users receive editor guidance. On narrow screens the map precedes details and the ranking, with a viewport-relative height and minimum 44px metric controls.

- Both map sizes provide a top-right fullscreen control. Browser fullscreen expands the existing map and legend without resetting selection or metric; Exit fullscreen or Escape restores the embedded view. Browser refusal or missing support shows an actionable error rather than silently failing.

- Records / Amount controls both board and full-map label values, accessible labels and colour. Small dots mark exact physical coordinates; named value labels are placed separately in screen space with leader lines and collision avoidance. The selected lot gets priority and an amber highlight. Layout updates during pan, zoom and resize, reserving room for map controls. Labels that cannot fit are counted in a Browse lots action; the scrollable lot list also keeps identical-coordinate lots independently selectable. Selecting a label or list entry focuses the lot and updates the existing linked ranking/detail selection. Clicking a geographic dot opens the list. Nearby distinct lots are never merged, and geographic coordinates are never displaced.
- Proportional bubbles is enabled by default and sizes geographic dots by absolute metric magnitude, with a minimum visible dot and a legend identifying the maximum. It can be switched off for constant-size dots. Named labels retain exact CAD cents and negative signs. This is payment activity, not occupancy. Location-panel warnings are omitted for visual clarity; source limitations remain in Sources & method and the PDF briefing.
- No area is automatically selected when the URL has no `area`. Clicking an already selected label, geographic bubble, Browse lots entry or ranked row deselects it. Clear selection is also available in the map toolbar, including fullscreen. Clearing removes only the selected area, retaining the period, measure and viewport.

- Period and selected area are carried in validated hash parameters `from`, `to` (calendar months) and `area`. Switching board/map or following browser history preserves the context. Missing supplied periods are unavailable, not zero, and an unavailable explicit area is not silently replaced by a different lot.
- `teams/{teamId}/parking/historyLocations` stores reviewed links from stable `['locomobi', domain, meterId]` source identities to existing physical Parking location IDs. Its revision protects concurrent edits. Display-label changes do not change source identity. Several meters can link to one lot; nearby distinct lots are never distance-clustered. Non-spatial groups are excluded from link choices and map pins.
- Location links are explicitly reviewed in the UI; it does not auto-confirm text matches or mutate the existing location registry. Missing/deleted/non-spatial target locations fall back to source-domain grouping. A physical location without valid coordinates remains in evidence but has no map pin. Both mapped record and monetary coverage are shown.
- Opening Location links as an editor prefills a first-pass draft for eight explicitly named source domains (Marina, North Marina, Southshore Centre, Spirit Catcher, Simcoe, Parkside Drive, Ross Street and Tiffin Boat Launch), only when the current registry has exactly one matching physical location name. Existing links are preserved. Heritage East/North, North Victoria, North Centennial Beach and Lakeshore Drive remain unresolved. Suggestions are not persisted or used by the map until Save reviewed links; read-only sessions never receive unsaved suggestions.
- Each confirmed location can open the existing Parking Lot Data page with that location and the same calendar-month range. The revenue page labels the carried context, allows clearing it, and links back to strategy evidence. Even “all supplied history” carries the archive's first/last month, rather than widening to unrelated revenue years. Coverage and financial definitions remain source-specific; partial boundary-month day coverage is not asserted equivalent.
- Existing HotSpot/QR duration, utilization, plate and tax-inclusive revenue calculations are not applied to LocoMobi history. The strategy source panel opens the existing revenue workspace instead of combining incompatible totals.
- Read-only support sessions can inspect history and mapping choices but cannot import or save links. Existing Parking access rules protect both documents and Storage payloads; no new public endpoint or access bypass is introduced.
- Export briefing PDF downloads a local aggregate-only briefing for the selected board period, with monthly totals, ranked areas, source provenance and interpretation limits. A highlighted location is named separately; it does not silently change all-area board totals. The export does not include underlying payment identifiers or claim that source-domain groups have confirmed map coordinates.

## Strategic interpretation

The first production view may describe monthly/seasonal activity, source-reported amount, meter/location concentration, weekday/hour patterns, payment mix, and zero-dollar quality patterns. It must keep observed facts, derived comparisons, and management questions visually separate.

Policy conclusions require additional evidence such as effective-dated rates, capacity and operating hours, occupancy counts, permits/exemptions, enforcement, complaints/refunds, accessibility, asset condition, events/weather, development context, costs, and reserve performance. Scenario outputs must be labelled as scenarios rather than forecasts.

## Verification

- Parser fixtures must cover canonical-sheet selection, pivot exclusion, exact-row deduplication, privacy projection, time precedence, OOXML-with-`.xls`, and aggregate reconciliation.
- The optional local archive test may read `D:\LocoMobi Data- Mike Bot Mach2` but must skip when that folder is unavailable and must never write to it.
- Persistence tests must cover aggregate-first loading, month partition loading, idempotence, concurrent revision failure, and orphan cleanup.
- Mockups must load without a server or network, produce no browser errors, and avoid horizontal overflow at 390 pixels.
- Focused implementation coverage includes model reconciliation/legacy handling, revision and path validation, import review/read-back, readonly controls, route context and source separation. `tests/browser/parkingStrategyHarness.html` exercises the actual React workspace with isolated in-memory stores; fixture/browser results do not constitute authenticated production-persistence proof.
