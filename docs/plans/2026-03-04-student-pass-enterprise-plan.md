# Student Pass Enterprise Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Student Pass workspace into a dark-mode enterprise transit intelligence dashboard with animated route lines, floating glass panel, journey timeline, and premium marker hierarchy.

**Architecture:** Extract the left panel into a floating overlay component (`StudentPassPanel`), add a journey timeline bar (`StudentPassTimeline`), create a route animation hook (`useRouteAnimation`), and restyle everything to a "Midnight Operations" dark theme. The map becomes full-width with overlaid UI elements.

**Tech Stack:** React 19, react-map-gl/mapbox, Mapbox GL JS, Tailwind CSS, JetBrains Mono + DM Sans fonts, CSS animations

**Design Doc:** `docs/plans/2026-03-04-student-pass-enterprise-design.md`

---

## Task 1: Add Fonts and CSS Foundation

**Files:**
- Modify: `index.html:10` (add font imports)
- Create: `components/Analytics/studentPass.css` (dark theme overrides)

**Step 1: Add JetBrains Mono and DM Sans to index.html**

In `index.html` at line 10 (after existing Nunito import), add:

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Step 2: Create studentPass.css with dark overrides**

Create `components/Analytics/studentPass.css`:

```css
/* Student Pass Enterprise Dark Theme */

/* Mapbox Draw Control dark overrides */
.student-pass-dark .mapboxgl-ctrl-group {
  background: rgba(11, 17, 33, 0.85);
  border: 1px solid rgba(99, 126, 184, 0.15);
  backdrop-filter: blur(12px);
}
.student-pass-dark .mapboxgl-ctrl-group button {
  filter: invert(1);
}
.student-pass-dark .mapboxgl-ctrl-group button + button {
  border-top-color: rgba(99, 126, 184, 0.15);
}

/* Navigation Control dark overrides */
.student-pass-dark .mapboxgl-ctrl-nav .mapboxgl-ctrl-compass .mapboxgl-ctrl-icon {
  filter: invert(1);
}
.student-pass-dark .mapboxgl-ctrl-nav button {
  filter: invert(1);
}
.student-pass-dark .mapboxgl-ctrl-scale {
  background: rgba(11, 17, 33, 0.7);
  color: #94A3B8;
  border-color: rgba(99, 126, 184, 0.3);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}

/* Transfer pulse animation */
@keyframes transfer-pulse {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}
.transfer-ring {
  animation: transfer-pulse 2s ease-out infinite;
}
.transfer-ring-delayed {
  animation: transfer-pulse 2s ease-out infinite 0.6s;
}
.transfer-ring-delayed-2 {
  animation: transfer-pulse 2s ease-out infinite 1.2s;
}

/* Zone polygon animated border */
@keyframes zone-dash-rotate {
  to { stroke-dashoffset: -20; }
}

/* Panel slide-in */
@keyframes panel-slide-in {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}
.panel-enter {
  animation: panel-slide-in 0.3s ease-out;
}

/* Timeline slide-up */
@keyframes timeline-slide-up {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}
.timeline-enter {
  animation: timeline-slide-up 0.3s ease-out;
}

/* Custom scrollbar for dark panel */
.dark-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.dark-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.dark-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(99, 126, 184, 0.2);
  border-radius: 3px;
}
.dark-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(99, 126, 184, 0.35);
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS (CSS file is standalone, no component imports yet)

**Step 4: Commit**

```bash
git add index.html components/Analytics/studentPass.css
git commit -m "chore: add JetBrains Mono + DM Sans fonts and dark theme CSS"
```

---

## Task 2: Update MapBase to Support Dark Mode and Controls

**Files:**
- Modify: `components/shared/MapBase.tsx` (add mapRef, NavigationControl, ScaleControl, onStyleChange support)

**Step 1: Update MapBase props and add controls**

In `components/shared/MapBase.tsx`, update the full file:

- Add `NavigationControl` and `ScaleControl` imports from `react-map-gl/mapbox`
- Add props: `showNavigation?: boolean`, `showScale?: boolean`, `mapRef?: React.Ref<MapRef>`
- Add `NavigationControl` (position bottom-right) when `showNavigation` is true
- Add `ScaleControl` (position bottom-left) when `showScale` is true
- Forward `mapRef` to the `<Map>` component via the `ref` prop

New prop interface:
```ts
import { Map, NavigationControl, ScaleControl, MapRef } from 'react-map-gl/mapbox';

export interface MapBaseProps {
    longitude?: number;
    latitude?: number;
    zoom?: number;
    mapStyle?: string;
    interactive?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    onLoad?: () => void;
    showNavigation?: boolean;  // NEW
    showScale?: boolean;       // NEW
    mapRef?: React.RefObject<MapRef | null>;  // NEW
}
```

Add inside `<Map>` children, before `{children}`:
```tsx
{showNavigation && <NavigationControl position="bottom-right" />}
{showScale && <ScaleControl position="bottom-left" unit="metric" />}
```

Add `ref={mapRef}` to the `<Map>` element.

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add components/shared/MapBase.tsx
git commit -m "feat(map): add NavigationControl, ScaleControl, and mapRef to MapBase"
```

---

## Task 3: Update MapLabel for Dark Theme Typography

**Files:**
- Modify: `components/shared/MapLabel.tsx` (update font to DM Sans, add variant prop)

**Step 1: Update MapLabel styling**

In `components/shared/MapLabel.tsx`:

- Change `fontFamily` in the inline style from `'system-ui, -apple-system, sans-serif'` to `'DM Sans, sans-serif'`
- Add an optional `mono?: boolean` prop — when true, use `'JetBrains Mono, monospace'` instead
- Keep all existing behavior (bgColor, borderColor, size classes)

Updated props:
```ts
export interface MapLabelProps {
    text: string;
    subtitle?: string;
    size?: 'sm' | 'md' | 'lg';
    borderColor?: string;
    bgColor?: string;
    mono?: boolean;  // NEW — uses JetBrains Mono when true
}
```

Update the style line:
```ts
fontFamily: mono ? "'JetBrains Mono', monospace" : "'DM Sans', sans-serif",
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add components/shared/MapLabel.tsx
git commit -m "feat(map): update MapLabel font to DM Sans with optional mono variant"
```

---

## Task 4: Create useRouteAnimation Hook

**Files:**
- Create: `components/Analytics/useRouteAnimation.ts`

**Step 1: Implement the animation hook**

This hook drives the "marching ants" directional dash animation on route lines by cycling a `dashOffset` value via `requestAnimationFrame`.

```ts
import { useState, useEffect, useRef, useCallback } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

interface AnimationConfig {
  /** Mapbox layer IDs to animate */
  layerIds: string[];
  /** Pixels per second for dash flow */
  speed?: number;
  /** Whether animation is active */
  enabled?: boolean;
}

/**
 * Animates line-dasharray on Mapbox layers to create directional flow.
 * Uses requestAnimationFrame for smooth 60fps animation.
 */
export function useRouteAnimation(
  mapRef: React.RefObject<MapRef | null>,
  config: AnimationConfig
) {
  const { layerIds, speed = 30, enabled = true } = config;
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || layerIds.length === 0) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    startTimeRef.current = performance.now();

    const animate = (timestamp: number) => {
      const elapsed = (timestamp - startTimeRef.current) / 1000;
      const offset = (elapsed * speed) % 20;

      // Dash pattern: 4px dash, 16px gap — offset shifts the pattern
      const dashLength = 4;
      const gapLength = 16;

      for (const layerId of layerIds) {
        if (map.getLayer(layerId)) {
          try {
            map.setPaintProperty(layerId, 'line-dasharray', [
              Math.max(0.1, dashLength - offset % (dashLength + gapLength)),
              gapLength + (offset % (dashLength + gapLength)),
              dashLength + (offset % (dashLength + gapLength)),
              0.1,
            ]);
          } catch {
            // Layer may not exist yet during transitions
          }
        }
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [mapRef, layerIds, speed, enabled]);
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add components/Analytics/useRouteAnimation.ts
git commit -m "feat(map): add useRouteAnimation hook for directional dash flow"
```

---

## Task 5: Create StudentPassPanel Component (Floating Glass Panel)

**Files:**
- Create: `components/Analytics/StudentPassPanel.tsx`
- Reference: `components/Analytics/StudentPassModule.tsx:303-555` (existing panel JSX to extract and restyle)

**Step 1: Create the floating glass panel component**

Extract the left panel from `StudentPassModule.tsx` lines 303-555 into a new component. Restyle from light `bg-gray-50` to dark glass-morphism.

The panel receives the same props that the inline JSX currently uses:
- `selectedSchoolId`, `onSchoolChange`
- `bellStart`, `bellEnd`, `onBellStartChange`, `onBellEndChange`
- `effectiveBellStart`, `effectiveBellEnd`
- `polygon`, `isCalculating`
- `tripOptions`, `result`
- `selectedMorningIdx`, `selectedAfternoonIdx`, `onMorningSelect`, `onAfternoonSelect`
- `onExport`, `isExporting`
- `selectedSchool` (full SchoolConfig)

Key styling changes from the existing code:

| Existing | New |
|----------|-----|
| `w-72 bg-gray-50 border-r border-gray-200` | `w-80 m-4 rounded-xl shadow-2xl` + glass effect inline styles |
| `bg-white border border-gray-200 rounded-lg` (option cards) | `bg-[#131B2E] border border-[rgba(99,126,184,0.12)] rounded-lg` |
| `text-gray-700`, `text-gray-500` | `text-[#E2E8F0]`, `text-[#94A3B8]` |
| `border-blue-500 bg-blue-50` (selected AM) | route-color border glow, `bg-[#1A2540]` |
| `border-amber-500 bg-amber-50` (selected PM) | route-color border glow, `bg-[#1A2540]` |
| `bg-amber-600` (export button) | `bg-emerald-500 hover:bg-emerald-600` |
| System font | `font-['DM_Sans']` body, `font-['JetBrains_Mono']` headers |

Panel container styling:
```tsx
<div className="absolute top-4 left-4 bottom-20 w-80 z-10 rounded-xl shadow-2xl overflow-hidden panel-enter"
     style={{
       background: 'rgba(11, 17, 33, 0.85)',
       backdropFilter: 'blur(20px)',
       WebkitBackdropFilter: 'blur(20px)',
       border: '1px solid rgba(99, 126, 184, 0.12)',
     }}>
```

Section headers use JetBrains Mono uppercase:
```tsx
<h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]"
    style={{ fontFamily: "'JetBrains Mono', monospace" }}>
  Morning Options
</h3>
```

Route option cards:
```tsx
<button
  className={`w-full text-left rounded-lg p-3 transition-all ${
    isSelected
      ? 'scale-[1.02] shadow-lg'
      : 'hover:bg-[#1A2540]'
  }`}
  style={{
    background: isSelected ? '#1A2540' : '#131B2E',
    border: isSelected
      ? `1px solid ${routeColor}`
      : '1px solid rgba(99, 126, 184, 0.12)',
    borderLeft: `4px solid ${routeColor}`,
    boxShadow: isSelected ? `0 0 20px ${routeColor}33` : undefined,
  }}
>
```

Route badge pills:
```tsx
<span className="text-[11px] font-bold px-2 py-0.5 rounded"
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        background: routeColor,
        color: '#fff',
      }}>
  Rt {name}
</span>
```

The panel should include a collapse/expand chevron button at the top-right that toggles between full panel and a minimized state (just school name bar visible).

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS (component is defined but not yet imported anywhere)

**Step 3: Commit**

```bash
git add components/Analytics/StudentPassPanel.tsx
git commit -m "feat(student-pass): create floating glass StudentPassPanel component"
```

---

## Task 6: Create StudentPassTimeline Component

**Files:**
- Create: `components/Analytics/StudentPassTimeline.tsx`
- Reference: `utils/transit-app/studentPassUtils.ts` for `minutesToDisplayTime` and `StudentPassResult` type

**Step 1: Implement the journey timeline bar**

The timeline shows the AM journey as proportional-width segments:

```tsx
import React from 'react';
import { StudentPassResult, minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';

interface TimelineProps {
  result: StudentPassResult;
  onSegmentHover?: (segmentType: 'walk' | 'ride' | 'transfer' | null, index?: number) => void;
}
```

Build timeline segments from `result`:
1. Walk to stop: `result.walkToStop.walkMinutes`
2. For each `result.morningLegs[i]`: ride duration = `arrivalMinutes - departureMinutes`
3. Between legs (if transfer): `result.transfer.waitMinutes`
4. Walk to school: `result.walkToSchool.walkMinutes`

Each segment gets proportional `flex` value based on duration (with `min-width: 40px`).

Segment styling:
- **Walk**: `bg-[#1A2540]`, walking icon (🚶 or Footprints from lucide), slate text
- **Ride**: GTFS route color background, white text, route name centered
- **Transfer wait**: amber dashed border `border-dashed border-[#F59E0B]`, hourglass icon

Container:
```tsx
<div className="absolute bottom-0 left-0 right-0 mx-4 mb-4 rounded-t-lg z-10 timeline-enter"
     style={{
       background: 'rgba(11, 17, 33, 0.9)',
       backdropFilter: 'blur(16px)',
       WebkitBackdropFilter: 'blur(16px)',
       border: '1px solid rgba(99, 126, 184, 0.12)',
       borderBottom: 'none',
     }}>
```

Time labels below segments in JetBrains Mono 10px `text-[#64748B]`.

The component returns `null` when no result (hidden state) and slides in via `.timeline-enter` CSS class.

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add components/Analytics/StudentPassTimeline.tsx
git commit -m "feat(student-pass): create journey timeline bar component"
```

---

## Task 7: Rewrite StudentPassMap with Enterprise Layers

**Files:**
- Modify: `components/Analytics/StudentPassMap.tsx` (major rewrite — new layers, markers, animation)

This is the largest task. Key changes to `StudentPassMap.tsx`:

**Step 1: Update imports**

Add at top:
```ts
import { useRef } from 'react';
import { NavigationControl, ScaleControl, MapRef } from 'react-map-gl/mapbox';
import { useRouteAnimation } from './useRouteAnimation';
import './studentPass.css';
```

**Step 2: Change map style to dark-v11**

In the `<MapBase>` element (currently line ~256), change:
- `mapStyle="mapbox://styles/mapbox/satellite-streets-v12"` → `mapStyle={mapStyle}` where `mapStyle` is state (`dark-v11` default)
- Add `showNavigation={true}` `showScale={true}`
- Add `mapRef={mapRef}` with `const mapRef = useRef<MapRef>(null)`
- Wrap outer div with class `student-pass-dark` for CSS overrides

**Step 3: Add layer toggle**

Add a small floating toggle button (top-left) to switch between `dark-v11` and `satellite-streets-v12`:

```tsx
const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');
const isDark = mapStyle.includes('dark');

// In JSX, before DrawControl:
<div className="absolute top-4 left-4 z-10 flex rounded-lg overflow-hidden"
     style={{ background: 'rgba(11, 17, 33, 0.85)', border: '1px solid rgba(99, 126, 184, 0.15)' }}>
  <button onClick={() => setMapStyle('mapbox://styles/mapbox/dark-v11')}
          className={`px-3 py-2 text-xs ${isDark ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}>
    <Moon size={14} />
  </button>
  <button onClick={() => setMapStyle('mapbox://styles/mapbox/satellite-streets-v12')}
          className={`px-3 py-2 text-xs ${!isDark ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}>
    <Globe size={14} />
  </button>
</div>
```

**Step 4: Replace route line layers with 3-layer glow system**

For each AM route shape, instead of one `routeLineLayer`, create three layers:

```ts
// Glow layer (bottom)
const glowLayer = (id: string, color: string): LayerProps => ({
  id: `${id}-glow`,
  type: 'line',
  paint: {
    'line-color': color,
    'line-width': 12,
    'line-opacity': 0.15,
    'line-blur': 4,
  },
});

// Base layer (middle)
const baseLayer = (id: string, color: string): LayerProps => ({
  id: `${id}-base`,
  type: 'line',
  paint: {
    'line-color': color,
    'line-width': 6,
    'line-opacity': 0.9,
  },
});

// Animated dash overlay (top) — dasharray driven by useRouteAnimation
const dashOverlay = (id: string): LayerProps => ({
  id: `${id}-dash`,
  type: 'line',
  paint: {
    'line-color': '#ffffff',
    'line-width': 2,
    'line-opacity': 0.4,
    'line-dasharray': [4, 16],
  },
});
```

Collect all `-dash` layer IDs into an array and pass to `useRouteAnimation`.

For PM routes, use same 3-layer system but with lower opacities:
- Glow: opacity 0.08
- Base: width 4, opacity 0.6
- Dash: opacity 0.25

**Step 5: Upgrade marker JSX**

Replace all inline marker styles with the design spec markers:

**Origin (zone centroid):**
```tsx
<Marker longitude={...} latitude={...} anchor="center">
  <div className="relative">
    <div className="absolute inset-0 -m-2 rounded-full animate-pulse"
         style={{ width: 32, height: 32, background: 'rgba(59, 130, 246, 0.2)' }} />
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#3B82F6',
                  border: '2px solid #fff', boxShadow: '0 0 12px rgba(59, 130, 246, 0.5)' }} />
  </div>
</Marker>
```

**Boarding stop:**
```tsx
<div style={{ width: 18, height: 18, borderRadius: '50%', background: '#10B981',
              border: '3px solid #fff', boxShadow: '0 0 12px rgba(16, 185, 129, 0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
  <Bus size={10} color="#fff" />
</div>
```

**Transfer point (diamond + pulse rings):**
```tsx
<Marker longitude={...} latitude={...} anchor="center">
  <div className="relative flex items-center justify-center" style={{ width: 48, height: 48 }}>
    <div className="absolute rounded-full transfer-ring"
         style={{ width: 40, height: 40, border: '2px solid #F59E0B' }} />
    <div className="absolute rounded-full transfer-ring-delayed"
         style={{ width: 40, height: 40, border: '2px solid #F59E0B' }} />
    <div className="absolute rounded-full transfer-ring-delayed-2"
         style={{ width: 40, height: 40, border: '2px solid #F59E0B' }} />
    <div style={{ width: 20, height: 20, transform: 'rotate(45deg)', borderRadius: 4,
                  background: '#F59E0B', border: '2px solid #fff',
                  boxShadow: '0 0 16px rgba(245, 158, 11, 0.6)' }} />
  </div>
</Marker>
```

**Transfer callout card — glass style:**
```tsx
<div className="rounded-lg px-4 py-3"
     style={{
       background: 'rgba(11, 17, 33, 0.9)',
       backdropFilter: 'blur(16px)',
       border: '1px solid rgba(99, 126, 184, 0.15)',
       borderLeft: `3px solid ${transferQualityColor}`,
       fontFamily: "'DM Sans', sans-serif",
       boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
     }}>
  <div style={{ fontFamily: "'JetBrains Mono', monospace" }}
       className="text-[13px] font-semibold text-[#E2E8F0]">
    Transfer at {stopName}
  </div>
  <div className="border-t border-[rgba(99,126,184,0.15)] my-2" />
  <div className="text-[12px] text-[#94A3B8]">
    Arrive {arriveTime} → Depart {departTime}
  </div>
  <div className="text-[11px] text-[#64748B] mt-1">
    {waitMin} min wait · {quality} · Rt {from} → Rt {to}
  </div>
</div>
```

**School marker:**
```tsx
<Marker longitude={school.lon} latitude={school.lat} anchor="center">
  <div className="relative">
    <div className="absolute inset-0 -m-1 rounded-full"
         style={{ width: 28, height: 28, background: 'rgba(16, 185, 129, 0.15)' }} />
    <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#F9FAFB',
                  border: '3px solid #10B981',
                  boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <GraduationCap size={12} color="#10B981" />
    </div>
  </div>
</Marker>
```

**Step 6: Add fitBounds on route selection**

In the map component, accept `selectedMorningIdx` and `selectedAfternoonIdx` as props. Use a `useEffect` to call `mapRef.current?.fitBounds(bounds, { padding: { left: 360, top: 60, right: 60, bottom: 100 } })` when the result changes. Compute bounds from all route shape points + school + centroid.

**Step 7: Verify build**

Run: `npm run build`
Expected: PASS

**Step 8: Commit**

```bash
git add components/Analytics/StudentPassMap.tsx
git commit -m "feat(student-pass): enterprise map with 3-layer glow routes, animated dashes, premium markers"
```

---

## Task 8: Rewrite StudentPassModule Layout

**Files:**
- Modify: `components/Analytics/StudentPassModule.tsx` (major layout change — full-width map with overlays)

**Step 1: Update imports**

Add:
```ts
import StudentPassPanel from './StudentPassPanel';
import StudentPassTimeline from './StudentPassTimeline';
import './studentPass.css';
```

Remove the inline panel JSX (lines 303-555) and the step-guide empty state (lines 572-610).

**Step 2: Replace layout structure**

Current layout (line 285 onward):
```
flex-col
  header bar
  flex (row)
    w-72 panel (left)
    flex-col (right)
      flex-[3] map
      flex-[2] preview
```

New layout:
```
flex-col
  header bar (restyled dark)
  relative flex-1 (map fills everything)
    StudentPassMap (full size)
    StudentPassPanel (absolute overlay, left)
    StudentPassTimeline (absolute overlay, bottom)
```

Header bar restyle:
```tsx
<div className="flex items-center gap-3 px-6 py-3"
     style={{ background: '#0B1121', borderBottom: '1px solid rgba(99, 126, 184, 0.12)' }}>
  <button onClick={onBack} className="text-[#94A3B8] hover:text-[#E2E8F0] transition-colors">
    <ArrowLeft size={18} />
  </button>
  <GraduationCap size={18} className="text-emerald-400" />
  <h2 className="text-[15px] font-semibold text-[#E2E8F0]"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}>
    Student Transit Pass
  </h2>
</div>
```

Main area:
```tsx
<div className="flex-1 relative overflow-hidden" style={{ background: '#0B1121' }}>
  {/* Map fills entire area */}
  <div className="absolute inset-0 student-pass-map student-pass-dark">
    <StudentPassMap
      school={selectedSchool}
      result={result}
      onPolygonComplete={handlePolygonComplete}
      onPolygonClear={handlePolygonClear}
    />
  </div>

  {/* Floating panel overlay */}
  <StudentPassPanel
    selectedSchoolId={selectedSchoolId}
    onSchoolChange={handleSchoolChange}
    selectedSchool={selectedSchool}
    bellStart={bellStart}
    bellEnd={bellEnd}
    onBellStartChange={setBellStart}
    onBellEndChange={setBellEnd}
    effectiveBellStart={effectiveBellStart}
    effectiveBellEnd={effectiveBellEnd}
    polygon={polygon}
    isCalculating={isCalculating}
    tripOptions={tripOptions}
    result={result}
    selectedMorningIdx={selectedMorningIdx}
    selectedAfternoonIdx={selectedAfternoonIdx}
    onMorningSelect={setSelectedMorningIdx}
    onAfternoonSelect={setSelectedAfternoonIdx}
    onExport={handleExportPdf}
    isExporting={isExporting}
  />

  {/* Journey timeline at bottom */}
  {result?.found && (
    <StudentPassTimeline result={result} />
  )}
</div>
```

The `StudentPassPreview` section is removed from the main layout (out of scope per design doc).

**Step 3: Update handleExportPdf**

The PDF export capture selector `.student-pass-map` still targets the map div. Verify the class is still on the map container div. May need to adjust capture padding for the floating panel overlay.

**Step 4: Verify build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add components/Analytics/StudentPassModule.tsx
git commit -m "feat(student-pass): enterprise layout with full-width map and floating overlays"
```

---

## Task 9: Integration Testing and Polish

**Files:**
- All student pass files

**Step 1: Run full build**

Run: `npm run build`
Expected: PASS with zero errors

**Step 2: Manual testing checklist**

Open the app, navigate to Student Pass:

- [ ] Dark header bar renders with emerald graduation cap icon
- [ ] Map loads with `dark-v11` style (dark background)
- [ ] Layer toggle switches between dark and satellite
- [ ] NavigationControl visible bottom-right
- [ ] ScaleControl visible bottom-left
- [ ] DrawControl styled dark (top-right)
- [ ] Floating glass panel visible with blur effect
- [ ] Panel scrolls with custom dark scrollbar
- [ ] School dropdown styled dark
- [ ] Bell time inputs styled (may need dark overrides)
- [ ] Drawing a zone triggers calculation
- [ ] Route option cards display with GTFS color left bar
- [ ] Selected card shows glow border
- [ ] AM route lines show 3-layer glow + animated dashes
- [ ] PM route lines show thinner, lower-opacity dashes
- [ ] Walking legs show dotted slate-400 lines
- [ ] Transfer point shows diamond marker with pulse rings
- [ ] Transfer callout shows glass card with quality color
- [ ] School marker shows white circle with emerald border + cap icon
- [ ] Origin marker shows blue circle with glow pulse
- [ ] Boarding stop shows emerald circle with bus icon
- [ ] Journey timeline bar appears at bottom when route selected
- [ ] Timeline segments proportional to duration
- [ ] Map auto-fits bounds on route selection
- [ ] Panel collapse/expand works
- [ ] PDF export still works

**Step 3: Fix any visual issues found**

Address spacing, z-index conflicts, color contrast issues, animation performance.

**Step 4: Final commit**

```bash
git add -A -- ':!nul'
git commit -m "feat(student-pass): polish and integration fixes for enterprise redesign"
```

---

## Task Summary

| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| 1 | Fonts + CSS foundation | Low | 2 files |
| 2 | MapBase controls + ref | Low | 1 file |
| 3 | MapLabel dark typography | Low | 1 file |
| 4 | useRouteAnimation hook | Medium | 1 new file |
| 5 | StudentPassPanel (glass) | High | 1 new file |
| 6 | StudentPassTimeline | Medium | 1 new file |
| 7 | StudentPassMap rewrite | High | 1 file (major) |
| 8 | StudentPassModule layout | High | 1 file (major) |
| 9 | Integration + polish | Medium | Multiple |

**Estimated order of risk:** Task 7 (map layers/animation) > Task 8 (layout restructure) > Task 5 (panel extraction) > rest.

**Critical path:** Tasks 1-3 can run in parallel. Task 4 is independent. Tasks 5-6 are independent of each other. Tasks 7-8 depend on all prior tasks. Task 9 is final.
