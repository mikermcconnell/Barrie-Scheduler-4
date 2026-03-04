# Student Pass Enterprise Redesign — Design Document

**Date:** 2026-03-04
**Audience:** Transit Planners
**Approach:** Transit Intelligence Dashboard

---

## Vision

Transform the Student Pass workspace from a functional prototype into an enterprise-grade transit analysis tool. Dark mode command center aesthetic with animated route visualization, floating glass panel, and journey timeline bar.

---

## 1. Map Base & Theme

**Map style:** `mapbox://styles/mapbox/dark-v11`
Full-width map (no sidebar stealing space). Muted gray streets, dark water, minimal labels.

### "Midnight Operations" Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-deep` | `#0B1121` | Deepest background, panel base |
| `--bg-surface` | `#131B2E` | Card surfaces, elevated content |
| `--bg-surface-hover` | `#1A2540` | Card hover state |
| `--border-ghost` | `rgba(99, 126, 184, 0.12)` | Subtle borders |
| `--border-active` | `rgba(99, 126, 184, 0.25)` | Active/focus borders |
| `--text-primary` | `#E2E8F0` | Primary readable text |
| `--text-secondary` | `#94A3B8` | Supporting info |
| `--text-muted` | `#64748B` | Tertiary, timestamps |
| `--glow-blue` | `#3B82F6` | Origin, zone, selection |
| `--glow-emerald` | `#10B981` | Boarding stop, school, success |
| `--glow-amber` | `#F59E0B` | Transfer, PM routes, attention |

### Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| Panel headers | JetBrains Mono | 600 | 13px |
| Section labels | JetBrains Mono | 500 | 11px, uppercase, tracking-wider |
| Card body | DM Sans | 400 | 13px |
| Route badges | JetBrains Mono | 700 | 11px |
| Map labels | DM Sans | 500 | 12-14px |
| Timeline labels | JetBrains Mono | 400 | 10px |

### Map Controls

- **Bottom-right:** `NavigationControl` (zoom +/-, compass) — CSS overrides for dark theme
- **Bottom-left:** `ScaleControl` — metric, subtle
- **Top-left:** Custom layer toggle pill (moon icon / globe icon) — switches `dark-v11` ↔ `satellite-streets-v12`
- **Top-right:** DrawControl — restyled dark via `.mapboxgl-ctrl-group` CSS overrides

---

## 2. Animated Route Lines

### Three-Layer Route Rendering (AM)

```
Bottom:  Glow layer    — route color, width 12, opacity 0.15, blur
Middle:  Base line      — route color, width 6, opacity 0.9, solid
Top:     Dash overlay   — white, width 2, opacity 0.4, animated dasharray
```

**Animation:** `requestAnimationFrame` loop shifts `line-dasharray` offset to create directional "marching ants" flow. ~30px/second, flows from origin toward school.

### PM Routes

- Width 4 (thinner than AM)
- Opacity 0.6
- Same animation, reversed direction
- Glow layer at opacity 0.08

### Walking Legs

- Pattern: dotted `[2, 6]`, color `#94A3B8` (slate-400)
- Walking-person SDF icon at segment start via `symbol-layer`
- Compact pill labels: "2 min walk"
- PM walking legs: amber-tinted `#B45309` at 60% opacity

---

## 3. Markers & Points of Interest

### Origin (Zone Centroid)
- 16px circle, `--glow-blue` fill, 2px white border
- 32px outer glow ring at 20% opacity, subtle `animate-pulse`
- Label: `"Start"` MapLabel above

### Boarding Stop
- 18px circle, `--glow-emerald` fill, 3px white border, drop shadow
- Bus icon (SVG) centered
- Label: stop name in MapLabel

### Transfer Point
- 20px diamond (rotated square), `--glow-amber` fill, white border
- 3 concentric pulsing rings expanding outward (CSS `@keyframes`)
- Glass callout card connected via thin line:
  ```
  Transfer at Dundonald Street
  ─────────────────────────────
  Arrive 7:25 AM  →  Depart 7:35 AM
  10 min wait · Good · Rt 10 → Rt 11
  ```
- Left border color-coded by transfer quality

### School (Destination)
- 22px circle, white fill, 3px `--glow-emerald` border
- Graduation cap icon or "S" letter centered
- Label: school name in MapLabel size="lg"
- Subtle emerald glow ring

### Visual Hierarchy
School (22px, brightest) > Transfer (20px, attention) > Boarding (18px, clear) > Origin (16px, contextual)

### Zone Polygon
- Fill: `--glow-blue` at 10% with subtle hatch pattern
- Border: `#60A5FA`, 2px, animated slow-dash
- Vertices: blue-400 circles with white center dots

---

## 4. Floating Glass Panel

Replaces the fixed `w-72 bg-gray-50` sidebar. Overlays the map's left edge.

### Layout
```
┌──────────────────────────────────────────────────────────────────┐
│  MAP (full width, full height, dark-v11)                        │
│                                                                  │
│  ┌──────────────┐                                                │
│  │  GLASS PANEL │                                                │
│  │  w-80        │                                                │
│  │  m-4         │                                                │
│  │  rounded-xl  │                                                │
│  │  blur-xl     │                                                │
│  │  shadow-2xl  │                                                │
│  │              │                                                │
│  │  scrollable  │                                                │
│  └──────────────┘                           [zoom] [compass]    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  JOURNEY TIMELINE BAR (bottom strip)                         ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### Panel Styling
- Background: `rgba(11, 17, 33, 0.85)` (`--bg-deep` at 85%)
- `backdrop-blur-xl`
- Border: `var(--border-ghost)`
- `rounded-xl`, `shadow-2xl`
- `m-4` margin from map edges
- Collapsible via chevron to just school selector bar

### Panel Sections

1. **School selector** — custom dark dropdown, school name + bell times inline
2. **Zone status** — compact: "Zone: 8 vertices" with blue dot, or "Draw zone" prompt
3. **Route options:**
   - Section headers: `MORNING OPTIONS` / `AFTERNOON OPTIONS` in JetBrains Mono uppercase
   - Cards: `--bg-surface` with left GTFS color bar (4px)
   - Selected: route color border glow, slight `scale-[1.02]`
   - Content: route badge pills, time range, Direct/Transfer chip, walk time
4. **Summary stats** — horizontal pill badges: `Walk 2m` `Wait 10m` `Freq 15m`
5. **Export button** — full-width `--glow-emerald`, "Export PDF" with download icon

### Route Option Card Layout
```
┌────────────────────────────────────────┐
│ ▌  [Rt 10] [Rt 11]      Transfer     │
│ ▌  7:15 AM → 7:45 AM    10 min wait  │
│ ▌  Walk: 2m stop · 3m school         │
└────────────────────────────────────────┘
  ↑ 4px GTFS color bar
```

---

## 5. Journey Timeline Bar

Horizontal bar pinned to bottom of map area. Shows AM journey as proportional time segments.

```
┌────────────────────────────────────────────────────────────────────┐
│  🚶 2m │████ Rt 10 · 12 min ████│ ⟳ 10m │██ Rt 11 · 8 min ██│ 🚶 3m │
│  walk  │     GTFS color bg      │  wait  │   GTFS color bg    │  walk │
└────────────────────────────────────────────────────────────────────┘
  7:10    7:12         7:24        7:24   7:34       7:42        7:45
```

### Styling
- Background: `rgba(11, 17, 33, 0.9)` with `backdrop-blur`
- `rounded-t-lg`, `mx-4` (aligns with panel margins)
- Walk segments: `--bg-surface` with walking icon
- Ride segments: GTFS route color background, route name centered in JetBrains Mono
- Transfer wait: amber dashed border, hourglass icon
- Time labels: JetBrains Mono 10px, `--text-muted`

### Behavior
- Hidden when no result; slides up with `transition-transform` on route select
- Hover segment → corresponding map element pulses brighter
- Segment widths proportional to duration (min-width: 40px for very short segments)

---

## 6. Interactions

| Trigger | Action |
|---------|--------|
| Route option selected | `fitBounds` to full journey, 80px left padding for panel |
| Hover route card | Corresponding route line brightens on map |
| School dropdown change | `flyTo` school location smoothly |
| Zone drawn | Auto-calculate, panel shows loading spinner |
| Layer toggle click | Smooth `map.setStyle()` transition |
| Timeline segment hover | Map element glows brighter |
| Panel collapse | Chevron click minimizes to school selector bar only |

---

## 7. Files Affected

| File | Change Type |
|------|-------------|
| `components/Analytics/StudentPassModule.tsx` | Major refactor — layout, panel structure, dark theme |
| `components/Analytics/StudentPassMap.tsx` | Major refactor — layers, markers, animation, controls |
| `components/shared/MapBase.tsx` | Minor — add style prop, navigation/scale controls |
| `components/shared/MapLabel.tsx` | Minor — dark theme variant styling |
| New: `components/Analytics/StudentPassPanel.tsx` | Extract panel from module |
| New: `components/Analytics/StudentPassTimeline.tsx` | Journey timeline bar component |
| New: `components/Analytics/useRouteAnimation.ts` | Hook for line-dasharray animation |
| New: `components/Analytics/studentPass.css` | Dark theme overrides for draw controls, map controls |
| `index.html` or CSS | Add JetBrains Mono + DM Sans font imports |

---

## 8. Out of Scope

- Flyer preview panel redesign (keep as-is for now)
- 3D building extrusions
- Route playback/step-through animation
- PM journey in timeline bar (AM only for v1)
- Mobile responsive layout
