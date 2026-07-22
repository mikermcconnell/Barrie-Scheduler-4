# Barrie Transit Scheduler 4

Internal transit planning platform for Barrie Transit operations.

## Purpose

Scheduler 4 is a Barrie Transit planning app with a strong fixed-route scheduling core plus adjacent planning and operations tools.

It currently supports:
- fixed-route schedule generation, editing, optimization, and publishing
- Transit On-Demand planning, Master/RideCo shift import review, and shift optimization
- operations dashboards and reporting for STREETS data
- planning-data workspaces such as Transit App analytics, OD analysis, Route Planner, Shuttle Planner, and Network Connections

## Main Workspaces

| Workspace | Role |
|-----------|------|
| Scheduled Transit | Core fixed-route schedule building, editing, publishing, connections, and reports |
| Transit On-Demand | Demand-responsive planning and optimization |
| Dashboard & Reporting | Operational performance dashboards, imports, and reporting |
| Planning Data tools | Route planning, shuttle concepts, network connections, Transit App, OD, and related analysis surfaces |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Database | Firebase Firestore |
| Storage | Firebase Storage |
| Auth | Firebase Auth |
| AI | Google Gemini API |

## Quick Start

```powershell
npm install
Copy-Item .env.example .env.local
# Edit .env.local and set GEMINI_API_KEY
# Keep VITE_OPTIMIZE_TIMEOUT_MS=300000 and VITE_OPTIMIZE_MAX_RETRIES=0 for TOD optimization
# Optional: set VITE_MAPBOX_TOKEN for map features
npm run dev
```

Production note: Transit On Demand optimization should use the Firebase/Cloud Run backend. Do not enable `VITE_ENABLE_VERCEL_OPTIMIZE_FALLBACK` for this flow unless the Vercel function timeout is explicitly raised to match the optimizer workload.

## Project Structure

```
├── components/              # React UI and workspace modules
├── utils/                   # Domain logic, parsers, services, config
├── functions/               # Firebase Functions and ops scripts
├── tests/                   # Vitest coverage
├── docs/                    # Durable docs, feature briefs, runbooks, plans, archive
├── .agents/                 # Portable repository skills
├── .codex/                  # Codex-specific repository skills
└── .claude/                 # Claude-specific workflow and compatibility context
```

Detailed file ownership lives in `docs/ARCHITECTURE.md`. Use the summary above only as a starting point.

## Documentation

For agent work, start with only these two files:
- [AGENTS.md](AGENTS.md) - Primary agent entrypoint and repo instruction contract
- [Context Index](docs/CONTEXT_INDEX.md) - Canonical load order, document tiers, and what not to load by default

The Context Index routes each task to the smallest useful set of additional documents. Durable references include:
- [Locked Logic](docs/rules/LOCKED_LOGIC.md) - Durable behavioral constraints
- [Product Vision](docs/PRODUCT_VISION.md) - Overall product framing, with fixed-route as the core workflow
- [Architecture](docs/ARCHITECTURE.md) - System design and source file layout
- [Schema](docs/SCHEMA.md) - Firestore, storage, and type-location reference

Load these only when relevant:
- [.claude/CLAUDE.md](.claude/CLAUDE.md) - Tool-specific workflow supplement and danger-zone verification guidance
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Roadmap and status tracking
- [Route Planner 2 docs](docs/route-planner-2/README.md)
- [Shuttle Planner PRD](docs/SHUTTLE_PLANNER_PRD.md)
- [Network Connections brief](docs/NETWORK_CONNECTIONS_PRODUCT_BRIEF.md)
- [Plans Directory](docs/plans/README.md) - Historical plans, not default context
- [Archive](docs/archive/README.md) - Historical notes that should not drive current implementation
- [Artifacts](docs/artifacts/README.md) - Supporting files and examples, not default context

Run `npm run docs:check` after changing agent-facing Markdown. It validates required context files, repository-relative links, portable paths, and skill frontmatter.

## Fixed-Route Routes Supported

| Route | Type | Description |
|-------|------|-------------|
| 400 | Linear | Explicit North/South service between RVH and Park Place |
| 2, 7, 12 | Linear | A/B directions |
| 8A, 8B | Linear | Route variants |
| 10, 11, 100, 101 | Loop | Circular routes |
