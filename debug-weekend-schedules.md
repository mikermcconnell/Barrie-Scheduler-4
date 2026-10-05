# Weekend Regional Connections Debug

## Root Cause
Regional Transit Connections are not showing local service on Saturday/Sunday because those master schedules are not published to Firestore.

## How Regional Connections Work

1. `RegionalTransitConnections` component receives a `schedules` prop (line 104)
2. `schedules` comes from `getAllMasterSchedules(teamId)` in MasterScheduleBrowser (line 260)
3. `getAllMasterSchedules()` queries Firestore: `collection(db, 'teams', teamId, 'masterSchedules')` (line 386)
4. The component filters schedules by dayType: `schedules.filter(entry => entry.dayType === dayType)` (line 141)
5. If no Saturday/Sunday schedules exist in Firestore, the filtered array is empty
6. Empty schedules → no local connection rows → "No published {dayType} master schedules are available" message

## Diagnosis Steps

### Option 1: Check in the UI
1. Open Master Schedule Browser
2. Check the "Overview" or "Platforms" tab
3. Look for route tabs - do you see Saturday and Sunday versions?
4. If routes show "Weekday" only, the weekend schedules aren't published

### Option 2: Check Firebase Console
1. Go to Firebase Console → Firestore Database
2. Navigate to: `teams/{your-team-id}/masterSchedules`
3. Look at document IDs - they should include:
   - `{routeNumber}-Weekday` (e.g., "8A-Weekday")
   - `{routeNumber}-Saturday` (e.g., "8A-Saturday")  
   - `{routeNumber}-Sunday` (e.g., "8A-Sunday")
4. If Saturday/Sunday documents are missing, those schedules aren't published

## Solution

You need to **publish Saturday and Sunday master schedules** for each route:

### If you have the Excel source files:
1. Go to Master Schedule Browser
2. Click "Upload" or use the import workflow
3. Import the Saturday Excel file for each route
4. Import the Sunday Excel file for each route
5. Each import creates a published master schedule entry

### If schedules are in draft form:
1. Check if there's a draft/publish workflow
2. Publish the Saturday and Sunday drafts for each route

### If you need to generate them:
1. Use Schedule Generator to create Saturday schedules
2. Use Schedule Generator to create Sunday schedules
3. Publish both

## Verification

After publishing Saturday/Sunday schedules:

1. Refresh the Regional Transit Connections view
2. Click "Saturday" or "Sunday" button
3. Local service connections should now appear in the grid

## Code Flow Reference

```typescript
// MasterScheduleBrowser.tsx line 260
const localSchedules = await getAllMasterSchedules(team.id);
setSchedules(localSchedules);

// RegionalTransitConnections.tsx line 141
const relevantSchedules = useMemo(() => 
  schedules.filter(entry => entry.dayType === dayType), 
  [schedules, dayType]
);

// connectionAnalysis.ts line 308
export function buildLocalConnectionRows(sources, station, date, dayType) {
  if (dayType === 'No Service') return [];
  return sources
    .filter(source => source.entry.dayType === dayType)  // ← This filters to matching day
    .flatMap(source => rowsForSource(source, station, date))
    .sort(...);
}
```

If `relevantSchedules` is empty for Saturday/Sunday, `buildLocalConnectionRows` returns an empty array, resulting in no connections displayed.
