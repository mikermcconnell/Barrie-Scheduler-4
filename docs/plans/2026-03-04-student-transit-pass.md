# Student Transit Pass Generator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Analytics tab that auto-generates student transit pass flyers from GTFS data — users draw a residential zone, pick a school, and get a print-ready PDF with route, travel time, and trip instructions.

**Architecture:** New `StudentPassModule` tab in `TransitAppWorkspace` with 4 sub-components (Config, Map, Preview, Utils). GTFS data loaded via Vite `?raw` imports. Trip-finding algorithm searches direct routes first, falls back to 1-transfer routes. PDF export via html2canvas (map capture) + jsPDF (flyer composition).

**Tech Stack:** React 19, Leaflet 1.9.4, leaflet-draw (new), jsPDF 4.0, html2canvas 1.4, Tailwind CSS, Vite `?raw` GTFS imports.

**Design Doc:** `docs/plans/2026-03-04-student-transit-pass-design.md`

---

## Task 1: Install leaflet-draw and add TypeScript types

**Files:**
- Modify: `package.json`
- Create: `src/types/leaflet-draw.d.ts` (if needed)

**Step 1: Install leaflet-draw**

Run:
```bash
npm install leaflet-draw
npm install -D @types/leaflet-draw
```

**Step 2: Verify types resolve**

Run: `npx tsc --noEmit`
Expected: No new errors from leaflet-draw types.

If `@types/leaflet-draw` doesn't exist or has issues, create a minimal type declaration:

```typescript
// src/types/leaflet-draw.d.ts
declare module 'leaflet-draw' {
    import * as L from 'leaflet';
    export = L;
}
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add leaflet-draw dependency for polygon drawing"
```

---

## Task 2: Create studentPassUtils.ts — GTFS trip-finding core

**Files:**
- Create: `utils/transit-app/studentPassUtils.ts`
- Test: `tests/studentPassUtils.test.ts`

**Reference files to read first:**
- `utils/gtfs/gtfsStopLookup.ts` — stop loading + haversine distance
- `utils/gtfs/gtfsTypes.ts` — `gtfsTimeToMinutes()`, GTFS interfaces
- `utils/gtfs/corridorBuilder.ts:88-131` — CSV parsing pattern for stop_times
- `utils/config/routeColors.ts` — `getRouteColor()`

**Step 1: Write the types**

```typescript
// utils/transit-app/studentPassUtils.ts

import type { LatLng } from 'leaflet';

export interface SchoolConfig {
    name: string;
    coords: [number, number]; // [lat, lon]
    bellStart: string;        // "08:00" 24h format
    bellEnd: string;          // "14:15"
}

export interface TransferQuality {
    rating: 'tight' | 'good' | 'ok' | 'long';
    label: string;
    waitMinutes: number;
}

export interface TransferInfo {
    routeA: { name: string; color: string; shapePoints: [number, number][] };
    routeB: { name: string; color: string; shapePoints: [number, number][] };
    transferStop: { id: string; name: string; lat: number; lon: number };
    quality: TransferQuality;
}

export interface TripLeg {
    boardTime: string;    // "07:26"
    alightTime: string;   // "07:32"
}

export interface StudentPassResult {
    tripType: 'direct' | 'transfer';
    route?: { name: string; color: string; shapePoints: [number, number][] };
    boardingStop: { id: string; name: string; lat: number; lon: number };
    alightingStop: { id: string; name: string; lat: number; lon: number };
    transfer?: TransferInfo;
    morningTrip: TripLeg & {
        transferLeg?: TripLeg;
        totalTravelMinutes: number;
    };
    afternoonTrip: TripLeg & {
        transferLeg?: TripLeg;
        nextBusTime: string;
        totalTravelMinutes: number;
    };
    frequency: number;
    connectingRoutes: string[];
    stopsInZone: Array<{ id: string; name: string; lat: number; lon: number }>;
}

export const BARRIE_SCHOOLS: SchoolConfig[] = [
    { name: 'Barrie North Collegiate', coords: [44.4112, -79.6755], bellStart: '08:20', bellEnd: '14:30' },
    { name: 'Eastview Secondary School', coords: [44.3832, -79.6636], bellStart: '08:20', bellEnd: '14:30' },
    { name: 'Innisdale Secondary School', coords: [44.3916, -79.7101], bellStart: '08:20', bellEnd: '14:30' },
    { name: 'Maple Ridge Secondary School', coords: [44.3378, -79.6658], bellStart: '08:00', bellEnd: '14:15' },
    { name: 'St. Joseph\'s High School', coords: [44.3772, -79.7143], bellStart: '08:30', bellEnd: '14:45' },
    { name: 'Bear Creek Secondary School', coords: [44.3951, -79.7362], bellStart: '08:20', bellEnd: '14:30' },
    { name: 'Georgian College', coords: [44.4098, -79.6634], bellStart: '08:00', bellEnd: '17:00' },
];
```

> **Note:** School coordinates are approximate. Verify against Google Maps during implementation. Bell times are defaults — user can override in the UI.

**Step 2: Write point-in-polygon utility**

```typescript
export function isPointInPolygon(
    point: [number, number],
    polygon: [number, number][]
): boolean {
    const [y, x] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [yi, xi] = polygon[i];
        const [yj, xj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}
```

**Step 3: Write the failing test for point-in-polygon**

```typescript
// tests/studentPassUtils.test.ts
import { describe, it, expect } from 'vitest';
import { isPointInPolygon } from '../utils/transit-app/studentPassUtils';

describe('isPointInPolygon', () => {
    const square: [number, number][] = [
        [44.38, -79.70],
        [44.38, -79.68],
        [44.40, -79.68],
        [44.40, -79.70],
    ];

    it('returns true for point inside polygon', () => {
        expect(isPointInPolygon([44.39, -79.69], square)).toBe(true);
    });

    it('returns false for point outside polygon', () => {
        expect(isPointInPolygon([44.42, -79.69], square)).toBe(false);
    });

    it('returns false for empty polygon', () => {
        expect(isPointInPolygon([44.39, -79.69], [])).toBe(false);
    });
});
```

**Step 4: Run test to verify it fails, then passes**

Run: `npx vitest run tests/studentPassUtils.test.ts`

**Step 5: Write findStopsInZone()**

```typescript
import { getAllStopsWithCoords } from '../gtfs/gtfsStopLookup';

const BUFFER_KM = 0.2; // 200m buffer around zone

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findStopsInZone(
    polygon: [number, number][]
): Array<{ id: string; name: string; lat: number; lon: number }> {
    const allStops = getAllStopsWithCoords();
    return allStops.filter(stop => {
        // Check if inside polygon
        if (isPointInPolygon([stop.lat, stop.lon], polygon)) return true;
        // Check if within buffer distance of any polygon edge
        for (const vertex of polygon) {
            if (haversineKm(stop.lat, stop.lon, vertex[0], vertex[1]) <= BUFFER_KM) return true;
        }
        return false;
    }).map(s => ({ id: s.stop_id, name: s.stop_name, lat: s.lat, lon: s.lon }));
}
```

**Step 6: Write findNearestStopToSchool()**

```typescript
export function findNearestStopToSchool(
    schoolCoords: [number, number]
): { id: string; name: string; lat: number; lon: number } | null {
    const allStops = getAllStopsWithCoords();
    let nearest: typeof allStops[0] | null = null;
    let minDist = Infinity;
    for (const stop of allStops) {
        const d = haversineKm(schoolCoords[0], schoolCoords[1], stop.lat, stop.lon);
        if (d < minDist) {
            minDist = d;
            nearest = stop;
        }
    }
    if (!nearest) return null;
    return { id: nearest.stop_id, name: nearest.stop_name, lat: nearest.lat, lon: nearest.lon };
}
```

**Step 7: Write GTFS data loading helpers**

These parse the raw GTFS text files to build lookup structures for trip finding.

```typescript
import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import calendarRaw from '../../gtfs/calendar.txt?raw';
import routesRaw from '../../gtfs/routes.txt?raw';
import shapesRaw from '../../gtfs/shapes.txt?raw';
import { getRouteColor } from '../config/routeColors';

interface ParsedStopTime {
    tripId: string;
    stopId: string;
    arrivalMinutes: number;
    departureMinutes: number;
    stopSequence: number;
}

interface ParsedTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
    directionId: number;
    shapeId: string;
}

interface ParsedRoute {
    routeId: string;
    shortName: string;
    color: string;
}

function parseTimeToMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

let _stopTimesCache: ParsedStopTime[] | null = null;
let _tripsCache: Map<string, ParsedTrip> | null = null;
let _routesCache: Map<string, ParsedRoute> | null = null;
let _weekdayServiceIds: Set<string> | null = null;
let _shapesCache: Map<string, [number, number][]> | null = null;

function loadStopTimes(): ParsedStopTime[] {
    if (_stopTimesCache) return _stopTimesCache;
    const lines = stopTimesRaw.trim().split('\n');
    const header = lines[0].split(',');
    const tripIdx = header.indexOf('trip_id');
    const stopIdx = header.indexOf('stop_id');
    const arrIdx = header.indexOf('arrival_time');
    const depIdx = header.indexOf('departure_time');
    const seqIdx = header.indexOf('stop_sequence');

    _stopTimesCache = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        _stopTimesCache.push({
            tripId: cols[tripIdx],
            stopId: cols[stopIdx],
            arrivalMinutes: parseTimeToMinutes(cols[arrIdx]),
            departureMinutes: parseTimeToMinutes(cols[depIdx]),
            stopSequence: Number(cols[seqIdx]),
        });
    }
    return _stopTimesCache;
}

function loadTrips(): Map<string, ParsedTrip> {
    if (_tripsCache) return _tripsCache;
    const lines = tripsRaw.trim().split('\n');
    const header = lines[0].split(',');
    const routeIdx = header.indexOf('route_id');
    const serviceIdx = header.indexOf('service_id');
    const tripIdx = header.indexOf('trip_id');
    const dirIdx = header.indexOf('direction_id');
    const shapeIdx = header.indexOf('shape_id');

    _tripsCache = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const tripId = cols[tripIdx];
        _tripsCache.set(tripId, {
            tripId,
            routeId: cols[routeIdx],
            serviceId: cols[serviceIdx],
            directionId: Number(cols[dirIdx]),
            shapeId: cols[shapeIdx]?.trim() || '',
        });
    }
    return _tripsCache;
}

function loadRoutes(): Map<string, ParsedRoute> {
    if (_routesCache) return _routesCache;
    const lines = routesRaw.trim().split('\n');
    const header = lines[0].split(',');
    const idIdx = header.indexOf('route_id');
    const nameIdx = header.indexOf('route_short_name');
    const colorIdx = header.indexOf('route_color');

    _routesCache = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const routeId = cols[idIdx];
        const shortName = cols[nameIdx];
        _routesCache.set(routeId, {
            routeId,
            shortName,
            color: getRouteColor(shortName),
        });
    }
    return _routesCache;
}

function loadWeekdayServiceIds(): Set<string> {
    if (_weekdayServiceIds) return _weekdayServiceIds;
    const lines = calendarRaw.trim().split('\n');
    const header = lines[0].split(',');
    const serviceIdx = header.indexOf('service_id');
    const monIdx = header.indexOf('monday');

    _weekdayServiceIds = new Set();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        // Weekday service: monday=1
        if (cols[monIdx]?.trim() === '1') {
            _weekdayServiceIds.add(cols[serviceIdx]);
        }
    }
    return _weekdayServiceIds;
}

function loadShapes(): Map<string, [number, number][]> {
    if (_shapesCache) return _shapesCache;
    const lines = shapesRaw.trim().split('\n');
    const header = lines[0].split(',');
    const shapeIdx = header.indexOf('shape_id');
    const latIdx = header.indexOf('shape_pt_lat');
    const lonIdx = header.indexOf('shape_pt_lon');
    const seqIdx = header.indexOf('shape_pt_sequence');

    const raw = new Map<string, { lat: number; lon: number; seq: number }[]>();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const id = cols[shapeIdx];
        if (!raw.has(id)) raw.set(id, []);
        raw.get(id)!.push({
            lat: Number(cols[latIdx]),
            lon: Number(cols[lonIdx]),
            seq: Number(cols[seqIdx]),
        });
    }

    _shapesCache = new Map();
    for (const [id, points] of raw) {
        points.sort((a, b) => a.seq - b.seq);
        _shapesCache.set(id, points.map(p => [p.lat, p.lon]));
    }
    return _shapesCache;
}
```

**Step 8: Write the main findBestTrip() function**

```typescript
export function getTransferQuality(waitMinutes: number): TransferQuality {
    if (waitMinutes < 5) return { rating: 'tight', label: 'Tight connection', waitMinutes };
    if (waitMinutes <= 10) return { rating: 'good', label: 'Good connection', waitMinutes };
    if (waitMinutes <= 15) return { rating: 'ok', label: 'OK connection', waitMinutes };
    return { rating: 'long', label: 'Long wait', waitMinutes };
}

function minutesToTimeStr(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const period = h >= 12 ? 'p' : 'a';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

export function findBestTrip(
    polygon: [number, number][],
    school: SchoolConfig,
): StudentPassResult | null {
    const zoneStops = findStopsInZone(polygon);
    if (zoneStops.length === 0) return null;

    const schoolStop = findNearestStopToSchool(school.coords);
    if (!schoolStop) return null;

    const stopTimes = loadStopTimes();
    const trips = loadTrips();
    const routes = loadRoutes();
    const weekdayServices = loadWeekdayServiceIds();
    const shapes = loadShapes();

    const zoneStopIds = new Set(zoneStops.map(s => s.id));
    const bellStartMin = parseTimeToMinutes(school.bellStart);
    const bellEndMin = parseTimeToMinutes(school.bellEnd);

    // Build stop_times index by trip
    const tripStopTimes = new Map<string, ParsedStopTime[]>();
    for (const st of stopTimes) {
        if (!tripStopTimes.has(st.tripId)) tripStopTimes.set(st.tripId, []);
        tripStopTimes.get(st.tripId)!.push(st);
    }

    // Sort each trip's stop times by sequence
    for (const [, sts] of tripStopTimes) {
        sts.sort((a, b) => a.stopSequence - b.stopSequence);
    }

    // --- PHASE 1: Direct trips ---
    interface DirectCandidate {
        tripId: string;
        routeId: string;
        boardStopId: string;
        alightStopId: string;
        boardTime: number;
        alightTime: number;
        travelMin: number;
    }

    const directCandidates: DirectCandidate[] = [];

    for (const [tripId, sts] of tripStopTimes) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServices.has(trip.serviceId)) continue;

        // Find if this trip visits a zone stop THEN the school stop (in order)
        let boardIdx = -1;
        let alightIdx = -1;

        for (let i = 0; i < sts.length; i++) {
            if (boardIdx === -1 && zoneStopIds.has(sts[i].stopId)) boardIdx = i;
            if (boardIdx !== -1 && sts[i].stopId === schoolStop.id) { alightIdx = i; break; }
        }

        if (boardIdx !== -1 && alightIdx !== -1) {
            const boardTime = sts[boardIdx].departureMinutes;
            const alightTime = sts[alightIdx].arrivalMinutes;
            if (alightTime <= bellStartMin) {
                directCandidates.push({
                    tripId,
                    routeId: trip.routeId,
                    boardStopId: sts[boardIdx].stopId,
                    alightStopId: schoolStop.id,
                    boardTime,
                    alightTime,
                    travelMin: alightTime - boardTime,
                });
            }
        }
    }

    // Sort: latest departure first (minimize wait at school), then shortest travel
    directCandidates.sort((a, b) => b.boardTime - a.boardTime || a.travelMin - b.travelMin);

    if (directCandidates.length > 0) {
        const best = directCandidates[0];
        const trip = trips.get(best.tripId)!;
        const route = routes.get(best.routeId)!;
        const boardStop = zoneStops.find(s => s.id === best.boardStopId)!;
        const shapePoints = shapes.get(trip.shapeId) || [];

        // Find afternoon return trip (reverse direction)
        const afternoon = findAfternoonTrip(
            schoolStop.id, zoneStopIds, bellEndMin, trip.routeId,
            tripStopTimes, trips, weekdayServices
        );

        // Calculate frequency (trips per hour on this route in morning)
        const freq = calculateFrequency(best.routeId, best.boardStopId, trips, tripStopTimes, weekdayServices);

        // Find connecting routes at the school stop
        const connecting = findConnectingRoutes(schoolStop.id, best.routeId, stopTimes, trips, routes);

        return {
            tripType: 'direct',
            route: { name: route.shortName, color: route.color, shapePoints },
            boardingStop: boardStop,
            alightingStop: schoolStop,
            morningTrip: {
                boardTime: minutesToTimeStr(best.boardTime),
                alightTime: minutesToTimeStr(best.alightTime),
                totalTravelMinutes: best.travelMin,
            },
            afternoonTrip: afternoon || {
                boardTime: minutesToTimeStr(bellEndMin + 5),
                alightTime: minutesToTimeStr(bellEndMin + 5 + best.travelMin),
                nextBusTime: '',
                totalTravelMinutes: best.travelMin,
            },
            frequency: freq,
            connectingRoutes: connecting,
            stopsInZone: zoneStops,
        };
    }

    // --- PHASE 2: Transfer trips ---
    interface TransferCandidate {
        routeAId: string;
        routeBId: string;
        tripAId: string;
        tripBId: string;
        boardStopId: string;
        transferStopId: string;
        alightStopId: string;
        boardTime: number;
        transferArrival: number;
        transferDepart: number;
        arrivalTime: number;
        waitMin: number;
        totalMin: number;
    }

    const transferCandidates: TransferCandidate[] = [];

    // Find routes serving zone stops and routes serving school stop
    const routesAtZone = new Map<string, Set<string>>(); // routeId -> set of zone stopIds
    const routesAtSchool = new Set<string>(); // routeIds serving school stop

    for (const [tripId, sts] of tripStopTimes) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServices.has(trip.serviceId)) continue;

        for (const st of sts) {
            if (zoneStopIds.has(st.stopId)) {
                if (!routesAtZone.has(trip.routeId)) routesAtZone.set(trip.routeId, new Set());
                routesAtZone.get(trip.routeId)!.add(st.stopId);
            }
            if (st.stopId === schoolStop.id) {
                routesAtSchool.add(trip.routeId);
            }
        }
    }

    // For each Route A (zone) x Route B (school) pair, find shared transfer stops
    for (const [routeAId] of routesAtZone) {
        for (const routeBId of routesAtSchool) {
            if (routeAId === routeBId) continue; // Already checked as direct

            // Find stops served by both routes
            const stopsA = new Set<string>();
            const stopsB = new Set<string>();
            for (const [tripId, sts] of tripStopTimes) {
                const trip = trips.get(tripId);
                if (!trip || !weekdayServices.has(trip.serviceId)) continue;
                if (trip.routeId === routeAId) sts.forEach(st => stopsA.add(st.stopId));
                if (trip.routeId === routeBId) sts.forEach(st => stopsB.add(st.stopId));
            }
            const sharedStops = [...stopsA].filter(s => stopsB.has(s));
            if (sharedStops.length === 0) continue;

            // For each shared transfer stop, find best trip pair
            for (const transferStopId of sharedStops) {
                // Route A: zone → transfer stop
                for (const [tripAId, stsA] of tripStopTimes) {
                    const tripA = trips.get(tripAId);
                    if (!tripA || tripA.routeId !== routeAId || !weekdayServices.has(tripA.serviceId)) continue;

                    let boardIdx = -1, transferIdx = -1;
                    for (let i = 0; i < stsA.length; i++) {
                        if (boardIdx === -1 && zoneStopIds.has(stsA[i].stopId)) boardIdx = i;
                        if (boardIdx !== -1 && stsA[i].stopId === transferStopId) { transferIdx = i; break; }
                    }
                    if (boardIdx === -1 || transferIdx === -1) continue;

                    const transferArrival = stsA[transferIdx].arrivalMinutes;

                    // Route B: transfer stop → school
                    for (const [tripBId, stsB] of tripStopTimes) {
                        const tripB = trips.get(tripBId);
                        if (!tripB || tripB.routeId !== routeBId || !weekdayServices.has(tripB.serviceId)) continue;

                        let txIdx = -1, schoolIdx = -1;
                        for (let i = 0; i < stsB.length; i++) {
                            if (txIdx === -1 && stsB[i].stopId === transferStopId) txIdx = i;
                            if (txIdx !== -1 && stsB[i].stopId === schoolStop.id) { schoolIdx = i; break; }
                        }
                        if (txIdx === -1 || schoolIdx === -1) continue;

                        const transferDepart = stsB[txIdx].departureMinutes;
                        const waitMin = transferDepart - transferArrival;
                        if (waitMin < 0 || waitMin > 30) continue; // Skip negative or very long waits

                        const arrivalTime = stsB[schoolIdx].arrivalMinutes;
                        if (arrivalTime > bellStartMin) continue; // Must arrive before bell

                        transferCandidates.push({
                            routeAId, routeBId, tripAId, tripBId,
                            boardStopId: stsA[boardIdx].stopId,
                            transferStopId,
                            alightStopId: schoolStop.id,
                            boardTime: stsA[boardIdx].departureMinutes,
                            transferArrival,
                            transferDepart,
                            arrivalTime,
                            waitMin,
                            totalMin: arrivalTime - stsA[boardIdx].departureMinutes,
                        });
                    }
                }
            }
        }
    }

    // Rank transfers: prefer good wait (5-10), then latest departure, then shortest total
    transferCandidates.sort((a, b) => {
        const qualA = getTransferQuality(a.waitMin).rating === 'good' ? 0 : 1;
        const qualB = getTransferQuality(b.waitMin).rating === 'good' ? 0 : 1;
        if (qualA !== qualB) return qualA - qualB;
        if (b.boardTime !== a.boardTime) return b.boardTime - a.boardTime;
        return a.totalMin - b.totalMin;
    });

    if (transferCandidates.length > 0) {
        const best = transferCandidates[0];
        const tripA = trips.get(best.tripAId)!;
        const tripB = trips.get(best.tripBId)!;
        const routeA = routes.get(best.routeAId)!;
        const routeB = routes.get(best.routeBId)!;
        const boardStop = zoneStops.find(s => s.id === best.boardStopId)!;
        const allStops = getAllStopsWithCoords();
        const txStop = allStops.find(s => s.stop_id === best.transferStopId);
        const shapeA = shapes.get(tripA.shapeId) || [];
        const shapeB = shapes.get(tripB.shapeId) || [];

        const freq = calculateFrequency(best.routeAId, best.boardStopId, trips, tripStopTimes, weekdayServices);
        const connecting = findConnectingRoutes(best.transferStopId, '', stopTimes, trips, routes);

        return {
            tripType: 'transfer',
            boardingStop: boardStop,
            alightingStop: schoolStop,
            transfer: {
                routeA: { name: routeA.shortName, color: routeA.color, shapePoints: shapeA },
                routeB: { name: routeB.shortName, color: routeB.color, shapePoints: shapeB },
                transferStop: {
                    id: best.transferStopId,
                    name: txStop?.stop_name || 'Transfer Point',
                    lat: txStop?.lat || 0,
                    lon: txStop?.lon || 0,
                },
                quality: getTransferQuality(best.waitMin),
            },
            morningTrip: {
                boardTime: minutesToTimeStr(best.boardTime),
                alightTime: minutesToTimeStr(best.transferArrival),
                transferLeg: {
                    boardTime: minutesToTimeStr(best.transferDepart),
                    alightTime: minutesToTimeStr(best.arrivalTime),
                },
                totalTravelMinutes: best.totalMin,
            },
            afternoonTrip: {
                // Afternoon transfer trip finding would use reverse logic
                boardTime: minutesToTimeStr(best.arrivalTime),
                alightTime: minutesToTimeStr(best.boardTime),
                nextBusTime: '',
                totalTravelMinutes: best.totalMin,
            },
            frequency: freq,
            connectingRoutes: connecting,
            stopsInZone: zoneStops,
        };
    }

    return null; // No route found
}
```

**Step 9: Write helper functions**

```typescript
function findAfternoonTrip(
    schoolStopId: string,
    zoneStopIds: Set<string>,
    bellEndMin: number,
    routeId: string,
    tripStopTimes: Map<string, ParsedStopTime[]>,
    trips: Map<string, ParsedTrip>,
    weekdayServices: Set<string>,
): StudentPassResult['afternoonTrip'] | null {
    interface AfternoonCandidate {
        boardTime: number;
        alightTime: number;
        nextBusTime: number | null;
    }
    const candidates: AfternoonCandidate[] = [];

    for (const [tripId, sts] of tripStopTimes) {
        const trip = trips.get(tripId);
        if (!trip || trip.routeId !== routeId || !weekdayServices.has(trip.serviceId)) continue;

        let schoolIdx = -1, zoneIdx = -1;
        for (let i = 0; i < sts.length; i++) {
            if (schoolIdx === -1 && sts[i].stopId === schoolStopId) schoolIdx = i;
            if (schoolIdx !== -1 && zoneStopIds.has(sts[i].stopId)) { zoneIdx = i; break; }
        }

        if (schoolIdx !== -1 && zoneIdx !== -1) {
            const boardTime = sts[schoolIdx].departureMinutes;
            if (boardTime >= bellEndMin) {
                candidates.push({
                    boardTime,
                    alightTime: sts[zoneIdx].arrivalMinutes,
                    nextBusTime: null,
                });
            }
        }
    }

    candidates.sort((a, b) => a.boardTime - b.boardTime);
    if (candidates.length === 0) return null;

    const best = candidates[0];
    const next = candidates.length > 1 ? candidates[1] : null;

    return {
        boardTime: minutesToTimeStr(best.boardTime),
        alightTime: minutesToTimeStr(best.alightTime),
        nextBusTime: next ? minutesToTimeStr(next.boardTime) : '',
        totalTravelMinutes: best.alightTime - best.boardTime,
    };
}

function calculateFrequency(
    routeId: string,
    stopId: string,
    trips: Map<string, ParsedTrip>,
    tripStopTimes: Map<string, ParsedStopTime[]>,
    weekdayServices: Set<string>,
): number {
    // Count departures at this stop on this route during 6am-9am
    const departures: number[] = [];
    for (const [tripId, sts] of tripStopTimes) {
        const trip = trips.get(tripId);
        if (!trip || trip.routeId !== routeId || !weekdayServices.has(trip.serviceId)) continue;
        for (const st of sts) {
            if (st.stopId === stopId && st.departureMinutes >= 360 && st.departureMinutes <= 540) {
                departures.push(st.departureMinutes);
            }
        }
    }
    if (departures.length <= 1) return 60;
    departures.sort((a, b) => a - b);
    const gaps = departures.slice(1).map((d, i) => d - departures[i]);
    return Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
}

function findConnectingRoutes(
    stopId: string,
    excludeRouteId: string,
    stopTimes: ParsedStopTime[],
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
): string[] {
    const routeIds = new Set<string>();
    for (const st of stopTimes) {
        if (st.stopId !== stopId) continue;
        const trip = trips.get(st.tripId);
        if (trip && trip.routeId !== excludeRouteId) routeIds.add(trip.routeId);
    }
    return [...routeIds].map(id => routes.get(id)?.shortName || id).sort();
}
```

**Step 10: Write tests for findBestTrip core logic**

```typescript
// Add to tests/studentPassUtils.test.ts
import { getTransferQuality } from '../utils/transit-app/studentPassUtils';

describe('getTransferQuality', () => {
    it('rates < 5 min as tight', () => {
        expect(getTransferQuality(3).rating).toBe('tight');
    });
    it('rates 5-10 min as good', () => {
        expect(getTransferQuality(7).rating).toBe('good');
    });
    it('rates 10-15 min as ok', () => {
        expect(getTransferQuality(12).rating).toBe('ok');
    });
    it('rates > 15 min as long', () => {
        expect(getTransferQuality(20).rating).toBe('long');
    });
    it('rates exactly 5 min as good', () => {
        expect(getTransferQuality(5).rating).toBe('good');
    });
    it('rates exactly 10 min as good', () => {
        expect(getTransferQuality(10).rating).toBe('good');
    });
    it('rates exactly 15 min as ok', () => {
        expect(getTransferQuality(15).rating).toBe('ok');
    });
});
```

**Step 11: Run all tests**

Run: `npx vitest run tests/studentPassUtils.test.ts`
Expected: All pass.

**Step 12: Commit**

```bash
git add utils/transit-app/studentPassUtils.ts tests/studentPassUtils.test.ts
git commit -m "feat: add GTFS trip-finding algorithm for student pass generator"
```

---

## Task 3: Create StudentPassModule tab shell

**Files:**
- Create: `components/Analytics/StudentPassModule.tsx`
- Modify: `components/Analytics/TransitAppWorkspace.tsx`

**Reference:** TransitAppWorkspace.tsx TAB_CONFIG pattern (lines 39-50) and renderPanel() (lines 96-117)

**Step 1: Create the module shell**

```typescript
// components/Analytics/StudentPassModule.tsx
import React, { useState, useCallback } from 'react';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { BARRIE_SCHOOLS } from '../../utils/transit-app/studentPassUtils';

export const StudentPassModule: React.FC = () => {
    const [selectedSchool, setSelectedSchool] = useState<SchoolConfig | null>(null);
    const [bellStart, setBellStart] = useState('');
    const [bellEnd, setBellEnd] = useState('');
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);
    const [result, setResult] = useState<StudentPassResult | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const handleSchoolChange = useCallback((school: SchoolConfig | null) => {
        setSelectedSchool(school);
        if (school) {
            setBellStart(school.bellStart);
            setBellEnd(school.bellEnd);
        }
        setResult(null);
    }, []);

    const handlePolygonComplete = useCallback((coords: [number, number][]) => {
        setPolygon(coords);
    }, []);

    return (
        <div className="h-full flex">
            {/* Left config panel */}
            <div className="w-72 bg-gray-50 border-r border-gray-200 overflow-y-auto flex-shrink-0">
                <div className="p-4 border-b border-gray-200">
                    <h3 className="text-sm font-bold text-gray-900 mb-3">School</h3>
                    <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        value={selectedSchool?.name || ''}
                        onChange={e => {
                            const school = BARRIE_SCHOOLS.find(s => s.name === e.target.value) || null;
                            handleSchoolChange(school);
                        }}
                    >
                        <option value="">Select a school...</option>
                        {BARRIE_SCHOOLS.map(s => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                    </select>
                </div>

                {selectedSchool && (
                    <div className="p-4 border-b border-gray-200">
                        <h3 className="text-sm font-bold text-gray-900 mb-3">Bell Times</h3>
                        <div className="space-y-2">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Morning Start</label>
                                <input
                                    type="time"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                    value={bellStart}
                                    onChange={e => setBellStart(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Afternoon End</label>
                                <input
                                    type="time"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                    value={bellEnd}
                                    onChange={e => setBellEnd(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Placeholder sections for zone info, trip result, export */}
                {!selectedSchool && (
                    <div className="p-4 text-center text-sm text-gray-400">
                        Select a school to begin
                    </div>
                )}
            </div>

            {/* Right content area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Map area placeholder */}
                <div className="flex-1 bg-gray-100 flex items-center justify-center text-gray-400">
                    Map will render here (Task 4)
                </div>

                {/* Preview area placeholder */}
                <div className="h-64 border-t border-gray-200 bg-white flex items-center justify-center text-gray-400">
                    Flyer preview will render here (Task 5)
                </div>
            </div>
        </div>
    );
};
```

**Step 2: Add tab to TransitAppWorkspace**

In `TransitAppWorkspace.tsx`:

Add to imports:
```typescript
import { StudentPassModule } from './StudentPassModule';
import { GraduationCap } from 'lucide-react';
```

Add to TAB_CONFIG array (after the last entry):
```typescript
{ id: 'student-pass', label: 'Student Pass', icon: GraduationCap, status: 'complete' },
```

Add case to `renderPanel()` switch:
```typescript
case 'student-pass':
    return <StudentPassModule />;
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 4: Commit**

```bash
git add components/Analytics/StudentPassModule.tsx components/Analytics/TransitAppWorkspace.tsx
git commit -m "feat: add Student Pass tab shell to TransitApp workspace"
```

---

## Task 4: Create StudentPassMap with polygon drawing

**Files:**
- Create: `components/Analytics/StudentPassMap.tsx`
- Modify: `components/Analytics/StudentPassModule.tsx` — wire up map

**Reference files:**
- `components/Analytics/TransfersModule.tsx:288-315` — Leaflet map init pattern
- `components/Mapping/HeadwayMap.tsx:189-242` — polyline drawing pattern

**Step 1: Create the map component**

```typescript
// components/Analytics/StudentPassMap.tsx
import React, { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { getRouteColor } from '../../utils/config/routeColors';

const BARRIE_CENTER: [number, number] = [44.38, -79.69];

const MAP_STYLES = `
.student-pass-map .leaflet-draw-toolbar a {
    background-color: white;
}
.school-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #1F2937;
    border: 3px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    font-size: 16px;
}
.travel-time-label {
    background: rgba(17, 24, 39, 0.9);
    color: white;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    border: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
@keyframes hub-ring {
    0% { transform: scale(0.8); opacity: 0.6; }
    100% { transform: scale(2.2); opacity: 0; }
}
.transfer-hub-glow {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px; height: 28px;
}
.transfer-hub-glow .core {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #F59E0B;
    box-shadow: 0 0 10px 4px #F59E0B;
    z-index: 1;
}
.transfer-hub-glow .ring {
    position: absolute; inset: -2px;
    border-radius: 50%;
    border: 2px solid #F59E0B;
    animation: hub-ring 2.5s ease-out infinite;
}
`;

interface StudentPassMapProps {
    school: SchoolConfig | null;
    result: StudentPassResult | null;
    onPolygonComplete: (coords: [number, number][]) => void;
    onPolygonClear: () => void;
}

export const StudentPassMap: React.FC<StudentPassMapProps> = ({
    school,
    result,
    onPolygonComplete,
    onPolygonClear,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const drawLayerRef = useRef<L.FeatureGroup | null>(null);
    const overlayLayerRef = useRef<L.LayerGroup | null>(null);
    const schoolMarkerRef = useRef<L.Marker | null>(null);
    const drawControlRef = useRef<L.Control.Draw | null>(null);

    // Init map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        // Inject styles
        const style = document.createElement('style');
        style.textContent = MAP_STYLES;
        document.head.appendChild(style);

        const map = L.map(containerRef.current, {
            center: BARRIE_CENTER,
            zoom: 13,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            scrollWheelZoom: 'center',
            wheelPxPerZoomLevel: 120,
        });

        // Satellite tiles (Esri World Imagery)
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
                attribution: 'Tiles &copy; Esri',
                maxZoom: 18,
            }
        ).addTo(map);

        // Labels overlay on satellite
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 18, opacity: 0.7 }
        ).addTo(map);

        const drawLayer = new L.FeatureGroup();
        map.addLayer(drawLayer);
        drawLayerRef.current = drawLayer;

        const overlayLayer = L.layerGroup().addTo(map);
        overlayLayerRef.current = overlayLayer;

        // Draw control
        const drawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                polygon: {
                    allowIntersection: false,
                    shapeOptions: {
                        color: '#1D4ED8',
                        fillColor: '#3B82F6',
                        fillOpacity: 0.25,
                        weight: 2,
                    },
                },
                polyline: false,
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
            },
            edit: {
                featureGroup: drawLayer,
                remove: true,
            },
        });
        map.addControl(drawControl);
        drawControlRef.current = drawControl;

        // Handle draw events
        map.on(L.Draw.Event.CREATED, (e: L.DrawEvents.Created) => {
            drawLayer.clearLayers();
            drawLayer.addLayer(e.layer);
            const latlngs = (e.layer as L.Polygon).getLatLngs()[0] as L.LatLng[];
            onPolygonComplete(latlngs.map(ll => [ll.lat, ll.lng]));
        });

        map.on(L.Draw.Event.EDITED, () => {
            const layers = drawLayer.getLayers();
            if (layers.length > 0) {
                const latlngs = (layers[0] as L.Polygon).getLatLngs()[0] as L.LatLng[];
                onPolygonComplete(latlngs.map(ll => [ll.lat, ll.lng]));
            }
        });

        map.on(L.Draw.Event.DELETED, () => {
            onPolygonClear();
        });

        mapRef.current = map;

        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(containerRef.current);

        return () => {
            style.remove();
            ro.disconnect();
            map.remove();
            mapRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update school marker
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (schoolMarkerRef.current) {
            schoolMarkerRef.current.remove();
            schoolMarkerRef.current = null;
        }

        if (school) {
            const marker = L.marker(school.coords, {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="school-marker">🏫</div>',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                }),
            });
            marker.bindTooltip(school.name, { direction: 'top', offset: [0, -20] });
            marker.addTo(map);
            schoolMarkerRef.current = marker;

            map.setView(school.coords, 13, { animate: true });
        }
    }, [school]);

    // Render route + stops overlay when result changes
    useEffect(() => {
        const layer = overlayLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (!result) return;

        // Draw route polyline(s)
        if (result.tripType === 'direct' && result.route) {
            L.polyline(result.route.shapePoints, {
                color: result.route.color,
                weight: 5,
                opacity: 0.9,
                lineCap: 'round',
            }).addTo(layer);
        } else if (result.tripType === 'transfer' && result.transfer) {
            // Route A: solid
            L.polyline(result.transfer.routeA.shapePoints, {
                color: result.transfer.routeA.color,
                weight: 5,
                opacity: 0.9,
            }).addTo(layer);
            // Route B: dashed
            L.polyline(result.transfer.routeB.shapePoints, {
                color: result.transfer.routeB.color,
                weight: 5,
                opacity: 0.9,
                dashArray: '8, 6',
            }).addTo(layer);

            // Transfer stop glow
            const ts = result.transfer.transferStop;
            L.marker([ts.lat, ts.lon], {
                icon: L.divIcon({
                    className: '',
                    html: `<div class="transfer-hub-glow"><div class="core"></div><div class="ring"></div></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                }),
            }).bindTooltip(
                `Transfer: ${ts.name} (${result.transfer.quality.waitMinutes} min wait)`,
                { direction: 'top', offset: [0, -16] }
            ).addTo(layer);
        }

        // Zone stop markers
        for (const stop of result.stopsInZone) {
            L.circleMarker([stop.lat, stop.lon], {
                radius: 6,
                fillColor: '#ffffff',
                color: '#3B82F6',
                weight: 2,
                fillOpacity: 1,
            }).bindTooltip(stop.name, { direction: 'top' }).addTo(layer);
        }

        // Boarding stop highlight
        const bs = result.boardingStop;
        L.circleMarker([bs.lat, bs.lon], {
            radius: 8,
            fillColor: '#10B981',
            color: '#ffffff',
            weight: 3,
            fillOpacity: 1,
        }).bindTooltip(`Board here: ${bs.name}`, { direction: 'top', permanent: false }).addTo(layer);

        // Travel time label at route midpoint
        const routePoints = result.route?.shapePoints || result.transfer?.routeA.shapePoints || [];
        if (routePoints.length > 2) {
            const mid = routePoints[Math.floor(routePoints.length / 2)];
            L.marker(mid, {
                icon: L.divIcon({
                    className: '',
                    html: `<div class="travel-time-label">${result.morningTrip.totalTravelMinutes} Min Bus Travel Time</div>`,
                    iconSize: [200, 30],
                    iconAnchor: [100, 15],
                }),
                interactive: false,
            }).addTo(layer);
        }
    }, [result]);

    return (
        <div
            ref={containerRef}
            className="student-pass-map w-full h-full"
            style={{ minHeight: 300 }}
        />
    );
};
```

**Step 2: Wire map into StudentPassModule**

Replace the map placeholder in `StudentPassModule.tsx` with:

```typescript
import { StudentPassMap } from './StudentPassMap';
import { findBestTrip } from '../../utils/transit-app/studentPassUtils';

// Inside the component, add calculation trigger:
const handlePolygonComplete = useCallback((coords: [number, number][]) => {
    setPolygon(coords);
    if (selectedSchool) {
        setIsCalculating(true);
        // Run async to avoid blocking UI
        requestAnimationFrame(() => {
            const schoolWithOverrides = {
                ...selectedSchool,
                bellStart: bellStart || selectedSchool.bellStart,
                bellEnd: bellEnd || selectedSchool.bellEnd,
            };
            const tripResult = findBestTrip(coords, schoolWithOverrides);
            setResult(tripResult);
            setIsCalculating(false);
        });
    }
}, [selectedSchool, bellStart, bellEnd]);

const handlePolygonClear = useCallback(() => {
    setPolygon(null);
    setResult(null);
}, []);

// Replace map placeholder:
<StudentPassMap
    school={selectedSchool}
    result={result}
    onPolygonComplete={handlePolygonComplete}
    onPolygonClear={handlePolygonClear}
/>
```

Also add zone info and trip result sections to the config panel (after bell times):

```typescript
{polygon && result && (
    <div className="p-4 border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-900 mb-2">Trip Found</h3>
        <div className="space-y-1 text-sm text-gray-700">
            <p>
                <span className="font-medium">Type:</span>{' '}
                {result.tripType === 'direct' ? 'Direct' : 'Transfer'}
            </p>
            {result.route && (
                <p>
                    <span className="inline-block w-3 h-3 rounded-full mr-1" style={{ backgroundColor: result.route.color }} />
                    Route {result.route.name}
                </p>
            )}
            {result.transfer && (
                <>
                    <p>
                        <span className="inline-block w-3 h-3 rounded-full mr-1" style={{ backgroundColor: result.transfer.routeA.color }} />
                        Route {result.transfer.routeA.name} →{' '}
                        <span className="inline-block w-3 h-3 rounded-full mr-1" style={{ backgroundColor: result.transfer.routeB.color }} />
                        Route {result.transfer.routeB.name}
                    </p>
                    <p className="text-xs">
                        Transfer at {result.transfer.transferStop.name}
                    </p>
                </>
            )}
            <p><span className="font-medium">Travel:</span> {result.morningTrip.totalTravelMinutes} min</p>
            <p><span className="font-medium">Stops in zone:</span> {result.stopsInZone.length}</p>
        </div>
    </div>
)}

{polygon && !result && !isCalculating && (
    <div className="p-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            No transit route connects this zone to {selectedSchool?.name} before the bell time.
        </div>
    </div>
)}

{isCalculating && (
    <div className="p-4 text-center">
        <RefreshCw className="animate-spin mx-auto text-gray-400" size={20} />
        <p className="text-xs text-gray-400 mt-2">Finding best trip...</p>
    </div>
)}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add components/Analytics/StudentPassMap.tsx components/Analytics/StudentPassModule.tsx
git commit -m "feat: add Leaflet map with polygon drawing for student pass"
```

---

## Task 5: Create StudentPassPreview (live flyer panel)

**Files:**
- Create: `components/Analytics/StudentPassPreview.tsx`
- Modify: `components/Analytics/StudentPassModule.tsx` — wire up preview

**Step 1: Create the preview component**

```typescript
// components/Analytics/StudentPassPreview.tsx
import React, { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { SchoolConfig, StudentPassResult, TransferQuality } from '../../utils/transit-app/studentPassUtils';

const QUALITY_STYLES: Record<TransferQuality['rating'], string> = {
    tight: 'bg-red-50 text-red-700 border-red-200',
    good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ok: 'bg-amber-50 text-amber-700 border-amber-200',
    long: 'bg-red-50 text-red-700 border-red-200',
};

interface StudentPassPreviewProps {
    school: SchoolConfig;
    result: StudentPassResult;
    bellStart: string;
    bellEnd: string;
}

export const StudentPassPreview: React.FC<StudentPassPreviewProps> = ({
    school,
    result,
    bellStart,
    bellEnd,
}) => {
    const [collapsed, setCollapsed] = useState(false);

    if (collapsed) {
        return (
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 flex items-center justify-between cursor-pointer"
                 onClick={() => setCollapsed(false)}>
                <span className="text-sm font-medium text-gray-600">Flyer Preview</span>
                <ChevronUp size={16} className="text-gray-400" />
            </div>
        );
    }

    const routeName = result.tripType === 'direct'
        ? `Route ${result.route?.name}`
        : `Route ${result.transfer?.routeA.name} → Route ${result.transfer?.routeB.name}`;

    return (
        <div className="border-t border-gray-200 bg-white">
            {/* Collapse toggle */}
            <div className="px-4 py-1.5 flex items-center justify-between cursor-pointer bg-gray-50 border-b border-gray-100"
                 onClick={() => setCollapsed(true)}>
                <span className="text-xs font-medium text-gray-500">Flyer Preview</span>
                <ChevronDown size={14} className="text-gray-400" />
            </div>

            {/* Flyer content */}
            <div id="student-pass-preview" className="mx-4 my-3 border border-gray-300 rounded-xl shadow-md overflow-hidden">
                {/* Title bar */}
                <div className="bg-gray-900 text-white px-6 py-3">
                    <h2 className="text-lg font-bold">{school.name}</h2>
                    <p className="text-sm text-gray-300">Student Transit Pass</p>
                </div>

                {/* In Numbers */}
                <div className="px-6 py-4">
                    <h3 className="text-base font-bold text-gray-900 mb-2">
                        Zone — In Numbers
                    </h3>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1.5">
                        <p className="text-sm text-gray-700">
                            <span className="font-medium">Trip Time:</span>{' '}
                            {result.morningTrip.totalTravelMinutes} minutes transit time to/from {school.name}.
                        </p>

                        {result.tripType === 'transfer' && result.transfer && (
                            <>
                                <p className="text-sm text-gray-700">
                                    <span className="font-medium">Transfer:</span>{' '}
                                    {routeName} at {result.transfer.transferStop.name}
                                </p>
                                <p className="text-sm flex items-center gap-2">
                                    <span className="font-medium text-gray-700">Connection:</span>
                                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border ${QUALITY_STYLES[result.transfer.quality.rating]}`}>
                                        {result.transfer.quality.label} ({result.transfer.quality.waitMinutes} min)
                                    </span>
                                </p>
                            </>
                        )}

                        <p className="text-sm text-gray-700">
                            <span className="font-medium">Bus Frequency:</span>{' '}
                            Every {result.frequency} minutes
                        </p>

                        {result.connectingRoutes.length > 0 && (
                            <p className="text-sm text-gray-700">
                                <span className="font-medium">Connecting Routes:</span>{' '}
                                {result.connectingRoutes.join(', ')}
                            </p>
                        )}
                    </div>
                </div>

                {/* Morning / Afternoon columns */}
                <div className="px-6 pb-4 grid grid-cols-2 gap-4">
                    {/* Morning */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <h4 className="text-sm font-bold text-gray-900 mb-2">Morning Trip</h4>
                        <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                            <li>Board {result.tripType === 'direct' ? `Route ${result.route?.name}` : `Route ${result.transfer?.routeA.name}`} at {result.morningTrip.boardTime}.</li>
                            {result.tripType === 'transfer' && result.morningTrip.transferLeg && (
                                <>
                                    <li>Transfer at {result.transfer?.transferStop.name} ({result.transfer?.quality.waitMinutes} min wait).</li>
                                    <li>Board Route {result.transfer?.routeB.name} at {result.morningTrip.transferLeg.boardTime}.</li>
                                </>
                            )}
                            <li>
                                {result.tripType === 'direct'
                                    ? `Deboard at ${result.alightingStop.name} at ${result.morningTrip.alightTime}.`
                                    : `Arrive at ${result.alightingStop.name} at ${result.morningTrip.transferLeg?.alightTime}.`
                                }
                            </li>
                            <li>Walk to {school.name}, {bellStart} bell time.</li>
                        </ol>
                    </div>

                    {/* Afternoon */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <h4 className="text-sm font-bold text-gray-900 mb-2">Afternoon Trip</h4>
                        <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                            <li>{bellEnd} bell time, walk to bus stop.</li>
                            <li>Board {result.tripType === 'direct' ? `Route ${result.route?.name}` : `Route ${result.transfer?.routeB.name}`} at {result.afternoonTrip.boardTime}.</li>
                            {result.tripType === 'transfer' && result.afternoonTrip.transferLeg && (
                                <>
                                    <li>Transfer at {result.transfer?.transferStop.name}.</li>
                                    <li>Board Route {result.transfer?.routeA.name} at {result.afternoonTrip.transferLeg.boardTime}.</li>
                                </>
                            )}
                            <li>Arrive in zone at {result.afternoonTrip.alightTime}.</li>
                            {result.afternoonTrip.nextBusTime && (
                                <li className="text-gray-500">(Next bus at {result.afternoonTrip.nextBusTime})</li>
                            )}
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
};
```

**Step 2: Wire into StudentPassModule**

Replace the preview placeholder:

```typescript
import { StudentPassPreview } from './StudentPassPreview';

// In the JSX, replace the preview placeholder:
{result && selectedSchool && (
    <StudentPassPreview
        school={selectedSchool}
        result={result}
        bellStart={bellStart || selectedSchool.bellStart}
        bellEnd={bellEnd || selectedSchool.bellEnd}
    />
)}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add components/Analytics/StudentPassPreview.tsx components/Analytics/StudentPassModule.tsx
git commit -m "feat: add live flyer preview panel for student transit pass"
```

---

## Task 6: Add PDF export

**Files:**
- Modify: `components/Analytics/StudentPassModule.tsx` — add export button + logic
- Reference: `components/Reports/PublicTimetable.tsx:554-623` — jsPDF + html2canvas pattern

**Step 1: Add the export function**

Create the export handler in `StudentPassModule.tsx`:

```typescript
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Download } from 'lucide-react';

const [isExporting, setIsExporting] = useState(false);

const handleExport = useCallback(async () => {
    if (!result || !selectedSchool) return;
    setIsExporting(true);

    try {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        let y = margin;

        // Title bar
        doc.setFillColor(31, 41, 55); // gray-900
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text(selectedSchool.name, margin, 12);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(209, 213, 219); // gray-300
        doc.text('Student Transit Pass', margin, 19);
        y = 30;

        // Capture map
        const mapEl = document.querySelector('.student-pass-map') as HTMLElement;
        if (mapEl) {
            const canvas = await html2canvas(mapEl, {
                useCORS: true,
                allowTaint: true,
                scale: 2,
            });
            const imgData = canvas.toDataURL('image/png');
            const maxWidth = pageWidth - 2 * margin;
            const imgHeight = (canvas.height / canvas.width) * maxWidth;
            doc.addImage(imgData, 'PNG', margin, y, maxWidth, Math.min(imgHeight, 120));
            y += Math.min(imgHeight, 120) + 5;
        }

        // In Numbers section
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(17, 24, 39); // gray-900
        doc.text('Zone — In Numbers', margin, y + 5);
        y += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(55, 65, 81); // gray-700

        const lines = [
            `• Trip Time: ${result.morningTrip.totalTravelMinutes} minutes transit time to/from ${selectedSchool.name}.`,
            `• Bus Frequency: Every ${result.frequency} minutes`,
        ];

        if (result.tripType === 'transfer' && result.transfer) {
            lines.splice(1, 0,
                `• Transfer: Route ${result.transfer.routeA.name} → Route ${result.transfer.routeB.name} at ${result.transfer.transferStop.name}`,
                `• Connection: ${result.transfer.quality.label} (${result.transfer.quality.waitMinutes} min wait)`,
            );
        }

        if (result.connectingRoutes.length > 0) {
            lines.push(`• Connecting Routes: ${result.connectingRoutes.join(', ')}`);
        }

        for (const line of lines) {
            doc.text(line, margin, y);
            y += 5;
        }
        y += 3;

        // Morning / Afternoon columns
        const colWidth = (pageWidth - 2 * margin - 5) / 2;

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Morning Trip', margin, y);
        doc.text('Afternoon Trip', margin + colWidth + 5, y);
        y += 5;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');

        // Morning steps
        const morningSteps = buildMorningSteps(result, selectedSchool, bellStart || selectedSchool.bellStart);
        const afternoonSteps = buildAfternoonSteps(result, selectedSchool, bellEnd || selectedSchool.bellEnd);

        const maxSteps = Math.max(morningSteps.length, afternoonSteps.length);
        for (let i = 0; i < maxSteps; i++) {
            if (morningSteps[i]) doc.text(morningSteps[i], margin, y, { maxWidth: colWidth });
            if (afternoonSteps[i]) doc.text(afternoonSteps[i], margin + colWidth + 5, y, { maxWidth: colWidth });
            y += 5;
        }

        // Footer
        y = doc.internal.pageSize.getHeight() - 10;
        doc.setFontSize(8);
        doc.setTextColor(156, 163, 175);
        doc.text(`Barrie Transit • Generated ${new Date().toLocaleDateString()}`, margin, y);

        // Save
        const filename = selectedSchool.name.replace(/[^a-zA-Z0-9]/g, '-') + '-Student-Transit-Pass.pdf';
        doc.save(filename);
    } catch (err) {
        console.error('PDF export error:', err);
    } finally {
        setIsExporting(false);
    }
}, [result, selectedSchool, bellStart, bellEnd]);

// Helper functions for building step text
function buildMorningSteps(result: StudentPassResult, school: SchoolConfig, bellStart: string): string[] {
    const steps: string[] = [];
    if (result.tripType === 'direct') {
        steps.push(`1) Board Route ${result.route?.name} at ${result.morningTrip.boardTime}.`);
        steps.push(`2) Deboard at ${result.alightingStop.name} at ${result.morningTrip.alightTime}.`);
        steps.push(`3) Walk to ${school.name}, ${bellStart} bell time.`);
    } else if (result.transfer) {
        steps.push(`1) Board Route ${result.transfer.routeA.name} at ${result.morningTrip.boardTime}.`);
        steps.push(`2) Transfer at ${result.transfer.transferStop.name} (${result.transfer.quality.waitMinutes} min).`);
        steps.push(`3) Board Route ${result.transfer.routeB.name} at ${result.morningTrip.transferLeg?.boardTime}.`);
        steps.push(`4) Arrive at ${school.name}, ${bellStart} bell time.`);
    }
    return steps;
}

function buildAfternoonSteps(result: StudentPassResult, school: SchoolConfig, bellEnd: string): string[] {
    const steps: string[] = [];
    steps.push(`1) ${bellEnd} bell time, walk to bus stop.`);
    if (result.tripType === 'direct') {
        steps.push(`2) Board Route ${result.route?.name} at ${result.afternoonTrip.boardTime}.`);
        if (result.afternoonTrip.nextBusTime) {
            steps.push(`   (next bus at ${result.afternoonTrip.nextBusTime})`);
        }
    } else if (result.transfer) {
        steps.push(`2) Board Route ${result.transfer.routeB.name} at ${result.afternoonTrip.boardTime}.`);
        steps.push(`3) Transfer at ${result.transfer.transferStop.name}.`);
        steps.push(`4) Board Route ${result.transfer.routeA.name}.`);
    }
    return steps;
}
```

**Step 2: Add export button to config panel**

Add at the bottom of the config panel (after trip result section):

```typescript
{result && (
    <div className="p-4">
        <button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {isExporting ? (
                <>
                    <RefreshCw className="animate-spin" size={16} />
                    Generating...
                </>
            ) : (
                <>
                    <Download size={16} />
                    Download PDF
                </>
            )}
        </button>
    </div>
)}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Manual test**

1. Open app → TransitApp workspace → Student Pass tab
2. Select Maple Ridge Secondary School
3. Draw zone polygon around the Pine/Hurst area
4. Verify route auto-detected and preview populated
5. Click Download PDF → verify output matches flyer design

**Step 5: Commit**

```bash
git add components/Analytics/StudentPassModule.tsx
git commit -m "feat: add PDF export for student transit pass flyer"
```

---

## Task 7: Final integration test and cleanup

**Files:**
- All created files — review for consistency
- Run full build and test suite

**Step 1: Run all tests**

```bash
npx vitest run tests/studentPassUtils.test.ts
```
Expected: All pass.

**Step 2: Full build verification**

```bash
npm run build
```
Expected: Clean build, no warnings.

**Step 3: Verify in browser**

1. Navigate to TransitApp workspace
2. Confirm "Student Pass" tab appears in tab bar
3. Select each school, verify coordinates place marker correctly
4. Draw zone, verify stops detected
5. Verify both direct and transfer trip types work
6. Verify preview panel content matches design
7. Export PDF and verify output

**Step 4: Final commit**

```bash
git add -A -- ':!nul'
git commit -m "feat: complete student transit pass generator with GTFS trip finding, map, preview, and PDF export"
```

---

## Summary

| Task | What | Files | Est. Complexity |
|------|------|-------|----------------|
| 1 | Install leaflet-draw | package.json | Low |
| 2 | GTFS trip-finding algorithm | studentPassUtils.ts + tests | High |
| 3 | Module tab shell | StudentPassModule.tsx + workspace | Low |
| 4 | Leaflet map with polygon drawing | StudentPassMap.tsx | Medium |
| 5 | Live flyer preview | StudentPassPreview.tsx | Medium |
| 6 | PDF export | StudentPassModule.tsx | Medium |
| 7 | Integration test + cleanup | All files | Low |

**Critical path:** Task 2 (algorithm) is the most complex and should be built + tested first. Tasks 3-6 are sequential but straightforward.

**@Skills to reference during implementation:**
- `@ui-styling` — for any Tailwind styling decisions
- `@firebase-auth` — if saving pass configs to Firestore later
- `@time-parsing` — if touching any time conversion logic
- `@gotchas` — pre-flight check before modifying schedule-adjacent logic
