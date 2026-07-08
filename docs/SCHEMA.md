# Data Schema Reference

> Firestore collections, TypeScript types, and storage patterns for Barrie Transit Scheduler.

---

## Firestore Structure

```
firebase/
├── users/{userId}/
│   ├── draftSchedules/{draftId}          # Working schedule copies
│   ├── newScheduleProjects/{projectId}   # Wizard project state
│   └── files/{fileId}                    # Uploaded file metadata; owner-write, global-admin read for support
│
├── teams/{teamId}/
│   ├── members/{userId}                  # Team membership
│   ├── platformConfig/default            # Team-specific platform / hub configuration
│   ├── masterSchedules/{routeIdentity}/  # Published schedules
│   │   ├── versions/{versionId}          # Version history
│   ├── connectionLibrary/default         # Shared connection targets used by app services
│   ├── publicTimetable/default           # Team-managed brochure content defaults
│   ├── routeConnectionConfigs/{routeIdentity} # Per-route connection settings
│   ├── transitAppData/{docId}            # Transit App analytics datasets
│   ├── performanceData/{docId}           # STREETS / ops performance datasets
│   ├── todPickupData/{docId}             # Monthly Transit On Demand pickup map datasets
│   ├── performanceSnapshots/{month}      # Monthly performance rollups (YYYY-MM)
│   ├── performanceImports/{importId}     # Archived raw STREETS import runs for replay/rebuild
│   ├── parking/default                   # Shared parking-code settings + active storage pointer
│   │   └── months/{month}                # Monthly parking usage/revenue import metadata
│   ├── odMatrixData/{docId}              # Origin-destination datasets
│   │   └── imports/{importId}            # OD import history
│   ├── residentialGrowth/{docId}         # Monthly issued/occupied residential growth datasets
│   │   └── imports/{importId}            # Residential Growth import history
│   ├── routePlanner2Projects/{projectId} # Route Planner 2 saved planning projects
│   │   └── scenarios/{scenarioId}        # Saved editable route concepts
│   └── fleetPlan/default                 # Shared fleet-planning workbook metadata + active storage pointer
│       └── versions/{versionId}          # Fleet Plan version history
│
├── teamInvites/{inviteCode}              # Invite lookup -> teamId + teamName + default join access
│
└── migrations/                           # Data migration tracking
```

`teams/{teamId}/connectionLibrary/default` and `teams/{teamId}/routeConnectionConfigs/{routeIdentity}` are used by the application and documented here because code reads and writes those paths directly.
`teams/{teamId}/publicTimetable/default` stores the team-managed brochure copy used by the Public Timetable generator preview/export.
`teams/{teamId}/routePlanner2Projects/{projectId}` stores Route Planner 2 project metadata, with editable route concepts saved under its `scenarios/{scenarioId}` subcollection.
`teams/{teamId}/fleetPlan/default` stores the active shared Fleet Plan metadata and the Storage path for the current normalized workbook JSON payload. Its `versions/{versionId}` subcollection stores immutable version metadata for rollback/audit workflows.

### Cloud Storage Paths

```
storage/
├── users/{userId}/
│   ├── draftSchedules/{draftId}_{timestamp}.json
│   ├── newScheduleProjects/{projectId}_{timestamp}.json
│   └── files/{timestamp}_{safeName}
│
└── teams/{teamId}/
    ├── masterSchedules/{routeIdentity}/{versionId}_{timestamp}.json
    ├── routeMaps/{safeName}
    ├── transitAppData/{allPaths}
    ├── performanceData/{allPaths}
    ├── todPickupData/{timestamp}.json
    ├── performanceData/{timestamp}-overview.json
    ├── performanceData/{timestamp}-report.json
    ├── performanceData/months/{timestamp}-{YYYY-MM}.json
    ├── performanceData/months/{timestamp}-route-{routeId}-{YYYY-MM}.json
    ├── performanceImports/raw/{timestamp}.csv
    ├── parking/{month}_{timestamp}.json
    ├── odMatrixData/{allPaths}
    ├── residentialGrowth/{allPaths}
    └── fleetPlan/v{versionNumber}_{timestamp}.json
```

`teams/{teamId}/performanceData/metadata` may store multiple storage pointers for the same import:
- `storageMode`: `monthly` for current chunked performance history, or older `monolithic` data
- `monthlyStoragePaths`: month → full monthly performance summary JSON
- `routeMonthlyStoragePaths`: route → month → route-scoped monthly summary JSON
- `overviewStoragePath`: lightweight recent overview payload for dashboard first-load
- `reportStoragePath`: report-focused snapshot used by the daily email
- `storagePath`: legacy full performance summary pointer used by older imports only

Partner teams, such as WATT, can use read-only shared data sources instead of copied JSON. `teams/{teamId}.dataSourceTeamIds.transitApp` and `.performance` may point at a source team such as Barrie Transit. The app reads shared Transit App and STREETS data through the `sharedWorkspaceData` Cloud Function, which verifies the signed-in user belongs to the requesting team and that the requesting team is explicitly configured to read from the source team. Imports and writes still target the current team only.

Partner teams that are granted Scheduled Transit access can also read published master schedules from a configured source team. `teams/{teamId}.dataSourceTeamIds.masterSchedules` may point at the source team; when omitted, the Master Schedule Browser falls back to `dataSourceTeamIds.performance` for partner teams with no local schedules. Shared master-schedule access is read-only and still requires the requesting team member to have Fixed Route workspace access.

Daily performance summaries may include `byOperatorDwell.totalReportableDwellMinutes`, an optional moderate/high-only dwell total used by compact report snapshots when older incident arrays are trimmed.

`teams/{teamId}/todPickupData/metadata` stores the active Transit On Demand pickup-map import pointer. Full monthly TOD pickup datasets live in Storage as aggregated JSON at `teams/{teamId}/todPickupData/{timestamp}.json`. Uploading a CSV for a month replaces that month only; other months remain in the same stored summary. The stored payload is aggregated by stop ID when present, otherwise by pickup name plus rounded coordinates, or by coordinates alone. Raw request rows, rider-identifying fields, and address columns are not persisted. Imports are bounded to CSV files under 5 MB and 25,000 rows. TOD pickup map data and import metadata are readable by team members; writes are restricted to team owners/admins or workspace permission managers.

`teams/{teamId}/parking/default` stores the active Parking workspace settings and Storage pointers for Parking usage and Parking Revenue payloads. Code-family mappings connect annual HotSpot discount codes such as `RS2025`, `RS26`, and manual yearly overrides to a department, including the department color, short code, active years, preferred year format (`2026` or `26`), and optional `ignoreFlags` setting that suppresses plate-level indicators for that department. Parking settings also store the department color legend sort choice, spot-location labels, editable Parking Revenue lot categories, and reviewed Parking Revenue map locations with physical display name, latitude/longitude, optional space count, optional `categoryId`, and linked HotSpot/QR source IDs. Seeded lot categories are Downtown, Waterfront, Hybrid, Marina, and Hospital; default reviewed mappings classify Spirit Catcher, Simcoe Street, and Marina North as Hybrid, Marina Lot as Marina, and H-Block as Hospital. The app bundles City ParkingLatLong locations as default reviewed map locations; the Parking Lot Data workspace can refresh those settings from a newer City parking lat/lng workbook. Department-code usage imports store normalized summaries under `storagePath`; Parking Revenue imports store source-aware monthly datasets under `revenueStoragePath` in Storage at `teams/{teamId}/parking/revenue/`. Revenue imports replace only the matching source/month combination and preserve other revenue months/sources. Parking Revenue analytics can filter by year, month, source, uploader (`importedBy`), day type, hour range, and lot category. Estimated utilization is derived from paid parking minutes divided by known spaces × imported active days × selected hour window. Parking data contains license plates and is intended for Parking, admin, or internal workspace access; reads and writes are allowed for users with Parking workspace access so Parking staff can import workbooks and maintain thresholds/mappings.

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
  defaultMemberAccessLevel?: WorkspaceAccessLevel; // Access assigned to new invite joins.
  defaultMemberWorkspaceOverrides?: Partial<Record<string, boolean>>; // Optional default per-workspace allow/block overrides.
  dataSourceTeamIds?: {     // Optional read-only source teams for partner workspace data.
    transitApp?: string;    // Source team for Transit App Data.
    performance?: string;   // Source team for STREETS dashboard/reporting data.
    masterSchedules?: string; // Source team for read-only published master schedules.
  };
  partnerTeam?: boolean;    // True for externally onboarded agency teams.
}
```

### TeamMember (`teams/{teamId}/members/{userId}`)

```typescript
type TeamRole = 'owner' | 'admin' | 'member';
type WorkspaceAccessLevel = 'none' | 'production' | 'planner' | 'external-planner' | 'transit-app-only' | 'parking' | 'admin' | 'internal';

interface TeamMember {
  id: string;
  userId: string;
  role: TeamRole;
  accessLevel?: WorkspaceAccessLevel; // Controls visible workspaces; missing values fall back by role.
  workspaceOverrides?: Partial<Record<string, boolean>>; // Optional per-workspace allow/block overrides.
  joinedAt: Timestamp;
  displayName: string;
  email: string;
}
```

`role` controls team permissions and writes. Team owners and admins can manage team settings and members. `accessLevel` controls which app workspaces are visible. Use `none` for brand-new users or newly created teams that should see only Team Management until access is explicitly granted. Use `parking` for staff who should see only the Parking workspace by default. Use `external-planner` or `transit-app-only` for external agencies that should see only Transit App Data through the top-level Planning Data view. Existing members without `accessLevel` are treated as `internal` for owners/admins and `planner` for regular members.

`defaultMemberAccessLevel` and `defaultMemberWorkspaceOverrides` control the access assigned to future members who join with the team's invite code or invite link. The Developer Access Wizard in Team Management can set both the team default and individual member `workspaceOverrides`.

Partner agency onboarding uses invite links in the form `?invite=CODE` or `#/join/CODE`. A signed-out user is prompted to sign in; after authentication, the app joins them to the matching team automatically. Invite lookup documents denormalize `defaultMemberAccessLevel` and optional `defaultMemberWorkspaceOverrides` so new members can receive the correct external profile before they are allowed to read the team document.

Global admins can read user-uploaded file metadata and matching `users/{userId}/files/` Storage objects across users for developer support. They cannot write or delete another user's user-scoped file records through the normal client path.

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

### PlatformConfig (`teams/{teamId}/platformConfig/default`)

```typescript
interface PlatformConfigDocument {
  hubs: HubConfig[];
  updatedAt: Timestamp;
  updatedBy: string;       // userId
  version: number;
}
```

Platform config is read by team members and should only be written by team owners/admins.

### PublicTimetableConfig (`teams/{teamId}/publicTimetable/default`)

```typescript
interface PublicTimetableConfigDocument {
  disclaimer: string;
  fareEffectiveDate: string;
  fareRows: Array<{
    label: string;
    adult: string;
    student: string;
    children: string;
    senior: string;
    family: string;
  }>;
  fareNote: string;
  legendItems: string[];
  promoTitle: string;
  promoText: string;
  contacts: string[];
  mapImageScalePercent: number; // front brochure map image scale, 50-150
  mapImageOffsetXPercent: number; // front brochure map horizontal offset, -40 to 40
  mapImageOffsetYPercent: number; // front brochure map vertical offset, -40 to 40
  updatedAt: Timestamp;
  updatedBy: string;       // userId
  version: number;
}
```

Public timetable settings are readable by team members and should only be written by team owners/admins.

### RoutePlanner2Project (`teams/{teamId}/routePlanner2Projects/{projectId}`)

```typescript
interface RoutePlanner2ProjectMetadata {
  id: string;
  name: string;
  status: 'local-draft' | 'local-saved' | 'archived';
  selectedScenarioId: string;
  preferredScenarioId?: string;
  scenarioOrder: string[];
  scenarioCount: number;
  createdAt: string;              // ISO string
  updatedAt: string;              // ISO string, used for list ordering
  updatedBy: string;
  savedAt: Timestamp;
}
```

Each editable route concept is stored at `teams/{teamId}/routePlanner2Projects/{projectId}/scenarios/{scenarioId}` using the `RoutePlanner2Scenario` shape from `utils/route-planner-2/routePlanner2Types.ts`. GTFS-imported Barrie merged A/B routes may include optional `routeFamily` metadata so directions such as 2A and 2B display as one route family while remaining independently editable scenarios. Team members and workspace permission managers can read and write these saved route plans.

### FleetPlanMetadata (`teams/{teamId}/fleetPlan/default`)

```typescript
interface FleetPlanDocumentMetadata {
  currentVersion: number;
  totalRows: number;
  sheetCount: number;
  templateVersion: string;
  sourceFileName: string;
  importedAt: string;      // ISO timestamp
  importedBy: string;      // userId
  updatedAt: string;       // ISO timestamp
  updatedBy: string;       // userId
  storagePath: string;     // Cloud Storage JSON payload
}
```

The full editable workbook content is stored in Cloud Storage as normalized JSON rather than raw Excel bytes. The active pointer lives at `teams/{teamId}/fleetPlan/default`; each save increments `currentVersion`, writes `fleetPlan/default/versions/{versionNumber}`, and preserves that version's JSON object in Storage. Team members can read the shared Fleet Plan; writes are restricted to team owners/admins. Saves use the loaded `currentVersion` for conflict detection so users do not silently overwrite newer edits. Stored JSON still preserves source sheet keys for compatibility with the imported template, while the user-facing grid and Excel export are combined into one Fleet Plan sheet with a Bus Type column.

### ResidentialGrowthMetadata (`teams/{teamId}/residentialGrowth/default`)

```typescript
interface ResidentialGrowthMetadata {
  activeImportId: string;
  period: string;                 // YYYY-MM
  importedAt: Timestamp;
  importedBy: string;
  storagePath: string;            // teams/{teamId}/residentialGrowth/{importId}.json
  pdfStoragePath?: string;        // teams/{teamId}/residentialGrowth/{importId}.pdf
  issuedFileName?: string | null;
  occupiedFileName?: string | null;
  issuedRecords: number;
  issuedUnits: number;
  occupiedRecords: number;
  occupiedUnits: number;
  issuedGeocoded: number;
  occupiedGeocoded: number;
  reviewCount: number;
}
```

The full monthly Residential Growth dataset is stored as JSON in Cloud Storage. Issuance Listing rows are treated as issued/planned units; Certificate of Occupancy rows are treated as occupied/completed units. Occupancy report rows count as one completed unit in v1 because the source report has no unit-count field.

Automation uses `ingestResidentialGrowthReport` with the same API-key pattern as STREETS ingest. Monthly files are accepted one at a time and held under `teams/{teamId}/residentialGrowth/pending/{period}/...` until both the issued and occupied reports are available; then the function writes the combined dataset and a PDF report.

Fleet Plan saves are validation-gated. Blocking issues include missing/duplicate unit numbers, invalid model years, missing lifecycle start markers, multiple retirement markers, and timeline activity or purchase/growth markers after retirement. Missing retirement markers are warnings only for buses already in service; future purchase/growth rows are allowed to plan future purchasing without a retirement year. The Fleet Plan resolver suggests setting missing retirement warnings to 13 years after the first in-service year. Non-standard timeline notes and unusual year ranges are also warnings.

---

## On-Demand Saved Schedules

### SavedSchedule (`users/{userId}/schedules/{scheduleId}`)

Transit On Demand workspace drafts are stored separately from fixed-route draft schedules.

```typescript
interface SavedSchedule {
  name: string;
  status: 'draft' | 'published' | 'archived';
  slotGranularityMinutes?: 5 | 15;
  shiftData: Shift[];
  masterScheduleData: Requirement[];
  schedulesData?: Record<string, Requirement[]>;
  optimizationSettings?: {
    maxFleetVehicles?: number;
    shiftCountCaps?: DayTypeShiftCountCaps;
    targetCoveragePercent?: number;
    breakDurationMinutes?: number;
    northChangeoffMinutes?: number;  // one-way garage travel, applied only at internal North shift handoffs
    southChangeoffMinutes?: number;  // one-way garage travel, applied only at internal South shift handoffs
    shiftCountCapMode?: 'hard' | 'guide';
    minorGapTolerance?: 'none' | 'rare';
    breakProtection?: 'strict' | 'balanced';
    costPriority?: 'service' | 'balanced' | 'efficiency';
  };
}
```

`slotGranularityMinutes` identifies the slot grid used by `shiftData`, `masterScheduleData`, and `schedulesData`. New TOD saves use 5-minute slots. Legacy records without this field are treated as 15-minute schedules when they have 96 daily requirement slots and are expanded to the active 5-minute grid on load.

`shiftData` entries may include optional `handoffFromShiftId` and `handoffToShiftId` fields so TOD drafts can persist explicit driver-to-driver handoff links alongside the core shift timing fields. These links are intended to be reciprocal same-day North/South service-shift references; invalid or one-way links are treated as handoff issues during validation.

RideCo/MVT import reports are review-time UI state, not saved schedule schema. Uploaded Master and RideCo files can be stored through the existing `users/{userId}/files/{fileId}` file-manager path; saved schedules persist only the normalized requirements, shifts, and optimization settings.

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

### RouteConnectionConfig (`teams/{teamId}/routeConnectionConfigs/{routeIdentity}`)

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
| DraftSchedule, PublishedSchedule, SystemDraft | `utils/schedule/scheduleTypes.ts` |
| MasterTrip, RoundTripTable | `utils/parsers/masterScheduleParser.ts` |
| Block, BlockedTrip | `utils/blocks/blockAssignment.ts` |
| ConnectionTarget, RouteConnection | `utils/connections/connectionTypes.ts` |
| GTFS* types | `utils/gtfs/gtfsTypes.ts` |
| CycleRouteConfig | `utils/config/routeDirectionConfig.ts` |
| TimeBand, RuntimeData | `utils/ai/runtimeAnalysis.ts` |
| HubConfig, PlatformAnalysis | `utils/platform/platformConfig.ts`, `utils/platform/platformAnalysis.ts` |
| Shift, Requirement, TOD day/zone types | `utils/demandTypes.ts` |
| RideCo/MVT parser result and import report types | `utils/parsers/csvParsers.ts` |
| Parking import, revenue import, settings, summaries, and flags | `utils/parking/parkingTypes.ts` |
