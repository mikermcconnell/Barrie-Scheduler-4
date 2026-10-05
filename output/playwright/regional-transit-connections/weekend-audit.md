# Weekend audit - October 2, 2026

## Confirmed
- Production GO feed worker and event selector match an independent CSV/calendar-date check of the saved October 2 public GO ZIP for October 17 (Saturday) and October 18 (Sunday), at Allandale Waterfront and Barrie South.
- Each station/date has two eligible train departures and two eligible train arrivals; GO buses are excluded.
- 140 focused tests pass, including separate weekend masters/calendars, actual date exceptions, bus arrival vs departure, documented recovery, Stop 14, overnight service and error boundaries.
- Fixed station-chart validation order: malformed timing on a sparse short trip that does not serve the station no longer poisons a direction. Invalid explicit stop indexes and malformed station-serving timing still fail closed.
- Rejected bounds now identify the first trip, raw start/end minutes, active indexes and table stop count. No overnight anchor repairs are guessed.

## Not yet confirmed
- Saturday published bus masters: user supplied warnings for Route 7A, 8A North and 8B North show invalid timing or indexes, but the old messages did not include raw values. Updated warnings are required to finish diagnosis.
- Saturday 12A has no matched Allandale code in the published direction. No broad name fallback was added.
- Sunday live published bus masters and their source notices have not been supplied or read. Fixture results do not establish their accuracy.
- No Firebase writes, rule/index changes or deployment occurred. Public GO network retrieval was intercepted with the saved public ZIP for the browser comparison; this is not a fresh download proof.

## Evidence
- `weekend-go-independent.json`: independent expected train events.
- `verify-weekend-go.cjs`: production browser/worker comparison.
- `tests/regionalWeekendAccuracy.test.ts`: weekend fixture coverage.
