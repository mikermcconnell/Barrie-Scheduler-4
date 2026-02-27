# City-Anchored Geocoding Design

**Date:** 2026-02-27
**Status:** Approved
**File:** `utils/od-matrix/odMatrixGeocoder.ts`

## Problem

Stations in "City - Place" format (e.g., "Orillia - Rec Centre") can geocode to the wrong city. The scoring system treats the city token as a ±6 bonus, not a hard constraint. A high-scoring result in the wrong city (e.g., Kitchener) can beat a lower-scoring result in the correct city (Orillia).

## Solution

Use the city prefix extracted from station names as an anchor point. After normal geocoding, verify the result's `display_name` contains the expected city token. On mismatch, retry with city-constrained queries before falling back to manual review.

## Flow

```
1. Extract city token via existing splitCityPlace()
2. Geocode normally (current behavior)
3. City Gate Check: does the best result's display_name contain the city token?
   +-- YES -> accept (same as today)
   +-- NO -> retry with city-constrained queries:
           - "{place}, {city}, Ontario, Canada"
           - "{place} {city}, Ontario, Canada"
           - "{city} {place}, Ontario, Canada"
           Then re-check city gate on retry results
           +-- Match found -> accept
           +-- Still no match -> flag as failed -> manual review
```

## Changes

| Component | Change |
|-----------|--------|
| `geocodeStation()` | After picking best result, add city gate check. On failure, run retry queries with city constraint |
| New: `passesCityGate()` | Checks if `display_name` contains the expected city token |
| Everything else | Unchanged |

## Scope

- One file modified: `odMatrixGeocoder.ts`
- One new function (~15 lines)
- ~20 lines added to `geocodeStation()`
- No type changes, no UI changes, no new dependencies

## What doesn't change

- Bare station names (no city prefix)
- Alias-matched stations (aliases already include city context)
- Manual overrides
- Ontario bounds check (still runs as final safety net)
- Scoring algorithm

## Edge cases

- **City name is a common word** (e.g., "Marathon"): gate checks against Nominatim's full `display_name` address, so "Marathon, Ontario" matches correctly
- **City name in wrong context** (e.g., "Orillia Road" in Toronto): existing scoring penalizes non-city matches; gate confirms city presence in address
- **Known aliases**: alias table checked first, so explicitly mapped stations skip city gate
