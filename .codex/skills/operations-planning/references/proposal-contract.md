# Operations planning proposal contract

The TypeScript definitions and validator under `utils/run-cutting/` are the
machine-readable authority. This reference describes the semantic contract for
Codex proposal generation.

## Identity and source binding

- `schemaVersion` must equal numeric `1` and `kind` must equal
  `operations-planning-proposal`.
- `scenarioId` must equal the input scenario ID.
- `sourceManifestFingerprint` must exactly equal the input fingerprint.
- Every route, day type, master version, trip ID, and block ID is copied from the
  input. A proposal cannot add service or rewrite source identities.

## Block audit

Copy every input `blockAudits` record unchanged. Put new Codex observations in
the proposal's top-level `findings` array. The audit `tripIds`, order, and
`membershipFingerprint` must remain identical to the input. Reblocking is
outside this feature.

## Daily runs

Each run has a stable ID, public planner-facing run number, service day type,
one or more pieces, and optional notes. Each piece contains only an ordered,
contiguous sequence of whole-trip references from one source vehicle block.

Despite its field name, `piece.blockId` must equal the source trip's
`vehicleBlockKey`; it is not the shorter display `blockId`. `routeNumber` must
match every trip in the piece. `startReliefPoint` must match the first trip's
start location, and `endReliefPoint` must match the last trip's arrival
location. Internal piece boundaries must occur at allowed relief arrivals. The
first source trip of a block may use its pull-out location and the last source
trip may use its pull-in location when the rule profile contains the matching
Garage travel time. Every exported trip must be covered exactly once for its
service-day instance.

Do not include duty activities or calculated totals. Scheduler 4 derives them
from the referenced trips, relief points, travel-time rules, and break rules.

## Weekly rosters

Each roster uses an anonymous crew ID and exactly one assignment for each day
Monday through Sunday. Assignments reference daily run IDs and preserve the day
type: Monday-Friday use `Weekday`, Saturday uses `Saturday`, and Sunday uses
`Sunday`. Days off use `runId: null`. Do not place employee identity or bidding
data in any field.

## Findings

Use these categories without substitution:

- `integrity`: invalid or unresolved source/coverage/continuity data; blocks
  approval.
- `contractual`: a confirmed agreement or hard operating-rule breach; blocks
  approval.
- `exception`: permitted but outside the standard operating pattern; warning.
- `best-practice`: quality, consistency, or efficiency concern; warning.
- `informational`: disclosed context or a check that could not be evaluated.

Use severity `error`, `warning`, or `info` consistently with the category.
Stable finding IDs should be deterministic from the rule and affected IDs.
Scheduler 4 imports all Codex-authored findings as advisory information; their
self-reported category does not control approval. The app independently
recreates integrity and contractual blockers.

## Required JSON shape

Use this structural template, replacing every placeholder with values copied or
derived from the input. Do not copy the example identifiers literally.

```json
{
  "schemaVersion": 1,
  "kind": "operations-planning-proposal",
  "scenarioId": "<input.scenarioId>",
  "sourceManifestFingerprint": "<input.sourceManifest.fingerprint>",
  "codex": {
    "generatedAt": "<ISO-8601 timestamp>",
    "model": "<optional model name>",
    "rationale": "<optional short rationale>"
  },
  "blockAudits": [
    {
      "id": "<copy>",
      "routeIdentity": "<copy>",
      "routeIdentities": ["<copy>"],
      "sourceVersion": 0,
      "dayType": "Weekday",
      "vehicleBlockKey": "<copy>",
      "blockId": "<copy>",
      "sourceBlockIds": ["<copy>"],
      "tripIds": ["<copy in source order>"],
      "membershipFingerprint": "<copy>",
      "firstDeparture": 0,
      "finalArrival": 0,
      "findings": []
    }
  ],
  "dailyRuns": [
    {
      "id": "weekday-run-001",
      "runNumber": "W-001",
      "dayType": "Weekday",
      "pieces": [
        {
          "id": "weekday-run-001-piece-1",
          "blockId": "<input trip.vehicleBlockKey>",
          "routeNumber": "<input trip.routeNumber>",
          "tripIds": ["<contiguous input trip IDs in source order>"],
          "startReliefPoint": "<recognized relief point>",
          "endReliefPoint": "<recognized relief point>"
        }
      ],
      "notes": "<optional planner-facing note>"
    }
  ],
  "weeklyRosters": [
    {
      "id": "crew-001",
      "crewNumber": "Crew 001",
      "assignments": [
        { "day": "Monday", "runId": "<weekday run ID or null>" },
        { "day": "Tuesday", "runId": "<weekday run ID or null>" },
        { "day": "Wednesday", "runId": "<weekday run ID or null>" },
        { "day": "Thursday", "runId": "<weekday run ID or null>" },
        { "day": "Friday", "runId": "<weekday run ID or null>" },
        { "day": "Saturday", "runId": "<Saturday run ID or null>" },
        { "day": "Sunday", "runId": "<Sunday run ID or null>" }
      ]
    }
  ],
  "findings": [
    {
      "id": "<stable ID>",
      "category": "integrity",
      "severity": "error",
      "code": "<stable code>",
      "message": "<concise planner explanation>"
    }
  ],
  "methodNotes": ["<material optimization trade-off>"]
}
```

## App authority

Scheduler 4 validates references, coverage, block immutability, source
freshness, rule compliance, and all time/pay metrics after import. Do not add
self-reported totals. Imported content remains a draft until the protected
submit/approve workflow succeeds.
