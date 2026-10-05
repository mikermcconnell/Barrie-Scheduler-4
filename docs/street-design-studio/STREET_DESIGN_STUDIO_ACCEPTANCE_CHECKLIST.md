# Street Design Studio — first-draft acceptance checklist

**Prepared:** September 25, 2026  
**Initial status:** Not run; no feature implementation has been tested by this handoff.

Use `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `N/A — with reason`. Replace the initial status as implementation proceeds. Add a test name, command output, screenshot/export path, or specific inspection note in the evidence column. A file's existence is not proof that its behaviour works.

All unconditional P0 items must pass to call the first draft complete. A configured real aerial provider and a cloud adapter are conditional, but their status must be reported explicitly. Adapter support alone is not evidence of a working real imagery service.

## A. Repository and integration

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| A01 | Actual stack, routes, storage, package manager, instructions, and existing map code were inspected and documented. | PASS | REPO_DISCOVERY.md; inspected App.tsx, Planning Data, dependencies, rules. |
| A02 | Baseline checks were run; pre-existing failures are distinguished from regressions. | PASS | Pre-edit typecheck and routing tests passed; broader checks recorded separately. |
| A03 | Existing app/framework is reused; unrelated work is preserved; no unauthorized production changes, commit, push, or deployment. | PASS | Existing Planning Data integration; unrelated dirty work preserved; no deployment. |
| A04 | Dependency versions/licences are recorded and locked; MapLibre/tracing compatibility is tested or a documented narrow adapter alternative is used. | PASS | Exact MapLibre/proj4/Dexie/svg2pdf versions; narrow MapLibre pointer tracing used; browser smoke. |

## B. Visual workspace and map lifecycle

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| B01 | Main workspace is usable at 1440×900 and 1366×768; drawing dominates; panels do not cause overflow. | PASS | studio-1440.png, studio-1366.png; 1366 viewport overflow 0. |
| B02 | Street drawing uses coherent surfaces, curbs, markings, symbols, dimensions, and restrained selection styling, not emoji/default-plugin visuals. | FAIL | Scene has coherent surfaces/curbs/markings; selected-feature styling remains incomplete. |
| B03 | Clean mode remains usable with external tiles, glyphs, and fonts unavailable. | PASS | Clean style has no remote sources; browser harness rendered without tiles. |
| B04 | Repeated selection, editing, scenario switching, and style changes do not recreate the map or duplicate listeners. | NOT RUN | One map persisted across tested style switches; repeated listener/leak check not done. |
| B05 | Style/source switching preserves the design and camera; attribution remains visible. | PASS | context-smoke.mjs; design and one canvas persisted across clean/street switch. |
| B06 | Missing imagery and failed basemap resources produce truthful, recoverable states without losing the design. | NOT RUN | No aerial configured; basemap failure injection not done. |
| B07 | Toolbar names, focus states, entity selection list, inspector keyboard editing, and active-tool instructions are usable. | PASS | Named tools, focus CSS, entity list, numeric inspector, active instructions. |
| B08 | Actual browser screenshots of straight/curved and selected/unselected scenes have been inspected; identified issues were fixed or recorded. | FAIL | Straight/context/PDF screenshots inspected; curved and selected visuals not reviewed. |

## C. Geometry and dimensions

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| C01 | Pure geometry tests run without MapLibre/React; coordinate types and the fixed local projected frame are explicit. | PASS | tests/streetDesignStudio.domain.test.ts runs without React/MapLibre. |
| C02 | Geographic coordinate order and local-to-WGS84 round trips pass; numerical tolerance is not described as survey accuracy. | PASS | Projection round trip under 0.001 m in focused test. |
| C03 | The 160 m × 17.20 m straight fixture has a 2,752 m² envelope in local coordinates within numeric tolerance. | PASS | 2,752 m² straight envelope assertion. |
| C04 | Ordered bands share the same calculated boundary coordinates and produce no unintended gaps/overlap. | PASS | Shared boundary IDs and same boundary arrays in compiler/test. |
| C05 | Gentle curves, tangent fillets, evaluated stationing, and the 0.01 m chord-error target pass; impossible fillets/offsets are rejected. | FAIL | Gentle fillet tested; full tangent/station/offset and chord-error acceptance not proven. |
| C06 | Replacing 2.40 m parking with 0.60 m buffer + 1.80 m cycle preserves the old outer boundary within 0.001 m. | PASS | Replacement outer boundary equality test. |
| C07 | A locked width increase without a donor produces a clear conflict and no committed change. | PASS | Locked direct width conflict test; original unchanged. |
| C08 | A 0.50 m donor/recipient transfer commits atomically, preserves the side budget, and updates the curb. | PASS | 0.50 m atomic reallocation and stop/dimension movement test. |
| C09 | Width measurements are independent of map zoom; curve centreline and edge lengths are not conflated. | PASS | Widths derive from local metres, not zoom/pixels; edge lengths remain unverified. |
| C10 | NaN/infinity, duplicate points, self-crossing paths, malformed rings, and missing parents are handled without corruption. | FAIL | Some malformed/self-crossing cases covered; ring intersection and full validation incomplete. |
| C11 | Bus stop remains attached to its curb after edits; crossing geometry follows its station/span boundaries. | PASS | Stop curb movement tested; crossing markings derive at station from scene. |
| C12 | Shortening an alignment beyond an attachment blocks the commit; deleting/replacing a parent cannot silently orphan objects. | FAIL | Shortening blocks; delete/reparent workflow not implemented. |
| C13 | Dimension values derive from current geometry and update after edits/undo/reload; estimated inputs remain identifiable. | NOT RUN | Dimension update tested after reallocation; undo/reload dimension sequence not tested. |

## D. Editing workflow and history

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| D01 | A user can create a new alignment and component layout, not only manipulate a hardcoded demo. | PASS | new-project-smoke.mjs creates location project and draws alignment. |
| D02 | Numerical edits, map handles, and reference tracing use the command/validation path. | FAIL | Numerical and click placement use commands; map drag handles absent. |
| D03 | Pointer drag creates one undo entry; Escape/lost capture restores safe state and map navigation. | FAIL | Drag handles/one-step drag history not implemented. |
| D04 | Snapping has a visible indicator, deterministic target selection, and temporary disable; hidden/ineligible features are not used silently. | PARTIAL | OpenFreeMap rendered transportation centrelines snap within 12 px; ROAD SNAP indicator and Shift bypass tested in Chromium. Helper excludes casing/labels/path layers. Connected-road routing and all hidden/ineligible-layer cases remain unverified. |
| D05 | Undo/redo restores semantic geometry and attachments; a new edit clears the correct redo branch. | NOT RUN | Browser undo/redo preserved scenario isolation; redo-branch clearing after a new edit not tested. |
| D06 | Keyboard shortcuts work without intercepting text-field editing; Delete reports dependent objects. | FAIL | Undo/redo/save shortcuts exist; Delete and other shortcuts incomplete. |
| D07 | Every visible action in the P0 toolbar performs a real supported operation; no misleading placeholders. | PASS | Visible P0 controls perform operations; no out-of-scope placeholder buttons. |

## E. Baselines, alternatives, and persistence

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| E01 | Existing draft can be frozen; baseline hash does not change when an alternative is edited. | PASS | Baseline immutable deep snapshot hash test. |
| E02 | Alternatives deep-copy mutable content, preserve logical comparison identity, and pin an exact baseline revision. | PASS | Pinned baseline/deep-copy test. |
| E03 | Scenario switching/undo does not edit another scenario; camera remains fixed in comparison. | PASS | history-smoke.mjs: Existing sidewalk 2.5 m survived Alternative undo/redo; baseline parking remained 2.4 m. Same map/camera switch. |
| E04 | Change list is calculated from the actual model and contains no invented outcome metrics. | FAIL | Only replacement count shown; factual change list incomplete. |
| E05 | Confirmed local saves survive reload; UI distinguishes unsaved, saving, saved, and error states. | PASS | Browser save/reload smoke retained alternative and new project. |
| E06 | Failed writes and old save acknowledgements cannot falsely mark a newer revision saved; a backup/native export remains available. | NOT RUN | Write-failure and out-of-order acknowledgement injection not performed. |
| E07 | Two-tab stale writes are detected/recoverable rather than silently overwriting newer data. | NOT RUN | Atomic revision check exists; two-tab browser recovery not tested. |
| E08 | Native JSON export/import preserves editable content; unsupported schema versions and malformed imports leave the current project intact. | NOT RUN | Native import validation exists; semantic import/export browser round trip not tested. |
| E09 | Local-only versus cloud-connected persistence is clearly labelled; any existing-backend integration has actual authorization/revision checks. | PASS | UI says Saved on this device / No cloud sync; no Firebase write adapter. |

## F. Sources and imports

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| F01 | Configurable street source and XYZ raster adapter work; raster test does not assume a paid account. | FAIL | OpenFreeMap street source browser-tested; XYZ adapter not smoke-tested. |
| F02 | Real aerial source: report coverage/usability, configuration, permission evidence, and an actual smoke test, or explicitly mark external configuration unavailable. | BLOCKED | No approved aerial provider configured; no real imagery tested. |
| F03 | Unknown/denied tracing or export permissions produce the specified restrictions; switching backgrounds does not erase provenance. | NOT RUN | Unknown import permission stored; derived export gate implemented but workflow not tested. |
| F04 | Synthetic, imagery-estimated, imported-reference, and measured/verified statuses are distinguishable; no automatic survey/compliance claims. | FAIL | Source quality fields exist; inspector/report distinctions incomplete. |
| F05 | WGS84 point/line/polygon reference imports, including holes, are validated; unsupported types/CRS are reported, not silently dropped. | PASS | Focused test covers polygon hole and unsupported geometry; file UI not tested. |
| F06 | File/feature/coordinate limits and source URL restrictions are enforced; text/labels are escaped; no secret is exported. | NOT RUN | Size/feature/URL checks implemented; full adversarial limits and escaping review incomplete. |

## G. Export and product verification

| ID | Acceptance condition | Status | Evidence |
|---|---|---|---|
| G01 | SVG and PDF use the same captured scene/document revision and preserve vector geometry rather than only a map screenshot. | PASS | sample.svg and sample.pdf created from same compiled scene; PDF rendered/inspected. |
| G02 | Native JSON and derived WGS84 GeoJSON are both produced and correctly distinguished. | PASS | sample.json and sample.geojson exported via browser. |
| G03 | A 100 m test line measures 200 mm on a 1:500 export; a non-fitting requested scale is not silently changed. | PASS | Focused scale test: 100 m -> 200 mm at 1:500; 1:200 rejected. |
| G04 | Sheet title, scenario, source/accuracy notes, scale bar, grid-north orientation, concept disclaimer, and synthetic label where relevant are correct. | FAIL | Title/source/scale/north/disclaimer present; legend and date absent. |
| G05 | Actual sample SVG/PDF outputs were opened/inspected for clipping, label overlap, missing symbols, text/font problems, and stray UI handles. | PASS | sample-pdf.png visually inspected; SVG source inspected. No tile screenshot export. |
| G06 | Export failure is recoverable; invalid geometry and unapproved imagery cannot be silently published as a valid plan. | NOT RUN | Error/permission recovery injection incomplete. |
| G07 | Unit/integration tests, relevant browser flows, type/lint checks, and production build were actually run; results and pre-existing failures are recorded. | FAIL | Full tests/type/build passed; repository-wide lint fails with 52 errors outside module. |
| G08 | Clean deterministic visual tests and a separate network-dependent source smoke test are distinguished; snapshots are reviewed rather than blindly approved. | PASS | Clean smoke and separate OpenFreeMap context smoke; screenshots inspected, no snapshot auto-approval. |
| G09 | Performance measurements identify machine/browser/fixture and actual results; repeated use is checked for duplicated maps/listeners or obvious memory growth. | NOT RUN | No timed performance fixture or memory growth check. |
| G10 | Final usage/development guide, screenshots, exports, phase status, and known limitations are delivered without claiming unperformed work. | PASS | USAGE.md, DEVELOPMENT.md, status/report, screenshots, exports delivered with limits. |

## End-to-end review script

Start from a fresh local project. Create a street, add a crossing and a curb-attached stop, and enter an associative width dimension. Freeze Existing, duplicate Alternative A, replace parking with buffer/cycle, then compare without moving the camera. On a separate alternative, transfer 0.50 m from parking to sidewalk and verify the curb/stop/dimension changes. Cancel an invalid edit, undo/redo a valid one, save, reload, and export all required formats.

Repeat the key width/attachment tests on the gentle-bend fixture. Disconnect external map resources and verify clean-mode editing. Inject a storage failure and test recovery. Try malformed/oversized input and an unsupported schema version. Inspect both the drawing and the export, not just whether the buttons respond.

## Completion summary to fill in

- P0 complete: **No - partial runnable first draft**
- Blocking failures: **Drag handles/network-following/delete; full curved-geometry validation; change list; failure/two-tab tests; imagery gate; export legend/date; repository-wide lint**
- Conditional external source/backend status: **No approved aerial source; no cloud adapter. Local-only save.**
- Verification environment and date: **Windows, Node 22.17.0, Playwright Chromium, 2026-09-25. See VERIFICATION_REPORT.md.**
- Next highest-value unfinished task: **Complete connected-road tracing and geometry-validation gates, then rerun full browser acceptance.**
