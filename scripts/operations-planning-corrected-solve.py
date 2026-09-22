"""Bounded, local-only exact-cover and recurring-week run-cut solver.

Input candidates must already have passed the application's daily validator.
INFEASIBLE refers only to the supplied candidate pool/model, never transit
operations in general. UNKNOWN means the bounded search found no incumbent.
"""
import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path
import time

from ortools.sat.python import cp_model

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_TYPES = ["Weekday"] * 5 + ["Saturday", "Sunday"]


def roster_hint(duties, crew_count, weekly, seed):
    """Find a small days-off count plan, then seed chronological duty ordering.

    Hints never become hard restrictions: CP-SAT may change every hinted value.
    """
    patterns = [p for p in itertools.product([0, 1], repeat=7)
                if sum(p) in (4, 5) and any(all(p[(day + j) % 7] == 0
                for j in range(weekly["minimumConsecutiveDaysOff"])) for day in range(7))]
    model = cp_model.CpModel()
    counts = [model.new_int_var(0, crew_count, f"pattern-{i}") for i in range(len(patterns))]
    model.add(sum(counts) == crew_count)
    for day, day_type in enumerate(DAY_TYPES):
        model.add(sum(count * p[day] for count, p in zip(counts, patterns)) == len(duties[day_type]))
    model.add(sum(count for count, p in zip(counts, patterns) if sum(p) == 4) <= weekly["fourDayRosterMaximumCount"])
    solver = solver_for(2, seed)
    if solver.solve(model) not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
        return {}
    expanded = [p for p, count in zip(patterns, counts) for _ in range(solver.value(count))]
    # Spread off patterns through the chronological crew order instead of
    # clustering the same early/late starts into a single off-pattern group.
    expanded.sort(key=lambda p: -p[0])
    groups = [expanded[:len(duties["Weekday"])], expanded[len(duties["Weekday"]):]]
    expanded = []
    for group in groups:
        buckets = {}
        for p in group:
            buckets.setdefault(p, []).append(p)
        while any(buckets.values()):
            for bucket in buckets.values():
                if bucket:
                    expanded.append(bucket.pop())
    hint = {}
    for day, day_type in enumerate(DAY_TYPES):
        index = 0
        for crew, pattern in enumerate(expanded):
            hint[crew, day] = index if pattern[day] else len(duties[day_type]) + crew
            index += pattern[day]
    return hint


def solver_for(seconds, seed):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = seed
    return solver


def solve_daily(data, seconds, seed, excluded=()):
    model = cp_model.CpModel()
    rules = data["rules"]
    weekly = rules["weekly"]
    candidates = data["candidates"]
    selected = [model.new_bool_var(c["id"]) for c in candidates]
    by_unit = {u["id"]: [] for u in data["units"]}
    unit_days = {u["id"]: u["dayType"] for u in data["units"]}
    if len(by_unit) != len(data["units"]):
        raise ValueError("Duplicate unit IDs")
    if len({c["id"] for c in candidates}) != len(candidates):
        raise ValueError("Duplicate candidate IDs")
    for i, candidate in enumerate(candidates):
        if not candidate["unitIds"] or len(set(candidate["unitIds"])) != len(candidate["unitIds"]):
            raise ValueError("Empty or duplicate candidate unit membership")
        for unit in candidate["unitIds"]:
            if unit not in by_unit or unit_days[unit] != candidate["dayType"]:
                raise ValueError("Unknown or wrong-day candidate unit")
            by_unit[unit].append(selected[i])
    uncovered = [unit for unit, choices in by_unit.items() if not choices]
    if uncovered:
        return {"status": "INFEASIBLE", "reason": "Units have no candidate", "uncoveredUnitIds": uncovered}
    for choices in by_unit.values():
        model.add_exactly_one(choices)
    for day_type in set(DAY_TYPES):
        indexes = [i for i, c in enumerate(candidates) if c["dayType"] == day_type]
        long = [selected[i] for i in indexes if candidates[i]["spreadMinutes"] > rules["longSpreadMinutes"]["threshold"]]
        scale = 10000
        share = round(scale * rules["longSpreadMinutes"]["maximumShare"])
        model.add(scale * sum(long) <= share * sum(selected[i] for i in indexes))
        intervals = []
        for i in indexes:
            for j, interval in enumerate(candidates[i].get("cabIntervals", [])):
                start, end = interval["start"], interval["end"]
                if end < start:
                    raise ValueError("Negative cab interval")
                if end > start:
                    intervals.append(model.new_optional_fixed_size_interval_var(start, end - start, selected[i], f"cab-{i}-{j}"))
        if intervals:
            model.add_cumulative(intervals, [1] * len(intervals), rules["reliefCabCapacity"])
    weights = [5 if c["dayType"] == "Weekday" else 1 for c in candidates]
    crews = model.new_int_var(0, rules["workforce"]["fixedCrews"], "aggregate-crews")
    four_day = model.new_int_var(0, weekly["fourDayRosterMaximumCount"], "aggregate-four-day")
    model.add(four_day <= crews)
    model.add(sum(w * x for w, x in zip(weights, selected)) == 5 * crews - four_day)
    total_paid = sum(w * c["paidMinutes"] * x for w, c, x in zip(weights, candidates, selected))
    model.add(total_paid >= weekly["minimumPaidMinutes"] * crews)
    model.add(total_paid <= weekly["maximumCombinedMinutes"] * crews)
    model.add(sum(w * c["platformMinutes"] * x for w, c, x in zip(weights, candidates, selected)) <= weekly["maximumPlatformMinutes"] * crews)
    lookup = {c["id"]: i for i, c in enumerate(candidates)}
    for prior in excluded:
        indexes = [lookup[key] for key in prior]
        model.add(sum(selected[i] for i in indexes) <= len(indexes) - 1)
    model.minimize(sum(round(c.get("cost", c["paidMinutes"])) * w * x for c, w, x in zip(candidates, weights, selected)))
    solver = solver_for(seconds, seed)
    status = solver.solve(model)
    result = {"status": solver.status_name(status), "wallSeconds": solver.wall_time, "bestBound": solver.best_objective_bound}
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        result.update(selectedCandidateIds=[c["id"] for c, x in zip(candidates, selected) if solver.value(x)], objective=solver.objective_value, aggregateCrews=solver.value(crews))
    return result


def solve_weekly(data, candidate_ids, seconds, seed):
    selected_ids = set(candidate_ids)
    duties = {day: sorted([c for c in data["candidates"] if c["id"] in selected_ids and c["dayType"] == day], key=lambda c: (c["reportTime"], c["id"])) for day in set(DAY_TYPES)}
    if sum(map(len, duties.values())) != len(selected_ids):
        raise ValueError("Selected candidate IDs missing or duplicated")
    rules, weekly = data["rules"], data["rules"]["weekly"]
    job_count = sum(len(duties[day]) for day in DAY_TYPES)
    possible_crews = [n for n in range(math.ceil(job_count / 5), min(rules["workforce"]["fixedCrews"], (job_count + weekly["fourDayRosterMaximumCount"]) // 5) + 1) if n >= max(map(len, duties.values()))]
    total_paid = sum(sum(c["paidMinutes"] for c in duties[day]) for day in DAY_TYPES)
    total_platform = sum(sum(c["platformMinutes"] for c in duties[day]) for day in DAY_TYPES)
    possible_crews = [n for n in possible_crews if weekly["minimumPaidMinutes"] * n <= total_paid <= weekly["maximumCombinedMinutes"] * n and total_platform <= weekly["maximumPlatformMinutes"] * n]
    attempts = []
    deadline = time.monotonic() + seconds
    for crew_count in possible_crews:
        model = cp_model.CpModel()
        hints = roster_hint(duties, crew_count, weekly, seed)
        choices, worked, paid, platform, starts, ends = {}, {}, {}, {}, {}, {}
        for day, day_type in enumerate(DAY_TYPES):
            jobs = duties[day_type]
            for crew in range(crew_count):
                key = crew, day
                off_value = len(jobs) + crew
                choices[key] = model.new_int_var_from_domain(cp_model.Domain.from_values(list(range(len(jobs))) + [off_value]), f"duty-{crew}-{day}")
                if key in hints:
                    model.add_hint(choices[key], hints[key])
                worked[key] = model.new_bool_var(f"work-{crew}-{day}")
                model.add(choices[key] < len(jobs)).only_enforce_if(worked[key])
                model.add(choices[key] == off_value).only_enforce_if(worked[key].Not())
                for field, target in [("paidMinutes", paid), ("platformMinutes", platform), ("reportTime", starts), ("offTime", ends)]:
                    values = [c[field] for c in jobs] + [0] * crew_count
                    target[key] = model.new_int_var(min(values), max(values), f"{field}-{crew}-{day}")
                    model.add_element(choices[key], values, target[key])
            model.add_all_different([choices[crew, day] for crew in range(crew_count)])
            model.add(sum(worked[crew, day] for crew in range(crew_count)) == len(jobs))
        # Crew labels are anonymous: canonical Monday assignment loses no solution.
        for crew in range(crew_count):
            model.add(choices[crew, 0] == (crew if crew < len(duties["Weekday"]) else len(duties["Weekday"]) + crew))
        four_days = []
        for crew in range(crew_count):
            four = model.new_bool_var(f"four-days-{crew}")
            four_days.append(four)
            model.add(sum(worked[crew, day] for day in range(7)) == 5 - four)
            model.add(sum(paid[crew, day] for day in range(7)) >= weekly["minimumPaidMinutes"])
            model.add(sum(paid[crew, day] for day in range(7)) <= weekly["maximumCombinedMinutes"])
            model.add(sum(platform[crew, day] for day in range(7)) <= weekly["maximumPlatformMinutes"])
            off_streaks = []
            for day in range(7):
                streak = model.new_bool_var(f"off-streak-{crew}-{day}")
                off_streaks.append(streak)
                for delta in range(weekly["minimumConsecutiveDaysOff"]):
                    model.add(worked[crew, (day + delta) % 7] == 0).only_enforce_if(streak)
                for gap in range(1, 7):
                    nxt = (day + gap) % 7
                    model.add(gap * 1440 + starts[crew, nxt] - ends[crew, day] >= weekly["minimumRestMinutes"]).only_enforce_if([worked[crew, day], worked[crew, nxt]])
            model.add_bool_or(off_streaks)
        model.add(sum(four_days) <= weekly["fourDayRosterMaximumCount"])
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            attempts.append({"status": "UNKNOWN", "crewCount": crew_count, "reason": "Time budget exhausted during model construction"})
            break
        solver = solver_for(remaining / (len(possible_crews) - len(attempts)), seed)
        status = solver.solve(model)
        attempts.append({"status": solver.status_name(status), "crewCount": crew_count, "wallSeconds": solver.wall_time})
        if status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            rosters = []
            for crew in range(crew_count):
                assignments = []
                for day, day_type in enumerate(DAY_TYPES):
                    index = solver.value(choices[crew, day])
                    assignments.append({"day": DAYS[day], "runId": duties[day_type][index]["id"] if index < len(duties[day_type]) else None})
                rosters.append({"id": f"crew-{crew + 1:03}", "crewNumber": f"Crew {crew + 1:03}", "assignments": assignments})
            return {"status": "FEASIBLE", "weeklyRosters": rosters, "attempts": attempts}
    return {"status": "INFEASIBLE" if not possible_crews or len(attempts) == len(possible_crews) and all(a["status"] == "INFEASIBLE" for a in attempts) else "UNKNOWN", "attempts": attempts, "possibleCrewCounts": possible_crews, "totalJobInstances": job_count, "totalPaidMinutes": total_paid}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="outputs/corrected-run-cut-20260921/candidates.json")
    parser.add_argument("--output", default="outputs/corrected-run-cut-20260921/solution.json")
    parser.add_argument("--stage", choices=["daily", "weekly", "all"], default="all")
    parser.add_argument("--daily-seconds", type=float, default=120)
    parser.add_argument("--weekly-seconds", type=float, default=180)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--seed", type=int, default=21)
    args = parser.parse_args()
    raw = Path(args.input).read_bytes()
    data = json.loads(raw)
    output = Path(args.output)
    result = {"candidateInputSha256": hashlib.sha256(raw).hexdigest(), "status": "UNKNOWN", "attempts": [], "scope": "Supplied candidate pool; daily legality independently validated by Scheduler 4"}
    excluded = []
    for iteration in range(1 if args.stage != "all" else args.iterations):
        if args.stage == "weekly":
            previous = json.loads(output.read_text(encoding="utf-8"))
            if previous.get("candidateInputSha256") != result["candidateInputSha256"]:
                raise ValueError("Daily selection belongs to a different candidate input")
            daily = previous["daily"]
        else:
            daily = solve_daily(data, args.daily_seconds, args.seed + iteration, excluded)
        result["daily"] = daily
        if daily["status"] not in ("FEASIBLE", "OPTIMAL"):
            result["status"] = daily["status"] if not excluded else "UNKNOWN"
            break
        result["selectedCandidateIds"] = daily["selectedCandidateIds"]
        if args.stage == "daily":
            result["status"] = "DAILY_FEASIBLE_WEEKLY_NOT_EVALUATED"
            break
        weekly = solve_weekly(data, daily["selectedCandidateIds"], args.weekly_seconds, args.seed + iteration)
        result["weekly"] = weekly
        result["attempts"].append({"iteration": iteration + 1, "daily": daily, "weekly": {k: v for k, v in weekly.items() if k != "weeklyRosters"}})
        if weekly["status"] == "FEASIBLE":
            result.update(status="FEASIBLE", weeklyRosters=weekly["weeklyRosters"])
            break
        result["status"] = "UNKNOWN"
        excluded.append(daily["selectedCandidateIds"])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "selectedDuties": len(result.get("selectedCandidateIds", [])), "crews": len(result.get("weeklyRosters", [])), "output": str(output)}), flush=True)


if __name__ == "__main__":
    main()
