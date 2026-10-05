# Verification report — 2026-09-25

Environment: Windows, PowerShell, Node 22.17.0, local Vite server on `127.0.0.1:3008`, Playwright headless Chromium at 1440×900 and 1366×768. Exact Chromium build was not captured.

| Check | Result |
|---|---|
| Pre-edit `npm run typecheck` | PASS, exit 0. |
| Pre-edit `npx vitest run tests/analyticsWorkspaceRouting.test.ts` | PASS, 1 file / 3 tests. |
| Post-edit `npx vitest run tests/streetDesignStudio.domain.test.ts` | PASS, 1 file / 10 tests after fixing a test-import problem with svg2pdf. |
| Post-edit `npm run typecheck` | PASS after fixing MapLibre import/types and TS target compatibility. |
| `npx vitest run --reporter=dot` | PASS, 373 files / 2,404 tests; 3 files / 17 tests skipped. 132.66 s. Existing Mapbox/jsdom WebGL warnings appeared but did not fail tests. |
| `npm run build` | PASS, final Vite production build after feature edits; 3,350 modules transformed. This does not prove deployment. |
| `npm run lint` | FAIL, 52 errors and 249 warnings across the repository. Focused ESLint on this module passed with 0 errors/warnings. Baseline full lint was not run before edits, so these cannot all be conclusively classified pre-existing; focused new-file lint provides the scoped boundary. |
| `npm run docs:check` | PASS, 90 active Markdown files. |
| Browser `smoke.mjs` | PASS, one MapLibre canvas, baseline/alternative/replacement, save acknowledgement, reload; no page/console errors after fixing the MapLibre worker URL. |
| Browser `history-smoke.mjs` | PASS, Existing edit survived Alternative undo/redo; baseline unchanged. `history-check.json` and `history-redo-check.json`. |
| Browser `new-project-smoke.mjs` | PASS, create project at entered coordinate, draw alignment by clicks, reload retained project. |
| Browser `context-smoke.mjs` | PASS, 1366×768 horizontal overflow 0, OpenFreeMap context loaded without console errors, scene visible after style switch, one map canvas. |
| Browser `export-smoke.mjs` | PASS, downloaded actual SVG, PDF, native JSON, derived GeoJSON. `pdfinfo` reported one A3 landscape page. PDF rasterized with `pdftoppm` and visually inspected at `sample-pdf.png`; SVG markup also inspected. Poppler emitted local missing-display-font warnings but rendered the page. |
| Real aerial source smoke | BLOCKED, no approved aerial provider configured. XYZ URL validator/unit test exists; adapter has not been exercised against real tiles. |
| Performance/leak and two-tab fault injection | NOT RUN. |

The first focused test attempt failed on a top-level `svg2pdf.js` import in Vitest; the import was moved into the PDF function and the test passed. This was a new code error, not a pre-existing repository failure. The first post-edit typecheck caught MapLibre typing/import issues; these were fixed before the passing run. No release, commit, push, or deployment was performed.

The first browser screenshot was blank because MapLibre's worker failed to load. Setting the bundled worker URL fixed it; the later screenshots show the actual compiled design. The first street-style switch hid the design; reconciling on map idle fixed it. Neither failure is counted as a final pass until the rerun above.

## Road-context fixes — 2026-09-25

- Focused Vitest: `npx vitest run tests/streetDesignStudio.domain.test.ts tests/streetDesignStudio.snap.test.ts` — PASS, 2 files / 13 tests. This covers explicit metre-width resizing and nearest-line snapping, including layer eligibility and endpoint clamping.
- `npm run typecheck` — PASS. Focused ESLint on the workspace, domain, snap helper, and focused tests — PASS. `npm run build` — PASS, 3,351 modules transformed. These are local checks, not deployment proof.
- `node tests/street-studio/road-fixes-smoke.mjs` — PASS on localhost: real OpenFreeMap tiles produced a road-snap indicator; Start/End labels were visible; Shift removed the snap preview; a short trace that would orphan the fictional stop was rejected without discarding the draft; an explicit 12.00 m envelope saved and survived reload; a fresh project committed a road-snapped alignment; zero browser page/console errors in this run. The final smoke ran after the code changes; screenshots were visually inspected.
- Screenshots: `studio-road-fixes.png` (fictional fixture, explicitly reduced to 12 m) and `studio-snapped-new-project.png` (new project with snapped points). `studio-street-context.png` shows the original 17.2 m fixture and labelled endpoints.
- **Boundary:** OpenFreeMap strokes are symbolic; no surveyed pavement edges or real imagery were tested. Snapping is at clicked control points, not an automatic route along a connected road network. A straight segment between snapped points can depart from the mapped road on bends or if the points are on different roads. Real road-width fitting is therefore not claimed. The `Could not compile fragment shader` error seen once in an earlier exploratory run did not recur in the final smoke; its intermittent cause remains unproven.

Inspected artifacts: `studio-1440.png`, `studio-1366.png`, `studio-alternative.png`, `studio-street-context.png`, `studio-new-project.png`, `sample.svg`, `sample.pdf`, `sample-pdf.png`, `sample.json`, `sample.geojson`. The PDF has readable vector geometry and source disclaimer, but its title block lacks the planned legend/date; selection and curved-scene visual review remain open.
