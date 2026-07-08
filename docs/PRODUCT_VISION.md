# Scheduler 4 - Product Vision

> Source of truth for product decisions. Read this before planning significant features.
> Scheduler 4 is a transit planning platform with a fixed-route scheduling core.
> Keep roadmap status and dated delivery history in `docs/IMPLEMENTATION_PLAN.md`, not here.

---

## Product Frame

Scheduler 4 is an internal Barrie Transit planning platform.

Its most mature and operationally critical workflow is fixed-route schedule building, but the repository also contains adjacent planning and analysis surfaces that support service design, on-demand planning, and operations review.

Primary app shells today:
- **Scheduled Transit** - fixed-route schedule generation, editing, optimization, publishing, and timetable/report outputs
- **Transit On-Demand** - demand-responsive requirements import, RideCo/MVT shift import review, planning, and shift optimization
- **Dashboard & Reporting** - STREETS-backed performance dashboards and operational reporting
- **Parking** - shared department parking-code import, monthly usage summaries, and plate-level pattern review

Adjacent planning-data workspaces include Route Planner 2, Shuttle Planner, Network Connections, Transit App analytics, OD analysis, student-pass planning, and related exploratory tools.

Use this document for the overall product frame and the fixed-route core workflow. Use feature-specific product briefs and UI specs for narrower planning-data modules when those tasks are directly relevant.

---

## Purpose

Internal operations tool for Barrie Transit planners to **create, edit, optimize, and publish fixed-route bus schedules** while keeping that core workflow connected to adjacent planning and analysis tools.

The fixed-route workflow replaces manual Excel-based scheduling with a structured system that enforces timing rules and enables AI-assisted optimization.

---

## Related Feature Docs

Load these only when the task is directly related:

- `docs/route-planner-2/README.md` and numbered docs for current Route Planner 2 work
- `docs/route-planner-legacy/README.md` only for historical old Route Planner background
- `docs/SHUTTLE_PLANNER_PRD.md`
- `docs/SHUTTLE_PLANNER_UI_SPEC.md`
- `docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md`
- `docs/NETWORK_CONNECTIONS_UI_SPEC.md`
- `docs/OD_WORKSPACE_GUIDE.md`

---

## Target Users

| User | Role | Primary Tasks |
|------|------|---------------|
| **Transit Planner** | Schedule creation and planning analysis | Build schedules from runtime data, optimize for connections, and use planning tools |
| **Operations Manager** | Schedule approval and operational review | Review drafts, publish to master, track versions, review reporting |
| **Dispatcher** | Reference | View published schedules, export for operations |

All users belong to **teams** with role-based access (Owner, Admin, Member).

---

## Core Fixed-Route Workflows

### 1. Create Schedule from Runtime Data (Primary)
```
Upload CSV → Analyze runtimes → Configure cycle/headway → Generate trips → Optimize connections → Publish
```
**5-step wizard**: Upload → Analysis → Build → Schedule → Connections

### 2. Import from GTFS (Secondary)
```
Fetch GTFS feed → Map routes/directions → Chain trips to blocks → Create draft → Edit → Publish
```
Used for onboarding existing schedules into the system.

### 3. Edit Published Schedule
```
Copy master to draft → Edit trips/times → Re-optimize if needed → Publish new version
```
Version history preserved. Rollback possible.

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
- All edits happen on **drafts** (team-scoped, ephemeral)
- Publishing creates **immutable master schedule** (versioned)
- Never modify master schedules directly

### 2. Segment-Based Timing (Locked)
- Individual segment runtimes rounded before summing
- Prevents cumulative timing drift
- **DO NOT** change to sum-then-round

### 3. Gap-Based Block Assignment (Locked)
- Trips chained by time gap, not array index
- Critical for merged routes (2A+2B) where GTFS lacks explicit recovery
- **DO NOT** use expectedStart + recovery for matching

### 4. Team-Based Multi-Tenancy
- All data scoped to `teams/{teamId}/`
- No ordinary user cross-team data access; only explicit partner data-source links and global-admin support access may cross team/user boundaries
- Invitation-based team membership

### 5. AI as Assistant, Not Authority
- Gemini provides suggestions for schedule optimization
- Transit On Demand uses fast full regenerate and a richer multi-phase refine path before human review
- Planner always has final say

---

## Fixed-Route Data Model (Simplified)

```
Team
├── DraftSchedule (editable, temporary)
│   ├── route, dayType, status
│   └── content: { northTable, southTable, metadata }
│
├── MasterSchedule (published, immutable)
│   ├── route_dayType identifier
│   └── versioned content + history
│
└── ConnectionLibrary (optimization targets)
```

**Trip** = Single direction journey (Park Place → Downtown)
**Block** = Chain of trips operated by one bus all day
**Round-Trip** = Paired North + South trips (one bus cycle)
**Cycle Time** = first departure → last arrival + final recovery

---

## Fixed-Route Routes Supported

| Type | Examples | Pattern |
|------|----------|---------|
| **Linear (A/B)** | 2, 7, 12 | Merged directions, shared downtown terminus |
| **Linear (Variant)** | 8A, 8B | Separate variants with own stops |
| **Linear (Bidirectional)** | 400 | Explicit North/South directions between RVH and Park Place |
| **Loop** | 10, 11, 100, 101 | Circular routes |

---

## Feature Priorities

### Must Have (Core)
- CSV runtime import and parsing
- Schedule generation with time bands
- Schedule editing
- Master schedule publishing through the Draft → Publish workflow
- GTFS import with block assignment, including system-wide import
- Connection library and optimization

### Should Have (Operations)
- Platform conflict detection
- Excel/PDF export
- Version history
- Interlining for 8A/8B once a safe replacement design is ready

### Nice to Have (Enhancements)
- Public timetable brochure generator
- Real-time GTFS export
- Multi-route scenario comparison
- Automated regression testing for schedules

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

Read `docs/rules/LOCKED_LOGIC.md` first.

Use `.claude/CLAUDE.md` for repo workflow, verification expectations, and danger zones.
Use `.claude/context.md` only when detailed historical implementation notes are needed for core schedule behavior:
- Segment rounding approach
- Block assignment algorithm for merged routes
- ARR/R/DEP column handling at merged terminuses

---

## Decision Framework

When planning features, ask:

1. **Does it serve the core workflow?** (Create → Edit → Optimize → Publish)
2. **Does it respect the draft→publish pattern?**
3. **Does it keep the planner in control?** (AI suggests, human decides)
4. **Is it Barrie Transit-specific or generalizable?** (Favor specific)
5. **Does it touch locked logic?** (If yes, extra scrutiny required)
