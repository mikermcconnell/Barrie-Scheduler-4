# Lane Transit District Transit App Data Demo Script

Audience: Lane Transit District, Eugene-Springfield, Oregon
Prepared for: Transit App Data workspace demo
Date prepared: May 22, 2026

## Demo goal

Show how the Transit App Data workspace turns Transit App export files into planning evidence that can help a transit agency:

- See where riders are planning trips, not just where boardings already occur.
- Compare rider demand against existing routes, stops, transfers, and schedules.
- Evaluate recent service changes and pilots.
- Prioritize where planners should investigate schedule timing, frequency, stop access, transfer protection, marketing, or field validation.

Important framing: Transit App data is a demand and engagement signal. It should support, not replace, APC, AVL, fare, on-time performance, public engagement, operator feedback, and planner judgment.

## Lane Transit District context

Use this short intro before opening the tool:

> Lane Transit District is the public transit provider for the Eugene-Springfield area and broader Lane County. LTD is a special district of Oregon with a 482-square-mile service area, more than 6 million annual rides, 22 neighborhood bus routes, 6 rural routes, 3 EmX rapid transit lines, about 113 buses, and roughly 1,300 bus stops. LTD's mission is "Connecting Our Community," with a stated focus on a connected, sustainable, and equitable community.

Why this demo should matter to LTD:

- LTD already has a strong Transit App partnership. The rider-facing app supports real-time bus locations, trip planning, GO guidance, service alerts, feedback, and Royale access for LTD riders.
- LTD recently launched Transit as a broader mobility app connecting LTD, PeaceHealth Rides, Link Lane, and other options into one trip-planning experience.
- That means LTD is in a good position to use Transit App export data not only for customer information, but also for service planning.

Recent route and schedule context to mention:

- September 7, 2025: LTD increased Monday-Friday bus service by more than 4%, made minor adjustments to many routes, kept weekday EmX at 10-minute service for much of the day, changed Routes 36 and 41 routing, and renamed Route 1 as the Downtown Loop.
- September 7, 2025 through summer 2027: The Downtown Loop is a two-year pilot with 30-minute service, evening hours, expanded downtown coverage, and a focus on the Riverfront, Midtown, food access, housing, employment, and education.
- February 1, 2026: Winter changes adjusted Route 1 timing, added 5 minutes to selected Route 12 and Route 51 trips, changed selected Route 40 and Route 66 times, and adjusted selected Route 93 weekend trips.
- June 14, 2026: Upcoming summer changes include a new Route 41 stop, Route 51 evening timepoint changes, and Route 93 changes including a new 7:35 p.m. weekday trip and express non-stop operation for some Eugene-bound service.

Demo angle:

> For LTD, the question is not just "what changed?" It is "did those changes line up with rider search patterns, transfer needs, stop access, and time-of-day demand?" This workspace helps answer that.

## Suggested demo flow

### 1. Start in Planning Data, then open Transit App Data

Show:

- Planning Data / Analytics dashboard.
- Transit App Data card.
- If data is already loaded, open the workspace. If not, briefly show the import screen.

Say:

> This workspace is built around the files that Transit App can export for an agency. It ingests route engagement, trip requests, user locations, trip legs, and app usage. The goal is to turn those raw files into planner-readable dashboards.

Point out expected file types:

- `lines_YYYY-MM-DD.csv` for route views, taps, routing suggestions, and GO trips.
- `trips_YYYY-MM-DD.csv` for origin-destination trip requests.
- `locations_YYYY-MM-DD.csv` for app activity density.
- `go_trip_legs_YYYY-MM-DD.csv`, `planned_go_trip_legs_YYYY-MM-DD.csv`, and `tapped_trip_view_legs_YYYY-MM-DD.csv` for observed and planned trip legs.
- `users.csv` for app usage, sessions, and downloads.

Planner value:

> Instead of asking staff to manually review CSVs, the tool detects the files, checks the date range, imports the data, aggregates it, and stores a team-level planning dataset.

### 2. Overview tab: get the planning headline

Show:

- User-days.
- Trip requests.
- Routes tracked.
- Days covered.
- Top routes.
- Trip volume and app usage trends.
- Top transfers.

Say:

> The overview gives the planning headline first. For LTD, this is where we would ask: which routes are riders looking at most, which transfer pairs show up repeatedly, and are there demand spikes around the Downtown Loop, EmX corridors, UO, Gateway, Springfield, Santa Clara, or rural connections?

Good question for LTD:

> After the September 2025 service increase and Downtown Loop launch, did route views, taps, or trip requests shift in the corridors where LTD invested new service?

### 3. Route Performance tab: move from popularity to action

Show:

- Routes to Watch.
- Route performance scorecard.
- Route conversion funnel: views, taps, suggestions, GO trips.
- Seasonal score trend by route.

Say:

> Route popularity alone can be misleading. This view separates attention from follow-through. A route might have many views but low itinerary suggestions, or good search demand but weak GO trip follow-through. That is a clue to investigate schedule usefulness, routing, walk access, transfer timing, or public information.

How it helps LTD:

- Evaluate routes affected by recent changes, such as Routes 1, 12, 36, 40, 41, 51, 66, and 93.
- Identify routes where riders are interested but not converting to usable trips.
- Spot routes that are declining or below the network median and need planner review.
- Support post-change monitoring for the Downtown Loop pilot.

Say:

> For LTD, this is a good place to monitor whether a change is working before waiting for a full annual ridership cycle.

### 4. OD Pair tab: where riders want to travel

Show:

- Origin-destination map.
- Time period filters: AM peak, midday, PM peak, evening/night.
- Season filter, if data is available.
- Top OD pairs table.
- Coverage gap analysis.

Say:

> This is the demand map. It shows where people are asking the app to take them, grouped into zones. It can be filtered by time of day, day type, season, distance band, and corridor.

Demo path:

1. Start with all-day OD pairs.
2. Switch to AM peak and PM peak.
3. Show top OD pairs table.
4. Turn on all-zones or route-corridor filtering if useful.
5. Point to coverage gap rows where no single route appears to serve both ends well.

How it helps LTD:

- Check whether downtown and Riverfront demand changed after the Downtown Loop pilot.
- See whether UO, LCC, Gateway, Springfield, Santa Clara, Veneta, Cottage Grove, or Junction City trips cluster differently by time of day.
- Identify short trips that may need better stop access, micromobility integration, or marketing.
- Identify longer trips that may need better regional connections or transfer timing.

Say:

> The most useful planning conversation is not "should we add service here immediately?" It is "which demand patterns deserve validation with ridership, operations, and equity data?"

### 5. Stop Analysis tab: find access problems

Show:

- Endpoints analyzed.
- Far endpoints more than 400 metres from a stop.
- Coverage gap clusters.
- Average nearest stop distance.
- Coverage gap map.
- Far-from-stops cluster table.
- Stop mention ranking.

Say:

> This turns trip-planning endpoints into a stop-access review. It asks: are people planning trips from places that are far from stops, and do those points cluster in a way that suggests a stop spacing, walk access, or route coverage issue?

How it helps LTD:

- Review whether new Downtown Loop stops are reaching the intended destinations.
- Compare stop access near new housing, the Riverfront, Midtown, and employment or health-service destinations.
- Pair app demand with rider feedback from Rate-My-Ride and field observations.

Caveat to say clearly:

> Stop mentions are itinerary references, not boardings. This points planners to places worth checking; it does not prove a stop should move or a route should change.

### 6. Transfer tab: protect the connections people actually use

Show:

- Transfer patterns.
- Route pair counts.
- Average wait and min/max wait.
- Map view, if useful.
- GO-linked or regional transfer tables, if present in the dataset.
- Connection target candidates.

Say:

> This turns multi-leg trip plans into transfer intelligence. It shows which route pairs appear together, where riders transfer, and whether the wait is short, long, or inconsistent.

How it helps LTD:

- Review transfer hubs such as Eugene Station, Springfield Station, Gateway Station, UO Station, and EmX connections.
- Understand whether Downtown Loop changes improved or weakened access to the rest of the network.
- Identify transfer pairs that should become protected connection targets in schedule planning.
- Evaluate rural and regional connections where missed transfers can have a high rider cost.

Say:

> If a transfer pair has high volume and poor wait quality, that is a strong candidate for schedule coordination rather than just marketing.

### 7. App Usage tab: measure adoption and campaign effects

Show:

- User-days.
- Total sessions.
- Downloads.
- Sessions per daily user.
- Daily trend.
- Day-of-week profile.
- Monthly comparison.

Say:

> LTD has been actively promoting Transit App, GO mode, real-time information, service alerts, and Rate-My-Ride. This tab helps separate a service issue from an adoption issue. If rider app usage rises after a campaign, route engagement and feedback data become more valuable.

How it helps LTD:

- Monitor adoption after the Transit partnership launch.
- See whether campaigns around Royale, GO mode, or service alerts create sustained usage.
- Compare weekday and weekend app engagement.
- Time outreach around service changes, downtown pilot surveys, or route-specific rider education.

### 8. Heatmap tab: see where activity concentrates

Show:

- Raw pings versus debiased pings.
- Atlas slices by season and day/time period.
- Heatmap viewer.
- Key callouts.
- Export Atlas PDF button.

Say:

> This is not a ridership heatmap. It is a relative app-activity heatmap. The workspace debiases repeated pings, then lets planners compare hotspots by season, weekday AM, weekday midday, weekday PM, evening, Saturday, and Sunday.

How it helps LTD:

- Compare January, July, and September travel patterns.
- Look for seasonal shifts around UO, events, downtown, parks, and rural/visitor travel.
- Create a quick PDF exhibit for internal planning discussions.

### 9. Service Gaps tab, if enabled in the demo build

If the tab is visible and available, show:

- Demand versus scheduled supply overlay.
- First trip, last trip, average headway, and demand outside span.
- Gap register by span start, span end, weekend, seasonal shift, and frequency gap.
- Route gap priority.

If it is disabled or marked under development, say:

> This module is still being refined, but the direction is important: combine Transit App demand with GTFS scheduled supply so planners can spot possible span, weekend, seasonal, or frequency gaps.

How it helps LTD when available:

- Test whether Route 51 or Route 93 evening changes match observed trip-planning demand.
- Compare demand outside the service span for rural and neighborhood routes.
- See whether weekend demand is under-served relative to weekday patterns.

## Closing message

Use this as the close:

> The value for LTD is that the workspace makes Transit App data operationally usable. It helps answer practical planning questions: are recent route changes showing up in rider behavior, where are riders still struggling to make trips, which transfers deserve protection, which stops or areas need review, and which routes need schedule or marketing attention? It does not make the decision for the planner. It gives the planner a clear shortlist of places to investigate with the rest of LTD's evidence.

## Likely questions and short answers

**Is this replacing ridership data?**

No. It complements ridership. It shows trip planning, engagement, and intent, including trips that riders considered but may not have completed.

**Can it tell us whether the Downtown Loop is working?**

It can help. It can show app usage, OD patterns, route engagement, stop access, and transfer patterns before and after the pilot. Final evaluation should still combine ridership, on-time performance, survey feedback, cost, equity, and funding availability.

**Can we use our own GTFS?**

Yes, the Transit App Data workspace can use GTFS-based route, stop, and supply context for maps, transfer normalization, stop proximity, and demand-versus-supply analysis where available.

**Can this identify schedule changes?**

It can identify candidates: time periods with demand outside span, high-volume transfer pairs with long waits, routes with weak conversion, and OD pairs without strong direct coverage. Planners still decide what to change.

**What should LTD bring to make this work well?**

- Transit App export files for a useful before/after period.
- Current GTFS.
- APC or ridership data for validation.
- Known service change dates.
- Local knowledge about schools, UO terms, events, roadwork, and rural service constraints.

## Feature review notes from the workspace

Primary implemented demo sections:

- Import workflow: folder or file upload, file detection, preview, parse, aggregate, save.
- Overview: KPIs, top routes, trip volume, app usage, top transfers.
- Route Performance: scorecard, watchlist, conversion funnel, seasonal trends, recommended planner action labels.
- OD Pair / Demand: OD map, filters, top pairs, coverage-gap analysis, seasonal comparison.
- Stop Analysis: far-from-stop clusters, stop mentions, coverage gap map.
- Transfers: transfer pattern tables, map view, grouped route pairs, wait quality, connection target candidates.
- App Usage: users, sessions, downloads, day-of-week and monthly trends.
- Heatmap: debiased app-activity atlas by season and time slice, callouts, PDF export.

Mention carefully:

- Service Gaps is under development in the current workspace and should be shown only if enabled for the demo build.
- GO Integration and Validation tabs may appear as placeholders depending on the build.

## Sources

External sources reviewed:

- LTD About Us: https://www.ltd.org/about/
- LTD Routes, Maps, and Schedules: https://www.ltd.org/riders-guide/routes-maps-schedules/
- LTD Transit App page: https://www.ltd.org/riders-guide/transit/
- LTD new app partnership launch, November 3, 2025: https://www.ltd.org/ltd-provides-seamless-user-experience-with-new-app/
- LTD Travel Smart with Transit, April 16, 2026: https://www.ltd.org/travel-smart-with-transit/
- LTD Rate-My-Ride article, February 11, 2026: https://www.ltd.org/your-voice-matters-help-your-fellow-riders-and-climb-the-leaderboard/
- LTD Launches New Downtown Service, September 2, 2025: https://www.ltd.org/ltd-launches-new-downtown-service/
- LTD Increases Service Starting September 7, September 3, 2025: https://www.ltd.org/ltd-increases-service-starting-september-7/
- LTD Winter Service Changes Begin February 1, 2026: https://www.ltd.org/winter-2026/
- LTD Summer Service Changes Begin June 14, 2026: https://www.ltd.org/summer-2026/
- City of Eugene Downtown and Riverfront Public Transportation and Shared Mobility Study: https://www.eugene-or.gov/5190/Downtown-and-Riverfront-Public-Transport

Repository files reviewed:

- `docs/PRODUCT_VISION.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEMA.md`
- `ORCHESTRATOR.md`
- `components/Analytics/AnalyticsDashboard.tsx`
- `components/Analytics/TransitAppWorkspace.tsx`
- `components/Analytics/TransitAppImport.tsx`
- `components/Analytics/OverviewPanel.tsx`
- `components/Analytics/RoutePerformanceModule.tsx`
- `components/Analytics/DemandModule.tsx`
- `components/Analytics/StopAnalysisModule.tsx`
- `components/Analytics/TransfersModule.tsx`
- `components/Analytics/AppUsageModule.tsx`
- `components/Analytics/HeatmapModule.tsx`
- `components/Analytics/ServiceGapsModule.tsx`
- `utils/transit-app/transitAppTypes.ts`
- `utils/transit-app/transitAppParsers.ts`
- `utils/transit-app/transitAppAggregator.ts`
- `utils/transit-app/transitAppService.ts`
