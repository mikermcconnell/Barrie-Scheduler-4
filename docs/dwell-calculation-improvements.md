# Dwell Calculation — Current State & Proposed Improvements

> Point-in-time analysis note. Not default repository context; use durable docs first and treat this file as working history.

## How It Works Today

The system checks every timepoint: **did the bus leave more than 3 minutes late?**

- **No** — no dwell recorded
- **Yes, but arrived on time** — dwell = how late it departed
- **Yes, and arrived late** — dwell = time sitting at the stop

March 3 baseline: **14 hours** total dwell, **122 moderate** (2-5 min), **19 high** (>5 min)

---

## What We Want to Change

### 1. Subtract Normal Boarding Time (90 seconds)

Right now, routine passenger boarding counts as dwell. A bus that stops for 60 seconds to pick up riders looks the same as one stuck at a signal for 60 seconds.

**Change:** Subtract 90 seconds of normal boarding before counting dwell.

**Impact:** March 3 total dwell drops from ~14 hrs to **~10-11 hrs**.

### 2. Lower the Late Gate from 3 Minutes to 2 Minutes

A bus departing 2:59 late records zero dwell. One departing 3:01 late records full dwell. We're missing real delays in that gap.

**Change:** Start counting dwell at 2 minutes late instead of 3.

**Impact:** Captures more incidents, adding **~2-3 hrs** before the boarding buffer is applied.

### 3. Fairer Terminal Dwell

At terminals, buses have scheduled recovery time (5-15 min). If a bus arrives early and uses most of that recovery but still leaves a few minutes late, the current formula counts all the lateness as dwell — even though the bus barely exceeded its scheduled time.

**Change:** Cap dwell at the actual extra time beyond scheduled recovery, not total departure lateness.

**Impact:** Reduces inflated dwell at terminal stops.

---

## Combined Effect (March 3 Estimate)

| Scenario | Total Hours | Moderate | High |
|----------|------------|----------|------|
| Current | 14.0 | 122 | 19 |
| With all three changes | ~8-10 | ~90-100 | ~15-18 |

Lower total hours because we remove boarding noise. Slightly fewer incidents because borderline cases get filtered. The remaining incidents are more meaningful — real delays, not routine operations.

---

## Implementation Order

1. **Boarding buffer** — biggest impact, simplest change
2. **Lower gate** — one constant change
3. **Terminal cap** — slightly more involved but straightforward

Each change can be applied and tested independently.
