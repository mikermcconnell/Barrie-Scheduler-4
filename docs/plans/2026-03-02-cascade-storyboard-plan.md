# Cascade Storyboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 3-panel visual "Cascade Storyboard" (timeline chart + trip chain + route map) that opens as a slide-over panel when clicking a dwell incident card.

**Architecture:** New slide-over container component hosts three child visualization panels that share selection state via props. Pure SVG for charts, Leaflet for maps. Data transformation utilities extract chart-ready points from existing `DwellCascade` types. No backend changes.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS + Leaflet (existing) + SVG

**Design Doc:** `docs/plans/2026-03-02-cascade-storyboard-design.md`

---

## Task 1: Data Transformation Utilities

Create pure functions that transform `DwellCascade` into chart-ready data. These are testable independent of UI.

**Files:**
- Create: `utils/schedule/cascadeStoryUtils.ts`
- Create: `tests/cascadeStoryUtils.test.ts`

**Step 1: Write failing tests for `buildTimelinePoints`**

This function flattens all `cascadedTrips[].timepoints[]` into sequential chart points with trip boundaries.

```typescript
// tests/cascadeStoryUtils.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildTimelinePoints,
  getTripNodeColor,
  type TimelinePoint,
} from '../utils/schedule/cascadeStoryUtils';
import type { DwellCascade, CascadeAffectedTrip, CascadeTimepointObs } from '../utils/performanceDataTypes';

// Helper factory
function makeTimepoint(overrides: Partial<CascadeTimepointObs> = {}): CascadeTimepointObs {
  return {
    stopName: 'Stop A',
    stopId: 'S1',
    routeStopIndex: 0,
    scheduledDeparture: '08:00',
    observedDeparture: '08:06:00',
    deviationSeconds: 360,
    isLate: true,
    ...overrides,
  };
}

function makeTrip(overrides: Partial<CascadeAffectedTrip> = {}): CascadeAffectedTrip {
  return {
    tripName: 'Trip 1',
    tripId: 'T1',
    routeId: '1',
    routeName: 'Route 1',
    terminalDepartureTime: '08:00',
    scheduledRecoverySeconds: 120,
    timepoints: [makeTimepoint()],
    lateTimepointCount: 1,
    recoveredAtStop: null,
    otpStatus: 'late',
    recoveredHere: false,
    lateSeconds: 360,
    ...overrides,
  };
}

describe('buildTimelinePoints', () => {
  it('flattens timepoints across trips into sequential points', () => {
    const trips: CascadeAffectedTrip[] = [
      makeTrip({
        tripName: 'Trip 1',
        timepoints: [
          makeTimepoint({ stopName: 'A', deviationSeconds: 360, routeStopIndex: 0 }),
          makeTimepoint({ stopName: 'B', deviationSeconds: 300, routeStopIndex: 1 }),
        ],
      }),
      makeTrip({
        tripName: 'Trip 2',
        timepoints: [
          makeTimepoint({ stopName: 'C', deviationSeconds: 120, routeStopIndex: 0 }),
        ],
      }),
    ];
    const points = buildTimelinePoints(trips);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ stopName: 'A', deviationMinutes: 6, tripIndex: 0, tripName: 'Trip 1' });
    expect(points[1]).toMatchObject({ stopName: 'B', deviationMinutes: 5, tripIndex: 0 });
    expect(points[2]).toMatchObject({ stopName: 'C', deviationMinutes: 2, tripIndex: 1, tripName: 'Trip 2' });
  });

  it('handles null deviationSeconds as null deviationMinutes', () => {
    const trips: CascadeAffectedTrip[] = [
      makeTrip({
        timepoints: [makeTimepoint({ deviationSeconds: null, observedDeparture: null })],
      }),
    ];
    const points = buildTimelinePoints(trips);
    expect(points[0].deviationMinutes).toBeNull();
  });

  it('marks trip boundaries correctly', () => {
    const trips: CascadeAffectedTrip[] = [
      makeTrip({ tripName: 'T1', timepoints: [makeTimepoint(), makeTimepoint()] }),
      makeTrip({ tripName: 'T2', timepoints: [makeTimepoint()] }),
    ];
    const points = buildTimelinePoints(trips);
    expect(points[0].isTripStart).toBe(true);
    expect(points[1].isTripStart).toBe(false);
    expect(points[2].isTripStart).toBe(true);
  });
});

describe('getTripNodeColor', () => {
  it('returns red when all timepoints are late', () => {
    const trip = makeTrip({ lateTimepointCount: 3, timepoints: [makeTimepoint(), makeTimepoint(), makeTimepoint()] });
    expect(getTripNodeColor(trip)).toBe('red');
  });

  it('returns green when no timepoints are late', () => {
    const trip = makeTrip({ lateTimepointCount: 0 });
    expect(getTripNodeColor(trip)).toBe('green');
  });

  it('returns amber when some but not all timepoints are late', () => {
    const trip = makeTrip({ lateTimepointCount: 1, timepoints: [makeTimepoint(), makeTimepoint()] });
    expect(getTripNodeColor(trip)).toBe('amber');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cascadeStoryUtils.test.ts`
Expected: FAIL — module not found

**Step 3: Implement utilities**

```typescript
// utils/schedule/cascadeStoryUtils.ts
import type { CascadeAffectedTrip, CascadeTimepointObs } from '../performanceDataTypes';

export interface TimelinePoint {
  index: number;
  stopName: string;
  stopId: string;
  scheduledDeparture: string;
  observedDeparture: string | null;
  deviationMinutes: number | null;
  isLate: boolean;
  tripIndex: number;
  tripName: string;
  isTripStart: boolean;
}

/**
 * Flatten all trips' timepoints into a sequential array of chart-ready points.
 */
export function buildTimelinePoints(trips: CascadeAffectedTrip[]): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  let idx = 0;
  for (let ti = 0; ti < trips.length; ti++) {
    const trip = trips[ti];
    for (let si = 0; si < trip.timepoints.length; si++) {
      const tp = trip.timepoints[si];
      points.push({
        index: idx++,
        stopName: tp.stopName,
        stopId: tp.stopId,
        scheduledDeparture: tp.scheduledDeparture,
        observedDeparture: tp.observedDeparture,
        deviationMinutes: tp.deviationSeconds != null ? tp.deviationSeconds / 60 : null,
        isLate: tp.isLate,
        tripIndex: ti,
        tripName: trip.tripName,
        isTripStart: si === 0,
      });
    }
  }
  return points;
}

export type TripNodeColor = 'red' | 'amber' | 'green';

/**
 * Determine trip node color based on how many timepoints were late.
 */
export function getTripNodeColor(trip: CascadeAffectedTrip): TripNodeColor {
  if (trip.lateTimepointCount === 0) return 'green';
  if (trip.lateTimepointCount >= trip.timepoints.length) return 'red';
  return 'amber';
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cascadeStoryUtils.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add utils/schedule/cascadeStoryUtils.ts tests/cascadeStoryUtils.test.ts
git commit -m "feat(cascade-story): add data transformation utilities with tests"
```

---

## Task 2: Slide-Over Container Shell

Build the slide-over panel with header, shared state, and placeholder panels. No visualization yet — just the wiring.

**Files:**
- Create: `components/Performance/CascadeStorySlideOver.tsx`
- Modify: `components/Performance/DwellCascadeSection.tsx` (~lines 297-370, incident cards)

**Step 1: Create the slide-over component**

```tsx
// components/Performance/CascadeStorySlideOver.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import type { DwellCascade } from '../../utils/performanceDataTypes';

interface CascadeStorySlideOverProps {
  cascade: DwellCascade;
  onClose: () => void;
}

// Severity badge colors (matching DwellCascadeSection pattern)
const severityStyles: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  moderate: 'bg-amber-100 text-amber-700',
};

export default function CascadeStorySlideOver({ cascade, onClose }: CascadeStorySlideOverProps) {
  const [selectedTripIndex, setSelectedTripIndex] = useState<number | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const fmtMin = (s: number) => (s / 60).toFixed(1);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[70vw] max-w-[1100px] min-w-[600px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50/80 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">
                Cascade Story
              </h2>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${severityStyles[cascade.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                {cascade.severity}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Route {cascade.routeId}
              <span className="mx-1.5 text-gray-300">·</span>
              Block {cascade.block}
              <span className="mx-1.5 text-gray-300">·</span>
              {cascade.stopName}
              <span className="mx-1.5 text-gray-300">·</span>
              {cascade.observedDepartureTime}
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="font-medium text-red-600">{fmtMin(cascade.trackedDwellSeconds)} min</span> excess dwell
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Panels */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Panel 1: Timeline Chart placeholder */}
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Delay Timeline</h3>
            <div className="h-[200px] bg-gray-50 rounded-lg flex items-center justify-center text-sm text-gray-400">
              Timeline chart — {cascade.cascadedTrips.reduce((n, t) => n + t.timepoints.length, 0)} timepoints across {cascade.cascadedTrips.length} trips
            </div>
          </div>

          {/* Panel 2: Trip Chain placeholder */}
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Trip Chain</h3>
            <div className="h-[120px] bg-gray-50 rounded-lg flex items-center justify-center text-sm text-gray-400">
              Trip chain — {cascade.cascadedTrips.length} downstream trips
            </div>
          </div>

          {/* Panel 3: Route Map placeholder */}
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Route Map</h3>
            <div className="h-[300px] bg-gray-50 rounded-lg flex items-center justify-center text-sm text-gray-400">
              Leaflet map — affected stops
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

**Step 2: Wire up incident card clicks in DwellCascadeSection**

In `DwellCascadeSection.tsx`:

1. Add state: `const [selectedCascade, setSelectedCascade] = useState<DwellCascade | null>(null);`
2. Add import: `import CascadeStorySlideOver from './CascadeStorySlideOver';`
3. Make incident card div clickable: add `onClick={() => setSelectedCascade(incident)}` and `className` add `cursor-pointer hover:border-cyan-300 hover:shadow-sm transition-all`
4. Render slide-over at bottom of component:
```tsx
{selectedCascade && (
  <CascadeStorySlideOver
    cascade={selectedCascade}
    onClose={() => setSelectedCascade(null)}
  />
)}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add components/Performance/CascadeStorySlideOver.tsx components/Performance/DwellCascadeSection.tsx
git commit -m "feat(cascade-story): add slide-over container with placeholders, wire incident card clicks"
```

---

## Task 3: Timeline Chart (Panel 1)

Replace the timeline placeholder with an SVG area chart showing deviation across all timepoints.

**Files:**
- Create: `components/Performance/CascadeTimelineChart.tsx`
- Modify: `components/Performance/CascadeStorySlideOver.tsx` (replace placeholder)

**Step 1: Build the timeline chart component**

Key design decisions:
- Pure SVG, no charting library
- X-axis: sequential timepoint indices, labeled with stop names (rotated 45deg if > 8 stops)
- Y-axis: deviation in minutes
- Red filled area polygon for deviation
- Dashed red horizontal line at 5 min (OTP threshold)
- Vertical dashed lines at trip boundaries
- Hover tooltip via state + positioned div overlay
- Green checkmark at recovery point

```tsx
// components/Performance/CascadeTimelineChart.tsx
import React, { useMemo, useState, useRef } from 'react';
import { buildTimelinePoints, type TimelinePoint } from '../../utils/schedule/cascadeStoryUtils';
import type { CascadeAffectedTrip } from '../../utils/performanceDataTypes';

interface CascadeTimelineChartProps {
  trips: CascadeAffectedTrip[];
  selectedTripIndex: number | null;
  onSelectPoint: (pointIndex: number | null) => void;
}

const MARGIN = { top: 20, right: 20, bottom: 50, left: 45 };
const OTP_THRESHOLD_MIN = 5;

export default function CascadeTimelineChart({ trips, selectedTripIndex, onSelectPoint }: CascadeTimelineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<TimelinePoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const points = useMemo(() => buildTimelinePoints(trips), [trips]);

  if (points.length === 0) {
    return <div className="h-[200px] flex items-center justify-center text-sm text-gray-400">No timepoint data</div>;
  }

  // Chart dimensions — responsive via viewBox
  const chartWidth = Math.max(600, points.length * 60);
  const chartHeight = 200;
  const innerW = chartWidth - MARGIN.left - MARGIN.right;
  const innerH = chartHeight - MARGIN.top - MARGIN.bottom;

  // Scales
  const maxDev = Math.max(OTP_THRESHOLD_MIN + 2, ...points.map(p => p.deviationMinutes ?? 0));
  const xScale = (i: number) => MARGIN.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yScale = (dev: number) => MARGIN.top + innerH - (dev / maxDev) * innerH;

  // Area polygon path (skip null points)
  const validPoints = points.filter(p => p.deviationMinutes != null);
  const areaPath = validPoints.length > 1
    ? `M ${validPoints.map(p => `${xScale(p.index)},${yScale(p.deviationMinutes!)}`).join(' L ')} L ${xScale(validPoints[validPoints.length - 1].index)},${yScale(0)} L ${xScale(validPoints[0].index)},${yScale(0)} Z`
    : '';

  const linePath = validPoints.length > 1
    ? `M ${validPoints.map(p => `${xScale(p.index)},${yScale(p.deviationMinutes!)}`).join(' L ')}`
    : '';

  // Trip boundary x positions
  const tripBoundaries = points.filter(p => p.isTripStart && p.index > 0);

  // Recovery point: first non-late point after any late point
  const firstLateIdx = points.findIndex(p => p.isLate);
  const recoveryPoint = firstLateIdx >= 0
    ? points.find((p, i) => i > firstLateIdx && !p.isLate && p.deviationMinutes != null && p.deviationMinutes < OTP_THRESHOLD_MIN)
    : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * chartWidth;
    // Find nearest point
    let nearest: TimelinePoint | null = null;
    let minDist = Infinity;
    for (const p of points) {
      const dist = Math.abs(xScale(p.index) - svgX);
      if (dist < minDist) { minDist = dist; nearest = p; }
    }
    if (nearest && minDist < 30) {
      setHoveredPoint(nearest);
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      onSelectPoint(nearest.index);
    } else {
      setHoveredPoint(null);
      setTooltipPos(null);
      onSelectPoint(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="overflow-x-auto">
        <svg
          width={chartWidth}
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoveredPoint(null); setTooltipPos(null); onSelectPoint(null); }}
        >
          {/* Green on-time zone */}
          <rect x={MARGIN.left} y={yScale(OTP_THRESHOLD_MIN)} width={innerW} height={yScale(0) - yScale(OTP_THRESHOLD_MIN)} fill="#ecfdf5" opacity={0.5} />

          {/* OTP threshold line */}
          <line x1={MARGIN.left} y1={yScale(OTP_THRESHOLD_MIN)} x2={MARGIN.left + innerW} y2={yScale(OTP_THRESHOLD_MIN)} stroke="#ef4444" strokeWidth={1} strokeDasharray="6 3" opacity={0.6} />
          <text x={MARGIN.left - 4} y={yScale(OTP_THRESHOLD_MIN)} textAnchor="end" fontSize={10} fill="#ef4444" dominantBaseline="middle">5m</text>

          {/* Trip boundary lines */}
          {tripBoundaries.map((p, i) => (
            <g key={`tb-${i}`}>
              <line x1={xScale(p.index)} y1={MARGIN.top} x2={xScale(p.index)} y2={MARGIN.top + innerH} stroke="#d1d5db" strokeWidth={1} strokeDasharray="4 2" />
              <text x={xScale(p.index) + 4} y={MARGIN.top - 4} fontSize={10} fill="#6b7280">{p.tripName}</text>
            </g>
          ))}
          {/* First trip label */}
          {points.length > 0 && (
            <text x={xScale(0) + 4} y={MARGIN.top - 4} fontSize={10} fill="#6b7280">{points[0].tripName}</text>
          )}

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill="#fecaca" opacity={0.4} />}

          {/* Line */}
          {linePath && <path d={linePath} fill="none" stroke="#ef4444" strokeWidth={2} />}

          {/* Data points */}
          {points.map(p => p.deviationMinutes != null ? (
            <circle
              key={p.index}
              cx={xScale(p.index)}
              cy={yScale(p.deviationMinutes)}
              r={hoveredPoint?.index === p.index ? 5 : 3.5}
              fill={p.isLate ? '#ef4444' : '#10b981'}
              stroke="white"
              strokeWidth={1.5}
              opacity={selectedTripIndex != null && p.tripIndex !== selectedTripIndex ? 0.3 : 1}
            />
          ) : (
            <circle
              key={p.index}
              cx={xScale(p.index)}
              cy={yScale(0)}
              r={2}
              fill="#d1d5db"
              opacity={0.5}
            />
          ))}

          {/* Recovery marker */}
          {recoveryPoint && (
            <g transform={`translate(${xScale(recoveryPoint.index)}, ${yScale(recoveryPoint.deviationMinutes!)})`}>
              <circle r={8} fill="#10b981" opacity={0.2} />
              <text textAnchor="middle" fontSize={12} dominantBaseline="central" fill="#10b981">✓</text>
            </g>
          )}

          {/* Y-axis */}
          <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + innerH} stroke="#e5e7eb" />
          {[0, Math.round(maxDev / 2), Math.round(maxDev)].map(v => (
            <g key={`y-${v}`}>
              <line x1={MARGIN.left - 4} y1={yScale(v)} x2={MARGIN.left} y2={yScale(v)} stroke="#9ca3af" />
              <text x={MARGIN.left - 6} y={yScale(v)} textAnchor="end" fontSize={10} fill="#9ca3af" dominantBaseline="middle">{v}m</text>
            </g>
          ))}

          {/* X-axis baseline */}
          <line x1={MARGIN.left} y1={yScale(0)} x2={MARGIN.left + innerW} y2={yScale(0)} stroke="#e5e7eb" />

          {/* X-axis stop labels */}
          {points.map(p => (
            <text
              key={`xl-${p.index}`}
              x={xScale(p.index)}
              y={MARGIN.top + innerH + 12}
              textAnchor="end"
              fontSize={9}
              fill="#9ca3af"
              transform={`rotate(-45 ${xScale(p.index)} ${MARGIN.top + innerH + 12})`}
            >
              {p.stopName.length > 15 ? p.stopName.slice(0, 14) + '…' : p.stopName}
            </text>
          ))}
        </svg>
      </div>

      {/* Tooltip */}
      {hoveredPoint && tooltipPos && (
        <div
          className="absolute pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg z-10"
          style={{ left: Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth ?? 400) - 180), top: tooltipPos.y - 60 }}
        >
          <p className="font-semibold">{hoveredPoint.stopName}</p>
          <p>Sched: {hoveredPoint.scheduledDeparture}</p>
          <p>Obs: {hoveredPoint.observedDeparture ?? 'N/A'}</p>
          <p className={hoveredPoint.isLate ? 'text-red-300' : 'text-green-300'}>
            {hoveredPoint.deviationMinutes != null ? `${hoveredPoint.deviationMinutes.toFixed(1)} min ${hoveredPoint.isLate ? 'late' : ''}` : 'No data'}
          </p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Wire into CascadeStorySlideOver**

Replace the Panel 1 placeholder div contents with:
```tsx
import CascadeTimelineChart from './CascadeTimelineChart';

// In the Panel 1 section:
<CascadeTimelineChart
  trips={cascade.cascadedTrips}
  selectedTripIndex={selectedTripIndex}
  onSelectPoint={setSelectedPointIndex}
/>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add components/Performance/CascadeTimelineChart.tsx components/Performance/CascadeStorySlideOver.tsx
git commit -m "feat(cascade-story): add SVG delay timeline chart with hover tooltips"
```

---

## Task 4: Trip Chain Diagram (Panel 2)

Replace the trip chain placeholder with a horizontal subway-map-style node-link diagram.

**Files:**
- Create: `components/Performance/CascadeTripChain.tsx`
- Modify: `components/Performance/CascadeStorySlideOver.tsx` (replace placeholder)

**Step 1: Build the trip chain component**

```tsx
// components/Performance/CascadeTripChain.tsx
import React, { useMemo } from 'react';
import { getTripNodeColor, type TripNodeColor } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade, CascadeAffectedTrip } from '../../utils/performanceDataTypes';

interface CascadeTripChainProps {
  cascade: DwellCascade;
  selectedTripIndex: number | null;
  onSelectTrip: (tripIndex: number | null) => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 64;
const NODE_GAP = 60;
const ORIGIN_WIDTH = 120;

const colorMap: Record<TripNodeColor, { bg: string; border: string; text: string; line: string }> = {
  red:   { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', line: '#ef4444' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', line: '#f59e0b' },
  green: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', line: '#10b981' },
};

export default function CascadeTripChain({ cascade, selectedTripIndex, onSelectTrip }: CascadeTripChainProps) {
  const trips = cascade.cascadedTrips;
  const fmtMin = (s: number) => (s / 60).toFixed(0);

  const tripColors = useMemo(() => trips.map(getTripNodeColor), [trips]);

  if (trips.length === 0) {
    return <div className="h-[120px] flex items-center justify-center text-sm text-gray-400">No downstream trips</div>;
  }

  const totalWidth = ORIGIN_WIDTH + NODE_GAP + trips.length * (NODE_WIDTH + NODE_GAP);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-0" style={{ minWidth: totalWidth, height: 100, padding: '8px 0' }}>
        {/* Origin node */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center bg-red-100 border-2 border-red-400 rounded-lg px-3 py-2 text-center" style={{ width: ORIGIN_WIDTH, height: NODE_HEIGHT }}>
          <div className="text-xs font-bold text-red-800">⚡ Dwell Event</div>
          <div className="text-[10px] text-red-600 truncate w-full" title={cascade.stopName}>
            {cascade.stopName}
          </div>
          <div className="text-xs font-semibold text-red-700">{fmtMin(cascade.trackedDwellSeconds)}m excess</div>
        </div>

        {/* Trip nodes */}
        {trips.map((trip, i) => {
          const color = tripColors[i];
          const styles = colorMap[color];
          const isSelected = selectedTripIndex === i;
          const dimmed = selectedTripIndex != null && selectedTripIndex !== i;

          return (
            <React.Fragment key={i}>
              {/* Connector line */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ width: NODE_GAP }}>
                <div className="h-[3px] w-full" style={{ backgroundColor: styles.line, opacity: dimmed ? 0.3 : 1 }} />
                {trip.scheduledRecoverySeconds > 0 && (
                  <span className="text-[9px] text-gray-400 mt-0.5">{fmtMin(trip.scheduledRecoverySeconds)}m rec</span>
                )}
              </div>

              {/* Trip node */}
              <div
                onClick={() => onSelectTrip(isSelected ? null : i)}
                className={`flex-shrink-0 ${styles.bg} border ${styles.border} rounded-lg px-2.5 py-1.5 cursor-pointer transition-all ${isSelected ? 'ring-2 ring-cyan-400 shadow-md' : 'hover:shadow-sm'} ${dimmed ? 'opacity-30' : ''}`}
                style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${styles.text}`}>{trip.tripName}</span>
                  {trip.recoveredHere && <span className="text-emerald-600 text-xs">✓</span>}
                </div>
                <div className="text-[10px] text-gray-500">Route {trip.routeId} · {trip.terminalDepartureTime}</div>
                <div className={`text-[10px] font-medium ${styles.text} mt-0.5`}>
                  {trip.lateTimepointCount}/{trip.timepoints.length} late
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* End marker */}
        <div className="flex-shrink-0 ml-3">
          {cascade.recoveredAtTrip ? (
            <div className="text-xs text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              ✓ Recovered
            </div>
          ) : (
            <div className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-full px-3 py-1">
              ✗ Not recovered
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Wire into CascadeStorySlideOver**

Replace Panel 2 placeholder with:
```tsx
import CascadeTripChain from './CascadeTripChain';

<CascadeTripChain
  cascade={cascade}
  selectedTripIndex={selectedTripIndex}
  onSelectTrip={setSelectedTripIndex}
/>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add components/Performance/CascadeTripChain.tsx components/Performance/CascadeStorySlideOver.tsx
git commit -m "feat(cascade-story): add trip chain subway diagram with click-to-select"
```

---

## Task 5: Route Map (Panel 3)

Replace the map placeholder with a Leaflet map showing affected stops colored by deviation.

**Files:**
- Create: `components/Performance/CascadeRouteMap.tsx`
- Modify: `components/Performance/CascadeStorySlideOver.tsx` (replace placeholder)

**Step 1: Build the route map component**

Follow the Leaflet pattern from `StopActivityMap.tsx` and `ODPairMapModal.tsx`:
- `useRef` for map container + L.Map instance
- `useEffect` for init + cleanup
- `ResizeObserver` for container resizing
- CartoDB light tiles (cleaner for modal/panel context)
- `getAllStopsWithCoords()` for GTFS stop lat/lng lookup
- Circle markers colored by deviation

```tsx
// components/Performance/CascadeRouteMap.tsx
import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { buildTimelinePoints } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade } from '../../utils/performanceDataTypes';

interface CascadeRouteMapProps {
  cascade: DwellCascade;
  selectedPointIndex: number | null;
  selectedTripIndex: number | null;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];
const OTP_THRESHOLD_SEC = 300; // 5 min

function deviationColor(devSec: number | null): string {
  if (devSec == null) return '#9ca3af'; // gray — no data
  if (devSec > OTP_THRESHOLD_SEC) return '#ef4444'; // red
  if (devSec > 120) return '#f59e0b'; // amber
  return '#10b981'; // green
}

export default function CascadeRouteMap({ cascade, selectedPointIndex, selectedTripIndex }: CascadeRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  // Build GTFS coords lookup
  const gtfsCoords = useMemo(() => {
    const stops = getAllStopsWithCoords();
    const m = new Map<string, { lat: number; lon: number; name: string }>();
    for (const s of stops) {
      m.set(s.stop_id, { lat: s.lat, lon: s.lon, name: s.stop_name });
    }
    return m;
  }, []);

  // Flatten timepoints for map
  const points = useMemo(() => buildTimelinePoints(cascade.cascadedTrips), [cascade.cascadedTrips]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: BARRIE_CENTER,
      zoom: 13,
      zoomControl: true,
      zoomSnap: 0.25,
      scrollWheelZoom: 'center',
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      crossOrigin: 'anonymous',
      subdomains: 'abcd',
    } as L.TileLayerOptions).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  // Update markers when data or selection changes
  useEffect(() => {
    const layer = markerLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();

    const allLatLngs: L.LatLng[] = [];

    // Origin stop marker (larger, pulsing effect via className)
    const originCoord = gtfsCoords.get(cascade.stopId);
    if (originCoord) {
      const originMarker = L.circleMarker([originCoord.lat, originCoord.lon], {
        radius: 12,
        fillColor: '#dc2626',
        fillOpacity: 0.9,
        color: '#991b1b',
        weight: 3,
      }).addTo(layer);
      originMarker.bindTooltip(
        `<b>⚡ ${cascade.stopName}</b><br/>Dwell event origin<br/>${(cascade.trackedDwellSeconds / 60).toFixed(1)} min excess`,
        { direction: 'top', offset: L.point(0, -14) }
      );
      allLatLngs.push(L.latLng(originCoord.lat, originCoord.lon));
    }

    // Timepoint stop markers
    // Deduplicate by stopId (same stop can appear in multiple trips — show worst deviation)
    const stopWorst = new Map<string, { deviationSeconds: number | null; isLate: boolean; stopName: string; isRecovery: boolean; tripIndex: number }>();
    for (const p of points) {
      const existing = stopWorst.get(p.stopId);
      const dev = p.deviationMinutes != null ? p.deviationMinutes * 60 : null;
      if (!existing || (dev != null && (existing.deviationSeconds == null || dev > existing.deviationSeconds))) {
        stopWorst.set(p.stopId, {
          deviationSeconds: dev,
          isLate: p.isLate,
          stopName: p.stopName,
          isRecovery: false,
          tripIndex: p.tripIndex,
        });
      }
    }

    // Mark recovery stop
    if (cascade.recoveredAtStop) {
      // Find recovery stop by name match
      for (const [sid, info] of stopWorst) {
        if (info.stopName === cascade.recoveredAtStop) {
          info.isRecovery = true;
          break;
        }
      }
    }

    for (const [stopId, info] of stopWorst) {
      const coord = gtfsCoords.get(stopId);
      if (!coord) continue;

      const dimmed = selectedTripIndex != null && info.tripIndex !== selectedTripIndex;
      const color = deviationColor(info.deviationSeconds);

      const marker = L.circleMarker([coord.lat, coord.lon], {
        radius: info.isRecovery ? 9 : 6,
        fillColor: color,
        fillOpacity: dimmed ? 0.2 : 0.85,
        color: info.isRecovery ? '#065f46' : '#374151',
        weight: info.isRecovery ? 2.5 : 1.5,
      }).addTo(layer);

      const devLabel = info.deviationSeconds != null
        ? `${(info.deviationSeconds / 60).toFixed(1)} min ${info.isLate ? 'late' : ''}`
        : 'No data';
      marker.bindTooltip(
        `<b>${info.stopName}</b><br/>${devLabel}${info.isRecovery ? '<br/><b style="color:#10b981">✓ Recovery point</b>' : ''}`,
        { direction: 'top', offset: L.point(0, -8) }
      );

      allLatLngs.push(L.latLng(coord.lat, coord.lon));
    }

    // Fit bounds
    if (allLatLngs.length > 1) {
      const bounds = L.latLngBounds(allLatLngs);
      map.fitBounds(bounds, { padding: L.point(40, 40), maxZoom: 15 });
    } else if (allLatLngs.length === 1) {
      map.setView(allLatLngs[0], 14);
    }
  }, [cascade, points, gtfsCoords, selectedTripIndex]);

  // Check if any stops have coords
  const hasCoords = useMemo(() => {
    if (gtfsCoords.has(cascade.stopId)) return true;
    return points.some(p => gtfsCoords.has(p.stopId));
  }, [cascade.stopId, points, gtfsCoords]);

  if (!hasCoords) {
    return (
      <div className="h-[300px] flex items-center justify-center text-sm text-gray-400 bg-gray-50 rounded-lg">
        No stop coordinates available for this cascade
      </div>
    );
  }

  return <div ref={containerRef} className="w-full rounded-lg" style={{ height: 300 }} />;
}
```

**Step 2: Wire into CascadeStorySlideOver**

Replace Panel 3 placeholder with:
```tsx
import CascadeRouteMap from './CascadeRouteMap';

<CascadeRouteMap
  cascade={cascade}
  selectedPointIndex={selectedPointIndex}
  selectedTripIndex={selectedTripIndex}
/>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add components/Performance/CascadeRouteMap.tsx components/Performance/CascadeStorySlideOver.tsx
git commit -m "feat(cascade-story): add Leaflet route map with deviation-colored stop markers"
```

---

## Task 6: Cross-Panel Interaction & Polish

Wire up the remaining cross-panel selection syncing and add final polish.

**Files:**
- Modify: `components/Performance/CascadeStorySlideOver.tsx`

**Step 1: Ensure bidirectional selection sync**

The slide-over already has `selectedTripIndex` and `selectedPointIndex` state. Verify:
- When user clicks a trip node in Panel 2 → `selectedTripIndex` updates → Panel 1 dims non-selected trip points, Panel 3 dims non-selected trip stops
- When user hovers a point in Panel 1 → `selectedPointIndex` updates (already wired)
- Clicking a selected trip again deselects (already handled via toggle in `onSelectTrip`)

**Step 2: Add summary stats row between header and panels**

Add a compact stats row below the header:
```tsx
{/* Quick stats row */}
<div className="flex items-center gap-4 px-5 py-2 bg-gray-50/50 border-b border-gray-100 text-xs text-gray-600 flex-shrink-0">
  <span><span className="font-semibold text-red-600">{cascade.blastRadius}</span> trips impacted</span>
  <span><span className="font-semibold text-gray-800">{cascade.cascadedTrips.length}</span> downstream trips</span>
  <span><span className="font-semibold text-gray-800">{fmtMin(cascade.recoveryTimeAvailableSeconds)}</span> min recovery available</span>
  {cascade.recoveredAtTrip && (
    <span className="text-emerald-600 font-medium">✓ Recovered at {cascade.recoveredAtTrip}</span>
  )}
  {!cascade.recoveredAtTrip && cascade.cascadedTrips.length > 0 && (
    <span className="text-red-600 font-medium">✗ Never recovered</span>
  )}
</div>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Run all tests**

Run: `npx vitest run tests/cascadeStoryUtils.test.ts`
Expected: PASS

**Step 5: Final commit**

```bash
git add components/Performance/CascadeStorySlideOver.tsx
git commit -m "feat(cascade-story): add stats row and finalize cross-panel interaction"
```

---

## Task 7: Verify & Cleanup

**Step 1: Full build verification**

Run: `npm run build`
Expected: PASS

**Step 2: Run all project tests**

Run: `npx vitest run`
Expected: All existing tests still pass + new cascadeStoryUtils tests pass

**Step 3: Manual verification checklist**

- [ ] Click an incident card → slide-over opens
- [ ] Header shows correct route, block, stop, dwell info
- [ ] Timeline chart renders with red area, OTP threshold line, trip boundaries
- [ ] Hover over timeline points shows tooltip with stop/deviation info
- [ ] Trip chain shows colored nodes with correct late counts
- [ ] Click trip node → dims other trips in all 3 panels
- [ ] Map shows stops colored by deviation
- [ ] Origin stop has larger red marker
- [ ] Recovery stop has green checkmark marker
- [ ] Escape or click backdrop closes the slide-over
- [ ] No console errors

**Step 4: Final commit if any cleanup needed**

```bash
git commit -m "fix(cascade-story): cleanup from manual verification"
```
