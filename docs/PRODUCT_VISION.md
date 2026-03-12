# Barrie Transit Schedule Builder - Product Vision

> Source of truth for product decisions. Read this before planning significant features.

---

## Purpose

Internal operations tool for Barrie Transit planners to **create, edit, optimize, and publish fixed-route bus schedules**. This replaces manual Excel-based scheduling with a structured workflow that enforces timing rules and enables AI-assisted optimization.

---

## Target Users

| User | Role | Primary Tasks |
|------|------|---------------|
| **Transit Planner** | Schedule creation | Build schedules from runtime data, optimize for connections |
| **Operations Manager** | Schedule approval | Review drafts, publish to master, track versions |
| **Dispatcher** | Reference | View published schedules, export for operations |

All users belong to **teams** with role-based access (Owner, Admin, Member).

---

## Core Workflows

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
- No cross-team data access
- Invitation-based team membership

### 5. AI as Assistant, Not Authority
- Gemini provides suggestions for schedule optimization
- Transit On Demand uses fast full regenerate and a richer multi-phase refine path before human review
- Planner always has final say

---

## Data Model (Simplified)

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

## Routes Supported

| Type | Examples | Pattern |
|------|----------|---------|
| **Linear (A/B)** | 2, 7, 12 | Merged directions, shared downtown terminus |
| **Linear (Variant)** | 8A, 8B | Separate variants with own stops |
| **Linear (Bidirectional)** | 400 | Explicit North/South directions between RVH and Park Place |
| **Loop** | 10, 11, 100, 101 | Circular routes |

---

## Feature Priorities

### Must Have (Core)
- [x] CSV runtime import and parsing
- [x] Schedule generation with time bands
- [x] Schedule editing (ScheduleEditor)
- [x] Master schedule publishing (Draft → Publish workflow)
- [x] GTFS import with block assignment (including system-wide import)
- [x] Connection library and optimization

### Should Have (Operations)
- [x] Platform conflict detection
- [x] Excel/PDF export (CSV shifts + PDF brochure)
- [x] Version history
- [ ] Interlining (8A/8B) - removed Feb 2026, pending reimplementation

### Nice to Have (Enhancements)
- [x] Public timetable brochure generator
- [ ] Real-time GTFS export
- [ ] Multi-route scenario comparison
- [ ] Automated regression testing for schedules

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

1. **Firebase-only backend** - No custom server. All logic in client + Firestore rules.
2. **Offline capability limited** - Requires internet for Firebase sync and Gemini API.
3. **Single-city scope** - Hardcoded for Barrie Transit routes; not multi-agency.
4. **Browser-based** - No native mobile app. Responsive but desktop-optimized.

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

---

## Version History

| Date | Change |
|------|--------|
| 2026-01-17 | Initial vision document created |
| 2026-02-09 | Updated feature status: brochure done, interline removed, draft→publish live |
