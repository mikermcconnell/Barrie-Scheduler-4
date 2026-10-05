# Parking Strategy Friendly Design Mockups

Open `index.html` directly in a browser. The concepts require no server, build, external font, CDN, map token, or network connection.

## Concepts

- `01-executive-evidence-board.html` — selected management briefing with coverage, signals, strategic questions, and an interactive top-location concept map beneath Location Concentration.
- `02-strategy-analyst-workbench.html` — filters, location ledger, hourly/payment views, and methodology.
- `03-spatial-portfolio.html` — map-first asset conversation with synced location selection and policy references.

## Evidence boundary

The files contain de-identified aggregates derived read-only from the three supplied LocoMobi workbooks. The common baseline is 44,236 deduplicated records, $592,495.02 in location-attributed source-reported amounts, 18 named locations, and coverage from March 28, 2024 through November 11, 2025.

The UI deliberately shows 2021–2023 as unavailable and 2024–2025 as partial. Payment activity is not labelled occupancy or tax-inclusive revenue. The illustrative spatial placement must be replaced with authoritative GIS coordinates before operational use. No plate, card, receipt, username, permit, or transaction identifiers are embedded.

## Interaction notes

- Use year and metric controls on the Executive Evidence Board. Select a location ranking or map marker to synchronize the top-location evidence.
- Use filters, table selection, tabs, mobile panels, and de-identified CSV export in the Analyst Workbench.
- Use list/marker selection, activity/quality layers, group filters, and mobile panels in the Spatial Portfolio.
- Print the Executive view to create a local PDF.

## Recreate the previews

From this directory, run `node capture-mockups.mjs`. The script recreates the three desktop PNGs and checks each concept for browser errors and 390 px horizontal overflow.
