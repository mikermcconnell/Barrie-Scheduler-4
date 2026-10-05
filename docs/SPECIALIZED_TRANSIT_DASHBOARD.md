# Specialized Transit Dashboard

> Status: active feature development
> Workspace: Dashboard & Reporting > Specialized Transit
> Source boundary: monthly Specialized Transit PDFs supplied by an authorized manager

## Purpose

The Specialized Transit tab provides a month-specific management view without mixing Specialized Transit with fixed-route STREETS measures. It answers six initial questions: whether the two reports reconcile, how exact reported trips change month to month, when common-location bookings occur, which named locations generate activity, how concentrated recurring booking frequency appears, and what the source cannot support.

## Import and privacy contract

**Save report files** retains the currently selected PDF pair in IndexedDB on this device, scoped to the signed-in user and team. The importer restores that pair after navigation, refresh, or reopening the browser, so it can be parsed again without file selection. Saving another pair replaces the saved pair. **Remove saved files** deletes only these source files, retaining imported dashboard aggregates. PDFs are never uploaded to Firebase; browser-site-data clearing removes the local copies. File saving is separate from **Parse and publish** / **Parse and view locally**, which continue to save aggregate history.

The report-month selector chooses a saved monthly report. Shared STREETS date/day filters and the pickup-time range selector do not apply to this tab; maps and charts use the entire selected report month.

Specialized Transit opens independently of STREETS imports and overview availability. The map includes a fullscreen control and Top 10 / All locations table ranked by the selected activity metric. Selecting a mapped table location focuses the map and opens its details; unresolved locations remain listed. Location review tools are collapsed by default.

RVH campus aliases are consolidated into one Royal Victoria Regional Health Centre destination, retaining source aliases and summing endpoint touches. Off-campus clinics and community dialysis remain separate. Existing saved months are consolidated when displayed, and the next normal save persists the grouping. Later imports resolve unique saved aliases to the manager's canonical location before geocoding and remap their activity buckets, so manual merges survive new reports. Ambiguous aliases are not automatically merged. Address geocoding with an explicit civic number requires that civic number to match; unit numbers cannot substitute for it.

Managers select one Monthly Ridership Report and one Ridership by Common Location report for the same month. Selecting **Parse and publish** is the single publication approval action: the browser validates and parses both reports, geocodes new public common-location names, saves the privacy-minimized aggregate, closes the importer, and updates the management view and map. There is no separate preview or publication approval. PDF extraction, booking de-duplication, and ClientId frequency analysis occur in the browser. Raw PDFs remain memory-only unless the manager selects **Save report files**; extracted BookingId and ClientId values are never persisted separately. Only aggregate daily/hourly/location buckets, aggregate recurring-demand thresholds, public common-location labels, source file hashes/page counts, and the reconciliation record are published.

The common-location export is treated as a subset of the monthly reported total. When its booking count differs from the reported trip count, publication automatically records the standard subset reconciliation note. Re-importing the same two source hashes opens the already-published month without creating another revision. Months are retained exactly as imported; the dashboard does not back-cast or estimate missing months.

Named locations first pass through a small canonical directory for recurring public Barrie destinations, then may be sent to Barrie-bounded Mapbox Permanent Geocoding with `permanent=true`. Permanent results are saved with `mapbox-permanent` provenance and reused across later imports; legacy `mapbox` results are not treated as reusable because they came from temporary geocoding. Automatic coordinates require a meaningful name or address match; administrative-area results, generic ambiguous labels, out-of-area results, and repeated Mapbox coordinate piles remain unresolved. Coordinates are visibly automatic until a manager reviews them. Managers can resolve unmapped and legacy locations without charging again for already-saved permanent/reviewed coordinates, work an activity-ranked review queue, request candidate suggestions, correct a display name and coordinate, or merge a truncated/alternate label into another location. Each accepted review or resolution saves a new aggregate revision. `N/A` endpoints are excluded from the map.

The canonical directory also contains manager-reviewed civic-address queries for recurring report aliases. Mapbox Permanent Geocoding supplies the saved coordinate for those addresses, and multiple destinations may validly share a building coordinate because the management map only requires civic-address precision. Labels known to represent multiple or time-sensitive Barrie destinations remain explicitly held for manager review even when Mapbox returns a high-relevance candidate.

The approved August-report review adds 70 exact normalized aliases in `utils/specialized-transit/reviewedAddresses.ts`, with building-level civic addresses and evidence links. The other 51 researched labels stay in manual review. Bulk resolution skips deferred labels without spending Permanent Geocoding requests; managers can still use **Find suggestions** and save their own correction. Approved civic addresses override older generic-label holds, but returned coordinates must still pass the address and Barrie-area checks. Separate businesses and entrance labels retain their own IDs and activity; shared addresses do not trigger merges. Existing saved months receive the approved queries through **Resolve unmapped locations**; changing the directory alone does not mutate saved data or mark coordinates manager-reviewed.

Managers can copy the complete unmapped-location research list to the clipboard. The copied text includes every unmapped location across the saved dataset, stable location IDs, aliases, and total pickup-plus-drop-off endpoint touches ordered from highest to lowest activity; it is not limited to the visible review-table page.

## Interpretation

- Reported trips are the exact Specialized Transit value in the monthly report.
- Common-location bookings are de-duplicated BookingId rows from the common-location report.
- A named-to-named booking creates two map endpoint touches; a named-to-private booking creates one.
- ClientId counts and frequency thresholds are recurring-demand indicators, not verified unique people or confirmed subscription trips.
- Pickup time is scheduled booking time, not observed vehicle arrival time.
- The source does not measure on-time performance, denials, cancellations, vehicle productivity, travel time, occupancy, or cost.

## Access and persistence

Specialized Transit has no dedicated workspace permission while it is in feature development. Import and location-review controls remain visible to team owners/admins.

On the Vite localhost development server, the privacy-minimized aggregate is stored only in IndexedDB in the current browser. The UI labels this state **Local browser data**, uses **Parse and view locally**, restores it after refresh, and provides **Clear local data** for aggregates. Localhost does not read or write Specialized Transit Firestore or Storage records. Optional saved PDF pairs use the same browser-local storage on all hosts; extracted identifiers remain memory-only. New public location names and manager-requested candidate searches may still be sent to Mapbox Permanent Geocoding and may incur account charges.

The localhost client keeps a separate monthly Mapbox Permanent Geocoding usage ledger in browser local storage. Every attempted billable request claims one unit before network dispatch, the UI displays usage, and requests stop at 999 in a UTC calendar month. Known-directory matches do not consume the budget, duplicate report imports are detected before geocoding, and saved `mapbox-permanent` coordinates are not automatically queried again. This is a browser-local safety guard, not an account-wide Mapbox quota: another browser, cleared site storage, or another application using the token is outside its control.

The non-local Firebase store retains the original shape: Firestore stores the active pointer at `teams/{teamId}/specializedTransitData/metadata`, and Storage holds one active revisioned JSON object under `teams/{teamId}/specializedTransitData/revision-{revision}-{nonce}.json`. Both stores require team membership for reads and a team owner/admin role for writes/deletes, with the existing audited support-session exceptions. Being signed in or having an admin access profile alone does not grant write or cross-team access.

Canonical types live in `utils/specialized-transit/types.ts`; parsing lives in `utils/specialized-transit/parser.ts`; location resolution and collision detection live in `utils/specialized-transit/locationResolver.ts`; schema validation lives in `utils/specialized-transit/validation.ts`; localhost persistence lives in `utils/specialized-transit/localStore.ts`; and environment routing plus the non-local Firebase fallback live in `utils/specialized-transit/service.ts`.
