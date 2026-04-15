# Local AI Review Handoff

Date: 2026-04-10  
Repo: Scheduler 4

## Summary

We built a new **feature-flagged Local AI Review panel** inside the Fixed Route Schedule Editor.

It is currently **read-only** and supports two local-model actions:

1. **Find anomalies**
2. **Summarize vs master**

The panel uses a grounded route/day snapshot built from existing schedule data and compare logic. It does **not** edit schedules, publish anything, or bypass planner review.

---

## What is implemented

### 1. Editor UI

- Added **AI Review** button to the Schedule Editor header
- Added right-side **AIReviewPanel**
- Panel can open/close alongside the editor
- Panel shows:
  - local AI health
  - model/provider/base URL
  - grounded snapshot stats
  - deterministic findings
  - local-model review output

### 2. Grounded snapshot builder

Added a compact snapshot builder for the active route/day:

- trip count
- block count
- service span
- peak vehicles
- headway summary
- compare-to-master counts
- row-level flags
- deterministic findings from existing schedule logic

This snapshot is built before the model is called.

### 3. Local AI runtime integration

Added a new API route:

- `api/local-ai-review.ts`

It supports:

- `GET /api/local-ai-review` → local AI health check
- `POST /api/local-ai-review` → run AI review

Supported local runtime modes:

- `ollama`
- `openai-compatible`

### 4. Two AI actions

#### Find anomalies
Prompt focuses on:

- unusual headways
- recovery issues
- suspicious new/ambiguous compare results
- service patterns worth planner review

#### Summarize vs master
Prompt focuses on:

- added service
- removed service
- compare-review items
- meaningful operational differences from master

This action only runs when a master comparison baseline exists.

---

## Key files added

- `components/ai/AIReviewPanel.tsx`
- `utils/ai/scheduleReviewTypes.ts`
- `utils/ai/scheduleReviewContext.ts`
- `utils/ai/scheduleReviewService.ts`
- `api/local-ai-review.ts`

## Key files updated

- `components/ScheduleEditor.tsx`
- `components/layout/WorkspaceHeader.tsx`
- `utils/features.ts`
- `vite.config.ts`
- `docs/ARCHITECTURE.md`
- `ORCHESTRATOR.md`

---

## Feature flag

The panel is behind:

- `fixedLocalAiReview`

Enable in the app with:

```env
VITE_FEATURE_FIXED_LOCAL_AI_REVIEW=true
```

---

## Local AI env vars

Recommended Ollama setup:

```env
LOCAL_AI_ENABLED=true
LOCAL_AI_PROVIDER=ollama
LOCAL_AI_BASE_URL=http://127.0.0.1:11434
LOCAL_AI_MODEL=gemma4
LOCAL_AI_TIMEOUT_MS=45000
```

Optional OpenAI-compatible setup:

```env
LOCAL_AI_ENABLED=true
LOCAL_AI_PROVIDER=openai-compatible
LOCAL_AI_BASE_URL=http://127.0.0.1:1234/v1
LOCAL_AI_MODEL=gemma4
LOCAL_AI_API_KEY=your_key_if_needed
LOCAL_AI_TIMEOUT_MS=45000
```

Notes:

- Ollama health check uses `/api/tags`
- OpenAI-compatible health check uses `/models`
- browser does **not** call the local runtime directly

---

## Guardrails

Current rules:

- **read-only only**
- no schedule mutation from AI output
- no publish integration
- no generator/block assignment changes
- no automatic acceptance of findings

Planner remains in control.

---

## Verification completed

### Passed

- `npm run build`

### Not clean, but pre-existing

- `npx tsc --noEmit`

TypeScript still fails in existing test files unrelated to this feature, including:

- `tests/App.resume.test.tsx`
- `tests/ConnectionLibraryPanel.test.tsx`
- `tests/masterScheduleService.test.ts`
- `tests/optimizeCore.shared.test.ts`
- `tests/publishService.test.ts`
- `tests/ScheduleEditor.integration.test.tsx`
- `tests/ScheduleEditor.shell.test.tsx`
- `tests/Step5Connections.routeFirstCreate.test.tsx`
- `tests/Step5Connections.test.tsx`
- `tests/useGridNavigation.test.tsx`

No new app-code type failures remained after the Local AI Review work.

---

## Current user-visible state

When enabled, the Schedule Editor now shows:

- **AI Review** button in the header
- local runtime readiness state
- **Find anomalies** action
- **Summarize vs master** action
- rendered structured AI output in the side panel

If local AI is unavailable, the panel shows a graceful error/readiness message.

---

## Best next step

Highest-value next slice:

### Slice 3: Jump from AI findings to the schedule row

Goal:

- click an AI finding
- scroll/focus the matching row in the grid
- highlight the affected row/block

That would make the panel much more operationally useful.

---

## Suggested restart prompt

If restarting the app/session, a good recovery prompt is:

> Read `AGENTS.md`, `docs/CONTEXT_INDEX.md`, `docs/rules/LOCKED_LOGIC.md`, `docs/ARCHITECTURE.md`, and `ORCHESTRATOR.md`. Then read `docs/plans/2026-04-10-local-ai-review-handoff.md` and continue the Local AI Review feature from the current state.

