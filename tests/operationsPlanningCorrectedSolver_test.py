"""Run with the local OR-Tools venv and python -m unittest discover."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("corrected_solver", Path(__file__).parents[1] / "scripts/operations-planning-corrected-solve.py")
solver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(solver)


def fixture():
    rules = {"longSpreadMinutes": {"threshold": 660, "maximumShare": .1}, "reliefCabCapacity": 6,
             "workforce": {"fixedCrews": 112}, "weekly": {"minimumPaidMinutes": 2310,
             "maximumPlatformMinutes": 2400, "maximumCombinedMinutes": 2640,
             "minimumRestMinutes": 600, "fourDayRosterMaximumCount": 8,
             "minimumConsecutiveDaysOff": 2}}
    candidates = [{"id": f"{day}-{i}", "dayType": day, "unitIds": [f"{day}-{i}"],
                   "paidMinutes": 500, "platformMinutes": 420, "reportTime": 400 + i,
                   "offTime": 900 + i, "spreadMinutes": 500, "isSplit": False,
                   "cabIntervals": [], "cost": 500} for day in ["Weekday", "Saturday", "Sunday"] for i in range(5)]
    return {"rules": rules, "candidates": candidates,
            "units": [{"id": c["id"], "dayType": c["dayType"]} for c in candidates]}


class CorrectedSolverTest(unittest.TestCase):
    def test_complete_daily_and_weekly(self):
        data = fixture()
        daily = solver.solve_daily(data, 5, 21)
        self.assertIn(daily["status"], ["FEASIBLE", "OPTIMAL"])
        result = solver.solve_weekly(data, daily["selectedCandidateIds"], 15, 21)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["weeklyRosters"]), 7)
        by_id = {c["id"]: c for c in data["candidates"]}
        covered = set()
        for crew in result["weeklyRosters"]:
            worked = [(i, by_id[a["runId"]]) for i, a in enumerate(crew["assignments"]) if a["runId"]]
            self.assertEqual(len(worked), 5)
            self.assertTrue(2310 <= sum(c["paidMinutes"] for _, c in worked) <= 2640)
            self.assertLessEqual(sum(c["platformMinutes"] for _, c in worked), 2400)
            off = {i for i, a in enumerate(crew["assignments"]) if not a["runId"]}
            self.assertTrue(any((i + 1) % 7 in off for i in off))
            for index, (day, c) in enumerate(worked):
                next_day, nxt = worked[(index + 1) % len(worked)]
                self.assertGreaterEqual(((next_day - day) % 7) * 1440 + nxt["reportTime"] - c["offTime"], 600)
                self.assertNotIn((day, c["id"]), covered)
                covered.add((day, c["id"]))
        self.assertEqual(len(covered), 35)

    def test_no_candidate_is_explicitly_infeasible(self):
        data = fixture()
        data["candidates"].pop()
        result = solver.solve_daily(data, 5, 21)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(result["uncoveredUnitIds"], ["Sunday-4"])

    def test_cab_capacity_is_not_relaxed(self):
        data = fixture()
        data["rules"]["reliefCabCapacity"] = 4
        for c in data["candidates"]:
            c["cabIntervals"] = [{"start": 400, "end": 410}]
        self.assertEqual(solver.solve_daily(data, 5, 21)["status"], "INFEASIBLE")

    def test_long_spread_is_not_relaxed(self):
        data = fixture()
        data["candidates"][0]["spreadMinutes"] = 700
        self.assertEqual(solver.solve_daily(data, 5, 21)["status"], "INFEASIBLE")

    def test_weekly_minimum_is_not_filled_with_invented_pay(self):
        data = fixture()
        for c in data["candidates"]:
            c["paidMinutes"] = 400
        ids = [c["id"] for c in data["candidates"]]
        self.assertEqual(solver.solve_weekly(data, ids, 5, 21)["status"], "INFEASIBLE")


if __name__ == "__main__":
    unittest.main()
