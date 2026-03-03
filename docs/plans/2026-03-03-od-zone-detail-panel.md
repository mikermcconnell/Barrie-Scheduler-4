# OD Zone Detail Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When clicking a zone on the OD map, auto-zoom to that zone's connected pairs and show a right slide-out panel with zone summary stats and top flows table.

**Architecture:** Extends the existing `isolatedZone` spider mode in `TransitAppMap.tsx`. Adds a `zonePanelData` useMemo for derived stats, a `prevMapView` ref for zoom restore, and an inline zone detail panel rendered as a sibling to the map container inside a flex row. All changes in a single file.

**Tech Stack:** React 19, Leaflet (raw via refs), Tailwind CSS, existing `getZoneName`/`haversineKm`/`rankColor` utilities already in-file.

**Design doc:** `docs/plans/2026-03-03-od-zone-detail-panel-design.md`

**UI Skill:** Use `frontend-design` skill for the panel styling.

---

## Task 1: Add `prevMapView` ref and auto-zoom on zone selection

**Files:**
- Modify: `components/Analytics/TransitAppMap.tsx:336-341` (refs section)
- Modify: `components/Analytics/TransitAppMap.tsx:596-599` (map click handler)
- Modify: `components/Analytics/TransitAppMap.tsx:750-760` (zone dot/rect click handlers)

**Step 1: Add ref for storing previous map view**

After the existing refs block (around line 341), add:

```typescript
const prevMapViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null);
```

**Step 2: Add a useEffect that fires when `isolatedZone` changes**

After the `onDisplayedODPairsChange` effect (line 522), add a new effect:

```typescript
// Auto-zoom to zone extents when zone is selected
useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (isolatedZone) {
        // Save current view for restore
        if (!prevMapViewRef.current) {
            prevMapViewRef.current = { center: map.getCenter(), zoom: map.getZoom() };
        }

        // Compute bounds from all displayed pairs (already filtered to this zone by filteredPairs Step 7)
        if (displayedPairs.length > 0) {
            const points: L.LatLngExpression[] = [];
            for (const pair of displayedPairs) {
                points.push([pair.originLat, pair.originLon]);
                points.push([pair.destLat, pair.destLon]);
            }
            const bounds = L.latLngBounds(points);
            // Extra right padding to accommodate the 320px panel
            map.fitBounds(bounds, { padding: [50, 340, 50, 50], maxZoom: 15 });
        }
    } else {
        // Restore previous view
        if (prevMapViewRef.current) {
            map.setView(prevMapViewRef.current.center, prevMapViewRef.current.zoom, { animate: true });
            prevMapViewRef.current = null;
        }
    }
}, [isolatedZone, displayedPairs]);
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS — no behavioral change yet, just zoom behavior on existing zone click.

**Step 4: Commit**

```bash
git add components/Analytics/TransitAppMap.tsx
git commit -m "feat(od-map): auto-zoom to zone extents on zone click"
```

---

## Task 2: Add `zonePanelData` useMemo for derived zone stats

**Files:**
- Modify: `components/Analytics/TransitAppMap.tsx` (after the `stats` useMemo, around line 518)

**Step 1: Add the zone panel data memo**

```typescript
// Zone detail panel data — derived from displayedPairs when a zone is selected
const zonePanelData = useMemo(() => {
    if (!isolatedZone || displayedPairs.length === 0) return null;

    const [latStr, lonStr] = isolatedZone.split('_');
    const zoneLat = parseFloat(latStr);
    const zoneLon = parseFloat(lonStr);
    const zoneName = getZoneName(zoneLat, zoneLon);

    let totalTrips = 0;
    const connectionSet = new Set<string>();
    let totalDistKm = 0;
    const hourlyTotals = new Array(24).fill(0);
    let hasHourly = false;

    interface FlowEntry {
        name: string;
        lat: number;
        lon: number;
        outbound: number;
        inbound: number;
        total: number;
        distKm: number;
    }
    const flowMap = new Map<string, FlowEntry>();

    for (const pair of displayedPairs) {
        const oKey = coordKey(pair.originLat, pair.originLon);
        const dKey = coordKey(pair.destLat, pair.destLon);
        const isOrigin = oKey === isolatedZone;
        const otherKey = isOrigin ? dKey : oKey;
        const otherLat = isOrigin ? pair.destLat : pair.originLat;
        const otherLon = isOrigin ? pair.destLon : pair.originLon;

        totalTrips += pair.count;
        connectionSet.add(otherKey);

        const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
        totalDistKm += distKm * pair.count;

        if (pair.hourlyBins) {
            hasHourly = true;
            for (let h = 0; h < 24; h++) hourlyTotals[h] += pair.hourlyBins[h];
        }

        const existing = flowMap.get(otherKey);
        if (existing) {
            if (isOrigin) existing.outbound += pair.count;
            else existing.inbound += pair.count;
            existing.total += pair.count;
        } else {
            flowMap.set(otherKey, {
                name: getZoneName(otherLat, otherLon),
                lat: otherLat,
                lon: otherLon,
                outbound: isOrigin ? pair.count : 0,
                inbound: isOrigin ? 0 : pair.count,
                total: pair.count,
                distKm,
            });
        }
    }

    const flows = Array.from(flowMap.values()).sort((a, b) => b.total - a.total);
    const avgDistKm = totalTrips > 0 ? totalDistKm / totalTrips : 0;

    let peakPeriod: string | null = null;
    if (hasHourly) {
        const maxHour = hourlyTotals.indexOf(Math.max(...hourlyTotals));
        if (maxHour >= 6 && maxHour < 9) peakPeriod = 'AM Peak';
        else if (maxHour >= 9 && maxHour < 15) peakPeriod = 'Midday';
        else if (maxHour >= 15 && maxHour < 19) peakPeriod = 'PM Peak';
        else peakPeriod = 'Evening';
    }

    return {
        zoneName,
        zoneLat,
        zoneLon,
        totalTrips,
        uniqueConnections: connectionSet.size,
        avgDistKm,
        peakPeriod,
        flows,
    };
}, [isolatedZone, displayedPairs, getZoneName]);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS — memo is computed but not yet rendered.

**Step 3: Commit**

```bash
git add components/Analytics/TransitAppMap.tsx
git commit -m "feat(od-map): add zonePanelData useMemo for zone detail stats"
```

---

## Task 3: Add zone panel top-N toggle state

**Files:**
- Modify: `components/Analytics/TransitAppMap.tsx:361` (state declarations area)

**Step 1: Add state for panel flow count**

After the `isolatedZone` state (line 361), add:

```typescript
const [zonePanelTopN, setZonePanelTopN] = useState<10 | 20>(10);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

---

## Task 4: Render the zone detail panel and restructure map layout

**Files:**
- Modify: `components/Analytics/TransitAppMap.tsx:1623-1628` (map container div)

This is the core UI task. The current map container is:

```tsx
{/* Map container */}
<div
    ref={containerRef}
    style={{ height: isFullscreen ? 'calc(100vh - 200px)' : height, width: '100%' }}
    className={`rounded-lg overflow-hidden border border-gray-200 ${showMatrixPlanner ? 'hidden' : ''}`}
/>
```

**Step 1: Wrap map container in a flex row and add the zone panel**

Replace the map container div (lines 1623-1628) with:

```tsx
{/* Map + Zone Panel row */}
<div className={`flex gap-0 ${showMatrixPlanner ? 'hidden' : ''}`}
     style={{ height: isFullscreen ? 'calc(100vh - 200px)' : height }}>
    {/* Map container */}
    <div
        ref={containerRef}
        className="flex-1 rounded-l-lg overflow-hidden border border-gray-200"
        style={{ minHeight: 0 }}
    />

    {/* Zone Detail Panel */}
    {isolatedZone && zonePanelData && activeLayer === 'od' && (
        <div className="w-80 shrink-0 border border-l-0 border-gray-200 rounded-r-lg bg-white overflow-y-auto"
             style={{ transition: 'width 0.2s ease' }}>
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-start justify-between">
                <div className="min-w-0">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Selected Zone</div>
                    <div className="text-sm font-semibold text-gray-900 truncate">{zonePanelData.zoneName}</div>
                </div>
                <button
                    onClick={() => setIsolatedZone(null)}
                    className="shrink-0 ml-2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Close zone panel"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-gray-100">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">Trips</div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{zonePanelData.totalTrips.toLocaleString()}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">Connections</div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{zonePanelData.uniqueConnections}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">Avg Distance</div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{zonePanelData.avgDistKm.toFixed(1)} <span className="text-xs font-normal text-gray-500">km</span></div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">Peak Period</div>
                    <div className="text-lg font-bold text-gray-900">{zonePanelData.peakPeriod ?? '—'}</div>
                </div>
            </div>

            {/* Top Flows Header */}
            <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Top Flows</span>
                <div className="flex rounded border border-gray-200 overflow-hidden">
                    <button
                        onClick={() => setZonePanelTopN(10)}
                        className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            zonePanelTopN === 10 ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                        }`}
                    >
                        10
                    </button>
                    <button
                        onClick={() => setZonePanelTopN(20)}
                        className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            zonePanelTopN === 20 ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                        }`}
                    >
                        20
                    </button>
                </div>
            </div>

            {/* Top Flows Table */}
            <div className="divide-y divide-gray-50">
                {zonePanelData.flows.slice(0, zonePanelTopN).map((flow, i) => {
                    const pct = zonePanelData.totalTrips > 0
                        ? ((flow.total / zonePanelData.totalTrips) * 100).toFixed(1)
                        : '0';
                    return (
                        <div
                            key={`${flow.lat}_${flow.lon}`}
                            className="px-4 py-2 flex items-center gap-2 hover:bg-gray-50 cursor-pointer transition-colors group"
                            onMouseEnter={() => {
                                // Highlight the corresponding arc(s) on the map
                                const matchPair = displayedPairs.find(p => {
                                    const oKey = coordKey(p.originLat, p.originLon);
                                    const dKey = coordKey(p.destLat, p.destLon);
                                    const otherKey = coordKey(flow.lat, flow.lon);
                                    return oKey === otherKey || dKey === otherKey;
                                });
                                if (matchPair) highlightArc(matchPair);
                            }}
                            onMouseLeave={unhighlightArcs}
                            onClick={() => {
                                const map = mapRef.current;
                                if (map) {
                                    map.fitBounds(
                                        [[zonePanelData.zoneLat, zonePanelData.zoneLon], [flow.lat, flow.lon]],
                                        { padding: [50, 340, 50, 50], maxZoom: 15 }
                                    );
                                }
                            }}
                        >
                            {/* Rank dot */}
                            <span
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                                style={{ backgroundColor: rankColor(i) }}
                            >
                                {i + 1}
                            </span>

                            {/* Flow info */}
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-gray-800 truncate">{flow.name}</div>
                                <div className="text-[10px] text-gray-400">
                                    {flow.outbound > 0 && <span>{flow.outbound.toLocaleString()} out</span>}
                                    {flow.outbound > 0 && flow.inbound > 0 && <span> · </span>}
                                    {flow.inbound > 0 && <span>{flow.inbound.toLocaleString()} in</span>}
                                    <span className="ml-1">· {flow.distKm.toFixed(1)} km</span>
                                </div>
                            </div>

                            {/* Trip count + bar */}
                            <div className="text-right shrink-0">
                                <div className="text-xs font-semibold text-gray-900 tabular-nums">{flow.total.toLocaleString()}</div>
                                <div className="text-[10px] text-gray-400 tabular-nums">{pct}%</div>
                            </div>
                        </div>
                    );
                })}

                {zonePanelData.flows.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-gray-400">No flows for this zone</div>
                )}

                {zonePanelData.flows.length > zonePanelTopN && (
                    <div className="px-4 py-2 text-center text-[10px] text-gray-400">
                        +{zonePanelData.flows.length - zonePanelTopN} more flows
                    </div>
                )}
            </div>
        </div>
    )}
</div>
```

**Step 2: Fix the map border radius when panel is closed**

When `isolatedZone` is null, the map should have full `rounded-lg`. When panel is open, it should have `rounded-l-lg`. Update the map div className:

```tsx
className={`flex-1 overflow-hidden border border-gray-200 ${
    isolatedZone && zonePanelData && activeLayer === 'od' ? 'rounded-l-lg' : 'rounded-lg'
}`}
```

**Step 3: Invalidate map size when panel opens/closes**

Add an effect after the existing zone auto-zoom effect:

```typescript
// Invalidate map size when zone panel opens/closes (flex layout changes)
useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 100);
}, [isolatedZone]);
```

**Step 4: Verify build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add components/Analytics/TransitAppMap.tsx
git commit -m "feat(od-map): zone detail side panel with summary stats and top flows table"
```

---

## Task 5: Add selected zone highlight styling in buildODLayer

**Files:**
- Modify: `components/Analytics/TransitAppMap.tsx:714-760` (zone rendering in `buildODLayer`)

**Step 1: Add visual emphasis to the selected zone**

In the `buildODLayer` callback, inside the `for (const [zoneKey, zone] of zoneMap)` loop, after determining `fillColor` (line 715), add a check for the selected zone:

```typescript
const isSelected = zoneKey === isolatedZone;
```

Then modify the zone rectangle and dot to use enhanced styling when selected:

For the rectangle (around line 722):
```typescript
const rect = L.rectangle(
    [[zone.lat - half, zone.lon - half], [zone.lat + half, zone.lon + half]],
    {
        fillColor: isSelected ? '#3b82f6' : fillColor,
        fillOpacity: isSelected ? 0.3 : (isOverview ? 0.14 + t * 0.12 : 0.25),
        color: isSelected ? '#1d4ed8' : fillColor,
        weight: isSelected ? 2.5 : (isOverview ? 0.8 : 1),
        opacity: isSelected ? 0.9 : (isOverview ? 0.35 : 0.5),
    }
)
```

For the zone dot (around line 736):
```typescript
const zoneDot = L.circleMarker([zone.lat, zone.lon], {
    radius: isSelected ? 11 : baseRadius,
    fillColor: isSelected ? '#3b82f6' : fillColor,
    fillOpacity: isSelected ? 0.7 : (isOverview ? 0.55 : 0.4),
    color: isSelected ? '#ffffff' : '#ffffff',
    weight: isSelected ? 3 : 1.5,
    opacity: isSelected ? 1 : 0.7,
}).addTo(group);
```

**Step 2: Add `isolatedZone` to `buildODLayer` dependency array**

Update the dependency array at line 911:
```typescript
}, [displayedPairs, odPairs, getZoneName, allZonesMode, allZonesRenderMode, isolatedZone]);
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add components/Analytics/TransitAppMap.tsx
git commit -m "feat(od-map): highlight selected zone with blue ring and elevated styling"
```

---

## Task 6: Final integration and visual polish

**Files:**
- Modify: `components/Analytics/TransitAppMap.tsx`

**Step 1: Update the stats bar isolated zone text**

The existing stats bar (line 1609-1619) shows "Flows through {spiderName}" text. Since we now have the panel, simplify this to just show the zone name with a "clear" action, and remove the redundant inline text since the panel shows it:

Replace lines 1609-1619 with:
```tsx
{isolatedZone && (() => {
    const [latStr, lonStr] = isolatedZone.split('_');
    const spiderName = getZoneName(parseFloat(latStr), parseFloat(lonStr));
    return (
        <>
            <span className="text-gray-300"> · </span>
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-[11px] font-medium">
                {spiderName}
                <button onClick={() => setIsolatedZone(null)} className="text-blue-400 hover:text-blue-600 ml-0.5">×</button>
            </span>
        </>
    );
})()}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Visual verification**

Manual test:
1. Navigate to OD map layer
2. Click a zone dot — should auto-zoom to its connected pairs, panel slides in from right
3. Panel shows zone name, 4 stat cards, top 10 flows
4. Hover a flow row — corresponding arc highlights on map
5. Click a flow row — zooms to that specific O-D pair
6. Toggle 10/20 — flows table updates
7. Click × or click map background — panel closes, map restores previous view
8. Zone dot shows blue highlight ring when selected

**Step 4: Commit**

```bash
git add components/Analytics/TransitAppMap.tsx
git commit -m "feat(od-map): polish zone detail panel stats bar and visual integration"
```

---

## Summary

| Task | What | Risk |
|------|------|------|
| 1 | Auto-zoom + view restore | Low — uses existing Leaflet fitBounds |
| 2 | zonePanelData memo | Low — pure data derivation |
| 3 | Panel top-N state | Trivial |
| 4 | Panel UI rendering | Medium — largest change, layout shift |
| 5 | Selected zone highlight | Low — styling only |
| 6 | Polish + integration | Low — cosmetic |

**Total:** ~6 commits, single file (`TransitAppMap.tsx`), no new dependencies.
