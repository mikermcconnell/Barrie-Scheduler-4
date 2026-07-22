# Locked Logic

Read this before changing core schedule behavior.

This is the durable, tool-agnostic summary of non-negotiable rules.

Use `AGENTS.md` for repository-wide workflow and verification expectations.
Use `.claude/CLAUDE.md` only as a Claude-specific supplement or for its extra danger-zone verification table. Use `.claude/context.md` only for detailed historical implementation notes.

---

## Core Rules

### 1. Segment rounding

Round each segment before summing.

```typescript
const total = Math.round(seg1) + Math.round(seg2);
```

Do not switch to sum-then-round.

### 2. Trip pairing

For bidirectional fixed-route schedules, paired table rows represent the two complementary directions (historically north/south), not separate same-direction stacks.

Loop-route planning chains are an explicit exception: keep them keyed as `Loop` and do not coerce them to `North` or `South` merely to satisfy paired-table assumptions.

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

- Runtime: for STREETS-derived stop-to-stop planning proxies, use observed departure-to-departure time when the downstream stop has an observed departure; fall back to downstream arrival at terminal/end-of-trip points so terminal recovery stays separate
- Recovery: buffer between trips
- Cycle Time: total vehicle operating period
- Trip Pair: the two complementary directional trips in a bidirectional schedule row; loop chains remain `Loop`
- Block: chain of trips operated by one bus
- Time Band: period with characteristic travel times

---

## What Not To Do

- Do not change locked behavior without explicit approval.
- Do not use archived plan files as the sole justification for current behavior.
- Do not assume old file paths in docs are still valid without checking `docs/ARCHITECTURE.md` or `docs/SCHEMA.md`.
- Do not let tool-specific supplements override `AGENTS.md` or this durable summary.
