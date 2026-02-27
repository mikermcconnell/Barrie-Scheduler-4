# City-Anchored Geocoding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent geocoding mismatches for "City - Place" format stations by using the city prefix as a hard gate on results, with automatic retry on mismatch.

**Architecture:** Add a `passesCityGate()` check after normal geocoding in `geocodeStation()`. When a "City - Place" station's best result doesn't contain the city token in its `display_name`, retry with city-constrained queries. If retry also fails, fall through to manual review (existing failed-station path).

**Tech Stack:** TypeScript, Vitest (unit tests), OpenStreetMap Nominatim API

**Design doc:** `docs/plans/2026-02-27-city-anchored-geocoding-design.md`

---

### Task 1: Add `passesCityGate` function + unit tests

**Files:**
- Modify: `utils/od-matrix/odMatrixGeocoder.ts` (add new exported function after line 218)
- Create: `tests/odMatrixGeocoderCityGate.test.ts`

**Step 1: Write the failing tests**

Create `tests/odMatrixGeocoderCityGate.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { passesCityGate } from '../utils/od-matrix/odMatrixGeocoder';

describe('passesCityGate', () => {
    it('passes when display_name contains the city token', () => {
        expect(passesCityGate(
            'Orillia Recreation Centre, Orillia, Simcoe County, Ontario, Canada',
            'Orillia',
        )).toBe(true);
    });

    it('fails when display_name does not contain the city token', () => {
        expect(passesCityGate(
            'Recreation Centre, Kitchener, Waterloo Region, Ontario, Canada',
            'Orillia',
        )).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(passesCityGate(
            'orillia recreation centre, orillia, ontario, canada',
            'Orillia',
        )).toBe(true);
    });

    it('matches multi-word city names', () => {
        expect(passesCityGate(
            'Hospital, Sault Ste. Marie, Ontario, Canada',
            'Sault Ste Marie',
        )).toBe(true);
    });

    it('returns true when city is null (no city prefix in station name)', () => {
        expect(passesCityGate(
            'Barrie, Ontario, Canada',
            null,
        )).toBe(true);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/odMatrixGeocoderCityGate.test.ts`
Expected: FAIL — `passesCityGate` is not exported from the module

**Step 3: Implement `passesCityGate`**

In `utils/od-matrix/odMatrixGeocoder.ts`, add after the `splitCityPlace` function (after line 218):

```typescript
export function passesCityGate(displayName: string, city: string | null): boolean {
    if (!city) return true;
    const normalizedDisplay = displayName.toLowerCase();
    // Normalize punctuation so "Sault Ste. Marie" matches "Sault Ste Marie"
    const normalizedCity = city.toLowerCase().replace(/[.]/g, '');
    const normalizedDisplayClean = normalizedDisplay.replace(/[.]/g, '');
    return normalizedDisplayClean.includes(normalizedCity);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/odMatrixGeocoderCityGate.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add tests/odMatrixGeocoderCityGate.test.ts utils/od-matrix/odMatrixGeocoder.ts
git commit -m "feat: add passesCityGate function for geocoding city validation"
```

---

### Task 2: Add `buildCityConstrainedQueries` function + unit tests

**Files:**
- Modify: `utils/od-matrix/odMatrixGeocoder.ts` (add new exported function after `passesCityGate`)
- Modify: `tests/odMatrixGeocoderCityGate.test.ts` (add new describe block)

**Step 1: Write the failing tests**

Add to `tests/odMatrixGeocoderCityGate.test.ts`:

```typescript
import { passesCityGate, buildCityConstrainedQueries } from '../utils/od-matrix/odMatrixGeocoder';

describe('buildCityConstrainedQueries', () => {
    it('builds city-constrained queries for a city + place station', () => {
        const queries = buildCityConstrainedQueries('Orillia', 'Rec Centre');
        expect(queries).toContain('Rec Centre, Orillia, Ontario, Canada');
        expect(queries).toContain('Rec Centre Orillia, Ontario, Canada');
        expect(queries).toContain('Orillia Rec Centre, Ontario, Canada');
    });

    it('returns empty array when city is null', () => {
        expect(buildCityConstrainedQueries(null, 'Union Station')).toEqual([]);
    });

    it('dedupes queries', () => {
        const queries = buildCityConstrainedQueries('Barrie', 'Barrie');
        const unique = new Set(queries.map(q => q.toLowerCase()));
        expect(unique.size).toBe(queries.length);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/odMatrixGeocoderCityGate.test.ts`
Expected: FAIL — `buildCityConstrainedQueries` is not exported

**Step 3: Implement `buildCityConstrainedQueries`**

In `utils/od-matrix/odMatrixGeocoder.ts`, add after `passesCityGate`:

```typescript
export function buildCityConstrainedQueries(city: string | null, place: string): string[] {
    if (!city) return [];
    const queries = [
        `${place}, ${city}, Ontario, Canada`,
        `${place} ${city}, Ontario, Canada`,
        `${city} ${place}, Ontario, Canada`,
    ];
    return dedupeQueries(queries);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/odMatrixGeocoderCityGate.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add tests/odMatrixGeocoderCityGate.test.ts utils/od-matrix/odMatrixGeocoder.ts
git commit -m "feat: add buildCityConstrainedQueries for geocoding retry"
```

---

### Task 3: Wire city gate into `geocodeStation()` + integration test

**Files:**
- Modify: `utils/od-matrix/odMatrixGeocoder.ts:321-362` (modify `geocodeStation`)
- Modify: `tests/odMatrixGeocoderCityGate.test.ts` (add integration test)

**Step 1: Write the failing integration test**

Add to `tests/odMatrixGeocoderCityGate.test.ts`:

```typescript
import { passesCityGate, buildCityConstrainedQueries, geocodeStations } from '../utils/od-matrix/odMatrixGeocoder';
import type { ODStation } from '../utils/od-matrix/odMatrixTypes';

describe('geocodeStation city gate integration', () => {
    it('rejects a result in the wrong city and retries with city constraint', async () => {
        // Mock fetch: first call returns Kitchener result, retry returns Orillia result
        let callCount = 0;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            callCount++;
            const urlStr = typeof url === 'string' ? url : url.toString();

            // First batch of queries (normal) — return a Kitchener result
            if (!urlStr.includes('Ontario')) {
                return new Response(JSON.stringify([{
                    lat: '43.4516',
                    lon: '-80.4925',
                    display_name: 'Recreation Centre, Kitchener, Waterloo Region, Ontario, Canada',
                    importance: 0.5,
                }]));
            }

            // City-constrained retry queries — return Orillia result
            return new Response(JSON.stringify([{
                lat: '44.6083',
                lon: '-79.4197',
                display_name: 'Recreation Centre, Orillia, Simcoe County, Ontario, Canada',
                importance: 0.4,
            }]));
        });

        const stations: ODStation[] = [
            { name: 'Orillia - Rec Centre', totalOrigin: 5, totalDestination: 3, totalVolume: 8 },
        ];

        const result = await geocodeStations(stations, null);

        // Should have geocoded successfully (not failed) — the retry found the right city
        expect(result.failed).not.toContain('Orillia - Rec Centre');
        expect(result.geocoded).toBe(1);

        const loc = result.cache.stations['Orillia - Rec Centre'];
        expect(loc).toBeDefined();
        // Result should be near Orillia (lat ~44.6), not Kitchener (lat ~43.4)
        expect(loc.lat).toBeGreaterThan(44);

        fetchSpy.mockRestore();
    });

    it('flags as failed when both normal and retry queries return wrong city', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify([{
                lat: '43.4516',
                lon: '-80.4925',
                display_name: 'Recreation Centre, Kitchener, Waterloo Region, Ontario, Canada',
                importance: 0.5,
            }]));
        });

        const stations: ODStation[] = [
            { name: 'Orillia - Rec Centre', totalOrigin: 5, totalDestination: 3, totalVolume: 8 },
        ];

        const result = await geocodeStations(stations, null);

        // Should be in the failed list
        expect(result.failed).toContain('Orillia - Rec Centre');
        expect(result.geocoded).toBe(0);

        vi.restoreAllMocks();
    });

    it('skips city gate for stations without city prefix', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify([{
                lat: '44.3891',
                lon: '-79.6903',
                display_name: 'Barrie, Simcoe County, Ontario, Canada',
                importance: 0.7,
            }]));
        });

        const stations: ODStation[] = [
            { name: 'Barrie', totalOrigin: 10, totalDestination: 10, totalVolume: 20 },
        ];

        const result = await geocodeStations(stations, null);

        // Should geocode normally — no city prefix means no city gate
        expect(result.geocoded).toBe(1);
        expect(result.failed).toHaveLength(0);

        vi.restoreAllMocks();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/odMatrixGeocoderCityGate.test.ts`
Expected: FAIL — the integration test for wrong-city rejection should fail because `geocodeStation` doesn't check the city gate yet

**Step 3: Modify `geocodeStation` to add city gate + retry**

Replace `geocodeStation` in `utils/od-matrix/odMatrixGeocoder.ts` (lines 321-362) with:

```typescript
async function geocodeStation(name: string): Promise<GeocodedLocation | null> {
    const queries = buildSearchQueries(name);
    const context = buildScoringContext(name);
    const { city, place } = splitCityPlace(expandAbbreviations(sanitizeStationName(name)));
    let best: { candidate: NominatimCandidate; score: number } | null = null;

    for (const q of queries) {
        try {
            const results = await fetchCandidates(q);
            for (const result of results) {
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                if (!isWithinCanada(lat, lon)) continue;

                const score = scoreCandidate(result, context, q);
                if (!best || score > best.score) {
                    best = { candidate: result, score };
                }
            }

            if (best && best.score >= HIGH_CONFIDENCE_SCORE) {
                break;
            }
        } catch {
            // Try next query variant
        }
    }

    // City gate check: if station has "City - Place" format, verify best result is in the right city
    if (best && best.score >= MIN_ACCEPT_SCORE && city && !passesCityGate(best.candidate.display_name, city)) {
        // Retry with city-constrained queries
        const retryQueries = buildCityConstrainedQueries(city, place);
        let retryBest: { candidate: NominatimCandidate; score: number } | null = null;

        for (const q of retryQueries) {
            try {
                const results = await fetchCandidates(q);
                for (const result of results) {
                    const lat = parseFloat(result.lat);
                    const lon = parseFloat(result.lon);
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                    if (!isWithinCanada(lat, lon)) continue;
                    if (!passesCityGate(result.display_name, city)) continue;

                    const score = scoreCandidate(result, context, q);
                    if (!retryBest || score > retryBest.score) {
                        retryBest = { candidate: result, score };
                    }
                }
            } catch {
                // Try next retry query
            }
        }

        if (retryBest && retryBest.score >= MIN_ACCEPT_SCORE) {
            best = retryBest;
        } else {
            // Both normal and retry failed city gate — reject
            return null;
        }
    }

    if (best && best.score >= MIN_ACCEPT_SCORE) {
        const lat = parseFloat(best.candidate.lat);
        const lon = parseFloat(best.candidate.lon);
        return {
            lat,
            lon,
            displayName: best.candidate.display_name,
            source: 'auto',
            confidence: best.score >= HIGH_CONFIDENCE_SCORE ? 'high' : 'medium',
        };
    }

    return null;
}
```

**Step 4: Run ALL geocoder tests to verify**

Run: `npx vitest run tests/odMatrixGeocoderCityGate.test.ts tests/odMatrixGeocoderCache.test.ts`
Expected: ALL PASS

**Step 5: Run build**

Run: `npm run build`
Expected: PASS — no type errors

**Step 6: Commit**

```bash
git add utils/od-matrix/odMatrixGeocoder.ts tests/odMatrixGeocoderCityGate.test.ts
git commit -m "feat: wire city gate into geocodeStation with retry-then-fail flow"
```

---

### Task 4: Verify existing tests still pass + final build check

**Files:** None modified — verification only

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS — no regressions

**Step 2: Run production build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit design doc**

```bash
git add docs/plans/2026-02-27-city-anchored-geocoding-design.md docs/plans/2026-02-27-city-anchored-geocoding-plan.md
git commit -m "docs: add city-anchored geocoding design and implementation plan"
```
