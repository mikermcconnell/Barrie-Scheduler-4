# Shuttle Planner UI Spec

> Date: March 11, 2026
> Status: Draft
> Visual reference: `components/workspaces/OnDemandWorkspace.tsx`

## 1. Intent

This document translates the Shuttle Planner PRD into a concrete screen design and implementation-ready UI structure.

The Shuttle Planner should inherit the Transit On Demand workspace theme and interaction density, while reorganizing the page around a map-first workflow.

## 2. Design Thesis

Build a planning workspace that feels like the Transit On Demand module in tone and polish, but make the map the operational center of gravity.

This means:

- strong workspace header
- white rounded cards with visible borders
- compact action clusters
- color-coded status and KPI surfaces
- clear selected-state styling
- minimal floating map chrome

## 3. Primary Screen

### 3.1 Desktop Layout

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Workspace Header                                                           │
│ Back | Project Name | Scenario Picker | Save | Duplicate | Compare | Export│
├───────────────┬───────────────────────────────────────┬─────────────────────┤
│ Left Rail     │ Map Canvas                            │ Right Rail          │
│               │                                       │                     │
│ Project List  │  Road-snapped shuttle alignment       │ Service Pattern     │
│ Scenario List │  Stops, terminals, arrows, overlays   │ Span + Frequency    │
│ Stop List     │  Existing routes / hubs optional      │ Runtime + Layover   │
│ Selected Stop │                                       │ Live Metrics        │
│ Route Tools   │                                       │ Warnings            │
│               │                                       │ Timetable Preview   │
├───────────────┴───────────────────────────────────────┴─────────────────────┤
│ Compare Drawer / Notes / Validation Details                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Narrow Viewport Layout

On narrower widths, the page should shift to:

1. header
2. map
3. segmented toggle for `Stops | Service | Timetable | Compare`
4. stacked detail panel

The map should remain visible near the top of the viewport. Do not bury the map below long forms.

## 4. Visual Direction

### 4.1 Theme Reference

Adopt the same visual language used in the Transit On Demand workspace:

- `bg-gray-50` and `bg-gray-100` workspace surfaces
- `bg-white` card surfaces
- `rounded-2xl` and `rounded-3xl` containers
- `border-2 border-gray-200` for primary cards
- bold headings and strong button hierarchy
- compact segmented controls with active white pill states

### 4.2 Color Roles

Use the same logic as On Demand:

| Role | UI Use |
|------|--------|
| Brand blue | selection, active tabs, primary map-linked actions |
| Green | feasible service, publish/export-ready state |
| Amber | warnings, recovery or feasibility concerns |
| Purple/indigo | scenario comparison, planning intelligence, alternate option states |
| Gray | structural UI, neutral panels, inactive controls |

### 4.3 Card Hierarchy

There should be three visible card tiers:

| Tier | Treatment | Use |
|------|-----------|-----|
| Primary | white, rounded-3xl, border-2 | map container, major side panels |
| Secondary | tinted background, rounded-2xl, border-2 | KPIs, warnings, selected item details |
| Tertiary | soft gray or white pill | tabs, filters, status tags |

## 5. Workspace Header

### 5.1 Header Content

The top header should feel similar to the Transit On Demand title/action row.

Include:

- back navigation
- editable project name
- scenario badge or dropdown
- save action
- duplicate scenario
- compare toggle
- export action
- optional status chip such as `Draft`, `Ready for Review`

### 5.2 Header Layout Rules

- Project title should be large and editable inline.
- Action buttons should be grouped into compact bordered clusters.
- Primary action should remain visible on first load.
- Compare mode should be a visible state, not a hidden secondary action.

## 6. Left Rail

### 6.1 Left Rail Purpose

The left rail manages objects. The user should understand what exists in the project and what is currently selected.

### 6.2 Left Rail Sections

#### Project and scenario panel

Contents:

- current project
- scenario list
- add scenario
- duplicate
- rename
- delete
- mark preferred scenario

#### Stop list panel

Contents:

- ordered stop list
- stop source indicator: Barrie or Custom
- terminal/timed stop badges
- drag handles or move controls
- add stop action

#### Selected object panel

Contents vary by selection:

- selected stop details
- selected route segment details
- selected terminal properties

### 6.3 Left Rail Interaction Rules

- Selecting a stop in the left rail highlights it on the map.
- Selecting a stop on the map scrolls and highlights it in the stop list.
- Reordering stops updates map numbering and timetable logic immediately.

## 7. Map Canvas

### 7.1 Role

The map is the primary authoring surface. It should be visually dominant and operationally clear.

### 7.2 Required Layers

| Layer | Purpose |
|------|---------|
| Road-snapped shuttle alignment | primary route path |
| Shuttle stops | ordered stop points |
| Terminal markers | route start/end emphasis |
| Direction arrows | clarify movement and pattern |
| Existing Barrie stops | selectable context layer |
| Existing fixed-route overlay | optional planning context |
| Hubs or anchors | GO, terminals, venues, lots |

### 7.3 Required Map Controls

- add waypoint mode
- add stop mode
- move/edit mode
- delete selected item
- compare overlay toggle
- reset extent
- basemap/context toggle if needed

Map controls should be consolidated in one corner and kept visually quiet.

### 7.4 Map Selection Rules

- Selected stop must be unmistakable.
- Hover may preview, but selection must persist until changed.
- Compare overlays should use different accent colors and line styles.
- Barrie stops and custom stops must be visually distinct.

### 7.5 Map Interaction Model

#### Alignment building

1. User enters route edit mode.
2. User clicks to place ordered waypoints.
3. System generates a road-snapped line between points.
4. User can insert or move waypoints.
5. System preserves route continuity.

#### Stop placement

User can add stops in two ways:

- click an existing Barrie stop
- place a custom stop on the route

The system should encourage route-adjacent stops and warn when a stop is materially off the alignment.

## 8. Right Rail

### 8.1 Right Rail Purpose

The right rail translates the map concept into an operating concept.

### 8.2 Right Rail Sections

#### Service pattern card

Contents:

- loop or out-and-back selector
- pattern description
- terminal logic summary

#### Service assumptions card

Contents:

- first departure
- last departure
- frequency
- layover/recovery
- runtime mode
- route-level or segment-level runtime inputs

#### Metrics card

Contents:

- route distance
- estimated runtime
- cycle time
- buses required
- service hours

This section should visually resemble the On Demand KPI cards.

#### Warnings card

Contents:

- infeasible headway
- insufficient recovery
- stop spacing concern
- incomplete route definition

Warnings should use amber-tinted cards and plain language.

#### Timetable preview card

Contents:

- first few departures
- key timed stops
- arrival and departure rhythm
- loop or inbound/outbound grouping

## 9. Compare Mode

### 9.1 Entry

Compare mode is activated from the header.

### 9.2 Layout Behavior

When active:

- the map shows at least two scenario overlays
- the left rail shows scenario visibility toggles
- the right rail swaps from single-scenario metrics to compare view

### 9.3 Compare Panel

The compare panel should include:

| Field | Scenario A | Scenario B |
|------|------------|------------|
| Distance | value | value |
| Runtime | value | value |
| Cycle Time | value | value |
| Buses Required | value | value |
| Service Hours | value | value |
| Stop Count | value | value |

If space allows, include a small delta indicator.

## 10. Key States

### 10.1 Empty State

When the user has no project:

- show a strong onboarding card
- offer `New Shuttle Project`
- show 2 or 3 sample use cases

### 10.2 No Alignment State

If the project exists but the route is not built:

- keep the map visible
- show a clear prompt to start drawing
- do not replace the map with a blank placeholder page

### 10.3 Incomplete Service Definition

If the route exists but service assumptions are incomplete:

- show partial metrics where possible
- disable final timetable generation
- explain what is missing

### 10.4 Review-Ready State

When the scenario has route, stops, service assumptions, and a valid timetable:

- show green readiness cues
- allow export
- allow promotion to downstream workflow later

## 11. Proposed Component Inventory

| Component | Responsibility |
|------|----------------|
| `ShuttlePlannerWorkspace` | page shell and state orchestration |
| `ShuttleWorkspaceHeader` | title, scenario selection, actions |
| `ShuttleProjectSidebar` | projects and scenarios |
| `ShuttleStopPanel` | ordered stop management |
| `ShuttleMapCanvas` | route and stop editing |
| `ShuttleMapToolbar` | editing tools |
| `ShuttleServicePanel` | operating assumptions |
| `ShuttleMetricsPanel` | KPI cards |
| `ShuttleWarningsPanel` | validation and warnings |
| `ShuttleTimetablePanel` | draft timetable |
| `ShuttleComparisonPanel` | compare table and toggles |
| `ShuttleExportModal` | concept summary export |

## 12. Suggested Implementation Order

### Step 1

Build the static workspace shell using the Transit On Demand theme:

- header
- left rail
- map card
- right rail

### Step 2

Implement map selection and object synchronization:

- stop list selection
- map selection
- selected-state styling

### Step 3

Add route authoring:

- waypoint mode
- road snap rendering
- stop creation flows

### Step 4

Add service cards and live KPI surfaces.

### Step 5

Add timetable preview and compare mode.

## 13. Implementation Notes

The Shuttle Planner should reuse the visual grammar of:

- [OnDemandWorkspace.tsx](/C:/Users/Mike%20McConnell/Documents/mike_apps/Scheduler%204/components/workspaces/OnDemandWorkspace.tsx)
- [WorkspaceHeader.tsx](/C:/Users/Mike%20McConnell/Documents/mike_apps/Scheduler%204/components/layout/WorkspaceHeader.tsx)
- [MapBase.tsx](/C:/Users/Mike%20McConnell/Documents/mike_apps/Scheduler%204/components/shared/MapBase.tsx)

The feature should not attempt a bespoke design system in v1. The goal is to make the Shuttle Planner feel like a native part of the current product family on first release.
