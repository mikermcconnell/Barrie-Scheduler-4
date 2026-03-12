# Network Connections Build Plan

> Date: March 11, 2026
> Goal: Build a map-first Network Connections workspace in Planning Data using the Friendly design theme and existing schedule/map primitives

## 1. Current Code Position

The best landing zone is the existing Planning Data area inside Fixed Route.

Current workspace and routing files:

- `components/workspaces/FixedRouteWorkspace.tsx`
- `components/Analytics/AnalyticsDashboard.tsx`

Relevant map and analytics foundations already in the repo:

- `components/shared/MapBase.tsx`
- `components/shared/RouteOverlay.tsx`
- `components/shared/StopDotLayer.tsx`
- `components/Mapping/HeadwayMap.tsx`
- `utils/gtfs/corridorBuilder.ts`
- `utils/gtfs/gtfsStopLookup.ts`

Relevant schedule and connections foundations:

- `utils/parsers/masterScheduleParser.ts`
- `utils/masterScheduleTypes.ts`
- `utils/connections/connectionTypes.ts`
- `utils/connections/connectionOptimizer.ts`
- `components/connections/ConnectionStatusPanel.tsx`

Relevant future weighting input:

- `components/Analytics/TransfersModule.tsx`
- `utils/transit-app/transitAppTransferAnalysis.ts`

## 2. Strategic Build Direction

Do not build this as a spreadsheet-first report.

Instead:

1. create a map-first workspace shell first
2. build the derived network analysis service behind it
3. make hub selection, route-pair ranking, and recommendation cards the core interaction loop
4. connect the analysis back into existing schedule-editing flows

The first impression should be:

- I can see the network
- I can see where it fails
- I can act on it

## 3. Recommended Delivery Phases

### Phase 0: Establish the data contract

Objective:

- define the derived analysis types before building UI

Primary tasks:

- create `utils/network-connections/networkConnectionTypes.ts`
- define hub, pattern, issue-summary, and recommendation types
- define schedule-source input contract:
  - published master schedules
  - active system draft
  - selected draft set later if needed
- define default transfer thresholds and time-band buckets

Definition of done:

- the analysis layer has stable, typed output the UI can consume

### Phase 1: Build the map-first shell and hub discovery

Objective:

- get a real workspace on screen with a live map and selectable hubs

Primary tasks:

- add a new `Network Connections` entry to Planning Data
- create `components/Analytics/NetworkConnectionsWorkspace.tsx`
- create left rail, center map, and right rail shell components
- build first-pass hub discovery:
  - shared stop IDs
  - nearby stop clusters
  - terminal grouping support hook
- render hubs on the map with basic severity placeholders

Primary reuse:

- `components/shared/MapBase.tsx`
- `components/shared/StopDotLayer.tsx`
- `utils/gtfs/gtfsStopLookup.ts`

Definition of done:

- planners can open a Friendly-theme map workspace and inspect discovered hubs

### Phase 2: Add route-pair scoring and detail views

Objective:

- turn discovered hubs into real operational analysis

Primary tasks:

- create `utils/network-connections/networkConnectionAnalysis.ts`
- generate route-to-route opportunities for each hub
- classify results as missed, tight, good, or long
- summarize by route pair, hub, time band, and day type
- build detail panel and trip-pattern drawer

Definition of done:

- a user can click a hub and understand repeated transfer behavior

### Phase 3: Add recommendation engine and actions

Objective:

- move from diagnosis into guided intervention

Primary tasks:

- create `utils/network-connections/networkConnectionRecommendations.ts`
- generate recommendation types:
  - protect
  - retime
  - pulse
  - retarget
  - structural
- surface recommendation cards in the right rail
- add actions:
  - promote to target
  - open in editor
  - copy summary

Definition of done:

- the workspace produces useful schedule actions, not just metrics

### Phase 4: Add draft comparison and schedule-editor handoff

Objective:

- make the tool part of real schedule-change workflow

Primary tasks:

- compare published network vs active system draft
- show changed severity by hub and route pair
- link directly into relevant draft or route connection setup
- preserve selection context when opening downstream views

Definition of done:

- planners can validate whether a draft improves the network before publishing

### Phase 5: Add observed transfer weighting

Objective:

- prioritize the issues that matter most to riders

Primary tasks:

- merge observed transfer signals from Transit App analytics
- weight recommendations by observed transfer demand
- flag high-volume weak connections
- flag low-volume weak connections as secondary

Definition of done:

- recommendation ranking reflects both schedule quality and rider relevance

## 4. Key Design Principles

- The map is the primary surface.
- Side rails explain and act on map selection.
- Friendly theme stays intact across all phases.
- Selection must sync between map, lists, and detail.
- Dense trip tables belong in a drawer, not the first viewport.
- Recommendation cards should read like planner actions, not raw algorithm output.

## 5. Recommended File Strategy

### New UI files

- `components/Analytics/NetworkConnectionsWorkspace.tsx`
- `components/NetworkConnections/NetworkConnectionsFilterBar.tsx`
- `components/NetworkConnections/HubRankingPanel.tsx`
- `components/NetworkConnections/NetworkConnectionsMap.tsx`
- `components/NetworkConnections/ConnectionDetailPanel.tsx`
- `components/NetworkConnections/ConnectionRecommendationPanel.tsx`
- `components/NetworkConnections/ConnectionTripsDrawer.tsx`

### New domain files

- `utils/network-connections/networkConnectionTypes.ts`
- `utils/network-connections/networkConnectionAnalysis.ts`
- `utils/network-connections/networkConnectionRecommendations.ts`
- `utils/network-connections/networkConnectionHubDiscovery.ts`

### Reuse first

- `components/shared/MapBase.tsx`
- `components/shared/RouteOverlay.tsx`
- `components/shared/StopDotLayer.tsx`
- `utils/gtfs/corridorBuilder.ts`
- `utils/gtfs/gtfsStopLookup.ts`
- `utils/connections/connectionTypes.ts`

## 6. Suggested Implementation Order

1. define derived analysis types
2. add Planning Data entry point and workspace shell
3. build hub discovery
4. render selectable hubs on the map
5. add route-pair scoring and ranking
6. build right-rail detail view
7. add recommendation engine
8. add editor handoff actions
9. add published-vs-draft compare
10. add observed transfer weighting

## 7. Immediate Next Step

The best immediate build step is:

1. create the derived analysis types and hub-discovery utility
2. scaffold a Friendly-theme `NetworkConnectionsWorkspace`
3. wire it into `components/Analytics/AnalyticsDashboard.tsx`

That gives the feature a real home in the app and forces the data contract to become concrete early.
