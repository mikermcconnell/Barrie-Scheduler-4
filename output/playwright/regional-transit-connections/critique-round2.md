# Regional GO chart — independent critique, round 2 of 2

**Verdict: PASS — 8.7/10 (weighted mean 8.69). No critical-defect cap or material blocker.**

Scope: local production React component, public GO GTFS and fixture bus masters, including a deliberately failed Route 7. Reviewed source and fresh screenshots personally before reading round 1. No production edits or shared-browser control.

## Fixed rubric

Acceptance remains unchanged: first table prominent within desktop's first 900px and partially visible within mobile's first 844px; concise management copy and readable controls; Barrie Bloom identity without an invented logo; required station/day/date/direction/full-screen controls; sticky station/direction and time context; honest source failures, assessed counts and accessible primary controls.

| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
| Correctness and requirement fit | 35% | 9.0 | Both grids, real-date presets, station switching, variant labels and ARR/DEP contract retained. Desktop first table begins about 259px; mobile about 579px, visibly meeting the viewport criterion. Fresh sticky capture retains From GO context and train arrival headings. |
| Usefulness and clarity | 25% | 8.6 | Compact title/actions and filters, short legend, tables before collapsed provenance. Management can read route/train intersections immediately. Small supporting text and terse count shorthand remain minor clarity costs. |
| Robustness and risk handling | 20% | 8.4 | Source failures remain visible; white dagger cells retain unavailable status and are excluded from checked denominators. Failed GO fetch displays no tables. Focus, Escape, refresh failures, team changes and coverage cases have focused tests. Mobile table support text is small; full accessibility is not established. |
| Craft and consistency | 10% | 8.6 | Nunito, green primary/selected treatment, rounded white grids, off-white controls and blue From GO context align with index.html. Gap colours remain distinct. Source is scoped and domain logic unchanged. Minor repeated footnotes and error-state copy can be polished. |
| Evidence and verification | 10% | 8.5 | Personally inspected four fresh screenshots, TSX/CSS, fixture harness, browser proof script and tests; independently reran 20 focused tests, all passing. Browser interactions were reported by parent and their script inspected, not independently rerun. No signed-in shell/live-master proof. |

## Round 1 findings closed

- **Table-first:** the long pre-chart metadata stack is gone. The first grid is comfortably visible on desktop and partially visible on mobile, even with the intentional Route 7 warning.
- **Bloom identity:** current controls use the source brand green with dark readable text, Nunito and quiet off-white/white surfaces. The generic train icon does not introduce a new logo.
- **Scroll context:** fresh sticky screenshot shows station, From GO, date, direction math and time-only arrival headings together. CSS measures each context header and offsets fit-width table headings beneath it; wide/mobile grids have bounded two-axis scrolling.

## Remaining non-blocking issues

1. **Small supporting table text:** legend, No Connection labels, counts and footnotes use roughly 10–11px text (`RegionalTransitConnections.css`; desktop/mobile screenshots). Primary controls and times remain readable, but management users with weaker vision may need zoom. A future polish pass could modestly increase support text and check dense/mobile layouts.
2. **Error-state instruction refers to absent cells:** the failed-GO screenshot still says “Select a cell for details” while no grid exists (`RegionalTransitConnections.tsx`, post-grid dagger note; `critique-round2-error.png`). Show that instruction only when grids exist; keep route/source warnings visible.
3. **Count shorthand is terse:** “3 / 3 checked” and “+ not assessed” require the row label/notes to interpret (`RegionalTransitConnections.tsx`, tfoot). It is honest and usable, but a short accessible explanation could clarify that the numerator counts 6–30-minute gaps, not all checked connections.

## Evidence and proof limits

- Personally inspected `critique-round2-desktop.png` (1440px wide, full page from 1440×900), `critique-round2-mobile.png` (390px wide, full page from 390×844), `critique-round2-sticky.png` (1440×650) and `critique-round2-error.png` (1440×650, aborted GO request).
- Independently executed `npx vitest run tests/RegionalTransitConnections.test.tsx tests/MasterScheduleBrowser.regionalConnections.test.tsx`: **2 files / 20 tests passed**, 2026-10-02, duration 2.87s.
- Inspected production source, feature contract, brand source, unchanged connection calculation, browser fixture entry point and `verify-react.cjs`. Fixture bus reads are explicitly labelled; production React and public GO parsing are used.
- Parent reports **33 browser checks with no runtime errors**, and **92 documentation checks passed**. Those executions were not independently repeated during this review.
- Full repository type checking is **not a pass**: parent reports unrelated errors in untracked `scripts/lib/ridershipCorrection.ts`, with no changed UI-file errors. This reviewer did not rerun the broad check.
- No deployment, Firebase writes/rule changes, authenticated live Firebase read, full-app shell proof, full accessibility certification or production verification. The pass applies only to this bounded local frontend review.

**Final review completed. Stop after round 2; no additional review round or unreviewed production changes.**

