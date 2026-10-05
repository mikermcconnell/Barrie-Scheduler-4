# Regional GO chart — independent critique, round 1 of 2

**Verdict: DOES NOT PASS — 7.0/10 (weighted mean 7.06, critical requirement-fit cap 7.0).**

Scope: local production React component at http://127.0.0.1:8767, real public GO feed, fixture local masters including an intentionally failed Route 7. Not a Firebase, production, or release certification. No implementation edits made.

## Fixed criteria and scores

| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
| Correctness and requirement fit | 35% | 6.8 | Existing station/day/direction/full-screen controls and ARR/DEP contract retained. Table-first mobile acceptance fails; requested Bloom identity is absent. |
| Usefulness and clarity | 25% | 6.0 | Repeated context, lengthy interpretation and source metadata dominate before the chart; train-time headings disappear while scrolling. |
| Robustness and risk handling | 20% | 8.4 | Visible failed-source warning, unavailable exclusion, no fabricated uncovered-date chart, date-aligned presets and detail keyboard handling are covered. Small table/support text and lost column context remain. |
| Craft and consistency | 10% | 6.6 | Clean grid, but slate-blue controls/heading treatment do not reflect the current Nunito/green Bloom brand source. |
| Evidence and verification | 10% | 8.4 | Personally inspected desktop/mobile/full-screen screenshots and production source; independently reran all 16 component tests successfully. Prior browser script inspected; parent reports 51 focused tests and day/full-screen checks. No signed-in live-master proof. |

Criteria remain fixed for round 2: first table prominent in desktop's first 900px and at least partially visible in mobile's first 844px; concise readable controls and management copy; Bloom consistency without an invented logo; retained required filters/sticky direction and honest source failures; accessible primary controls and unchanged read-only/data behavior.

## Highest-impact findings

1. **P1 — The chart is not the primary page content.** Desktop first matrix begins around 602px; mobile around 1130px, beyond the first viewport (positions measured by parent, visually confirmed against screenshots). The title, separate station-context card, interpretation paragraph, three-line calendar explanation, repeated station/feed block and failed-source panel precede it. This misses an essential acceptance criterion, hence the cap. Source: `RegionalTransitConnections.tsx:264-295`, `critique-round1-desktop.png`, `critique-round1-mobile.png`. **Fix:** one compact title/action bar; compact station/day/date/direction controls; short legend plus “Scheduled times; excludes walking/boarding”; move ordinary feed metadata/calendar explanation into existing collapsed details. Keep failures visibly above the grid, but condense to “Route 7 not assessed — white cells are not verified gaps” plus Details/Retry. Retain full explanations and technical provenance on demand. Target mobile first-matrix top below about 600px, desktop below about 320px.

2. **P1 — Requested Barrie Bloom identity is missing from the controls and hierarchy.** Current CSS uses navy/slate, generic rounded rectangles and subtle blue selections throughout; no visible brand-green primary action or selected-state cue. Source: `RegionalTransitConnections.css`, screenshots; authoritative palette/font at `index.html:10-26`. **Fix:** use inherited Nunito, Bloom green on the full-screen primary action and selected filters, off-white surfaces, clearer rounded treatment, and deliberate typography. Keep connection-status colour meanings and white No Connection cells unchanged. Use dark text on bright green or a tested darker green; white on #58CC02 does not provide sufficient normal-text contrast. No invented logo or decorative banner consuming chart space.

3. **P2 — Train-time context vanishes below the sticky station/direction bar.** `react-fullscreen.png` shows From GO station/direction correctly sticking, but no train arrival-time column headings while bus cells remain visible. A manager can no longer identify which GO service a cell belongs to without scrolling back. Source: `RegionalTransitConnections.tsx:247`, CSS has left-sticky row labels but no vertically retained `thead`. **Fix:** retain time headings alongside/beneath each table's sticky station/direction context, preserving horizontal alignment and replacement at the second table. Also shorten duplicated instructions (“GO connections”, “Both”, “To GO · bus arrival”, “From GO · bus departure”, “Details”) and footer wording while keeping assessed-denominator meaning explicit.

## Checks and proof boundaries

- Personally inspected `critique-round1-desktop.png` (1440x1996 from 1440x900 viewport), `critique-round1-mobile.png` (390x2740 from 390x844 viewport), and existing scrolled `react-fullscreen.png`.
- Independently executed `npx vitest run tests/RegionalTransitConnections.test.tsx`: 16/16 passed.
- Read production TSX/CSS, component tests, feature contract, relevant ARR/DEP calculation and current brand source.
- Did not control the browser during parent's shared session. Browser interaction script and supplied existing proof reviewed, not independently rerun.
- Domain/source loading logic need not change. No deployment, dependency changes, Firebase writes or authenticated live validation requested or performed.
