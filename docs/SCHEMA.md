# Data Schema Reference

> Firestore collections, TypeScript types, and storage patterns for Barrie Transit Scheduler.

---

## Firestore Structure

```
firebase/
├── users/{userId}/
│   ├── draftSchedules/{draftId}          # Working schedule copies
│   ├── newScheduleProjects/{projectId}   # Wizard project state
│   └── files/{fileId}                    # Uploaded file metadata
│
├── teams/{teamId}/
│   ├── members/{userId}                  # Team membership
│   ├── masterSchedules/{routeIdentity}/  # Published schedules
│   │   ├── versions/{versionId}          # Version history
│   │   └── connectionConfig/default      # Route connection settings
│   └── connectionLibrary/default         # Shared connection targets
│
└── migrations/                           # Data migration tracking
```

### Cloud Storage Paths

```
storage/
├── users/{userId}/
│   ├── draftSchedules/{draftId}_{timestamp}.json
│   ├── newScheduleProjects/{projectId}_{timestamp}.json
│   └── files/{timestamp}_{safeName}
│
└── teams/{teamId}/
    └── masterSchedules/{routeIdentity}/{versionId}_{timestamp}.json
```

---

## Core Types

### RouteIdentity

String format: `{routeNumber}-{dayType}` (e.g., "400-Weekday", "12A-Saturday")

```typescript
type DayType = 'Weekday' | 'Saturday' | 'Sunday';
type RouteIdentity = `${string}-${DayType}`;
```

### Direction

```typescript
type Direction = 'North' | 'South';
```

---

## Team & Membership

### Team (`teams/{teamId}`)

```typescript
interface Team {
  id: string;
  name: string;
  createdAt: Timestamp;
  createdBy: string;        // userId
  inviteCode: string;       // For joining
}
```

### TeamMember (`teams/{teamId}/members/{userId}`)

```typescript
type TeamRole = 'owner' | 'admin' | 'member';

interface TeamMember {
  id: string;
  userId: string;
  role: TeamRole;
  joinedAt: Timestamp;
  displayName: string;
  email: string;
}
```

---

## Draft Schedules

### DraftSchedule (`users/{userId}/draftSchedules/{draftId}`)

```typescript
type DraftStatus = 'draft' | 'ready_for_review';
type UploadSource = 'wizard' | 'tweaker' | 'draft';

interface DraftBasedOn {
  type: 'master' | 'gtfs' | 'generated' | 'legacy';
  id?: string;
  importedAt?: Timestamp;
}

interface DraftSchedule {
  id: string;
  name: string;
  routeNumber: string;
  dayType: DayType;
  status: DraftStatus;

  // Content stored in Cloud Storage
  storagePath?: string;
  content?: MasterScheduleContent;  // Loaded on demand

  // Provenance
  basedOn?: DraftBasedOn;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}
```

---

## Master Schedules (Published)

### MasterScheduleEntry (`teams/{teamId}/masterSchedules/{routeIdentity}`)

```typescript
interface MasterScheduleEntry {
  id: string;                    // RouteIdentity: "400-Weekday"
  routeNumber: string;
  dayType: DayType;

  // Version tracking
  currentVersion: number;
  storagePath: string;           // Cloud Storage path to JSON

  // Stats
  tripCount: number;
  northStopCount: number;
  southStopCount: number;

  // Audit
  updatedAt: Timestamp;
  updatedBy: string;
  uploaderName: string;
  source: UploadSource;

  // Publishing metadata
  publishedAt?: Timestamp;
  publishedBy?: string;
  publishedFromDraft?: string;   // Draft ID if published from draft

  // Operational
  effectiveDate?: string;
  notes?: string;
}
```

### MasterScheduleVersion (`teams/{teamId}/masterSchedules/{routeIdentity}/versions/{versionId}`)

```typescript
interface MasterScheduleVersion {
  id: string;                    // Version number as string
  versionNumber: number;
  storagePath: string;
  createdAt: Timestamp;
  createdBy: string;
  uploaderName: string;
  source: UploadSource;
  tripCount: number;
}
```

### MasterScheduleContent (Cloud Storage JSON)

```typescript
interface MasterScheduleContent {
  northTable: MasterRouteTable;
  southTable: MasterRouteTable;
  metadata: {
    routeNumber: string;
    dayType: DayType;
    uploadedAt: string;
    effectiveDate?: string;
    notes?: string;
  };
}
```

---

## Schedule Data Structures

### MasterRouteTable

Complete route schedule for one direction.

```typescript
interface MasterRouteTable {
  routeName: string;
  stops: string[];                    // Ordered stop names
  stopIds: Record<string, string>;    // stopName → stopId
  trips: MasterTrip[];
}
```

### MasterTrip

Individual transit trip with timing and block info.

```typescript
interface MasterTrip {
  id: string;
  blockId: string;
  direction: Direction;
  tripNumber: number;
  rowId?: string;

  // Timing (minutes from midnight)
  startTime: number;
  endTime: number;
  travelTime: number;
  recoveryTime: number;
  cycleTime: number;

  // Stop times
  stops: string[];
  arrivalTimes: Record<string, number>;    // stopName → minutes
  recoveryTimes: Record<string, number>;   // stopName → recovery minutes

  // Block position
  startStopIndex: number;
  endStopIndex: number;
  isBlockStart: boolean;
  isBlockEnd: boolean;

  // Connections
  externalConnections?: ExternalConnection[];

  // Analysis
  assignedBand?: string;
}
```

### RoundTripTable

Full route with paired north/south trips (for display).

```typescript
interface RoundTripTable {
  routeName: string;
  northStops: string[];
  southStops: string[];
  northStopIds: Record<string, string>;
  southStopIds: Record<string, string>;
  rows: RoundTripRow[];
}

interface RoundTripRow {
  blockId: string;
  trips: MasterTrip[];           // Paired N→S trips
  northStops: string[];
  southStops: string[];
  totalTravelTime: number;
  totalRecoveryTime: number;
  totalCycleTime: number;
  pairIndex: number;
}
```

---

## Block Assignment

### Block

Chain of trips operated by one bus.

```typescript
interface Block {
  blockId: string;
  trips: BlockedTrip[];
  startTime: number;
  endTime: number;
  totalTravelTime: number;
  totalRecoveryTime: number;
}

interface BlockedTrip extends ParsedTrip {
  blockId: string;
  tripNumber: number;
  direction: Direction;
  firstStopName: string;
  lastStopName: string;
  routeName: string;
}
```

### BlockAssignmentResult

```typescript
interface BlockAssignmentResult {
  blocks: Block[];
  unassignedTrips: ParsedTrip[];
  stats: {
    totalTrips: number;
    assignedTrips: number;
    blockCount: number;
    avgTripsPerBlock: number;
  };
}
```

---

## Connections

### ConnectionTarget (`teams/{teamId}/connectionLibrary/default.targets[]`)

GO Train, college bell, or route-to-route target.

```typescript
type ConnectionType = 'meet_departing' | 'feed_arriving';
type ConnectionTargetType = 'manual' | 'route';

interface ConnectionTarget {
  id: string;
  name: string;
  type: ConnectionTargetType;

  // For manual targets (GO Train, college bells)
  location?: string;
  times: ConnectionTime[];

  // For route-based targets
  routeIdentity?: RouteIdentity;
  stopName?: string;
  direction?: Direction;

  // Display
  color?: string;
  icon?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface ConnectionTime {
  id: string;
  time: number;              // Minutes from midnight
  label?: string;
  daysActive: DayType[];
  enabled: boolean;
}
```

### RouteConnectionConfig (`teams/{teamId}/masterSchedules/{routeIdentity}/connectionConfig/default`)

```typescript
type OptimizationMode = 'shift' | 'individual' | 'hybrid';

interface RouteConnectionConfig {
  routeIdentity: RouteIdentity;
  connections: RouteConnection[];
  lastOptimized?: Timestamp;
  optimizationMode?: OptimizationMode;
}

interface RouteConnection {
  id: string;
  targetId: string;
  connectionType: ConnectionType;
  bufferMinutes: number;
  stopName: string;
  priority: number;
  enabled: boolean;
  timeFilterStart?: number;
  timeFilterEnd?: number;
}
```

### ExternalConnection (on MasterTrip)

```typescript
interface ExternalConnection {
  targetId: string;
  targetName: string;
  connectionType: ConnectionType;
  targetTime: number;
  tripArrivalTime: number;
  gapMinutes: number;
  meetsConnection: boolean;
  stopName: string;
}
```

---

## GTFS Import

### GTFSRouteOption

User-selectable route during import.

```typescript
interface GTFSRouteOption {
  routeId: string;
  routeShortName: string;
  routeLongName: string;
  dayType: DayType;
  serviceId: string;
  tripCount: number;
  direction?: Direction;
  color?: string;

  // For merged A/B routes
  isMergedRoute?: boolean;
  northRouteId?: string;
  southRouteId?: string;
  displayName?: string;
}
```

### ProcessedGTFSTrip

```typescript
interface ProcessedGTFSTrip {
  tripId: string;
  routeId: string;
  serviceId: string;
  blockId: string;
  direction: Direction;
  headsign: string;
  stopTimes: GTFSStopTimeWithDetails[];
  startTime: number;
  endTime: number;
  travelTime: number;
}
```

### GTFSImportConfig (`teams/{teamId}`)

```typescript
interface GTFSImportConfig {
  feedUrl: string;
  lastFetched?: Timestamp;
  cachedRoutes?: GTFSRouteOption[];
  directionMapping?: Record<string, Direction>;
}
```

---

## New Schedule Projects

### NewScheduleProject (`users/{userId}/newScheduleProjects/{projectId}`)

Wizard state for creating schedules from runtime data.

```typescript
interface NewScheduleProject {
  id: string;
  name: string;
  dayType: DayType;
  routeNumber?: string;

  // Analysis results (Step 2)
  analysis?: RuntimeAnalysis;
  bands?: TimeBand[];

  // User configuration (Step 3)
  config?: ScheduleConfig;

  // Generated output (Step 4)
  generatedSchedules?: MasterScheduleContent;
  parsedData?: RuntimeData;      // Raw data for regeneration

  isGenerated: boolean;
  storagePath?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### TimeBand

```typescript
interface TimeBand {
  id: string;           // A, B, C, D, E
  label: string;
  min: number;
  max: number;
  avg: number;
  color: string;
  count: number;
}
```

---

## Route Configuration

### CycleRouteConfig

Unified route model (linear or loop).

```typescript
interface RouteSegment {
  name: 'North' | 'South' | 'Clockwise' | 'Counter-clockwise';
  variant?: string;      // e.g., "12A", "400"
  terminus?: string;
}

interface CycleRouteConfig {
  segments: RouteSegment[];        // 1 for loop, 2 for bidirectional
  suffixIsDirection?: boolean;     // A/B = direction vs variant
}

// Master config
const ROUTE_DIRECTIONS: Record<string, CycleRouteConfig>;
```

---

## Platform Analysis

### HubConfig

```typescript
interface PlatformAssignment {
  platformId: string;
  routes: string[];
  capacity?: number;
}

interface HubConfig {
  name: string;
  stopCodes: string[];
  stopNamePatterns: string[];
  platforms: PlatformAssignment[];
}

// Preconfigured hubs
const HUBS: Record<string, HubConfig>;
// Park Place, Barrie South GO, Allandale, Downtown, Georgian College
```

### PlatformAnalysis

```typescript
interface DwellEvent {
  tripId: string;
  route: string;
  direction: Direction;
  arrivalMin: number;
  departureMin: number;
  blockId: string;
  stopName: string;
}

interface ConflictWindow {
  startMin: number;
  endMin: number;
  busCount: number;
  events: DwellEvent[];
}

interface PlatformAnalysis {
  platformId: string;
  routes: string[];
  capacity: number;
  events: DwellEvent[];
  peakCount: number;
  peakWindows: ConflictWindow[];
  totalVisits: number;
  hasConflict: boolean;
  conflictWindows: ConflictWindow[];
}
```

---

## Key Patterns

### 1. Large Data in Cloud Storage

Firestore documents store metadata; actual schedule content lives in Cloud Storage as JSON:

```typescript
// Firestore: metadata only
{ id: "400-Weekday", tripCount: 42, storagePath: "teams/abc/..." }

// Cloud Storage: full content
{ northTable: {...}, southTable: {...}, metadata: {...} }
```

### 2. Excel Time Values

Excel stores times as fractions of 24 hours. Values >= 1.0 are post-midnight:

```typescript
// Same day (before midnight)
0.25    → 6:00 AM
0.75    → 6:00 PM

// Next day (after midnight)
1.02083 → 12:30 AM (next day)
1.25    → 6:00 AM (next day)
```

### 3. Block Chaining

Trips link by matching terminus times:

```typescript
// Trip N ends at Downtown 6:32 AM
// Trip N+1 starts at Downtown 6:40 AM
// Gap = 8 minutes = recovery time
// These trips chain into same block
```

### 4. Merged A/B Routes

Routes like 2A+2B share a downtown terminus:

```typescript
// 2A: Park Place → Downtown (North)
// 2B: Downtown → Park Place (South)
// Shared terminus: Downtown
// Recovery calculated at BOTH terminuses
```

---

## Type Locations

| Type | File |
|------|------|
| Team, TeamMember, MasterScheduleEntry | `utils/masterScheduleTypes.ts` |
| DraftSchedule, PublishedSchedule | `utils/scheduleTypes.ts` |
| MasterTrip, RoundTripTable | `utils/masterScheduleParser.ts` |
| Block, BlockedTrip | `utils/blockAssignment.ts` |
| ConnectionTarget, RouteConnection | `utils/connectionTypes.ts` |
| GTFS* types | `utils/gtfsTypes.ts` |
| CycleRouteConfig | `utils/routeDirectionConfig.ts` |
| TimeBand, RuntimeData | `utils/runtimeAnalysis.ts` |
| HubConfig, PlatformAnalysis | `utils/platformConfig.ts`, `utils/platformAnalysis.ts` |
