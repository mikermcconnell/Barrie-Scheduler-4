# Implementation Plan

Status and roadmap for the Barrie Transit Schedule Builder.

> Last updated: February 2026

---

## Completed Phases

### Phase 1: Data Model Alignment ✅

Draft → Publish workflow with unified schedule types.

- [x] `utils/scheduleTypes.ts` - DraftSchedule, PublishedSchedule types
- [x] `utils/draftService.ts` - CRUD for drafts (save, load, update, delete)
- [x] `utils/publishService.ts` - Publish draft to master, version history
- [x] `utils/masterScheduleTypes.ts` - Extended metadata (effectiveDate, notes, publishedAt/by)
- [x] `utils/masterScheduleService.ts` - Read-only master access
- [x] `utils/systemDraftService.ts` - System-wide draft management
- [ ] Tests for draft/publish services

### Phase 2: View Refactor ✅

All editing happens in Drafts; exports from Published.

- [x] `components/ScheduleEditor.tsx` - Publish action added
- [x] `components/ScheduleEditorWorkspace.tsx` - Renamed from ScheduleTweakerWorkspace
- [x] `components/MasterScheduleBrowser.tsx` - Copy to Draft support
- [x] `components/FixedRouteWorkspace.tsx` - Updated view routing
- [x] `components/NewSchedule/NewScheduleWizard.tsx` - Outputs to Draft
- [x] ScheduleTweakerWorkspace removed (commit `75c5088`, Feb 2026)

### Phase 3: GTFS Import ✅

Import existing schedules from GTFS feed.

- [x] `utils/gtfsTypes.ts` - GTFS entity types (336 lines)
- [x] `utils/gtfsImportService.ts` - Full pipeline: fetch, parse, block assign (1,573 lines)
- [x] `utils/gtfsStopLookup.ts` - Stop name resolution
- [x] `components/GTFSImport.tsx` - UI for selecting feed/route/day
- [x] System-wide import (all routes for a day type)
- [x] Merged A/B route handling (2A+2B, 7A+7B, 12A+12B)

### Phase 4: Connection Timing ✅ (Partial)

Connection library with team-shared targets.

- [x] `utils/connectionLibraryService.ts` - CRUD for targets and times
- [x] `utils/connectionTypes.ts` - Type definitions
- [x] `utils/connectionUtils.ts` - Stop matching, day filtering
- [x] `components/connections/ConnectionsPanel.tsx` - Library management UI
- [x] `components/NewSchedule/connections/` - Add target, import route, optimization panels
- [x] `components/schedule/ConnectionIndicator.tsx` - Schedule cell indicators
- [ ] **C7 bug**: Panel edits don't refresh editor indicators without reopen
- [ ] **C4 gap**: Stop code not validated against known stops

### Phase 5: Brochure Generator ✅

PDF brochure generation from Master Schedule.

- [x] `components/Reports/PublicTimetable.tsx` - jsPDF brochure renderer (~800 lines)
- [x] Route color integration from `utils/routeColors.ts`
- [x] Direction labels with terminus info
- [x] Route map upload/preview support

### Phase 6: Platform Conflicts ✅ (Core)

Platform analysis with hub configuration.

- [x] `utils/platformAnalysis.ts` - Dwell events, conflict windows, peak detection
- [x] `utils/platformConfig.ts` - Hub configs (Park Place, GO Station, Allandale, Downtown, Georgian)
- [x] `components/PlatformTimeline.tsx` - Visual platform timeline (replaced PlatformSummary)
- [x] `components/PlatformConfigEditor.tsx` - Platform configuration UI
- [x] `utils/platform/conflictEngine.ts` - Conflict detection core
- [x] `utils/platform/platformConfigService.ts` - Firestore-backed config
- [ ] Publish-time conflict checks
- [ ] Publish-time conflict checks

---

## Remaining Work

### Connections Polish

| Item | Priority | Details |
|------|----------|---------|
| Fix C7 sync bug | High | Wire `ConnectionsPanel` state updates back to `ScheduleEditor` |
| Add stop code validation (C4) | Medium | Validate against known GTFS stops on target creation |
| Add test coverage | Medium | No connection-specific tests exist yet |

### Interlining Reimplementation

| Item | Priority | Details |
|------|----------|---------|
| Design new interline approach | High | Previous code removed Feb 2026; needs fresh design |
| 8A↔8B evening linking | High | One bus serves both routes with 5-min terminal recovery |
| Sunday all-day interlining | Medium | Reduced service = interline all day |
| Terminal DEP column | Medium | Shows next same-route departure, not ARR + R |

### Platform Enhancements

| Item | Priority | Details |
|------|----------|---------|
| Firestore config editor | Low | Move hub/platform config from static file to Firestore |
| Publish-time conflict check | Low | Auto-run analysis when publishing a draft |

### Testing

| Item | Priority | Details |
|------|----------|---------|
| Connection utils tests | Medium | Day filtering, stop-code matching |
| Draft/publish service tests | Low | CRUD operations |
| GTFS import mapping tests | Low | Stop name generation, block chaining |

### Phase 7: Performance Dashboard ✅ (Feb 2026)

Operations performance analytics replacing $30K+/year Transify vendor tool.

- [x] `components/Performance/PerformanceWorkspace.tsx` - Tab container
- [x] `components/Performance/PerformanceDashboard.tsx` - Dashboard container
- [x] `components/Performance/SystemOverviewModule.tsx` - System-wide KPIs
- [x] `components/Performance/OTPModule.tsx` - On-time performance heatmap/scatter
- [x] `components/Performance/RidershipModule.tsx` - Ridership trends
- [x] `components/Performance/LoadProfileModule.tsx` - Passenger load curves
- [x] `components/Performance/StopActivityMap.tsx` - Geographic stop activity
- [x] `components/Performance/reports/` - Route performance, weekly summary, AI query
- [x] `utils/performanceDataAggregator.ts` - Daily summary aggregation
- [x] `utils/performanceDataParser.ts` - STREETS data parsing
- [x] `utils/performanceDataService.ts` - Firestore CRUD
- [x] `functions/src/performance-query.ts` - Gemini-powered query API

### Phase 8: On-Demand / Transit App Analysis ✅ (Feb 2026)

On-demand routing and Transit App data analysis.

- [x] `components/workspaces/OnDemandWorkspace.tsx` - OD demand analysis
- [x] `components/workspaces/OperationsWorkspace.tsx` - Operations dashboard routing
- [x] `utils/transit-app/transitAppAggregator.ts` - Transit App data aggregation
- [x] `utils/transit-app/transitAppTransferAnalysis.ts` - Transfer time analysis

### Future Features

- Real-time GTFS export
- Multi-route scenario comparison
- Automated schedule regression testing

---

## Test Coverage

| File | Tests | Status |
|------|-------|--------|
| `tests/timeUtils.test.ts` | 216 lines | Active - post-midnight handling |
| `tests/connectionUtils.test.ts` | 73 lines | Active |
| `tests/goTransitService.test.ts` | 66 lines | Active |
| `tests/gtfsDirection.test.ts` | 64 lines | Active - 5 route config tests |
| `tests/parser.test.ts` | 44 lines | Active |
| `tests/scheduleDraftAdapter.test.ts` | 95 lines | Active |
