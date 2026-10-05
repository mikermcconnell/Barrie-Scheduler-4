# Regional transit connections — approval mockups

## Revised direction: trip-by-trip GO grid

Open `04-go-grid.html` for the user's preferred grid direction based on the City of Barrie's GO Train & Barrie Transit Connection Chart (updated September 8, 2026). Train trips run across the columns and bus route/directions down the rows. Switch Allandale Waterfront / Barrie South and To GO / From GO; click any cell for timing details.

This standalone HTML transcribes the PDF's weekday snapshot, not the current master schedule or current GTFS. It recalculates colours using the source's 1–5, 6–15 and 16–30 minute raw scheduled-gap bands, without walking deductions. Source blanks remain “Not listed”; out-of-band times are flagged, including apparent AM/PM inconsistencies preserved in the reference. Next-day times retain service-day offsets. On-demand windows are not counted as timed connections. Exact current-route mappings, transfer allowances and date-valid feed/master integration remain unimplemented and require approval.

The earlier concepts below remain available for comparison, but their different fictional dataset and walk-adjusted thresholds are not the revised grid's analysis rules.

Open `index.html`, then compare the three HTML versions. Each HTML embeds its own styles and script and can also be opened or shared independently; no installation or external service is required. `preview.css` and `preview.js` are the shared editable source used to generate the previews.

1. Executive summary: recommended management landing view, with summary metrics, location/direction table and prioritized timing issues.
2. Location scorecards: compare the transfer hubs, expand to inspect individual connections.
3. Rider journeys: select a regional trip to inspect local arrival/departure, walking allowance and transfer margin.

Each version places the proposed tab immediately after Platforms in the existing Master Schedule shell. Existing tabs are disabled context, not implemented navigation. Direction/location filters and connection details are functional. Print summary uses browser printing.

## Proposed analysis boundary — not approved implementation

- Read-only comparison of the published master schedule against static regional GTFS, on an explicit service date.
- Both directions: local to regional and regional to local.
- Count regional trip opportunities, not riders. Fixture: 12 events, 7 comfortable, 2 tight, 2 needing review, 1 not assessed.
- Deduct walking time before classifying a transfer. Sample comfortable margin is 5–20 minutes; tight is 0–4. Negative margins and longer waits need review; missing data stays unknown.
- No real feed imported, master read, schedule written, connection-library modification, Firebase access, dependency change, build or deployment.
- GO Transit, LINX, all times, route/stop mappings and source snapshots are illustrative. The presence of a provider/location is not confirmation of current service.
- Before implementation confirm exact agency-scoped stop pairs, direction, boarding rules, walk/accessibility assumptions, target waits, calendar exceptions, feed validity and overnight service. Use actual master version IDs per route and dated feed metadata; unknown/expired/unmatched data must not appear successful.
- This management analysis is distinct from the existing editable connection targets/optimization workflow. No changes to schedules should occur from this tab; proposals return to the established draft/review/publish process.

Recommendation: option 1 as the default, with option 3's journey explanation as its detail view. Approval of a visual direction does not approve transfer thresholds or production wiring.
