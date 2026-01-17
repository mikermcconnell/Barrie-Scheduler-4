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
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Database | Firebase Firestore |
| Storage | Firebase Storage |
| Auth | Firebase Auth |
| AI | Google Gemini API |

## Quick Start

```bash
npm install
cp .env.local.example .env.local  # Add your API keys
npm run dev
```

## Project Structure

```
├── components/
│   ├── NewSchedule/          # Schedule creation wizard
│   ├── ScheduleEditor.tsx    # Main schedule editing view
│   └── MasterScheduleBrowser.tsx
├── utils/
│   ├── scheduleGenerator.ts  # Trip generation logic
│   ├── masterScheduleParserV2.ts  # Excel parsing
│   └── blockAssignment.ts    # Vehicle block linking
├── api/
│   └── optimize.ts           # AI optimization endpoint
└── docs/                     # Architecture & specs
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design and data model
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Development roadmap

## Routes Supported

| Route | Type | Description |
|-------|------|-------------|
| 400 | Linear | RVH ↔ Park Place |
| 2, 7, 12 | Linear | A/B directions |
| 8A, 8B | Linear | Route variants |
| 10, 11, 100, 101 | Loop | Circular routes |
