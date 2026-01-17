# Implementation Plan

Development roadmap for Draft → Publish migration.

---

## Prerequisites

Decisions required before starting:

1. **Draft ownership**: Team-scoped (`teams/{teamId}/draftSchedules`) or per-user?
2. **Route identity format**: Keep `{route}-{dayType}` or migrate to `{route}_{dayType}`?
3. **Connection system**: Replace Step 5 optimizer with rules/delta system, or keep both?

---

## Phase 1: Data Model Alignment

**Goal:** Unified schedule type with Draft → Publish workflow.

- [ ] `utils/scheduleTypes.ts` - DraftSchedule, PublishedSchedule, PublishedVersion types
- [ ] `utils/draftService.ts` - CRUD for drafts
- [ ] `utils/publishService.ts` - Publish draft to master, version history
- [ ] `utils/masterScheduleTypes.ts` - Extend metadata (effectiveDate, notes, publishedAt/by)
- [ ] `utils/masterScheduleService.ts` - Refactor to read-only; delegate writes to publishService
- [ ] `utils/dataService.ts` - Deprecate legacy ScheduleDraft types
- [ ] Tests for draft/publish services

---

## Phase 2: View Refactor

**Goal:** All editing in Drafts, all exports from Published.

- [ ] `components/ScheduleEditor.tsx` - Remove direct upload; add Publish action
- [ ] `components/ScheduleTweakerWorkspace.tsx` → Rename to ScheduleEditorWorkspace
- [ ] `components/MasterScheduleBrowser.tsx` → Rename to MasterScheduleView; add Copy to Draft
- [ ] `components/FixedRouteWorkspace.tsx` - Update view names and routing
- [ ] `components/NewSchedule/NewScheduleWizard.tsx` - Output to Draft instead of Master

---

## Phase 3: GTFS Import

**Goal:** Import existing schedules from GTFS feed.

- [ ] `utils/gtfsTypes.ts` - GTFS entities
- [ ] `utils/gtfsImportService.ts` - Fetch, parse, cache GTFS, map to MasterScheduleContent
- [ ] `components/ScheduleCreator/GTFSImport.tsx` - UI for selecting feed/route/day
- [ ] Firebase rules for `teams/{teamId}/gtfsCache`

---

## Phase 4: Connection Timing

**Goal:** Rules-driven connection checks and manual adjustments.

- [ ] `utils/connectionService.ts` - Rules CRUD, GO schedules, bell times
- [ ] `components/connections/ConnectionRulesManager.tsx`
- [ ] `components/connections/GOScheduleEditor.tsx`
- [ ] `components/connections/BellTimesEditor.tsx`
- [ ] `components/ScheduleEditor/DeltaCell.tsx` - Show deltas in schedule table
- [ ] `components/connections/TripAdjustmentDialog.tsx` - Manual adjustments

---

## Phase 5: Brochure Generator

**Goal:** PDF brochure generation from Master Schedule.

- [ ] `utils/brochureTypes.ts`
- [ ] `utils/brochureService.ts`
- [ ] `components/pdf/BrochureDocument.tsx` - @react-pdf renderer
- [ ] `components/MasterSchedule/BrochureTemplateEditor.tsx`
- [ ] `components/MasterSchedule/BrochureGenerator.tsx`

---

## Phase 6: Platform Conflicts

**Goal:** Platform config in Firestore with publish-time checks.

- [ ] `utils/platformConflictService.ts` - Read/write config in Firestore
- [ ] `utils/platformAnalysis.ts` - Consume Firestore config with fallback
- [ ] `components/MasterSchedule/PlatformConfigEditor.tsx`
- [ ] `components/MasterSchedule/ConflictsPanel.tsx`
- [ ] `utils/publishService.ts` - Run conflict analysis on publish

---

## Phase 7: Cleanup

- [ ] Remove deprecated `ScheduleDraft` from `utils/dataService.ts`
- [ ] Remove `utils/parserAdapter.ts` if no longer needed
- [ ] Update docs

---

## Phase 8: Testing

- [ ] Keep `tests/timeUtils.test.ts` (locked parsing tests)
- [ ] Add draft/publish service tests
- [ ] Add GTFS import mapping tests
- [ ] Add platform conflict test cases

---

## Key Gaps (Current State)

| Gap | Impact | Evidence |
|-----|--------|----------|
| Draft → Publish not implemented | High | Data split across 3 locations |
| GTFS import missing | High | Still using CSV/Excel only |
| Connection timing rules missing | Medium | No rules/delta UI in editor |
| Brochure generator differs | Medium | Only jsPDF timetable exists |
| Platform conflict enhancements | Medium | Config is static, no publish checks |
