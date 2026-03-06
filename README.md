# Barrie Transit Schedule Builder

Internal schedule planning tool for Barrie Transit operations.

## Purpose

Generate, edit, and publish fixed-route bus schedules with:
- Runtime-based schedule generation from CSV data
- AI-powered schedule optimization (Google Gemini)
- Excel master schedule import/export
- Draft → Publish workflow for schedule management

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
# Optional: set VITE_MAPBOX_TOKEN for map features
npm run dev
```

## Project Structure

```
├── components/              # React UI and workspace modules
├── utils/                   # Domain logic, parsers, services, config
├── functions/               # Firebase Functions and ops scripts
├── tests/                   # Vitest coverage
├── docs/                    # Durable docs, runbooks, plans, archive
└── .claude/                 # Repo workflow and compatibility context
```

Detailed file ownership lives in `docs/ARCHITECTURE.md`. Use the summary above only as a starting point.

## Documentation

- [Context Index](docs/CONTEXT_INDEX.md) - Start here for repository context and load order
- [Locked Logic](docs/rules/LOCKED_LOGIC.md) - Durable behavioral constraints
- [.claude/CLAUDE.md](.claude/CLAUDE.md) - Repo workflow, verification expectations, and danger zones
- [Architecture](docs/ARCHITECTURE.md) - System design and source file layout
- [Schema](docs/SCHEMA.md) - Firestore, storage, and type-location reference
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Roadmap and status tracking
- [Plans Directory](docs/plans/README.md) - Archive and working plans, not default context
- [Archive](docs/archive/README.md) - Historical notes that should not drive current implementation

## Routes Supported

| Route | Type | Description |
|-------|------|-------------|
| 400 | Linear | Explicit North/South service between RVH and Park Place |
| 2, 7, 12 | Linear | A/B directions |
| 8A, 8B | Linear | Route variants |
| 10, 11, 100, 101 | Loop | Circular routes |
