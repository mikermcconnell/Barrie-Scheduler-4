# Repository Reorganization Log

**Date:** February 12, 2026
**Commits:** 6 commits across 7 phases

---

## Summary

Reorganized the Scheduler 4 repository to reduce root clutter, group utils/ into logical domains, and organize components/ into feature-based subfolders. ~300 import paths updated across ~160 files. Zero behavioral changes.

**Verification:** Build passes (`npm run build`), TypeScript clean (`tsc --noEmit` = 0 errors), test results unchanged (16 pass, 5 pre-existing failures).

---

## Phase 1: Delete Junk & Debug Scripts

**Commit:** `130d98a` — `chore: delete ~25 stale debug scripts and temp files`

### Deleted Files

| File | Reason |
|------|--------|
| `nul` | 0-byte Windows junk file |
| `.tmp_start_test.log` | Temp log |
| `Capture.JPG~RF215f757d.TMP` | Temp file |
| `debug_output.txt` | Stale debug output |
| `debug_csv_segments.ts` | Debug script |
| `debug_excel.cjs` | Debug script |
| `debug_parser_fixture.ts` | Debug script |
| `debug_route12.ts` | Debug script |
| `debug_route12_deep.ts` | Debug script |
| `debug_route12_excel.ts` | Debug script |
| `reproduce_block_link.ts` | Debug script |
| `reproduce_block_numbering.ts` | Debug script |
| `test_night_sorting.ts` | Debug script |
| `test_parser_v2.ts` | Debug script |
| `test_recovery_bug.ts` | Debug script |
| `test_recovery_parsing.ts` | Debug script |
| `test_route_7_blocks.ts` | Debug script |
| `verify_bidirectional_link.ts` | Debug script |
| `verify_breaks.ts` | Debug script |
| `verify_counts.ts` | Debug script |
| `verify_midnight.ts` | Debug script |
| `verify_parsing.ts` | Debug script |
| `verify_rideco_parsing.ts` | Debug script |
| `tests/verify_sorting.ts` | Non-test verification script |
| `tests/verifyBlockFix.ts` | Non-test verification script |
| `tests/verifyRoute12Fix.ts` | Non-test verification script |

---

## Phase 2: Move Data Files to Organized Subfolders

**Commit:** `9fd4909` — `chore: organize data files into data/ and docs/ subfolders`

### Moves

| Old Location | New Location |
|-------------|-------------|
| `08.2025 Schedule Master (TOD).csv` | `data/samples/` |
| `August Master (3).xlsx` | `data/samples/` |
| `Modified_Master_Schedule.xlsx` | `data/samples/` |
| `RideCo - Template ToD Shifts...csv` | `data/samples/` |
| `Runtime Bars - 400 EXPRESS N...csv` | `data/samples/` |
| `Runtime Bars - 400 EXPRESS S...csv` | `data/samples/` |
| `Eddys data pull...xlsx` | `data/samples/` |
| `Capture.JPG` | `data/images/` |
| `Capture1.JPG` | `data/images/` |
| `Capture2.JPG` | `data/images/` |
| `Good Schedule.JPG` | `data/images/` |
| `Barrie-Transit-Platform-Maps.pdf` | `docs/` |
| `gemini_output_shifts.json` | `data/analysis/` |
| `optimal_analysis_output.json` | `data/analysis/` |
| `optimal_shifts_parsed.json` | `data/analysis/` |
| `template_shifts_parsed.json` | `data/analysis/` |

### .gitignore Additions
```
data/samples/
data/images/
data/analysis/
*.xlsx
*.JPG
```

---

## Phase 3: Move Root types.ts & constants.ts

**Commit:** `b82d185` — `refactor: move root types.ts and constants.ts to utils/`

| Old Path | New Path |
|---------|---------|
| `types.ts` | `utils/demandTypes.ts` |
| `constants.ts` | `utils/demandConstants.ts` |

**Import updates:** 21 paths across 14 files (7 components, 7 utils).

---

## Phase 4: Reorganize utils/ into Subfolders

**Commit:** `ebacda3` — `refactor: reorganize utils/ into logical subfolders`

This was the largest phase, moving 51 files into 10 subfolders and updating ~200 import paths.

### New utils/ Structure

```
utils/
├── parsers/                    # Schedule parsing
│   ├── masterScheduleParser.ts
│   ├── masterScheduleParserV2.ts
│   ├── parserAdapter.ts
│   ├── csvParsers.ts
│   ├── otpParser.ts
│   └── scheduleParser.ts
├── schedule/                   # Schedule generation & editing
│   ├── scheduleGenerator.ts
│   ├── scheduleEditorUtils.ts
│   ├── scheduleDraftAdapter.ts
│   ├── scheduleInsights.ts
│   └── scheduleTypes.ts
├── blocks/                     # Block assignment
│   ├── blockAssignment.ts
│   └── blockAssignmentCore.ts
├── connections/                # Connection library & utils
│   ├── connectionLibraryService.ts
│   ├── connectionLibraryUtils.ts
│   ├── connectionOptimizer.ts
│   ├── connectionTypes.ts
│   └── connectionUtils.ts
├── gtfs/                       # GTFS import & GO Transit
│   ├── gtfsImportService.ts
│   ├── gtfsStopLookup.ts
│   ├── gtfsShapesLoader.ts
│   ├── gtfsTypes.ts
│   └── goTransitService.ts
├── transit-app/                # Transit App analytics
│   ├── transitAppService.ts
│   ├── transitAppAggregator.ts
│   ├── transitAppParsers.ts
│   ├── transitAppPlannerRules.ts
│   ├── transitAppScoring.ts
│   ├── transitAppTransferAnalysis.ts
│   ├── transitAppGtfsNormalization.ts
│   └── transitAppTypes.ts
├── platform/                   # Platform conflict analysis
│   ├── conflictEngine.ts       (was platformAnalysis/)
│   ├── dwellEventBuilder.ts    (was platformAnalysis/)
│   ├── platformMatcher.ts      (was platformAnalysis/)
│   ├── time.ts                 (was platformAnalysis/)
│   ├── types.ts                (was platformAnalysis/)
│   ├── platformAnalysis.ts     (was utils/ root)
│   ├── platformConfig.ts       (was utils/ root)
│   └── platformConfigService.ts (was utils/ root)
├── services/                   # Firebase CRUD services
│   ├── dataService.ts
│   ├── draftService.ts
│   ├── publishService.ts
│   ├── teamService.ts
│   ├── newScheduleProjectService.ts
│   ├── exportService.ts
│   ├── masterScheduleService.ts
│   └── systemDraftService.ts
├── config/                     # Route configuration
│   ├── routeDirectionConfig.ts
│   ├── routeNameParser.ts
│   └── routeColors.ts
├── ai/                         # AI optimization
│   ├── geminiOptimizer.ts
│   └── runtimeAnalysis.ts
│
│  (Remain at utils/ root)
├── firebase.ts
├── timeUtils.ts
├── dataGenerator.ts
├── masterScheduleTypes.ts
├── demandTypes.ts
├── demandConstants.ts
├── performanceDataAggregator.ts
├── performanceDataParser.ts
├── performanceDataService.ts
├── performanceDataTypes.ts
└── goldenShifts.json
```

### Import Path Patterns

| Importer Location | Old Pattern | New Pattern |
|-------------------|-------------|-------------|
| `components/*.tsx` | `../utils/masterScheduleParser` | `../utils/parsers/masterScheduleParser` |
| `components/sub/*.tsx` | `../../utils/scheduleGenerator` | `../../utils/schedule/scheduleGenerator` |
| `hooks/*.ts` | `../utils/blockAssignmentCore` | `../utils/blocks/blockAssignmentCore` |
| `tests/*.ts` | `../utils/goTransitService` | `../utils/gtfs/goTransitService` |
| `utils/schedule/*.ts` | `./masterScheduleParser` | `../parsers/masterScheduleParser` |
| `utils/gtfs/*.ts` | `./blockAssignmentCore` | `../blocks/blockAssignmentCore` |

---

## Phase 5: Reorganize components/ Root Level

**Commit:** `668635b` — `refactor: reorganize components/ into logical subfolders`

### Moves

| Subfolder | Files Moved |
|-----------|------------|
| `workspaces/` | FixedRouteWorkspace, OnDemandWorkspace, ScheduleEditorWorkspace, SystemDraftEditorWorkspace |
| `modals/` | AuthModal, AddTripModal, ShiftEditorModal, UploadToMasterModal, BulkUploadToMasterModal, OptimizationReviewModal, FocusPromptModal |
| `contexts/` | AuthContext, TeamContext, ToastContext |
| `layout/` | Header, WorkspaceHeader, ScheduleSidebar, SystemDraftList |

### Deleted (Orphaned)

| File | Reason |
|------|--------|
| `DraftManagerModal.tsx` | Not imported anywhere |
| `ScenarioComparisonModal.tsx` | Not imported anywhere |
| `SaveErrorBoundary.tsx` | Not imported anywhere |
| `PlatformSummary.tsx` | Not imported anywhere |

### Files Remaining at components/ Root
ScheduleEditor, MasterScheduleBrowser, GTFSImport, PlatformTimeline, PlatformConfigEditor, TravelTimeGrid, FileManager, FileUpload, ShiftEditor, SummaryCards, GapChart, RouteSummary, OTPAnalysis, TeamManagement, AuditLogPanel, VersionHistoryPanel, ErrorBoundary

---

## Phase 6: Update Docs & Claude Skills

**Commit:** `e336b47` — `chore: update Claude skills, hooks, and docs for new file paths`

### Updated Files
- `.claude/hooks/run-related-tests.js` — 6 test mapping paths
- `.claude/skills/review-schedule-auto/SKILL.md` — grep paths
- `.claude/skills/schedule-domain/SKILL.md` — file references
- `.claude/skills/time-parsing/SKILL.md` — parser paths
- `.claude/skills/simplify/SKILL.md` — file references
- `.claude/agents/debugger.AGENT.md` — parser path
- `.claude/CLAUDE.md` — danger zones table

---

## Phase 7: Final Verification

- `npm run build` — passes cleanly (19.7s)
- `tsc --noEmit` — 0 errors
- `npx vitest run` — 16 pass, 5 fail (all 5 failures pre-existing, identical to pre-reorg)

### Pre-existing Test Failures (Not Regressions)
1. `tests/timeUtils.test.ts` — 7 post-midnight Excel time parsing failures
2. `tests/parser.test.ts` — 1 golden snapshot mismatch
3. `tests/blockStartDirection.test.ts` — 1 UI display test
4. `tests/transitAppAggregator.heatmapAtlas.test.ts` — 1 heatmap atlas test
5. `tests/transitAppAggregator.serviceGaps.test.ts` — 1 service gap test

---

## Rollback

Each phase was committed separately. To rollback a specific phase:

```bash
git log --oneline  # Find the commit hash
git revert <hash>  # Revert a specific phase
```

**Commit hashes:**
1. Phase 1: `130d98a` (delete junk)
2. Phase 2: `9fd4909` (data files)
3. Phase 3: `b82d185` (types/constants)
4. Phase 4: `ebacda3` (utils/ reorg)
5. Phase 5: `668635b` (components/ reorg)
6. Phase 6: `e336b47` (docs/skills update)
