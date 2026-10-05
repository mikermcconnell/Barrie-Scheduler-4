# Implementation status — 2026-09-25

This is a **partial, runnable first draft**, not P0 completion.

| Phase | Status | Evidence / next work |
|---|---|---|
| 0 Discovery | Complete for chosen adapter | Stack, route, baseline, versions recorded in `REPO_DISCOVERY.md`; narrow MapLibre click path browser-tested. Terra Draw not used. |
| 1 Editor foundation | Partial | Integrated workspace, clean MapLibre style, external street style setting, inspector/toolbar. 1440×900 and 1366×768 screenshots inspected. Offline blocking/error injection remains. |
| 2 Domain and geometry | Partial | Project model, UTM conversion, shared constant-width boundaries, simple fillet evaluator, SVG writer and ten focused tests. Full curvature/offset precision gates need deeper testing. |
| 3 Intelligent editing | Partial | Typed commands for width, explicit proportional envelope resize, reallocation, replacement and alignment; scenario-scoped undo/redo. Road-centreline point snap and Shift bypass work on OpenFreeMap tiles. Automatic network-following, handles, delete/reorder, and robust gestures remain. |
| 4 Objects and existing conditions | Partial | Attached stop, crossing, tree and associative width dimension compile. Rejected short alignments preserve the draft and existing objects. Reference line/area click tracing and WGS84 GeoJSON import are wired; edit/delete and extensive validation remain. |
| 5 Baseline, alternatives, saving | Partial | Frozen baseline snapshots, pinned alternatives, local IndexedDB with revision check, save states. Reload and scenario-isolation browser checks passed; two-tab conflict/failure injection remains. |
| 6 Sources and exports | Partial | Clean and OpenFreeMap street mode browser-tested; configured XYZ adapter not tested with an approved provider. SVG/PDF/native/GeoJSON samples generated; PDF inspected. Legend/date and stronger permission workflow remain. |
| 7 Product hardening | Partial | Full Vitest/type/build passed; targeted lint passed; repository lint fails outside this module. Straight/context/PDF screenshots inspected. Curved screenshot, performance, and full acceptance workflow remain. |

**Next highest-value task:** trace connected road geometry between snapped points without crossing unrelated mapped features; pair that with a licensed/measured road-edge source for defensible envelope fitting. Then validate curved boundaries and the full acceptance workflow before enabling the feature by default.
