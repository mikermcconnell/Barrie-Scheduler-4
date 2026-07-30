# Scheduler 4 - Product Vision

> Source of truth for product decisions. Read this before planning significant features.
> Scheduler 4 is a transit planning platform with a fixed-route scheduling core.
> `docs/IMPLEMENTATION_PLAN.md` is a dated delivery-history snapshot, not the current roadmap; verify current status from code, tests, and the active issue/task source.
> Use `docs/rules/LOCKED_LOGIC.md` for canonical schedule behavior, `docs/ARCHITECTURE.md` for current code ownership and data flow, and `docs/SCHEMA.md` for persisted data and type contracts.

---

## Product Frame

Scheduler 4 is an internal Barrie Transit planning platform.

Its most mature and operationally critical workflow is fixed-route schedule building, but the repository also contains adjacent planning and analysis surfaces that support service design, on-demand planning, and operations review.

Primary app shells today:
- **Scheduled Transit** - fixed-route schedule generation, editing, optimization, publishing, and timetable/report outputs
- **Transit On-Demand** - demand-responsive requirements import, RideCo/MVT shift import review, planning, and shift optimization
- **Dashboard & Reporting** - STREETS-backed performance dashboards and operational reporting
- **Parking** - shared department parking-code import, monthly usage summaries, and plate-level pattern review
- **Planning Data** - access-controlled route, network, ridership, fleet, growth, and policy-analysis workspaces

Scheduled Transit also includes **Detour Publisher**, a team-shared, map-first tool for creating fixed-route detour and stop-closure notices from current GTFS patterns. It exports public communication packages but does not modify schedules, GTFS, or MyRide directly.

Adjacent planning-data workspaces include Route Planner 2, the internal-beta Route Concept Planner, Shuttle Planner, Network Connections, Transit App analytics, OD analysis, student-pass planning, Fare Programs, Council Intelligence, and related exploratory tools. Fare Programs summarizes fare-program usage while keeping proxy geography visibly separate from confirmed rider or school identity. Council Intelligence is a transit-first, evidence-led internal pilot: official named votes and sourced statements may inform profiles, while missing evidence stays unknown and AI or procedural signals must never be presented as official councillor votes.

Use this document for the overall product frame and the fixed-route core workflow. Use feature-specific product briefs and UI specs for narrower planning-data modules when those tasks are directly relevant.

---

## Purpose

Internal operations tool for Barrie Transit planners to **create, edit, optimize, and publish fixed-route bus schedules** while keeping that core workflow connected to adjacent planning and analysis tools.

The fixed-route workflow replaces manual Excel-based scheduling with a structured system that enforces timing rules and enables AI-assisted optimization.

---

## Related Feature Docs

Load these only when the task is directly related:

- `docs/DETOUR_PUBLISHER.md` for detour and stop-closure notice authoring
- `docs/route-concept-planner/README.md` and its contract docs for neutral complete-route concept testing
- `docs/route-planner-2/README.md` and numbered docs for current Route Planner 2 work
- `docs/route-planner-legacy/README.md` only for historical old Route Planner background
- `docs/SHUTTLE_PLANNER_PRD.md`
- `docs/SHUTTLE_PLANNER_UI_SPEC.md`
- `docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md`
- `docs/NETWORK_CONNECTIONS_UI_SPEC.md`
- `docs/OD_WORKSPACE_GUIDE.md`

---

## Route-planning boundary

- **Route Planner 2** is the working Camp route-planning tool. Preserve its Camp workflows, storage, exports, navigation, and behaviour.
- **Route Concept Planner** is a separate internal-beta workspace for testing complete fixed-route alternatives with scheduled GTFS evidence, Mapbox road-time estimates, and confirmed planner overrides.
- Route Concept Planner supports feasibility and comparison only. It does not create schedules, modify/publish GTFS, estimate operating cost, or include Camp/address-manifest workflows.

The planner remains responsible for assumptions, overrides, preferred-alternative selection, and any decision to advance a concept.

---

## Target Users

| User | Role | Primary Tasks |
|------|------|---------------|
| **Transit Planner** | Schedule creation and planning analysis | Build schedules from runtime data, optimize for connections, and use planning tools |
| **Operations Manager** | Schedule approval and operational review | Review drafts, publish to master, track versions, review reporting |
| **Dispatcher** | Reference | View published schedules, export for operations |

Ordinary users belong to **teams** with role-based access (Owner, Admin,
Member). Global scheduler administrators are the exception: they can operate
without a home-team membership and use time-bounded support access to inspect
or edit an authorized team context.

---

## Core Fixed-Route Workflows

### 1. Create Schedule from Runtime Data (Primary)
```
Upload CSV → Analyze runtimes → Configure cycle/headway → Generate trips → Optimize connections → Save draft → Submit for review → Ready for review → Publish
```
**5-step wizard**: Upload → Analysis → Build → Schedule → Connections

### 2. Import from GTFS (Secondary)
```
Fetch GTFS feed → Map routes/directions → Chain trips to blocks → Create draft → Edit → Submit for review → Ready for review → Publish
```
Used for onboarding existing schedules into the system.

### 3. Edit Published Schedule
```
Copy master to draft → Edit trips/times → Re-optimize if needed → Submit for review → Ready for review → Publish new version
```
Version history preserved. Rollback possible.

Publishing is a protected service transition, not a direct wizard or editor
action. The draft must have no blocking schedule issues, be marked
`ready_for_review`, retain a current immutable review snapshot that matches its
content and source master version, and include a publish note.

### 4. Connection Optimization
```
Define targets (GO Train, college bells) → Run optimizer → Review adjustments → Accept/reject
```
AI-assisted but planner-controlled.

## Transit On-Demand Workflow

```
Upload Master requirements and/or RideCo/MVT shifts → Review detected shifts and warnings → Apply import → Optimize/refine → Save/export
```

RideCo/MVT imports are planner-reviewed before they replace the active shifts. The parser supports workbook sheets, Excel numeric time cells, overnight service, day-type counts, and skipped-column warnings so planners can spot partial or malformed shift columns.

---

## Architectural Principles

### 1. Draft → Publish Workflow
- Schedule edits happen on **working drafts**; current draft persistence is user-scoped, while review and published master state are team-scoped
- Publishing creates **immutable master schedule** (versioned)
- Never modify master schedules directly
- The canonical persisted shapes and version paths live in `docs/SCHEMA.md`

### 2. Locked Schedule Behavior
- Segment timing, trip pairing, cycle-time semantics, block assignment, and post-midnight ordering are defined in `docs/rules/LOCKED_LOGIC.md`
- Do not restate or reinterpret those formulas in feature plans; load the canonical rule before changing schedule behavior

### 3. Team-Based Multi-Tenancy
- Operational workspace data is team-scoped unless `docs/SCHEMA.md` documents an intentional user-scoped or global record
- No ordinary user cross-team data access; only explicit partner data-source links and global-admin support access may cross team/user boundaries
- Invitation-based team membership
- Exact collections, support-session boundaries, and data-source pointers live in `docs/SCHEMA.md`

### 4. AI as Assistant, Not Authority
- Gemini provides suggestions for schedule optimization
- Transit On Demand uses fast full regenerate and a richer multi-phase refine path before human review
- Planner always has final say

---

## Data and domain references

- Firestore collections, Storage paths, draft/master versioning, and TypeScript type locations: `docs/SCHEMA.md`
- Current component ownership and end-to-end data flow: `docs/ARCHITECTURE.md`
- Canonical timing, pairing, block, and cycle semantics: `docs/rules/LOCKED_LOGIC.md`
- Route- and workspace-specific contracts: the matching feature docs listed in `docs/CONTEXT_INDEX.md`

---

## Fixed-Route Routes Supported

| Type | Examples | Pattern |
|------|----------|---------|
| **Linear (A/B)** | 2, 7, 12 | Merged directions, shared downtown terminus |
| **Linear (Variant)** | 8A, 8B | Separate variants with own stops |
| **Linear (Bidirectional)** | 400 | Explicit North/South directions between RVH and Park Place |
| **Loop** | 10, 11, 100, 101 | Circular routes |

---

## Product capabilities and future direction

Current maintained fixed-route capabilities include CSV runtime import, time-band schedule generation, schedule editing, Draft → Publish, GTFS import and block assignment, connection optimization, conflict review, version history, Excel/PDF outputs, public timetable brochure generation, and schedule regression tests.

Future candidates include:

- interlining for 8A/8B after a safe replacement design is approved
- real-time GTFS export
- broader multi-route scenario comparison

This is product direction, not delivery status. Verify current status from code, tests, and the active issue/task source; `docs/IMPLEMENTATION_PLAN.md` is a dated historical snapshot.

---

## What This App Is NOT

| Anti-Pattern | Why Avoid |
|--------------|-----------|
| **Real-time operations system** | This is planning, not dispatch. No live vehicle tracking. |
| **Public-facing timetable app** | Exports for operations; riders use TransitApp or Google Maps. |
| **General scheduling tool** | Built specifically for Barrie Transit's route structure and workflows. |
| **Fully automated scheduler** | AI assists; humans decide. No "generate and publish" without review. |
| **CAD/AVL replacement** | No automatic vehicle location or dispatch integration. |

---

## Technical Constraints

1. **Firebase-backed application** - Firestore, Storage, Auth, and Cloud Functions are the primary platform services.
2. **Thin server helpers exist** - API routes, Cloud Functions, and Cloud Run helpers are allowed when needed for secure or long-running operations such as optimization, parsing, and reporting.
3. **Offline capability limited** - Requires internet for Firebase sync and AI-backed workflows.
4. **Single-city scope** - Optimized for Barrie Transit routes and workflows, not a generic multi-agency platform.
5. **Browser-based** - Desktop-first web application, with limited mobile expectations.

---

## Locked Logic Reference

Read `docs/rules/LOCKED_LOGIC.md` before changing schedule behavior. Use `AGENTS.md` for universal workflow and verification expectations.

`.claude/CLAUDE.md` and `.claude/context.md` are optional tool-specific and historical supplements; they do not override the durable rule summary.

---

## Decision Framework

When planning features, ask:

1. **Does it serve the core workflow?** (Create → Edit → Optimize → Publish)
2. **Does it respect the draft→publish pattern?**
3. **Does it keep the planner in control?** (AI suggests, human decides)
4. **Is it Barrie Transit-specific or generalizable?** (Favor specific)
5. **Does it touch locked logic?** (If yes, extra scrutiny required)
