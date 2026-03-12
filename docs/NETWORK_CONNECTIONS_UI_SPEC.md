# Network Connections UI Spec

> Date: March 11, 2026
> Status: Draft
> Visual direction: Friendly design theme
> Product companion: `docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md`

## 1. Intent

This document turns the Network Connections feature direction into a concrete, map-first workspace structure for design and implementation.

The feature should feel like a natural extension of Scheduler 4 Planning Data: warm, operational, readable, and spatially led.

## 2. Design Thesis

Build a map-first network analysis workspace where the map is the center of gravity and the side panels explain what the map means.

The workspace should:

- make transfer hubs visible immediately
- keep route-pair issues legible at a glance
- show recommendations as part of the operational workflow
- preserve the Friendly design feel instead of drifting into generic GIS chrome

## 3. Primary Screen

### 3.1 Desktop layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Workspace Header                                                            │
│ Back | Network Connections | Source | Day Type | Time Band | Filters | Export │
├────────────────┬──────────────────────────────────────────┬──────────────────┤
│ Left Rail      │ Map Canvas                               │ Right Rail       │
│                │                                          │                  │
│ Hub ranking    │ Transfer hubs                            │ Selected hub     │
│ Route pairs    │ Route overlays                           │ KPI cards        │
│ Filters        │ Severity markers                         │ Repeated pattern │
│ Saved targets  │ Hover and selection state                │ Recommendations  │
├────────────────┴──────────────────────────────────────────┴──────────────────┤
│ Bottom Drawer: trip-level pattern table, before/after preview, notes        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Narrow viewport layout

On narrower widths:

1. header
2. map
3. segmented toggle
4. stacked detail content

Recommended narrow-screen tabs:

- `Hubs`
- `Details`
- `Actions`
- `Trips`

The map should remain visible near the top of the viewport.

## 4. Friendly Theme Rules

### 4.1 Visual system

Use the Friendly design theme across the full experience:

- soft gray workspace background
- white main cards with strong borders
- rounded-2xl and rounded-3xl surfaces
- compact control trays
- tinted metric and warning cards
- clear selected-state styling

### 4.2 Design rule

The visual rule should be:

> operational warmth, not GIS software

That means:

- no floating control clutter in map corners
- no flat admin tables dominating the first viewport
- no low-contrast borderless cards
- no ambiguous selection state

## 5. Workspace Header

The header should include:

- back navigation
- workspace title
- schedule source picker
- day type selector
- time band selector
- issue filter tray
- export action
- open-in-editor action when relevant

Layout rules:

- title should be visually dominant
- filters should live in compact grouped trays
- active filters must be visible without opening a modal
- actions should sit in a compact right-aligned cluster

## 6. Left Rail

### 6.1 Purpose

The left rail answers:

- what hubs matter most
- which route pairs are failing
- what filters are active

### 6.2 Sections

#### Hub ranking

- ranked list of hubs
- severity dot or chip
- route count
- top recommendation summary

#### Route-pair ranking

- `Route A -> Route B`
- selected stop or hub
- miss rate
- median wait
- time band badge

#### Saved or promotable targets

- saved intentional connections
- discovered candidates ready for promotion

## 7. Map Canvas

### 7.1 Role

The map is the primary analysis surface and should dominate the workspace visually.

### 7.2 Core layers

| Layer | Purpose |
|------|---------|
| Transfer hubs | Primary clickable markers |
| Route overlays | Show connected services |
| Severity halo | Emphasize problem hubs |
| Selected hub highlight | Strong active state |
| Nearby stop cluster outline | Explain non-exact transfer hubs |
| Optional corridor context | Show nearby shared corridor structure |

### 7.3 Map behavior

- clicking a hub selects it and opens right-rail detail
- hovering highlights the same hub in the left rail
- selecting a route pair filters the map to relevant hubs
- reset extent is always available
- legends stay compact and visually quiet

### 7.4 Marker system

- blue = selected
- green = strong connection
- amber = mixed or tight
- red = repeated misses
- indigo/violet = compare or planning overlays later

Marker size should reflect importance or opportunity count, not just route count.

## 8. Right Rail

### 8.1 Purpose

The right rail turns the selected map object into an operational story.

### 8.2 Sections

#### Hub summary

- hub name
- routes involved
- issue level
- active time bands

#### KPI cards

- opportunity count
- miss rate
- median wait
- recommendation confidence

#### Pattern summary

- repeated route pairs
- key missed windows
- strongest successful patterns

#### Recommendation cards

Each card should contain:

- recommendation type
- one-line action
- short rationale
- expected benefit
- action buttons if available

## 9. Bottom Drawer

The bottom drawer should hold denser trip-level information that would overcrowd the side rails.

Suggested contents:

- arrival vs departure pattern table
- before/after retime preview
- exact trip pairs by time band
- planner notes or export summary

The drawer should default closed or half-open, not dominate the first viewport.

## 10. States

### 10.1 Empty state

- show a full workspace shell
- explain that no hubs or schedules are available
- keep the map frame visible

### 10.2 Loading state

- keep the map card and panel shells visible
- use light skeletons or centered loading blocks

### 10.3 Dense data state

- cluster or aggregate markers
- push deeper details into right rail and drawer
- keep popups short

## 11. Compare Mode Later

Compare mode should allow the planner to see:

- published network vs draft network
- changed miss rate by hub
- changed median wait by route pair
- recommendations that improved or worsened

Use indigo or violet accents for compare overlays rather than replacing the main severity colors.

## 12. Implementation Note

The first build should prioritize:

- strong map hierarchy
- synchronized selection between map and rails
- compact Friendly-theme shell
- legible recommendation cards

Do not begin with a table-heavy prototype and try to layer a map onto it later.
