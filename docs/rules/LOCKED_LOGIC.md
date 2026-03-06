# Locked Logic

Read this before changing core schedule behavior.

This is the durable, tool-agnostic summary of non-negotiable rules.

Use `.claude/CLAUDE.md` for repo workflow and verification expectations.
Use `.claude/context.md` only for detailed compatibility and historical implementation notes.

---

## Core Rules

### 1. Segment rounding

Round each segment before summing.

```typescript
const total = Math.round(seg1) + Math.round(seg2);
```

Do not switch to sum-then-round.

### 2. Trip pairing

Schedule rows represent paired north/south trips, not separate same-direction stacks.

### 3. Cycle time

Cycle time is:

```typescript
lastTripEnd - firstTripStart
```

Do not replace this with summed trip durations.

### 4. Block assignment for merged routes

For merged A/B routes, chain trips by actual time gap, not expected start derived from recovery.

### 5. Time parsing

Excel time values `>= 1.0` represent next-day service and must preserve post-midnight ordering.

### 6. AI optimization

Keep the generator -> critic pattern. AI suggests; planners decide.

---

## High-Risk Areas

- `utils/schedule/scheduleGenerator.ts`
- `utils/blocks/blockAssignmentCore.ts`
- `utils/parsers/masterScheduleParser*.ts`
- `utils/timeUtils.ts`
- `components/ScheduleEditor.tsx`
- `components/schedule/RoundTripTableView.tsx`
- `utils/routing/`

If you touch these, read `.claude/CLAUDE.md` danger zones and the detailed notes in `.claude/context.md`.

---

## Durable Terms

- Runtime: actual driving time
- Recovery: buffer between trips
- Cycle Time: total vehicle operating period
- Trip Pair: northbound + southbound trip
- Block: chain of trips operated by one bus
- Time Band: period with characteristic travel times

---

## What Not To Do

- Do not change locked behavior without explicit approval.
- Do not use archived plan files as the sole justification for current behavior.
- Do not assume old file paths in docs are still valid without checking `docs/ARCHITECTURE.md` or `docs/SCHEMA.md`.
