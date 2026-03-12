# Network Connections Product Brief

> Date: March 11, 2026
> Status: Working draft
> Product fit: Network-level connection analysis and retiming guidance within Scheduler 4 Fixed Route
> Visual direction: Friendly design theme, map-first workspace

## 1. Purpose

Network Connections is a schedule analysis feature that helps Transit Staff understand where routes actually connect, how strong those connections are, and what schedule changes would improve them.

The feature should use published schedules or draft schedules to:

- discover route-to-route connection points across the network
- measure whether transfers are practical, tight, missed, or excessively long
- identify repeated connection failures by route pair, stop, time band, and day type
- recommend schedule actions that improve network connectivity
- feed strong or intentional connection points into downstream schedule editing

This is not just a library of manual targets. It is a network scanner and recommendation engine built on the full schedule.

## 2. Problem Statement

Routes currently exist as separate schedules, but the planner does not have a strong system view of how those schedules interact.

This creates several planning problems:

- it is hard to see where routes intersect in a useful transfer pattern
- connections may exist geographically but fail operationally
- missed transfers may repeat all day without being obvious in route-by-route editing
- some hubs may deserve timed-transfer protection while others do not
- staff can spend time optimizing isolated routes without improving the network as a whole

The tool should answer a simple planning question:

> where does the network work as a network, and where does it break?

## 3. Product Goal

Create a network-level analysis workspace that evaluates scheduled transfer quality between routes and returns clear, defensible recommendations for retiming, timed-transfer design, and connection prioritization.

## 4. Product Position

This feature should sit above the existing route-level Connections workflow.

Current role of existing Connections feature:

- define manual targets such as GO train departures or college bells
- define route-specific connection targets
- check and optimize one route against configured targets

New role of Network Connections:

- auto-discover connection opportunities across the whole network
- score connection quality without requiring every pair to be manually configured
- identify system-level priorities and weak spots
- allow selected discoveries to be promoted into the existing connection library or route-level optimization flow

In short:

- existing Connections = configured target management and route-level optimization
- Network Connections = system discovery, diagnosis, and recommendation

## 5. Definition of Success

The feature is successful if a planner can load a day type, immediately see where routes connect, and identify the highest-value schedule changes without manually comparing multiple timetables.

### Phase 1 success

- The system discovers transfer hubs from published or draft schedules.
- The user can rank route-to-route connections by stop, day type, and time band.
- The tool shows whether each connection pattern is missed, tight, good, or excessively long.
- The tool produces understandable retiming recommendations for the most important weak connections.
- The planner can save selected discovered pairs as intentional connections for later schedule editing.

### Phase 2 success

- The feature combines scheduled connection quality with observed transfer demand from rider data.
- The tool distinguishes between weak connections that matter and weak connections that are low priority.
- Recommendations can account for route reliability and late-running exposure, not just static timetable gaps.

### Phase 3 success

- The feature supports pulse design at major hubs.
- The tool can test proposed pulse minutes and show impacts on multiple routes at once.
- The feature becomes part of system redesign and major service change workflows, not only spot schedule fixes.

## 6. Core User Questions

The feature should help answer the following questions:

- Which stops function as real transfer hubs?
- Which route pairs are intended to connect but regularly miss?
- Which connections are too tight to be dependable?
- Which waits are too long to feel intentional?
- Where would a small retiming meaningfully improve the network?
- Which hubs should operate as timed-transfer or pulse points?
- Which connection opportunities are not worth protecting?
- Which issues are schedule problems versus structural frequency problems?

## 7. Primary Users

| User | Role | Primary Need |
|------|------|--------------|
| Transit Planner | Schedule planning | Find and improve route-to-route connections |
| Service Planner | Network design | Understand hub function and timed-transfer opportunities |
| Operations/Planning Lead | Review | Prioritize schedule changes with system benefit |

## 8. Core User Stories

### Discovery

- As a planner, I want the system to identify where routes meet so that I do not have to infer connections manually from multiple schedules.
- As a planner, I want nearby stops and paired platforms treated as possible transfer locations so that the analysis reflects how passengers actually transfer.

### Diagnosis

- As a planner, I want route-to-route transfer quality summarized by stop and time band so that I can see repeated problems rather than individual one-off misses.
- As a planner, I want the tool to distinguish missed, tight, good, and long waits so that the results are operationally meaningful.

### Recommendation

- As a planner, I want the system to suggest specific retiming actions so that I know what change might improve the connection.
- As a planner, I want the tool to identify when a connection problem is structural and not fixable with a small retime.

### Workflow integration

- As a planner, I want to promote an analyzed connection pair into the existing connection library so that I can move from diagnosis into schedule editing.
- As a planner, I want to compare published schedules and draft schedules so that I can test whether a proposed change improves network connectivity.

## 9. Core Workflow

1. Open Network Connections from Fixed Route.
2. Choose source schedule set:
   - published master schedule
   - active system draft
   - selected draft set
3. Choose day type and optional time band.
4. System builds transfer hubs from shared stops, nearby stops, and known terminal groupings.
5. System scores route-to-route connections across the network.
6. User reviews ranked hubs, route pairs, and repeated failure patterns.
7. User opens a hub or route-pair detail panel to inspect exact arrival/departure relationships.
8. User reviews recommendations:
   - retime
   - protect
   - pulse
   - move transfer focus to a better stop
   - de-prioritize
9. User optionally promotes a discovered connection into the existing Connections workflow or opens the affected draft in Schedule Editor.

## 10. Recommended Product Structure

### 10.1 Map-first principle

This feature should be map-first, not table-first.

The primary working surface should be a network map showing hubs, route relationships, and issue severity. Tables and detail panels should support the map, not replace it.

The design rule should be:

> understand the network spatially first, diagnose it operationally second

### 10.2 Placement

This should live inside Fixed Route, not as a separate top-level app.

Recommended initial placement:

- `Fixed Route > Planning Data > Network Connections`

This keeps it close to other system analysis tools while preserving a clear handoff back into schedule editing.

### 10.3 Workspace model

The feature should have two main modes:

- `Network Overview`
- `Hub / Route Pair Detail`

### 10.4 Friendly theme direction

The workspace should use the Friendly design theme already established elsewhere in Scheduler 4:

- soft gray frame
- white bordered map and panel cards
- rounded panel treatments
- compact pill controls
- tinted KPI, warning, and recommendation cards
- quiet map chrome with strong selection state

This should feel like a warm planning workspace, not a GIS analyst tool.

### 10.5 Screen layout

| Region | Purpose |
|------|---------|
| Header | Source schedule set, day type, time band, filters, export |
| Left rail | Ranked hubs, route pairs, issue filters |
| Center map | Transfer hubs, connecting routes, severity styling |
| Right rail | Detail panel, recommendations, action buttons |
| Bottom drawer | Repeated trip patterns, before/after recommendation preview |

## 11. Key Views and Modules

| Module | Responsibility | Proposed Path |
|------|----------------|--------------|
| Workspace shell | Routing, filters, state | `components/NetworkConnections/NetworkConnectionsWorkspace.tsx` |
| Filter bar | Day type, schedule set, time band, issue filters | `components/NetworkConnections/NetworkConnectionsFilterBar.tsx` |
| Hub ranking panel | Rank transfer hubs and route pairs | `components/NetworkConnections/HubRankingPanel.tsx` |
| Network map | Show hubs, route overlays, connection severity | `components/NetworkConnections/NetworkConnectionsMap.tsx` |
| Detail panel | Show exact connection patterns for selected hub or route pair | `components/NetworkConnections/ConnectionDetailPanel.tsx` |
| Recommendation panel | Explain recommended fixes and expected benefit | `components/NetworkConnections/ConnectionRecommendationPanel.tsx` |
| Service layer | Build hubs, score connections, generate recommendations | `utils/network-connections/networkConnectionAnalysis.ts` |
| Types | Analysis result, hub model, recommendation model | `utils/network-connections/networkConnectionTypes.ts` |

## 12. Core Analysis Model

### 12.1 Transfer hub discovery

The system should identify candidate transfer hubs using:

- exact shared `stop_id`
- stop clusters within a configurable walk radius
- known paired platforms or terminal bays
- corridor junction logic already used elsewhere in GTFS-based mapping

The user should be able to override or confirm special hubs later if needed.

### 12.2 Connection event generation

For each hub, the system should:

- find arrivals from Route A
- find departures from Route B
- exclude same-trip or irrelevant comparisons
- calculate transfer gap using schedule times
- classify the connection outcome

### 12.3 Connection quality classes

Recommended default schedule-based classes:

| Class | Rule |
|------|------|
| Missed | departing trip leaves before feeder arrival or buffer cannot be met |
| Tight | wait is positive but below preferred reliability buffer |
| Good | wait falls inside preferred transfer window |
| Long | wait exceeds reasonable transfer target |

Suggested initial thresholds:

- missed: `< 0` minutes or below required buffer
- tight: `0-2` minutes beyond minimum buffer
- good: `3-7` minutes
- acceptable but long: `8-12` minutes
- poor long wait: `13+` minutes

These should remain configurable because different connection types may justify different windows.

### 12.4 Repeatability

The system should not focus only on single trip matches. It should summarize repeated behavior across:

- full day
- AM peak
- midday
- PM peak
- evening

Example outputs:

- `Route 2 -> Route 8 at Downtown Terminal is missed on 6 of 9 PM opportunities`
- `Route 1 -> Route 3 at Georgian College is consistently good in AM peak`

## 13. Recommendation Types

The tool should generate recommendation categories, not just raw statistics.

### 13.1 Protect

Use when:

- transfer demand or strategic importance is high
- the connection is usually close but not reliable

Example:

- hold Route 8 up to 2 minutes at Downtown Terminal for Route 2 arrivals after 3:00 PM

### 13.2 Retime

Use when:

- a small shift on one route improves repeated misses
- the change does not break downstream spacing or recovery too severely

Example:

- shift Route 2 northbound departures +3 minutes from 6:30 PM onward

### 13.3 Pulse

Use when:

- several routes meet at the same hub
- a repeating clockface minute could organize the network better than pairwise fixes

Example:

- target a `:15 / :45` pulse at Downtown Terminal for routes 1, 2, 8, and 100

### 13.4 Retarget hub or stop

Use when:

- routes technically intersect at one stop
- a nearby stop or paired platform is the better practical transfer point

### 13.5 Structural issue

Use when:

- frequency mismatch or runtime pattern makes small retiming ineffective
- the issue likely requires broader service design change

## 14. Data Model Direction

The feature should not mutate core schedule objects directly during analysis. It should build derived analysis objects.

Suggested core entities:

```ts
interface NetworkTransferHub {
  id: string;
  name: string;
  stopIds: string[];
  stopCodes: string[];
  lat: number;
  lon: number;
  hubType: 'shared_stop' | 'nearby_cluster' | 'terminal_group';
}

interface NetworkConnectionPattern {
  id: string;
  hubId: string;
  fromRoute: string;
  toRoute: string;
  dayType: 'Weekday' | 'Saturday' | 'Sunday';
  timeBand: 'am_peak' | 'midday' | 'pm_peak' | 'evening' | 'full_day';
  opportunityCount: number;
  missedCount: number;
  tightCount: number;
  goodCount: number;
  longWaitCount: number;
  medianWaitMinutes: number | null;
  score: number;
}

interface NetworkConnectionRecommendation {
  id: string;
  patternId: string;
  type: 'protect' | 'retime' | 'pulse' | 'retarget' | 'structural';
  summary: string;
  rationale: string;
  expectedBenefit: string;
  confidence: 'high' | 'medium' | 'low';
}
```

This should remain a derived analysis layer on top of:

- `MasterScheduleContent`
- `MasterRouteTable`
- `MasterTrip`
- GTFS stop and route reference data

## 15. Integration with Existing Features

### Existing Connections workflow

This feature should integrate with the existing connection library and route-level optimizer by allowing:

- `Promote to target`
- `Open in route connection setup`
- `Open affected draft in Schedule Editor`

### Headway and mapping tools

The existing corridor and junction logic should be reused where possible for:

- identifying shared corridors
- highlighting junction stops
- mapping route overlap and hub context

### Transit App transfer analytics

Phase 2 should combine schedule-based analysis with observed rider transfer patterns.

That creates a more useful priority model:

- scheduled weak + observed high volume = urgent fix
- scheduled weak + observed low volume = lower priority
- scheduled good + observed high volume = confirm and protect

## 16. MVP Scope

The MVP should stay narrow and useful.

### Included in MVP

- analyze one selected day type at a time
- use published master schedules and optionally active system draft input
- auto-discover hubs from shared and nearby stops
- rank route-pair patterns by connection quality
- show exact trip-level arrival/departure comparisons in detail panel
- generate simple recommendation categories
- support export of findings
- support handoff into existing route-level connections workflow

### Excluded from MVP

- automatic schedule rewriting
- fully optimized pulse generation across the entire network
- reliability modeling from AVL
- rider-demand weighting in the base algorithm
- multi-day calendar and holiday logic beyond existing day types

## 17. Phase 2 Expansion

- merge observed transfer demand from Transit App analytics
- weight recommendations by actual transfer volume
- factor in route reliability and late-running exposure
- allow before/after comparison between published and draft network connection quality
- add hub importance scoring

## 18. Phase 3 Expansion

- pulse design sandbox for major terminals
- network-level clockface scenario testing
- structural redesign insights for routes that cannot connect well under current service patterns
- link into Route Planner concepts for future network design work

## 19. Product Boundaries

This feature should not become:

- a public journey planner
- a dispatch control tool
- a replacement for the route-level schedule editor
- a black-box optimizer that rewrites service without planner review
- a spreadsheet-first analyst screen that hides the map behind dense tables

This feature should remain:

- a network diagnosis tool
- a recommendation engine
- a bridge between schedule analysis and schedule editing

## 20. Recommended Product Statement

Network Connections is a Fixed Route analysis workspace that scans the schedule as a network, discovers where routes actually connect, scores transfer quality across the day, and recommends the highest-value schedule actions to improve timed connections and network usability.
